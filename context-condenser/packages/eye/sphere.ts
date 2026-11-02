/**
 * eYe protocol — the sphere chain.
 *
 * From .agents/memory/pod-chain-vision.md: a ring of small expert pods, each
 * hydrated ONE AT A TIME, each passing a condensed summary of its reasoning to
 * the next rather than its raw analysis, with a compiler at the centre.
 *
 * That vision doc lists "how condensed reasoning is serialized between pods"
 * as an OPEN question. This module answers it: the hand-off payload is a
 * Condensate. Which means the hand-off is anchored — the compiler can pull the
 * exact source bytes behind any pod's claim without that pod being resident,
 * and without carrying the raw text forward through the ring.
 *
 * Surface area is the invariant being defended: the working set at any instant
 * is ONE pod's payload, never the whole chain, and never the whole source.
 */
import type { Condensate } from '../core/condensate.ts';
import { dehydrate, rehydrate } from '../local/condense.ts';
import { condenser, targetDensity } from '../condensers/index.ts';
import { Vault } from '../vault/vault.ts';

export interface Pod {
  id: string;
  /** Role label, matching the fleet map's spec vocabulary. */
  spec: string;
  /** Condenser ids this pod applies. */
  pipeline: string[];
  /** Bytes this pod is permitted to hold resident. Enforced, not advisory. */
  budgetBytes?: number;
}

export interface PodStep {
  podId: string;
  spec: string;
  condensateId: string;
  /** Bytes resident while this pod was open. */
  residentBytes: number;
  claimsIn: number;
  claimsOut: number;
  /** False when this pod hit the contraction floor and passed its input through. */
  contracted: boolean;
  durationMs: number;
}

export interface SphereResult {
  steps: PodStep[];
  /** The compiler's condensate — the centre of the sphere. */
  compiled: Condensate;
  /** Largest resident payload at any instant across the whole run. */
  peakResidentBytes: number;
  /** Size of the original source, for comparison against the peak. */
  sourceBytes: number;
  totalDurationMs: number;
}

const DEFAULT_BUDGET = 1 << 20; // 1 MiB — the vision doc's "≤1GB" scaled to text

/**
 * Render a condensate as the text the next pod will actually read.
 *
 * Deduplicated on purpose: open questions are already present among the
 * claims, so emitting both sections made every hop re-add the same lines and
 * the ring GREW instead of shrinking. A hand-off that is not strictly smaller
 * than its input is not a condenser chain, it is an amplifier.
 */
function handoffText(cnd: Condensate): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  const add = (line: string, key: string) => {
    const k = key.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    parts.push(line);
  };

  for (const c of cnd.claims) add(`[${c.kind}] ${c.text}`, c.text);
  for (const t of cnd.tensions) add(`[tension] ${t.a} versus ${t.b}`, `${t.a}|${t.b}`);
  for (const q of cnd.openQuestions) add(`[question] ${q}`, q);

  return parts.join('\n');
}

/** Bytes of a string — every budget and ratio in this module is in bytes. */
function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Each pod must hand on strictly less than it received. If the first pass
 * does not contract enough, tighten the density and re-condense rather than
 * letting the ring swell. This is the mechanism that makes "reduce surface
 * area" a property of the system rather than an aspiration.
 */
const CONTRACTION = 0.9;
const MAX_TIGHTENING = 5;

function startingDensity(pipeline: string[]): number {
  return Math.min(...pipeline.map((id) => targetDensity(condenser(id))));
}

/**
 * Run a chain of pods over one source.
 *
 * Pod 1 reads the source. Every later pod reads only the previous pod's
 * condensate — never the source, never an earlier pod's raw state. Each pod's
 * payload is released before the next one opens, so only one is ever resident.
 */
export async function runSphere(
  vault: Vault,
  chain: Pod[],
  source: string,
  opts: { passphrase?: string } = {},
): Promise<SphereResult> {
  if (chain.length === 0) throw new Error('runSphere requires at least one pod');

  const started = Date.now();
  const steps: PodStep[] = [];
  const sourceBytes = bytes(source);

  let carried: Condensate | null = null;
  let peakResidentBytes = 0;

  for (const pod of chain) {
    const podStart = Date.now();
    const budget = pod.budgetBytes ?? DEFAULT_BUDGET;

    // Open: materialise exactly this pod's input, nothing else.
    let payload = carried === null ? source : handoffText(carried);
    const residentBytes = bytes(payload);

    if (residentBytes > budget) {
      throw new Error(
        `pod ${pod.id} would hold ${residentBytes} bytes, over its ${budget}-byte budget — ` +
        'condense harder upstream or raise the budget deliberately',
      );
    }
    peakResidentBytes = Math.max(peakResidentBytes, residentBytes);

    const claimsIn = carried?.claims.length ?? 0;
    let produced: Condensate;
    let contracted = true;
    try {
      let density = startingDensity(pod.pipeline);
      produced = await dehydrate(vault, payload, {
        pipeline: pod.pipeline,
        density,
        passphrase: opts.passphrase,
        children: carried ? [carried.id] : [],
      });

      // Contract until the hand-off is genuinely smaller than the input.
      for (let attempt = 0; attempt < MAX_TIGHTENING; attempt++) {
        if (bytes(handoffText(produced)) <= residentBytes * CONTRACTION) break;
        density = density / 2;
        produced = await dehydrate(vault, payload, {
          pipeline: pod.pipeline,
          density,
          passphrase: opts.passphrase,
          children: carried ? [carried.id] : [],
        });
      }

      // Contraction has a floor: once a payload is already minimal, the
      // per-line kind tags cost more than another pass can save. At that point
      // the honest move is to pass the input through untouched rather than
      // either growing the ring or erroring out on a chain that simply ran out
      // of things to remove.
      if (carried && bytes(handoffText(produced)) > residentBytes) {
        produced = carried;
        contracted = false;
      }
    } finally {
      // Close: release the payload before the next pod opens, always — even
      // on failure, so a thrown pod never leaves its input resident.
      payload = '';
    }

    steps.push({
      podId: pod.id,
      spec: pod.spec,
      condensateId: produced.id,
      residentBytes,
      claimsIn,
      claimsOut: produced.claims.length,
      contracted,
      durationMs: Date.now() - podStart,
    });

    carried = produced;
  }

  return {
    steps,
    compiled: carried!,
    peakResidentBytes,
    sourceBytes,
    totalDurationMs: Date.now() - started,
  };
}

/**
 * Resolve any claim in the compiled result back to original source bytes.
 *
 * Note what this does NOT require: no pod is re-opened, and the chain is not
 * re-run. The anchor carries through because every pod's condensate references
 * the archive its input was sealed into.
 */
export async function traceClaim(
  vault: Vault,
  cnd: Condensate,
  claimIndex: number,
  passphrase?: string,
): Promise<string> {
  const { text } = await rehydrate(vault, cnd, { claims: [claimIndex], passphrase });
  return text;
}

/** A default ring drawn from the fleet map's roles. */
export const DEFAULT_RING: Pod[] = [
  { id: 'baseline', spec: 'baseline', pipeline: ['gist_core'] },
  { id: 'logic', spec: 'analysis', pipeline: ['first_principles'] },
  { id: 'knowledge', spec: 'knowledge', pipeline: ['fact_densifier'] },
  { id: 'compiler', spec: 'orchestration', pipeline: ['pareto_extractor'] },
];
