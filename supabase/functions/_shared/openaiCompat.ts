/**
 * One handler for every provider that speaks OpenAI's chat-completions API.
 *
 * Ten functions (Groq, Cerebras, Mistral, Google AI Studio, Together, Hugging
 * Face, DeepInfra, Fireworks, OpenAI, xAI) were the same sixty lines copied
 * ten times, and every copy had the same four faults:
 *
 *   - They charged quota before checking their own key. The /micro cascade
 *     walks every provider on a failure, so each unconfigured one billed the
 *     caller for a call that could never happen — up to a dozen units for one
 *     message, against a limit of twenty a minute.
 *   - They forwarded `messages` as the caller sent them: any role (a caller's
 *     own `system` turns included), any shape, any size.
 *   - They answered as an anonymous assistant unless the browser happened to
 *     send a system prompt, so Jackie's voice, rules and memory vanished the
 *     moment the cascade reached them (CLAUDE.md, rule 6).
 *   - They returned the provider's own error body and status. A revoked
 *     provider key came back as a 401, which reads as "you are signed out".
 *
 * Keeping the lists and the URL in each function and the behaviour here means
 * the next fix lands in all ten at once instead of in whichever copy someone
 * happened to open.
 */
import {
  admit, corsHeaders, json, preflight, providerFailure, tooLarge,
} from "./entitlement.ts";
import { normalizeMessages } from "./chatRequest.ts";
import { guardedSystemPrompt } from "./personaGuard.ts";

export interface OpenAiCompatConfig {
  /** Edge function name, for quota accounting and logs. */
  fn: string;
  /** Secret holding the provider key. */
  secret: string;
  /** Full chat-completions URL. */
  url: string;
  /** Models this function will send upstream. */
  models: readonly string[];
  /** What an absent or unknown model resolves to. Must be in `models`. */
  defaultModel: string;
  /** Where to get a key, shown when the secret is missing. */
  keyHelp: string;
}

const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_SYSTEM_CHARS = 20_000;
/** Bounds the wait for response headers only; a long answer that streams is working. */
const HEADER_TIMEOUT_MS = 60_000;

export function openAiCompatHandler(cfg: OpenAiCompatConfig): (req: Request) => Promise<Response> {
  const allowed = new Set(cfg.models);
  if (!allowed.has(cfg.defaultModel)) {
    // A default outside its own list would be sent upstream unchecked on every
    // request that names no model. Fail at boot, where it is visible.
    throw new Error(`${cfg.fn}: default model ${cfg.defaultModel} is not in its allowlist`);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return preflight();
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    try {
      // Configuration first: a missing key is a normal state for most of these,
      // and must not cost the caller anything. `needs_secret` tells the /micro
      // cascade to move on quietly.
      const key = Deno.env.get(cfg.secret);
      if (!key) {
        // 200 + ok:false, not 503 — see restoreUnconfigured in src/lib/edgeFunction.ts.
        return json(
          {
            ok: false,
            error: `${cfg.secret} not configured. ${cfg.keyHelp}`,
            code: "PROVIDER_UNCONFIGURED",
            needs_secret: cfg.secret,
          },
          200,
        );
      }

      const payload = await req.json().catch(() => null);
      if (!payload || typeof payload !== "object") {
        return json({ error: "Expected a JSON body" }, 400);
      }
      const { messages, model, system, context } = payload as Record<string, unknown>;

      if (Array.isArray(messages) && messages.length > MAX_MESSAGES) {
        return json({ error: "Too many messages" }, 400);
      }
      if (tooLarge(messages, MAX_MESSAGE_CHARS)) {
        return json({ error: "Message payload too large" }, 413);
      }
      const verdict = normalizeMessages(messages);
      if (!verdict.ok) return json({ error: verdict.reason }, 400);

      const explicitSystem = typeof system === "string" ? system.trim() : "";
      if (explicitSystem.length > MAX_SYSTEM_CHARS) {
        return json({ error: "System prompt too large" }, 413);
      }

      // An unknown model falls back to the default rather than being refused:
      // the default is the cheapest sensible choice, and a picker that is one
      // release behind the catalogue should still get an answer.
      const selected = typeof model === "string" && allowed.has(model) ? model : cfg.defaultModel;

      const admission = await admit(req, cfg.fn, selected);
      if (admission instanceof Response) return admission;

      const guarded = await guardedSystemPrompt(cfg.fn, { system: explicitSystem, context });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS);
      let upstream: Response;
      try {
        upstream = await fetch(cfg.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selected,
            messages: [{ role: "system", content: guarded.prompt }, ...verdict.messages],
            stream: true,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        const aborted = (e as Error)?.name === "AbortError";
        console.error(`${cfg.fn}: upstream unreachable`, e);
        return json(
          {
            error: aborted ? "The provider took too long to answer." : "Could not reach the provider.",
            code: aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE",
          },
          504,
        );
      } finally {
        clearTimeout(timer);
        await guarded.recorded;
      }

      if (!upstream.ok) return await providerFailure(cfg.fn, upstream);
      if (!upstream.body) return json({ error: "The provider returned an empty response." }, 502);

      return new Response(upstream.body, {
        headers: {
          ...corsHeaders,
          ...guarded.headers,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (e) {
      console.error(`${cfg.fn}: unexpected failure`, e);
      return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
    }
  };
}
