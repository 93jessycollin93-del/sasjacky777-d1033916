import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "@/lib/jackie-stream";
import * as edge from "@/lib/edgeFunction";

/**
 * What the chat does with the answer once the connection works.
 *
 * The auth crash (see `edge-auth-gate.test.ts`) was why nothing came back at
 * all. These are the failures that looked like an answer: the parser only ever
 * read `choices[0].delta.content` and ignored every other frame, so a failure
 * reported inside a 200 stream — a filtered prompt, a model that dropped —
 * arrived as an empty bubble and a success callback. Nothing on screen, nothing
 * in the console, and the empty message was then saved into the history.
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
  let done = 0;
  return {
    deltas,
    errors,
    get done() {
      return done;
    },
    handlers: {
      onDelta: (t: string) => deltas.push(t),
      onError: (e: string) => errors.push(e),
      onDone: () => {
        done += 1;
      },
    },
  };
}

const ask = [{ role: "user" as const, content: "hi" }];

describe("reading a good stream", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("hands over every token and finishes once", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      sse(token("Jackie "), token("here—"), "data: [DONE]\n\n"),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.deltas.join("")).toBe("Jackie here—");
    expect(c.done).toBe(1);
    expect(c.errors).toEqual([]);
  });

  it("reassembles a frame split across two network chunks", async () => {
    const whole = token("split");
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      sse(whole.slice(0, 12), whole.slice(12), "data: [DONE]\n\n"),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });
    expect(c.deltas.join("")).toBe("split");
  });

  it("survives CRLF line endings and keep-alive comments", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      sse(": ping\r\n", token("ok").replace(/\n/g, "\r\n"), "data: [DONE]\r\n"),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });
    expect(c.deltas.join("")).toBe("ok");
    expect(c.done).toBe(1);
  });

  it("reads a last frame that arrived without its trailing newline", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse(token("a"), token("b").trimEnd()));
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });
    expect(c.deltas.join("")).toBe("ab");
  });
});

describe("a failure hidden inside a 200 stream", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("reports an error frame instead of finishing silently", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      sse(token("start"), `data: ${JSON.stringify({ error: { message: "model unavailable" } })}\n\n`),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.errors).toEqual(["model unavailable"]);
    expect(c.done).toBe(0);
  });

  it("says so when the model stopped on its content filter", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      sse(`data: ${JSON.stringify({ choices: [{ finish_reason: "content_filter", delta: {} }] })}\n\n`),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.errors[0]).toMatch(/content filter/i);
    expect(c.done).toBe(0);
  });

  it("treats a stream that carried nothing as a failure, not a blank answer", async () => {
    // This is the one that produced empty assistant bubbles: a clean stream
    // with no content in it still called onDone, and the caller saved "".
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse("data: [DONE]\n\n"));
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.done).toBe(0);
    expect(c.errors[0]).toMatch(/empty/i);
  });

  it("calls back exactly once even when several things go wrong", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      sse(
        `data: ${JSON.stringify({ error: { message: "first" } })}\n\n`,
        `data: ${JSON.stringify({ error: { message: "second" } })}\n\n`,
      ),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });
    expect(c.errors).toEqual(["first"]);
  });
});

describe("a failure the server reported properly", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("shows the detail the function sent, not just the headline", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Jackie has no model key", detail: "Set the LOVABLE_API_KEY secret." }),
        { status: 503 },
      ),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.errors[0]).toMatch(/no model key/);
    expect(c.errors[0]).toMatch(/LOVABLE_API_KEY/);
  });

  it("still names rate and usage limits in the user's terms", async () => {
    for (const [status, pattern] of [[429, /rate limit/i], [402, /credits/i]] as const) {
      vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response("{}", { status }));
      const c = collect();
      await streamChat({ messages: ask, ...c.handlers });
      expect(c.errors[0]).toMatch(pattern);
    }
  });

  it("says something useful when the body is not even JSON", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });
    expect(c.errors[0]).toMatch(/502/);
  });
});

describe("stopping an answer", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("reports neither success nor failure when the user stops it", async () => {
    // Stopping is a third outcome. Calling onError would show the user a
    // warning for doing what they asked for; calling onDone would claim the
    // half-written answer was complete.
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(token("partial")));
        controller.abort();
        c.close();
      },
    });
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response(body, { status: 200 }));

    const c = collect();
    await streamChat({ messages: ask, signal: controller.signal, ...c.handlers });

    expect(c.deltas.join("")).toBe("partial");
    expect(c.done).toBe(0);
    expect(c.errors).toEqual([]);
  });

  it("passes the signal down so the request itself is cancelled", async () => {
    const spy = vi
      .spyOn(edge, "callEdgeFunction")
      .mockResolvedValue(sse(token("x"), "data: [DONE]\n\n"));
    const controller = new AbortController();
    const c = collect();
    await streamChat({ messages: ask, signal: controller.signal, ...c.handlers });

    expect(spy.mock.calls[0][2]).toMatchObject({ signal: controller.signal });
  });
});

describe("telling a finished answer from a cut-off one", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("treats text that stops without [DONE] or a finish reason as cut off", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse(token("Step 1: open the case. Step 2: rem")));
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.done).toBe(0);
    expect(c.errors[0]).toMatch(/cut off/);
  });

  it("accepts a finish reason in place of [DONE]", async () => {
    const closing = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`;
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(sse(token("all of it"), closing));
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.done).toBe(1);
    expect(c.errors).toEqual([]);
  });
});

describe("naming which limit was hit", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("does not tell someone out of daily quota to wait a moment", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      new Response(JSON.stringify({ error: "Daily AI quota used up", code: "QUOTA_EXCEEDED", retry_after: 3600 }), {
        status: 429,
      }),
    );
    const c = collect();
    await streamChat({ messages: ask, ...c.handlers });

    expect(c.errors[0]).toMatch(/Daily AI quota/);
    expect(c.errors[0]).not.toMatch(/wait a moment/i);
  });
});
