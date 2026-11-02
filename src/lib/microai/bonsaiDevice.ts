/**
 * Language models downloaded into this browser and run here: Bonsai, and the
 * download queue's chat models (`deviceModels.ts` lists them).
 *
 * PocketPal's idea — pick a small model, download it once, chat with it on the
 * device — for the web app. PocketPal itself is a React Native app built on
 * llama.rn and cannot be embedded in a web page; what it does can be, because
 * wllama is the same llama.cpp compiled to WebAssembly, and llama.cpp reads
 * Bonsai's 1-bit Q1_0 GGUF, and the others' Q4_K_M, as they are.
 *
 * ## Which bytes
 *
 * Bonsai's are exactly the ones the repository's LFS pointer names: one
 * SHA-256, one size. The file comes from this app's own origin when the host
 * serves the real weights, and otherwise from Hugging Face — but only the
 * listing whose SHA-256 is that one, at the commit the listing reports, and
 * only kept if the size that arrived is the size pinned here. A newer upload
 * under the same name is a different model, and running it as Jackie would be
 * the quiet substitution every other part of the chat goes out of its way to
 * report.
 *
 * The queue's models are resolved on the device instead (`deviceModels.ts`
 * says why): a named repository, a named quantization, the listed commit, the
 * listed size.
 *
 * ## Where they live
 *
 * wllama's cache (the origin-private file system), so they survive reloads and
 * load without the network. A download asks the browser to keep it — a file
 * this size is the first thing a browser evicts when storage runs low — and
 * Remove deletes it, so nothing about a model is a mystery to the person whose
 * disk it is on. One model is in memory at a time: switching unloads the last.
 *
 * The chat is not offline, though: each answer first fetches Jackie's persona
 * from `jackie-device` (see jackie-router's askDevice), because the persona is
 * kept out of the bundle. What stays here is the question and the thinking.
 */
import type { ModelManager, Wllama } from "@wllama/wllama";
import {
  BONSAI_ID,
  chooseGguf,
  DEVICE_MODELS,
  deviceModelOrDefault,
  HF,
  isModelUrl,
  type DeviceModelSpec,
  type ListedFile,
} from "./deviceModels";
import { createWllama, hasWebGpu, loadWllamaModule, needsCompatBuild, supportsDeviceModels } from "./wllamaRuntime";

const BONSAI = deviceModelOrDefault(BONSAI_ID);

/** The build Jackie runs: what public/models/bonsai-1.7b/bonsai-1.7b.gguf's LFS pointer names. */
export const BONSAI_SHA256 = BONSAI.pinned!.sha256;
export const BONSAI_BYTES = BONSAI.pinned!.bytes;
export const BONSAI_MB = Math.round(BONSAI_BYTES / (1024 * 1024));

/**
 * The window every model is loaded with. For Bonsai each token of it costs
 * about 112 KB on top of the weights, so 4,096 is roughly 460 MB — what a
 * laptop and a recent phone can spare. Jackie's persona is about 1,300 of them.
 */
export const DEVICE_CONTEXT_TOKENS = 4096;
export const DEVICE_MAX_ANSWER_TOKENS = 512;
/** Memory context sent with the persona. The tail is kept, as everywhere else. */
export const DEVICE_CONTEXT_CHARS = 2000;

export const UNSUPPORTED_BROWSER = "This browser cannot run WebAssembly, which on-device models need to run here.";

export function notDownloaded(spec: DeviceModelSpec): string {
  return `${spec.name} is not on this device yet. Choose On-device in the engine menu, pick it, and download it (${spec.note.split(" · ")[0]}, once).`;
}

/** Kept for the Guide and older callers: the not-downloaded line for Bonsai. */
export const NOT_DOWNLOADED = notDownloaded(BONSAI);

/** For callers that may fetch only from this app, never from a third party unasked. */
export const NOT_ON_THIS_HOST =
  `This host serves only the LFS pointer for Bonsai, not the weights. Download it once from the chat (On-device engine), or run git lfs pull on a self-hosted copy.`;

/** Shaped like appActions' ActionResult, so `.error` reads without narrowing in this non-strict build. */
export type Verdict<T extends object = object> =
  | ({ ok: true; error?: undefined; aborted?: undefined } & T)
  | { ok: false; error: string; aborted?: boolean };

