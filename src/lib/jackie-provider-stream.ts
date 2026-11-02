// Unified streaming client — routes to any provider edge function.
// Every provider function returns OpenAI-compatible SSE (`data: {...}\n`).
// Auto-fallback: on 429/402/5xx or missing-secret errors, cascades down
// the FALLBACK_ORDER (Lovable → free → freemium → paid).
//
// Local runners (Bionic, Ollama) always fail over, even with `fallback` off: a local
// rate limit / overload / refused connection is never a reason for the main
// assistant to stop. Context is auto-captured before every switch.
import type { ProviderId } from "./jackie-providers";
import { findProvider, FALLBACK_ORDER } from "./jackie-providers";
import { callEdgeFunction, NotSignedInError } from "./edgeFunction";
import { captureContext } from "./repair/contextGuard";

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

/** Providers that run on the operator's own machine — always worth failing over. */
const LOCAL_PROVIDERS: ProviderId[] = ["bionic", "ollama"];

const RATE_LIMIT_PATTERNS =
  /(429|rate ?limit|too many requests|overload|busy|model is loading|queue|timeout|timed out|connection refused|econnrefused|fetch failed|unavailable)/i;

export function isRateLimitLike(reason: string) {
  return RATE_LIMIT_PATTERNS.test(reason);
}

/** Auto-save the conversation before a provider/model switch takes it away. */
function guard(args: StreamArgs, from: ProviderId, to: ProviderId, reason: string, partial: string) {
  captureContext({
    reason: "rate-limit-failover",
    from: `${from} · ${args.model}`,
    to,
    detail: reason,
    body: [
      args.system ? `# system\n${args.system}` : "",
      ...args.messages.map((m) => `# ${m.role}\n${m.content}`),
      partial ? `# assistant (partial, before failover)\n${partial}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}


type StreamArgs = {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  system?: string;
  onDelta: (t: string) => void;
  onDone: (meta?: { servedBy: ProviderId; model: string }) => void;
  onError: (e: string) => void;
  /** Fallback through remaining providers when this one fails. Default: false. */
  fallback?: boolean;
  /** Callback fired when we switch to a fallback provider. */
  onFallback?: (from: ProviderId, to: ProviderId, reason: string) => void;
};

type SingleResult =
  | { kind: "ok" }
  | { kind: "retryable"; reason: string }
  | { kind: "fatal"; reason: string };

/**
 * How a stream that closed cleanly is scored.
 *
 * Reaching `[DONE]`, or the end of the body, having carried no content is a
 * failure however tidy the close was — reporting it as success is what put
 * empty assistant bubbles on the screen. It is retryable rather than fatal
 * because an empty answer is exactly the kind of thing the next provider in
 * the chain tends to get right.
 */
function settle(gotAnyDelta: boolean): SingleResult {
  return gotAnyDelta
    ? { kind: "ok" }
    : { kind: "retryable", reason: "The model returned an empty answer." };
}

async function tryOne(
  args: StreamArgs,
  provider: ProviderId,
  model: string,
  sink: { text: string },
): Promise<SingleResult> {
  const def = findProvider(provider);
  if (!def) return { kind: "fatal", reason: `Unknown provider: ${provider}` };

  // Through `callEdgeFunction`, never a hand-rolled fetch. This one used to
  // build its own request with the access token in Authorization and no
  // `apikey` at all, which the gateway rejects before the function runs — the
  // browser calls that `TypeError: Failed to fetch`, so every provider looked
  // dead for a reason nothing on screen could name.
  let resp: Response;
  try {
    resp = await callEdgeFunction(
      def.fn,
      { messages: args.messages, model, system: args.system },
    );
  } catch (e) {
    // Signed out is not something the next provider can fix, so it must not
    // cascade down the whole chain collecting the same refusal.
    if (e instanceof NotSignedInError) return { kind: "fatal", reason: e.message };
    return { kind: "retryable", reason: e instanceof Error ? e.message : "Network error" };
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => null);
    const msg = err?.needs_secret
      ? `Missing ${err.needs_secret}`
      : err?.error || `HTTP ${resp.status}`;
    // Retry on missing secret, rate limit, credit, or transient upstream
    // OWNER_ONLY: the owner's own engines (Bionic, Ollama) refuse everyone
    // else. That is this account's normal state, not a fault — move on.
    const retryable =
      !!err?.needs_secret ||
      err?.code === "OWNER_ONLY" ||
      resp.status === 429 ||
      resp.status === 402 ||
      resp.status >= 500 ||
      (LOCAL_PROVIDERS.includes(provider) && isRateLimitLike(msg));
    return retryable ? { kind: "retryable", reason: msg } : { kind: "fatal", reason: msg };
  }


  if (!resp.body) return { kind: "retryable", reason: "No stream body" };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let gotAnyDelta = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return settle(gotAnyDelta);
        try {
          const j = JSON.parse(payload);
          const c = j.choices?.[0]?.delta?.content;
          if (c) { args.onDelta(c); sink.text += c; gotAnyDelta = true; }
        } catch { /* partial */ }
      }
    }
  } catch (e) {
    // Mid-stream failure: only retry if we haven't emitted anything yet
    if (!gotAnyDelta) {
      return { kind: "retryable", reason: e instanceof Error ? e.message : "Stream broken" };
    }
    return { kind: "fatal", reason: e instanceof Error ? e.message : "Stream broken" };
  }
  return settle(gotAnyDelta);
}

export async function streamProviderChat(args: StreamArgs) {
  const primary = args.provider;
  const sink = { text: "" };
  const first = await tryOne(args, primary, args.model, sink);

  if (first.kind === "ok") {
    args.onDone({ servedBy: primary, model: args.model });
    return;
  }

  // A local runner hitting a limit/overload must never stop the assistant:
  // fail over even when the caller didn't ask for fallback.
  const forceFailover =
    first.kind === "retryable" &&
    LOCAL_PROVIDERS.includes(primary) &&
    isRateLimitLike(first.reason);

  if (first.kind === "fatal" || (!args.fallback && !forceFailover)) {
    args.onError(first.reason);
    return;
  }

  // Cascade through remaining providers using each provider's default (first) model.
  const chain = FALLBACK_ORDER.filter((p) => p !== primary);
  let lastReason = first.reason;
  for (const next of chain) {
    const def = findProvider(next);
    if (!def) continue;
    const fallbackModel = def.models[0]?.id;
    if (!fallbackModel) continue;
    // Auto-save the context before handing the session to another provider.
    guard(args, primary, next, lastReason, sink.text);
    args.onFallback?.(primary, next, lastReason);
    const r = await tryOne(args, next, fallbackModel, sink);
    if (r.kind === "ok") {
      args.onDone({ servedBy: next, model: fallbackModel });
      return;
    }
    if (r.kind === "fatal") {
      args.onError(r.reason);
      return;
    }
    lastReason = r.reason;
  }
  args.onError(`All providers failed. Last error: ${lastReason}`);
}

