/**
 * Text a person reviews and a model reads must be the same text.
 *
 * Shared by the browser (the /skills review cards), the MCP server (agents'
 * proposals, via appActions) and jackie-connect, so every surface agrees on
 * what counts as hidden. No Deno globals, no browser globals.
 */

/**
 * Characters that change what a model reads without changing what a person
 * sees: bidi embeddings, overrides and isolates (which reorder text on
 * screen), and Unicode tag characters and supplementary variation selectors
 * (which render as nothing at all, yet carry ASCII a model decodes). An agent
 * proposing a skill with instructions spelled in tags would get them approved
 * by a person who saw only the harmless text around them. Nothing written for
 * a person needs them, so they are refused outright — by the validators, and
 * by the database for anything an agent writes.
 */
export const SMUGGLING_CHARS = /[\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/u;

/**
 * Characters that are invisible but legitimate somewhere (a zero-width space
 * in Thai, a soft hyphen, a byte-order mark): shown, not refused, so a review
 * card never displays less than an agent will read.
 */
const HIDDEN_CHARS = /[\u00AD\u180E\u200B\u200C\u200E\u200F\u2060-\u2064\uFEFF]|[\u202A-\u202E\u2066-\u2069]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu;

/** The text with every invisible character spelled out as ⟦U+XXXX⟧, and how many there were. */
export function revealHidden(text: string): { text: string; hidden: number } {
  let hidden = 0;
  const out = text.replace(HIDDEN_CHARS, (c) => {
    hidden += 1;
    return `⟦U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟧`;
  });
  return { text: out, hidden };
}

/** Which field, if any, carries a character that would hide text from the person reviewing it. */
export function smugglingProblem(fields: Record<string, unknown>): string | null {
  for (const [field, value] of Object.entries(fields)) {
    const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
    if (SMUGGLING_CHARS.test(text)) {
      return `The ${field} contains invisible or text-reordering characters (bidi controls or Unicode tags). Remove them: a person reviewing it would not see what an agent reads.`;
    }
  }
  return null;
}
