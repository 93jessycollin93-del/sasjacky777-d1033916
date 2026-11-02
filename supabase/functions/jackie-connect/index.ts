/**
 * jackie-connect — the one place a request leaves for an outside service.
 *
 * docs/CONNECTIONS.md is the threat model; the T-numbers below refer to it.
 *
 * Actions (POST, JSON):
 *   call           {connection, operation, args, via?, carries_app_data?}
 *                  Runs one operation of one of the caller's active connections.
 *   set_secret     {connection_id, secret}   the person only, from the app
 *   clear_secret   {connection_id}           the person only, from the app
 *   secrets        {}                        which connections have a secret (never the secret)
 *
 * The secret is decrypted here, for one request, and nowhere else (T1). No
 * argument reaches the host, the method or a header (T2, T6). Every answer
 * carries CORS headers, failures included (rule 3).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, consumeQuota, corsHeaders, json, preflight, requireUser } from "../_shared/entitlement.ts";
import {
  buildRequest, checkCallArgs, CONNECTION_LIMITS, isPublicAddress, isWrite, redact, validateConnectionSpec, wrapResponse,
  type ConnectionOperation,
} from "../_shared/connections.ts";
import { checkSecretValue, importKey, open, seal, SecretBoxError } from "../_shared/secretBox.ts";

const FUNCTION_NAME = "jackie-connect";

interface StoredConnection {
  id: string;
  name: string;
  title: string;
  description: string;
  base_url: string;
  auth_type: "none" | "bearer" | "header" | "query";
  auth_name: string | null;
  operations: ConnectionOperation[];
  agents_may_write: boolean;
}

/**
 * Whether the caller is an agent harness: tokens the MCP server accepts carry
 * the OAuth client's id; the app's own session does not. requireUser has
 * already verified the token, so reading its payload here is safe.
 */
function clientIdOf(req: Request): string | null {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims?.client_id === "string" && claims.client_id ? claims.client_id : null;
  } catch {
    return null;
  }
}

/**
 * The addresses a host resolves to (T2). Deno.resolveDns where the runtime has
 * it; DNS over HTTPS otherwise. If neither answers, the call is refused — an
 * unchecked host is exactly what this exists to stop.
 */
async function resolve(host: string): Promise<string[]> {
  const out: string[] = [];
  const dns = (Deno as unknown as { resolveDns?: (h: string, t: string) => Promise<string[]> }).resolveDns;
  if (typeof dns === "function") {
    for (const type of ["A", "AAAA"]) {
      try {
        out.push(...(await dns(host, type)));
      } catch {
        /* no records of this type */
      }
    }
    if (out.length) return out;
  }
  for (const type of ["A", "AAAA"]) {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(4000),
      });
      const body = await r.json().catch(() => null) as { Answer?: Array<{ type: number; data: string }> } | null;
      for (const a of body?.Answer ?? []) if (a.type === 1 || a.type === 28) out.push(a.data);
    } catch {
      /* resolver unreachable */
    }
  }
  return out;
}

/** Reads at most `limit` bytes, then stops reading (T7). */
async function readCapped(resp: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  if (!resp.body) return { text: "", truncated: false };
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > limit) {
      chunks.push(value.slice(0, limit - size));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return { text: new TextDecoder().decode(all), truncated };
}

async function record(
  userId: string, actor: string, action: string, details: Record<string, unknown>, result: "success" | "denied" | "error",
) {
  const { error } = await adminClient().from("audit_events").insert({ user_id: userId, action, actor, category: "other", details, result });
  if (error) console.error(`${FUNCTION_NAME}: activity not recorded`, error.message);
}

