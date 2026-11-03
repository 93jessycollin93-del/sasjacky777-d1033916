import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { decideLedgerEntry, nextBalance, PREMIUM_UPGRADE } from "../_shared/gameLedger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify user identity
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { action } = body;

    // ── Log Transaction ──
    // The request says what happened; gameLedger.ts decides how much it was
    // worth. The amount a client sends is used only for a spend, which can
    // only lower the balance.
    if (action === "log") {
      const decision = decideLedgerEntry(body.record);
      if (!decision.ok) {
        return json({ logged: false, error: decision.error, code: decision.code }, decision.status);
      }

      if (decision.needsPremium) {
        const { data: premium, error: premErr } = await admin
          .from("game_transactions").select("id")
          .eq("user_id", user.id).eq("transaction_type", "spend")
          .eq("source", PREMIUM_UPGRADE.source).eq("source_id", PREMIUM_UPGRADE.source_id)
          .limit(1).maybeSingle();
        if (premErr) throw premErr;
        if (!premium) {
          return json({ logged: false, code: "PREMIUM_NOT_RECORDED", error: "Premium rewards need the premium upgrade on the ledger first" }, 403);
        }
      }

      // One claim per tier per account. The lock table's unique key settles a
      // race that a "look for an earlier row" check would lose.
      if (decision.onceKey) {
        const { error: lockErr } = await admin.from("game_purchase_locks").insert({
          user_id: user.id, transaction_id: decision.onceKey, source: decision.source,
        });
        if (lockErr?.code === "23505") {
          return json({ logged: false, code: "ALREADY_CLAIMED", error: "That reward is already on the ledger" }, 409);
        }
        if (lockErr) throw lockErr;
      }

      // Derive canonical balance from the server-side ledger — never trust the
      // client-supplied balance_before / balance_after figures.
      const { data: prior, error: priorErr } = await admin
        .from("game_transactions")
        .select("balance_after")
        .eq("user_id", user.id)
        .eq("currency_type", decision.currency_type)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorErr) throw priorErr;

      const balance_before = Number(prior?.balance_after) || 0;
      const next = nextBalance(balance_before, decision.amount);
      if (!next.ok) return json({ logged: false, error: next.error, code: next.code, balance: balance_before }, next.status);
      const balance_after = next.after;

      const { error } = await admin.from("game_transactions").insert({
        user_id: user.id,
        transaction_type: decision.transaction_type,
        currency_type: decision.currency_type,
        amount: decision.amount,
        balance_before,
        balance_after,
        source: decision.source,
        source_id: decision.source_id,
        metadata: decision.metadata,
      });
      if (error) {
        // The claim did not land, so its lock must not keep it from landing later.
        if (decision.onceKey) {
          await admin.from("game_purchase_locks").delete()
            .eq("user_id", user.id).eq("transaction_id", decision.onceKey);
        }
        throw error;
      }
      return json({ logged: true, amount: decision.amount, balance_before, balance_after });
    }


    // ── Dedup Check ──
    if (action === "dedup") {
      const { transaction_id, source } = body;
      // "ledger:" ids belong to the claim locks above; a client must not be
      // able to pre-occupy or probe them through this door.
      if (!transaction_id || !source || String(transaction_id).startsWith("ledger:") || String(transaction_id).length > 200) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await admin.from("game_purchase_locks").insert({
        user_id: user.id,
        transaction_id: String(transaction_id),
        source: String(source),
      });

      if (error && error.code === "23505") {
        return new Response(JSON.stringify({ duplicate: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (error) throw error;

      return new Response(JSON.stringify({ duplicate: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("game-transaction error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
