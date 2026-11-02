// Lifts CONDENSER_PRESETS out of KnowledgeCompressorApp.tsx into portable JSON.
// Run once; the .tsx stays untouched. Source of truth moves to catalog.json.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = process.argv[2];
const OUT = process.argv[3];

const src = readFileSync(SRC, 'utf8');
const start = src.indexOf('const CONDENSER_PRESETS');
if (start === -1) throw new Error('CONDENSER_PRESETS not found in ' + SRC);
// Skip past the type annotation (`: CondenserPreset[]`) to the assignment.
const eq = src.indexOf('=', start);
const open = src.indexOf('[', eq);
if (eq === -1 || open === -1) throw new Error('malformed CONDENSER_PRESETS declaration');

// Walk to the matching close bracket, ignoring brackets inside string literals.
let depth = 0, i = open, quote = null, escaped = false;
for (; i < src.length; i++) {
  const c = src[i];
  if (escaped) { escaped = false; continue; }
  if (c === '\\') { escaped = true; continue; }
  if (quote) {
    if (c === quote) quote = null;
  } else if (c === '"' || c === "'" || c === '`') {
    quote = c;
  } else if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) break; }
}
if (depth !== 0) throw new Error('unbalanced brackets in CONDENSER_PRESETS');
const literal = src.slice(open, i + 1);

// The literal is pure data (string/number fields only), so evaluating it is
// equivalent to parsing it — but assert that before trusting the result.
const presets = new Function(`return (${literal});`)();

const REQUIRED = ['id', 'name', 'category', 'mathFormula', 'description', 'instruction', 'efficiencyRating'];
const CATEGORIES = new Set(['semantic', 'logical', 'cybernetic', 'cognitive']);

// outputKind tells a caller what shape comes back, so it can parse without guessing.
const OUTPUT_KIND = {
  first_principles: 'axioms', axiom_assembler: 'axioms', leibniz_characteristica: 'axioms',
  dialectic_core: 'dialectic', boolean_truth_reducer: 'truth-table',
  godel_completeness_finder: 'gaps', dijkstra_pruner: 'decision-tree',
  cognitive_map: 'graph', hofstadter_map: 'graph', cybernetic_feedback: 'graph',
  quantum_entangler: 'graph', superposition_mapper: 'graph',
  taxonomic_ontology: 'tree', mece_divider: 'tree',
  swot_vectorizer: 'table', chronological_sequencer: 'timeline',
  system_prompt_builder: 'xml', code_boilerplate_stripper: 'code',
};

const seen = new Set();
const out = presets.map((p, idx) => {
  for (const k of REQUIRED) {
    if (typeof p[k] !== 'string' || !p[k].trim()) {
      throw new Error(`preset #${idx} (${p.id ?? '?'}) missing required field: ${k}`);
    }
  }
  if (!CATEGORIES.has(p.category)) throw new Error(`preset ${p.id}: unknown category ${p.category}`);
  if (seen.has(p.id)) throw new Error(`duplicate preset id: ${p.id}`);
  seen.add(p.id);

  const m = /^(\d+)\s*-\s*(\d+)%$/.exec(p.efficiencyRating.trim());
  if (!m) throw new Error(`preset ${p.id}: unparseable efficiencyRating ${p.efficiencyRating}`);
  const [lo, hi] = [Number(m[1]), Number(m[2])];
  if (lo > hi) throw new Error(`preset ${p.id}: efficiency range inverted`);

  return {
    id: p.id,
    name: p.name,
    category: p.category,
    mathFormula: p.mathFormula,
    description: p.description,
    instruction: p.instruction,
    efficiencyRating: p.efficiencyRating,
    reductionRange: [lo / 100, hi / 100],
    outputKind: OUTPUT_KIND[p.id] ?? 'prose',
  };
});

writeFileSync(OUT, JSON.stringify({ version: 1, generatedFrom: SRC.split('/').pop(), presets: out }, null, 2) + '\n');
console.log(`extracted ${out.length} presets -> ${OUT}`);
const byCat = {};
for (const p of out) byCat[p.category] = (byCat[p.category] || 0) + 1;
console.log('by category:', byCat);
