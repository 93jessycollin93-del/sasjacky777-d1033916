/**
 * jackie-morals — what Jackie's persona is right now, and the owner's seal on it.
 *
 * Two actions, both owner-only and neither spending model quota:
 *
 *   status  the persona text and fingerprint as this function's deployed code
 *           has it, and the morals block every engine is adding right now.
 *   seal    records, in the append-only ledger, that the owner approves exactly
 *           this persona and these morals. Later changes are measured from here.
 *
 * The seal is computed here rather than sent by the browser. A page that could
 * say "seal fingerprint X" could seal anything; this function seals only what
 * the deployed code and the database actually hold, attributed to the owner the
 * gate verified.
 *
 * The persona text is returned to the owner only, and never bundled into the
 * client, for the same reason core-sync keeps the doctrine server-side:
 * anything imported by the browser is downloadable by anyone who loads the app.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, json, preflight, requireOwnerUser } from "../_shared/entitlement.ts";
import { PERSONA_SOURCE } from "../_shared/persona.ts";
import {
  buildMoralsBlock, fingerprint, moralsFingerprint, PERSONA_ENGINES, type Moral,
} from "../_shared/morals.ts";

const FUNCTION_NAME = "jackie-morals";
const MAX_NOTE_CHARS = 200;

async function currentMorals(): Promise<{ rows: Moral[]; block: string; error?: string }> {
  const { data, error } = await adminClient()
    .from("jackie_morals")
    .select("id, title, rule, category, enabled, sort_order")
    .order("sort_order");
  if (error) {
    // The likeliest cause is the migration not having been pushed yet, which
    // the owner can fix; say which table, not just that something failed.
    return { rows: [], block: "", error: `Could not read jackie_morals: ${error.message}` };
  }
  const rows = (data ?? []) as Moral[];
  return { rows, block: buildMoralsBlock(rows) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const owner = await requireOwnerUser(req);
    if (owner instanceof Response) return owner;

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return json({ error: "Expected a JSON body" }, 400);
    }
    const { action, note, expected } = payload as { action?: unknown; note?: unknown; expected?: unknown };

    const personaFp = await fingerprint(PERSONA_SOURCE);
    const morals = await currentMorals();
    const moralsFp = await moralsFingerprint(morals.block);

    if (action === "status") {
      return json({
        persona: { text: PERSONA_SOURCE, fingerprint: personaFp },
        morals: {
          block: morals.block,
          fingerprint: moralsFp,
          count: morals.rows.length,
          enabled: morals.rows.filter((m) => m.enabled).length,
          ...(morals.error ? { error: morals.error } : {}),
        },
        engines: PERSONA_ENGINES,
      });
    }

    if (action === "seal") {
      // Sealing over a read that failed would approve "no morals" when the
      // owner has some. Refuse and say why instead.
      if (morals.error) {
        return json({ error: morals.error, code: "MORALS_UNREADABLE" }, 503);
      }
      // The owner approves what the dialog showed them, not whatever is here by
      // the time they click. A deploy or an edit that landed in between would
      // otherwise be sealed without ever having been seen.
      const want = expected as { persona_fp?: unknown; morals_fp?: unknown } | undefined;
      if (typeof want?.persona_fp !== "string" || typeof want?.morals_fp !== "string") {
        return json({ error: "Say which persona and morals you are sealing (expected.persona_fp, expected.morals_fp)." }, 400);
      }
      if (want.persona_fp !== personaFp || want.morals_fp !== moralsFp) {
        return json(
          {
            error: "Jackie changed while you were reviewing: what is live now is not what you were shown. Re-check, review the difference, and seal again.",
            code: "SEAL_STALE",
          },
          409,
        );
      }
      const cleanNote = typeof note === "string" ? note.trim().slice(0, MAX_NOTE_CHARS) : "";
      const { data, error } = await adminClient().rpc("jackie_morals_seal", {
        p_actor: owner.userId,
        p_body: {
          persona_fp: personaFp,
          persona_text: PERSONA_SOURCE,
          morals_fp: moralsFp,
          morals_block: morals.block,
          morals: morals.rows,
          ...(cleanNote ? { note: cleanNote } : {}),
        },
      });
      if (error) {
        console.error(`${FUNCTION_NAME}: seal failed`, error);
        return json(
          { error: `The seal was not recorded: ${error.message}`, code: "SEAL_FAILED" },
          500,
        );
      }
      const entry = data as { seq?: number; hash?: string } | null;
      return json({ sealed: true, seq: entry?.seq ?? null, hash: entry?.hash ?? null });
    }

    return json({ error: 'Unknown action. Use "status" or "seal".' }, 400);
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unexpected failure`, e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
