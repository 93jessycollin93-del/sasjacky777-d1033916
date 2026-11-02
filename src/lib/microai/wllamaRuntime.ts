/**
 * One way to start llama.cpp in the tab, for every engine that runs a GGUF here.
 *
 * The import is dynamic because the static one put the library and its 8 MB
 * WebAssembly binary into the main bundle — paid for by every visitor to every
 * route, including the ones who never ask a question, and including the ones on
 * a phone. Nothing about running a model on the device should cost anything
 * until it answers.
 */
import type { ModelManager, Wllama } from "@wllama/wllama";

export type WllamaModule = typeof import("@wllama/wllama");

export function loadWllamaModule(): Promise<WllamaModule> {
  return import("@wllama/wllama");
}

export async function createWllama(options: { modelManager?: ModelManager } = {}): Promise<Wllama> {
  const { Wllama: WllamaClass } = await loadWllamaModule();
  // Vite fingerprints this and emits it as a build asset, so the binary is
  // served from this origin like everything else. The alternative wllama offers
  // is a CDN, which would make the offline-first engine depend on a third party
  // being reachable — the one thing this ladder exists to avoid.
  const { default: wasmUrl } = await import("@wllama/wllama/esm/wasm/wllama.wasm?url");
  const wllama = new WllamaClass(
    // The key has to be exactly "wllama.wasm": wllama throws
    // `"wllama.wasm" is missing in pathConfig` without it, and its `locateFile`
    // returns `pathConfig[filename]` with no fallback, so `default` alone does
    // not satisfy it. The shipped `AssetsPathConfig` type declares neither —
    // it still describes the old single-thread/multi-thread split — so the cast
    // is against a stale declaration, not against the runtime.
    { "wllama.wasm": wasmUrl, default: wasmUrl } as unknown as ConstructorParameters<typeof WllamaClass>[0],
    {
      suppressNativeLog: true,
      // Answer from the cached weights when the network is gone. Without this
      // the engine that exists to work offline refuses to start offline.
      allowOffline: true,
      ...(options.modelManager ? { modelManager: options.modelManager } : {}),
    },
  );
  // wllama's constructor opts every browser without JSPI or 64-bit memory into
  // a "compat" build — WebAssembly that suspends with Asyncify and addresses
  // 32-bit memory — and by default fetches it from cdn.jsdelivr.net at load
  // time: code from a third party, run with the owner's persona and memory in
  // the same tab. It is served from this origin instead, from the
  // @wllama/wllama-compat package pinned to the same version. Turning compat
  // off altogether, as this did at first, left every iPhone without Bonsai:
  // Safari has neither feature, and on iOS Chrome, Edge and Firefox are all
  // Safari underneath.
  if (needsCompatBuild()) {
    const [{ default: compatWasm }, { default: compatWorker }] = await Promise.all([
      import("@wllama/wllama-compat/wasm/wllama.wasm?url"),
      // ?raw, not ?url: wllama starts the worker from the code itself.
      import("@wllama/wllama-compat/wasm/wllama.js?raw"),
    ]);
    wllama.setCompat({ wasm: compatWasm, worker: { code: compatWorker } } as unknown as Parameters<
      typeof wllama.setCompat
    >[0]);
  } else {
    wllama.setCompat(null);
  }
  return wllama;
}

function hasMemory64(): boolean {
  try {
    new WebAssembly.Memory({ address: "i64", initial: BigInt(1) } as unknown as WebAssembly.MemoryDescriptor);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this browser needs the compat build: no JSPI or no 64-bit memory.
 * The same test wllama makes, so the two agree on which build runs. Safari,
 * every iOS browser, and Firefox without its JSPI flag.
 */
export function needsCompatBuild(): boolean {
  try {
    return !(WebAssembly as unknown as { Suspending?: unknown }).Suspending || !hasMemory64();
  } catch {
    return true;
  }
}

/**
 * Whether this browser can run Bonsai at all: WebAssembly, in either build.
 * Asked before a 237 MB download rather than after it.
 */
export function supportsDeviceModels(): boolean {
  try {
    return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  } catch {
    return false;
  }
}

/**
 * True when the browser will lend a GPU to WebGPU, which llama.cpp then uses on
 * its own. `navigator.gpu` alone is not enough: headless and blocklisted
 * browsers expose it and then hand out no adapter, and a panel that promised
 * the GPU would leave the person waiting minutes on the CPU with no warning.
 */
export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (globalThis.navigator as { gpu?: { requestAdapter(): Promise<unknown> } } | undefined)?.gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
