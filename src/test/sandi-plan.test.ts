import { describe, expect, it } from "vitest";
import { describeLadder, planSandi } from "@/lib/sandi/plan";
import type { InferenceEngine } from "@/lib/microai/contextRouter";
import type { CraftedIndex } from "@/lib/forge/types";

function index(over: Partial<CraftedIndex> & { id: string; keywords: string[] }): CraftedIndex {
  return {
    name: over.id,
    glyph: "I",
    specialty: "",
    systemPrompt: "",
    reads: [],
    modelId: "granite-micro",
    ladder: ["device"],
    commands: [],
    ...over,
  } as CraftedIndex;
}

function engine(id: string, locality: InferenceEngine["locality"]): InferenceEngine {
  return {
    id,
    name: id,
    locality,
    available: async () => true,
    run: async () => ({ text: "", model: id }),
  };
}

describe("where SANDi sends what you type", () => {
  it("moves the app for a command, with no model involved", () => {
    expect(planSandi("Open Tasks", [])).toMatchObject({ kind: "go", path: "/tasks" });
  });

  it("answers a question that mentions a page instead of navigating away from it", () => {
    expect(planSandi("what did I write about the vault", [])?.kind).not.toBe("go");
  });

  it("hands a question to the crafted index whose keyword claims it", () => {
    const recipes = index({ id: "recipes", keywords: ["recipe", "cook"] });
    expect(planSandi("how long do I cook rice", [recipes])).toMatchObject({ kind: "crafted", index: recipes });
  });

  it("sends a question no crafted index claims to a built-in specialist, instead of giving up", () => {
    // The Index Pill stopped here with "No indexes crafted yet".
    expect(planSandi("which model fits in my gpu memory", [])).toMatchObject({
      kind: "specialist",
      router: { id: "operator" },
      claimed: true,
    });
  });

  it("keeps vault questions on Keeper, the specialist that never leaves the device", () => {
    const plan = planSandi("where is my backup secret stored", []);
    expect(plan).toMatchObject({ kind: "specialist", router: { id: "keeper", ladder: ["device"] } });
  });

  it("says when no specialist claimed a question and Recall took it by default", () => {
    expect(planSandi("tell me something interesting", [])).toMatchObject({
      kind: "specialist",
      router: { id: "recall" },
      claimed: false,
    });
  });

  it("does nothing for an empty box", () => {
    expect(planSandi("   ", [])).toBeNull();
  });
});

describe("the weights ladder SANDi shows", () => {
  const engines = [engine("bonsai", "device"), engine("lmstudio", "lan"), engine("ollama", "lan")];

  it("marks each rung ready, down, offline or unconfigured — four different things to do about it", () => {
    const rungs = describeLadder(["device", "lan", "network"], engines, new Set(["ollama"]), false);
    expect(rungs.map((r) => [r.locality, r.state])).toEqual([
      ["device", "down"],
      ["lan", "ready"],
      ["network", "none"],
    ]);
    expect(rungs[1].engines).toEqual(["lmstudio", "ollama"]);
  });

  it("calls a configured network rung offline, not down, when there is no connection", () => {
    const withNet = [...engines, engine("cloud", "network")];
    const rungs = describeLadder(["network"], withNet, new Set(["cloud"]), false);
    expect(rungs[0].state).toBe("offline");
  });
});
