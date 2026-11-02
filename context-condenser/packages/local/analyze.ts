/**
 * Deterministic structural analysis — the offline floor of the engine.
 *
 * Merged from four fleet engines, each contributing the part it did best:
 *   signal-sharpener/signal-engine.ts       typed components + tension pairs
 *   signal-weaver-73/compression-engine.ts  graduated density layers
 *   tension-tamer/compression-engine.ts     polarity preservation
 *   relational-compass/compression-engine.ts relational abstraction
 *   core-light-vault/knowledge-engine.ts    uncertainty + pattern law
 *
 * No network, no API key, no model. Given the same input it always returns
 * the same output, which is what makes it usable as a fallback tier.
 */
import type { ClaimKind, Relation, Tension } from '../core/condensate.ts';
import type { Segment } from './segment.ts';

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','because','as','until','while','of','at','by','for','with',
  'about','against','between','through','during','before','after','above','below','to','from','up',
  'down','in','out','on','off','over','under','again','further','then','once','here','there','when',
  'where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not',
  'only','own','same','so','than','too','very','can','will','just','should','now','is','are','was',
  'were','be','been','being','have','has','had','having','do','does','did','doing','this','that',
  'these','those','they','them','their','we','our','you','your','it','its','he','she','his','her',
  'i','me','my','which','who','whom','what','also','into','there','upon','per','via','within',
]);

/** Marker vocabularies. Presence of a marker is evidence of a component type. */
const MARKERS: Record<ClaimKind, string[]> = {
  axiom: ['fundamentally','by definition','axiom','first principle','necessarily','invariant','always','must be'],
  definition: ['is defined as','means that','refers to','is a','consists of','comprises'],
  decision: ['we will','decided','chose','selected','adopt','going with','the plan is','committed to'],
  claim: ['shows that','demonstrates','indicates','suggests','evidence','research','found that','reduce','increase','improve','eliminate'],
  question: ['unclear','unknown','tbd','open question','needs investigation','not yet determined','uncertain whether'],
  risk: ['risk that','danger','fails','breaks','vulnerable','threat','however','caveat','downside','regression'],
  action: ['should','must','need to','todo','next step','recommend','action','implement','migrate'],
  tension: ['tradeoff','trade-off','versus','vs','at the cost of','balance','tension','whereas','on the other hand'],
};

/** Dualities worth preserving through compression — from tension-tamer. */
const POLARITIES: [string, string][] = [
  ['efficiency','resilience'], ['speed','reliability'], ['latency','throughput'],
  ['centralized','distributed'], ['cost','quality'], ['simple','flexible'],
  ['security','usability'], ['local','remote'], ['lossy','lossless'],
  ['short-term','long-term'], ['consistency','availability'],
];

export interface Component {
  segment: Segment;
  kind: ClaimKind;
  /** Structural salience, unbounded above; used for ranking only. */
  score: number;
  /** 0..1, derived from marker strength and position. */
  confidence: number;
  matched: string[];
}

function countMarkers(lower: string, markers: string[]): string[] {
  return markers.filter((m) => lower.includes(m));
}

/**
 * Classify one segment. A segment gets the kind whose markers it matches most
 * strongly; ties fall back to 'claim', which is the neutral kind.
 */
export function classify(seg: Segment, total: number): Component {
  const lower = seg.text.toLowerCase();

  let best: ClaimKind = 'claim';
  let bestHits: string[] = [];
  let bestWeight = 0;

  for (const kind of Object.keys(MARKERS) as ClaimKind[]) {
    const hits = countMarkers(lower, MARKERS[kind]);
    // Longer markers are more specific, so weight by phrase length.
    const weight = hits.reduce((n, h) => n + 1 + h.split(' ').length * 0.35, 0);
    if (weight > bestWeight) { bestWeight = weight; best = kind; bestHits = hits; }
  }

  if (seg.text.trimEnd().endsWith('?')) { best = 'question'; bestWeight = Math.max(bestWeight, 2); }

  const words = seg.text.split(/\s+/).filter(Boolean).length;
  // Openers carry disproportionate signal (signal-sharpener's 1.4x lead bias).
  const positionBoost = seg.index === 0 ? 1.4 : seg.index < total * 0.15 ? 1.15 : 1;
  // Mid-length sentences are the most information-dense; very short or very
  // long ones are usually fragments or run-ons.
  const lengthFactor = words < 4 ? 0.5 : words > 45 ? 0.7 : 1;

  const score = (words * 0.35 + bestWeight * 3) * positionBoost * lengthFactor;
  const confidence = Math.min(0.95, 0.35 + bestWeight * 0.12 + (seg.index === 0 ? 0.1 : 0));

  return { segment: seg, kind: best, score, confidence, matched: bestHits };
}

export function analyzeAll(segments: Segment[]): Component[] {
  return segments.map((s) => classify(s, segments.length));
}

