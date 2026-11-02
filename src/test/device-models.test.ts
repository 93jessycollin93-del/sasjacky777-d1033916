import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseGguf,
  DEVICE_MODELS,
  deviceModelOrDefault,
  findDeviceModel,
  isModelUrl,
} from "@/lib/microai/deviceModels";
import * as device from "@/lib/microai/bonsaiDevice";
import { downloadDeviceModel, resolveModelSource } from "@/lib/microai/bonsaiDevice";
import { findEngine } from "@/lib/jackie-engines";
import { routeChat } from "@/lib/jackie-router";
import * as edge from "@/lib/edgeFunction";

/**
 * The download queue's chat models on the On-device engine.
 *
 * Bonsai is pinned byte for byte; these are resolved on the device, so what
 * matters is that the choice is narrow and stated: a named repository, a named
 * quantization, one file, the listed commit and the listed size — and that a
 * model picked in the menu is the model that answers, and is reported as such.
 */

const file = (rfilename: string, size = 400_000_000) => ({ rfilename, lfs: { sha256: "a".repeat(64), size } });
const listing = (siblings: unknown[], sha = "b".repeat(40)) => new Response(JSON.stringify({ sha, siblings }), { status: 200 });
const qwen = findDeviceModel("qwen2.5-0.5b-instruct")!;

describe("which file a model is downloaded as", () => {
  it("takes Q4_K_M when a repository has it, whatever else it lists", () => {
    const picked = chooseGguf(
      [file("qwen2.5-0.5b-instruct-fp16.gguf"), file("qwen2.5-0.5b-instruct-q8_0.gguf"), file("qwen2.5-0.5b-instruct-q4_k_m.gguf", 491_000_000)],
      ["q4_k_m", "q4_0", "q5_k_m", "q8_0"],
    );
    expect(picked).toEqual({ file: "qwen2.5-0.5b-instruct-q4_k_m.gguf", bytes: 491_000_000 });
  });

  it("falls back to the next quantization a publisher ships, in the stated order", () => {
    expect(chooseGguf([file("smollm2-360m-instruct-q8_0.gguf")], ["q4_k_m", "q4_0", "q5_k_m", "q8_0"])?.file).toBe(
      "smollm2-360m-instruct-q8_0.gguf",
    );
  });

  it("never takes a vision projector, one shard of a split model, or ARM's Q4_0 repack as Q4_0", () => {
    expect(
      chooseGguf(
        [file("model-mmproj-q4_0.gguf"), file("model-q4_0-00001-of-00002.gguf"), file("Model-Q4_0_4_4.gguf")],
        ["q4_0"],
      ),
    ).toBeNull();
  });

  it("matches the tag whatever case the publisher used", () => {
    expect(chooseGguf([file("Phi-3.5-mini-instruct-Q4_K_M.gguf")], ["q4_k_m"])?.file).toBe("Phi-3.5-mini-instruct-Q4_K_M.gguf");
  });
});

describe("where an unpinned model comes from", () => {
  it("tries the official repository first and a listed mirror after it, pinned to the commit it listed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(listing([file("Qwen2.5-0.5B-Instruct-Q4_K_M.gguf", 397_808_192)]));
    const r = await resolveModelSource(qwen, fetchImpl as unknown as typeof fetch, "https://app.example");
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      "https://huggingface.co/api/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF?blobs=true",
      "https://huggingface.co/api/models/bartowski/Qwen2.5-0.5B-Instruct-GGUF?blobs=true",
    ]);
    expect(r).toEqual({
      ok: true,
      source: {
        url: `https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/${"b".repeat(40)}/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf`,
        from: "Hugging Face",
        bytes: 397_808_192,
      },
    });
  });

  it("says which repositories it tried and which builds it looked for when none fits", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => listing([file("model-f16.gguf")]));
    const r = await resolveModelSource(qwen, fetchImpl as unknown as typeof fetch, "https://app.example");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Qwen/Qwen2.5-0.5B-Instruct-GGUF lists no single-file GGUF in Q4_K_M, Q4_0, Q5_K_M, Q8_0");
    expect(r.error).toContain("bartowski/Qwen2.5-0.5B-Instruct-GGUF");
    expect(r.error).toContain("Nothing was downloaded");
  });

  it("never asks this app's host for a model it does not ship", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(listing([file("x-q4_k_m.gguf")]));
    await resolveModelSource(qwen, fetchImpl as unknown as typeof fetch, "https://app.example");
    expect(fetchImpl.mock.calls.every((c) => String(c[0]).startsWith("https://huggingface.co/"))).toBe(true);
  });
});

