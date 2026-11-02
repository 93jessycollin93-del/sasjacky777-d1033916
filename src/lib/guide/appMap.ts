/**
 * What the guide knows about the app.
 *
 * Derived from the route manifest rather than written down beside it. A guide
 * with its own copy of "what this app contains" is a guide that goes stale the
 * first time a route is renamed, and a wrong direction from the one screen
 * meant to orient you is worse than no screen at all. Everything here is
 * computed from `ROUTE_MANIFEST`, so a route that stops existing stops being
 * offered in the same commit.
 */
import { ROUTE_MANIFEST, resolveRoute, type RouteEntry } from "@/lib/routeManifest";

/** Routes worth sending a person to: real destinations, not redirects or auth. */
export const GUIDE_DESTINATIONS: RouteEntry[] = ROUTE_MANIFEST.filter(
  (route) => !route.alias && !route.path.includes(":") && route.path !== "/auth",
);

const GROUP_WORDS: Record<RouteEntry["group"], string[]> = {
  core: ["core", "system", "home", "shell", "start"],
  ai: ["ai", "model", "agent", "bot", "chat", "llm", "inference"],
  ops: ["ops", "operations", "monitor", "dashboard", "control", "security"],
  eru: ["eru", "market", "trade", "card", "game"],
};

/** Words that carry no signal about where to go. */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "do", "does",
  "how", "what", "where", "when", "which", "can", "i", "my", "me", "you", "it", "this",
  "that", "get", "go", "see", "show", "find", "open", "use", "with", "from", "at", "about",
  "please", "would", "should", "could", "there", "here", "app", "jackie",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

export interface RouteMatch {
  route: RouteEntry;
  score: number;
}

/**
 * The routes a question is actually about, best first.
 *
 * Scored on the words of the question against each route's label, path and
 * group. Returns nothing rather than a weak guess: a guide that always answers
 * "try /markets" to a question it did not understand teaches people to stop
 * reading it.
 */
export function findRoutes(question: string, limit = 4): RouteMatch[] {
  const asked = words(question);
  if (!asked.length) return [];

  const matches: RouteMatch[] = [];
  for (const route of GUIDE_DESTINATIONS) {
    const label = words(route.label);
    const segments = words(route.path);
    const group = GROUP_WORDS[route.group];

    let score = 0;
    for (const word of asked) {
      if (segments.includes(word)) score += 5;
      else if (label.includes(word)) score += 4;
      else if (segments.some((s) => s.startsWith(word) || word.startsWith(s))) score += 2;
      else if (label.some((l) => l.startsWith(word) || word.startsWith(l))) score += 2;
      else if (group.includes(word)) score += 1;
    }
    if (score > 0) matches.push({ route, score });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.route.path.length - b.route.path.length)
    .slice(0, limit);
}

/** The compact map handed to the model as context. Paths only — nothing invented downstream. */
export function mapForPrompt(matches: RouteMatch[]): string {
  return matches.map(({ route }) => `${route.path} — ${route.label}`).join("\n");
}

/**
 * Every path the model named that the app does not serve.
 *
 * A small model asked "where do I do X" will happily answer "/settings" for an
 * app that has no /settings. Guidance is the one place where a plausible wrong
 * answer costs more than no answer, so the prose is checked against the router's
 * own manifest before anyone reads it.
 */
export function unservedPaths(text: string): string[] {
  const cited = text.match(/\/[a-z0-9][a-z0-9/-]*/gi) ?? [];
  const unserved = cited
    .map((path) => path.replace(/[.,;:)\]]+$/, ""))
    .filter((path) => resolveRoute(path) === null);
  return [...new Set(unserved)];
}
