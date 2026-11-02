#!/usr/bin/env python3
"""
The rig's model-queue downloader, without the network.

What matters is what it would fetch and what it refuses to: one file of the
right quantization where a GGUF build exists, one weight format where a
repository carries three, nothing for an entry published elsewhere or listed
twice, and a gated repository reported by name rather than skipped silently.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import model_queue as mq  # noqa: E402

QUEUE = mq.load_queue()
ROOT = Path("/models")


def by(number):
    return next(m for m in QUEUE["models"] if m["queue"] == number)


def test_the_queue_has_every_numbered_entry_once_in_order():
    assert [m["queue"] for m in QUEUE["models"]] == list(range(1, 181))


def test_every_phase_and_tier_list_points_at_real_entries():
    numbers = {m["queue"] for m in QUEUE["models"]}
    for listed in list(QUEUE["phases"].values()) + list(QUEUE["embedding_tiers"].values()):
        assert set(listed) <= numbers
    assert [len(QUEUE["phases"][p]) for p in ("1", "2", "3")] == [15, 15, 15]


def test_a_duplicate_names_an_earlier_entry_with_the_same_model():
    for m in QUEUE["models"]:
        if "duplicateOf" in m:
            original = by(m["duplicateOf"])
            assert original["queue"] < m["queue"]
            assert original["id"] == m["id"]


def test_takes_one_gguf_in_the_first_quantization_the_repository_has():
    files = ["README.md", "qwen2.5-0.5b-instruct-fp16.gguf", "qwen2.5-0.5b-instruct-q8_0.gguf", "qwen2.5-0.5b-instruct-q4_k_m.gguf"]
    assert mq.choose_gguf(files, ["q4_k_m", "q8_0"]) == "qwen2.5-0.5b-instruct-q4_k_m.gguf"
    assert mq.choose_gguf(files[:3], ["q4_k_m", "q8_0"]) == "qwen2.5-0.5b-instruct-q8_0.gguf"


def test_never_takes_a_projector_a_shard_or_arms_q4_0_repack_as_q4_0():
    files = ["m-mmproj-q4_0.gguf", "m-q4_0-00001-of-00002.gguf", "M-Q4_0_4_4.gguf"]
    assert mq.choose_gguf(files, ["q4_0"]) is None


def test_takes_one_weight_format_not_every_copy_of_the_weights():
    files = ["config.json", "tokenizer.json", "model.safetensors", "pytorch_model.bin", "tf_model.h5", "flax_model.msgpack"]
    assert mq.choose_files({"formats": ["ONNX"]}, files) == ["config.json", "model.safetensors", "tokenizer.json"]


def test_prefers_the_onnx_export_when_the_queue_wants_onnx_and_one_exists():
    files = ["config.json", "model.safetensors", "onnx/model.onnx", "onnx/model_quantized.onnx"]
    assert mq.choose_files({"formats": ["ONNX"]}, files) == ["config.json", "onnx/model.onnx", "onnx/model_quantized.onnx"]
    assert mq.choose_files({"formats": ["PyTorch"]}, files) == ["config.json", "model.safetensors"]


def test_fetches_a_gguf_build_from_its_listed_repository_and_records_the_quantization():
    listings = {"Qwen/Qwen2.5-0.5B-Instruct-GGUF": ["qwen2.5-0.5b-instruct-q4_k_m.gguf"]}
    [step] = mq.plan([by(1)], ROOT, lambda repo: listings[repo])
    assert step["action"] == "download"
    assert step["repo"] == "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
    assert step["files"] == ["qwen2.5-0.5b-instruct-q4_k_m.gguf"]
    assert step["quantization"] == "q4_k_m"


def test_falls_back_to_the_next_listed_gguf_repository():
    def listing(repo):
        if repo == "Qwen/Qwen2.5-0.5B-Instruct-GGUF":
            raise RuntimeError("404 Not Found")
        return ["Qwen2.5-0.5B-Instruct-Q4_K_M.gguf"]

    [step] = mq.plan([by(1)], ROOT, listing)
    assert step["repo"] == "bartowski/Qwen2.5-0.5B-Instruct-GGUF"


def test_reports_a_gated_repository_by_name_instead_of_skipping_it_quietly():
    def listing(repo):
        raise RuntimeError("401 gated: accept the terms first")

    [step] = mq.plan([by(6)], ROOT, listing)
    assert step["action"] == "fail"
    assert "google/gemma-3-1b-it" in step["reason"] and "gated" in step["reason"]


def test_fetches_the_corrected_repository_into_a_folder_named_for_it():
    [step] = mq.plan([by(19)], ROOT, lambda repo: ["config.json", "model.safetensors"])
    assert step["repo"] == "microsoft/Florence-2-base"
    assert step["dir"].endswith("multimodal/vlm/Florence-2-base")


def test_never_fetches_an_entry_published_outside_hugging_face_or_listed_twice():
    calls = []
    steps = mq.plan([by(127), by(10), by(72)], ROOT, lambda repo: calls.append(repo) or ["model.safetensors"])
    assert [s["action"] for s in steps] == ["skip", "download", "skip"]
    assert "github.com/ChaoningZhang/MobileSAM" in steps[0]["reason"]
    assert "duplicate of #10" in steps[2]["reason"]
    assert calls == ["sentence-transformers/all-MiniLM-L6-v2"]


def test_writes_the_manifest_in_the_proposed_shape():
    manifest = mq.manifest_for(by(2), QUEUE, "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF", "q8_0")
    assert manifest["name"] == "SmolLM2-360M-Instruct"
    assert manifest["source"] == "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF"
    assert manifest["quantizations"] == ["q8_0"]
    assert manifest["runtime_targets"] == ["llama.cpp", "onnxruntime"]
    assert len(manifest["fallbacks"]) == 2 and None not in manifest["fallbacks"]
    assert mq.manifest_for(by(71), QUEUE, "TaylorAI/bge-micro-v2")["memory_tier"] == "fast"


def test_the_offline_plan_names_what_it_will_look_for_and_lists_nothing():
    steps = mq.plan(mq.select(QUEUE, phase=1), ROOT, None)
    assert len(steps) == 15
    first = steps[0]
    assert first["queue"] == 2 and first["files"] == ["one GGUF: Q4_K_M, Q4_0, Q5_K_M, Q8_0"]


def test_plan_only_is_the_default_and_downloads_nothing(capsys):
    assert mq.main(["--queue", "1,127"]) == 0
    out = capsys.readouterr().out
    assert "plan only" in out and "skip: published outside Hugging Face" in out


def test_the_queue_is_valid_json_with_a_trailing_newline():
    text = mq.QUEUE_PATH.read_text(encoding="utf-8")
    assert text.endswith("\n")
    json.loads(text)
