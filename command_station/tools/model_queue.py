#!/usr/bin/env python3
"""
Download the compact-model queue onto the rig, into the folder layout it names.

The queue is command_station/models/manifests/DOWNLOAD_QUEUE.json — the same
file the app's /models page and its On-device engine read — so the rig and
the browser cannot disagree about which repository a model comes from.

    python command_station/tools/model_queue.py --phase 1            # print the plan
    python command_station/tools/model_queue.py --phase 1 --download # fetch it
    python command_station/tools/model_queue.py --queue 1,2,8 --root E:/AI_Permanent/models --download

Printing the plan is the default. The queue is a list of things to fetch from
other people's servers, some of them gigabytes and some under licences that
forbid commercial use, so nothing downloads without --download.

What it will not do:
- fetch an entry the queue marks as published outside Hugging Face (repo null):
  it prints where to get it instead;
- fetch a duplicate: the queue lists some models twice, under two sections;
- pretend: a gated or missing repository is reported by name and the run
  carries on, and the summary counts what failed.

Needs `huggingface_hub` only for --download (pip install huggingface_hub). A
token for gated repositories is read from HF_TOKEN, as huggingface_hub does.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional

QUEUE_PATH = Path(__file__).resolve().parent.parent / "models" / "manifests" / "DOWNLOAD_QUEUE.json"

RUNTIME_TARGETS = {
    "GGUF": "llama.cpp",
    "ONNX": "onnxruntime",
    "TFLite": "litert",
    "Core ML": "coreml",
    "PyTorch": "transformers",
    "Native PyTorch": "transformers",
    "Transformers": "transformers",
    "Diffusers": "diffusers",
    "CTranslate2": "ctranslate2",
    "Native": "native",
    "ExecuTorch": "executorch",
}

# Configuration and tokenizer files every format needs beside its weights.
SUPPORT_FILES = re.compile(r"(^|/)([^/]*\.json|[^/]*\.txt|[^/]*\.model|tokenizer[^/]*|[^/]*\.tiktoken|README\.md)$")


def load_queue(path: Path = QUEUE_PATH) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def fetch_repo(entry: dict) -> Optional[str]:
    """The Hugging Face repository to fetch, or None when it is published elsewhere."""
    if "repo" in entry:
        return entry["repo"]
    return entry["id"]


def choose_gguf(files: List[str], quants: List[str]) -> Optional[str]:
    """
    One GGUF from a repository's file list, in the first quantization it has.

    The same rule as the app's chooseGguf (src/lib/microai/deviceModels.ts):
    never a vision projector, never one shard of a split model, and the tag
    must be whole, so q4_0 does not take ARM's Q4_0_4_4 repack.
    """
    candidates = [
        f
        for f in files
        if f.lower().endswith(".gguf") and "mmproj" not in f.lower() and not re.search(r"-\d{5}-of-\d{5}\.gguf$", f, re.I)
    ]
    for quant in quants:
        tag = re.compile(r"[-_.]" + re.escape(quant) + r"(?=\.gguf$|-)", re.I)
        for f in candidates:
            if tag.search(f):
                return f
    return None


def choose_files(entry: dict, files: List[str]) -> List[str]:
    """
    Which files of a (non-GGUF) repository to take.

    ONNX first when the queue wants ONNX and the repository has an export;
    otherwise the safetensors weights, or the older .bin when that is all
    there is. Never every weight format at once: many repositories carry the
    same weights three times (safetensors, .bin, .h5), and the queue is long.
    """
    support = [f for f in files if SUPPORT_FILES.search(f)]
    onnx = [f for f in files if f.lower().endswith(".onnx") or f.lower().endswith(".onnx_data")]
    if "ONNX" in entry.get("formats", []) and onnx:
        return sorted(set(support + onnx))
    safetensors = [f for f in files if f.endswith(".safetensors")]
    if safetensors:
        return sorted(set(support + safetensors))
    bins = [f for f in files if f.endswith(".bin") or f.endswith(".pt") or f.endswith(".pth")]
    if bins:
        return sorted(set(support + bins))
    return sorted(set(files))


def target_dir(root: Path, entry: dict) -> Path:
    # Named for what is actually fetched: the queue's #19 asks for a
    # Florence-2-small that does not exist, and a folder of that name holding
    # Florence-2-base would mislead whoever opens it.
    named = fetch_repo(entry) or entry["id"]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", named.split("/")[-1]).strip("-") or "model-%d" % entry["queue"]
    return root / entry["folder"] / name


def manifest_for(entry: dict, queue: dict, source: str, quantization: Optional[str] = None) -> dict:
    """The per-model manifest, in the shape the queue's author proposed."""
    same_folder = [
        m
        for m in queue["models"]
        if m["folder"] == entry["folder"]
        and m["queue"] != entry["queue"]
        and "duplicateOf" not in m
        and fetch_repo(m) is not None
    ]
    manifest = {
        "name": entry["id"].split("/")[-1],
        "source": source,
        "queue": entry["queue"],
        "task": entry["task"],
        "formats": entry["formats"],
        "runtime_targets": sorted({RUNTIME_TARGETS[f] for f in entry["formats"] if f in RUNTIME_TARGETS}),
        "fallbacks": [fetch_repo(m) for m in same_folder[:2]],
    }
    if quantization:
        manifest["quantizations"] = [quantization]
    tier = entry["folder"].split("/")[1] if entry["folder"].startswith("embeddings/") else None
    if tier:
        manifest["memory_tier"] = tier
    for key in ("license", "note", "caution"):
        if key in entry:
            manifest[key] = entry[key]
    return manifest


