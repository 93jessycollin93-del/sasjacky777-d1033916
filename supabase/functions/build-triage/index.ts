/**
 * build-triage — groups pasted build errors, explains likely causes, and ranks fixes.
 *
 * Streams from the gateway's Responses API (a buffered call can time out while
 * billed work keeps running) and returns one JSON verdict. An empty or
 * unparseable answer is reported as a failure, never as "no problems" (rule 8).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gate } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MODEL = "openai/gpt-6-astra";
const MAX_LOG = 60_000;

const SYSTEM = `You triage software build output. Group failures that share one root cause
(a single missing import can produce dozens of errors). For each group give: a short title,
the likely cause, the files/lines involved, and a concrete fix. Rank groups by priority —
fix-first means fixing it is likely to clear other errors. Only use what the log shows; if the
cause is uncertain, say so in "confidence". Reply with ONLY a JSON object:
{"summary": string, "groups": [{"title": string, "priority": number, "severity": "blocker"|"error"|"warning",
"cause": string, "confidence": "high"|"medium"|"low", "locations": string[], "fix": string, "count": number}]}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return json({ error: "LOVABLE_API_KEY not configured", code: "PROVIDER_UNCONFIGURED", needs_secret: "LOVABLE_API_KEY" }, 503);

  try {
    const unauth = await gate(req, "build-triage", MODEL);
    if (unauth) return unauth;

    const body = await req.json().catch(() => ({}));
    const log = typeof body?.log === "string" ? body.log.trim() : "";
    if (!log) return json({ error: "Paste some build output first." }, 400);
    if (log.length > MAX_LOG) return json({ error: `That log is ${log.length} characters; paste at most ${MAX_LOG}.` }, 400);

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      signal: req.signal,
      headers: {
        "Lovable-API-Key": key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions: SYSTEM,
        input: [{ role: "user", content: log }],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      let message = detail.slice(0, 300) || `Gateway returned ${upstream.status}`;
      try { message = JSON.parse(detail)?.error?.message ?? JSON.parse(detail)?.message ?? message; } catch { /* keep text */ }
      if (upstream.status === 402) message = "AI credits are used up for this workspace. " + message;
      if (upstream.status === 429) message = "Too many requests right now — wait a moment and try again.";
      return json({ error: message }, upstream.status);
    }

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "", failed = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const ev = JSON.parse(p);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          if (ev.type === "response.failed" || ev.type === "error") failed = ev.response?.error?.message ?? ev.message ?? "The model failed.";
        } catch { /* partial frame */ }
      }
    }
    if (failed) return json({ error: failed }, 502);
    if (!text.trim()) return json({ error: "The model returned nothing — no triage was produced. Try again." }, 502);

    const match = text.match(/\{[\s\S]*\}/);
    try {
      const parsed = JSON.parse(match ? match[0] : text);
      if (!Array.isArray(parsed.groups)) throw new Error("no groups");
      parsed.groups.sort((a: { priority: number }, b: { priority: number }) => (a.priority ?? 99) - (b.priority ?? 99));
      return json({ ...parsed, model: MODEL });
    } catch {
      return json({ error: "The model's answer could not be read as a triage.", raw: text.slice(0, 4000) }, 502);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return new Response(null, { status: 499, headers: corsHeaders });
    return json({ error: e instanceof Error ? e.message : "Triage failed." }, 500);
  }
});
