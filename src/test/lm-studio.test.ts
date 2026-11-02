import { describe, expect, it } from "vitest";
import { listModels, pickModel, runLmStudio, LM_STUDIO_HOST } from "@/lib/lmStudio";
import { lmStudioEngine } from "@/lib/microai/contextRouterService";
import { askGuide } from "@/lib/guide/guideService";

/**
 * The Repair Bay's own advice, in code: "your weights already live in LM
 * Studio, so treat that folder as the single source and point everything else
 * at it — one file, one server, every client. No second copy on disk."
 *
 * So guidance asks the hub what it is serving rather than naming a model the
 * app shipped. The property worth pinning is that the operator can load
 * anything they like and it answers, without a code change.
 */
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function hub(loaded: string[], reply = "Open /keys.") {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/v1/models")) {
      return jsonResponse({ data: loaded.map((id) => ({ id })) });
    }
    return jsonResponse({ model: loaded[0], choices: [{ message: { content: reply } }] });
  };
  return { fetchImpl, calls };
}

describe("the LM Studio hub", () => {
  it("lists what the hub has loaded", async () => {
    const { fetchImpl } = hub(["bionic-1.7b-q4", "qwen2.5-0.5b"]);
    await expect(listModels(fetchImpl)).resolves.toEqual(["bionic-1.7b-q4", "qwen2.5-0.5b"]);
  });

  it("treats a hub that is not listening as simply having nothing loaded", async () => {
    const down = async () => { throw new Error("ECONNREFUSED"); };
    await expect(listModels(down)).resolves.toEqual([]);
  });

  it("matches the app's short name against the hub's fuller id", () => {
    // LM Studio ids carry publisher and quantisation, so equality would miss.
    expect(pickModel(["lmstudio-community/Bionic-1.7B-GGUF/bionic-q4_k_m.gguf"], "bionic"))
      .toContain("Bionic");
  });

  it("uses whatever is loaded when the preferred model is not there", () => {
    expect(pickModel(["qwen2.5-0.5b-instruct"], "bonsai-1.7b")).toBe("qwen2.5-0.5b-instruct");
  });

  it("has nothing to offer when the hub is empty", () => {
    expect(pickModel([], "bonsai-1.7b")).toBeNull();
  });

  it("sends an OpenAI-shaped chat request to the loopback hub", async () => {
    const { fetchImpl, calls } = hub(["bionic"], "Hello.");
    const result = await runLmStudio("hi", { system: "be brief" }, fetchImpl);

    expect(result.text).toBe("Hello.");
    expect(result.model).toBe("bionic");
    const chat = calls.find((c) => c.url.endsWith("/v1/chat/completions"));
    expect(chat?.url).toBe(`${LM_STUDIO_HOST}/v1/chat/completions`);
    expect(chat?.body).toMatchObject({
      model: "bionic",
      stream: false,
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("says so rather than guessing when the hub has no model loaded", async () => {
    const { fetchImpl } = hub([]);
    await expect(runLmStudio("hi", {}, fetchImpl)).rejects.toThrow(/no model loaded/);
  });

  it("carries the server's own words up when it refuses", async () => {
    const failing = async (url: string) =>
      url.endsWith("/v1/models")
        ? jsonResponse({ data: [{ id: "bionic" }] })
        : new Response("model is still loading", { status: 503 });
    await expect(runLmStudio("hi", {}, failing)).rejects.toThrow(/503.*still loading/);
  });
});

describe("the hub as an engine", () => {
  it("is only available once a model is actually loaded", async () => {
    expect(await lmStudioEngine(hub(["bionic"]).fetchImpl).available()).toBe(true);
    expect(await lmStudioEngine(hub([]).fetchImpl).available()).toBe(false);
  });

  it("answers guidance with the model the operator loaded, whatever it is", async () => {
    const engine = lmStudioEngine(hub(["bionic-1.7b-q4"], "Open /keys — the key vault lives there.").fetchImpl);
    const answer = await askGuide("where are my api keys", {
      engines: [engine],
      ready: new Set([engine.id]),
    });

    expect(answer.fromModel).toBe(true);
    // The app asked for bonsai-1.7b; the hub had Bionic; the answer names what
    // actually spoke rather than what was requested.
    expect(answer.model).toBe("bionic-1.7b-q4");
    expect(answer.routes.map((r) => r.path)).toContain("/keys");
  });
});
