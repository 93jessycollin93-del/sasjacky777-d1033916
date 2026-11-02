/**
 * @cce/condensers — the 30-condenser catalog as portable data.
 *
 * Lifted out of KnowledgeCompressorApp.tsx so anything (CLI, MCP server, an
 * agent, another app) can read the presets without importing React.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Category = 'semantic' | 'logical' | 'cybernetic' | 'cognitive';

export type OutputKind =
  | 'prose' | 'axioms' | 'graph' | 'table' | 'tree'
  | 'timeline' | 'truth-table' | 'dialectic' | 'gaps' | 'xml' | 'code' | 'decision-tree';

export interface Condenser {
  id: string;
  name: string;
  category: Category;
  /** LaTeX, for display only — never evaluated. */
  mathFormula: string;
  description: string;
  /** The system prompt handed to a model in the LLM tier. */
  instruction: string;
  efficiencyRating: string;
  /** [lo, hi] fraction of input removed, parsed from efficiencyRating. */
  reductionRange: [number, number];
  outputKind: OutputKind;
}

const CATALOG_PATH = fileURLToPath(new URL('./catalog.json', import.meta.url));

const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as {
  version: number;
  presets: Condenser[];
};

if (raw.version !== 1) {
  throw new Error(`condenser catalog version ${raw.version} is not supported (expected 1)`);
}

export const CONDENSERS: readonly Condenser[] = Object.freeze(raw.presets);

const BY_ID = new Map(CONDENSERS.map((c) => [c.id, c]));

/** Look up one condenser. Throws with the full id list rather than returning undefined. */
export function condenser(id: string): Condenser {
  const found = BY_ID.get(id);
  if (!found) {
    throw new Error(`unknown condenser "${id}". Available: ${[...BY_ID.keys()].join(', ')}`);
  }
  return found;
}

export function byCategory(category: Category): Condenser[] {
  return CONDENSERS.filter((c) => c.category === category);
}

/** Midpoint of the declared reduction range — used to pick a local density target. */
export function targetDensity(c: Condenser): number {
  const [lo, hi] = c.reductionRange;
  return 1 - (lo + hi) / 2;
}