export interface ModelSource {
  url: string;
  from: "this app" | "Hugging Face";
  /** The size the source listed, which the download must match. */
  bytes?: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Where to download a model from. Never throws.
 *
 * A pinned model tries the app's own copy first: no third party, and on a
 * self-hosted rig the fastest link there is. It counts only at the exact pinned
 * size — a pointer file is 134 bytes, and a different build is a different
 * number. Hugging Face is asked next; for a pinned model only the file with the
 * pinned SHA-256 will do.
 */
export async function resolveModelSource(
  spec: DeviceModelSpec,
  fetchImpl: typeof fetch = fetch,
  origin: string = globalThis.location?.origin ?? "http://localhost",
  { ownOriginOnly = false }: { ownOriginOnly?: boolean } = {},
): Promise<Verdict<{ source: ModelSource }>> {
  if (spec.pinned) {
    try {
      const head = await fetchImpl(spec.pinned.ownPath, { method: "HEAD" });
      if (head.ok && Number(head.headers.get("content-length")) === spec.pinned.bytes) {
        return {
          ok: true,
          source: { url: new URL(spec.pinned.ownPath, origin).href, from: "this app", bytes: spec.pinned.bytes },
        };
      }
    } catch {
      /* not served here; Hugging Face is the other source */
    }
  }
  if (ownOriginOnly) return { ok: false, error: NOT_ON_THIS_HOST };

  const misses: string[] = [];
  for (const repo of spec.repos) {
    let listing: { sha?: unknown; siblings?: unknown } | null;
    try {
      const res = await fetchImpl(`${HF}/api/models/${repo}?blobs=true`);
      if (!res.ok) {
        misses.push(`${repo} answered HTTP ${res.status}`);
        continue;
      }
      listing = await res.json();
    } catch (e) {
      return {
        ok: false,
        error: `Could not reach Hugging Face to download ${spec.name} (${message(e)}). The first download needs a connection.`,
      };
    }

    const siblings = Array.isArray(listing?.siblings) ? (listing.siblings as ListedFile[]) : [];
    let chosen: { file: string; bytes?: number } | null;
    if (spec.pinned) {
      const pin = spec.pinned;
      const match = siblings.find(
        (s) => typeof s?.rfilename === "string" && /\.gguf$/i.test(s.rfilename) && (s.lfs?.sha256 ?? s.lfs?.oid) === pin.sha256,
      );
      chosen = match ? { file: match.rfilename as string, bytes: pin.bytes } : null;
      if (!chosen) {
        misses.push(`${repo} no longer lists the build Jackie pins (sha256 ${pin.sha256.slice(0, 12)}…)`);
        continue;
      }
    } else {
      chosen = chooseGguf(siblings, spec.quants);
      if (!chosen) {
        misses.push(`${repo} lists no single-file GGUF in ${spec.quants.map((q) => q.toUpperCase()).join(", ")}`);
        continue;
      }
    }
    // The commit the listing came from, so the file fetched is the file that
    // was listed even if the repository moves on in between.
    const revision = typeof listing?.sha === "string" && /^[0-9a-f]{40}$/.test(listing.sha) ? listing.sha : "main";
    const path = chosen.file.split("/").map(encodeURIComponent).join("/");
    return {
      ok: true,
      source: { url: `${HF}/${repo}/resolve/${revision}/${path}`, from: "Hugging Face", ...(chosen.bytes ? { bytes: chosen.bytes } : {}) },
    };
  }
  return { ok: false, error: `${spec.name} could not be downloaded: ${misses.join("; ")}. Nothing was downloaded.` };
}

/** Bonsai's source, for callers that only ever wanted Bonsai. */
export function resolveBonsaiSource(
  fetchImpl: typeof fetch = fetch,
  origin: string = globalThis.location?.origin ?? "http://localhost",
  opts: { ownOriginOnly?: boolean } = {},
) {
  return resolveModelSource(BONSAI, fetchImpl, origin, opts);
}

let managerPromise: Promise<ModelManager> | null = null;

function manager(): Promise<ModelManager> {
  // A chunk that failed to load (a deploy landed mid-session, the network
  // blinked) must not be remembered: the next press should try again.
  managerPromise ??= loadWllamaModule()
    .then(({ ModelManager }) => new ModelManager({ allowOffline: true }))
    .catch((e) => {
      managerPromise = null;
      throw e;
    });
  return managerPromise;
}

export interface DeviceModelStatus {
  supported: boolean;
  downloaded: boolean;
  /** A copy is stored but incomplete or the wrong size; Remove clears it. */
  partial: boolean;
  gpu: boolean;
  /** Runs wllama's slower compatibility build: Safari, every iOS browser. */
  compat: boolean;
  error?: string;
}

export type StoredModel = Omit<DeviceModelStatus, "gpu" | "compat">;

type CachedModel = Awaited<ReturnType<ModelManager["getModels"]>>[number];

function isComplete(spec: DeviceModelSpec, model: CachedModel): boolean {
  return model.validate() === "valid" && (!spec.pinned || model.size === spec.pinned.bytes);
}

/**
 * Whether this browser can run a model and has it stored. Reads the cache,
 * never the network, and leaves the GPU alone: the Guide's ladder asks this
 * on every route, and asking for a WebGPU adapter is not free.
 */
export async function storedModel(id: string): Promise<StoredModel> {
  const spec = deviceModelOrDefault(id);
  if (!supportsDeviceModels()) return { supported: false, downloaded: false, partial: false };
  try {
    const all = (await (await manager()).getModels({ includeInvalid: true })).filter((m) => isModelUrl(spec, m.url));
    const ready = all.some((m) => isComplete(spec, m));
    return { supported: true, downloaded: ready, partial: !ready && all.length > 0 };
  } catch (e) {
    return { supported: true, downloaded: false, partial: false, error: `Could not read this browser's model storage: ${message(e)}` };
  }
}

/** Everything the panel shows: what is stored, and whether a GPU will run it. */
export async function deviceModelStatus(id: string): Promise<DeviceModelStatus> {
  const [stored, gpu] = await Promise.all([storedModel(id), hasWebGpu()]);
  return { ...stored, gpu, compat: needsCompatBuild() };
}

/** Which models are stored in this browser, complete, and how big. */
export async function storedModels(): Promise<Array<{ id: string; bytes: number }>> {
  if (!supportsDeviceModels()) return [];
  try {
    const all = await (await manager()).getModels({ includeInvalid: true });
    return DEVICE_MODELS.flatMap((spec) => {
      const hit = all.find((m) => isModelUrl(spec, m.url) && isComplete(spec, m));
      return hit ? [{ id: spec.id, bytes: hit.size }] : [];
    });
  } catch {
    return [];
  }
}

export interface DownloadProgress {
  loaded: number;
  total: number;
}

interface DownloadJob {
  modelId: string;
  progress: DownloadProgress;
  controller: AbortController;
  listeners: Set<(p: DownloadProgress) => void>;
  result: Promise<Verdict<{ from: ModelSource["from"] }>>;
}

/**
 * The download in flight, if any. One per tab, owned by this module rather
 * than by whichever panel started it: a 237 MB download tied to a component
 * was cancelled by switching engine for a moment, and two panels pressing
 * Download wrote the same file twice at once. One at a time across models,
 * too: two downloads at once halve each other's speed and double the chance
 * the browser runs out of room for both.
 */
let job: DownloadJob | null = null;

/** The download in flight, or null when none is. */
export function deviceDownloadInProgress(): ({ modelId: string } & DownloadProgress) | null {
  return job ? { modelId: job.modelId, ...job.progress } : null;
}

/** Cancels the download in flight. What arrived is deleted. */
export function stopDeviceDownload(): void {
  job?.controller.abort();
}

/**
 * Downloads a model, or joins its download if it is already running.
 *
 * `onProgress` hears the shared download, from where it has got to. `signal`
 * cancels it for everyone, which is what a Stop button means. A caller that
 * merely goes away — a panel unmounting — should pass neither and let it run.
 * Asking for a different model while one downloads is refused, by name.
 */
export function downloadDeviceModel(
  id: string,
  opts: {
    onProgress?: (p: DownloadProgress) => void;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    /** Fetch only from this app, never from Hugging Face. Ignored when joining a download. */
    ownOriginOnly?: boolean;
  } = {},
): Promise<Verdict<{ from: ModelSource["from"] }>> {
  const spec = deviceModelOrDefault(id);
  if (job && job.modelId !== spec.id) {
    const busy = deviceModelOrDefault(job.modelId).name;
    return Promise.resolve({ ok: false, error: `${busy} is downloading. Wait for it to finish, or stop it, then download ${spec.name}.` });
  }
  if (!job) {
    const controller = new AbortController();
    const current: DownloadJob = {
      modelId: spec.id,
      progress: { loaded: 0, total: spec.pinned?.bytes ?? spec.approxMB * 1024 * 1024 },
      controller,
      listeners: new Set(),
      result: Promise.resolve({ ok: false, error: "not started" }),
    };
    current.result = runDownload(spec, {
      fetchImpl: opts.fetchImpl,
      ownOriginOnly: opts.ownOriginOnly,
      signal: controller.signal,
      onProgress: (p) => {
        current.progress = p;
        for (const listener of current.listeners) listener(p);
      },
    }).finally(() => {
      if (job === current) job = null;
    });
    job = current;
  }
  const active = job;
  const { onProgress, signal } = opts;
  if (onProgress) {
    active.listeners.add(onProgress);
    onProgress({ ...active.progress });
  }
  if (signal) {
    if (signal.aborted) active.controller.abort();
    else signal.addEventListener("abort", () => active.controller.abort(), { once: true });
  }
  return active.result.finally(() => {
    if (onProgress) active.listeners.delete(onProgress);
  });
}

async function runDownload(
  spec: DeviceModelSpec,
  opts: {
    onProgress: (p: DownloadProgress) => void;
    signal: AbortSignal;
    fetchImpl?: typeof fetch;
    ownOriginOnly?: boolean;
  },
): Promise<Verdict<{ from: ModelSource["from"] }>> {
  if (!supportsDeviceModels()) return { ok: false, error: UNSUPPORTED_BROWSER };
  const resolved = await resolveModelSource(spec, opts.fetchImpl, undefined, { ownOriginOnly: opts.ownOriginOnly });
  if (resolved.ok === false) return { ok: false, error: resolved.error };
  const expected = resolved.source.bytes;

  // Best effort: without it the browser may evict the model the next time
  // storage runs low, and the next question finds it gone.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* refused or unsupported; the download still works */
  }

