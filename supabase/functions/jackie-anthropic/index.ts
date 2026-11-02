// Streaming chat via Anthropic Claude direct (paid).
// Translates an OpenAI-shape request into the Messages API and its SSE back into
// OpenAI-shape SSE, so the same client parser reads every provider.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  admit, corsHeaders, json, preflight, providerFailure, tooLarge,
} from "../_shared/entitlement.ts";
import { normalizeMessages } from "../_shared/chatRequest.ts";
import { guardedSystemPrompt } from "../_shared/personaGuard.ts";

// The Claude 3.x ids this listed have been retired; every request to them
// failed upstream and the /micro cascade walked past Anthropic entirely.
const ALLOWED = new Set(["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);
const DEFAULT_MODEL = "claude-opus-5";
const SECRET = "ANTHROPIC_API_KEY";
const BASE = "https://api.anthropic.com/v1/messages";
const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_SYSTEM_CHARS = 20_000;
/** Streaming, so a generous ceiling costs nothing unless it is used; a low one truncates. */
const MAX_TOKENS = 64_000;

const enc = new TextEncoder();
const frame = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

/**
 * Anthropic SSE → OpenAI SSE.
 *
 * Only text deltas become content. Two things used to be dropped on the floor
 * and are now surfaced as an in-stream error frame, which the client parser
 * reports instead of saving a blank or half answer as if it were whole: an
 * `error` event mid-stream, and a `refusal` stop reason.
 */
function anthropicToOpenAIStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  let buf = "";
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let j: Record<string, any>;
            try {
              j = JSON.parse(payload);
            } catch {
              continue;
            }
            if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
              controller.enqueue(frame({ choices: [{ delta: { content: j.delta.text } }] }));
            } else if (j.type === "message_delta" && j.delta?.stop_reason === "refusal") {
              controller.enqueue(frame({ error: { message: "Claude declined this request." } }));
            } else if (j.type === "message_delta" && j.delta?.stop_reason) {
              controller.enqueue(frame({ choices: [{ delta: {}, finish_reason: j.delta.stop_reason }] }));
            } else if (j.type === "error") {
              controller.enqueue(frame({ error: { message: j.error?.message ?? "Anthropic stream error" } }));
            } else if (j.type === "message_stop") {
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
            }
          }
        }
      } catch (e) {
        controller.enqueue(frame({ error: { message: `Anthropic stream broke: ${(e as Error)?.message ?? e}` } }));
      } finally {
        controller.close();
      }
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Configuration before quota (rule 5): most deployments have no key here.
    const key = Deno.env.get(SECRET);
    if (!key) {
      return json({
        error: `${SECRET} not configured. Paste your Anthropic key at https://console.anthropic.com/settings/keys`,
        code: "PROVIDER_UNCONFIGURED",
        needs_secret: SECRET,
      }, 503);
    }

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") return json({ error: "Expected a JSON body" }, 400);
    const { messages, model, system, context } = payload as Record<string, unknown>;

    if (Array.isArray(messages) && messages.length > MAX_MESSAGES) return json({ error: "Too many messages" }, 400);
    if (tooLarge(messages, MAX_MESSAGE_CHARS)) return json({ error: "Message payload too large" }, 413);
    const verdict = normalizeMessages(messages);
    if (!verdict.ok) return json({ error: verdict.reason }, 400);

    const explicitSystem = typeof system === "string" ? system.trim() : "";
    if (explicitSystem.length > MAX_SYSTEM_CHARS) return json({ error: "System prompt too large" }, 413);

    const selected = typeof model === "string" && ALLOWED.has(model) ? model : DEFAULT_MODEL;
    const admission = await admit(req, "jackie-anthropic", selected);
    if (admission instanceof Response) return admission;

    const guarded = await guardedSystemPrompt("jackie-anthropic", { system: explicitSystem, context });

    const resp = await fetch(BASE, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Server-side refusal fallbacks: when a safety classifier declines, the
        // API retries on a model chosen by refusal category instead of failing.
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selected,
        max_tokens: MAX_TOKENS,
        system: guarded.prompt,
        messages: verdict.messages,
        fallbacks: "default",
        stream: true,
      }),
    });
    await guarded.recorded;
    if (!resp.ok) return await providerFailure("jackie-anthropic", resp);
    if (!resp.body) return json({ error: "Anthropic returned an empty response." }, 502);

    return new Response(anthropicToOpenAIStream(resp.body), {
      headers: {
        ...corsHeaders,
        ...guarded.headers,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    console.error("jackie-anthropic: unexpected failure", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
