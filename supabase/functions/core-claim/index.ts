/**
 * Grants the caller the 'owner' role, but only if their own verified email is
 * already on the jackie_core_access allowlist.
 *
 * This used to be a database routine callable over the API by any signed-in
 * client. The privileged write happens here instead: the email comes from a
 * verified JWT, never from the request body, the allowlist is read with the
 * service role, and no caller-supplied identity is trusted at any point.
 *
 * The lookup was `.ilike("email", email)`. ILIKE is pattern matching, and `_`
 * and `%` are wildcards in a SQL pattern — on the one query that decides
 * whether to hand out 'owner'. An allowlisted address containing an underscore
 * (`jane_doe@example.com` is an ordinary address) would match `janexdoe@...`
 * for any x. Exact equality is only safe against a canonical stored form, so
 * 20260914120000 folds the column to lowercase and holds it there with a CHECK
 * constraint; this compares against that form.
 *
 * Verified email matters as much as the match. Supabase can be configured to
 * issue a session before the address is confirmed, and an unconfirmed address
 * is a claim about identity rather than proof of it — not enough to hand
 * someone the allowlisted account's role.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // A privilege grant is a state change. Restricting the method does not
  // replace authentication, but it keeps the grant off any path a browser can
  // be talked into issuing as a side effect of loading something.
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Not signed in" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    console.error("core-claim: Supabase configuration missing");
    return json({ error: "Service unavailable" }, 503);
  }

  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  const user = userData?.user;
  if (userErr || !user?.email) // 200 + verdict: the preview treats a 401 as a crash and blanks the screen.
    return json({ granted: false, reason: "invalid_session", error: "Sign in with an email account to claim Jackie Core." }, 200);

  if (!user.email_confirmed_at) {
    return json({ granted: false, reason: "email_not_verified" }, 403);
  }

  const normalizedEmail = user.email.trim().toLowerCase();
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed, error: allowlistErr } = await admin
    .from("jackie_core_access")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (allowlistErr) {
    console.error("core-claim: allowlist lookup failed", allowlistErr);
    return json({ error: "Authorization service unavailable" }, 503);
  }
  if (!allowed) return json({ granted: false, reason: "not_allowlisted" }, 403);

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: user.id, role: "owner" }, { onConflict: "user_id,role" });

  if (roleErr) {
    // The database message names constraints and columns; the caller gets none
    // of that on a privilege endpoint.
    console.error("core-claim: role grant failed", roleErr);
    return json({ error: "Could not grant role" }, 500);
  }

  return json({ granted: true });
}

// Anything unexpected still answers with CORS headers (rule 3). A throw that
// escapes the handler becomes a 500 the browser is not allowed to read, which it
// reports as "Failed to fetch" — naming neither this function nor the cause.
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("core-claim: unexpected failure", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