def select(queue: dict, phase: Optional[int] = None, numbers: Optional[List[int]] = None, tier0: bool = False) -> List[dict]:
    by_number = {m["queue"]: m for m in queue["models"]}
    if numbers:
        return [by_number[n] for n in numbers if n in by_number]
    if phase is not None:
        return [by_number[n] for n in queue["phases"][str(phase)] if n in by_number]
    if tier0:
        return [m for m in queue["models"] if m["section"] == "tier0"]
    return list(queue["models"])


def plan(
    entries: List[dict],
    root: Path,
    list_files: Optional[Callable[[str], List[str]]],
    use_gguf: bool = True,
) -> List[dict]:
    """
    What would be fetched for each entry, and why anything would not be.

    `list_files(repo)` lists a repository's files; it raises when the
    repository is gated or missing, and that is recorded, not swallowed.
    Without it (a plan printed offline) each step names the repository and
    what it will look for there, and lists nothing.
    """
    steps = []
    seen = set()
    for entry in entries:
        step = {"queue": entry["queue"], "id": entry["id"], "dir": str(target_dir(root, entry))}
        duplicate = entry.get("duplicateOf")
        if duplicate is not None or fetch_repo(entry) in seen:
            step.update(action="skip", reason="duplicate of #%s" % (duplicate if duplicate is not None else "an earlier entry"))
            steps.append(step)
            continue
        repo = fetch_repo(entry)
        if repo is None:
            step.update(action="skip", reason="published outside Hugging Face: %s" % entry.get("source", "see the queue"))
            steps.append(step)
            continue
        seen.add(repo)
        gguf = entry.get("gguf") if use_gguf and "GGUF" in entry.get("formats", []) else None
        if list_files is None:
            if gguf:
                wanted = "one GGUF: " + ", ".join(q.upper() for q in gguf["quants"])
                step.update(action="download", repo=gguf["repos"][0], files=[wanted])
            else:
                weights = "the ONNX export if there is one, else safetensors" if "ONNX" in entry.get("formats", []) else "safetensors (or .bin)"
                step.update(action="download", repo=repo, files=["config and tokenizer, " + weights])
            steps.append(step)
            continue
        if gguf:
            failures = []
            for gguf_repo in gguf["repos"]:
                try:
                    chosen = choose_gguf(list_files(gguf_repo), gguf["quants"])
                except Exception as error:  # noqa: BLE001 - reported per repository, not swallowed
                    failures.append("%s: %s" % (gguf_repo, error))
                    continue
                if chosen:
                    quant = next(q for q in gguf["quants"] if re.search(r"[-_.]" + re.escape(q) + r"(?=\.gguf$|-)", chosen, re.I))
                    step.update(action="download", repo=gguf_repo, files=[chosen], quantization=quant)
                    break
                failures.append("%s: no single-file GGUF in %s" % (gguf_repo, ", ".join(q.upper() for q in gguf["quants"])))
            else:
                step.update(action="fail", reason="; ".join(failures))
            steps.append(step)
            continue
        try:
            files = list_files(repo)
        except Exception as error:  # noqa: BLE001
            step.update(action="fail", reason="%s: %s" % (repo, error))
            steps.append(step)
            continue
        step.update(action="download", repo=repo, files=choose_files(entry, files))
        steps.append(step)
    return steps


