/**
 * API key management for a signed-in user.
 *
 * Everything here is a person acting on their own keys, so every action stays
 * behind the Supabase JWT gate. Runtime authentication — a bot presenting
 * `sk_live_...` with no session — moved to the `api-key-auth` function, which
 * is the only way it could ever have worked: this function verifies a user
 * before it dispatches on the action, so a bot never reached the /authenticate
 * branch that was written for it.
 *
 * The privileged client below bypasses RLS. That is the point of it, and it is
 * also the hazard: every id the caller supplies has to be proved theirs *here*,
 * because nothing downstream will do it. The composite foreign keys added in
 * 20260914120000 are the second line of that defence, not a substitute for it.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { bearerToken } from "../_shared/authGate.ts";
import { planRotation } from "../_shared/keyRotation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `sk_live_${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean);
  const action = path[1] || "";

  const authHeader = req.headers.get("Authorization");
  if (!bearerToken(authHeader)) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error("api-keys: Supabase configuration missing");
    return jsonResponse({ error: "Service unavailable" }, 503);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader! } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /** Confirms a row is the caller's before any privileged write touches it. */
  async function ownedRow(table: string, id: string): Promise<string | null> {
    if (!UUID.test(id)) return null;
    const { data, error } = await admin
      .from(table).select("id").eq("id", id).eq("user_id", user!.id).maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  }

  try {
    // ── POST /api-keys/create ──
    if (req.method === "POST" && action === "create") {
      const body = await req.json();
      const name = String(body.name || "").trim();
      if (!name || name.length > 100) return jsonResponse({ error: "Invalid name" }, 400);

      const scopes = Array.isArray(body.scopes)
        ? body.scopes.filter((s: unknown) => typeof s === "string" && s.length < 50).slice(0, 32)
        : ["bot:create"];
      const rateLimit = Math.min(Math.max(Number(body.rate_limit) || 60, 1), 1000);

      const rawKey = generateRawKey();
      const prefix = rawKey.slice(0, 16);

      const { error } = await admin.from("api_keys").insert({
        user_id: user.id,
        name,
        key_hash: await sha256(rawKey),
        prefix,
        scopes,
        rate_limit: rateLimit,
      });
      if (error) throw error;

      // Raw key returned once. Only its hash is stored, so this is the only
      // moment it exists anywhere we control.
      return jsonResponse({ raw_key: rawKey, prefix, name, scopes, rate_limit: rateLimit });
    }

    // ── POST /api-keys/rotate ──
    //
    // One RPC, one transaction. Issuing the replacement, carrying the bot links
    // across and retiring the original used to be three statements: if the last
    // failed, the caller got an error and the system kept a live replacement key
    // whose secret had never been delivered to anyone.
    if (req.method === "POST" && action === "rotate") {
      const body = await req.json();
      const keyId = String(body.key_id || "");
      if (!UUID.test(keyId)) return jsonResponse({ error: "key_id required" }, 400);

      const { data: existing, error: readErr } = await admin
        .from("api_keys")
        .select("id, name, scopes, rate_limit, superseded_by")
        .eq("id", keyId).eq("user_id", user.id).maybeSingle();
      if (readErr) throw readErr;
      if (!existing) return jsonResponse({ error: "Key not found" }, 404);
      if (existing.superseded_by) {
        return jsonResponse({ error: "This key has already been rotated" }, 409);
      }

      const plan = planRotation({ graceHours: Number(body.grace_hours), now: Date.now() });
      const rawKey = generateRawKey();
      const prefix = rawKey.slice(0, 16);

      const { data: rotation, error: rotationErr } = await admin.rpc("rotate_api_key_atomic", {
        p_user_id: user.id,
        p_key_id: existing.id,
        p_key_hash: await sha256(rawKey),
        p_prefix: prefix,
        p_rotated_at: plan.rotatedAt,
        p_expires_at: plan.expiresAt,
        p_immediate: plan.immediate,
      });

      if (rotationErr) {
        // The RPC raises these two by name; both are the caller's situation,
        // not a fault, so they get their own status rather than a 500.
        const message = rotationErr.message ?? "";
        if (message.includes("KEY_ALREADY_ROTATED")) {
          return jsonResponse({ error: "This key has already been rotated" }, 409);
        }
        if (message.includes("KEY_NOT_FOUND")) {
          return jsonResponse({ error: "Key not found" }, 404);
        }
        throw rotationErr;
      }

      const result = (rotation ?? {}) as Record<string, unknown>;
      if (!result.replacement_id) throw new Error("rotation returned no replacement key");

      return jsonResponse({
        raw_key: rawKey,
        prefix,
        name: existing.name,
        scopes: existing.scopes,
        rate_limit: existing.rate_limit,
        replaced_key_id: existing.id,
        replacement_key_id: result.replacement_id,
        expires_at: plan.expiresAt,
        grace_hours: plan.graceHours,
        bots_carried_over: Number(result.bots_carried_over || 0),
      });
    }

    // ── POST /api-keys/revoke ──
    if (req.method === "POST" && action === "revoke") {
      const { key_id } = await req.json();
      if (!UUID.test(String(key_id ?? ""))) return jsonResponse({ error: "key_id required" }, 400);

      const { error } = await admin.from("api_keys")
        .update({ is_active: false })
        .eq("id", key_id).eq("user_id", user.id);
      if (error) throw error;
      return jsonResponse({ success: true });
    }

    // ── GET /api-keys/list ──
    if (req.method === "GET" && action === "list") {
      const { data, error } = await admin.from("api_keys")
        .select("id, name, prefix, scopes, rate_limit, is_active, created_at, last_used_at, expires_at, rotated_from, rotated_at, superseded_by")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return jsonResponse({ keys: data });
    }

    // ── POST /api-keys/authenticate ── (moved)
    if (req.method === "POST" && action === "authenticate") {
      return jsonResponse({
        error: "Runtime API-key authentication moved to the api-key-auth function.",
        code: "MOVED",
        function: "api-key-auth",
      }, 410);
    }

    // ── POST /api-keys/log-usage ──
    if (req.method === "POST" && action === "log-usage") {
      const { api_key_id, endpoint, status_code, response_time_ms } = await req.json();
      if (!api_key_id || !endpoint) return jsonResponse({ error: "Missing fields" }, 400);

      // The key id arrives from the caller and is written with the service
      // role. Without this check a signed-in user could attribute traffic to
      // anyone else's key.
      const ownedKey = await ownedRow("api_keys", String(api_key_id));
      if (!ownedKey) return jsonResponse({ error: "API key not found" }, 404);

      const { error } = await admin.from("api_usage_logs").insert({
        api_key_id: ownedKey,
        user_id: user.id,
        endpoint: String(endpoint).slice(0, 255),
        status_code: Number(status_code) || 200,
        response_time_ms: Math.max(Number(response_time_ms) || 0, 0),
      });
      if (error) throw error;
      return jsonResponse({ logged: true });
    }

    // ── GET /api-keys/usage ──
    if (req.method === "GET" && action === "usage") {
      const keyId = url.searchParams.get("key_id");
      let query = admin.from("api_usage_logs")
        .select("id, api_key_id, endpoint, status_code, response_time_ms, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (keyId) {
        if (!UUID.test(keyId)) return jsonResponse({ error: "Invalid key_id" }, 400);
        query = query.eq("api_key_id", keyId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return jsonResponse({ logs: data });
    }

    // ── POST /api-keys/link-bot ──
    if (req.method === "POST" && action === "link-bot") {
      const { bot_id, api_key_id } = await req.json();
      if (!bot_id || !api_key_id) {
        return jsonResponse({ error: "bot_id and api_key_id required" }, 400);
      }

      // Both ids are caller-supplied and the insert is privileged, so both have
      // to be proved the caller's — checking one and not the other still lets a
      // relationship cross the tenant boundary.
      const [ownedKey, ownedBot] = await Promise.all([
        ownedRow("api_keys", String(api_key_id)),
        ownedRow("user_bots", String(bot_id)),
      ]);
      if (!ownedKey || !ownedBot) return jsonResponse({ error: "Bot or API key not found" }, 404);

      const { error } = await admin.from("bot_api_keys")
        .insert({ bot_id: ownedBot, api_key_id: ownedKey, user_id: user.id });
      if (error) {
        // Already linked is the desired end state, not a failure.
        if (error.code === "23505") return jsonResponse({ linked: true, already_linked: true });
        throw error;
      }
      return jsonResponse({ linked: true });
    }

    // ── DELETE /api-keys/unlink-bot ──
    if (req.method === "DELETE" && action === "unlink-bot") {
      const botId = url.searchParams.get("bot_id");
      const apiKeyId = url.searchParams.get("api_key_id");
      if (!botId || !apiKeyId) {
        return jsonResponse({ error: "bot_id and api_key_id required" }, 400);
      }
      const { error } = await admin.from("bot_api_keys")
        .delete()
        .eq("bot_id", botId).eq("api_key_id", apiKeyId).eq("user_id", user.id);
      if (error) throw error;
      return jsonResponse({ unlinked: true });
    }

    return jsonResponse({ error: "Not found" }, 404);
  } catch (e) {
    // Postgres error messages name constraints, columns and occasionally row
    // values. The operator gets that from the logs; the caller gets a status.
    console.error("api-keys error:", e);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
