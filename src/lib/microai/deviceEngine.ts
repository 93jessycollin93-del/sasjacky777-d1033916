/**
 * The `device` rung, which until now did not exist.
 *
 * `contextRouter.ts` has always described an offline-first ladder — device,
 * then LAN, then network — and stated plainly that the network is where updates
 * come from and never where answers come from. But `contextRouterService.ts`
 * registered exactly two engines, Ollama and LM Studio, and both are `lan`. So
 * every router that declared itself offline-first was in fact leaning entirely
 * on another machine being awake on the same network, and the Keeper router —
 * whose whole contract is `ladder: ["device"]`, vault context that never leaves
 * the device — had no engine at all and could not answer.
 *
 * This closes it. The model runs in the tab.
 *
 * ## Why llama.cpp in WebAssembly, and not ONNX
 *
 * The repository already ships its model: `public/models/bonsai-1.7b/` holds
 * 248 MB of GGUF, tracked with LFS, served from the app's own origin so a clone
 * can answer a question about itself on a machine that has never been online.
 *
 * transformers.js and onnxruntime-web cannot read GGUF. Using either would mean
 * converting Bonsai to ONNX and shipping a *second* copy of the same weights,
 * which doubles what a clone carries in order to run the model the clone
 * already has. wllama is llama.cpp compiled to WASM: it loads that exact file.
 *
 * ## What is lazy, and why all of it is
 *
 * A quarter of a gigabyte is not something to fetch because a page rendered.
 * Nothing here touches the network until `run()` is called: `available()` asks
 * whether WebAssembly exists and whether the weights are really on disk — the
 * LFS-pointer case is a genuine one and `checkGuideWeights` already knows how
 * to tell a pointer from a model — and answers from that alone.
 *
 * After the first load, wllama's cache holds the weights in the browser, so the
 * second question costs nothing and works with the radio off. That is the whole
 * point of the rung.
 *
 * The weights it runs are the ones the chat's On-device engine downloads, and
 * the model in memory is the same one (`bonsaiDevice.ts`): on a host that
 * deploys only the LFS pointer, a download from the chat is what makes this
 * rung available at all.
 */
import { GUIDE_WEIGHTS_PATH, checkGuideWeights } from "@/lib/guide/weights";
import { GUIDANCE_MODEL } from "./models";
import type { InferenceEngine } from "./contextRouter";
import { ensureBonsai, storedBonsai, unloadBonsai, withBonsai } from "./bonsaiDevice";

/** How far the load has got, for a UI that has 248 MB to explain. */
export interface DeviceLoadProgress {
  loaded: number;
  total: number;
  /** 0–1, or null when the server did not say how big the file is. */
  fraction: number | null;
}

export interface DeviceEngineOptions {
  /** Served path of the GGUF. Overridable so a test need not ship weights. */
  weightsPath?: string;
  /** Called while the weights download. */
  onProgress?: (progress: DeviceLoadProgress) => void;
  /**
   * Context window, for an injected runtime. The shared model is loaded once
   * with the chat's window (BONSAI_CONTEXT_TOKENS), whichever caller loads it.
   */
  contextSize?: number;
  /** Injected so the availability test does not need a real browser. */
  checkWeights?: typeof checkGuideWeights;
  /** Whether Bonsai is already in this browser's storage. Injected for tests. */
  isDownloaded?: () => Promise<boolean>;
  /** Injected for tests. Real code never passes this. */
  createRuntime?: () => Promise<DeviceRuntime>;
}

/**
 * The slice of wllama this engine uses.
 *
 * Narrow on purpose: it is the seam the tests substitute, and a seam shaped
 * like the whole library would be a seam nobody can stand in.
 */
export interface DeviceRuntime {
  loadModelFromUrl(url: string, params?: Record<string, unknown>): Promise<void>;
  /** OpenAI-shaped, because that is what wllama answers with. */
  createCompletion(options: {
    prompt: string;
    max_tokens?: number;
    temperature?: number;
  }): Promise<{ choices?: Array<{ text?: string; finish_reason?: string | null }> }>;
  exit(): Promise<void>;
}

/**
 * The model the chat's On-device engine holds, shared rather than loaded twice
 * (bonsaiDevice.ts says why). "Loading" means making sure Bonsai is in this
 * browser's storage — from this app's own copy, never from a third party
 * unasked — and then in memory. wllama itself stays a lazy import there.
 */
