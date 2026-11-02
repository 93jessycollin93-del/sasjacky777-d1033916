/**
 * Short names for every app, for SANDi's "all apps" grid.
 *
 * The grid listed eight routes and showed "Open Workstation" twice, because the
 * /work alias carried the same name. The owner asked for every app, each name
 * readable at a glance: one or two words stay as written; three or more become
 * initials ("Project Zomboid: Realism Overhaul" → "PZRO"). Initials collide
 * ("Activity Audit Log" / "Admin Account List"), so a collision borrows the
 * next letters of the last word until the name is unique — never a number,
 * which carries no meaning. The full name stays on hover and in search.
 */
import { SUGGESTABLE_ROUTES, type RouteEntry } from "@/lib/routeManifest";

export interface AppEntry {
  path: string;
  /** Full name, without the parenthetical description. */
  name: string;
  short: string;
}

/** "Eru · AdminEconomyDashboard" → ["Eru", "Admin", "Economy", "Dashboard"]. */
export function nameWords(name: string): string[] {
  return name
    .replace(/\(.*?\)/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9-]+/)
    .flatMap((w) => (/^[A-Z]-[A-Z]/.test(w) ? [w] : w.split("-")))
    .filter(Boolean);
}

export function shortAppName(name: string): string {
  const words = nameWords(name);
  if (words.length <= 2) return words.join(" ");
  return words.map((w) => w[0].toUpperCase()).join("");
}

/** Every app once, aliases dropped, short names unique. */
export function allApps(routes: RouteEntry[] = SUGGESTABLE_ROUTES): AppEntry[] {
  const seenName = new Set<string>();
  const used = new Set<string>();
  const apps: AppEntry[] = [];
  for (const route of routes) {
    if (route.alias) continue;
    const name = route.label.replace(/\s*\(.*?\)\s*$/, "").trim();
    if (seenName.has(name.toLowerCase())) continue;
    seenName.add(name.toLowerCase());

    const words = nameWords(name);
    let short = shortAppName(name);
    const last = words[words.length - 1] ?? "";
    for (let extra = 1; used.has(short.toLowerCase()) && extra < last.length; extra++) {
      short = shortAppName(name) + last.slice(1, extra + 1).toLowerCase();
    }
    // Two-word names that still collide fall back to their path, which is unique.
    if (used.has(short.toLowerCase())) short = route.path;
    used.add(short.toLowerCase());
    apps.push({ path: route.path, name, short });
  }
  return apps;
}
