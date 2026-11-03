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
    const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const processor = await lib.AutoProcessor.from_pretrained(VISION_MODEL_ID, { progress_callback });
    const model = await lib.AutoModelForVision2Seq.from_pretrained(VISION_MODEL_ID, {
      dtype: { embed_tokens: "fp16", vision_encoder: "q4", decoder_model_merged: "q4" },
      device: webgpu ? "webgpu" : "wasm",
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
