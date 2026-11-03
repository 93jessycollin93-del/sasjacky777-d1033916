import { describe, it, expect } from "vitest";
import { checkBudget } from "@/lib/microai/budget";

describe("on-device 750 MB budget", () => {
  it("accepts Bonsai at 248 MB plus SmolVLM at 250 MB", () => {
    expect(checkBudget([{ id: "bonsai", mb: 248, slot: "bonsai" }, { id: "smolvlm", mb: 250, slot: "micro" }]).ok).toBe(true);
  });
  it("refuses a Bonsai slot over 300 MB", () => {
    expect(checkBudget([{ id: "bonsai", mb: 301, slot: "bonsai" }]).ok).toBe(false);
  });
  it("refuses micro assets over 400 MB", () => {
    expect(checkBudget([{ id: "a", mb: 250, slot: "micro" }, { id: "b", mb: 151, slot: "micro" }]).ok).toBe(false);
  });
});
