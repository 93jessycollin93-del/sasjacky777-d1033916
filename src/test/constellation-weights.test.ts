import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStations, type StationBoundaries } from "@/lib/constellation/stations";
import { resolveRoute } from "@/lib/routeManifest";
import { VISION_MODEL_ID, visionWeightsStatus } from "@/lib/microai/chain/vision";

/**
 * Weights are the one part of the offline ladder that a browser can hold and a
 * test cannot create, so the read is handed to the table and the probe logic
 * around it is exercised for real: what a device that holds the model answers,
 * what one that does not, and what one that stopped halfway.
 */
const base: StationBoundaries = {
  fetch: async () => new Response("", { status: 200 }),
  jackyStatus: async () => "stub",
  storageBudgetMB: async () => 100_000,
  shellWorker: async () => "shell worker controlling · 1283 files held locally",
  deviceWeights: async () => {
    throw new Error("Bonsai 1.7B is not on this device yet.");
  },
  visionWeights: async () => {
    throw new Error("SmolVLM 256M is not on this device yet.");
  },
};

function station(id: "bonsai-weights" | "vision-weights", over: Partial<StationBoundaries> = {}) {
  const found = buildStations({ ...base, ...over }).find((s) => s.id === id);
  if (!found) throw new Error(`no station named ${id}`);
  return found;
}

describe("the weights the system needs to answer", () => {
  it("says the language model is ready when this device holds it, and how big", async () => {
    const verdict = await station("bonsai-weights", {
      deviceWeights: async () => "Bonsai 1.7B · 248 MB held on this device",
    }).probe.check();
    expect(verdict).toEqual({ state: "live", detail: "Bonsai 1.7B · 248 MB held on this device" });
  });

  it("names the one download as the fix when the language weights are missing", async () => {
    const verdict = await station("bonsai-weights", {
      deviceWeights: async () => {
        throw new Error("Bonsai 1.7B is not on this device yet. It downloads once while you are online.");
      },
    }).probe.check();
    expect(verdict.state).toBe("absent");
    expect(verdict.detail).toContain("downloads once");
  });

  it("calls a half-finished download missing rather than a model that is ready", async () => {
    const verdict = await station("bonsai-weights", {
      deviceWeights: async () => {
        throw new Error("part of Bonsai is on this device, but the download never finished");
      },
    }).probe.check();
    expect(verdict.state).toBe("absent");
    expect(verdict.detail).toContain("never finished");
  });

  it("reports the photo reader by the weights it actually holds", async () => {
    const verdict = await station("vision-weights", {
      visionWeights: async () => "SmolVLM 256M on this device · 2 weight files, 5 files held",
    }).probe.check();
    expect(verdict.state).toBe("live");
    expect(verdict.detail).toContain("2 weight files");
  });

  it("keeps both weight stations on the offline rung and pointed at a page that exists", () => {
    for (const id of ["bonsai-weights", "vision-weights"] as const) {
      const s = station(id);
      expect(s.stage, id).toBe("field");
      expect(s.offline, id).toBe("full");
      expect(s.external, id).toBeFalsy();
      expect(resolveRoute(s.href), `${id} → ${s.href}`).not.toBeNull();
    }
  });
});

/** A stand-in for the browser cache: entries are complete files, as they are in real caches. */
function fakeCaches(urls: string[]) {
  vi.stubGlobal("caches", {
    keys: async () => (urls.length ? ["transformers-cache"] : []),
    open: async () => ({ keys: async () => urls.map((url) => ({ url })) }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("asking the browser whether the photo reader is here", () => {
  it("counts the model as present once its weights are cached", async () => {
    fakeCaches([
      `https://huggingface.co/${VISION_MODEL_ID}/resolve/main/config.json`,
      `https://huggingface.co/${VISION_MODEL_ID}/resolve/main/onnx/decoder_model_merged.onnx`,
    ]);
    const status = await visionWeightsStatus();
    expect(status.present).toBe(true);
    expect(status.files).toBe(2);
    expect(status.detail).toContain("on this device");
  });

  it("refuses to call a model's paperwork its weights", async () => {
    fakeCaches([`https://huggingface.co/${VISION_MODEL_ID}/resolve/main/config.json`]);
    const status = await visionWeightsStatus();
    expect(status.present).toBe(false);
    expect(status.detail).toContain("not on this device yet");
  });

  it("says so plainly when the browser cannot hold anything offline", async () => {
    vi.stubGlobal("caches", undefined);
    const status = await visionWeightsStatus();
    expect(status.present).toBe(false);
    expect(status.detail).toContain("no cache");
  });

  it("does not mistake another model's weights for the photo reader's", async () => {
    fakeCaches(["https://huggingface.co/some/other-model/resolve/main/onnx/model.onnx"]);
    expect((await visionWeightsStatus()).present).toBe(false);
  });
});
