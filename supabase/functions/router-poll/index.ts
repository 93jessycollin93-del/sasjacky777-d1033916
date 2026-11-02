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
    // Optional: the pod version this router currently holds locally.
    const pod_version = Number.isFinite(Number(body?.pod_version)) ? Number(body.pod_version) : null;
    if (!router_id || !secret) return new Response(JSON.stringify({ error: 'router_id + secret required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: router } = await admin.from('mesh_routers').select('id,user_id,secret_hash,capabilities,status,pod_id').eq('id', router_id).maybeSingle();
    const secret_hash = await sha256(secret);
    if (!router || router.secret_hash !== secret_hash || router.status !== 'active') {
      return new Response(JSON.stringify({ error: 'invalid credentials' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await admin.from('mesh_routers').update({ last_seen_at: new Date().toISOString() }).eq('id', router.id);

    // Pod-bound routers: the seed pod IS the application slice this router knows.
    let seed: { capability: string; version: number; content_hash: string | null; color: string | null; glyph: string | null } | null = null;
    let seed_update: { pod_id: string; version: number; hash: string | null; url: string } | null = null;
    if (router.pod_id) {
      const { data: pod } = await admin
        .from('eye_pod_registry')
        .select('id,capability,version,content_hash,color,glyph')
        .eq('id', router.pod_id)
        .maybeSingle();
      if (pod) {
        seed = { capability: pod.capability, version: pod.version, content_hash: pod.content_hash, color: pod.color, glyph: pod.glyph };
        if (pod_version !== null && pod.version > pod_version) {
          seed_update = {
            pod_id: pod.id,
            version: pod.version,
            hash: pod.content_hash,
            url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/pod-fetch`,
          };
        }
      }
    }

    // Capability set: pod-bound routers are narrowed to their pod's capability.
    const declared: string[] = router.capabilities ?? [];
    const caps = seed ? [seed.capability] : declared;

    const { data: job } = await admin
      .from('mesh_jobs')
      .select('id,capability_required,prompt')
      .eq('user_id', router.user_id)
      .eq('status', 'queued')
      .in('capability_required', caps.length ? caps : ['__none__'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const base = { seed, seed_update };

    if (!job) return new Response(JSON.stringify({ job: null, ...base }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: claimed, error: claimErr } = await admin
      .from('mesh_jobs')
      .update({ status: 'claimed', router_id: router.id, claimed_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id,capability_required,prompt')
      .maybeSingle();

    if (claimErr || !claimed) return new Response(JSON.stringify({ job: null, ...base }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ job: claimed, ...base }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