  let mm: ModelManager;
  try {
    mm = await manager();
  } catch (e) {
    return { ok: false, error: `The model runtime did not load: ${message(e)}` };
  }
  // wllama closes the file when a download breaks, so a stopped one leaves
  // its bytes on disk with no record of what they are: invisible to Remove,
  // and never reclaimed if the next download comes from a different URL.
  const discardPartial = () => mm.cacheManager.delete(resolved.source.url).catch(() => undefined);
  try {
    const model = await mm.downloadModel(resolved.source.url, {
      progressCallback: ({ loaded, total }) => opts.onProgress({ loaded, total: total || expected || loaded }),
      signal: opts.signal,
    });
    if (expected && model.size !== expected) {
      await model.remove().catch(() => undefined);
      return {
        ok: false,
        error: `The download ended at ${model.size.toLocaleString()} bytes, not the ${expected.toLocaleString()} ${spec.name} is, so it was deleted. Try again.`,
      };
    }
    return { ok: true, from: resolved.source.from };
  } catch (e) {
    await discardPartial();
    if (opts.signal.aborted || (e as Error)?.name === "AbortError") {
      return { ok: false, aborted: true, error: "Download stopped, and the part that arrived was deleted." };
    }
    if (/quota/i.test(message(e))) {
      return { ok: false, error: `This browser has no room for ${spec.name} (${spec.note.split(" · ")[0]}). Free some space and try again.` };
    }
    return { ok: false, error: `${spec.name} did not download: ${message(e)}` };
  }
}

