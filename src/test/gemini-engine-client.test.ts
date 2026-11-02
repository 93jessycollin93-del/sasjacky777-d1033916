import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askGemini, searchGemini, geminiStatus,
  GeminiNotConnectedError, GeminiSkippedError,
} from "@/lib/geminiEngine";
import * as edge from "@/lib/edgeFunction";

/**
 * The client for the operator's own engine.
 *
 * `gemini-engine` had worked for a while with nothing in `src/` calling it, so
 * every answer on every screen came from the Lovable gateway instead. These
 * pin the two states that read wrong if they are collapsed into "it failed":
 * an engine that is not linked yet is a setup step, and an engine that declined
 * to ground a query has told you something about the query.
 */
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("asking the operator's engine", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the answer with whatever it cited", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({
        text: "Reseat the RAM.",
        session: "sessions/7",
        citations: [{ title: "Board manual", uri: "https://x/y", domain: "x" }],
      }),
    );

    const answer = await askGemini("why won't it post");
    expect(answer.text).toBe("Reseat the RAM.");
    expect(answer.session).toBe("sessions/7");
    expect(answer.citations[0].title).toBe("Board manual");
  });

  it("names the secrets it is missing rather than reporting an outage", async () => {
    // Not connected is a setup step. Told as a generic failure it sends the
    // person looking for a broken engine instead of an unfinished one.
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({ error: "not linked", needs_connection: "gemini_enterprise", missing: ["GEMINI_ENTERPRISE_ENGINE_ID"] }, 400),
    );

    const err = await askGemini("anything").catch((e) => e);
    expect(err).toBeInstanceOf(GeminiNotConnectedError);
    expect(err.missing).toEqual(["GEMINI_ENTERPRISE_ENGINE_ID"]);
    expect(err.message).toMatch(/GEMINI_ENTERPRISE_ENGINE_ID/);
  });

  it("treats a declined query as an answer about the query, not a blank panel", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({ text: "", skipped: ["NON_ANSWER_SEEKING_QUERY"], citations: [], session: null }),
    );

    const err = await askGemini("hello there").catch((e) => e);
    expect(err).toBeInstanceOf(GeminiSkippedError);
    expect(err.reasons).toEqual(["NON_ANSWER_SEEKING_QUERY"]);
  });

  it("treats a 200 that carried no text as a failure", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(reply({ text: "   ", citations: [] }));
    await expect(askGemini("q")).rejects.toThrow(/empty answer/i);
  });

  it("threads a follow-up onto the same session", async () => {
    const call = vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(reply({ text: "ok", citations: [] }));
    await askGemini("and then?", { session: "sessions/7" });
    expect((call.mock.calls[0][1] as Record<string, unknown>).session).toBe("sessions/7");
  });

  it("drops citations that carry neither a title nor a link", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({ text: "ok", citations: [{ domain: "x" }, { title: "Real", uri: "https://r" }] }),
    );
    const answer = await askGemini("q");
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0].title).toBe("Real");
  });

  it("refuses an empty question before spending a call", async () => {
    const call = vi.spyOn(edge, "callEdgeFunction");
    await expect(askGemini("   ")).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
});

describe("searching the engine directly", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("flattens the nested document shape into hits", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({
        results: [
          { document: { id: "d1", derivedStructData: { title: "T", link: "https://l", snippets: [{ snippet: "S" }] } } },
        ],
      }),
    );
    const hits = await searchGemini("ram");
    expect(hits).toEqual([{ id: "d1", title: "T", uri: "https://l", snippet: "S" }]);
  });

  it("returns nothing for an empty query without calling out", async () => {
    const call = vi.spyOn(edge, "callEdgeFunction");
    expect(await searchGemini("  ")).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("reporting connection state", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads a skip as connected, because only a live engine can skip", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({ text: "", skipped: ["NON_ANSWER_SEEKING_QUERY"], citations: [] }),
    );
    expect(await geminiStatus()).toEqual({ connected: true });
  });

  it("reports not-connected with the missing list", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(
      reply({ needs_connection: "gemini_enterprise", missing: ["GEMINI_ENTERPRISE_API_KEY"] }, 400),
    );
    const status = await geminiStatus();
    expect(status.connected).toBe(false);
    expect(status).toHaveProperty("missing", ["GEMINI_ENTERPRISE_API_KEY"]);
  });

  it("never throws, whatever the network did", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockRejectedValue(new Error("offline"));
    expect((await geminiStatus()).connected).toBe(false);
  });
});
