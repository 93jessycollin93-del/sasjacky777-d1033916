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

function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const name = String(body?.name ?? '').trim().slice(0, 80);
    let capabilities = Array.isArray(body?.capabilities) ? body.capabilities.slice(0, 20).map((c: any) => String(c).slice(0, 40)) : [];
    const pod_id = body?.pod_id ? String(body.pod_id) : null;
    if (!name) return new Response(JSON.stringify({ error: 'name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const secret = randomSecret();
    const secret_hash = await sha256(secret);

    const admin = createClient(url, service);

    // Pod binding: the router inherits its seed pod's capability and nothing else.
    let bound: { id: string; capability: string; version: number } | null = null;
    if (pod_id) {
      const { data: pod } = await admin
        .from('eye_pod_registry')
        .select('id,capability,version,user_id')
        .eq('id', pod_id)
        .eq('user_id', userData.user.id)
        .maybeSingle();
      if (!pod) return new Response(JSON.stringify({ error: 'seed pod not found for this account' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      bound = { id: pod.id, capability: pod.capability, version: pod.version };
      capabilities = [pod.capability];
    }

    const { data, error } = await admin.from('mesh_routers').insert({
      user_id: userData.user.id,
      name,
      capabilities,
      secret_hash,
      pod_id: bound?.id ?? null,
    }).select('id').single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({ router_id: data.id, secret, pod: bound }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
