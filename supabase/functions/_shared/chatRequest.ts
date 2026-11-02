/**
 * What the chat function accepts, and what it does with it.
 *
 * The gate that broke the chat was an auth crash (see `authGate.ts`), but it
 * hid a second class of failure that looks identical from the user's chair:
 * the request reaches the model gateway, the gateway refuses it, and the UI
 * shows an empty bubble or a generic "Something went wrong". The causes are
 * all the same shape — something in the request was not what the gateway
 * expected — and all of them are cheap to catch here, where the answer can say
 * which thing it was.
 *
 * So this module owns the request contract:
 *
 *   - the model list, which the browser and the function now read from the
 *     same place, so the picker cannot offer a model the function rejects;
 *   - message validation, so a malformed history is a 400 that names the
 *     problem rather than a 500 from somewhere downstream;
 *   - a bound on the injected context, because Jackie's memory, tasks and file
 *     summaries are all concatenated into the system prompt and grow without
 *     limit as the vault fills. Past the gateway's ceiling every request fails,
 *     and it fails for a reason nothing in the UI could explain.
 *
 * Pure functions, no Deno and no network, so `src/test/chat-request.test.ts`
 * imports this exact file — and so does the browser, through
 * `src/lib/jackie-stream.ts`.
 */

export interface ChatModel {
  id: string;
  label: string;
  description: string;
  /** 1 cheap … 3 expensive. Shown in the picker. */
  cost: 1 | 2 | 3;
  /** 1 slow … 3 fast. Shown in the picker. */
  speed: 1 | 2 | 3;
}

/**
 * Every model the chat may use, in picker order.
 *
 * This list used to exist twice: once in the browser as `JACKIE_MODELS` and
 * once in the function as `ALLOWED_MODELS`. They had already drifted — the
 * function's default, `google/gemini-3.6-flash`, was not a model the picker
 * could select, so "the model Jackie is using" and "the model the UI says she
 * is using" were different strings. One list cannot drift from itself.
 */
export const CHAT_MODELS: readonly ChatModel[] = [
  { id: "google/gemini-2.5-flash", label: "Gemini Flash", description: "Fast, capable, the everyday default", cost: 2, speed: 3 },
  { id: "google/gemini-2.5-pro", label: "Gemini Pro", description: "Top-tier reasoning, slower", cost: 3, speed: 1 },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini Lite", description: "Cheapest and quickest", cost: 1, speed: 3 },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", description: "Next-gen, balanced", cost: 2, speed: 2 },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", description: "Newest Flash — fast coding and reasoning", cost: 2, speed: 3 },
  { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", description: "Fast coding and reasoning", cost: 2, speed: 3 },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash", description: "Fast coding and reasoning", cost: 2, speed: 3 },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "Deepest Gemini reasoning, slower", cost: 3, speed: 1 },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", description: "Cheapest Gemini for quick answers", cost: 1, speed: 3 },
  { id: "openai/gpt-5", label: "GPT-5", description: "Powerful all-rounder", cost: 3, speed: 1 },
  { id: "openai/gpt-5-mini", label: "GPT-5 Mini", description: "Strong and efficient", cost: 2, speed: 2 },
] as const;

/**
 * What Jackie falls back to when no model was asked for, or an unknown one was.
 *
 * A known-good, fast, mid-cost model — the failure mode of a bad default is a
 * chat that silently does not work, so this one is deliberately boring.
 */
export const DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash";

export const CHAT_MODEL_IDS: readonly string[] = CHAT_MODELS.map((m) => m.id);

/** Resolves a requested model to one that is actually allowed. */
export function resolveModel(requested: unknown): { model: string; fellBack: boolean } {
  if (typeof requested === "string" && CHAT_MODEL_IDS.includes(requested)) {
    return { model: requested, fellBack: false };
  }
  return { model: DEFAULT_CHAT_MODEL, fellBack: true };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type MessagesVerdict =
  | { ok: true; messages: ChatTurn[] }
  | { ok: false; reason: string };

/** How many turns of history to forward. */
export const MAX_TURNS = 40;
/** How many characters of injected context to forward. */
export const MAX_CONTEXT_CHARS = 24_000;
/** How many characters a single turn may carry. */
export const MAX_TURN_CHARS = 100_000;

/**
 * Checks and trims the conversation history.
 *
 * Turns with empty content are dropped rather than forwarded: most gateways
 * reject a message with no content outright, which turned one stray empty turn
 * — an aborted send, an attachment-only message — into a conversation that
 * could never be continued again, because the bad turn stayed in the history
 * and every later send carried it.
 *
 * Only the last `MAX_TURNS` are kept. An unbounded history eventually exceeds
 * the model's window, and the first request past that line fails with no
 * warning and no way for the user to know why.
 */
export function normalizeMessages(raw: unknown): MessagesVerdict {
  if (!Array.isArray(raw)) return { ok: false, reason: "'messages' must be an array" };

  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    turns.push({ role, content: trimmed.slice(0, MAX_TURN_CHARS) });
  }

  if (turns.length === 0) {
    return { ok: false, reason: "'messages' has no usable user or assistant turns" };
  }

  return { ok: true, messages: turns.slice(-MAX_TURNS) };
}

/**
 * Trims injected context to something the gateway will accept.
 *
 * The tail is kept, not the head: memory, tasks and file summaries are built
 * most-relevant-last, so cutting from the front loses the least.
 */
export function clampContext(context: unknown, max = MAX_CONTEXT_CHARS): string {
  if (typeof context !== "string") return "";
  const trimmed = context.trim();
  if (trimmed.length <= max) return trimmed;
  return "…(earlier context trimmed)\n" + trimmed.slice(-max);
}
