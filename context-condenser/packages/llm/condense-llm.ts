/**
 * The LLM tier. Same signature as the local tier, better output when a
 * provider is reachable — and an automatic fall back to local when not.
 *
 * The anchoring rule survives the upgrade: a model may rewrite a claim's
 * wording, but the claim still has to point at real source bytes. Any model
 * line that cannot be traced back to the document is DROPPED rather than
 * kept unanchored, because an unanchored claim is exactly the un-rehydratable
 * artefact this whole design exists to prevent.
 */
import type { Claim, Condensate } from '../core/condensate.ts';
import { assertCondensate } from '../core/condensate.ts';
import { condenser } from '../condensers/index.ts';
import { ProviderChain } from '../providers/provider.ts';
import { Vault } from '../vault/vault.ts';
import { dehydrate, type DehydrateOptions } from '../local/condense.ts';
import { segment } from '../local/segment.ts';

/** Token-ish overlap, used to trace a model line back to a source sentence. */
function overlap(a: string, b: string): number {
  const norm = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const A = norm(a);
  const B = norm(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

export interface LlmOptions extends DehydrateOptions {
  /** Minimum overlap for a model claim to be considered traceable. */
  traceThreshold?: number;
  chain?: ProviderChain;
}

export interface LlmResult {
  condensate: Condensate;
  /** Why the local tier was used, when it was. */
  fellBackBecause?: string;
  provider?: string;
  /** Model lines discarded for lacking a traceable anchor. */
  droppedUnanchored: number;
}

export async function dehydrateLlm(
  vault: Vault,
  text: string,
  opts: LlmOptions = {},
): Promise<LlmResult> {
  // Always compute the local condensate first: it seals the archive, and it
  // is the fallback if anything below fails.
  const local = await dehydrate(vault, text, opts);
  const chain = opts.chain ?? new ProviderChain();

  if (!chain.configured) {
    return { condensate: local, fellBackBecause: 'no provider configured', droppedUnanchored: 0 };
  }

  const pipeline = local.pipeline;
  const instructions = pipeline.map((id) => condenser(id).instruction).join('\n\n');
  const system =
    `${instructions}\n\n` +
    'Output one claim per line, plain text, no numbering, no preamble. ' +
    'Every line must restate content actually present in the input.';

  const result = await chain.complete(system, text);
  if (!result) {
    const why = chain.failures.map((f) => `${f.provider}: ${f.error}`).join('; ');
    return { condensate: local, fellBackBecause: why || 'all providers failed', droppedUnanchored: 0 };
  }

  const segments = segment(text);
  const threshold = opts.traceThreshold ?? 0.5;
  const claims: Claim[] = [];
  let dropped = 0;

  for (const line of result.text.split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())) {
    if (line.length < 8) continue;

    let bestSeg = null as (typeof segments)[number] | null;
    let bestScore = 0;
    for (const seg of segments) {
      const score = overlap(line, seg.text);
      if (score > bestScore) { bestScore = score; bestSeg = seg; }
    }

    if (!bestSeg || bestScore < threshold) { dropped++; continue; }

    claims.push({
      text: line,
      kind: 'claim',
      confidence: Number(Math.min(0.95, bestScore).toFixed(3)),
      anchors: [{ sha256: local.archive.sha256, span: bestSeg.span }],
    });
  }

  // If the model gave us nothing traceable, the local condensate is better
  // than an empty one.
  if (claims.length === 0) {
    return {
      condensate: local,
      fellBackBecause: 'no model output could be anchored to the source',
      provider: result.provider,
      droppedUnanchored: dropped,
    };
  }

  const keptBytes = claims.reduce((n, c) => n + (c.anchors[0].span[1] - c.anchors[0].span[0]), 0);

  const condensate: Condensate = {
    ...local,
    tier: 'llm',
    claims,
    density: local.archive.bytes === 0 ? 0 : Number((keptBytes / local.archive.bytes).toFixed(4)),
  };

  return { condensate: assertCondensate(condensate), provider: result.provider, droppedUnanchored: dropped };
}
