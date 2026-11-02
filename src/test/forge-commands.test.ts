import { describe, expect, it } from "vitest";
import {
  availableCommands, filterCommands, pickIndex, resolveUtterance, suggestedCommands,
} from "@/lib/forge/commands";
import { validateIndex, emptyDraft, type CraftedIndex } from "@/lib/forge/types";

/**
 * Reading what someone said.
 *
 * The pill's mockup promised a "0% latency command list", which is a claim
 * worth taking literally: "Open Tasks" should move the app before a model has
 * finished loading, let alone answering. A launcher that routes navigation
 * through an LLM is slower than the menu it replaced and wrong more often.
 *
 * These cover the line between the two paths, which is the only hard part —
 * everything either side of it is a string comparison.
 */

function makeIndex(overrides: Partial<CraftedIndex>): CraftedIndex {
  const verdict = validateIndex({
    ...emptyDraft(),
    id: "notes",
    name: "Notes",
    specialty: "Things written down.",
    systemPrompt: "Answer from notes.",
    keywords: ["note", "jotted"],
    reads: ["conversations"],
    ...overrides,
  }) as { index: CraftedIndex };
  if (!verdict.index) throw new Error("fixture does not validate");
  return { ...verdict.index, ...overrides } as CraftedIndex;
}

const notes = makeIndex({});
const board = makeIndex({
  id: "board",
  name: "Board",
  keywords: ["board", "column", "card"],
  commands: [{ phrase: "Open Board", route: "/micro/board" }],
});

describe("the fast path", () => {
  it("matches a phrase a crafted index declared, exactly", () => {
    const hit = resolveUtterance("Open Board", [board]);
    expect(hit).toMatchObject({ kind: "command", path: "/micro/board", confidence: 1 });
  });

  it("matches a route by name after a verb", () => {
    const hit = resolveUtterance("open vault", []);
    expect(hit).toMatchObject({ kind: "command", path: "/vault" });
  });

  it("understands the other ways people say it", () => {
    for (const phrasing of ["go to vault", "show me vault", "take me to vault", "launch vault"]) {
      expect(resolveUtterance(phrasing, []), phrasing).toMatchObject({ kind: "command", path: "/vault" });
    }
  });

  it("is case and punctuation insensitive", () => {
    expect(resolveUtterance("  OPEN, VAULT!  ", [])).toMatchObject({ kind: "command", path: "/vault" });
  });

  it("prefers a crafted command over a route that shares its words", () => {
    // Someone who wrote "Open Board" for their own index meant that one.
    const hit = resolveUtterance("open board", [board]);
    expect(hit).toMatchObject({ path: "/micro/board", source: "Board" });
  });
});

describe("the line between a command and a question", () => {
  it("does not navigate on a question that merely contains a route name", () => {
    const hit = resolveUtterance("what did I write about the vault", [notes]);
    // The word appears, but nothing asked to go anywhere. Silently navigating
    // away from a question is far worse than answering a navigation request.
    expect(hit?.kind).toBe("question");
  });

  it("treats a bare verb as a question rather than guessing a destination", () => {
    expect(resolveUtterance("open", [])?.kind).toBe("question");
  });

  it("returns nothing at all for an empty utterance", () => {
    expect(resolveUtterance("   ", [])).toBeNull();
  });
});

describe("choosing the index that answers", () => {
  it("routes a question to the index whose keyword it uses", () => {
    const hit = resolveUtterance("where is that note about rent", [notes, board]);
    expect(hit).toMatchObject({ kind: "question", index: { id: "notes" } });
  });

  it("counts a whole word for more than a fragment", () => {
    const art = makeIndex({ id: "art", name: "Art", keywords: ["art"] });
    const start = makeIndex({ id: "starts", name: "Starts", keywords: ["start"] });
    // An index keyed on "art" must not claim every question containing
    // "start", "chart" or "partition": the wrong index answering is worse than
    // none, because it brings the wrong partitions with it.
    expect(pickIndex("how do I start the engine", [art, start])?.id).toBe("starts");
  });

  it("claims nothing when no keyword matches", () => {
    expect(pickIndex("unrelated words entirely", [notes])).toBeNull();
  });
});

describe("the command list", () => {
  it("lists crafted commands before routes", () => {
    expect(availableCommands([board])[0]).toMatchObject({ label: "Open Board", source: "Board" });
  });

  it("does not list a route a crafted command already covers", () => {
    const paths = availableCommands([board]).map((c) => c.path);
    expect(paths.filter((p) => p === "/micro/board")).toHaveLength(1);
  });

  it("narrows as you type", () => {
    const filtered = filterCommands("vau", []);
    expect(filtered.some((c) => c.path === "/vault")).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(8);
  });

  it("shows something before anything is typed", () => {
    expect(suggestedCommands([board]).length).toBeGreaterThan(0);
  });
});
