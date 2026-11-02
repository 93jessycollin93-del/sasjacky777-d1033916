import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Which llama.cpp build a browser gets, and where it comes from.
 *
 * Safari has neither JSPI nor 64-bit WebAssembly memory, and on an iPhone
 * Chrome, Edge and Firefox are all Safari underneath. With wllama's
 * compatibility build switched off, every iPhone was told to "use Chrome" —
 * which on an iPhone is the same engine. It is on now, and served from this
 * app rather than from the CDN wllama would otherwise fetch it from.
 */

const compatCalls: unknown[] = [];

vi.mock("@wllama/wllama", () => ({
  Wllama: class {
    setCompat(compat: unknown) {
      compatCalls.push(compat);
    }
  },
}));

const { createWllama, needsCompatBuild, supportsDeviceModels } = await import("@/lib/microai/wllamaRuntime");

/** A browser with both features the default build needs, as current Chrome has. */
function modernWebAssembly() {
  vi.stubGlobal("WebAssembly", {
    Suspending: function Suspending() {},
    Memory: function Memory() {},
    instantiate: WebAssembly.instantiate,
  });
}

/** Safari's: WebAssembly, but no JSPI and no 64-bit memory. */
function safariWebAssembly() {
  vi.stubGlobal("WebAssembly", {
    Memory: function Memory(descriptor: { address?: string }) {
      if (descriptor?.address === "i64") throw new TypeError("memory64 is not supported");
    },
    instantiate: WebAssembly.instantiate,
  });
}

describe("which build a browser runs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    compatCalls.length = 0;
  });

  it("counts Safari as able to run Bonsai, through the compatibility build", () => {
    safariWebAssembly();
    expect(supportsDeviceModels()).toBe(true);
    expect(needsCompatBuild()).toBe(true);
  });

  it("serves Safari the compatibility build from this app, never from a CDN", async () => {
    safariWebAssembly();
    await createWllama();
    expect(compatCalls).toHaveLength(1);
    const compat = compatCalls[0] as { wasm: string; worker: { code: string } };
    expect(compat.wasm).not.toMatch(/^https?:/);
    expect(compat.wasm).toContain("wllama");
    expect(compat.worker.code.length).toBeGreaterThan(10_000);
    expect(JSON.stringify(compat)).not.toContain("jsdelivr");
  });

  it("gives a browser with JSPI and 64-bit memory the fast build and no compat at all", async () => {
    modernWebAssembly();
    expect(needsCompatBuild()).toBe(false);
    await createWllama();
    expect(compatCalls).toEqual([null]);
  });

  it("refuses only a browser with no WebAssembly", () => {
    vi.stubGlobal("WebAssembly", undefined);
    expect(supportsDeviceModels()).toBe(false);
  });
});

describe("the compatibility build's version", () => {
  it("is pinned to exactly the runtime's version, so the worker and the library agree", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const runtime = JSON.parse(readFileSync("node_modules/@wllama/wllama/package.json", "utf8")).version;
    const compat = JSON.parse(readFileSync("node_modules/@wllama/wllama-compat/package.json", "utf8")).version;
    expect(pkg.dependencies["@wllama/wllama-compat"]).toBe(compat);
    expect(compat).toBe(runtime);
  });
});
