import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  BONSAI_BYTES,
  BONSAI_MB,
  BONSAI_SHA256,
  deviceDownloadInProgress,
  chatOnDevice,
  downloadDeviceModel,
  fitToWindow,
  NOT_DOWNLOADED,
  NOT_ON_THIS_HOST,
  resolveBonsaiSource,
  type DeviceChatRuntime,
} from "@/lib/microai/bonsaiDevice";
import * as device from "@/lib/microai/bonsaiDevice";
import { GUIDANCE_MODEL } from "@/lib/microai/models";
import { hasWebGpu } from "@/lib/microai/wllamaRuntime";
import { chainFrom, ENGINE_CHAIN, findEngine } from "@/lib/jackie-engines";
import { routeChat } from "@/lib/jackie-router";
import * as edge from "@/lib/edgeFunction";

/**
 * Bonsai 1.7B downloaded into the browser and answering as Jackie from there.
 *
 * What matters is that it runs exactly the build the repository pins, that it
 * never quietly answers as something else — another build, another engine, or
 * an assistant without Jackie's persona — and that a turn that wrote nothing
 * is a failure, not a blank reply.
 */

const ORIGIN = "https://app.example";
const head = (length: number, status = 200) =>
  new Response(null, { status, headers: { "content-length": String(length) } });
const listing = (siblings: unknown[], sha = "a".repeat(40)) =>
  new Response(JSON.stringify({ sha, siblings }), { status: 200 });
const gguf = (rfilename: string, sha256: string) => ({ rfilename, lfs: { sha256, size: BONSAI_BYTES } });

describe("which Bonsai the device downloads", () => {
  it("pins the exact bytes the repository's LFS pointer names", () => {
    // The raw blob is the pointer whether or not LFS has fetched the weights.
    const pointer = execFileSync("git", ["cat-file", "-p", "HEAD:public/models/bonsai-1.7b/bonsai-1.7b.gguf"], {
      encoding: "utf8",
    });
    expect(pointer).toContain(`oid sha256:${BONSAI_SHA256}`);
    expect(pointer).toContain(`size ${BONSAI_BYTES}`);
    expect(BONSAI_MB).toBe(GUIDANCE_MODEL.sizeMB);
  });

  it("takes the app's own copy when the host serves the real weights", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(head(BONSAI_BYTES));
    const r = await resolveBonsaiSource(fetchImpl as unknown as typeof fetch, ORIGIN);
    expect(r).toEqual({
      ok: true,
      source: { url: `${ORIGIN}/models/bonsai-1.7b/bonsai-1.7b.gguf`, from: "this app", bytes: BONSAI_BYTES },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("goes to Hugging Face when the host serves the 134-byte LFS pointer, pinned to the listed commit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(head(134))
      .mockResolvedValueOnce(listing([gguf("Bonsai-1.7B-Q8_0.gguf", "f".repeat(64)), gguf("Bonsai-1.7B.gguf", BONSAI_SHA256)]));
    const r = await resolveBonsaiSource(fetchImpl as unknown as typeof fetch, ORIGIN);
    expect(r).toEqual({
      ok: true,
      source: {
        url: `https://huggingface.co/prism-ml/Bonsai-1.7B-gguf/resolve/${"a".repeat(40)}/Bonsai-1.7B.gguf`,
        from: "Hugging Face",
        bytes: BONSAI_BYTES,
      },
    });
  });

  it("refuses a newer upload under the same name rather than running a different model as Jackie", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(head(0, 404))
      .mockResolvedValueOnce(listing([gguf("Bonsai-1.7B.gguf", "0".repeat(64))]));
    const r = await resolveBonsaiSource(fetchImpl as unknown as typeof fetch, ORIGIN);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no longer lists the build Jackie pins");
  });

  it("says the first download needs a connection when Hugging Face cannot be reached", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const r = await resolveBonsaiSource(fetchImpl as unknown as typeof fetch, ORIGIN);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Could not reach Hugging Face.*needs a connection/);
  });
});

