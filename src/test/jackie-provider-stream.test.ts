import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamProviderChat } from "@/lib/jackie-provider-stream";
import * as edge from "@/lib/edgeFunction";

/**
 * The provider fan-out, and the two ways it used to lie.
 *
 * This client is a second, parallel implementation of what `jackie-stream.ts`
 * does for the main chain, and it had drifted from both of the rules that file
 * exists to enforce. It built its own `fetch` with the user's token in
 * Authorization and no `apikey` at all — which the gateway refuses before the
 * function runs, so every provider read as dead behind "Failed to fetch". And
 * it scored a stream that carried nothing as a success, so a provider that
 * answered with an empty body produced a blank bubble and a `onDone`.
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

function collect() {
  const deltas: string[] = [];
  const errors: string[] = [];
  const served: string[] = [];
  return {
    deltas,
    errors,
    served,
    handlers: {
      onDelta: (t: string) => deltas.push(t),
      onError: (e: string) => errors.push(e),
      onDone: (meta?: { servedBy: string; model: string }) => {
        served.push(meta?.servedBy ?? "(no meta)");
      },
    },
  };
}

const ask = { provider: "groq" as const, model: "llama-3.3-70b-versatile", messages: [{ role: "user" as const, content: "hi" }] };

describe("talking to a provider function", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("goes through callEdgeFunction rather than building its own request", async () => {
    // The headers are the whole bug: a hand-rolled fetch put the publishable
    // key nowhere and the gateway rejected the call before the function ran.
    const call = vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse(token("hey"), "data: [DONE]\n\n"));
    const c = collect();
    await streamProviderChat({ ...ask, ...c.handlers });

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe("jackie-groq");
    expect(c.deltas.join("")).toBe("hey");
    expect(c.errors).toEqual([]);
  });

  it("treats a stream that carried nothing as a failure, not a blank answer", async () => {
    // A clean [DONE] with no content in front of it still called onDone, and
    // the caller saved "" as Jackie's reply.
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse("data: [DONE]\n\n"));
    const c = collect();
    await streamProviderChat({ ...ask, ...c.handlers });

    expect(c.served).toEqual([]);
    expect(c.errors[0]).toMatch(/empty/i);
  });

  it("treats a body that ends without [DONE] and without content the same way", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse(": keep-alive\n\n"));
    const c = collect();
    await streamProviderChat({ ...ask, ...c.handlers });

    expect(c.served).toEqual([]);
    expect(c.errors[0]).toMatch(/empty/i);
  });

  it("hands an empty answer to the next provider when fallback is on", async () => {
    // An empty answer is the kind of thing the next provider gets right, so it
    // cascades rather than stopping the assistant.
    vi.spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(sse("data: [DONE]\n\n"))
      .mockResolvedValue(sse(token("second try"), "data: [DONE]\n\n"));
    const c = collect();
    await streamProviderChat({ ...ask, fallback: true, ...c.handlers });

    expect(c.deltas.join("")).toBe("second try");
    expect(c.errors).toEqual([]);
    expect(c.served).toHaveLength(1);
  });

  it("stops rather than cascading when the caller is signed out", async () => {
    // Every provider would refuse a signed-out caller identically; walking the
    // whole chain to collect the same 401 only delays telling them why.
    const call = vi
      .spyOn(edge, "callEdgeFunction")
      .mockRejectedValue(new edge.NotSignedInError());
    const c = collect();
    await streamProviderChat({ ...ask, fallback: true, ...c.handlers });

    expect(call).toHaveBeenCalledTimes(1);
    expect(c.errors[0]).toMatch(/signed out/i);
  });
});

describe("the owner's own engines", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("moves past an engine that answers only its owner, instead of stopping there", async () => {
    vi.spyOn(edge, "callEdgeFunction")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "This engine belongs to the project owner.", code: "OWNER_ONLY" }), {
          status: 403,
        }),
      )
      .mockResolvedValue(sse(token("from the next one"), "data: [DONE]\n\n"));
    const c = collect();
    await streamProviderChat({
      provider: "bionic",
      model: "bonsai-1.7b",
      messages: [{ role: "user", content: "hi" }],
      fallback: true,
      ...c.handlers,
    });

    expect(c.errors).toEqual([]);
    expect(c.deltas.join("")).toBe("from the next one");
  });
});
