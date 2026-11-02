/**
 * dehydrate / rehydrate — the two operations the whole engine exists for.
 *
 *   dehydrate(text)  -> seals the ORIGINAL bytes into the vault (lossless),
 *                       then derives a condensate (lossy) whose every claim
 *                       is anchored to a byte span of those sealed bytes.
 *
 *   rehydrate(cnd)   -> resolves anchors back through the vault, returning
 *                       the exact source text for whichever claims are asked
 *                       for. Full restore is just "every anchor".
 *
 * The asymmetry is deliberate. Condensation cannot be inverted; retrieval can.
 */
import {
  CONDENSATE_VERSION, assertCondensate, condensateId,
  type Anchor, type Claim, type Condensate,
} from '../core/condensate.ts';
import { condenser, targetDensity as densityFor } from '../condensers/index.ts';
import { Vault, podRef, type SealOptions } from '../vault/vault.ts';
import { segment, byteLength } from './segment.ts';
import {
  analyzeAll, extractEntities, extractOpenQuestions,
  extractRelations, extractTensions, selectByDensity,
} from './analyze.ts';

export interface DehydrateOptions {
  /** Condenser ids to apply, in order. Defaults to a general-purpose pair. */
  pipeline?: string[];
  /** Override the density implied by the pipeline. 0..1, lower is denser. */
  density?: number;
  /** Encrypts the archived original at rest. */
  passphrase?: string;
  frameSize?: number;
  /** Condensate ids this one summarises (pod rollup). */
  children?: string[];
}

const DEFAULT_PIPELINE = ['gist_core', 'pareto_extractor'];

/**
 * Resolve the density target for a pipeline: the densest condenser in the
 * chain governs, since applying a 90% reducer after a 70% one lands near 90%.
 */
function pipelineDensity(pipeline: string[]): number {
  return Math.min(...pipeline.map((id) => densityFor(condenser(id))));
}

export async function dehydrate(
  vault: Vault,
  text: string,
  opts: DehydrateOptions = {},
): Promise<Condensate> {
  const pipeline = opts.pipeline?.length ? opts.pipeline : DEFAULT_PIPELINE;
  for (const id of pipeline) condenser(id); // fail fast on an unknown id

  const sealOpts: SealOptions = { passphrase: opts.passphrase, frameSize: opts.frameSize };
  const stats = await vault.seal(text, sealOpts);

  const totalBytes = stats.bytes;
  const segments = segment(text);
  const components = analyzeAll(segments);

  const target = opts.density ?? pipelineDensity(pipeline);
  if (target < 0 || target > 1) throw new Error(`density must be 0..1, got ${target}`);

  const kept = selectByDensity(components, target, totalBytes);

  const claims: Claim[] = kept.map((c) => ({
    text: c.segment.text,
    kind: c.kind,
    confidence: Number(c.confidence.toFixed(3)),
    anchors: [{ sha256: stats.sha256, span: c.segment.span }],
  }));

  const entities = extractEntities(text);
  const keptBytes = claims.reduce((n, c) => n + (c.anchors[0].span[1] - c.anchors[0].span[0]), 0);

  const condensate: Condensate = {
    v: CONDENSATE_VERSION,
    id: condensateId(),
    created: new Date().toISOString(),
    pipeline,
    tier: 'local',
    density: totalBytes === 0 ? 0 : Number((keptBytes / totalBytes).toFixed(4)),
    archive: {
      codec: 'gzip',
      sha256: stats.sha256,
      bytes: stats.bytes,
      ref: podRef(stats.sha256),
      encrypted: stats.encrypted,
    },
    claims,
    entities,
    tensions: extractTensions(text, components),
    relations: extractRelations(components, entities),
    openQuestions: extractOpenQuestions(components),
    children: opts.children ?? [],
  };

  return assertCondensate(condensate);
}

export interface RehydrateOptions {
  /** Restore only these claim indices. Omit for every claim. */
  claims?: number[];
  passphrase?: string;
  /** Return the complete original rather than anchored spans. */
  full?: boolean;
}

export interface RehydrateResult {
  /** The recovered text, joined in document order. */
  text: string;
  /** Which spans were resolved. */
  spans: Anchor[];
  /** Bytes returned vs bytes in the archive — the cost of this read. */
  fraction: number;
}

export async function rehydrate(
  vault: Vault,
  cnd: Condensate,
  opts: RehydrateOptions = {},
): Promise<RehydrateResult> {
  assertCondensate(cnd);

  if (opts.full) {
    const text = await vault.restore(cnd.archive.sha256, opts.passphrase);
    return {
      text,
      spans: [{ sha256: cnd.archive.sha256, span: [0, cnd.archive.bytes] }],
      fraction: 1,
    };
  }

  const indices = opts.claims ?? cnd.claims.map((_, i) => i);
  for (const i of indices) {
    if (!cnd.claims[i]) throw new Error(`claim index ${i} does not exist (have ${cnd.claims.length})`);
  }

  const anchors = indices
    .flatMap((i) => cnd.claims[i].anchors)
    .sort((a, b) => a.span[0] - b.span[0]);

  // Merge overlapping/adjacent spans so shared bytes are read and returned once.
  const merged: Anchor[] = [];
  for (const a of anchors) {
    const last = merged[merged.length - 1];
    if (last && a.span[0] <= last.span[1]) {
      last.span = [last.span[0], Math.max(last.span[1], a.span[1])];
    } else {
      merged.push({ sha256: a.sha256, span: [a.span[0], a.span[1]] });
    }
  }

  const parts: string[] = [];
  for (const a of merged) {
    parts.push(await vault.readSpan(a.sha256, a.span[0], a.span[1], opts.passphrase));
  }

  const bytes = merged.reduce((n, a) => n + (a.span[1] - a.span[0]), 0);
  return {
    text: parts.join('\n'),
    spans: merged,
    fraction: cnd.archive.bytes === 0 ? 0 : bytes / cnd.archive.bytes,
  };
}

/** Human-readable digest of what a condensate kept. */
export function summarize(cnd: Condensate): string {
  const lines = [
    `${cnd.id}  [${cnd.tier}]  pipeline: ${cnd.pipeline.join(' -> ')}`,
    `density ${(cnd.density * 100).toFixed(1)}% of ${cnd.archive.bytes} bytes` +
      (cnd.archive.encrypted ? '  (archive encrypted)' : ''),
    '',
  ];
  for (const c of cnd.claims) {
    lines.push(`  [${c.kind}] ${c.text}`);
  }
  if (cnd.tensions.length) {
    lines.push('', '  tensions: ' + cnd.tensions.map((t) => `${t.a} <-> ${t.b}`).join(', '));
  }
  if (cnd.openQuestions.length) {
    lines.push('  open: ' + cnd.openQuestions.length + ' question(s)');
  }
  return lines.join('\n');
}

export { byteLength };
