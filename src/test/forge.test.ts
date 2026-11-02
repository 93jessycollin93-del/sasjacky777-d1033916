import { describe, expect, it } from "vitest";
import { emptyDraft, slugify, validateIndex, type CraftedIndex } from "@/lib/forge/types";
import { parseIndexes, serializeIndexes, suggestFilename } from "@/lib/forge/exchange";
import { mergeIndexes } from "@/lib/forge/store";

/**
 * The forge.
 *
 * `contextRouter.ts` shipped four of these hard-coded and they were the right
 * idea — a specialisation paired with the partitions it reads and the ladder
 * allowed to answer it. The only thing wrong was that a fifth meant editing
 * TypeScript.
 *
 * These cover the three parts with decisions in them: what may be saved, what
 * may be imported, and what happens when two devices disagree.
 */

function draft(overrides: Partial<CraftedIndex> = {}) {
  return {
    ...emptyDraft(),
    id: "field-notes",
    name: "Field Notes",
    specialty: "What I wrote down while away from the desk.",
    systemPrompt: "You answer from the operator's own notes. Quote them.",
    keywords: ["note", "wrote", "jotted"],
    reads: ["conversations" as const],
    ...overrides,
  };
}

const index = (overrides: Partial<CraftedIndex> = {}): CraftedIndex => {
  const verdict = validateIndex(draft(overrides)) as { ok: boolean; index: CraftedIndex };
  if (!verdict.index) throw new Error("fixture does not validate");
  return { ...verdict.index, ...overrides };
};

describe("what may be saved", () => {
  it("accepts a draft that could actually answer something", () => {
    const verdict = validateIndex(draft());
    expect(verdict.ok).toBe(true);
  });

  it("reports every problem at once, not the first", () => {
    const verdict = validateIndex({ ...draft(), name: "", keywords: [], modelId: "" }) as {
      problems: string[];
    };
    // A forge that rejects one field at a time makes the author submit five
    // times to learn five things, and the fifth rejection is the one that
    // makes them give up.
    expect(verdict.problems.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses a model that is not in the registry", () => {
    const verdict = validateIndex(draft({ modelId: "gpt-9-ultra" })) as { problems: string[] };
    expect(verdict.problems.join(" ")).toMatch(/not a model in the registry/);
  });

  it("refuses a partition that does not exist", () => {
    const verdict = validateIndex(draft({ reads: ["nonsense" as never] })) as { problems: string[] };
    expect(verdict.problems.join(" ")).toMatch(/not a partition/);
  });

  it("refuses an empty ladder, because nothing could answer it", () => {
    const verdict = validateIndex(draft({ ladder: [] })) as { problems: string[] };
    expect(verdict.problems.join(" ")).toMatch(/at least one engine locality/);
  });

  it("refuses no keywords, because nothing would ever route to it", () => {
    const verdict = validateIndex(draft({ keywords: [] })) as { problems: string[] };
    expect(verdict.problems.join(" ")).toMatch(/at least one keyword/);
  });

  it("refuses a command route that is not an in-app path", () => {
    const verdict = validateIndex(
      draft({ commands: [{ phrase: "Open evil", route: "https://elsewhere.example" }] }),
    ) as { problems: string[] };
    expect(verdict.problems.join(" ")).toMatch(/must start with/);
  });

  it("normalises keywords and drops duplicates", () => {
    const verdict = validateIndex(draft({ keywords: ["Note", "note", " NOTE "] })) as {
      index: CraftedIndex;
    };
    expect(verdict.index.keywords).toEqual(["note"]);
  });

  it("starts a new index offline-first, on the model the app ships", () => {
    const blank = emptyDraft();
    expect(blank.ladder[0]).toBe("device");
    expect(blank.modelId).toBe("bonsai-1.7b");
  });
});

describe("slugify", () => {
  it("makes the same id from the same name every time", () => {
    expect(slugify("Field Notes")).toBe("field-notes");
    expect(slugify("  Trade & Ledger!  ")).toBe("trade-ledger");
  });
});

describe("what may be imported", () => {
  it("round-trips what it exported", () => {
    const mine = index();
    const report = parseIndexes(serializeIndexes([mine]));
    expect(report.rejected).toEqual([]);
    expect(report.accepted[0].id).toBe(mine.id);
  });

  it("accepts a single index exported on its own", () => {
    const report = parseIndexes(JSON.stringify(index()));
    expect(report.accepted).toHaveLength(1);
  });

  it("keeps the good entries and names the bad ones", () => {
    const pack = {
      kind: "sas-jacky.index-pack",
      version: 1,
      indexes: [index(), { ...index({ id: "broken" }), modelId: "invented" }],
    };
    const report = parseIndexes(JSON.stringify(pack));

    // An exported file is editable text and people do edit it. One bad entry
    // should not cost the author the rest of the pack.
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected.join(" ")).toMatch(/not a model in the registry/);
  });

  it("refuses a pack written by a newer build rather than truncating it", () => {
    const report = parseIndexes(JSON.stringify({ indexes: [index()], version: 99 }));
    expect(report.accepted).toEqual([]);
    expect(report.rejected.join(" ")).toMatch(/version 99/);
  });

  it("says so plainly when the file is not JSON at all", () => {
    const report = parseIndexes("<html>404</html>");
    expect(report.rejected.join(" ")).toMatch(/not JSON/);
  });

  it("keeps the timestamps a file carried", () => {
    const mine = index();
    const born = "2020-01-02T03:04:05.000Z";
    const report = parseIndexes(JSON.stringify({ indexes: [{ ...mine, createdAt: born }] }));
    // An imported index claiming to have been created the moment it was
    // imported loses the only history it had.
    expect(report.accepted[0].createdAt).toBe(born);
  });

  it("names a single export after the index inside it", () => {
    expect(suggestFilename([index()])).toMatch(/^field-notes-\d{4}-\d{2}-\d{2}\.index\.json$/);
  });
});

