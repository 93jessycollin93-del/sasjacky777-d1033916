// Generates PARITY_MATRIX.md from the route manifest and the station table, so
// the tracker cannot drift from what the app actually serves.
import { readFileSync, writeFileSync } from "node:fs";

const manifest = readFileSync("src/lib/routeManifest.ts", "utf8");
const eru = readFileSync("src/eru/routes.generated.ts", "utf8");

const core = [...manifest.matchAll(/\{ path: "([^"]*)", label: "([^"]*)", group: "(\w+)"(, alias: true)?/g)]
  .map(([, path, label, group, alias]) => ({ path, label, group, alias: !!alias }))
  .filter((r) => !r.alias && !r.path.includes(":"));
const eruCount = [...eru.matchAll(/path: "([^"]*)"/g)].length;

const groups = { core: "Core", ai: "AI", ops: "Ops", eru: "Eru" };
const byGroup = new Map();
for (const r of core) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);

const today = new Date().toISOString().slice(0, 10);
let out = `# Parity Matrix

The living tracker \`FLEET_PARITY_PLAN.md\` §6 calls for. **Generated**, not hand-kept:
run \`node scripts/gen-parity-matrix.mjs\` to rebuild it from \`src/lib/routeManifest.ts\`
and \`src/eru/routes.generated.ts\`, so a renamed route changes this file in the same
commit instead of quietly making it wrong.

Last generated: ${today} · ${core.length} native routes + ${eruCount} Eru modules.

## How to read the status column

| Status | Means |
|---|---|
| \`native\` | Built in this app, in TSX, on this app's own backend. |
| \`via-embed\` | Served by the embedded PC OS under \`public/pc-os/\`, framed by a route here. |
| \`imported\` | An Eru page ported into \`src/eru/\`, running on the shared shell. |
| \`todo\` | Named in the plan, not built here. |

Only Jackie's column is filled in: this repo can see its own routes and nothing else.
**Eru and PC columns need someone with those repos open** — that is the missing half of
this tracker, and pretending otherwise is what §6 was trying to avoid.

`;

for (const [key, label] of Object.entries(groups)) {
  const rows = byGroup.get(key);
  if (!rows?.length) continue;
  out += `\n## ${label}\n\n| Route | What it is | Jackie | Eru | PC |\n|---|---|---|---|---|\n`;
  for (const r of rows) {
    const status = r.path === "/pc" || r.path === "/pc-apps" ? "via-embed" : "native";
    out += `| \`${r.path}\` | ${r.label} | ${status} | ? | ? |\n`;
  }
}

out += `\n## Eru modules\n\n${eruCount} pages are mounted under \`/eru/*\` from \`src/eru/routes.generated.ts\`,
all \`imported\`, all rendering (\`npm run smoke\`). They are listed there rather than
repeated here — that file is generated from Eru's own App.jsx and is the authority.

## What this tracker cannot tell you

- **Whether an imported page works against a real backend.** \`npm run smoke\` proves each
  renders; it does not prove Base44 or Supabase answers it.
- **Feature-level parity.** This is a route census. The per-app checklist §6 describes needs
  \`FEATURE_AUDIT.md\`, which is not in this repo.
`;

writeFileSync("PARITY_MATRIX.md", out);
console.log(`PARITY_MATRIX.md — ${core.length} native routes, ${eruCount} Eru modules`);
