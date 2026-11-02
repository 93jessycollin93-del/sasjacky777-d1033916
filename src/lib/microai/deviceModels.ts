/**
 * The models the chat's On-device engine can download and run in the tab.
 *
 * Bonsai is the one this repository ships and pins byte for byte. The others
 * are the chat-capable language models from the owner's download queue:
 * instruction-tuned, published as GGUF, and small enough that llama.cpp in
 * WebAssembly can hold them. The rest of that queue — speech, vision,
 * embeddings — needs runtimes this app does not carry yet.
 *
 * ## How the unpinned ones are fetched
 *
 * This repository cannot pin their bytes the way it pins Bonsai's: nothing
 * here can reach Hugging Face to read them. So each is resolved on the device,
 * when the owner presses Download: the first repository in `repos` that lists a
 * single-file GGUF in a quantization from `quants`, at the commit that listing
 * came from, and kept only if the size that arrived is the size it listed.
 * That is the same trust wllama's own Hugging Face loader extends, with the
 * publisher chosen here rather than by whoever uploaded last: official repos
 * first, then well-known re-quantizers.
 *
 * Pure data and string matching: no wllama, no network. The engine registry
 * imports it for the picker, and that must stay cheap.
 */
import { GUIDE_WEIGHTS_PATH, GUIDE_WEIGHTS_SOURCE } from "@/lib/guide/weights";

export const HF = "https://huggingface.co";

export interface DeviceModelSpec {
  /** The picker's id, and the model the chat records as having answered. */
  id: string;
  name: string;
  /** One line for the picker. */
  note: string;
  /** Hugging Face repositories to resolve from, best first. */
  repos: string[];
  /** Quantizations to take, best first, matched against the file name. */
  quants: string[];
  /** Exact bytes, when this repository pins them (Bonsai). */
  pinned?: { sha256: string; bytes: number; ownPath: string };
  /** For the panel, before the listing says exactly. */
  approxMB: number;
  /**
   * Small enough for a phone's browser. The compatibility build Safari runs
   * addresses at most 4 GB, and a phone gives a tab far less than that.
   */
  phone: boolean;
  license: string;
  /** Its number in the download queue, if it came from there. */
  queue?: number;
}

export const BONSAI_ID = "bonsai-1.7b";

/** Q4_K_M is the usual balance; the rest are what publishers often ship instead. */
const USUAL_QUANTS = ["q4_k_m", "q4_0", "q5_k_m", "q8_0"];

export const DEVICE_MODELS: readonly DeviceModelSpec[] = [
  {
    id: BONSAI_ID,
    name: "Bonsai 1.7B",
    note: "1-bit, 237 MB, pinned by this repository",
    repos: [GUIDE_WEIGHTS_SOURCE],
    quants: ["q1_0"],
    pinned: {
      sha256: "3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3",
      bytes: 248_302_272,
      ownPath: GUIDE_WEIGHTS_PATH,
    },
    approxMB: 237,
    phone: true,
    license: "Apache-2.0",
  },
  {
    id: "smollm2-360m-instruct",
    name: "SmolLM2 360M Instruct",
    note: "about 270–390 MB · fastest · phone-friendly",
    repos: ["HuggingFaceTB/SmolLM2-360M-Instruct-GGUF", "bartowski/SmolLM2-360M-Instruct-GGUF"],
    quants: USUAL_QUANTS,
    approxMB: 390,
    phone: true,
    license: "Apache-2.0",
    queue: 2,
  },
  {
    id: "qwen2.5-0.5b-instruct",
    name: "Qwen2.5 0.5B Instruct",
    note: "about 400–500 MB · phone-friendly",
    repos: ["Qwen/Qwen2.5-0.5B-Instruct-GGUF", "bartowski/Qwen2.5-0.5B-Instruct-GGUF"],
    quants: USUAL_QUANTS,
    approxMB: 490,
    phone: true,
    license: "Apache-2.0",
    queue: 1,
  },
  {
    id: "smollm2-1.7b-instruct",
    name: "SmolLM2 1.7B Instruct",
    note: "about 1.1 GB · laptop or desktop",
    repos: [
      "HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF",
      "bartowski/SmolLM2-1.7B-Instruct-GGUF",
      "MaziyarPanahi/SmolLM2-1.7B-Instruct-GGUF",
    ],
    quants: USUAL_QUANTS,
    approxMB: 1060,
    phone: false,
    license: "Apache-2.0",
    queue: 3,
  },
  {
    id: "qwen2.5-coder-1.5b-instruct",
    name: "Qwen2.5 Coder 1.5B Instruct",
    note: "about 1.1 GB · code · laptop or desktop",
    repos: ["Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF", "bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF"],
    quants: USUAL_QUANTS,
    approxMB: 1120,
    phone: false,
    license: "Apache-2.0",
    queue: 4,
  },
  {
    id: "smollm3-3b",
    name: "SmolLM3 3B",
    note: "about 1.9 GB · stronger reasoning · desktop",
    repos: ["ggml-org/SmolLM3-3B-GGUF", "bartowski/HuggingFaceTB_SmolLM3-3B-GGUF"],
    quants: USUAL_QUANTS,
    approxMB: 1920,
    phone: false,
    license: "Apache-2.0",
    queue: 5,
  },
  {
    id: "phi-3.5-mini-instruct",
    name: "Phi-3.5 mini Instruct",
    note: "about 2.4 GB · strongest here · desktop",
    repos: ["bartowski/Phi-3.5-mini-instruct-GGUF"],
    quants: USUAL_QUANTS,
    approxMB: 2390,
    phone: false,
    license: "MIT",
    queue: 7,
  },
];

