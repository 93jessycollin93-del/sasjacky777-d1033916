import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSULT_ENGINES, DEFAULT_CONSULT_ENGINE, findConsultEngine,
  readConsultEngine, writeConsultEngine,
} from "@/lib/repair/consultEngine";

/**
 * Which engine the Repair Consultant asks.
 *
 * The consultant only ever asked the Lovable gateway, which knows nothing about
 * the rig beyond what the prompt carries. Choosing the operator's own engine is
 * the difference between an answer you can check against a source and one you
 * take on trust, so the choice has to survive the reload — someone who
 * connected their own engine did not do it to be quietly put back on the
 * gateway.
 */
describe("choosing the consultant's engine", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the operator's own engine, not the gateway", () => {
    expect(readConsultEngine()).toBe(DEFAULT_CONSULT_ENGINE);
    expect(DEFAULT_CONSULT_ENGINE).toBe("gemini");
  });

  it("remembers the choice across a reload", () => {
    writeConsultEngine("gateway");
    expect(readConsultEngine()).toBe("gateway");
  });

  it("ignores a stored value that is not an engine any more", () => {
    localStorage.setItem("jacky.repair.consultEngine.v1", "some-engine-we-removed");
    expect(readConsultEngine()).toBe(DEFAULT_CONSULT_ENGINE);
  });

  it("falls back to the default rather than throwing when storage is blocked", () => {
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    try {
      expect(readConsultEngine()).toBe(DEFAULT_CONSULT_ENGINE);
    } finally {
      blocked.mockRestore();
    }
  });

  it("keeps the choice for this session when the write is refused", () => {
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    try {
      expect(() => writeConsultEngine("gateway")).not.toThrow();
    } finally {
      full.mockRestore();
    }
  });

  it("says which engine can cite, because that is the whole reason to pick one", () => {
    expect(findConsultEngine("gemini").cites).toBe(true);
    expect(findConsultEngine("gateway").cites).toBe(false);
  });

  it("resolves an unknown id to a real engine rather than undefined", () => {
    expect(findConsultEngine("nope").id).toBe(CONSULT_ENGINES[0].id);
  });
});