async function sharedRuntime(): Promise<DeviceRuntime> {
  return {
    loadModelFromUrl: async (_url, params) => {
      const progress = (params as { progressCallback?: (p: { loaded: number; total: number }) => void } | undefined)
        ?.progressCallback;
      const ready = await ensureBonsai({ onProgress: progress });
      if (!ready.ok) throw new Error(ready.error);
      await withBonsai(async () => undefined);
    },
    // As a chat turn, not raw text. The router's prompt is an instruction —
    // "You are the Keeper… Question: …" — and the LAN rungs hand it to
    // runtimes that wrap it in the model's chat template. Sent raw, Bonsai had
    // no end of turn to stop at: asked 3 + 4, it answered 7 and then wrote its
    // own questions and answers until the 512-token cap, twelve minutes on a
    // CPU, all of which came back as the answer.
    createCompletion: async ({ prompt, max_tokens, temperature }) => {
      const reply = await withBonsai((wllama) =>
        wllama.createChatCompletion({
          messages: [{ role: "user", content: prompt }],
          max_tokens,
          temperature,
          chat_template_kwargs: { enable_thinking: false },
          stream: false,
        }),
      );
      return {
        choices: (reply?.choices ?? []).map((c) => ({
          text: typeof c.message?.content === "string" ? c.message.content : "",
          finish_reason: c.finish_reason,
        })),
      };
    },
    exit: () => unloadBonsai(),
  };
}

async function downloadedHere(): Promise<boolean> {
  return (await storedBonsai()).downloaded;
}

/** True when this browser can run WebAssembly at all. Never throws. */
export function wasmSupported(): boolean {
  try {
    return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  } catch {
    return false;
  }
}

/**
 * The on-device engine.
 *
 * One instance holds one loaded model. The load is memoised as a promise rather
 * than a boolean so two questions asked in the same tick share one download
 * instead of starting two.
 */
export function deviceEngine(options: DeviceEngineOptions = {}): InferenceEngine & {
  /** Frees the model and lets the next run load it again. */
  unload(): Promise<void>;
} {
  const weightsPath = options.weightsPath ?? GUIDE_WEIGHTS_PATH;
  const checkWeights = options.checkWeights ?? checkGuideWeights;
  const createRuntime = options.createRuntime ?? sharedRuntime;
  const isDownloaded = options.isDownloaded ?? downloadedHere;

  let runtime: DeviceRuntime | null = null;
  let loading: Promise<DeviceRuntime> | null = null;

  async function load(): Promise<DeviceRuntime> {
    if (runtime) return runtime;
    if (loading) return loading;

    loading = (async () => {
      const instance = await createRuntime();
      await instance.loadModelFromUrl(weightsPath, {
        n_ctx: options.contextSize ?? 2048,
        progressCallback: ({ loaded, total }: { loaded: number; total: number }) =>
          options.onProgress?.({
            loaded,
            total,
            fraction: total > 0 ? loaded / total : null,
          }),
      });
      runtime = instance;
      return instance;
    })();

    try {
      return await loading;
    } catch (error) {
      // A failed load must not poison the engine forever: the usual cause is a
      // clone without its LFS objects, and that is fixed by a command rather
      // than by a reload.
      loading = null;
      throw error;
    }
  }

  return {
    id: "device-wllama",
    name: `On-device (${GUIDANCE_MODEL.name})`,
    locality: "device",

    // Cheap and total: no WebAssembly, or no weights, means no engine. It asks
    // the browser's storage first — a copy the owner downloaded from the chat
    // counts, which on a host that deploys only the LFS pointer is the only
    // copy there is — and then the server how big its file is, so checking
    // costs at most a HEAD request and never a download.
    available: async () => {
      if (!wasmSupported()) return false;
      if (runtime) return true;
      try {
        if (await isDownloaded()) return true;
      } catch {
        /* storage unreadable; the server's copy may still be there */
      }
      try {
        const presence = await checkWeights(fetch, weightsPath);
        return presence.present;
      } catch {
        return false;
      }
    },

    run: async (prompt, model) => {
      const instance = await load();
      const response = await instance.createCompletion({
        prompt,
        max_tokens: 512,
        temperature: 0.7,
      });

      const choice = response?.choices?.[0];
      if (choice?.finish_reason === "content_filter") {
        // Named rather than returned as a short answer, the same way
        // `jackie-stream.ts` treats it: a filtered generation is a refusal, and
        // reporting it as text is how an empty bubble gets saved to history.
        throw new Error(`${GUIDANCE_MODEL.name} stopped: that prompt tripped its content filter.`);
      }

      const answer = (choice?.text ?? "").trim();
      if (!answer) {
        // Rule 8. A model that returned nothing has not answered, and reporting
        // an empty string as success is how a chat comes to show blank replies
        // that nobody can explain.
        throw new Error(
          `${GUIDANCE_MODEL.name} ran on device and produced no text. Try a shorter prompt, or free some memory.`,
        );
      }

      // Always the model that actually ran, never the one that was asked for.
      // This engine serves the weights the app ships and nothing else, so
      // echoing `model` back would be a claim it cannot support.
      if (model && model !== GUIDANCE_MODEL.id) {
        console.info(
          `[device] asked for ${model}; this rung serves ${GUIDANCE_MODEL.id}, which is the model that answered.`,
        );
      }
      return { text: answer, model: GUIDANCE_MODEL.id };
    },

    unload: async () => {
      const instance = runtime;
      runtime = null;
      loading = null;
      if (instance) await instance.exit();
    },
  };
}
