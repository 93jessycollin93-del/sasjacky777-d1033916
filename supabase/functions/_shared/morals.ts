/**
 * The owner's morals: the part of Jackie's character the owner sets, as data.
 *
 * Shared by the engines (which add the block to every persona-built system
 * prompt) and by the browser (which recomputes the same fingerprint to check
 * that what the engines report running is what the owner wrote). One copy, so
 * the two sides cannot disagree about what a fingerprint means — a guard rail
 * whose two halves drift reports tampering that never happened, and after the
 * third false alarm nobody looks at it.
 *
 * Pure on purpose: no Deno, no DOM, no network. Web Crypto is in both.
 */

export const MORAL_CATEGORIES = ["honesty", "care", "privacy", "safety", "fairness", "custom"] as const;
export type MoralCategory = (typeof MORAL_CATEGORIES)[number];

/**
 * Mirrored by CHECK constraints and a trigger in the jackie_morals migration.
 * The block rides on every request, including to small local models whose
 * whole window is a few thousand tokens, so it is capped rather than trusted.
 */
export const MORAL_LIMITS = { maxMorals: 24, maxTitle: 80, maxRule: 280 } as const;

export interface Moral {
  id?: string;
  title: string;
  rule: string;
  category: MoralCategory;
  enabled: boolean;
  sort_order: number;
}

/**
 * Every function that answers in Jackie's name, and so reports what it ran.
 * The morals page lists each one — including those that have never reported,
 * which is the point: an engine that answers without attesting is the one a
 * guard rail most needs to show. A test walks supabase/functions and fails if a
 * function calls the guard without being listed here, or is listed without
 * calling it.
 */
export const PERSONA_ENGINES = [
  "jacky-proxy",
  "jackie-chat",
  "jackie-anthropic",
  "jackie-openrouter",
  "jackie-ollama",
  "jackie-bionic",
  "jackie-cerebras",
  "jackie-deepinfra",
  "jackie-deepseek",
  "jackie-fireworks",
  "jackie-google",
  "jackie-groq",
  "jackie-hf",
  "jackie-mistral",
  "jackie-openai",
  "jackie-together",
  "jackie-xai",
  "jackie-orchestrate",
  // Builds the prompt for Bonsai running in the owner's browser; the model
  // itself never touches a function, so this is where its attestation comes from.
  "jackie-device",
] as const;

/** What an engine reports when it had no morals to add, or could not load them. */
export const MORALS_NONE = "none";
export const MORALS_UNAVAILABLE = "unavailable";
/** The persona marker for a request that brought its own system prompt. */
export const OWN_PROMPT = "own-prompt";
/** The persona marker for Jacky, whose persona lives on the rig, out of sight. */
export const RIG_PERSONA = "rig";

export const MORALS_HEADING = "## Your owner's morals";

/**
 * The exact text added to Jackie's system prompt. Empty when nothing is enabled,
 * so an owner with no morals gets byte-for-byte the persona they had before.
 *
 * The preamble ranks them below the honesty rules on purpose: a moral that
 * could switch honesty off would make the guard rail the easiest way around it.
 */
export function buildMoralsBlock(morals: readonly Moral[]): string {
  const active = morals
    .filter((m) => m.enabled && m.rule.trim())
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  if (active.length === 0) return "";
  const lines = active.map((m) => `- ${oneLine(m.title)}: ${oneLine(m.rule)}`);
  return [
    MORALS_HEADING,
    "Your owner set these. Follow them in every answer. They add to your honesty rules and never override them: if one would need you to deceive or mislead, say so instead of doing it.",
    ...lines,
  ].join("\n");
}

/** SHA-256, lowercase hex. The same bytes give the same answer in Deno and every browser. */
export async function fingerprint(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The morals fingerprint an engine reports: of the block it added, or a marker for none. */
export async function moralsFingerprint(block: string): Promise<string> {
  return block ? await fingerprint(block) : MORALS_NONE;
}

// A newline inside a title or rule would let one moral forge the line of
// another — or a heading — in the prompt. Collapsed, not trusted.
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
