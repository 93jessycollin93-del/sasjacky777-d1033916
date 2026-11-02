/**
 * Runtime authentication for a bot holding only an API key.
 *
 * The `api-keys` function advertised an /authenticate action "for bot runtime",
 * but it verified a Supabase user session before it looked at which action was
 * being called. A standalone bot has no session — that is the entire reason it
 * was issued a key — so it failed the check before reaching the code written
 * for it. The endpoint could never once have served its stated purpose.
 *
 * Splitting it out is what makes both halves honest: key *management* is a
 * signed-in user acting on their own keys and keeps the JWT gate, while key
 * *use* is a bearer secret and needs no session at all. This function is
 * therefore deployed with verify_jwt = false, and does its own authentication
 * by hashing the presented key — the raw key is never stored, so the hash is
 * the only thing that can be compared.
 *
 * Admission and rate limiting happen together inside consume_api_key(), which
 * counts and admits in one transaction behind a row lock. The previous design
 * counted rows the caller was trusted to write afterwards, through a different
 * endpoint, which a bot could simply decline to call.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Keys minted by `api-keys` are `sk_live_` + 64 hex. The Gunit panel
 * historically minted `gunit_` + 64 hex into the same table, and those keys are
 * still valid rows, so both shapes are accepted. This is input hygiene, not
 * authentication: only the hash lookup decides anything.
 */
const KEY_SHAPE = /^(?:sk_live|gunit)_[a-f0-9]{64}$/i;

function presentedKey(req: Request, body: Record<string, unknown>): string | null {
  const header = req.headers.get("Authorization")?.trim() ?? "";
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header);
  const candidate = match?.[1] ?? (typeof body.api_key === "string" ? body.api_key.trim() : "");
  return KEY_SHAPE.test(candidate) ? candidate : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // A key in the Authorization header and no body at all is a valid request.
  }

  const apiKey = presentedKey(req, body);
  if (!apiKey) return json({ error: "Valid API key required" }, 401);

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim().slice(0, 255) : "";

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) {
    console.error("api-key-auth: Supabase service configuration missing");
    return json({ error: "Service unavailable" }, 503);
  }

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await admin.rpc("consume_api_key", {
      p_key_hash: await sha256(apiKey),
      p_endpoint: endpoint || "runtime",
    });

    if (error) {
      console.error("api-key-auth: consume_api_key failed", error);
      return json({ error: "Authentication service unavailable" }, 503);
    }

    const verdict = (data ?? {}) as Record<string, unknown>;

    if (verdict.ok !== true) {
      switch (verdict.reason) {
        case "rate_limited": {
          const retryAfter = Math.max(Number(verdict.retry_after) || 60, 1);
          return json(
            { error: "Rate limit exceeded", code: "RATE_LIMITED", retry_after: retryAfter },
            429,
            { "Retry-After": String(retryAfter) },
          );
        }
        case "rotated":
          return json({
            error: "This key was rotated and its grace period has ended. Use the key that replaced it.",
            code: "KEY_ROTATED",
            rotated: true,
          }, 403);
        case "expired":
          return json({ error: "This key has expired.", code: "KEY_EXPIRED" }, 403);
        default:
          // One message for "no such key" and "revoked" alike: distinguishing
          // them tells an attacker which guesses were real keys.
          return json({ error: "Invalid or revoked API key", code: "KEY_INVALID" }, 403);
      }
    }

    return json({
      valid: true,
      key_id: verdict.key_id,
      user_id: verdict.user_id,
      scopes: verdict.scopes ?? [],
      rate_limit: verdict.rate_limit,
    });
  } catch (e) {
    console.error("api-key-auth: unexpected failure", e);
    return json({ error: "Internal error" }, 500);
  }
});
