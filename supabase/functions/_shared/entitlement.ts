/**
 * The three questions every provider-backed function has to answer, in one
 * place.
 *
 * Authentication answers "who is this". It does not answer "may this person
 * spend money on this model", and roughly twenty functions here were treating
 * the first answer as if it settled the second: a valid session, any model
 * string the caller liked, and the project's provider key on the wire. The
 * model allowlist caps what one call may cost; the quota caps how many.
 *
 * Nothing here talks to a provider. It decides whether the call may happen and
 * hands back either a subject or the Response to return instead, so a function
 * body reads as a straight line and cannot accidentally continue past a
 * refusal.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { bearerToken, verifyAccessToken } from "./authGate.ts";
import { chooseModel, exceedsSize, parseAllowlist } from "./modelPolicy.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // The x-supabase-client-* headers are sent by newer supabase-js builds on
  // `functions.invoke`. A preflight that does not allow one fails the whole
  // call as "Failed to fetch", so they are listed rather than discovered.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export function preflight(): Response {
  return new Response(null, { headers: corsHeaders });
}

/**
 * Verifies the caller and returns their user id.
 *
 * Returns a Response on refusal rather than throwing, so the caller writes
 * `if (auth instanceof Response) return auth;` and cannot fall through.
 */
export async function requireUser(req: Request): Promise<{ userId: string } | Response> {
  const token = bearerToken(req.headers.get("Authorization"));
  if (!token) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    console.error("entitlement: SUPABASE_URL/SUPABASE_ANON_KEY missing");
    return json({ error: "Service unavailable", code: "MISCONFIGURED" }, 503);
  }

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await verifyAccessToken(sb.auth, token);
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string" || userId.length === 0) {
    return json({ error: "Unauthorized" }, 401);
  }
  return { userId };
}

/** Service-role client. Only ever used for decisions the caller must not make. */
export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new Error("Supabase service configuration missing");
  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Picks the model to use, or refuses.
 *
 * Fail-closed on purpose. The previous shape of this — a set of known-free
 * models used only to decorate an error message, with any caller string passed
 * through to the provider — is how an authenticated user bills an arbitrary
 * paid model to the project account.
 */
export function pickModel(
  requested: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
): { model: string } | { error: Response } {
  const choice = chooseModel(requested, allowed, fallback);
  if (choice.ok) return { model: choice.model };
  return {
    error: json(
      { error: "Model not allowed", code: "MODEL_NOT_ALLOWED", allowed: choice.allowed },
      400,
    ),
  };
}

/** Reads a comma-separated allowlist from the environment, with a default. */
export function allowlistFromEnv(name: string, fallback: readonly string[]): Set<string> {
  return parseAllowlist(Deno.env.get(name), fallback);
}

export interface QuotaOptions {
  userId: string;
  functionName: string;
  model?: string | null;
}

/**
 * Spends one unit of the caller's provider quota, or refuses.
 *
 * A refusal to decide is a refusal: if the quota service cannot be reached we
 * return 503 rather than waving the call through, because the failure mode of
 * the alternative is an unbounded bill.
 */
export async function consumeQuota(opts: QuotaOptions): Promise<Response | null> {
  let admin;
  try {
    admin = adminClient();
  } catch (e) {
    console.error("entitlement: cannot build admin client", e);
    return json(
      {
        error: "Jackie's server is missing its database credentials",
        detail:
          "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform; if they are absent " +
          "the function was not deployed through Supabase. Redeploy the edge functions.",
        code: "MISCONFIGURED",
      },
      503,
    );
  }

  const { data, error } = await admin.rpc("consume_provider_quota", {
    p_user_id: opts.userId,
    p_function: opts.functionName,
    p_model: opts.model ?? null,
  });

  if (error) {
    console.error(`entitlement: consume_provider_quota failed for ${opts.functionName}`, error);

    // A missing function is not an outage, and the difference decides what the
    // person does next. `consume_provider_quota` ships in
    // 20260914120000_authz_hardening.sql, and migrations in this project do not
    // run themselves — so on a database that never had `supabase db push` run
    // against it, this RPC is absent and EVERY gated function fails here. The
    // chat then walks its whole engine chain and each rung refuses for the same
    // reason, which reads as "the engines are down" when the truth is one
    // un-pushed migration. Reported as a transient outage, that is a thing you
    // wait out forever.
    const code = String((error as { code?: unknown }).code ?? "");
    const missing = code === "PGRST202" || code === "42883";

    return json(
      missing
        ? {
            error: "Jackie's quota function is missing from the database",
            detail:
              "consume_provider_quota does not exist on this project. Run `supabase db push` to apply " +
              "supabase/migrations/20260914120000_authz_hardening.sql, then try again. Until then every " +
              "engine will refuse for this same reason.",
            code: "QUOTA_FUNCTION_MISSING",
          }
        : { error: "Quota service unavailable", code: "QUOTA_UNAVAILABLE", detail: error.message },
      503,
    );
  }

  const verdict = (data ?? {}) as Record<string, unknown>;
  if (verdict.ok === true) return null;

  const reason = String(verdict.reason ?? "quota_exceeded");
  const retryAfter = Math.max(Number(verdict.retry_after) || 60, 1);

  if (reason === "rate_limited") {
    return json(
      {
        error: "Too many requests",
        detail: `Your per-minute AI allowance is used up. Try again in ${retryAfter} seconds.`,
        code: "RATE_LIMITED",
        retry_after: retryAfter,
      },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }
  if (reason === "quota_disabled") {
    return json({ error: "Provider access is disabled for this account", code: "QUOTA_DISABLED" }, 403);
  }
  return json(
    {
      // Named apart from the per-minute limit: "wait a moment" is the wrong
      // advice for a daily allowance that frees up over hours.
      error: "Daily AI quota used up",
      detail: "Your daily AI allowance is used up. It frees up gradually over the next 24 hours.",
      code: "QUOTA_EXCEEDED",
      retry_after: retryAfter,
    },
    429,
    { "Retry-After": String(retryAfter) },
  );
}

/** requireUser + consumeQuota, for the common case. */
export async function admit(
  req: Request,
  functionName: string,
  model?: string | null,
): Promise<{ userId: string } | Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const denied = await consumeQuota({ userId: auth.userId, functionName, model });
  if (denied) return denied;
  return auth;
}

