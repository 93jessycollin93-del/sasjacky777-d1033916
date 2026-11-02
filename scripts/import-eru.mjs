#!/usr/bin/env node
/**
 * Brings a newer Eru (Cybernetic67) into src/eru/ without touching what Jackie
 * owns.
 *
 *   node scripts/import-eru.mjs <path-to-eru/src>            # dry run: report only
 *   node scripts/import-eru.mjs <path-to-eru/src> --write    # apply
 *
 * The first import was done by hand, and `routes.generated.ts` said it was
 * generated from Eru's App.jsx by a generator nobody had committed. So the only
 * way to refresh Eru was another hand copy — which is how a bridge file gets
 * overwritten with Eru's original and the Eru pages quietly stop signing in as
 * the Jackie user. This makes the rules the first import followed explicit and
 * repeatable:
 *
 * 1. Every `@/…` import becomes `@/eru/…`, because Eru lives under src/eru here.
 * 2. JACKIE_OWNED files are never written. They are the bridge between Eru and
 *    Jackie (sign-in, the Base44 shim, language, theme scoping, browser-safe
 *    crypto); Eru's own versions of them assume Eru is the whole app. When Eru
 *    changes one upstream, the run names it so a person can carry the change
 *    across by hand.
 * 3. Eru's shell — App.jsx, main.jsx, index.css — and its documents stay out:
 *    Jackie has its own shell, and the docs are not code.
 * 4. routes.generated.ts is regenerated from App.jsx, minus the sign-in routes
 *    (Jackie signs people in) and the catch-all.
 *
 * Files only Jackie has (EruRouter, EruPageShell, …) are never in Eru's tree, so
 * they are never touched. Nothing is deleted: a file Eru dropped is reported,
 * not removed, because something of Jackie's may still import it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(ROOT, "src", "eru");

/** Jackie's bridge files. Why each is Jackie's is in the file itself. */
export const JACKIE_OWNED = [
  "api/base44Client.js", // Eru's Base44 client → a shim signed in as the Jackie user
  "lib/AuthContext.jsx", // Eru's Base44 login → Jackie's Supabase session
  "context/LanguageContext.jsx", // Eru's own language store → the app-wide locale service
  "context/ThemeContext.jsx", // Eru's theme, scoped so it stops repainting Jackie
  "lib/economyVerification.js", // Node's `crypto` → the browser's, so the page loads at all
];

const SKIP = new Set([
  "App.jsx",
  "main.jsx",
  "index.css",
  // Eru's own link to the Jacky engine, loaded only by Eru's main.jsx. It can
  // talk to the engine directly with a token kept in localStorage; Jackie's
  // src/lib/jackyClient.ts goes through the owner-gated jacky-proxy function
  // and keeps the token server-side. Importing Eru's would leave a second,
  // weaker client in the tree for someone to wire up by mistake.
  "lib/jackyClient.ts",
  "lib/jackyBootstrap.js",
]);

/**
 * Eru routes not mounted inside Jackie, and why. The page file still comes
 * across; only the route is withheld.
 */
export const EXCLUDED_ROUTES = new Map([
  // Seeds its gauges with invented readings (GPU 54%, CPU 32%…) and, inside
  // Jackie, its engine call resolves to nothing — so it would show fabricated
  // "live" telemetry indefinitely. Jackie's own /jacky-live is the real one.
  ["/jacky-live", "Jackie's own /jacky-live reads the real engine"],
]);
const SKIP_EXT = [".md"];
const SKIP_DIRS = ["security/", "fleet-ui/"];
const AUTH_ROUTES = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);

export function rewriteImports(text) {
  return text.replace(/(['"])@\//g, "$1@/eru/");
}

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full).split(sep).join("/")];
  });
}

export function isSkipped(rel) {
  return SKIP.has(rel) || SKIP_EXT.some((ext) => rel.endsWith(ext)) || SKIP_DIRS.some((d) => rel.startsWith(d));
}

/**
 * The routes Eru's App.jsx mounts, as { path, name } in its own order.
 * `name` is the component the route renders, which is also the page's file.
 */