describe("telling stored models apart", () => {
  it("knows Qwen 0.5B's files from Qwen Coder's, and Bonsai's own copy from both", () => {
    const coder = findDeviceModel("qwen2.5-coder-1.5b-instruct")!;
    const bonsai = findDeviceModel("bonsai-1.7b")!;
    const qwenUrl = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/abc/q.gguf";
    expect(isModelUrl(qwen, qwenUrl)).toBe(true);
    expect(isModelUrl(coder, qwenUrl)).toBe(false);
    expect(isModelUrl(bonsai, "/models/bonsai-1.7b/bonsai-1.7b.gguf")).toBe(true);
    expect(isModelUrl(qwen, "/models/bonsai-1.7b/bonsai-1.7b.gguf")).toBe(false);
  });
});

describe("the On-device picker", () => {
  it("offers exactly the models the device engine knows how to fetch, Bonsai first", () => {
    const offered = findEngine("device")!.models.map((m) => m.id);
    expect(offered).toEqual(DEVICE_MODELS.map((m) => m.id));
    expect(offered[0]).toBe("bonsai-1.7b");
  });

  it("gives every unpinned model a repository and a quantization to look for", () => {
    for (const m of DEVICE_MODELS.filter((m) => !m.pinned)) {
      expect(m.repos.length, m.id).toBeGreaterThan(0);
      expect(m.quants.length, m.id).toBeGreaterThan(0);
    }
  });

  it("calls a model phone-friendly only if it is small enough for a phone's browser", () => {
    for (const m of DEVICE_MODELS) expect(m.phone, m.id).toBe(m.approxMB <= 600);
  });

  it("falls back to Bonsai for an id it does not know, rather than running something unnamed", () => {
    expect(deviceModelOrDefault("llama3.3:70b").id).toBe("bonsai-1.7b");
  });
});

describe("one download at a time", () => {
  afterEach(() => device.stopDeviceDownload());

  it("refuses a second model while another downloads, and says which", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return new Response("not found", { status: 404 });
    });
    const first = downloadDeviceModel("bonsai-1.7b", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const second = await downloadDeviceModel("qwen2.5-0.5b-instruct");
    expect(second.ok).toBe(false);
    expect(second.error).toContain("Bonsai 1.7B is downloading");
    release();
    await first;
  });
});

describe("routing to the picked model", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const ask = [{ role: "user" as const, content: "hi" }];
  const ready = { supported: true, downloaded: true, partial: false };

  it("answers with the model picked in the menu and reports that model", async () => {
    const stored = vi.spyOn(device, "storedModel").mockResolvedValue(ready);
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response(JSON.stringify({ prompt: "You are Jackie." }), { status: 200 }));
    const chat = vi.spyOn(device, "chatOnDevice").mockImplementation(async (o) => {
      o.onDelta("hello");
      return { ok: true };
    });
    let done: { model?: string } | null = null;
    await routeChat({
      messages: ask,
      engine: "device",
      model: "qwen2.5-0.5b-instruct",
      onDelta: () => {},
      onError: () => {},
      onDone: (r) => (done = r),
    });
    expect(stored).toHaveBeenCalledWith("qwen2.5-0.5b-instruct");
    expect(chat.mock.calls[0][0].modelId).toBe("qwen2.5-0.5b-instruct");
    expect(done).toMatchObject({ model: "qwen2.5-0.5b-instruct" });
  });

  it("names the picked model when it is not downloaded yet", async () => {
    vi.spyOn(device, "storedModel").mockResolvedValue({ ...ready, downloaded: false });
    const errors: string[] = [];
    await routeChat({
      messages: ask,
      engine: "device",
      model: "smollm2-360m-instruct",
      onDelta: () => {},
      onError: (e) => errors.push(e),
      onDone: () => {},
    });
    expect(errors[0]).toContain("SmolLM2 360M Instruct is not on this device yet");
  });
});
