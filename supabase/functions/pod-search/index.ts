import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { consumeQuota } from "../_shared/entitlement.ts";

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json();
    const query = String(body?.query ?? '').slice(0, 5000);
    const limit = Math.min(50, Math.max(1, Number(body?.limit ?? 10)));
    if (!query) return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (!lovableKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured', needs_secret: 'LOVABLE_API_KEY' }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // Metered like every other function that spends the project's AI credit.
    // This one was missed when the rest were gated, so any account could loop on
    // it without limit — and an empty balance takes the main chat down with it.
    const denied = await consumeQuota({ userId: userData.user.id, functionName: 'pod-search' });
    if (denied) return denied;

    const embRes = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': lovableKey },
      body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: query, dimensions: 768 }),
    });
    if (!embRes.ok) return new Response(JSON.stringify({ error: await embRes.text() }), { status: embRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const embJson = await embRes.json();
    const q = embJson?.data?.[0]?.embedding;
    // A 200 from the gateway carrying no vector is not a search that found
    // nothing, it is a search that never ran. Without this the RPC below was
    // handed `undefined`, failed, and the fallback presented the most recent
    // folds as `hits` while blaming a missing RPC that was never the problem.
    if (!Array.isArray(q)) {
      return new Response(JSON.stringify({ error: 'embedding provider returned no vector' }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(url, service);
    // Manual cosine similarity via SQL parameter.
    const { data, error } = await admin.rpc('match_pod_folds' as any, {
      query_embedding: q,
      match_user: userData.user.id,
      match_count: limit,
    });
    if (error) {
      // Fallback: the newest folds, which is not what was asked for. It is
      // returned because recent folds beat nothing, but it is labelled for
      // what it is and carries the real error — this used to assert the RPC
      // was missing whatever had actually gone wrong, so every failure in here
      // pointed at a migration that was usually already applied.
      const { data: folds } = await admin.from('pod_folds')
        .select('id,pod_id,router_id,capability,source_ref,source_hash,color,glyph,created_at')
        .eq('user_id', userData.user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      return new Response(JSON.stringify({
        hits: folds ?? [],
        ranked: false,
        degraded: 'recency',
        note: `similarity search failed, returning most recent folds instead: ${error.message}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ hits: data, ranked: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
