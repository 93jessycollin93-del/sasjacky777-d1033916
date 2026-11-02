/**
 * @cce/core — the Condensate v1 contract.
 *
 * The whole engine hangs off this one type. Its central rule:
 *
 *   Condensation is LOSSY and one-way. Archival is LOSSLESS and reversible.
 *   A condensate is therefore never allowed to exist without a reference to
 *   the lossless bytes it came from.
 *
 * That is what makes rehydration a real operation instead of a hopeful one:
 * every claim carries an anchor (archive digest + byte span), so the exact
 * source text behind any single claim can be pulled back verbatim without
 * restoring the whole source.
 */

export const CONDENSATE_VERSION = 1 as const;

/** A byte range [start, end) into the ORIGINAL (pre-compression) text. */
export type Span = [start: number, end: number];

export interface Anchor {
  /** sha256 of the original bytes, hex. Addresses the archive entry. */
  sha256: string;
  span: Span;
}

export type ClaimKind =
  | 'axiom' | 'claim' | 'decision' | 'definition'
  | 'question' | 'risk' | 'action' | 'tension';

export interface Claim {
  text: string;
  kind: ClaimKind;
  /** 0..1. Local tier derives this structurally; LLM tier may override. */
  confidence: number;
  /** Never empty — a claim with no anchor cannot be rehydrated, so it is rejected. */
  anchors: Anchor[];
}

export interface Relation { from: string; to: string; label: string; }
export interface Tension { a: string; b: string; relation: string; }

export interface ArchiveRef {
  codec: 'gzip' | 'raw';
  /** sha256 of the ORIGINAL plaintext bytes, hex. */
  sha256: string;
  bytes: number;
  /** Where the archive lives, e.g. "pod://vault/9f2c1a…". */
  ref: string;
  encrypted: boolean;
}

export interface Condensate {
  v: typeof CONDENSATE_VERSION;
  id: string;
  created: string;
  /** Condenser ids applied, in order. */
  pipeline: string[];
  /** Which tier produced this: deterministic local analysis, or a model. */
  tier: 'local' | 'llm';
  /** output bytes / input bytes. Lower is denser. */
  density: number;
  archive: ArchiveRef;
  claims: Claim[];
  entities: string[];
  tensions: Tension[];
  relations: Relation[];
  openQuestions: string[];
  /** Ids of condensates this one summarises — how pod rollup nests. */
  children: string[];
}

let counter = 0;

/** Sortable, collision-resistant enough for local use; no dependency. */
export function condensateId(now: Date = new Date()): string {
  const t = now.getTime().toString(36).toUpperCase().padStart(9, '0');
  const n = (counter = (counter + 1) % 1296).toString(36).toUpperCase().padStart(2, '0');
  const r = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
  return `cnd_${t}${n}${r}`;
}

export interface InvariantFailure { path: string; message: string; }

/**
 * Structural invariants. These are what keep a condensate rehydratable —
 * violating any of them means the lossy side has drifted from the lossless
 * side, which is the exact failure mode this format exists to prevent.
 */
export function checkCondensate(c: Condensate): InvariantFailure[] {
  const f: InvariantFailure[] = [];
  const bad = (path: string, message: string) => f.push({ path, message });

  if (c.v !== CONDENSATE_VERSION) bad('v', `unsupported version ${c.v}`);
  if (!/^cnd_[0-9A-Z]+$/.test(c.id)) bad('id', `malformed id "${c.id}"`);
  if (Number.isNaN(Date.parse(c.created))) bad('created', 'not an ISO timestamp');
  if (!Array.isArray(c.pipeline) || c.pipeline.length === 0) bad('pipeline', 'must name at least one condenser');
  if (c.tier !== 'local' && c.tier !== 'llm') bad('tier', `unknown tier "${c.tier}"`);
  if (!(c.density >= 0)) bad('density', `must be >= 0, got ${c.density}`);

  if (!/^[0-9a-f]{64}$/.test(c.archive.sha256)) bad('archive.sha256', 'must be 64 hex chars');
  if (!(c.archive.bytes >= 0)) bad('archive.bytes', 'must be >= 0');
  if (!c.archive.ref) bad('archive.ref', 'missing');

  c.claims.forEach((claim, i) => {
    const at = `claims[${i}]`;
    if (!claim.text.trim()) bad(`${at}.text`, 'empty');
    if (!(claim.confidence >= 0 && claim.confidence <= 1)) {
      bad(`${at}.confidence`, `must be 0..1, got ${claim.confidence}`);
    }
    if (!claim.anchors.length) {
      bad(`${at}.anchors`, 'no anchor — claim could never be rehydrated');
    }
    claim.anchors.forEach((a, j) => {
      const aat = `${at}.anchors[${j}]`;
      if (a.sha256 !== c.archive.sha256) {
        bad(`${aat}.sha256`, 'does not match this condensate’s archive');
      }
      const [s, e] = a.span;
      if (!Number.isInteger(s) || !Number.isInteger(e)) bad(`${aat}.span`, 'must be integers');
      else if (s < 0 || e <= s) bad(`${aat}.span`, `invalid range [${s}, ${e}]`);
      else if (e > c.archive.bytes) bad(`${aat}.span`, `span end ${e} exceeds archive length ${c.archive.bytes}`);
    });
  });

  return f;
}

export function assertCondensate(c: Condensate): Condensate {
  const f = checkCondensate(c);
  if (f.length) {
    throw new Error(`invalid condensate:\n${f.map((x) => `  ${x.path}: ${x.message}`).join('\n')}`);
  }
  return c;
}
