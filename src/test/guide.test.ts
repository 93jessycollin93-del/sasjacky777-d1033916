import { describe, expect, it } from "vitest";
import { findRoutes, unservedPaths, GUIDE_DESTINATIONS } from "@/lib/guide/appMap";
import { askGuide, GUIDE_LADDER } from "@/lib/guide/guideService";
import { checkGuideWeights, GUIDE_INSTALL_COMMAND, GUIDE_WEIGHTS_MB } from "@/lib/guide/weights";
import { GUIDANCE_MODEL, MICRO_MODELS } from "@/lib/microai/models";
import { resolveRoute } from "@/lib/routeManifest";
import type { InferenceEngine } from "@/lib/microai/contextRouter";

/**
 * Guidance is the one answer in this app that a person acts on immediately: it
 * tells them where to go. So the properties worth pinning are not "it replied"
 * but "it never sends anyone somewhere that is not there", and "it still
 * answers when the model is missing" — a guide that goes quiet the moment the
 * weights are absent is not permanent, it is a feature with a dependency.
 */
const engineThatSays = (text: string): InferenceEngine => ({
  id: "ollama",
  name: "Ollama",
  locality: "lan",
  available: async () => true,
  run: async () => ({ text, model: GUIDANCE_MODEL.id }),
});

const READY = new Set(["ollama"]);

describe("the app map", () => {
  it("only ever offers routes the router actually serves", () => {
    for (const route of GUIDE_DESTINATIONS) {
      expect(resolveRoute(route.path), route.path).not.toBeNull();
    }
  });

  it("never offers an alias, a parameter route or the sign-in page", () => {
    for (const route of GUIDE_DESTINATIONS) {
      expect(route.alias, route.path).not.toBe(true);
      expect(route.path).not.toContain(":");
      expect(route.path).not.toBe("/auth");
    }
  });

  it("finds the page a plainly worded question is about", () => {
    expect(findRoutes("where do I manage my api keys")[0].route.path).toBe("/keys");
    expect(findRoutes("how do I start the vault")[0].route.path).toBe("/vault");
    expect(findRoutes("show me the micro model board")[0].route.path).toBe("/micro/board");
  });

  it("says nothing rather than guessing at a question with no bearing on the app", () => {
    expect(findRoutes("what is the weather tomorrow")).toEqual([]);
  });

  it("spots a path the app does not serve", () => {
    expect(unservedPaths("Open /account to change it")).toEqual(["/account"]);
    // /settings is real — the manifest generates it as an alias of the Eru
    // module — so a check written against a guess at the route list rather than
    // the list itself would call this a hallucination and drop a good answer.
    expect(unservedPaths("Open /vault, then /keys, then /settings.")).toEqual([]);
  });
});

describe("asking the guide", () => {
  it("answers from the manifest when no engine is ready", async () => {
    const answer = await askGuide("where are my api keys", { engines: [], ready: new Set() });

    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.fromModel).toBe(false);
    expect(answer.routes.map((r) => r.path)).toContain("/keys");
  });

  it("lets the model write the prose when it is installed", async () => {
    const answer = await askGuide("where are my api keys", {
      engines: [engineThatSays("Open /keys — every provider key lives in that vault.")],
      ready: READY,
    });

    expect(answer.fromModel).toBe(true);
    expect(answer.text).toContain("/keys");
  });

  it("drops an answer that invents a route and keeps the real ones", async () => {
    // The failure this exists for: a small model confidently naming /account
    // in an app that has no /account. The prose is discarded, the manifest
    // answer stands, and the reason says exactly what happened.
    const answer = await askGuide("where do I change my password", {
      engines: [engineThatSays("Go to /account and pick Password.")],
      ready: READY,
    });

    expect(answer.fromModel).toBe(false);
    expect(answer.dropped).toContain("/account");
    expect(answer.text).not.toContain("/account");
    expect(answer.reason).toMatch(/does not serve/);
  });

  it("falls back to the manifest when the engine throws", async () => {
    const broken: InferenceEngine = {
      id: "ollama", name: "Ollama", locality: "lan",
      available: async () => true,
      run: async () => { throw new Error("connection refused"); },
    };
    const answer = await askGuide("open the vault", { engines: [broken], ready: READY });

    expect(answer.fromModel).toBe(false);
    expect(answer.routes.map((r) => r.path)).toContain("/vault");
    expect(answer.reason).toContain("connection refused");
  });

  it("never reaches the network, even for an engine that is ready", async () => {
    const cloud: InferenceEngine = {
      id: "cloud", name: "Cloud", locality: "network",
      available: async () => true,
      run: async () => ({ text: "from the cloud", model: "cloud" }),
    };
    const answer = await askGuide("open the vault", { engines: [cloud], ready: new Set(["cloud"]) });

    expect(GUIDE_LADDER).not.toContain("network");
    expect(answer.fromModel).toBe(false);
  });
});

describe("the shipped weights", () => {
  it("is the registry's Bonsai entry, and says one size rather than two", () => {
    // This used to assert the literal 248. That number is now written by
    // `npm run weights` from the file it actually fetched, so pinning it in a
    // test meant re-fetching at a different quantisation broke the suite for
    // doing exactly what it is supposed to do. What must hold is that the
    // number and the label users read agree with each other — which is the
    // thing that can silently be wrong.
    expect(GUIDANCE_MODEL.id).toBe("bonsai-1.7b");
    expect(GUIDE_WEIGHTS_MB).toBeGreaterThan(0);
    expect(MICRO_MODELS.find((m) => m.id === "bonsai-1.7b")?.sizeLabel).toBe(
      `~${GUIDE_WEIGHTS_MB} MB`,
    );
  });

  it("installs from the copy in the repo, never from a registry", () => {
    expect(GUIDE_INSTALL_COMMAND).toContain("public/models/bonsai-1.7b/Modelfile");
    expect(GUIDE_INSTALL_COMMAND).not.toMatch(/pull|http/);
  });

  it("calls an LFS pointer file what it is instead of reporting the model installed", async () => {
    const pointer = async () =>
      new Response(null, { status: 200, headers: { "content-length": "133" } });
    const found = await checkGuideWeights(pointer as unknown as typeof fetch);

    expect(found.present).toBe(false);
    expect(found.detail).toMatch(/pointer/);
    expect(found.detail).toMatch(/git lfs pull/);
  });

  it("reports real weights as present, with their size", async () => {
    const weights = async () =>
      new Response(null, { status: 200, headers: { "content-length": String(248 * 1024 * 1024) } });
    const found = await checkGuideWeights(weights as unknown as typeof fetch);

    expect(found.present).toBe(true);
    expect(found.detail).toContain("248 MB");
  });

  it("reports a missing file as missing rather than throwing", async () => {
    const missing = async () => new Response(null, { status: 404 });
    const found = await checkGuideWeights(missing as unknown as typeof fetch);

    expect(found.present).toBe(false);
    expect(found.detail).toContain("404");
  });
});
