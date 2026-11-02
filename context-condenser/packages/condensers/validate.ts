/**
 * Dependency-free validation of catalog.json against catalog.schema.json.
 * Deliberately not a general JSON Schema engine — it checks exactly the
 * constraints this one schema declares, and fails loudly on anything else.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Failure { path: string; message: string; }

export function validateCatalog(catalog: unknown): Failure[] {
  const fails: Failure[] = [];
  const push = (path: string, message: string) => fails.push({ path, message });

  if (typeof catalog !== 'object' || catalog === null) {
    return [{ path: '$', message: 'catalog must be an object' }];
  }
  const c = catalog as Record<string, unknown>;

  if (c.version !== 1) push('$.version', `expected 1, got ${JSON.stringify(c.version)}`);
  if (!Array.isArray(c.presets) || c.presets.length === 0) {
    return [...fails, { path: '$.presets', message: 'must be a non-empty array' }];
  }

  const CATEGORIES = ['semantic', 'logical', 'cybernetic', 'cognitive'];
  const KINDS = ['prose','axioms','graph','table','tree','timeline','truth-table','dialectic','gaps','xml','code','decision-tree'];
  const STRINGS = ['id','name','category','mathFormula','description','instruction','efficiencyRating','outputKind'];
  const seen = new Set<string>();

  c.presets.forEach((p: any, i: number) => {
    const at = `$.presets[${i}]`;
    if (typeof p !== 'object' || p === null) { push(at, 'must be an object'); return; }

    for (const k of STRINGS) {
      if (typeof p[k] !== 'string' || p[k].length === 0) push(`${at}.${k}`, 'required non-empty string');
    }
    if (typeof p.id === 'string') {
      if (!/^[a-z0-9_]+$/.test(p.id)) push(`${at}.id`, `"${p.id}" must match ^[a-z0-9_]+$`);
      if (seen.has(p.id)) push(`${at}.id`, `duplicate id "${p.id}"`);
      seen.add(p.id);
    }
    if (!CATEGORIES.includes(p.category)) push(`${at}.category`, `"${p.category}" not in ${CATEGORIES.join('|')}`);
    if (!KINDS.includes(p.outputKind)) push(`${at}.outputKind`, `"${p.outputKind}" not in ${KINDS.join('|')}`);
    if (typeof p.efficiencyRating === 'string' && !/^[0-9]+-[0-9]+%$/.test(p.efficiencyRating)) {
      push(`${at}.efficiencyRating`, `"${p.efficiencyRating}" must look like "85-95%"`);
    }

    const r = p.reductionRange;
    if (!Array.isArray(r) || r.length !== 2 || r.some((n: unknown) => typeof n !== 'number')) {
      push(`${at}.reductionRange`, 'must be [number, number]');
    } else {
      if (r[0] < 0 || r[1] > 1) push(`${at}.reductionRange`, 'values must be within 0..1');
      if (r[0] > r[1]) push(`${at}.reductionRange`, `inverted range [${r[0]}, ${r[1]}]`);
      // The parsed range must still agree with the human-readable string it came from.
      const m = /^([0-9]+)-([0-9]+)%$/.exec(String(p.efficiencyRating));
      if (m && (Number(m[1]) / 100 !== r[0] || Number(m[2]) / 100 !== r[1])) {
        push(`${at}.reductionRange`, `does not match efficiencyRating "${p.efficiencyRating}"`);
      }
    }

    const extra = Object.keys(p).filter((k) => ![...STRINGS, 'reductionRange'].includes(k));
    if (extra.length) push(at, `unexpected field(s): ${extra.join(', ')}`);
  });

  return fails;
}

/** CLI entry: `node validate.ts` exits non-zero on any failure. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = fileURLToPath(new URL('./catalog.json', import.meta.url));
  const failures = validateCatalog(JSON.parse(readFileSync(path, 'utf8')));
  if (failures.length) {
    for (const f of failures) console.error(`  ${f.path}: ${f.message}`);
    console.error(`\ncatalog.json INVALID — ${failures.length} problem(s)`);
    process.exit(1);
  }
  console.log('catalog.json valid');
}
