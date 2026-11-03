/**
 * Micro context compressor and distributor for the thinking chain.
 *
 * Bonsai runs with a 4,096-token window, and most of that goes to the answer
 * and the step's instructions. A step that is handed a whole document does not
 * fail loudly — llama.cpp refuses it, or the model quietly reads only the tail.
 * So nothing reaches a step without passing through here first, and every cut
 * is extractive: sentences are kept or dropped whole, never paraphrased, so a
 * compressed note can only lose detail, never invent it. The full original
 * stays with the archivist.
 */

/** Hard ceiling on the notes any one step reads. ~500 tokens at 3.5 chars/token. */
export const STEP_NOTES_CHARS = 1800;

const STOP = new Set(
  "the a an and or but of to in on at for with is are was were be been it this that these those as by from i you we they he she my your our not no do does did have has had can will would should could what which who how why when where".split(
    " ",
  ),
);

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_./:-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Splits on sentence ends and line breaks, keeping each piece's original text. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Things a repair answer cannot afford to lose: numbers, error codes, paths,
 * versions. A sentence carrying one is kept ahead of prose that merely matches.
 */
const ANCHOR = /\b(0x[0-9a-f]+|\d+(\.\d+)*|[A-Z]{2,}\d*|[\w-]+\.(exe|sys|dll|log|json|md|ts|py)|[A-Za-z]:\\\S+|\/[\w./-]+)\b/;

/**
 * Keeps the sentences most relevant to `focus`, in their original order, until
 * `budget` characters. Never returns more than `budget`; a single sentence
 * longer than the budget is cut at a word boundary and marked so.
 */
export function compress(text: string, focus: string, budget: number): string {
  const clean = text.trim();
  if (clean.length <= budget) return clean;
  const want = keywords(focus);
  const parts = sentences(clean);
  const scored = parts.map((s, i) => {
    const words = keywords(s);
    let hits = 0;
    for (const w of words) if (want.has(w)) hits++;
    const score = hits * 2 + (ANCHOR.test(s) ? 1.5 : 0) + (i === 0 ? 0.5 : 0);
    return { s, i, score };
  });
  const ranked = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  const keep = new Set<number>();
  let used = 0;
  for (const { s, i } of ranked) {
    const cost = s.length + 1;
    if (used + cost > budget) continue;
    keep.add(i);
    used += cost;
  }
  if (keep.size === 0) {
    const cut = clean.slice(0, Math.max(0, budget - 1));
    const end = cut.lastIndexOf(" ");
    return (end > budget / 2 ? cut.slice(0, end) : cut).trimEnd() + "…";
  }
  return scored
    .filter(({ i }) => keep.has(i))
    .map(({ s }) => s)
    .join(" ");
}

export interface Note {
  /** Where it came from, shown to the step so it can say which note it used. */
  label: string;
  text: string;
}

/**
 * The distributor: gives one step only the slice of every note that bears on
 * its own question, split fairly so one long source cannot crowd out the rest.
 * The result is guaranteed to fit in `budget`.
 */
export function distribute(notes: Note[], focus: string, budget = STEP_NOTES_CHARS): string {
  if (notes.length === 0) return "";
  const header = (n: Note) => `[${n.label}] `;
  const overhead = notes.reduce((sum, n) => sum + header(n).length + 1, 0);
  const share = Math.max(0, Math.floor((budget - overhead) / notes.length));
  const out = notes
    .map((n) => header(n) + compress(n.text, focus, share))
    .join("\n");
  return out.length <= budget ? out : out.slice(0, budget);
}
