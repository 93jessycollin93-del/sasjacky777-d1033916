import { describe, expect, it } from "vitest";
import {
  MINIMUM_BUDGET_MB,
  PARTITIONS,
  findPartition,
  planBudget,
} from "@/lib/partitions/registry";

/**
 * The planner decides whether a device can hold the system offline at all.
 *
 * The case that matters is the one a happy-path test never reaches: a phone
 * that grants less than the critical floors. If the planner quietly hands back
 * a Model Bay of 200 MB, everything downstream reports green and the first
 * model download fails with no explanation. So the assertions here are about
 * the grants themselves and the viability verdict — not that a planner ran.
 */
describe("planBudget", () => {
  it("meets every floor and shares the surplus by weight on a roomy device", () => {
    const plan = planBudget(8000);

    expect(plan.viable).toBe(true);
    expect(plan.partitions.every((p) => p.satisfied)).toBe(true);
    expect(plan.headroomMB).toBe(8000 - MINIMUM_BUDGET_MB);

    const models = plan.partitions.find((p) => p.id === "models")!;
    const pods = plan.partitions.find((p) => p.id === "pods")!;
    // models carries weight 8 against pods' 1, so its surplus share is larger
    // by that ratio once both floors are covered.
    expect(models.grantedMB - findPartition("models").floorMB).toBeGreaterThan(
      (pods.grantedMB - findPartition("pods").floorMB) * 5,
    );
  });

  it("refuses to call a device viable when a critical floor cannot be met", () => {
    const criticalFloor = PARTITIONS.filter((p) => p.tier === "critical").reduce(
      (sum, p) => sum + p.floorMB,
      0,
    );
    const plan = planBudget(criticalFloor - 1);

    expect(plan.viable).toBe(false);
    expect(plan.partitions.some((p) => !p.satisfied)).toBe(true);
    expect(plan.headroomMB).toBe(0);
  });

  it("serves critical partitions before standard ones when the budget is tight", () => {
    const criticalFloor = PARTITIONS.filter((p) => p.tier === "critical").reduce(
      (sum, p) => sum + p.floorMB,
      0,
    );
    const plan = planBudget(criticalFloor);

    expect(plan.viable).toBe(true);
    for (const spec of PARTITIONS.filter((p) => p.tier === "critical")) {
      expect(plan.partitions.find((p) => p.id === spec.id)!.satisfied).toBe(true);
    }
    // Everything was spent on the critical floors, so a standard partition got
    // nothing — the honest outcome, rather than shaving the vault to spread it.
    expect(plan.partitions.find((p) => p.id === "media")!.grantedMB).toBe(0);
  });

  it("treats a missing or nonsense quota as no budget rather than infinite room", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      const plan = planBudget(bad);
      expect(plan.budgetMB).toBe(0);
      expect(plan.viable).toBe(false);
      expect(plan.partitions.every((p) => p.grantedMB === 0)).toBe(true);
    }
  });

  it("never grants a partition more than the budget", () => {
    const plan = planBudget(100);
    const total = plan.partitions.reduce((sum, p) => sum + p.grantedMB, 0);
    expect(total).toBeLessThanOrEqual(100);
  });
});
