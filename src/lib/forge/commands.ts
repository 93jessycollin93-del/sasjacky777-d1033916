/**
 * Turning what someone said into either a destination or a question.
 *
 * The pill's mockup promised a "0% latency command list", and that phrase is
 * worth taking literally rather than decoratively: "Open Tasks" should move the
 * app before a model has finished loading, let alone answering. A launcher that
 * routes a navigation request through an LLM is slower than the menu it
 * replaced and wrong more often.
 *
 * So there are two paths and the fast one is tried first:
 *
 *   1. **Command.** Matched against the route manifest and against the commands
 *      crafted indexes declare. Resolves to a path. No model, no network, no
 *      await — this is a string comparison over a list that is already in
 *      memory.
 *   2. **Question.** Everything else, routed to whichever index is expert in it
 *      by keyword, and answered on that index's own engine ladder.
 *
 * Both are pure functions over their inputs, which is what lets the ambiguous
 * cases — "open" alone, a phrase that matches two indexes, a route name that is
 * also a keyword — be settled in tests rather than in a browser.
 */
import { SUGGESTABLE_ROUTES } from "@/lib/routeManifest";
import type { CraftedIndex } from "./types";

export interface CommandHit {
  kind: "command";
  /** Where it goes. */
  path: string;
  /** What to show as having been understood: "Open Tasks". */
  label: string;
  /** The crafted index that declared it, when one did. */
  source: string | null;
  /** 0–1. 1 is an exact phrase match. */
  confidence: number;
}

export interface QuestionHit {
  kind: "question";
  text: string;
  /** Index whose keywords matched, or null when nothing claimed it. */
  index: CraftedIndex | null;
}

export type Resolution = CommandHit | QuestionHit;

/**
 * Words that only ever introduce a command, and carry no meaning of their own.
 *
 * Sorted longest first, and that is load-bearing rather than tidy: matched in
 * declaration order, "show" is found before "show me", so "show me vault"
 * loses only "show" and is left asking for "me vault" — which matches nothing
 * and falls through to being treated as a question. The longest prefix has to
 * win.
 */
const VERBS = ["open", "go to", "goto", "show", "show me", "take me to", "launch", "jump to"].sort(
  (a, b) => b.length - a.length,
);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s/]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Strips a leading command verb. "Open Tasks" → "tasks". */
function stripVerb(text: string): string {
  const plain = normalise(text);
  for (const verb of VERBS) {
    if (plain === verb) return "";
    if (plain.startsWith(`${verb} `)) return plain.slice(verb.length + 1);
  }
  return plain;
}

/** The label a route is known by, without its group or parenthetical. */
function routeWords(label: string, path: string): string[] {
  const fromLabel = normalise(label.replace(/\(.*?\)/g, "")).split(" ").filter(Boolean);
  const fromPath = path.split("/").filter(Boolean).map(normalise);
  return [...new Set([...fromLabel, ...fromPath])].filter((w) => w.length > 1);
}

/**
 * Every command the pill can run right now, for the list it shows.
 *
 * Crafted commands come first: someone who wrote "Open Board" for their own
 * index meant that one, not a route that happens to share the word.
 */
export function availableCommands(indexes: CraftedIndex[]): CommandHit[] {
  const crafted: CommandHit[] = indexes.flatMap((index) =>
    index.commands
      .filter((command) => !!command.route)
      .map((command) => ({
        kind: "command" as const,
        path: command.route!,
        label: command.phrase,
        source: index.name,
        confidence: 1,
      })),
  );

  const seen = new Set(crafted.map((c) => c.path));
  const routes: CommandHit[] = SUGGESTABLE_ROUTES.filter((route) => !seen.has(route.path)).map(
    (route) => ({
      kind: "command" as const,
      path: route.path,
      label: `Open ${route.label.replace(/\s*\(.*?\)\s*$/, "")}`,
      source: null,
      confidence: 1,
    }),
  );

  return [...crafted, ...routes];
}

/**
 * Reads one utterance.
 *
 * A command needs a verb or an exact phrase. That rule is what stops a question
 * like "what did I write about the vault" from being swallowed as navigation to
 * `/vault` — the word appears, but nothing asked to go anywhere, and silently
 * navigating away from a question is far more annoying than answering a
 * navigation request as a question.
 */
export function resolveUtterance(raw: string, indexes: CraftedIndex[]): Resolution | null {
  const text = raw.trim();
  if (!text) return null;

  const plain = normalise(text);
  const target = stripVerb(text);
  const hadVerb = target !== plain;

  const commands = availableCommands(indexes);

  // An exact phrase, with or without a verb. "Open Tasks" as written by the
  // author of an index beats everything else.
  for (const command of commands) {
    if (normalise(command.label) === plain) return command;
  }

  if (hadVerb && target) {
    // Exact name after the verb: "open tasks" → the route called Tasks.
    for (const command of commands) {
      const words = routeWords(command.label.replace(/^open /i, ""), command.path);
      if (words.includes(target) || normalise(command.path) === `/${target}`) {
        return { ...command, confidence: 0.9 };
      }
    }
    // Partial, but still clearly a navigation: the verb said so.
    const partial = commands.find((command) =>
      routeWords(command.label, command.path).some((word) => word.startsWith(target)),
    );
    if (partial) return { ...partial, confidence: 0.6 };
  }

  return { kind: "question", text, index: pickIndex(text, indexes) };
}

/**
 * Which crafted index is expert in this.
 *
 * Whole-word matches count double. Without that, an index with the keyword
 * "art" claims every question containing "start", "chart" or "partition" — and
 * the wrong index answering is worse than no index answering, because it brings
 * the wrong partitions with it.
 */
export function pickIndex(text: string, indexes: CraftedIndex[]): CraftedIndex | null {
  const plain = normalise(text);
  const words = new Set(plain.split(" ").filter(Boolean));

  let best: CraftedIndex | null = null;
  let bestScore = 0;

  for (const index of indexes) {
    let score = 0;
    for (const keyword of index.keywords) {
      const key = normalise(keyword);
      if (!key) continue;
      if (words.has(key)) score += 2;
      else if (plain.includes(key)) score += 1;
    }
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

/** The commands to show before anything is typed, crafted ones first. */
export function suggestedCommands(indexes: CraftedIndex[], limit = 8): CommandHit[] {
  return availableCommands(indexes).slice(0, limit);
}

/** Commands matching what has been typed so far, for the live list. */
export function filterCommands(query: string, indexes: CraftedIndex[], limit = 8): CommandHit[] {
  const target = stripVerb(query) || normalise(query);
  if (!target) return suggestedCommands(indexes, limit);

  return availableCommands(indexes)
    .filter((command) => {
      const words = routeWords(command.label, command.path);
      return (
        normalise(command.label).includes(target) ||
        words.some((word) => word.startsWith(target))
      );
    })
    .slice(0, limit);
}