/** Arguments as they go into the activity log: visible to the person, bounded. */
function loggable(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v]));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;
    const clientId = clientIdOf(req);

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") return json({ error: "Expected a JSON body" }, 400);
    const p = payload as Record<string, unknown>;
    const admin = adminClient();

    // ── secrets: the person only, from the app (T1) ───────────────────────
    if (p.action === "set_secret" || p.action === "clear_secret" || p.action === "secrets") {
      if (clientId) {
        return json({ error: "Only the person can see to a connection's secret, from the app. An agent cannot set, clear or list secrets.", code: "AGENT_REFUSED" }, 403);
      }
      if (p.action === "secrets") {
        const { data, error } = await admin.from("jackie_connection_secrets").select("connection_id,updated_at").eq("user_id", userId);
        if (error) return json({ error: `Could not read which secrets are set: ${error.message}` }, 500);
        return json({ secrets: data ?? [] });
      }
      const connectionId = typeof p.connection_id === "string" ? p.connection_id : "";
      const { data: conn, error: connError } = await admin
        .from("jackie_connections").select("id").eq("id", connectionId).eq("user_id", userId).maybeSingle();
      if (connError) return json({ error: `Could not find the connection: ${connError.message}` }, 500);
      if (!conn) return json({ error: "No such connection of yours." }, 404);
      if (p.action === "clear_secret") {
        const { error } = await admin.from("jackie_connection_secrets").delete().eq("connection_id", connectionId).eq("user_id", userId);
        if (error) return json({ error: `The secret was not cleared: ${error.message}` }, 500);
        await record(userId, "person", "connection.secret_cleared", { connection_id: connectionId }, "success");
        return json({ cleared: true });
      }
      const bad = checkSecretValue(p.secret);
      if (bad) return json({ error: bad }, 400);
      let key: CryptoKey;
      try {
        key = await importKey(Deno.env.get("CONNECTIONS_SECRET_KEY"));
      } catch (e) {
        return json({ error: (e as Error).message, code: "SECRET_KEY_MISSING", needs_secret: "CONNECTIONS_SECRET_KEY" }, 503);
      }
      const box = await seal(key, p.secret as string, userId, connectionId);
      const { error } = await admin.from("jackie_connection_secrets").upsert(
        { connection_id: connectionId, user_id: userId, iv: box.iv, ciphertext: box.ciphertext, updated_at: new Date().toISOString() },
        { onConflict: "connection_id" },
      );
      if (error) return json({ error: `The secret was not stored: ${error.message}` }, 500);
      await record(userId, "person", "connection.secret_set", { connection_id: connectionId }, "success");
      return json({ stored: true });
    }

    if (p.action !== "call") return json({ error: 'Unknown action. Use "call", "set_secret", "clear_secret" or "secrets".' }, 400);

    // ── call ────────────────────────────────────────────────────────────────
    const connectionName = typeof p.connection === "string" ? p.connection.trim() : "";
    const operationName = typeof p.operation === "string" ? p.operation.trim() : "";
    const args = (p.args && typeof p.args === "object" && !Array.isArray(p.args) ? p.args : {}) as Record<string, unknown>;
    // The verified token decides first: an external agent naming itself
    // "agent-lab" would otherwise have its calls recorded as an operator's.
    const via = clientId ? "mcp" : p.via === "agent-lab" ? "agent-lab" : "app";
    const actor = via === "app" ? "person" : `agent:${via}`;
    const isAgent = via !== "app";
    if (!connectionName || !operationName) return json({ error: "Name the connection and the operation." }, 400);

    const denied = await consumeQuota({ userId, functionName: FUNCTION_NAME });
    if (denied) return denied;

    const { data: row, error: rowError } = await admin
      .from("jackie_connections")
      .select("id,name,title,description,base_url,auth_type,auth_name,operations,agents_may_write")
      .eq("user_id", userId).eq("name", connectionName).eq("status", "active")
      .maybeSingle();
    if (rowError) return json({ error: `Could not read the connection: ${rowError.message}` }, 500);
    const conn = row as StoredConnection | null;
    if (!conn) return json({ error: `No active connection called "${connectionName}". list_connections shows the ones you can use.` }, 404);
    // Approval only flips a status, and the database's checks can lag the
    // validator's: a stored row is held to the same rules as a new one before
    // anything is sent on its behalf.
    const broken = validateConnectionSpec(conn);
    if (broken) {
      return json({ error: `"${connectionName}" cannot be used as saved: ${broken} The person can fix it on the Skills page.`, code: "CONNECTION_INVALID" }, 409);
    }

    const op = conn.operations.find((o) => o.name === operationName);
    if (!op) {
      return json({ error: `"${connectionName}" has no operation "${operationName}". It has: ${conn.operations.map((o) => o.name).join(", ")}.` }, 404);
    }
    const badArgs = checkCallArgs(op, args);
    if (badArgs) return json({ error: badArgs }, 400);

    // T3: writes are the person's unless they said agents may; app data goes
    // only where the person said it may.
    if (isWrite(op.method) && isAgent && !conn.agents_may_write) {
      await record(userId, actor, "connection.call", { connection: connectionName, operation: operationName, refused: "agents may not write" }, "denied");
      return json({
        error: `${connectionName}.${operationName} writes (${op.method}), and agents may not write to "${connectionName}". The person can allow it on the connection.`,
        code: "WRITE_NOT_ALLOWED",
      }, 403);
    }
    // Only a JSON true counts: a string "false" is truthy, and this is a grant.
    if (p.carries_app_data === true && op.accepts_app_data !== true) {
      await record(userId, actor, "connection.call", { connection: connectionName, operation: operationName, refused: "app data not accepted" }, "denied");
      return json({
        error: `${connectionName}.${operationName} is not marked as accepting app data, so a tool cannot feed it an earlier step's result. The person can mark it on the connection.`,
        code: "APP_DATA_NOT_ALLOWED",
      }, 403);
    }

    let request: ReturnType<typeof buildRequest>;
    try {
      request = buildRequest(conn.base_url, op, args);
    } catch (e) {
      return json({ error: `The request could not be built safely: ${(e as Error).message}.` }, 400);
    }
    const url = new URL(request.url);

    // T2: the host must resolve, and only to public addresses.
    const addresses = await resolve(url.hostname);
    if (addresses.length === 0) {
      return json({ error: `${url.hostname} did not resolve, or the resolver could not be reached. Nothing was sent.`, code: "DNS_FAILED" }, 502);
    }
    const privateOnes = addresses.filter((a) => !isPublicAddress(a));
    if (privateOnes.length) {
      await record(userId, actor, "connection.call", { connection: connectionName, operation: operationName, refused: `private address ${privateOnes[0]}` }, "denied");
      return json({ error: `${url.hostname} resolves to a private address (${privateOnes[0]}). Connections reach public services only. Nothing was sent.`, code: "PRIVATE_ADDRESS" }, 403);
    }

    // T1, T6: the secret goes in exactly one place, chosen by the person.
    const headers: Record<string, string> = { Accept: "application/json, text/plain;q=0.9, */*;q=0.5", "User-Agent": "SAS-JACKY-connections/1" };
    if (request.body) headers["Content-Type"] = "application/json";
    let secret: string | null = null;
    if (conn.auth_type !== "none") {
      const { data: box, error: boxError } = await admin
        .from("jackie_connection_secrets").select("iv,ciphertext").eq("connection_id", conn.id).eq("user_id", userId).maybeSingle();
      if (boxError) return json({ error: `Could not read the connection's secret: ${boxError.message}` }, 500);
      if (!box) return json({ error: `"${connectionName}" needs a secret and none is set. The person can add it on the Skills page.`, code: "NO_SECRET" }, 409);
      try {
        secret = await open(await importKey(Deno.env.get("CONNECTIONS_SECRET_KEY")), box as { iv: string; ciphertext: string }, userId, conn.id);
      } catch (e) {
        const message = e instanceof SecretBoxError ? e.message : "The secret could not be read.";
        return json({ error: message, code: "SECRET_UNUSABLE" }, 503);
      }
      if (conn.auth_type === "bearer") headers.Authorization = `Bearer ${secret}`;
      else if (conn.auth_type === "header") headers[conn.auth_name as string] = secret;
      else url.searchParams.set(conn.auth_name as string, secret);
    }

    const started = Date.now();
    let upstream: Response;
    try {
      upstream = await fetch(url.toString(), {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual", // T2: a redirect could lead anywhere; it is reported, not followed.
        signal: AbortSignal.timeout(CONNECTION_LIMITS.timeoutMs),
      });
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      await record(userId, actor, "connection.call", { connection: connectionName, operation: operationName, args: loggable(args), error: timedOut ? "timeout" : "unreachable" }, "error");
      return json({ error: timedOut ? `${url.hostname} did not answer within ${CONNECTION_LIMITS.timeoutMs / 1000} seconds.` : `Could not reach ${url.hostname}.` }, 504);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => {});
      await record(userId, actor, "connection.call", { connection: connectionName, operation: operationName, args: loggable(args), status: upstream.status }, "error");
      return json({
        error: `${url.hostname} redirected (HTTP ${upstream.status}). Redirects are not followed, so a connection cannot be bounced somewhere it was not approved for. Use the final address as the base URL.`,
        code: "REDIRECT_NOT_FOLLOWED",
      }, 502);
    }

    const callDetails = { connection: connectionName, operation: operationName, method: op.method, args: loggable(args), status: upstream.status };
    // fetch resolves at the headers; the body can still stall past the
    // timeout or break. The request has been delivered by then, so the call is
    // recorded either way — a service that stalls its answers must not keep
    // what was sent to it off the person's activity trail.
    let read: { text: string; truncated: boolean };
    try {
      read = await readCapped(upstream, CONNECTION_LIMITS.readBytes);
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      await record(userId, actor, "connection.call", { ...callDetails, error: timedOut ? "answer timed out" : "answer unreadable", ms: Date.now() - started }, "error");
      return json({
        error: `The request reached ${url.hostname} (HTTP ${upstream.status}), but its answer ${timedOut ? `did not finish within ${CONNECTION_LIMITS.timeoutMs / 1000} seconds` : "could not be read"}.`
          + (isWrite(op.method) ? " It writes, so it may have taken effect: check before calling it again." : ""),
        code: timedOut ? "ANSWER_TIMEOUT" : "ANSWER_UNREADABLE",
      }, timedOut ? 504 : 502);
    }
    const wrapped = wrapResponse(
      connectionName, operationName, upstream.status,
      read.truncated ? `${redact(read.text, secret)}… (stopped reading at ${CONNECTION_LIMITS.readBytes} bytes)` : read.text,
      secret,
    );
    // Serialised before it is recorded as a success, so an answer that cannot
    // be sent is not logged as one that was.
    let answer: string;
    try {
      answer = JSON.stringify(wrapped);
    } catch {
      await record(userId, actor, "connection.call", { ...callDetails, error: "answer could not be serialised", ms: Date.now() - started }, "error");
      return json({ error: `${url.hostname} answered, but its answer could not be passed on.`, code: "ANSWER_UNREADABLE" }, 502);
    }
    await record(userId, actor, "connection.call", { ...callDetails, ms: Date.now() - started }, upstream.ok ? "success" : "error");
    return new Response(answer, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unexpected failure`, e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
