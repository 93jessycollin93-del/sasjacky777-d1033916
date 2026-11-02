/**
 * Bionic — the chat's first local fallback.
 *
 * BionicGPT does not host weights of its own; it serves whatever GGUF the
 * operator has loaded over an OpenAI-compatible port (see
 * `src/lib/repair/modelBridge.ts`, which sets that up). So this function is a
 * thin, authenticated bridge to that port: same request shape as
 * `jackie-chat`, same SSE out, same persona in — which is the point. The router
 * can hand this function a conversation the cloud gateway refused and get an
 * answer back in the same format, from the operator's own hardware.
 *
 * Anything speaking the OpenAI chat-completions API works here: BionicGPT,
 * LM Studio, llama.cpp's server, vLLM, Jan. Set:
 *
 *   BIONIC_BASE_URL   e.g. https://bionic.mydomain.com  (a /v1 suffix is
 *                     optional — it is added when missing)
 *   BIONIC_API_KEY    optional, when the endpoint is protected
 *   BIONIC_MODEL      optional default model name, e.g. bonsai-1.7b
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  admitOwner, allowlistFromEnv, corsHeaders, json, pickModel, preflight, tooLarge,
} from "../_shared/entitlement.ts";
import { normalizeMessages } from "../_shared/chatRequest.ts";
import { guardedSystemPrompt } from "../_shared/personaGuard.ts";
import { bionicEndpoint } from "../_shared/bionicEndpoint.ts";

const FUNCTION_NAME = "jackie-bionic";
const DEFAULT_MODEL = "bonsai-1.7b";
// Kept in step with what `src/lib/jackie-engines.ts` offers in the picker: a
// picker that offers a model the allowlist refuses is a guaranteed failure the
// user cannot diagnose. `bionic-default` means "whatever BIONIC_MODEL names",
// which is how an operator serves a GGUF this list has never heard of.
const ALLOWED_MODELS = allowlistFromEnv("BIONIC_MODEL_ALLOWLIST", [
  "bonsai-1.7b",
  "llama3.3:70b",
  "llama3.2:3b",
  "qwen2.5-coder:32b",
  "deepseek-r1:32b",
  "mistral:7b",
  // LM Studio names its models this way; Bionic is how the app reaches it.
  "hermes-3-llama-3.1-8b",
  "deepseek-r1-distill-qwen-14b",
]);
const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 100_000;

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return json({ error: "Expected a JSON body" }, 400);
    }
    const { messages, model, context, system } = payload as {
      messages?: unknown;
      model?: unknown;
      context?: unknown;
      system?: unknown;
    };

    if (Array.isArray(messages) && messages.length > MAX_MESSAGES) {
      return json({ error: "Too many messages" }, 400);
    }
    if (tooLarge(messages, MAX_MESSAGE_CHARS)) {
      return json({ error: "Message payload too large" }, 413);
    }

    const verdict = normalizeMessages(messages);
    if (!verdict.ok) return json({ error: verdict.reason }, 400);

    // "Serve whatever is loaded" is a real choice an operator makes, so an
    // absent model defers to BIONIC_MODEL rather than being refused; anything
    // the caller names still has to be on the list.
    const requested = typeof model === "string" && model.trim() ? model.trim() : undefined;
    const fallbackModel = Deno.env.get("BIONIC_MODEL") || DEFAULT_MODEL;
    const chosen = requested
      ? pickModel(requested, ALLOWED_MODELS, fallbackModel)
      : { model: fallbackModel };
    if ("error" in chosen) return chosen.error;

    // Checked before admission: the main chat probes this engine as one link in
    // a chain, so an unconfigured endpoint is a normal, frequent event, and
    // charging a unit of quota for a call that cannot happen would bill the
    // caller for the chain's own bookkeeping.
    const baseUrl = Deno.env.get("BIONIC_BASE_URL");
    if (!baseUrl) {
      // `needs_secret` is what tells the router this engine is not configured
      // rather than broken, so it moves on without making noise about it.
      // 200 + ok:false, not 503 — see restoreUnconfigured in src/lib/edgeFunction.ts.
      return json(
        {
          ok: false,
          error:
            "Bionic is not connected. Set BIONIC_BASE_URL to your OpenAI-compatible endpoint (BionicGPT, LM Studio, llama.cpp, vLLM).",
          code: "PROVIDER_UNCONFIGURED",
          needs_secret: "BIONIC_BASE_URL",
        },
        200,
      );
    }

    // Bionic serves from the operator's own hardware, so it answers the owner only.
    // Any account can sign in to this app; that must not make it anyone's GPU.
    const admission = await admitOwner(req, FUNCTION_NAME, chosen.model);
    if (admission instanceof Response) return admission;

    const selected = chosen.model;

    const guarded = await guardedSystemPrompt(FUNCTION_NAME, { system, context });
    const systemPrompt = guarded.prompt;

    const apiKey = Deno.env.get("BIONIC_API_KEY");

    // A local server that accepts the connection and then thinks forever is the
    // common failure on an under-specced box. Bound the wait for headers only —
    // a slow first token is still an answer, a silent socket is not.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let upstream: Response;
    try {
      upstream = await fetch(bionicEndpoint(baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: selected,
          messages: [{ role: "system", content: systemPrompt }, ...verdict.messages],
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      return json(
        {
          error: aborted
            ? "Bionic did not answer in time."
            : "Could not reach the Bionic endpoint.",
          detail: String((e as Error)?.message || e),
        },
        504,
      );
    } finally {
      clearTimeout(timer);
      await guarded.recorded;
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return json(
        {
          error: `Bionic refused the request (HTTP ${upstream.status}).`,
          detail: text.slice(0, 500) || undefined,
          model: selected,
        },
        upstream.status && upstream.status >= 400 && upstream.status < 500 ? 502 : upstream.status || 502,
      );
    }

    return new Response(upstream.body, {
      headers: {
        ...corsHeaders,
        ...guarded.headers,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
