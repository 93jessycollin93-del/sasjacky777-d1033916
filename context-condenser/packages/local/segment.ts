/**
 * Sentence segmentation that carries UTF-8 BYTE offsets.
 *
 * Byte offsets are not incidental — every anchor in a condensate is a byte
 * span into the archived plaintext, so if segmentation only knew character
 * indices, rehydration would silently return shifted text the moment the
 * source contained a non-ASCII character.
 */

export interface Segment {
  text: string;
  /** [start, end) in UTF-8 bytes of the source. */
  span: [number, number];
  /** Position in the document, 0-based. */
  index: number;
}

/** UTF-8 byte length of one code point, from its UTF-16 representation. */
function byteLenAt(s: string, i: number): { bytes: number; units: number } {
  const code = s.codePointAt(i)!;
  if (code < 0x80) return { bytes: 1, units: 1 };
  if (code < 0x800) return { bytes: 2, units: 1 };
  if (code > 0xffff) return { bytes: 4, units: 2 }; // surrogate pair
  return { bytes: 3, units: 1 };
}

/**
 * Build a UTF-16 index -> UTF-8 byte offset table in one pass.
 * Length is s.length + 1 so the end offset of the last char is addressable.
 */
export function byteOffsets(s: string): Uint32Array {
  const table = new Uint32Array(s.length + 1);
  let byte = 0;
  let i = 0;
  while (i < s.length) {
    const { bytes, units } = byteLenAt(s, i);
    for (let u = 0; u < units; u++) table[i + u] = byte;
    byte += bytes;
    i += units;
  }
  table[s.length] = byte;
  return table;
}

// The NBSP is spelled as an escape, not typed literally: \s already matches
// U+00A0, but a raw one here is invisible in review and trips
// no-irregular-whitespace.
const BOUNDARY = /(?<=[.!?])[\s\u00a0]+|\n{2,}/g;

/**
 * Split into sentences. Deliberately conservative: it keeps anything that
 * survives trimming, including fragments and list items, because discarding
 * them here would make their bytes unreachable to every downstream anchor.
 */
export function segment(text: string, minLength = 3): Segment[] {
  const offsets = byteOffsets(text);
  const out: Segment[] = [];

  let cursor = 0;
  let index = 0;
  BOUNDARY.lastIndex = 0;

  // A pod hand-off arrives pre-tagged ("[axiom] ..."), and re-segmenting it
  // would fold the tag into the claim text — so every hop through a chain
  // would stack another tag. The tag is dropped from BOTH the text and the
  // span, which keeps the anchor invariant intact: a claim's span always
  // addresses exactly the bytes of its text.
  const TAG = /^\[[a-z-]+\]\s+/;

  const pushSlice = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    let start = from + lead;
    const end = to - trail;

    const tag = TAG.exec(text.slice(start, end));
    if (tag) start += tag[0].length;

    if (end - start < minLength) return;
    out.push({
      text: text.slice(start, end),
      span: [offsets[start], offsets[end]],
      index: index++,
    });
  };

  let m: RegExpExecArray | null;
  while ((m = BOUNDARY.exec(text)) !== null) {
    pushSlice(cursor, m.index);
    cursor = m.index + m[0].length;
  }
  pushSlice(cursor, text.length);

  return out;
}

/** Total UTF-8 byte length — the denominator for every density figure. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
