/**
 * Owner-only answer lock. Actions: status, set, clear, challenge, verify.
 *
 * Every check happens here, never in the browser: the client only ever sees
 * slot labels and verdicts, never a fingerprint, so it has nothing to
 * brute-force. The pending question is held server-side, so a caller cannot
 * pick the slot they find easiest.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import { requireOwnerUser } from "../_shared/entitlement.ts";
import {
  afterFailure, answerProblem, fingerprint, isLocked, ITERATIONS, newSalt,
  pickSlot, sameFingerprint, SLOTS, slotLabel, UNLOCK_MS,
} from "../_shared/answerLock.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const auth = await requireOwnerUser(req);
  if (auth instanceof Response) {
    const h = new Headers(auth.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(auth.body, { status: auth.status, headers: h });
  }
  const userId = auth.userId;

  const pepper = Deno.env.get("JACKIE_LOCK_PEPPER");
  if (!pepper) return json({ ok: false, code: "PROVIDER_UNCONFIGURED", error: "Lock key is not set up." });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is status */ }
  const action = String(body.action ?? "status");
  const now = Date.now();

  const { data: rows, error: slotErr } = await db.from("jackie_lock_slots").select("slot").eq("user_id", userId);
  if (slotErr) return json({ ok: false, error: "Could not read your lock." });
  const setSlots = (rows ?? []).map((r) => r.slot as number).sort();
  const { data: state } = await db.from("jackie_lock_state").select("*").eq("user_id", userId).maybeSingle();
  const saveState = (patch: Record<string, unknown>) =>
    db.from("jackie_lock_state").upsert({ user_id: userId, ...(state ?? {}), ...patch, updated_at: new Date().toISOString() });

  const status = () => ({
    ok: true,
    slots: SLOTS.map((s) => ({ slot: s, label: slotLabel(s), set: setSlots.includes(s) })),
    locked_until: isLocked(state, now) ? state!.locked_until : null,
    unlocked_until: state?.unlocked_until && Date.parse(state.unlocked_until) > now ? state.unlocked_until : null,
    pending: state?.pending_slot ? slotLabel(state.pending_slot) : null,
  });

  if (action === "status") return json(status());

  if (action === "set") {
    const slot = Number(body.slot);
    if (!SLOTS.includes(slot as never)) return json({ ok: false, error: "Pick a slot from q1A to q7A." });
    const problem = answerProblem(body.answer);
    if (problem) return json({ ok: false, error: problem });
    // Replacing an existing answer needs a fresh unlock, or a stolen session
    // could quietly rewrite the lock it is meant to stop.
    const unlocked = state?.unlocked_until && Date.parse(state.unlocked_until) > now;
    if (setSlots.includes(slot) && !unlocked) {
      return json({ ok: false, code: "UNLOCK_REQUIRED", error: "Pass the lock once before changing an answer you already set." });
    }
    const salt = newSalt();
    const fp = await fingerprint(String(body.answer), salt, pepper);
    const { error } = await db.from("jackie_lock_slots").upsert({
      user_id: userId, slot, salt, fingerprint: fp, iterations: ITERATIONS, updated_at: new Date().toISOString(),
    });
    if (error) return json({ ok: false, error: "Could not save that answer." });
    return json({ ok: true, saved: slotLabel(slot) });
  }

  if (action === "clear") {
    if (!(state?.unlocked_until && Date.parse(state.unlocked_until) > now)) {
      return json({ ok: false, code: "UNLOCK_REQUIRED", error: "Pass the lock before clearing answers." });
    }
    await db.from("jackie_lock_slots").delete().eq("user_id", userId);
    await saveState({ pending_slot: null, last_slot: null, failures: 0 });
    return json({ ok: true });
  }

  if (isLocked(state, now)) {
    return json({ ok: false, code: "LOCKED", error: "Too many wrong answers. Try again later.", locked_until: state!.locked_until });
  }

  if (action === "challenge") {
    const slot = state?.pending_slot && setSlots.includes(state.pending_slot)
      ? state.pending_slot
      : pickSlot(setSlots, state?.last_slot ?? null);
    if (!slot) return json({ ok: false, code: "EMPTY", error: "No answers are set yet." });
    await saveState({ pending_slot: slot });
    return json({ ok: true, question: slotLabel(slot) });
  }

  if (action === "verify") {
    const slot = state?.pending_slot;
    if (!slot) return json({ ok: false, error: "Ask for a question first." });
    if (typeof body.answer !== "string") return json({ ok: false, error: "Answer must be text." });
    const { data: row } = await db.from("jackie_lock_slots").select("salt, fingerprint, iterations")
      .eq("user_id", userId).eq("slot", slot).maybeSingle();
    if (!row) return json({ ok: false, error: "That question was removed. Ask again." });
    const fp = await fingerprint(body.answer, row.salt, pepper, row.iterations);
    if (sameFingerprint(fp, row.fingerprint)) {
      const until = new Date(now + UNLOCK_MS).toISOString();
      await saveState({ failures: 0, locked_until: null, pending_slot: null, last_slot: slot, unlocked_until: until });
      return json({ ok: true, unlocked_until: until });
    }
    const next = afterFailure({ failures: state?.failures ?? 0, locked_until: null }, now);
    // A wrong answer moves to a different question, so guessing one slot
    // repeatedly is not an option.
    await saveState({ ...next, pending_slot: null, last_slot: slot });
    return json({ ok: false, code: next.locked_until ? "LOCKED" : "WRONG", error: next.locked_until ? "Locked for 15 minutes." : "Not quite.", locked_until: next.locked_until });
  }

  return json({ ok: false, error: "Unknown action." });
}

Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { console.error("jackie-lock", e instanceof Error ? e.message : "error"); return json({ ok: false, error: "The lock hit an error." }); }
});
