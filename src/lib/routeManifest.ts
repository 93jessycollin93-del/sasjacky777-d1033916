import { ERU_ROUTES } from "@/eru/routes.generated";

export type RouteEntry = {
  /** Absolute path pattern, e.g. "/swarm" or "/eru/playlists/:id" */
  path: string;
  /** Human label used in nav + 404 suggestions */
  label: string;
  /** Grouping used by nav surfaces and the debug overlay */
  group: "core" | "ai" | "ops" | "eru";
  /** True when the route only exists as a redirect into another route */
  alias?: boolean;
};

/**
 * Single central route manifest.
 *
 * Every navigable module in the app is declared here exactly once. Router
 * aliases, the 404 suggester and the debug overlay all read from this list, so
 * an imported Eru module path can never drift away from the page that serves
 * it.
 */
export const CORE_ROUTES: RouteEntry[] = [
  { path: "/", label: "Home", group: "core" },
  { path: "/workstation", label: "Workstation (the whole system, one flow)", group: "core" },
  { path: "/guide", label: "Guide (how to use this app, answered on device)", group: "core" },
  { path: "/work", label: "Workstation (alias)", group: "core", alias: true },
  { path: "/path", label: "Path Router", group: "core" },
  { path: "/core", label: "Jackie Core (owner only)", group: "core" },
  { path: "/morals", label: "Jackie's Morals (guard rail, owner only)", group: "core" },
  { path: "/skills", label: "Skills & tools for Jackie's agents", group: "ai" },
  { path: "/pc", label: "The PC", group: "core" },
  { path: "/pc-apps", label: "PC App Library", group: "core" },
  { path: "/repair", label: "Repair Bay", group: "core" },
  { path: "/bridge", label: "Local Bridge (terminal + model vault)", group: "core" },
  { path: "/play", label: "Play", group: "core" },
  { path: "/craft", label: "CollinSurvivalCraft (Minecraft-style block building and survival)", group: "core" },
  { path: "/zomboid-realism", label: "Project Zomboid: Realism Overhaul (mod workspace)", group: "core" },
  { path: "/minecraft", label: "CollinSurvivalCraft (alias)", group: "core", alias: true },
  { path: "/csc", label: "CollinSurvivalCraft (alias)", group: "core", alias: true },
  { path: "/hub", label: "Telegram Hub", group: "core" },
  { path: "/tasks", label: "Task Board (everything you and your agents are working on)", group: "core" },
  { path: "/tasks/calendar", label: "Task Calendar (tasks by the day they are due)", group: "core" },
  { path: "/vault", label: "Vault", group: "core" },
  { path: "/sandbox", label: "Sandbox", group: "core" },
  { path: "/welcome", label: "Welcome (what this is)", group: "core" },
  { path: "/auth", label: "Sign in", group: "core" },
  { path: "/index", label: "Home (alias)", group: "core", alias: true },

  { path: "/bots", label: "Bot Foundry", group: "ai" },
  { path: "/swarm", label: "Bot Swarm", group: "ai" },
  { path: "/control", label: "Jackie Control", group: "ai" },
  { path: "/providers", label: "AI Providers", group: "ai" },
  { path: "/grok", label: "Grok Studio", group: "ai" },
  { path: "/forge", label: "Index Forge (craft your own micro-AI indexes)", group: "ai" },
  { path: "/agent-lab", label: "Agent Lab", group: "ai" },
  { path: "/agent-compare", label: "Agent Compare", group: "ai" },
  { path: "/local-ai", label: "Local AI Test (Ollama on this machine)", group: "ai" },
  { path: "/jacky-live", label: "Jacky Live", group: "ai" },
  { path: "/keys", label: "API Keys", group: "ai" },
  { path: "/micro", label: "Jacky Micro-AI", group: "ai" },
  { path: "/micro/board", label: "Micro-Model Board", group: "ai" },
  { path: "/models", label: "Model download queue (180 compact models, and which run here)", group: "ai" },
  { path: "/triage", label: "Build Error Triage", group: "ai" },

  { path: "/gunit", label: "G-Unit Dashboard", group: "ops" },
  { path: "/gunit/bots", label: "G-Unit Bot Factory", group: "ops" },
  { path: "/gunit/chat", label: "G-Unit Chat", group: "ops" },
  { path: "/gunit/agents", label: "G-Unit Agents", group: "ops" },
  { path: "/gunit/users", label: "G-Unit Users", group: "ops" },
  { path: "/gunit/keys", label: "G-Unit API Keys", group: "ops" },
  { path: "/sphere", label: "Sphere Command", group: "ops" },
  { path: "/veilops", label: "VeilOps Threat Intel", group: "ops" },
  { path: "/apex", label: "Apex Hub", group: "ops" },
  { path: "/marvels", label: "Microscopic Marvels", group: "ops" },
  { path: "/pods", label: "eYe Pod Station", group: "ops" },
  { path: "/pods/surface", label: "Fold Surface (merged seeds)", group: "ops" },
  { path: "/eyepod", label: "eYe Pod Station (alias)", group: "ops", alias: true },
  { path: "/eyepod/surface", label: "Fold Surface (alias)", group: "ops", alias: true },
  { path: "/mesh", label: "Router Mesh", group: "ops" },
  { path: "/mesh/docs", label: "Router Mesh Docs", group: "ops" },
  { path: "/nervous", label: "Nervous System (impulses + filing cabinet)", group: "ops" },
  { path: "/github", label: "GitHub Sync", group: "ops" },
  { path: "/eru/visualizers", label: "Visualizer Lab", group: "eru" },
];

