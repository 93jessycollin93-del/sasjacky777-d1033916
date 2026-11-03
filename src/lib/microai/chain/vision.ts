/**
 * The small on-device vision reader for the thinking chain.
 *
 * Bonsai reads text only, and wllama (llama.cpp in the browser) cannot run an
 * image model's vision half. SmolVLM-256M is the smallest open image model
 * that answers in sentences, and transformers.js runs it in the tab from ONNX.
 * It downloads once from Hugging Face (~250 MB at the quantisation used here)
 * into the browser's cache, and after that describes photos with no network.
 *
 * Everything is a lazy import: no page pays for it until a photo is read.
 */
export const VISION_MODEL_ID = "HuggingFaceTB/SmolVLM-256M-Instruct";
export const VISION_MODEL_NAME = "SmolVLM 256M";

/**
 * What the download costs, for the owner's on-device ceiling.
 *
 * An estimate, and labelled as one: the file is not pinned by this repository
 * the way Bonsai is, so the honest figure is the one the module's own note
 * carries. It is used only to decide whether a download still fits under the
 * 750 MB ceiling — never to claim a file arrived at a particular size, which
 * `visionWeightsStatus` answers by looking at the cache instead.
 */
export const VISION_MODEL_MB = 250;

/**
 * Bring the photo reader onto this device without asking it to read anything.
 *
 * The only way to know the weights are here is to have loaded them once, so
 * this runs the same lazy loader the chain uses and reports what the cache says
 * afterwards. It is the download behind an Activate button: the owner's call,
 * made deliberately, rather than a 250 MB fetch that starts because a page
 * opened.
 */
export async function prepareVisionWeights(
  opts: { onProgress?: (p: VisionProgress) => void } = {},
): Promise<string> {
  await load(opts.onProgress);
  const status = await visionWeightsStatus();
  if (!status.present) throw new Error(`${VISION_MODEL_NAME} loaded, but its weights are not in this browser's cache`);
  return status.detail;
}

export interface VisionWeightsStatus {
  present: boolean;
  files: number;
  /** Says what is on the device, or what has to happen before it can be. */
  detail: string;
}

/**
 * Whether the photo reader's weights are already on this device, without
 * loading the model.
 *
 * transformers.js keeps what it downloads in the browser's own cache, and writes
 * a cache entry only once a whole file has arrived — so asking the cache for an
 * ONNX file under this model's name is a real answer, not a guess, and a
 * download that died halfway does not count as having the model. Asking this
 * instead of `from_pretrained` matters: loading the model to find out whether
 * the model is present would pull the runtime and start a download, which is
 * the opposite of a status check.
 */
export async function visionWeightsStatus(): Promise<VisionWeightsStatus> {
  if (typeof caches === "undefined") {
    return {
      present: false,
      files: 0,
      detail: "this browser has no cache, so the photo reader cannot be kept on this device",
    };
  }
  let files = 0;
  let weights = 0;
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (!request.url.includes(VISION_MODEL_ID)) continue;
        files += 1;
        if (request.url.includes(".onnx")) weights += 1;
      }
    }
  } catch (error) {
    return {
      present: false,
      files,
      detail: `could not read this browser's cache: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!weights) {
    return {
      present: false,
      files,
      detail: `${VISION_MODEL_NAME} is not on this device yet — it downloads once, about 250 MB, while you are online`,
    };
  }
  return {
    present: true,
    files,
    detail: `${VISION_MODEL_NAME} on this device · ${weights} weight file${weights === 1 ? "" : "s"}, ${files} file${files === 1 ? "" : "s"} held`,
  };
}

type Loaded = {
  processor: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  model: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  lib: typeof import("@huggingface/transformers");
};
let loading: Promise<Loaded> | null = null;

export interface VisionProgress {
  file: string;
  fraction: number | null;
}

async function load(onProgress?: (p: VisionProgress) => void): Promise<Loaded> {
  if (loading) return loading;
  loading = (async () => {
    const lib = await import("@huggingface/transformers");
    const progress_callback = (p: { status?: string; file?: string; progress?: number }) => {
      if (p.status === "progress") onProgress?.({ file: p.file ?? "", fraction: typeof p.progress === "number" ? p.progress / 100 : null });
    };
    // fp16 needs the GPU's shader-f16 feature; without it the load died with
    // "webgpu does not support fp16". Such devices get the all-q4 build, which
    // is also smaller, so the 750 MB ceiling still holds.
    const gpu = typeof navigator !== "undefined" ? (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: { has(f: string): boolean } } | null> } }).gpu : undefined;
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
    const fp16 = !!adapter?.features.has("shader-f16");
    const processor = await lib.AutoProcessor.from_pretrained(VISION_MODEL_ID, { progress_callback });
    const model = await lib.AutoModelForVision2Seq.from_pretrained(VISION_MODEL_ID, {
      dtype: { embed_tokens: fp16 ? "fp16" : "q4", vision_encoder: "q4", decoder_model_merged: "q4" },
      device: adapter ? "webgpu" : "wasm",
      progress_callback,
    } as Record<string, unknown>);
    return { processor, model, lib };
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null; // a failed download must not poison every later try
    throw e;
  }
}

/**
 * Describes one image in plain sentences. Throws with a readable reason — the
 * chain records it as that source's failure rather than an empty description.
 */
export async function describeImage(
  file: Blob,
  opts: { prompt?: string; onProgress?: (p: VisionProgress) => void } = {},
): Promise<string> {
  let loaded: Loaded;
  try {
    loaded = await load(opts.onProgress);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${VISION_MODEL_NAME} could not load. It downloads once while online, then works offline. (${why})`,
    );
  }
  const { processor, model, lib } = loaded;
  const url = URL.createObjectURL(file);
  try {
    const image = await lib.load_image(url);
    const messages = [
      {
        role: "user",
        content: [
          { type: "image" },
          { type: "text", text: opts.prompt ?? "Describe this photo in detail. Read any visible text, labels, error messages or numbers exactly." },
        ],
      },
    ];
    const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(text, [image]);
    const out = await model.generate({ ...inputs, max_new_tokens: 200, do_sample: false });
    const decoded: string[] = processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), {
      skip_special_tokens: true,
    });
    const description = (decoded[0] ?? "").trim();
    if (!description) throw new Error(`${VISION_MODEL_NAME} looked at the photo and wrote nothing.`);
    return description;
  } finally {
    URL.revokeObjectURL(url);
  }
}
