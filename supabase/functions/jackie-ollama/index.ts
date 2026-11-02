/**
 * Ollama — the chat's second local fallback.
 *
 * Bridge to a self-hosted Ollama instance (tunnel, home GPU, VPS).
 *
 * The base URL comes from configuration rather than the request, so there is no
 * URL-based SSRF here. The *model* was caller-controlled, though, and that is
 * its own problem on a private box: any signed-in user could load any model
 * installed on it — including a private one that was never meant to be reachable
 * from the web app — and could pick the largest one on the disk repeatedly,
 * which on a single-GPU host is a denial of service against everyone else.
 *
 * It also takes the same request shape as `jackie-chat` — `{ messages, model,
 * context }` — and builds Jackie's persona from the shared prompt, because the
 * main chat falls back here, and a fallback that answers as a different
 * assistant with no memory of the conversation is a worse failure than the one
 * it was covering for.
 *
 * Requires OLLAMA_BASE_URL. Optional OLLAMA_API_KEY if the endpoint is
 * protected. OLLAMA_MODEL_ALLOWLIST names the models this app may run.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  admitOwner, allowlistFromEnv, corsHeaders, json, pickModel, preflight, providerFailure, tooLarge,
} from "../_shared/entitlement.ts";
import { normalizeMessages } from "../_shared/chatRequest.ts";
import { guardedSystemPrompt } from "../_shared/personaGuard.ts";

const FUNCTION_NAME = "jackie-ollama";
const DEFAULT_MODEL = "llama3.2:3b";
// The default set covers the small models that are safe to load anywhere plus
// the ones the chat's own engine picker offers. A picker that offers a model
// the allowlist refuses is a guaranteed failure the user cannot diagnose, so
// the lists are kept in step; `src/lib/jackie-engines.ts` and
// `src/lib/jackie-providers.ts` are the other ends.
const ALLOWED_MODELS = allowlistFromEnv("OLLAMA_MODEL_ALLOWLIST", [
  "llama3.2:3b",
  "llama3.2:1b",
  "llama3.1:8b",
  "llama3.3:70b",
  "qwen2.5:7b",
  "qwen2.5-coder:32b",
  "deepseek-r1:32b",
  "mistral:7b",
  "phi3:mini",
  // Offered by the /micro picker (`src/lib/jackie-providers.ts`);
  // `src/test/provider-allowlists.test.ts` holds the two lists together.
  "llama3.2-vision:11b",
  "codellama:34b",
  "gemma2:9b",
  // DeepSeek and Hermes, for the agents that drive the app (docs/HARNESSES.md).
  "deepseek-r1:14b",
  "hermes3:8b",
  "hermes3:70b",
]);
const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 100_000;
const MAX_SYSTEM_CHARS = 20_000;

// Ollama returns NDJSON. Rewrap into OpenAI-compatible SSE so the same client parser works.
function ndjsonToSse(readable: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";
  return new ReadableStream({
    async start(controller) {
      const reader = readable.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const j = JSON.parse(line);
            const content = j.message?.content ?? j.response ?? "";
            const chunk = { choices: [{ delta: { content } }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            if (j.done) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch { /* skip */ }
        }
      }
      controller.close();
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const chosen = pickModel(payload.model, ALLOWED_MODELS, DEFAULT_MODEL);
  if ("error" in chosen) return chosen.error;

  if (Array.isArray(payload.messages) && payload.messages.length > MAX_MESSAGES) {
    return json({ error: "Too many messages" }, 400);
  }
  if (tooLarge(payload.messages, MAX_MESSAGE_CHARS)) {
    return json({ error: "Message payload too large" }, 413);
  }

  // The same validation `jackie-chat` runs, so an empty turn left by an aborted
  // send cannot wedge a conversation here either — most runners reject a
  // message with no content, and the bad turn stays in the history forever.
  const verdict = normalizeMessages(payload.messages);
  if (!verdict.ok) return json({ error: verdict.reason }, 400);

  const explicitSystem = typeof payload.system === "string" ? payload.system.trim() : "";
  if (explicitSystem.length > MAX_SYSTEM_CHARS) {
    return json({ error: "System prompt too large" }, 413);
  }

  // Checked before admission on purpose. The main chat probes this engine as
  // one link in a chain, so an unconfigured runner is a normal, frequent event
  // — and charging a unit of the caller's quota for a call that cannot happen
  // would bill them for the chain's own bookkeeping.
  const base = Deno.env.get("OLLAMA_BASE_URL");
  if (!base) {
    console.error(`${FUNCTION_NAME}: OLLAMA_BASE_URL not configured`);
    // 200 + ok:false, not 503 — see restoreUnconfigured in src/lib/edgeFunction.ts.
    return json(
      { ok: false, error: "Provider unavailable", code: "PROVIDER_UNCONFIGURED", needs_secret: "OLLAMA_BASE_URL" },
      200,
    );
  }

  // Ollama runs on the operator's own GPU, so it answers the owner only.
  // Any account can sign in to this app; that must not make it anyone's GPU.
  const admission = await admitOwner(req, FUNCTION_NAME, chosen.model);
  if (admission instanceof Response) return admission;

  try {
    const guarded = await guardedSystemPrompt(FUNCTION_NAME, {
      system: explicitSystem,
      context: payload.context,
    });
    const optionalKey = Deno.env.get("OLLAMA_API_KEY");
    const resp = await fetch(`${base.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(optionalKey ? { Authorization: `Bearer ${optionalKey}` } : {}),
      },
      body: JSON.stringify({
        model: chosen.model,
        messages: [{ role: "system", content: guarded.prompt }, ...verdict.messages],
        stream: true,
      }),
    });

    await guarded.recorded;
    if (!resp.ok || !resp.body) return await providerFailure(FUNCTION_NAME, resp);

    return new Response(ndjsonToSse(resp.body), {
      headers: { ...corsHeaders, ...guarded.headers, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unexpected failure`, e);
    return json({ error: "Internal error" }, 500);
  }
});