/** Frequent, non-trivial terms plus capitalised proper nouns. */
export function extractEntities(text: string, limit = 12): string[] {
  const freq = new Map<string, number>();
  const display = new Map<string, string>();

  for (const raw of text.split(/[^\p{L}\p{N}_-]+/u)) {
    if (raw.length < 4) continue;
    const key = raw.toLowerCase();
    if (STOPWORDS.has(key)) continue;
    freq.set(key, (freq.get(key) ?? 0) + 1);
    // Prefer the capitalised spelling if the term ever appears that way.
    const prior = display.get(key);
    if (!prior || (/^[A-Z]/.test(raw) && !/^[A-Z]/.test(prior))) display.set(key, raw);
  }

  return [...freq.entries()]
    .filter(([key, n]) => n > 1 || /^[A-Z]/.test(display.get(key) ?? ''))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([k]) => display.get(k)!);
}

/**
 * Polarity detection. A tension is only reported when BOTH poles appear —
 * a single pole is a topic, not a tradeoff.
 */
export function extractTensions(text: string, components: Component[]): Tension[] {
  const lower = text.toLowerCase();
  const found: Tension[] = [];

  for (const [a, b] of POLARITIES) {
    if (lower.includes(a) && lower.includes(b)) {
      found.push({ a, b, relation: 'tradeoff' });
    }
  }

  // A fixed list of poles can never cover real phrasing, so also detect the
  // CONSTRUCTIONS that express a tradeoff and read the poles out of them.
  const PATTERNS: [RegExp, string][] = [
    [/(\b[\w-]{4,})\s+(?:vs\.?|versus)\s+(\b[\w-]{4,})/i, 'tradeoff'],
    [/trades?\s+(\b[\w-]{4,})\s+for\s+(\b[\w-]{4,})/i, 'tradeoff'],
    [/(\b[\w-]{4,})\s+at the cost of\s+(\b[\w-]{4,})/i, 'tradeoff'],
    [/(\b[\w-]{4,})\s+(?:rather|instead of)\s+(?:than\s+)?(\b[\w-]{4,})/i, 'preference'],
    [/balance\s+(\b[\w-]{4,})\s+(?:and|against|with)\s+(\b[\w-]{4,})/i, 'balance'],
  ];

  for (const c of components) {
    for (const [re, relation] of PATTERNS) {
      const m = re.exec(c.segment.text);
      if (!m) continue;
      const a = m[1].toLowerCase();
      const b = m[2].toLowerCase();
      if (a === b || STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
      if (found.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a))) continue;
      found.push({ a, b, relation });
    }
  }

  return found;
}

const REL_VERBS = [
  'implements','requires','causes','prevents','replaces','depends on','enables',
  'reduces','increases','produces','contains','extends','uses',
];

/** Relations between entities co-occurring in one segment, labelled by verb. */
export function extractRelations(components: Component[], entities: string[]): Relation[] {
  const out: Relation[] = [];
  const seen = new Set<string>();
  const lowerEntities = entities.map((e) => [e, e.toLowerCase()] as const);

  for (const c of components) {
    const lower = c.segment.text.toLowerCase();
    const present = lowerEntities.filter(([, le]) => lower.includes(le));
    if (present.length < 2) continue;

    const verb = REL_VERBS.find((v) => lower.includes(v)) ?? 'relates to';
    for (let i = 0; i < present.length - 1; i++) {
      const from = present[i][0];
      const to = present[i + 1][0];
      const key = `${from}|${verb}|${to}`;
      if (from === to || seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, label: verb });
    }
  }
  return out.slice(0, 24);
}

export function extractOpenQuestions(components: Component[]): string[] {
  return components.filter((c) => c.kind === 'question').map((c) => c.segment.text).slice(0, 10);
}

/** Overall confidence in the source, from core-light-vault's uncertainty pass. */
export function assessUncertainty(components: Component[]): { level: 'certain' | 'likely' | 'uncertain'; ratio: number } {
  if (components.length === 0) return { level: 'uncertain', ratio: 1 };
  const hedged = components.filter((c) => c.kind === 'question' || /\b(may|might|possibly|perhaps|seems|appears|likely)\b/i.test(c.segment.text));
  const ratio = hedged.length / components.length;
  return { level: ratio > 0.4 ? 'uncertain' : ratio > 0.15 ? 'likely' : 'certain', ratio };
}

/**
 * Select components to keep for a target density.
 *
 * Density is measured in BYTES of the original, not sentence count, because
 * that is what the condensate reports and what a caller budgets against.
 */
export function selectByDensity(components: Component[], targetDensity: number, totalBytes: number): Component[] {
  if (components.length === 0) return [];
  const budget = Math.max(1, Math.floor(totalBytes * targetDensity));

  // Tradeoffs and unknowns are the most damaging things to lose, so they are
  // ranked FIRST — but still inside the budget. Appending them unconditionally
  // (the obvious version) breaks the byte budget outright, which in a pod
  // chain compounds into a ring that grows instead of condensing.
  const priority = (c: Component) => (c.kind === 'tension' || c.kind === 'question' ? 1.5 : 1);
  const ranked = [...components].sort((a, b) => b.score * priority(b) - a.score * priority(a));

  const kept: Component[] = [];
  let used = 0;

  for (const c of ranked) {
    const size = c.segment.span[1] - c.segment.span[0];
    if (used + size > budget && kept.length > 0) continue;
    kept.push(c);
    used += size;
  }

  return kept.sort((a, b) => a.segment.index - b.segment.index);
}
