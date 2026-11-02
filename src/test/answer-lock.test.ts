import { describe, expect, it } from "vitest";
import {
  afterFailure, fingerprint, isLocked, normalizeAnswer, pickSlot, sameFingerprint, LOCKOUT_MS,
} from "../../supabase/functions/_shared/answerLock";

describe("answer lock", () => {
  it("matches an answer regardless of case, spacing and hidden characters", async () => {
    expect(normalizeAnswer("  Thirty\u200B  Four ")).toBe("thirty four");
    const a = await fingerprint("Thirty Four", "s", "p", 1000);
    const b = await fingerprint(" thirty   four", "s", "p", 1000);
    expect(sameFingerprint(a, b)).toBe(true);
  });

  it("never stores the answer itself, and a different pepper gives a different fingerprint", async () => {
    const a = await fingerprint("secret", "s", "p1", 1000);
    expect(a).not.toContain("secret");
    expect(a).not.toBe(await fingerprint("secret", "s", "p2", 1000));
  });

  it("locks for 15 minutes on the third wrong answer, not before", () => {
    let s = { failures: 0, locked_until: null as string | null };
    s = afterFailure(s, 0); s = afterFailure(s, 0);
    expect(isLocked(s, 0)).toBe(false);
    s = afterFailure(s, 0);
    expect(isLocked(s, LOCKOUT_MS - 1)).toBe(true);
    expect(isLocked(s, LOCKOUT_MS + 1)).toBe(false);
  });

  it("never asks the same question twice in a row when another is set", () => {
    for (let i = 0; i < 50; i++) expect(pickSlot([3, 7], 3)).toBe(7);
    expect(pickSlot([], null)).toBeNull();
  });
});
