// The /path micro-router context.
//
// One list of every reachable destination in the system — app routes, Eru
// modules, embedded PC apps and the Repair Bay's own tabs — so that a name typed
// in chat can be resolved to an exact path instead of a guess.
//
// It is derived, never hand-maintained: routes come from the central route
// manifest and PC apps from the generated roster, so the directory grows on its
// own as the app grows and can never drift into dead links.

import { ROUTE_MANIFEST, type RouteEntry } from "@/lib/routeManifest";
import { PC_APPS } from "@/data/pcApps";

export type DestinationKind = "route" | "eru" | "pc-app" | "panel" | "external";

export type Destination = {
  /** Path (or deep link) to navigate to. */
  path: string;
  /** Human name, as the surface itself calls it. */
  label: string;
  kind: DestinationKind;
  /** Grouping shown in the directory. */
  group: string;
  /** Extra words that should match this destination. */
  keywords?: string[];
  /** True when the path only redirects into another path. */
  alias?: boolean;
};

const GROUP_LABEL: Record<RouteEntry["group"], string> = {
  core: "Core",
  ai: "AI & Agents",
  ops: "Data & Ops",
  eru: "Eru modules",
};

/** Repair Bay tabs — real panels, reachable by deep link. */
export const REPAIR_PANELS: Destination[] = [
  ["detected", "Detected Inventory"],
  ["evidence", "Evidence Log"],
  ["rig", "Rig Profile"],
  ["playbooks", "Repair Playbooks"],
  ["toolkit", "AI + Repair Toolkit"],
  ["firmware", "Firmware Log"],
  ["risk", "Update Risk"],
  ["bootstick", "Boot Stick Wizard"],
  ["capture", "Session Capture"],
  ["consult", "Consultant"],
].map(([id, label]) => ({
  path: `/repair?tab=${id}`,
  label: `Repair Bay · ${label}`,
  kind: "panel" as const,
  group: "Repair Bay",
  keywords: ["repair", "maintenance", id],
}));

const ROUTE_DESTINATIONS: Destination[] = ROUTE_MANIFEST.map((r) => ({
  path: r.path,
  label: r.label,
  kind: r.group === "eru" ? ("eru" as const) : ("route" as const),
  group: GROUP_LABEL[r.group],
  alias: r.alias,
}));

const PC_DESTINATIONS: Destination[] = PC_APPS.map((a) => ({
  path: `/pc?app=${a.appId}`,
  label: `The PC · ${a.name}`,
  kind: "pc-app" as const,
  group: "The PC (embedded apps)",
  keywords: [a.appId, "pc", "desktop"],
}));

const EXTERNAL_DESTINATIONS: Destination[] = [
  {
    path: "/app-commander.html",
    label: "eYe App Commander",
    kind: "external",
    group: "Core",
    keywords: ["commander", "fleet", "vault"],
  },
  {
    path: "/strongbox.html",
    label: "Strongbox",
    kind: "external",
    group: "Core",
    keywords: ["strongbox", "vault", "encrypted", "offline", "private", "notes", "backup"],
  },
  {
    path: "/pc-os/verify-provenance.html",
    label: "PC provenance verifier",
    kind: "external",
    group: "Core",
    keywords: ["provenance", "verify", "signature"],
  },
];

/** Every location in the system, in one directory. */
export const DESTINATIONS: Destination[] = [
  ...ROUTE_DESTINATIONS,
  ...REPAIR_PANELS,
  ...PC_DESTINATIONS,
  ...EXTERNAL_DESTINATIONS,
];

export const DESTINATION_GROUPS: string[] = Array.from(
  new Set(DESTINATIONS.map((d) => d.group)),
);

function norm(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolves a free-text name ("grok", "boot stick", "model router") to the
 * destinations that match it, best first. Exact path or label matches win;
 * otherwise every token has to appear somewhere in the entry.
 */
export function findDestinations(query: string, limit = 12): Destination[] {
  const q = norm(query);
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean);

  return DESTINATIONS.map((d) => {
    const hay = norm(`${d.path} ${d.label} ${(d.keywords ?? []).join(" ")}`);
    if (!tokens.every((t) => hay.includes(t))) return null;
    let score = 0;
    if (norm(d.path) === q || norm(d.label) === q) score -= 20;
    if (norm(d.label).startsWith(q)) score -= 10;
    if (d.alias) score += 4;
    score += Math.min(d.label.length, 40) / 40;
    return { d, score };
  })
    .filter((x): x is { d: Destination; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.d);
}

/** Compact directory text, for injecting into a router/chat context prompt. */
export function pathRouterContext(): string {
  const byGroup = DESTINATION_GROUPS.map((g) => {
    const rows = DESTINATIONS.filter((d) => d.group === g).map(
      (d) => `- ${d.label} → ${d.path}${d.alias ? " (alias)" : ""}`,
    );
    return `${g} (${rows.length}):\n${rows.join("\n")}`;
  });
  return [
    `PATH DIRECTORY — every reachable location (${DESTINATIONS.length} total).`,
    "Given an app or surface name, answer with its exact path from this list. Never invent a path that is not here.",
    ...byGroup,
  ].join("\n\n");
}
