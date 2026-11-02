// jacky-proxy — eYe Wave 1 edge bridge to the real Jacky Flask engine.
//
// Mirrors jackie-ollama's pattern (CORS + Supabase-auth gate + env-configured
// upstream). Keeps the jacky host + token server-side and sidesteps CORS so
// Jackie can show real RTX-3090 telemetry and route real inference through the
// same engine PC uses. Matches the shared jackyClient contract.
//
// Env: JACKY_API_BASE (jacky host root, e.g. https://sas.example.com) and
// optional JACKY_API_TOKEN.
//
// Invoke (POST) with a JSON body:
//   { "path": "status" }
//   { "path": "ask", "method": "POST", "body": { "prompt": "…", "task_type": "general" } }
// Returns: { ok, status, data } — data is the upstream JSON.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { consumeQuota, requireOwnerUser } from "../_shared/entitlement.ts";
import { checkJackyPath } from "../_shared/jackyPath.ts";
import { guardedRigPrompt } from "../_shared/personaGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED = new Set(["GET", "POST"]);
const INFERENCE_PATH = /^(ask|squads\/[^/]+\/ask)$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Configuration before anything else. Jacky is the first link of the chat's
  // default chain, so an unset JACKY_API_BASE is the common case, and it must
  // cost the caller nothing — `needs_secret` tells the router to move on.
  const base = (Deno.env.get("JACKY_API_BASE") || "").replace(/\/+$/, "");
  const token = Deno.env.get("JACKY_API_TOKEN") || "";
  if (!base) {
    // 200 with an error envelope, not 503: an unconfigured link is a normal
    // state the Workstation probes on every load. A 503 was reported by the
    // preview as a crash that blanked the screen. Both clients (jackyClient,
    // jackie-router) already read `error` from the envelope and say why.
    return json(
      {
        ok: false,
        error: "jacky link not configured",
        detail: "Set the JACKY_API_BASE secret to your jacky host root.",
        code: "PROVIDER_UNCONFIGURED",
        needs_secret: "JACKY_API_BASE",
      },
      200,
    );
  }

  // The rig, its GPU controls and the server's token belong to one person.
  // Signed in is not enough: this app lets anyone sign in.
  const auth = await requireOwnerUser(req);
  if (auth instanceof Response) return auth;

  const payload = await req.json().catch(() => ({} as Record<string, unknown>));

  // The path is the security boundary: this proxy reaches a host that is not on
  // the internet and attaches the server's token to whatever it sends. It is
  // checked against an allowlist of the calls the client actually makes, so a
  // traversal cannot walk off the /api prefix onto the rest of the rig.
  const verdict = checkJackyPath((payload as any).path);
  if (!verdict.ok) return json({ error: verdict.reason }, 400);
  const rawPath = verdict.path!;
  const method = String((payload as any).method || "GET").toUpperCase();
  if (!ALLOWED.has(method)) return json({ error: `method ${method} not allowed` }, 405);

  // Only the calls that make the rig think spend quota. `status` and
  // `assessment` are telemetry that JackyLive polls every few seconds; charging
  // for them used the whole per-minute allowance on polling alone and left the
  // chat rate-limited for as long as that page was open.
  const inference = INFERENCE_PATH.test(rawPath);
  if (inference) {
    const denied = await consumeQuota({ userId: auth.userId, functionName: "jacky-proxy" });
    if (denied) return denied;
  }

  // Jacky is the first link of the chat's default chain, so it is the engine
  // that answers most often — and it was the one engine the owner's morals
  // never reached, with nothing anywhere saying so. Its persona is the rig's
  // own; the morals ride at the front of the prompt it is given, and the
  // request is attested like every other engine's.
  let body: unknown = (payload as any).body ?? {};
  let guarded: Awaited<ReturnType<typeof guardedRigPrompt>> | null = null;
  if (inference && method === "POST" && typeof (body as any)?.prompt === "string") {
    guarded = await guardedRigPrompt("jacky-proxy", (body as any).prompt);
    body = { ...(body as Record<string, unknown>), prompt: guarded.prompt };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const upstream = await fetch(`${base}/api/${rawPath}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await upstream.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return json({ ok: upstream.ok, status: upstream.status, data }, upstream.ok ? 200 : 502);
  } catch (e) {
    return json({ error: "jacky upstream unreachable", detail: String((e as Error)?.message || e) }, 502);
  } finally {
    clearTimeout(timer);
    if (guarded) await guarded.recorded;
  }
});
