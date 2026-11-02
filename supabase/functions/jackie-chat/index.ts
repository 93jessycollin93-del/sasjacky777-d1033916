import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gate } from "../_shared/entitlement.ts";
import { normalizeMessages, resolveModel } from "../_shared/chatRequest.ts";
import { guardedSystemPrompt } from "../_shared/personaGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_SYSTEM_CHARS = 20_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * The gate now answers two questions, not one.
 *
 * It used to answer only "who is this", with a local `requireUser` whose
 * history is worth keeping: it called `auth.getClaims`, which did not exist in
 * the supabase-js version this function pinned, so every request died with a
 * TypeError *in the gate* — ahead of the request's try/catch. The isolate
 * answered 500 with no CORS headers, the browser was not allowed to read that,
 * and the chat showed "Failed to fetch".
 *
 * `gate` keeps both of those properties — it returns a verdict rather than
 * throwing, and every answer carries CORS headers, because a 401 the browser
 * cannot read is indistinguishable from the server being down — and adds the
 * second question: may this person spend the project's model budget right now.
 * Authentication was never an answer to that one.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const verdict = normalizeMessages(messages);
    if (!verdict.ok) return json({ error: verdict.reason }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Named plainly, because this is the one failure the owner can fix in a
      // minute and the one the old code reported as "Unknown error".
      return json(
        {
          error: "Jackie has no model key",
          detail: "Set the LOVABLE_API_KEY secret on this project, then try again.",
          code: "PROVIDER_UNCONFIGURED",
          needs_secret: "LOVABLE_API_KEY",
        },
        503,
      );
    }

    const { model: selectedModel } = resolveModel(model);

    // Charged last, after everything that could refuse for free: a malformed
    // body or a missing key is not a call, and billing it would spend the
    // caller's allowance on the chain's own bookkeeping (rule 5).
    const denied = await gate(req, "jackie-chat", selectedModel);
    if (denied) return denied;
    // GPT-5.6 on chat completions runs with reasoning on by default and rejects
    // tool-bearing requests unless effort is explicitly disabled.
    const extraFields = selectedModel.startsWith("openai/gpt-5.6")
      ? { reasoning_effort: "none" }
      : {};

    // An explicit system prompt is an Agent Lab agent's whole identity. This
    // function used to drop it and answer every agent as Jackie, so "Scout"
    // and "Auditor" were the same assistant under different names. Without
    // one, Jackie's persona is built exactly as before.
    const explicitSystem = typeof system === "string" ? system.trim() : "";
    if (explicitSystem.length > MAX_SYSTEM_CHARS) {
      return json({ error: "System prompt too large" }, 413);
    }
    const guarded = await guardedSystemPrompt("jackie-chat", { system: explicitSystem, context });
    const systemPrompt = guarded.prompt;

    // A gateway that accepts the connection and then never answers leaves the
    // browser holding an open stream with no content, which reads as "Jackie is
    // thinking" and never resolves. This bounds the wait for the *headers*
    // only, and is cleared the moment they arrive — a long answer that streams
    // for three minutes is working, and cutting it off at a deadline would be
    // the same silent truncation from the other direction.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    let response: Response;
    try {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          ...extraFields,
          messages: [{ role: "system", content: systemPrompt }, ...verdict.messages],
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      console.error("AI gateway unreachable:", e);
      return json(
        {
          error: aborted
            ? "The model took too long to answer. Try again, or pick a faster model."
            : "Could not reach the model gateway.",
          detail: String((e as Error)?.message || e),
        },
        504,
      );
    } finally {
      clearTimeout(timer);
      await guarded.recorded;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("AI gateway error:", response.status, text);

      if (response.status === 429) {
        return json({ error: "Rate limit exceeded. Please wait a moment and try again." }, 429);
      }
      if (response.status === 402) {
        return json({ error: "Usage limit reached. Please add credits to your workspace." }, 402);
      }
      if (response.status === 401 || response.status === 403) {
        return json(
          {
            error: "Jackie's model key was refused.",
            detail: "Check the LOVABLE_API_KEY secret on this project.",
          },
          502,
        );
      }
      // Everything else forwards the gateway's own words. "AI gateway error"
      // with the cause swallowed into a server log is not something the person
      // looking at the screen can do anything with.
      return json(
        {
          error: `The model gateway refused the request (HTTP ${response.status}).`,
          detail: text.slice(0, 500) || undefined,
          model: selectedModel,
        },
        502,
      );
    }

    if (!response.body) {
      return json({ error: "The model gateway returned an empty response." }, 502);
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        ...guarded.headers,
        "Content-Type": "text/event-stream",
        // Streaming through a proxy that buffers turns a live answer into a
        // long silence followed by everything at once.
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error("chat error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