describe("downloading without being asked twice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never reaches Hugging Face for a caller that may only use this app's copy", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(head(134));
    const r = await resolveBonsaiSource(fetchImpl as unknown as typeof fetch, ORIGIN, { ownOriginOnly: true });
    expect(r).toEqual({ ok: false, error: NOT_ON_THIS_HOST });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("joins the download already running rather than starting the same 237 MB again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async (url: string) => {
      await gate;
      return url.startsWith("/") ? head(134) : listing([]);
    });

    const first = downloadDeviceModel("bonsai-1.7b", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const heard: Array<{ loaded: number; total: number }> = [];
    const second = downloadDeviceModel("bonsai-1.7b", { onProgress: (p) => heard.push(p) });
    expect(deviceDownloadInProgress()).toEqual({ modelId: "bonsai-1.7b", loaded: 0, total: BONSAI_BYTES });

    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.error).toContain("no longer lists");
    // One HEAD and one listing between them, not two of each.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(heard[0]).toEqual({ loaded: 0, total: BONSAI_BYTES });
    expect(deviceDownloadInProgress()).toBeNull();
  });
});

describe("fitting a conversation into Bonsai's window", () => {
  const turn = (role: "user" | "assistant", chars: number) => ({ role, content: "x".repeat(chars) });

  it("keeps the whole conversation when it fits", () => {
    const messages = [turn("user", 10), turn("assistant", 10), turn("user", 10)];
    expect(fitToWindow("persona", messages)).toEqual(messages);
  });

  it("drops the oldest turns first and never the question being asked", () => {
    const messages = [turn("user", 6000), turn("assistant", 6000), turn("user", 100), turn("assistant", 100), turn("user", 50)];
    const kept = fitToWindow("p".repeat(1000), messages)!;
    expect(kept[kept.length - 1]).toBe(messages[4]);
    expect(kept).not.toContain(messages[0]);
    expect(kept[0].role).toBe("user");
  });

  it("refuses, rather than truncating, when the question itself cannot fit beside the persona", () => {
    expect(fitToWindow("p".repeat(12_000), [turn("user", 2000)])).toBeNull();
  });
});

function fakeRuntime(chunks: unknown[], opts: { throws?: Error } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const runtime: DeviceChatRuntime = {
    async createChatCompletion(options) {
      calls.push(options);
      for (const chunk of chunks) options.onData(chunk as never);
      if (opts.throws) throw opts.throws;
      return undefined;
    },
  };
  return { calls, runtime: async () => runtime };
}

const delta = (content: string, finish_reason: string | null = null) => ({ choices: [{ delta: { content }, finish_reason }] });

describe("an answer from Bonsai on the device", () => {
  it("streams the answer, reports reading progress first, and keeps the persona cached between questions", async () => {
    const { calls, runtime } = fakeRuntime([
      { choices: [], prompt_progress: { total: 1300, cache: 0, processed: 650 } },
      delta("Jackie "),
      delta("here.", "stop"),
    ]);
    const deltas: string[] = [];
    const notes: Array<string | null> = [];
    const r = await chatOnDevice({
      system: "You are Jackie.",
      messages: [{ role: "user", content: "who are you?" }],
      onDelta: (t) => deltas.push(t),
      onStatus: (n) => notes.push(n),
      runtime,
    });
    expect(r).toEqual({ ok: true });
    expect(deltas.join("")).toBe("Jackie here.");
    expect(notes[0]).toContain("50% of 1,300 tokens");
    expect(notes[notes.length - 1]).toBeNull();
    expect(calls[0]).toMatchObject({ cache_prompt: true, stream: true, chat_template_kwargs: { enable_thinking: false } });
    expect((calls[0].messages as Array<{ role: string }>)[0]).toEqual({ role: "system", content: "You are Jackie." });
  });

  it("treats a turn that wrote nothing as a failure, not a blank answer", async () => {
    const { runtime } = fakeRuntime([delta("", "stop")]);
    const r = await chatOnDevice({ system: "s", messages: [{ role: "user", content: "hi" }], onDelta: () => {}, runtime });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("wrote nothing");
  });

  it("reports a content-filter stop as a refusal", async () => {
    const { runtime } = fakeRuntime([delta("Sorr"), { choices: [{ delta: {}, finish_reason: "content_filter" }] }]);
    const r = await chatOnDevice({ system: "s", messages: [{ role: "user", content: "hi" }], onDelta: () => {}, runtime });
    expect(r.error).toContain("content filter");
  });

  it("calls a stopped answer stopped, not failed", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("Operation aborted"), { name: "AbortError" });
    const { runtime } = fakeRuntime([delta("half")], { throws: abort });
    controller.abort();
    const r = await chatOnDevice({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      onDelta: () => {},
      signal: controller.signal,
      runtime,
    });
    expect(r).toMatchObject({ ok: false, aborted: true });
  });

  it("answers one question at a time, so two sends cannot interleave tokens", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: DeviceChatRuntime = {
      async createChatCompletion(o) {
        order.push("first:start");
        await gate;
        o.onData(delta("a"));
        order.push("first:end");
      },
    };
    const quick: DeviceChatRuntime = {
      async createChatCompletion(o) {
        order.push("second");
        o.onData(delta("b"));
      },
    };
    const base = { system: "s", messages: [{ role: "user" as const, content: "hi" }], onDelta: () => {} };
    const first = chatOnDevice({ ...base, runtime: async () => slow });
    const second = chatOnDevice({ ...base, runtime: async () => quick });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});