export const DEFAULT_DEVICE_MODEL_ID = BONSAI_ID;

export function findDeviceModel(id: unknown): DeviceModelSpec | undefined {
  return DEVICE_MODELS.find((m) => m.id === id);
}

/** The model to run when asked for `id`: that one if known, else Bonsai. */
export function deviceModelOrDefault(id: unknown): DeviceModelSpec {
  return findDeviceModel(id) ?? (findDeviceModel(DEFAULT_DEVICE_MODEL_ID) as DeviceModelSpec);
}

/**
 * Whether a cached file is this model's. By where it came from: this app's own
 * copy (Bonsai, and the Guide's rung loads it by the bare path) or one of the
 * model's repositories on Hugging Face. Each repository holds one model, so
 * the prefix is enough to tell two models' files apart.
 */
export function isModelUrl(
  spec: DeviceModelSpec,
  url: string,
  origin: string = globalThis.location?.origin ?? "http://localhost",
): boolean {
  if (spec.pinned) {
    const own = spec.pinned.ownPath;
    if (url === own || url === new URL(own, origin).href) return true;
  }
  return spec.repos.some((repo) => url.startsWith(`${HF}/${repo}/resolve/`));
}

export interface ListedFile {
  rfilename?: unknown;
  size?: unknown;
  lfs?: { sha256?: unknown; oid?: unknown; size?: unknown };
}

/**
 * The file to take from a repository's listing: one GGUF in the first
 * quantization from `quants` that it has. Never a projector (`mmproj`, the
 * vision half of a multimodal model) and never one shard of a split model —
 * this engine loads one file. The quantization must be the whole tag: `q4_0`
 * does not take ARM's `Q4_0_4_4` repack, which other CPUs cannot run.
 */
export function chooseGguf(siblings: ListedFile[], quants: string[]): { file: string; bytes?: number } | null {
  const files = siblings.filter(
    (s): s is ListedFile & { rfilename: string } =>
      typeof s?.rfilename === "string" &&
      /\.gguf$/i.test(s.rfilename) &&
      !/mmproj/i.test(s.rfilename) &&
      !/-\d{5}-of-\d{5}\.gguf$/i.test(s.rfilename),
  );
  for (const quant of quants) {
    const tag = new RegExp(`[-_.]${quant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\.gguf$|-)`, "i");
    const hit = files.find((f) => tag.test(f.rfilename));
    if (hit) {
      const size = Number(hit.lfs?.size ?? hit.size);
      return { file: hit.rfilename, ...(size > 0 ? { bytes: size } : {}) };
    }
  }
  return null;
}
