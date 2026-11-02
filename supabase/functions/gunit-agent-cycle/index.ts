import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { consumeQuota } from "../_shared/entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function callAI(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("RATE_LIMITED");
    if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`AI error: ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

/** Carries a quota refusal out of a cycle, so it is returned as-is rather than as a 500. */
class QuotaRefused extends Error {
  constructor(readonly response: Response) {
    super("quota refused");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { goal, agentId } = await req.json();
    if (!goal || typeof goal !== "string") {
      return new Response(JSON.stringify({ error: "Goal required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured", needs_secret: "LOVABLE_API_KEY" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Metered per model call — a cycle is four of them — like every other function that spends the project's AI credit.
    // This one was missed when the rest were gated, so any account could loop on
    // it without limit — and an empty balance takes the main chat down with it.
    const apiKey: string = LOVABLE_API_KEY;
    const userId: string = user.id;
    const metered = async (system: string, prompt: string) => {
      const denied = await consumeQuota({ userId, functionName: "gunit-agent-cycle" });
      if (denied) throw new QuotaRefused(denied);
      return callAI(apiKey, system, prompt);
    };
    const sys = "You are G-UNIT, an AI agent execution system. Be precise, tactical, and thorough.";

    // Update agent status
    if (agentId) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("gunit_agents").update({ status: "active", last_run_at: new Date().toISOString() }).eq("id", agentId);
    }

    // Step 1: Plan
    const plan = await metered(sys, `Create a detailed execution plan for this goal: "${goal}". List 3-5 concrete steps.`);

    // Step 2: Execute
    const execution = await metered(sys, `Execute this plan step by step and describe the results:\n\nGoal: ${goal}\nPlan: ${plan}`);

    // Step 3: Analyze
    const analysis = await metered(sys, `Analyze the execution results. Identify strengths, weaknesses, and gaps:\n\nGoal: ${goal}\nExecution: ${execution}`);

    // Step 4: Improve + Score
    const improvement = await metered(sys, `Based on this analysis, provide specific improvements and score the overall result from 1-10. End your response with exactly "SCORE: X" where X is 1-10.\n\nGoal: ${goal}\nAnalysis: ${analysis}`);

    // Extract score
    const scoreMatch = improvement.match(/SCORE:\s*(\d+)/i);
    const score = scoreMatch ? Math.min(10, Math.max(0, parseInt(scoreMatch[1]))) : 5;

    // Save improvement
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("gunit_improvements").insert({
      user_id: user.id, goal, execution, analysis, improvement, score,
    });

    // Reset agent status
    if (agentId) {
      await admin.from("gunit_agents").update({ status: "idle" }).eq("id", agentId);
    }

    return new Response(JSON.stringify({ plan, execution, analysis, improvement, score }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof QuotaRefused) return e.response;
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg === "RATE_LIMITED" ? 429 : msg === "CREDITS_EXHAUSTED" ? 402 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