/** Eru module routes, mounted under /eru/<path>. */
export const ERU_MANIFEST: RouteEntry[] = ERU_ROUTES.map(({ path, name }) => ({
  path: `/eru${path ? `/${path}` : ""}`,
  label: `Eru · ${name}`,
  group: "eru" as const,
}));

/**
 * Root-level aliases for imported Eru module paths (e.g. "/markets" →
 * "/eru/markets"). Generated so a module path can never 404 just because it was
 * linked without the /eru prefix.
 */
export const ERU_ALIASES: RouteEntry[] = ERU_ROUTES.filter(({ path }) => path.length > 0)
  .filter(({ path }) => !CORE_ROUTES.some((r) => r.path === `/${path}`))
  .map(({ path, name }) => ({
    path: `/${path}`,
    label: `Eru · ${name}`,
    group: "eru" as const,
    alias: true,
  }));

export const ROUTE_MANIFEST: RouteEntry[] = [...CORE_ROUTES, ...ERU_MANIFEST, ...ERU_ALIASES];

/** Routes safe to show as suggestions (no params, no aliases-only duplicates). */
export const SUGGESTABLE_ROUTES: RouteEntry[] = ROUTE_MANIFEST.filter(
  (r) => !r.path.includes(":") && r.path !== "/auth",
);

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Cheap Levenshtein distance, used for closest-route matching. */
function distance(a: string, b: string) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[n];
}

export type RouteSuggestion = RouteEntry & { score: number };

/**
 * Returns the closest valid module routes for an unmatched path, ranked by
 * segment containment first and edit distance second.
 */
export function suggestRoutes(pathname: string, limit = 5): RouteSuggestion[] {
  const target = normalize(pathname);
  const segments = pathname.split("/").filter(Boolean).map(normalize);

  return SUGGESTABLE_ROUTES.map((entry) => {
    const candidate = normalize(entry.path);
    const label = normalize(entry.label);
    let score = distance(target, candidate);
    if (segments.some((s) => s.length > 2 && (candidate.includes(s) || label.includes(s)))) {
      score -= 12;
    }
    if (candidate.includes(target) || target.includes(candidate)) {
      // Weighted by how much of the longer string the shorter one actually
      // covers. A flat bonus let any short route that happened to be a prefix
      // of a typo outrank the route the person meant: "/workstaton" contains
      // "/work", so the four-character alias beat "/workstation" despite being
      // six edits further away. Full credit for a near-exact containment,
      // proportionally less for a fragment.
      const overlap =
        Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length, 1);
      score -= 6 * overlap;
    }
    // An alias only redirects to the real page. Both land correctly, but the
    // canonical path is the one worth showing and worth learning, so it wins a
    // tie.
    if (entry.alias) score += 0.5;
    return { ...entry, score };
  })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

/** Resolves a pathname to a manifest entry, following aliases where needed. */
export function resolveRoute(pathname: string): RouteEntry | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const exact = ROUTE_MANIFEST.find((r) => r.path === clean);
  if (exact) return exact;
  // param routes: /eru/playlists/:id
  return (
    ROUTE_MANIFEST.find((r) => {
      if (!r.path.includes(":")) return false;
      const pattern = r.path.split("/");
      const actual = clean.split("/");
      if (pattern.length !== actual.length) return false;
      return pattern.every((seg, i) => seg.startsWith(":") || seg === actual[i]);
    }) ?? null
  );
}