/**
 * Bonsai in this browser's storage, fetching it from this app if it is not —
 * never from Hugging Face. For the Guide's device rung, which runs without
 * anyone pressing Download: 237 MB from a third party is the owner's call, and
 * the chat's panel is where they make it.
 */
export async function ensureBonsai(opts: { onProgress?: (p: DownloadProgress) => void } = {}): Promise<Verdict> {
  if (job?.modelId === BONSAI_ID) {
    const joined = await downloadDeviceModel(BONSAI_ID, { onProgress: opts.onProgress });
    return joined.ok ? { ok: true } : { ok: false, error: joined.error };
  }
  const status = await storedModel(BONSAI_ID);
  if (status.downloaded) return { ok: true };
  if (!status.supported) return { ok: false, error: UNSUPPORTED_BROWSER };
  const fetched = await downloadDeviceModel(BONSAI_ID, { onProgress: opts.onProgress, ownOriginOnly: true });
  return fetched.ok ? { ok: true } : { ok: false, error: fetched.error };
}

/** Whether Bonsai is stored here; what the Guide's device rung asks. */
export function storedBonsai(): Promise<StoredModel> {
  return storedModel(BONSAI_ID);
}

/**
 * One loaded model per tab, shared by the chat and the Guide's device rung.
 * Each used to be able to hold its own, and two copies of a model plus two KV
 * caches is more memory than a phone will give a tab. Switching model unloads
 * the last one first, for the same reason.
 */