describe("when two devices disagree", () => {
  const older = index({ id: "shared", updatedAt: "2026-01-01T00:00:00.000Z" });
  const newer = index({ id: "shared", updatedAt: "2026-06-01T00:00:00.000Z" });

  it("pulls down an index this device has never seen", () => {
    const result = mergeIndexes([], [newer], {});
    expect(result.toPull.map((i) => i.id)).toEqual(["shared"]);
    expect(result.merged).toHaveLength(1);
  });

  it("pushes up an index the server has never seen", () => {
    const result = mergeIndexes([newer], [], {});
    expect(result.toPush.map((i) => i.id)).toEqual(["shared"]);
  });

  it("keeps the newer of two edits to the same index", () => {
    const remoteWins = mergeIndexes([older], [newer], {});
    expect(remoteWins.merged[0].updatedAt).toBe(newer.updatedAt);
    expect(remoteWins.resolved).toEqual(["shared"]);

    const localWins = mergeIndexes([newer], [older], {});
    expect(localWins.toPush.map((i) => i.id)).toEqual(["shared"]);
  });

  it("does not resurrect something deleted here after it last changed there", () => {
    const tombstones = { shared: "2026-07-01T00:00:00.000Z" };
    const result = mergeIndexes([], [newer], tombstones);
    // Without the tombstone the sync would see it present remotely and absent
    // locally, treat that as something to pull down, and undo the delete.
    expect(result.merged).toEqual([]);
    expect(result.toPull).toEqual([]);
  });

  it("does restore something deleted here but edited there afterwards", () => {
    const tombstones = { shared: "2026-02-01T00:00:00.000Z" };
    const result = mergeIndexes([], [newer], tombstones);
    // The delete is older than the remote edit, so the edit is the later
    // intention and wins. Losing a deliberate change is worse than an
    // unexpected restore, which is one click to undo.
    expect(result.merged.map((i) => i.id)).toEqual(["shared"]);
  });

  it("loses nothing when both sides hold different indexes", () => {
    const mine = index({ id: "mine" });
    const theirs = index({ id: "theirs" });
    const result = mergeIndexes([mine], [theirs], {});
    expect(result.merged.map((i) => i.id).sort()).toEqual(["mine", "theirs"]);
  });
});