def hub_client():
    try:
        from huggingface_hub import HfApi, hf_hub_download  # noqa: F401
    except ImportError:
        sys.exit("--download needs huggingface_hub: pip install huggingface_hub")
    from huggingface_hub import HfApi, hf_hub_download

    api = HfApi()

    def list_files(repo: str) -> List[str]:
        return api.list_repo_files(repo)

    def download(repo: str, files: List[str], local_dir: Path) -> None:
        for name in files:
            hf_hub_download(repo_id=repo, filename=name, local_dir=str(local_dir))

    return list_files, download


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--phase", type=int, choices=[1, 2, 3], help="one of the queue's download phases")
    parser.add_argument("--queue", help="queue numbers, comma-separated, e.g. 1,2,8")
    parser.add_argument("--tier0", action="store_true", help="the 20 'validate first' models")
    parser.add_argument("--root", default="models", help="where the folder layout starts (default: ./models)")
    parser.add_argument("--no-gguf", action="store_true", help="take the original weights even where a GGUF build is listed")
    parser.add_argument("--download", action="store_true", help="fetch; without it the plan is only printed")
    args = parser.parse_args(argv)

    queue = load_queue()
    numbers = [int(n) for n in args.queue.split(",")] if args.queue else None
    entries = select(queue, phase=args.phase, numbers=numbers, tier0=args.tier0)
    root = Path(args.root)

    # Without --download the plan is made offline: it names each repository
    # and what it will look for there, and lists nothing.
    list_files, download = hub_client() if args.download else (None, None)

    steps = plan(entries, root, list_files, use_gguf=not args.no_gguf)
    failed = 0
    for step in steps:
        line = "#%-3d %-55s" % (step["queue"], step["id"])
        if step["action"] == "download":
            files = ", ".join(step["files"][:4]) + (" …" if len(step["files"]) > 4 else "")
            print("%s %s -> %s  [%s]" % (line, step["repo"], step["dir"], files))
            if download is not None:
                entry = next(m for m in entries if m["queue"] == step["queue"])
                local = Path(step["dir"])
                try:
                    local.mkdir(parents=True, exist_ok=True)
                    download(step["repo"], step["files"], local)
                    manifest = manifest_for(entry, queue, step["repo"], step.get("quantization"))
                    with open(local / "manifest.json", "w", encoding="utf-8") as handle:
                        json.dump(manifest, handle, indent=2)
                        handle.write("\n")
                except Exception as error:  # noqa: BLE001 - one failure must not stop the queue
                    failed += 1
                    print("     FAILED: %s" % error)
        elif step["action"] == "fail" and args.download:
            failed += 1
            print("%s FAILED: %s" % (line, step["reason"]))
        else:
            print("%s skip: %s" % (line, step.get("reason", "")))

    downloads = sum(1 for s in steps if s["action"] == "download")
    skipped = sum(1 for s in steps if s["action"] == "skip")
    print("\n%d to download, %d skipped, %d failed%s" % (downloads, skipped, failed, "" if args.download else " (plan only)"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
