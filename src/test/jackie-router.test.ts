import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeChat } from "@/lib/jackie-router";
import { chainFrom, ENGINE_CHAIN, DEFAULT_ENGINE } from "@/lib/jackie-engines";
import * as edge from "@/lib/edgeFunction";

/**
 * What the chat does when an engine cannot answer.
 *
 * The old chat had one route and no recovery: the cloud gateway refused, a
 * toast appeared, and that was the whole story — on a rig that had its own
 * engine running and a model loaded. These cover the walk down the chain, the
 * two things that must stop it, and the promise that the answer says where it
 * actually came from.
 */

function sse(...frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const token = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

const refusal = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

/** `jacky-proxy` wraps the engine's own JSON in an envelope. */
const jackySays = (response: string) =>
  new Response(JSON.stringify({ ok: true, status: 200, data: { response, model: "jacky-local" } }), {
    status: 200,
  });

function collect() {
  const deltas: string[] = [];
  const errors: string[] = [];
  const routes: string[] = [];
  let result: { engine: string; model?: string; fellBackFrom: string[] } | null = null;
  return {
    deltas,
    errors,
    routes,
    get text() {
      return deltas.join("");
    },
    get result() {
      return result;
    },
    handlers: {
      onDelta: (t: string) => deltas.push(t),
      onError: (e: string) => errors.push(e),
      onRoute: (a: { engine: string }) => routes.push(a.engine),
      onDone: (r: { engine: string; model?: string; fellBackFrom: string[] }) => {
        result = r;
      },
      // No real timers: Jacky's answer is paced onto the screen, and a test
      // should not wait out the pacing.
      pace: () => Promise.resolve(),
    },
  };
}

const ask = [{ role: "user" as const, content: "hi" }];

describe("the engine chain", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("puts Jacky first and the cloud gateway last", () => {
    expect(ENGINE_CHAIN).toEqual(["jacky", "bionic", "ollama", "deepseek", "cloud"]);
    expect(DEFAULT_ENGINE).toBe("jacky");
  });

  it("keeps the rest of the chain behind whichever engine was chosen", () => {
    expect(chainFrom("ollama")).toEqual(["ollama", "jacky", "bionic", "deepseek", "cloud"]);
  });
});

describe("answering from the chosen engine", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("asks Jacky through the proxy and pages its answer onto the screen", async () => {
    const call = vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(jackySays("Jackie here— all good."));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe("jacky-proxy");
    expect((call.mock.calls[0][1] as { path: string }).path).toBe("ask");
    expect(c.text).toBe("Jackie here— all good.");
    expect(c.result).toEqual({ engine: "jacky", model: undefined, fellBackFrom: [] });
    expect(c.errors).toEqual([]);
  });

  it("streams from Bionic when Bionic is the choice", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValue(sse(token("local "), token("answer"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "bionic", model: "bonsai-1.7b", ...c.handlers });

    expect(call.mock.calls[0][0]).toBe("jackie-bionic");
    expect((call.mock.calls[0][1] as { model: string }).model).toBe("bonsai-1.7b");
    expect(c.text).toBe("local answer");
    expect(c.result?.engine).toBe("bionic");
  });
});

