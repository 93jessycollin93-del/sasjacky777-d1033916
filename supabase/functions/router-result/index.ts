import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

// These headers are defined here rather than imported from
// `@supabase/supabase-js/cors`, the way the other thirty-odd functions define
// them. That subpath only exists from 2.95.0 while this project pins 2.58.0,
// so the import resolved only because the specifier floated on `@2` — a
// floating dependency in front of the gate of a deployed function, which is
// how this project lost the chat the first time. The values are the ones that
// module exports.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    const router_id = String(body?.router_id ?? '');
    const secret = String(body?.secret ?? '');
    const job_id = String(body?.job_id ?? '');
    const result = body?.result != null ? String(body.result) : null;
    const error = body?.error != null ? String(body.error) : null;
    if (!router_id || !secret || !job_id) return new Response(JSON.stringify({ error: 'router_id + secret + job_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: router } = await admin.from('mesh_routers').select('id,secret_hash,status').eq('id', router_id).maybeSingle();
    const secret_hash = await sha256(secret);
    if (!router || router.secret_hash !== secret_hash || router.status !== 'active') {
      return new Response(JSON.stringify({ error: 'invalid credentials' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Liveness is about the router, not about this job: it answered, its
    // credentials are good, it is alive. Refreshing here rather than on the
    // way out means a router posting a stale job_id no longer ages out of the
    // mesh for it — the same order router-poll uses.
    await admin.from('mesh_routers').update({ last_seen_at: new Date().toISOString() }).eq('id', router.id);

    // `.select()` is what makes this honest. The filter is job id AND the
    // router that claimed it, so a stale, finished or someone else's job_id
    // matches no rows — and an update matching nothing is not an error, it is
    // a 204 with `error: null`. Without asking which rows came back this
    // answered `ok: true`, the rig dropped a result it had already spent the
    // compute on, and the job sat 'claimed' until it aged out.
    const { data: updated, error: updErr } = await admin.from('mesh_jobs').update({
      status: error ? 'failed' : 'done',
      result,
      error,
      finished_at: new Date().toISOString(),
    }).eq('id', job_id).eq('router_id', router.id).select('id');

    if (updErr) return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!updated || updated.length === 0) {
      return new Response(
        JSON.stringify({ error: 'no claimed job with that id belongs to this router', job_id }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