let session: { id: string; wllama: Promise<Wllama> } | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** One generation at a time on the shared model, in the order asked. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function acquireSession(spec: DeviceModelSpec, onLoading?: () => void): Promise<Wllama> {
  if (session && session.id !== spec.id) await closeSession();
  if (!session) {
    onLoading?.();
    const opening = openSession(spec);
    const current = { id: spec.id, wllama: opening };
    session = current;
    // A failed load is not remembered: the usual cause (not downloaded yet)
    // is fixed by a download, not by a reload.
    opening.catch(() => {
      if (session === current) session = null;
    });
  }
  return session.wllama;
}

async function closeSession(): Promise<void> {
  const current = session;
  session = null;
  if (!current) return;
  try {
    await (await current.wllama).exit();
  } catch {
    /* it never finished loading, so there is nothing to free */
  }
}

/** Runs `fn` against a model, loading it if it is not the one in memory, in turn with every other use. */
export function withDeviceModel<T>(id: string, fn: (wllama: Wllama) => Promise<T>): Promise<T> {
  return serialized(async () => fn(await acquireSession(deviceModelOrDefault(id))));
}

/** Bonsai, for the Guide's device rung. */
export function withBonsai<T>(fn: (wllama: Wllama) => Promise<T>): Promise<T> {
  return withDeviceModel(BONSAI_ID, fn);
}

async function openSession(spec: DeviceModelSpec): Promise<Wllama> {
  const mm = await manager();
  const model = (await mm.getModels()).find((m) => isModelUrl(spec, m.url) && isComplete(spec, m));
  if (!model) throw new Error(notDownloaded(spec));
  const wllama = await createWllama({ modelManager: mm });
  // Every layer goes to WebGPU when the browser has it, and llama.cpp falls
  // back to the CPU on its own when it does not.
  await wllama.loadModel(model, {
    n_ctx: DEVICE_CONTEXT_TOKENS,
    // The compatibility build is what a phone runs, and a phone gives a tab a
    // fraction of a desktop's memory. Keys stored at 8 bits take about a
    // quarter off what the window costs, for a small loss of precision; values
    // stay at 16 because quantizing them needs flash attention.
    ...(needsCompatBuild() ? { cache_type_k: "q8_0" as const } : {}),
  });
  return wllama;
}

/**
 * Frees the memory the loaded model holds. Downloads stay. Waits its turn
 * behind any answer in progress, so it never pulls the model out from under a
 * generation that the chat or the Guide is still reading.
 */
export function unloadDeviceModel(): Promise<void> {
  return serialized(closeSession);
}

/** Kept for the Guide's device rung, whose `unload` frees whatever is loaded. */
export const unloadBonsai = unloadDeviceModel;

export async function removeDeviceModel(id: string): Promise<Verdict> {
  const spec = deviceModelOrDefault(id);
  // A download of it still running would write the file straight back.
  const running = job;
  if (running && running.modelId === spec.id) {
    running.controller.abort();
    await running.result;
  }
  // Only this model leaves memory; another one loaded stays where it is.
  if (session?.id === spec.id) await unloadDeviceModel();
  try {
    const all = (await (await manager()).getModels({ includeInvalid: true })).filter((m) => isModelUrl(spec, m.url));
    for (const model of all) await model.remove();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `${spec.name} could not be removed: ${message(e)}` };
  }
}

export interface DeviceMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * The conversation, cut to what fits beside the system prompt in the window.
 *
 * Oldest turns go first; the question being asked never does. Null when even
 * the system prompt and that question cannot fit, which the caller reports
 * rather than letting llama.cpp refuse it with an error about slots.
 *
 * Counted in characters at 3.5 a token, below the ~4.6 Jackie's persona
 * actually measures, so the estimate errs toward cutting a turn too many.
 */
export function fitToWindow(
  system: string,
  messages: DeviceMessage[],
  windowTokens = DEVICE_CONTEXT_TOKENS,
  answerTokens = DEVICE_MAX_ANSWER_TOKENS,
): DeviceMessage[] | null {
  const budget = (windowTokens - answerTokens) * 3.5 - system.length;
  const kept: DeviceMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = messages[i].content.length + 16; // role markers
    if (used + cost > budget) break;
    kept.unshift(messages[i]);
    used += cost;
  }
  if (!messages.length || kept[kept.length - 1] !== messages[messages.length - 1]) return null;
  // A window that opens on an orphaned reply reads as if Jackie spoke first.
  while (kept.length > 1 && kept[0].role !== "user") kept.shift();
  return kept;
}