describe("falling back", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("walks Jacky → Bionic → Ollama until one answers", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(refusal(502, { error: "jacky upstream unreachable" }))
      .mockResolvedValueOnce(refusal(503, { error: "Bionic is not connected", needs_secret: "BIONIC_BASE_URL" }))
      .mockResolvedValueOnce(sse(token("from the GPU"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(call.mock.calls.map((a) => a[0])).toEqual(["jacky-proxy", "jackie-bionic", "jackie-ollama"]);
    expect(c.text).toBe("from the GPU");
    expect(c.result).toMatchObject({ engine: "ollama", fellBackFrom: ["jacky", "bionic"] });
    expect(c.errors).toEqual([]);
  });

  it("reaches the cloud gateway only after every local engine has failed", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(refusal(502, { error: "unreachable" }))
      .mockResolvedValueOnce(refusal(503, { error: "not connected" }))
      .mockResolvedValueOnce(refusal(400, { error: "OLLAMA_BASE_URL not configured" }))
      .mockResolvedValueOnce(refusal(503, { error: "DEEPSEEK_API_KEY not configured", needs_secret: "DEEPSEEK_API_KEY" }))
      .mockResolvedValueOnce(sse(token("cloud"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(call.mock.calls.map((a) => a[0])).toEqual([
      "jacky-proxy",
      "jackie-bionic",
      "jackie-ollama",
      "jackie-deepseek",
      "jackie-chat",
    ]);
    expect(c.result?.engine).toBe("cloud");
  });

  it("does not carry one engine's model to the next", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(refusal(503, { error: "not connected" }))
      .mockResolvedValueOnce(refusal(502, { error: "unreachable" }))
      .mockResolvedValueOnce(sse(token("ok"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "bionic", model: "bonsai-1.7b", ...c.handlers });

    // Bionic was asked for the chosen model; Ollama, further down the chain,
    // gets its own default rather than a model name it has never heard of.
    expect(call.mock.calls.map((a) => a[0])).toEqual(["jackie-bionic", "jacky-proxy", "jackie-ollama"]);
    expect((call.mock.calls[0][1] as { model?: string }).model).toBe("bonsai-1.7b");
    expect((call.mock.calls[2][1] as { model?: string }).model).toBe("llama3.2:3b");
  });

  it("names every engine that refused when none of them could answer", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(refusal(503, { error: "nope" }));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(c.result).toBeNull();
    expect(c.errors).toHaveLength(1);
    expect(c.errors[0]).toMatch(/jacky → bionic → ollama → deepseek → cloud/);
  });

  it("treats an answer of nothing as a failure worth retrying elsewhere", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, status: 200, data: { response: "   " } }), { status: 200 }),
      )
      .mockResolvedValueOnce(sse(token("a real answer"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(call).toHaveBeenCalledTimes(2);
    expect(c.text).toBe("a real answer");
    expect(c.result?.engine).toBe("bionic");
  });

  it("stays on one engine when the caller turned fallback off", async () => {
    const call = vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(refusal(503, { error: "nope" }));
    const c = collect();
    await routeChat({ messages: ask, engine: "bionic", fallback: false, ...c.handlers });

    expect(call).toHaveBeenCalledTimes(1);
    expect(c.errors).toHaveLength(1);
  });
});

