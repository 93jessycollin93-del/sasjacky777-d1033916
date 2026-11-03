import { beforeEach, describe, expect, it } from "vitest";
import {
  appendTurn,
  clearLedger,
  contextFor,
  dive,
  foldOldest,
  ledgerStatus,
  readLedger,
  recordExchange,
  turnOriginal,
} from "@/lib/microai/ledger";
import { recall } from "@/lib/microai/chain/archive";

/** Strips the distributor's `[label] ` prefix so a fold's sentences can be checked against the originals. */
const bare = (fold: string) =>
  fold
    .split(/\n+/)
    .flatMap((line) => line.replace(/^\[[^\]]+\]\s*/, "").split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

describe("the context ledger", () => {
  beforeEach(async () => {
    await clearLedger();
  });

  it("keeps every turn in order, with no ceiling for a long conversation to hit", async () => {
    for (let i = 1; i <= 20; i++) await appendTurn({ role: "user", label: "you", text: `turn ${i}` });
    const turns = await readLedger();
    expect(turns).toHaveLength(20);
    expect(turns.map((t) => t.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("says a fold had nothing to fold, instead of reporting a success that did not happen", async () => {
    const r = await foldOldest("anything");
    expect(r.folded).toBe(0);
    expect(r.reason).toMatch(/nothing left to fold/);
  });

  it("folds one stretch at a time and moves the fold forward", async () => {
    for (let i = 0; i < 10; i++) await appendTurn({ role: "assistant", label: "Jackie", text: `The drive is in slot ${i}.` });
    expect((await ledgerStatus()).unfolded).toBe(10);
    const r = await foldOldest("drive slot");
    expect(r.folded).toBe(8);
    const after = await ledgerStatus();
    expect(after.folds).toBe(1);
    expect(after.unfolded).toBe(2);
    expect(after.cursor).toBe(8);
  });

  it("folds extractively — a note contains no sentence nobody said", async () => {
    for (let i = 0; i < 8; i++) await appendTurn({ role: "user", label: "you", text: `Line ${i} says the fan is loud.` });
    const r = await foldOldest("fan");
    const originals = (await readLedger()).map((t) => t.text).join(" ");
    for (const sentence of bare(r.fold!.text)) expect(originals).toContain(sentence);
  });

  it("gives a step only what fits, and keeps the newest words inside it", async () => {
    for (let i = 0; i < 30; i++) await appendTurn({ role: "user", label: "you", text: `Old note ${i} about the NVMe drive.` });
    await appendTurn({ role: "assistant", label: "Jackie", text: "The newest answer mentions the SATA cable." });
    const slice = await contextFor("NVMe", 600);
    expect(slice.length).toBeLessThanOrEqual(600);
    expect(slice).toMatch(/SATA cable/);
  });

  it("dives in bounded units and reports how far it got, not that it finished", async () => {
    for (let i = 0; i < 30; i++) await appendTurn({ role: "user", label: "you", text: `Fact ${i} about the fan.` });
    const r = await dive("fan", { maxFolds: 2 });
    expect(r.folds).toBe(2);
    expect(r.turns).toBe(16);
    expect(r.caughtUp).toBe(false);
    expect(r.reason).toMatch(/14 turns still ahead/);
  });

  it("writes a finished exchange with the engine that actually answered", async () => {
    await recordExchange({ question: "Why is the fan loud?", answer: "Dust in the heatsink.", engine: "device", model: "Bonsai 1.7B" });
    const turns = await readLedger();
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[1].label).toContain("device");
    expect(turns[1].label).toContain("Bonsai 1.7B");
  });

  it("records nothing when an exchange never happened", async () => {
    await recordExchange({ question: "   ", answer: "an answer", engine: "device" });
    await recordExchange({ question: "a question", answer: "   ", engine: "device" });
    expect(await readLedger()).toHaveLength(0);
  });

  it("forgets a conversation without deleting the archived words behind it", async () => {
    const t = await appendTurn({ role: "user", label: "you", text: "The exact error was 0x0000007B." });
    await clearLedger();
    expect(await readLedger()).toHaveLength(0);
    expect(await turnOriginal(t)).toBe("The exact error was 0x0000007B.");
    expect((await recall(t.archivedId!))?.text).toBe("The exact error was 0x0000007B.");
  });
});