/**
 * Turns an upstream failure into something safe to return.
 *
 * Provider bodies carry request ids, account and quota state, gateway
 * internals and occasionally billing detail. The detail belongs in the logs,
 * where an operator can read it; the client gets a status and a code it can
 * branch on.
 */
export async function providerFailure(context: string, upstream: Response): Promise<Response> {
  const detail = await upstream.text().catch(() => "<unreadable>");
  console.error(`${context}: upstream ${upstream.status}`, detail.slice(0, 1000));

  // The provider refusing *our* key is a server-side configuration fault. Passed
  // through as 401 it reads as "you are signed out" — the one diagnosis that is
  // certainly wrong — so it becomes a 502 that names the key.
  const keyRefused = upstream.status === 401 || upstream.status === 403;

  const code = keyRefused
    ? "PROVIDER_KEY_REFUSED"
    : upstream.status === 429
    ? "PROVIDER_RATE_LIMITED"
    : upstream.status === 402
    ? "PROVIDER_OUT_OF_CREDIT"
    : upstream.status === 404
    ? "MODEL_UNAVAILABLE"
    : upstream.status >= 500
    ? "PROVIDER_ERROR"
    : "INVALID_REQUEST";

  const error = keyRefused
    ? "The provider refused this project's API key. Check the secret in Cloud → Secrets."
    : upstream.status === 402
    ? "The provider account is out of credit."
    : upstream.status === 429
    ? "The provider is rate-limiting this project. Try again shortly, or pick another engine."
    : "Provider request failed";

  // 4xx from the provider is usually our request; surface it as 502 only when
  // the provider itself broke, so callers can tell "retry" from "fix this".
  const status = keyRefused || upstream.status >= 500 ? 502 : upstream.status;
  return json({ error, code, provider_status: upstream.status }, status);
}

/** Caps a JSON-serialisable payload by serialised size. */
export function tooLarge(value: unknown, maxChars: number): boolean {
  return exceedsSize(value, maxChars);
}

/**
 * Refuses anyone who does not hold the 'owner' role.
 *
 * Signing in proves who someone is, and this app lets anyone sign in: email
 * sign-up, Google, and a demo button. Some functions reach things that belong
 * to one person — the rig behind `jacky-proxy`, the GPU behind Bionic and
 * Ollama, the GitHub credential behind `github-sync` — and treating "signed
 * in" as "is the owner" handed all of them to every account. The role is the
 * one `core-claim` grants to allowlisted, verified addresses, read here with
 * the service role so no policy on `user_roles` can widen it.
 *
 * Checked before quota, so a refusal costs the caller nothing — the chat router
 * probes these engines on every message and a non-owner is a normal case.
 */
export async function requireOwner(userId: string): Promise<Response | null> {
  let admin;
  try {
    admin = adminClient();
  } catch (e) {
    console.error("entitlement: cannot build admin client for owner check", e);
    return json({ error: "Service unavailable", code: "MISCONFIGURED" }, 503);
  }
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .maybeSingle();
  if (error) {
    console.error("entitlement: owner lookup failed", error);
    return json({ error: "Authorization service unavailable", code: "OWNER_CHECK_FAILED" }, 503);
  }
  if (!data) {
    return json(
      {
        error: "This engine belongs to the project owner.",
        detail: "Only an account holding the owner role can use it. The owner claims it once through core-claim.",
        code: "OWNER_ONLY",
      },
      403,
    );
  }
  return null;
}

/** requireUser + requireOwner, without spending quota. */
export async function requireOwnerUser(req: Request): Promise<{ userId: string } | Response> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const denied = await requireOwner(auth.userId);
  return denied ?? auth;
}

/** requireOwnerUser + consumeQuota: an owner-only call that spends a unit. */
export async function admitOwner(
  req: Request,
  functionName: string,
  model?: string | null,
): Promise<{ userId: string } | Response> {
  const auth = await requireOwnerUser(req);
  if (auth instanceof Response) return auth;
  const denied = await consumeQuota({ userId: auth.userId, functionName, model });
  return denied ?? auth;
}

/**
 * Authenticate, then spend one unit of quota. Returns null to proceed, or the
 * Response to return instead.
 *
 * Deliberately the same `Promise<Response | null>` shape the per-function
 * `requireUser` gates already had, so adopting it is a one-line change at each
 * call site and the control flow around it does not move.
 */
export async function gate(
  req: Request,
  functionName: string,
  model?: string | null,
): Promise<Response | null> {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  return await consumeQuota({ userId: auth.userId, functionName, model });
}
