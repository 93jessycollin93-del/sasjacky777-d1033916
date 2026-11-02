import { describe, expect, it, vi } from "vitest";
import { deviceEngine, wasmSupported, type DeviceRuntime } from "@/lib/microai/deviceEngine";
import { GUIDANCE_MODEL } from "@/lib/microai/models";

/**
 * The `device` rung.
 *
 * `contextRouter.ts` promised an offline-first ladder — device, then LAN, then
 * network — and only the LAN rungs existed. The Keeper router, whose entire
 * contract is `ladder: ["device"]` because vault context must never leave the
 * machine, therefore had no engine at all and could not answer a single
 * question.
 *
 * These cover the rung itself: that it stays cheap until asked, that it refuses
 * honestly when it cannot run, and that it never claims to have answered when
 * it has not.
 */

function fakeRuntime(overrides: Partial<DeviceRuntime> = {}) {
  const calls = { loads: 0, completions: 0, exits: 0 };
  const runtime: DeviceRuntime = {
    loadModelFromUrl: async () => {
      calls.loads += 1;
    },
    createCompletion: async () => ({ choices: [{ text: " an answer ", finish_reason: "stop" }] }),
    exit: async () => {
      calls.exits += 1;
    },
    ...overrides,
  };
  const wrapped: DeviceRuntime = {
    ...runtime,
    createCompletion: async (options) => {
      calls.completions += 1;
      return runtime.createCompletion(options);
    },
  };
  return { runtime: wrapped, calls };
}

const present = async () => ({ present: true, detail: "248 MB on disk" });
const absent = async () => ({ present: false, detail: "an LFS pointer, not the weights" });
// Nothing in this browser's storage unless a test says otherwise.
const notDownloaded = async () => false;

describe("what it costs before you ask it anything", () => {
  it("does not touch the weights to report that it is available", async () => {
    const { runtime, calls } = fakeRuntime();
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present, createRuntime: async () => runtime });

    expect(await engine.available()).toBe(true);
    // A quarter of a gigabyte is not something to fetch because a page rendered.
    expect(calls.loads).toBe(0);
  });

  it("loads the model once even when two questions arrive together", async () => {
    const { runtime, calls } = fakeRuntime();
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present, createRuntime: async () => runtime });

    await Promise.all([engine.run("first"), engine.run("second")]);

    expect(calls.loads).toBe(1);
    expect(calls.completions).toBe(2);
  });
});

describe("refusing honestly", () => {
  it("is unavailable when the clone has an LFS pointer instead of weights", async () => {
    const { runtime } = fakeRuntime();
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: absent, createRuntime: async () => runtime });
    expect(await engine.available()).toBe(false);
  });

  it("is available from a copy downloaded through the chat, on a host that serves only the pointer", async () => {
    const { runtime, calls } = fakeRuntime();
    const engine = deviceEngine({ isDownloaded: async () => true, checkWeights: absent, createRuntime: async () => runtime });
    expect(await engine.available()).toBe(true);
    expect(calls.loads).toBe(0);
  });

  it("still finds the server's copy when this browser's storage cannot be read", async () => {
    const { runtime } = fakeRuntime();
    const engine = deviceEngine({
      isDownloaded: async () => {
        throw new Error("storage blocked");
      },
      checkWeights: present,
      createRuntime: async () => runtime,
    });
    expect(await engine.available()).toBe(true);
  });

  it("is unavailable rather than throwing when the check itself fails", async () => {
    const { runtime } = fakeRuntime();
    const engine = deviceEngine({
      isDownloaded: notDownloaded,
      checkWeights: async () => {
        throw new Error("offline");
      },
      createRuntime: async () => runtime,
    });
    // The interface says `available` must not throw: the ladder calls it on
    // every rung, and one rung throwing would take the whole route down.
    await expect(engine.available()).resolves.toBe(false);
  });

  it("treats an empty generation as a failure, not as an answer", async () => {
    const { runtime } = fakeRuntime({
      createCompletion: async () => ({ choices: [{ text: "   ", finish_reason: "stop" }] }),
    });
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present, createRuntime: async () => runtime });

    await expect(engine.run("hello")).rejects.toThrow(/produced no text/);
  });

  it("says so when the generation was filtered", async () => {
    const { runtime } = fakeRuntime({
      createCompletion: async () => ({ choices: [{ text: "", finish_reason: "content_filter" }] }),
    });
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present, createRuntime: async () => runtime });

    await expect(engine.run("hello")).rejects.toThrow(/content filter/);
  });

  it("lets the next run retry after a failed load", async () => {
    let attempt = 0;
    const engine = deviceEngine({
      isDownloaded: notDownloaded,
      checkWeights: present,
      createRuntime: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("git lfs pull");
        return fakeRuntime().runtime;
      },
    });

    // The usual cause of a failed load is a clone without its LFS objects,
    // which is fixed by a command rather than by reloading the page.
    await expect(engine.run("hello")).rejects.toThrow(/git lfs pull/);
    await expect(engine.run("hello")).resolves.toMatchObject({ text: "an answer" });
  });
});

describe("what it reports", () => {
  it("names the model that actually ran, not the one that was asked for", async () => {
    const { runtime } = fakeRuntime();
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present, createRuntime: async () => runtime });
    vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await engine.run("hello", "llama3.3:70b");

    // This rung serves the weights the app ships and nothing else. Echoing the
    // request back would be a claim it cannot support.
    expect(result.model).toBe(GUIDANCE_MODEL.id);
  });

  it("sits on the device rung, which is what puts it first in the ladder", () => {
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present });
    expect(engine.locality).toBe("device");
    expect(engine.name).toContain(GUIDANCE_MODEL.name);
  });

  it("reports load progress as a fraction the UI can show", async () => {
    const seen: Array<number | null> = [];
    const { runtime } = fakeRuntime({
      loadModelFromUrl: async (_url, params) => {
        const cb = (params as { progressCallback?: (p: { loaded: number; total: number }) => void })
          ?.progressCallback;
        cb?.({ loaded: 124_151_136, total: 248_302_272 });
        cb?.({ loaded: 248_302_272, total: 0 });
      },
    });
    const engine = deviceEngine({
      isDownloaded: notDownloaded,
      checkWeights: present,
      createRuntime: async () => runtime,
      onProgress: (p) => seen.push(p.fraction),
    });

    await engine.run("hello");

    // A size the server never reported is null, not a made-up 100%.
    expect(seen).toEqual([0.5, null]);
  });
});

describe("unloading", () => {
  it("frees the model and loads it again on the next run", async () => {
    const { runtime, calls } = fakeRuntime();
    const engine = deviceEngine({ isDownloaded: notDownloaded, checkWeights: present, createRuntime: async () => runtime });

    await engine.run("hello");
    await engine.unload();
    await engine.run("hello again");

    expect(calls.exits).toBe(1);
    expect(calls.loads).toBe(2);
  });
});

describe("wasmSupported", () => {
  it("is true in an environment that has WebAssembly", () => {
    expect(wasmSupported()).toBe(true);
  });
});
