// Grounded answers from the operator's own Gemini Enterprise engine.
// Routed through the Lovable connector gateway; never calls Google directly.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gate } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const GATEWAY = "https://connector-gateway.lovable.dev/gemini_enterprise";

/** The stream is a JSON array, not NDJSON: pull complete top-level {...} objects out of the buffer. */
function extractObjects(buf: string): { objects: unknown[]; rest: string } {
  const objects: unknown[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  let consumed = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; continue; }
    if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(buf.slice(start, i + 1))); } catch { /* partial */ }
        consumed = i + 1;
        start = -1;
      }
    }
  }
  return { objects, rest: buf.slice(consumed) };
}

function mergeText(acc: string, next: string): string {
  if (!acc) return next;
  if (next.startsWith(acc)) return next;
  for (let k = Math.min(acc.length, next.length); k > 0; k--) {
    if (acc.endsWith(next.slice(0, k))) return acc + next.slice(k);
  }
  return `${acc}\n${next}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("GEMINI_ENTERPRISE_API_KEY");
  const projectId = Deno.env.get("GEMINI_ENTERPRISE_PROJECT_ID");
  const location = Deno.env.get("GEMINI_ENTERPRISE_LOCATION") ?? "global";
  const engineId = Deno.env.get("GEMINI_ENTERPRISE_ENGINE_ID");

  if (!lovableKey || !connKey || !projectId || !engineId) {
    return json({
      error: "Gemini Enterprise is not linked to this project yet.",
      needs_connection: "gemini_enterprise",
      missing: [
        !connKey && "GEMINI_ENTERPRISE_API_KEY",
        !projectId && "GEMINI_ENTERPRISE_PROJECT_ID",
        !engineId && "GEMINI_ENTERPRISE_ENGINE_ID",
        !lovableKey && "LOVABLE_API_KEY",
      ].filter(Boolean),
    }, 503);
  }

  // Charged only once the engine is known to be linked (rule 5).
  const un = await gate(req, "gemini-engine");
  if (un) return un;

  try {
    const { query, mode, session } = await req.json();
    if (typeof query !== "string" || !query.trim()) return json({ error: "query is required" }, 400);

    const collection = `projects/${projectId}/locations/${location}/collections/default_collection`;
    const engine = `${collection}/engines/${engineId}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connKey,
    };

    if (mode === "search") {
      const resp = await fetch(`${GATEWAY}/v1/${engine}/servingConfigs/default_search:search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, pageSize: 10 }),
      });
      const body = await resp.text();
      if (!resp.ok) {
        console.error(`gemini-engine search failed [${resp.status}]: ${body}`);
        return json({ error: "Gemini Enterprise search failed", status: resp.status, details: body }, resp.status);
      }
      return new Response(body, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Grounded assistant answer.
    const resp = await fetch(`${GATEWAY}/v1alpha/${engine}/assistants/default_assistant:streamAssist`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: { text: query },
        ...(session ? { session } : {}),
        toolsSpec: { vertexAiSearchSpec: {} },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`gemini-engine streamAssist failed [${resp.status}]: ${body}`);
      return json({ error: "Gemini Enterprise assist failed", status: resp.status, details: body }, resp.status);
    }

    const raw = await resp.text();
    const { objects } = extractObjects(raw);
    let text = "";
    let sessionOut: string | null = null;
    let skipped: string[] | null = null;
    const citations: { title?: string; uri?: string; domain?: string }[] = [];

    for (const o of objects as Record<string, any>[]) {
      const answer = o?.answer;
      if (answer?.state === "SKIPPED") skipped = answer.assistSkippedReasons ?? ["SKIPPED"];
      if (o?.sessionInfo?.session) sessionOut = o.sessionInfo.session;
      for (const reply of answer?.replies ?? []) {
        const content = reply?.groundedContent?.content;
        if (content?.thought) continue;
        if (typeof content?.text === "string" && content.text) text = mergeText(text, content.text);
        for (const ref of reply?.groundedContent?.textGroundingMetadata?.references ?? []) {
          const d = ref?.documentMetadata;
          if (d?.title || d?.uri) citations.push({ title: d?.title, uri: d?.uri, domain: d?.domain });
        }
      }
    }

    if (skipped && !text) {
      return json({ text: "", skipped, session: sessionOut, citations: [] });
    }
    return json({ text, session: sessionOut, citations });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