describe("when the whole chain refuses for one reason", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  /**
   * The chain's length is what disguises a shared cause.
   *
   * Every gated function calls `consume_provider_quota`, which ships in a
   * migration, and migrations in this project do not run themselves. On a
   * database that never had `supabase db push` run against it the RPC is
   * absent, so all four rungs refuse identically — and "Every engine refused
   * (jacky → bionic → ollama)" sends someone to check four engines and a
   * network when the answer is one un-pushed migration. Four identical
   * refusals are one fault wearing four coats.
   */
  it("says the engines are not the problem when they all refuse alike", async () => {
    const missing = {
      error: "Jackie's quota function is missing from the database",
      code: "QUOTA_FUNCTION_MISSING",
    };
    // A fresh Response per call: a body can only be read once, so reusing one
    // object would leave rungs two to four parsing a consumed stream and
    // reporting a bare HTTP status instead of the server's words.
    vi.spyOn(edge, "callEdgeFunction").mockImplementation(() =>
      Promise.resolve(refusal(503, missing)),
    );
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(c.errors).toHaveLength(1);
    expect(c.errors[0]).toMatch(/not the engines/i);
    expect(c.errors[0]).toContain("quota function is missing");
    // The engine list is exactly what misleads here, so it is not the headline.
    expect(c.errors[0]).not.toMatch(/jacky → bionic/);
  });

  /**
   * The failure the operator actually saw, for months.
   *
   * Four rungs call four different functions. When none of them can be reached
   * at all — a fetch that rejects, which is what a 500 with no CORS headers
   * looks like from a browser — the engines are not individually broken. No
   * edge function on the project answered, and the fix is a deploy. The old
   * message, "Every engine refused (jacky → bionic → ollama → cloud)", sent
   * someone to check four engines, three secrets and their wifi instead.
   */
  it("says nothing was reached when every function fails at the transport layer", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockImplementation(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(c.errors).toHaveLength(1);
    expect(c.errors[0]).toMatch(/not one of 5 edge functions answered/i);
    expect(c.errors[0]).toMatch(/not deployed|without CORS/i);
    // The engine list is the misleading part, so it is not what leads.
    expect(c.errors[0]).not.toMatch(/^Every engine refused \(/);
  });

  it("still lists the engines when they failed for different reasons", async () => {
    vi.spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(refusal(502, { error: "jacky upstream unreachable" }))
      .mockResolvedValueOnce(refusal(503, { error: "Bionic is not connected" }))
      .mockResolvedValueOnce(refusal(400, { error: "OLLAMA_BASE_URL not configured" }))
      .mockResolvedValueOnce(refusal(503, { error: "DEEPSEEK_API_KEY not configured" }))
      .mockResolvedValueOnce(refusal(503, { error: "Jackie has no model key" }));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(c.errors[0]).toMatch(/Every engine refused \(/);
    expect(c.errors[0]).not.toMatch(/not the engines/i);
  });

  it("does not call a single refusal a shared cause", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockImplementation(() =>
      Promise.resolve(refusal(503, { error: "only one tried" })),
    );
    const c = collect();
    await routeChat({ messages: ask, engine: "cloud", fallback: false, ...c.handlers });

    expect(c.errors[0]).not.toMatch(/not the engines/i);
    expect(c.errors[0]).toContain("only one tried");
  });
});

describe("the two things that stop the walk", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("does not try three more engines when there is no session", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockRejectedValue(new edge.NotSignedInError());
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(call).toHaveBeenCalledTimes(1);
    expect(c.errors[0]).toMatch(/signed out/i);
  });

  it("reports neither success nor failure when the user stops the answer", async () => {
    const controller = new AbortController();
    vi.spyOn(edge, "callEdgeFunction").mockImplementation(async () => {
      controller.abort();
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", signal: controller.signal, ...c.handlers });

    expect(c.errors).toEqual([]);
    expect(c.result).toBeNull();
  });
});

describe("saying where the answer came from", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("reports each attempt, so a silent switch cannot happen", async () => {
    vi.spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(refusal(502, { error: "down" }))
      .mockResolvedValueOnce(sse(token("hi"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "jacky", ...c.handlers });

    expect(c.routes).toEqual(["jacky", "bionic"]);
  });
});

describe("an engine that breaks partway through an answer", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const halfThenError = () =>
    sse(token("The capital of France is "), `data: ${JSON.stringify({ error: { message: "model went away" } })}\n\n`);

  it("clears the half answer before the next engine starts over", async () => {
    vi.spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(refusal(503, { error: "jacky link not configured" }))
      .mockResolvedValueOnce(halfThenError())
      .mockResolvedValueOnce(sse(token("Paris is the capital of France."), "data: [DONE]\n\n"));
    const c = collect();
    let shown = "";
    await routeChat({
      messages: ask,
      engine: "jacky",
      ...c.handlers,
      onDelta: (t) => {
        shown += t;
      },
      onReset: () => {
        shown = "";
      },
    });

    expect(shown).toBe("Paris is the capital of France.");
    expect(c.result).toMatchObject({ engine: "ollama", fellBackFrom: ["jacky", "bionic"] });
  });

  it("stops rather than splicing when the caller cannot clear the screen", async () => {
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(halfThenError())
      .mockResolvedValueOnce(sse(token("a whole other answer"), "data: [DONE]\n\n"));
    const c = collect();
    await routeChat({ messages: ask, engine: "bionic", ...c.handlers });

    expect(call).toHaveBeenCalledTimes(1);
    expect(c.text).toBe("The capital of France is ");
    expect(c.result).toBeNull();
    expect(c.errors[0]).toMatch(/broke off partway/);
  });
});
