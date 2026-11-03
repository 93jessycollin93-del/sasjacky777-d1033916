import { describe, expect, it } from "vitest";
import { planActivation, type WeightBlock } from "@/lib/microai/activation";
import { DEVICE_BUDGET_MB } from "@/lib/microai/budget";

const bonsai = (present = false, mb = 237): WeightBlock => ({
  id: "bonsai", name: "Bonsai 1.7B", slot: "bonsai", mb, present, detail: "",
});
const vision = (present = false): WeightBlock => ({
  id: "vision", name: "SmolVLM 256M", slot: "micro", mb: 250, present, detail: "",
});

describe("the on-device ceiling, enforced where a download is chosen", () => {
  it("lets the two models the system ships with through, and says what room is left", () => {
    const plan = planActivation([bonsai(), vision()]);
    expect(plan.missing.map((b) => b.id)).toEqual(["bonsai", "vision"]);
    expect(plan.refused).toHaveLength(0);
    expect(plan.usedMB).toBe(487);
    expect(plan.headroomMB).toBe(DEVICE_BUDGET_MB.total - 487);
  });

  it("refuses a block that would break the ceiling without taking the smaller ones down with it", () => {
    const router: WeightBlock = { id: "router", name: "Big router", slot: "micro", mb: 380, present: false, detail: "" };
    const plan = planActivation([vision(), router]);
    expect(plan.missing.map((b) => b.id)).toEqual(["vision"]);
    expect(plan.refused.map((b) => b.id)).toEqual(["router"]);
    expect(plan.reason).toMatch(/Micro assets 630 MB exceed 400 MB/);
  });

  it("counts what the device already holds, not only what is being asked for", () => {
    const held: WeightBlock = { id: "a", name: "Router A", slot: "micro", mb: 400, present: true, detail: "" };
    const plan = planActivation([held, vision()]);
    expect(plan.missing).toHaveLength(0);
    expect(plan.refused.map((b) => b.id)).toEqual(["vision"]);
    expect(plan.reason).toMatch(/Micro assets 650 MB exceed 400 MB/);
  });

  it("holds the language model to its own share of the ceiling", () => {
    const plan = planActivation([bonsai(false, 320), vision()]);
    expect(plan.refused.map((b) => b.id)).toEqual(["bonsai"]);
    expect(plan.missing.map((b) => b.id)).toEqual(["vision"]);
    expect(plan.reason).toMatch(/Bonsai slot 320 MB exceeds 300 MB/);
  });

  it("has nothing to plan when the device already holds everything", () => {
    const plan = planActivation([bonsai(true), vision(true)]);
    expect(plan.missing).toHaveLength(0);
    expect(plan.refused).toHaveLength(0);
    expect(plan.usedMB).toBe(487);
    expect(plan.headroomMB).toBe(DEVICE_BUDGET_MB.total - 487);
  });
});
