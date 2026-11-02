// pod-fetch — resolve a scanned seed QR to its registry record.
// Returns metadata only (color, glyph, capability, version, content_hash, sizes).
// The compressed pod blob never lives on the server; the caller verifies its
// local blob against content_hash, or asks the owning router for the payload.
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // User-scoped client: RLS decides what this session may read.
    const client = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await client.auth.getUser();
    if (!userData?.user) return json({ error: 'unauthorized' }, 401);

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const search = new URL(req.url).searchParams;
    const pod_id = String(body?.pod_id ?? search.get('pod_id') ?? '').trim();
    const pod_key = String(body?.pod_key ?? search.get('pod_key') ?? '').trim();
    const expect_hash = body?.hash ? String(body.hash) : search.get('hash');
    if (!pod_id && !pod_key) return json({ error: 'pod_id or pod_key required' }, 400);

    let q = client
      .from('eye_pod_registry')
      .select('id,pod_key,name,color,glyph,capability,version,content_hash,bytes_raw,bytes_compressed,updated_at');
    q = pod_id ? q.eq('id', pod_id) : q.eq('pod_key', pod_key);

    const { data, error } = await q.maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'seed not found for this session' }, 404);

    const hash_match = expect_hash ? expect_hash.replace(/^sha256:/, '') === (data.content_hash ?? '') : null;

    return json({
      seed: data,
      hash_match,
      payload_location: 'device-local (IndexedDB) — server holds metadata only',
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
