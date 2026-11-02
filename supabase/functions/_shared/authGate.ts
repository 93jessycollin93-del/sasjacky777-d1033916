/**
 * Verifying the caller's access token, in one place.
 *
 * Every authenticated edge function in this project opens the same way: take
 * the `Authorization: Bearer …` header, ask supabase-js whether it is a real
 * user token, and answer 401 if it is not. Twenty-one of them did it by
 * calling `auth.getClaims(token)` against a client pinned to
 * `@supabase/supabase-js@2.49.1`.
 *
 * `getClaims` does not exist in 2.49.1. It landed in 2.50.0. So the call was
 * not failing authentication — it was throwing `TypeError: ... is not a
 * function` before authentication was even attempted, on every request. The
 * throw happened in the gate, which in most of those functions sits *outside*
 * the request's try/catch, so the isolate answered 500 with no CORS headers at
 * all. The browser cannot read a response it was not allowed to see, so the
 * chat reported `TypeError: Failed to fetch` — a message that names neither
 * the version pin nor anything a person could act on. That is what "Jacky
 * won't respond" was.
 *
 * The pin is now 2.58.0 everywhere, so `getClaims` is really there. But a pin
 * is exactly the kind of thing that drifts again, and the failure mode last
 * time was total and silent. So this module does two things the raw call did
 * not:
 *
 *   1. It falls back to `getUser(token)`, which has existed for the whole v2
 *      line, whenever `getClaims` is missing or throws. A version skew then
 *      costs a slightly slower check, not the whole product.
 *   2. It never throws. Anything unexpected becomes a verdict, so the gate
 *      always returns and the caller always gets to answer with CORS headers
 *      attached.
 *
 * The returned shape is deliberately identical to `getClaims`' — `{ data:
 * { claims }, error }` — so every existing `if (error || !data?.claims)` reads
 * the same and nothing downstream had to change.
 *
 * No Deno or network imports live here, so `src/test/edge-auth-gate.test.ts`
 * imports this exact file. There is no second copy to drift.
 */

/** The supabase-js version every function in this project must pin. */
export const REQUIRED_SUPABASE_JS = "2.58.0";

export interface TokenClaims {
  sub?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuthVerdict {
  data: { claims: TokenClaims } | null;
  error: { message: string } | null;
  /** Which call produced the verdict. Diagnostic only; callers ignore it. */
  via?: "getClaims" | "getUser";
}

/** The slice of `supabase.auth` this needs. `getClaims` is optional on purpose. */
export interface AuthApi {
  getClaims?: (token: string) => Promise<unknown>;
  getUser: (token?: string) => Promise<unknown>;
}

function fail(message: string, via?: AuthVerdict["via"]): AuthVerdict {
  return { data: null, error: { message }, via };
}

function messageOf(error: unknown): string {
  if (!error) return "unauthorized";
  if (error instanceof Error) return error.message;
  const maybe = error as { message?: unknown };
  return typeof maybe?.message === "string" ? maybe.message : "unauthorized";
}

/**
 * Pulls the token out of an `Authorization` header.
 *
 * `replace("Bearer ", "")` was what every function used. It is case-sensitive
 * and leaves the rest of the string alone, so `bearer abc` became `bearer abc`
 * and was sent to be verified as if it were a token. Returning null instead
 * means the caller answers 401 rather than asking the auth server about
 * nonsense.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** Reads `{ data: { claims } }` out of whatever `getClaims` returned. */
function claimsFromGetClaims(result: unknown): TokenClaims | null {
  const payload = (result as { data?: unknown } | null)?.data;
  if (!payload || typeof payload !== "object") return null;
  const claims = (payload as { claims?: unknown }).claims;
  return claims && typeof claims === "object" ? (claims as TokenClaims) : null;
}

/**
 * Reads `getUser`'s user and shapes it like claims.
 *
 * Callers only ever ask "is there a subject here", so mapping the three fields
 * that correspond to registered claims is enough and keeps the two paths
 * indistinguishable downstream.
 */
function claimsFromGetUser(result: unknown): TokenClaims | null {
  const payload = (result as { data?: unknown } | null)?.data;
  if (!payload || typeof payload !== "object") return null;
  const user = (payload as { user?: unknown }).user as
    | { id?: unknown; email?: unknown; role?: unknown }
    | null
    | undefined;
  if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
  return {
    sub: user.id,
    ...(typeof user.email === "string" ? { email: user.email } : {}),
    ...(typeof user.role === "string" ? { role: user.role } : {}),
  };
}

/**
 * Verifies an access token and returns a verdict. Never throws.
 *
 * `getClaims` is preferred: it verifies the JWT locally against the project's
 * JWKS, so it costs no round trip. `getUser` is the fallback and asks the auth
 * server directly — slower, but it has been there since v2.0 and cannot go
 * missing under a version bump.
 *
 * A *rejection* from `getClaims` (bad signature, expired) is final: the token
 * is not good and asking a second service the same question would only waste a
 * round trip. A *throw* is not final — it means the call itself did not work,
 * which is the case this function exists for — so that one falls through.
 */
export async function verifyAccessToken(auth: AuthApi, token: string | null): Promise<AuthVerdict> {
  if (typeof token !== "string" || token.trim().length === 0) {
    return fail("no bearer token");
  }

  if (typeof auth?.getClaims === "function") {
    try {
      const result = await auth.getClaims(token);
      const claims = claimsFromGetClaims(result);
      if (claims) return { data: { claims }, error: null, via: "getClaims" };
      const error = (result as { error?: unknown } | null)?.error;
      // A verdict, not a malfunction: the token was read and refused.
      return fail(messageOf(error), "getClaims");
    } catch {
      // The call itself did not work — a missing method, a broken build, a
      // JWKS fetch that failed. Fall through rather than lock everyone out.
    }
  }

  try {
    const result = await auth.getUser(token);
    const claims = claimsFromGetUser(result);
    if (claims) return { data: { claims }, error: null, via: "getUser" };
    return fail(messageOf((result as { error?: unknown } | null)?.error), "getUser");
  } catch (e) {
    return fail(messageOf(e), "getUser");
  }
}