export function routesFromApp(appSource) {
  const lazyFile = new Map();
  for (const m of appSource.matchAll(/const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]\.\/pages\/([\w/]+)['"]\s*\)\s*\)/g)) {
    lazyFile.set(m[1], m[2]);
  }
  const routes = [];
  for (const m of appSource.matchAll(/<Route\s+path="([^"]+)"[^>]*element=\{([\s\S]*?)\}\s*\/>/g)) {
    const [, path, element] = m;
    if (path === "*" || AUTH_ROUTES.has(path) || EXCLUDED_ROUTES.has(path)) continue;
    const component = [...element.matchAll(/<(\w+)[\s/>]/g)].map((c) => c[1]).find((c) => lazyFile.has(c));
    if (!component) continue;
    routes.push({ path: path.replace(/^\//, ""), name: component, file: lazyFile.get(component) });
  }
  return routes;
}

export function renderRoutes(routes) {
  const lines = routes.map(
    (r) => `  { path: ${JSON.stringify(r.path)}, name: ${JSON.stringify(r.name)}, loader: () => import('@/eru/pages/${r.file}.jsx') },`,
  );
  return [
    "// AUTO-GENERATED from Eru's App.jsx by scripts/import-eru.mjs — do not hand-edit.",
    "// Each entry mounts under /eru/<path>.",
    "export type EruRouteDef = { path: string; name: string; loader: () => Promise<any> };",
    "export const ERU_ROUTES: EruRouteDef[] = [",
    ...lines,
    "];",
    "",
  ].join("\n");
}

function main() {
  const [src, flag] = process.argv.slice(2);
  if (!src || !existsSync(join(src, "App.jsx"))) {
    console.error("Usage: node scripts/import-eru.mjs <path-to-eru/src> [--write]\n(the folder holding Eru's App.jsx)");
    process.exit(2);
  }
  const write = flag === "--write";
  const report = { added: [], updated: [], same: 0, skipped: [], jackieOwnedChanged: [], droppedUpstream: [] };
  const upstream = walk(src);

  for (const rel of upstream) {
    if (isSkipped(rel)) { report.skipped.push(rel); continue; }
    const incoming = rewriteImports(readFileSync(join(src, rel), "utf8"));
    const target = join(DEST, rel);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (JACKIE_OWNED.includes(rel)) {
      if (current !== null && current.trimEnd() !== incoming.trimEnd()) report.jackieOwnedChanged.push(rel);
      continue;
    }
    if (current !== null && current.trimEnd() === incoming.trimEnd()) { report.same += 1; continue; }
    (current === null ? report.added : report.updated).push(rel);
    if (write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, incoming);
    }
  }

  const upstreamSet = new Set(upstream);
  const jackieOnly = new Set(["EruErrorBoundary.tsx", "EruPageShell.tsx", "EruRouter.tsx", "FloatingEditorNav.tsx", "VisualizerLab.tsx", "routes.generated.ts"]);
  report.droppedUpstream = walk(DEST).filter((rel) => !upstreamSet.has(rel) && !jackieOnly.has(rel));

  const routes = routesFromApp(readFileSync(join(src, "App.jsx"), "utf8"));
  const routesText = renderRoutes(routes);
  const routesPath = join(DEST, "routes.generated.ts");
  const routesChanged = readFileSync(routesPath, "utf8") !== routesText;
  if (write && routesChanged) writeFileSync(routesPath, routesText);

  const list = (title, items) => items.length && console.log(`\n${title} (${items.length}):\n  ${items.join("\n  ")}`);
  console.log(`${write ? "Imported" : "Dry run — nothing written"}. ${report.same} files already current.`);
  list("New", report.added);
  list("Updated", report.updated);
  list("Kept as Jackie's — Eru changed these upstream; review by hand", report.jackieOwnedChanged);
  list("Here but no longer in Eru — left in place", report.droppedUpstream);
  console.log(`\nRoutes: ${routes.length}${routesChanged ? (write ? " — routes.generated.ts rewritten" : " — routes.generated.ts would change") : " — unchanged"}`);
  for (const [path, why] of EXCLUDED_ROUTES) console.log(`  not mounted: ${path} — ${why}`);
  console.log(`Skipped (Eru's shell and docs): ${report.skipped.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