interface ChunkLike {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  prompt_progress?: { total: number; cache: number; processed: number };
}

/** What `chatOnDevice` needs from a loaded model. Tests stand in for it. */
export interface DeviceChatRuntime {
  createChatCompletion(options: Record<string, unknown> & { onData: (chunk: ChunkLike) => void }): Promise<unknown>;
}

export interface DeviceChatOptions {
  /** Which model answers. Bonsai when absent or unknown. */
  modelId?: string;
  system: string;
  messages: DeviceMessage[];
  onDelta: (text: string) => void;
  /** A line for the screen while nothing has been written yet; null once text flows. */
  onStatus?: (note: string | null) => void;
  signal?: AbortSignal;
  /** Injected for tests. Real code loads the model. */
  runtime?: () => Promise<DeviceChatRuntime>;
}

/**
 * One answer from a model on this device, streamed. Never throws; one
 * question at a time.
 *
 * The persona is the long part — about 1,300 tokens — and the only slow one on
 * a CPU. `cache_prompt` keeps it in llama.cpp's KV cache between questions, so
 * only the first answer of a session pays for reading it.
 */
export function chatOnDevice(opts: DeviceChatOptions): Promise<Verdict> {
  return serialized(() => answer(opts));
}

async function answer(opts: DeviceChatOptions): Promise<Verdict> {
  const spec = deviceModelOrDefault(opts.modelId);
  const stopped = { ok: false as const, aborted: true, error: "Stopped." };
  if (opts.signal?.aborted) return stopped;

  const fitted = fitToWindow(opts.system, opts.messages);
  if (!fitted) {
    return {
      ok: false,
      error: `Jackie's persona and this message do not fit in the ${DEVICE_CONTEXT_TOKENS.toLocaleString()}-token window ${spec.name} runs with here. Send a shorter message.`,
    };
  }

  let runtime: DeviceChatRuntime;
  try {
    runtime = opts.runtime
      ? await opts.runtime()
      : ((await acquireSession(spec, () => opts.onStatus?.(`Loading ${spec.name} on this device…`))) as unknown as DeviceChatRuntime);
  } catch (e) {
    opts.onStatus?.(null);
    const text = message(e);
    return { ok: false, error: text === notDownloaded(spec) ? text : `${spec.name} could not start on this device: ${text}` };
  }

  let text = "";
  let finish: string | null = null;
  try {
    await runtime.createChatCompletion({
      messages: [{ role: "system", content: opts.system }, ...fitted],
      stream: true,
      max_tokens: DEVICE_MAX_ANSWER_TOKENS,
      temperature: 0.7,
      cache_prompt: true,
      return_progress: true,
      // Qwen-family templates (SmolLM3's too) think aloud first unless told
      // not to; on a model reading at CPU speed, that is minutes of tokens
      // nobody sees. Templates that have no such switch ignore it.
      chat_template_kwargs: { enable_thinking: false },
      abortSignal: opts.signal,
      onData: (chunk: ChunkLike) => {
        const progress = chunk.prompt_progress;
        if (progress && !text && progress.total > 0) {
          const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
          const reused = progress.cache > 0 ? `, ${progress.cache.toLocaleString()} remembered from before` : "";
          opts.onStatus?.(`${spec.name} is reading the conversation — ${pct}% of ${progress.total.toLocaleString()} tokens${reused}`);
        }
        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta?.content;
          if (delta) {
            if (!text) opts.onStatus?.(null);
            text += delta;
            opts.onDelta(delta);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
      },
    });
  } catch (e) {
    opts.onStatus?.(null);
    if (opts.signal?.aborted || (e as Error)?.name === "AbortError") return stopped;
    return { ok: false, error: `${spec.name} stopped partway: ${message(e)}` };
  }
  opts.onStatus?.(null);
  if (opts.signal?.aborted) return stopped;

  if (finish === "content_filter") {
    return { ok: false, error: `${spec.name} stopped: that prompt tripped its content filter.` };
  }
  if (!text.trim()) {
    // Rule 8: a model that wrote nothing has not answered.
    return { ok: false, error: `${spec.name} ran on this device and wrote nothing. Try again, or a shorter message.` };
  }
  return { ok: true };
}
