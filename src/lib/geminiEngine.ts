/**
 * The operator's own Gemini Enterprise engine, from the browser.
 *
 * `supabase/functions/gemini-engine` has existed and worked for a while, and
 * nothing in `src/` ever called it — so every answer on every screen came from
 * the Lovable gateway, which knows nothing about this rig. This is the missing
 * half: the client that lets a surface ask the operator's own grounded engine
 * and show what it cited.
 *
 * Two things it refuses to do vaguely, because both have bitten this project:
 *
 *  - **Not-connected is not a failure.** The function answers 400 with
 *    `needs_connection` and the exact list of secrets it is missing. That is a
 *    setup step, not an outage, and it reads completely differently on screen.
 *    `GeminiNotConnectedError` carries the list so a surface can name them.
 *  - **An answer with no text is not an answer.** The engine can return
 *    `state: SKIPPED` — a query it declined to ground — with a perfectly
 *    healthy 200. Reporting that as success is how a blank panel ends up
 *    looking like a working one.
 */
import { callEdgeFunction, describeEdgeFailure } from "@/lib/edgeFunction";

export interface GeminiCitation {
  title?: string;
  uri?: string;
  domain?: string;
}

export interface GeminiAnswer {
  text: string;
  citations: GeminiCitation[];
  /** Opaque handle that threads follow-up questions onto the same session. */
  session: string | null;
}

/** The engine is not linked yet. Carries what is missing so a screen can say so. */
export class GeminiNotConnectedError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      missing.length
        ? `Gemini Enterprise is not connected yet. Missing: ${missing.join(", ")}.`
        : "Gemini Enterprise is not connected yet.",
    );
    this.name = "GeminiNotConnectedError";
    this.missing = missing;
  }
}

/** The engine declined to answer this query. Carries its reasons. */
export class GeminiSkippedError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`Gemini Enterprise declined to answer: ${reasons.join(", ") || "no reason given"}.`);
    this.name = "GeminiSkippedError";
    this.reasons = reasons;
  }
}

type RawAnswer = {
  text?: unknown;
  citations?: unknown;
  session?: unknown;
  skipped?: unknown;
  error?: unknown;
  needs_connection?: unknown;
  missing?: unknown;
};

function citationsOf(raw: unknown): GeminiCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      title: typeof c.title === "string" ? c.title : undefined,
      uri: typeof c.uri === "string" ? c.uri : undefined,
      domain: typeof c.domain === "string" ? c.domain : undefined,
    }))
    .filter((c) => c.title || c.uri);
}

function stringsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

async function call(body: Record<string, unknown>): Promise<RawAnswer> {
  let resp: Response;
  try {
    resp = await callEdgeFunction("gemini-engine", body);
  } catch (e) {
    throw new Error(describeEdgeFailure(e, "gemini-engine"));
  }

  const data = (await resp.json().catch(() => null)) as RawAnswer | null;

  if (!resp.ok) {
    if (data?.needs_connection) throw new GeminiNotConnectedError(stringsOf(data.missing));
    const detail = typeof data?.error === "string" ? data.error : `HTTP ${resp.status}`;
    throw new Error(`Gemini Enterprise: ${detail}`);
  }
  if (!data) throw new Error("Gemini Enterprise returned a response that could not be read.");
  if (typeof data.error === "string") throw new Error(`Gemini Enterprise: ${data.error}`);
  return data;
}

/**
 * Asks the engine, grounded against whatever it indexes.
 *
 * Pass `session` back from a previous answer to keep one thread of questions
 * together; the engine resolves pronouns against it.
 */
export async function askGemini(
  query: string,
  options: { session?: string | null } = {},
): Promise<GeminiAnswer> {
  const q = query.trim();
  if (!q) throw new Error("Ask the engine something first.");

  const data = await call({ query: q, ...(options.session ? { session: options.session } : {}) });

  const skipped = stringsOf(data.skipped);
  const text = typeof data.text === "string" ? data.text.trim() : "";

  // A skip is the engine saying it would not ground this, which is a real
  // answer about the question rather than a blank one to paper over.
  if (!text && skipped.length) throw new GeminiSkippedError(skipped);
  if (!text) throw new Error("Gemini Enterprise returned an empty answer.");

  return {
    text,
    citations: citationsOf(data.citations),
    session: typeof data.session === "string" ? data.session : null,
  };
}

export interface GeminiSearchHit {
  id?: string;
  title?: string;
  uri?: string;
  snippet?: string;
}

/**
 * Raw search against the same engine, for a surface that wants the documents
 * rather than a written answer.
 */
export async function searchGemini(query: string): Promise<GeminiSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const data = (await call({ query: q, mode: "search" })) as RawAnswer & { results?: unknown };
  if (!Array.isArray(data.results)) return [];

  return data.results
    .filter((r): r is Record<string, any> => !!r && typeof r === "object")
    .map((r) => {
      const doc = r.document ?? r;
      const derived = doc?.derivedStructData ?? {};
      const snippet = Array.isArray(derived.snippets) ? derived.snippets[0]?.snippet : undefined;
      return {
        id: typeof doc?.id === "string" ? doc.id : undefined,
        title: typeof derived.title === "string" ? derived.title : undefined,
        uri: typeof derived.link === "string" ? derived.link : undefined,
        snippet: typeof snippet === "string" ? snippet : undefined,
      };
    })
    .filter((h) => h.title || h.uri || h.snippet);
}

/**
 * Whether the engine is reachable, for a screen that wants to show the state
 * before the person types a question. Never throws.
 */
export async function geminiStatus(): Promise<
  { connected: true } | { connected: false; missing: string[]; reason: string }
> {
  try {
    await askGemini("ping");
    return { connected: true };
  } catch (e) {
    if (e instanceof GeminiNotConnectedError) {
      return { connected: false, missing: e.missing, reason: e.message };
    }
    // Anything else means it is wired up and answered — a skip or an empty
    // answer to "ping" is not a connection problem.
    if (e instanceof GeminiSkippedError) return { connected: true };
    return { connected: false, missing: [], reason: e instanceof Error ? e.message : "unknown" };
  }
}