describe("telling GPU from CPU before the download", () => {
  afterEach(() => {
    delete (navigator as { gpu?: unknown }).gpu;
  });
  const lend = (adapter: unknown) =>
    Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => adapter }, configurable: true });

  it("does not promise the GPU when the browser exposes WebGPU but lends no adapter", async () => {
    lend(null);
    expect(await hasWebGpu()).toBe(false);
  });

  it("reports the GPU when an adapter is actually handed out", async () => {
    lend({ name: "gpu" });
    expect(await hasWebGpu()).toBe(true);
  });
});

describe("On-device in the chat's engine list", () => {
  it("is offered, but never joins the fallback chain in either direction", () => {
    expect(findEngine("device")?.kind).toBe("device");
    expect(ENGINE_CHAIN).not.toContain("device");
    expect(chainFrom("device")).toEqual(["device"]);
    expect(chainFrom("jacky")).not.toContain("device");
  });
});

describe("routing a question to the device", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const ready = { supported: true, downloaded: true, partial: false };
  const ask = [{ role: "user" as const, content: "hi" }];

  function collect() {
    const out = { text: "", errors: [] as string[], done: null as null | { engine: string; model?: string } };
    return {
      out,
      handlers: {
        onDelta: (t: string) => (out.text += t),
        onError: (e: string) => out.errors.push(e),
        onDone: (r: { engine: string; model?: string }) => (out.done = r),
      },
    };
  }

  it("answers with the persona jackie-device built, sending it the memory context and not the conversation", async () => {
    vi.spyOn(device, "storedModel").mockResolvedValue(ready);
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValue(new Response(JSON.stringify({ prompt: "You are Jackie. (guarded)", mode: "persona" }), { status: 200 }));
    const chat = vi.spyOn(device, "chatOnDevice").mockImplementation(async (o) => {
      o.onDelta("on device");
      return { ok: true };
    });
    const c = collect();
    await routeChat({ messages: ask, engine: "device", context: "memory: likes tea", ...c.handlers });

    expect(call.mock.calls[0][0]).toBe("jackie-device");
    expect(call.mock.calls[0][1]).toEqual({ context: "memory: likes tea" });
    expect(chat.mock.calls[0][0].system).toBe("You are Jackie. (guarded)");
    expect(c.out.text).toBe("on device");
    expect(c.out.done).toMatchObject({ engine: "device", model: "bonsai-1.7b" });
  });

  it("does not answer at all, rather than as an anonymous assistant, when the persona cannot be fetched", async () => {
    vi.spyOn(device, "storedModel").mockResolvedValue(ready);
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const chat = vi.spyOn(device, "chatOnDevice");
    const c = collect();
    await routeChat({ messages: ask, engine: "device", ...c.handlers });

    expect(chat).not.toHaveBeenCalled();
    expect(c.out.errors[0]).toContain("persona could not be fetched");
    expect(c.out.done).toBeNull();
  });

  it("tells a non-owner account why, instead of a bare 403", async () => {
    vi.spyOn(device, "storedModel").mockResolvedValue(ready);
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    const c = collect();
    await routeChat({ messages: ask, engine: "device", ...c.handlers });
    expect(c.out.errors[0]).toContain("only the owner's account");
  });

  it("says how to download Bonsai when it is not on this device, and asks no other engine", async () => {
    vi.spyOn(device, "storedModel").mockResolvedValue({ ...ready, downloaded: false });
    const call = vi.spyOn(edge, "callEdgeFunction");
    const c = collect();
    await routeChat({ messages: ask, engine: "device", ...c.handlers });

    expect(call).not.toHaveBeenCalled();
    expect(c.out.errors).toEqual([NOT_DOWNLOADED]);
  });
});
