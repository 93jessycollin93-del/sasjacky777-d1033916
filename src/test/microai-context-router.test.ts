import { describe, expect, it } from "vitest";
import {
  CONTEXT_ROUTERS,
  findRouter,
  routeIntent,
  routerModel,
  selectEngine,
  type InferenceEngine,
} from "@/lib/microai/contextRouter";
import { MICRO_MODELS } from "@/lib/microai/models";

/**
 * The rule worth guarding is the one that only shows up in the branch nobody
 * hits at a desk: offline, with a perfectly healthy cloud engine available. A
 * selector tested only while online would happily return it, and the failure
 * would first appear on a train, in a product whose whole claim is that it does
 * not need the network.
 *
 * The second is Keeper: vault context must never reach a network engine, at any
 * connectivity. That is asserted as a consequence — the engine that comes back
 * — not as "the ladder was consulted".
 */
const engine = (id: string, locality: InferenceEngine["locality"]): InferenceEngine => ({
  id,
  name: id,
  locality,
  available: async () => true,
  run: async (prompt) => ({ text: prompt, model: id }),
});

const DEVICE = engine("micro", "device");
const LAN = engine("ollama", "lan");
const CLOUD = engine("claude", "network");
const ALL = [DEVICE, LAN, CLOUD];

describe("selectEngine", () => {
  it("prefers the device engine even when everything is ready and online", () => {
    const choice = selectEngine(findRouter("recall"), ALL, new Set(["micro", "ollama", "claude"]), true);
    expect(choice.engine).toBe(DEVICE);
  });

  it("falls to the LAN engine when nothing runs on the device", () => {
    const choice = selectEngine(findRouter("recall"), ALL, new Set(["ollama", "claude"]), true);
    expect(choice.engine).toBe(LAN);
  });

  it("refuses a network engine while offline, even though it is ready", () => {
    const choice = selectEngine(findRouter("recall"), ALL, new Set(["claude"]), false);

    expect(choice.engine).toBeNull();
    expect(choice.reason).toMatch(/no engine ready/);
  });

  it("uses the network engine once there is a network and nothing closer", () => {
    const choice = selectEngine(findRouter("recall"), ALL, new Set(["claude"]), true);
    expect(choice.engine).toBe(CLOUD);
  });

  it("never sends Keeper's context to a network engine, online or not", () => {
    for (const online of [true, false]) {
      const choice = selectEngine(findRouter("keeper"), ALL, new Set(["claude", "ollama"]), online);
      expect(choice.engine, `online=${online}`).toBeNull();
    }

    // It does answer once something on the device is ready.
    expect(selectEngine(findRouter("keeper"), ALL, new Set(["micro"]), false).engine).toBe(DEVICE);
  });

  it("keeps Operator off the network at every rung of its ladder", () => {
    expect(findRouter("operator").ladder).not.toContain("network");
    expect(selectEngine(findRouter("operator"), ALL, new Set(["claude"]), true).engine).toBeNull();
  });

  it("says nothing is ready rather than returning an engine that is not", () => {
    const choice = selectEngine(findRouter("maker"), ALL, new Set(), true);
    expect(choice.engine).toBeNull();
    expect(choice.reason).toContain("Maker");
  });
});

describe("routeIntent", () => {
  it("sends a question about stored keys to the Keeper", () => {
    expect(routeIntent("where is my api key stored").id).toBe("keeper");
  });

  it("sends a question about loading a model to the Operator", () => {
    expect(routeIntent("can this phone load the 7b model").id).toBe("operator");
  });

  it("sends a build request to the Maker", () => {
    expect(routeIntent("generate an image for the pod surface").id).toBe("maker");
  });

  it("falls back to Recall for anything unclassified", () => {
    expect(routeIntent("hello").id).toBe("recall");
    expect(routeIntent("").id).toBe("recall");
  });
});

describe("router models", () => {
  it("names a model that exists in the micro registry", () => {
    const known = new Set(MICRO_MODELS.map((m) => m.id));
    for (const router of CONTEXT_ROUTERS) {
      expect(known.has(router.modelId), `${router.id} → ${router.modelId}`).toBe(true);
      expect(routerModel(router.id).id).toBe(router.modelId);
    }
  });

  it("refuses an unknown router rather than guessing one", () => {
    // @ts-expect-error — exercising the runtime guard, not the type
    expect(() => findRouter("nope")).toThrow(/unknown context router/);
  });
});
