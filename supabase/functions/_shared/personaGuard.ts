/**
 * The system prompt every engine sends, and a record of which one it was.
 *
 * Every persona-built prompt now carries the owner's morals, read here from
 * the database with the service role — never from the request, because a
 * caller who could send the morals could also leave them out. And every
 * request leaves an attestation behind: which persona and which morals this
 * engine actually ran, by fingerprint, or that a caller replaced the persona
 * with a system prompt of its own. The morals page compares those against what
 * the owner sealed, which is how a change nobody announced becomes visible.
 *
 * Call it only after the request has been admitted: it reads the database and
 * writes the attestation, and neither is for an anonymous caller to trigger.
 *
 * It never throws. If the morals cannot be loaded the answer still goes out on
 * the base persona — refusing would take the whole chat down until a migration
 * is pushed — but the attestation says "persona-without-morals" and why, so the
 * morals page shows it in red rather than letting it pass as normal (rule 8).
 */
import { adminClient } from "./entitlement.ts";
import { clampContext } from "./chatRequest.ts";
import { buildSystemPrompt, PERSONA_SOURCE } from "./persona.ts";
import {
  buildMoralsBlock, fingerprint, moralsFingerprint, MORALS_UNAVAILABLE, OWN_PROMPT, RIG_PERSONA,
  type Moral,
} from "./morals.ts";

export type PromptMode = "persona" | "persona-without-morals" | "override" | "rig";

export interface GuardedPrompt {
  prompt: string;
  mode: PromptMode;
  /** For the response. Lets a browser or curl see what was sent. */
  headers: Record<string, string>;
  /** Settles when the attestation is written or has failed. Never rejects. */
  recorded: Promise<void>;
}

export const ATTESTATION_HEADERS = ["X-Jackie-Mode", "X-Jackie-Persona", "X-Jackie-Morals"] as const;

// The morals change a few times a month and are read on every message. Fifteen
// seconds keeps a burst of messages to one read, and is short enough that an
// edit is live before the owner has switched back to the chat. Whatever was
// used is what gets attested, so a stale read is visible, not hidden.
const CACHE_MS = 15_000;
let cachedMorals: { at: number; block: string; error?: string } | null = null;
// Until the migration is pushed the attestation RPC fails on every request.
// Remembering that for the same window keeps it to one failed call and one log
// line per isolate per window, rather than one of each per message.
let attestDownSince = 0;

async function loadMoralsBlock(): Promise<{ block: string; error?: string }> {
  if (cachedMorals && Date.now() - cachedMorals.at < CACHE_MS) return cachedMorals;
  let result: { block: string; error?: string };
  try {
    const { data, error } = await adminClient()
      .from("jackie_morals")
      .select("title, rule, category, enabled, sort_order")
      .eq("enabled", true)
      .order("sort_order");
    result = error
      ? { block: "", error: `could not read jackie_morals: ${error.message}` }
      : { block: buildMoralsBlock((data ?? []) as Moral[]) };
  } catch (e) {
    result = { block: "", error: `could not read jackie_morals: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (result.error) console.error(`personaGuard: ${result.error}`);
  cachedMorals = { at: Date.now(), ...result };
  return result;
}

async function attest(
  engine: string, mode: PromptMode, personaFp: string, moralsFp: string, detail: string | null,
): Promise<void> {
  if (Date.now() - attestDownSince < CACHE_MS) return;
  try {
    const { error } = await adminClient().rpc("record_persona_attestation", {
      p_engine: engine,
      p_mode: mode,
      p_persona_fp: personaFp,
      p_morals_fp: moralsFp,
      p_detail: detail,
    });
    if (error) {
      attestDownSince = Date.now();
      console.error(`personaGuard: attestation for ${engine} not recorded: ${error.message}`);
    }
  } catch (e) {
    attestDownSince = Date.now();
    console.error(`personaGuard: attestation for ${engine} not recorded`, e);
  }
}

function headersFor(mode: PromptMode, personaFp: string, moralsFp: string): Record<string, string> {
  return {
    "X-Jackie-Mode": mode,
    "X-Jackie-Persona": personaFp.slice(0, 16),
    "X-Jackie-Morals": moralsFp.slice(0, 16),
    "Access-Control-Expose-Headers": ATTESTATION_HEADERS.join(", "),
  };
}

/**
 * @param engine   the function's name, as the morals page lists it
 * @param system   the caller's own system prompt, if it sent one (already size-checked)
 * @param context  the caller's memory/project context
 */
export async function guardedSystemPrompt(
  engine: string,
  opts: { system?: unknown; context?: unknown },
): Promise<GuardedPrompt> {
  const explicit = typeof opts.system === "string" ? opts.system.trim() : "";

  if (explicit) {
    // An Agent Lab agent or an in-app operator brings its whole identity in
    // `system` — by design, so "Scout" is not Jackie under another name. The
    // owner's morals are not added: they are Jackie's, and appending prose to a
    // prompt that must answer in strict JSON breaks the agent.
    //
    // Recorded under one marker, not a hash of the caller's prompt: any signed-in
    // account can send a system prompt, and keying on its hash let each one add
    // a row of its own — growing the table, and burying the rows that matter.
    return {
      prompt: explicit,
      mode: "override",
      headers: headersFor("override", OWN_PROMPT, "n/a"),
      recorded: attest(engine, "override", OWN_PROMPT, "n/a", null),
    };
  }

  const morals = await loadMoralsBlock();
  const prompt = buildSystemPrompt(clampContext(opts.context), morals.block);
  const personaFp = await fingerprint(PERSONA_SOURCE);
  const mode: PromptMode = morals.error ? "persona-without-morals" : "persona";
  const moralsFp = morals.error ? MORALS_UNAVAILABLE : await moralsFingerprint(morals.block);
  return {
    prompt,
    mode,
    headers: headersFor(mode, personaFp, moralsFp),
    recorded: attest(engine, mode, personaFp, moralsFp, morals.error ?? null),
  };
}

/**
 * For an engine that brings its own persona and takes one flat prompt: Jacky,
 * the owner's rig behind jacky-proxy. Its persona lives on the rig, out of this
 * code's sight, so it is attested as "rig" rather than with a fingerprint this
 * function could not honestly vouch for. The morals are put in front of the
 * prompt, which is the one part of the request this side controls.
 */
export async function guardedRigPrompt(engine: string, prompt: string): Promise<GuardedPrompt> {
  const morals = await loadMoralsBlock();
  const moralsFp = morals.error ? MORALS_UNAVAILABLE : await moralsFingerprint(morals.block);
  return {
    prompt: morals.block ? `${morals.block}\n\n${prompt}` : prompt,
    mode: "rig",
    headers: headersFor("rig", RIG_PERSONA, moralsFp),
    recorded: attest(engine, "rig", RIG_PERSONA, moralsFp, morals.error ?? null),
  };
}
