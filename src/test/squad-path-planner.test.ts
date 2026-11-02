import { describe, expect, it } from "vitest";
import {
  advancePlan,
  checkPlan,
  planPath,
  PLAN_TTL_MS,
  type Observation,
} from "@/lib/squad/pathPlanner";
import { findRouter, type InferenceEngine } from "@/lib/microai/contextRouter";

/**
 * The planner's value is entirely in when it refuses to reuse a plan. A test
 * that only checks the happy reuse would pass against an implementation that
 * never re-planned at all — which is exactly the bug worth fearing here, since
 * a stale plan routes work to an engine that is gone and looks fast doing it.
 *
 * So every case below drives a real plan through a changed world and asserts
 * the verdict and the reason, not that a checker ran.
 */
const engine = (id: string, locality: InferenceEngine["locality"]): InferenceEngine => ({
  id,
  name: id,
  locality,
  available: async () => true,
  run: async (prompt) => ({ text: prompt, model: id }),
});

const DEVICE = engine("micro", "device");
const LAN = engine("ollama", "lan");
const CLOUD = engine("claude", "network");
const ALL = [DEVICE, LAN, CLOUD];

const observe = (ready: string[], online = true, at = 1_000): Observation => ({
  online,
  readyEngines: new Set(ready),
  at,
});

describe("planPath", () => {
  it("picks the nearest engine and watches it", () => {
    const plan = planPath(findRouter("recall"), ALL, observe(["micro", "ollama"]));

    expect(plan.engineId).toBe("micro");
    expect(plan.invariants).toContainEqual({ kind: "engine-ready", engineId: "micro" });
  });

  it("watches the engines it would have preferred, so a shorter path is noticed", () => {
    const plan = planPath(findRouter("recall"), ALL, observe(["ollama"]));

    expect(plan.engineId).toBe("ollama");
    expect(plan.invariants).toContainEqual({ kind: "no-better-engine", engineIds: ["micro"] });
  });

  it("does not watch for a better engine when it already has the best one", () => {
    const plan = planPath(findRouter("recall"), ALL, observe(["micro", "ollama", "claude"]));
    expect(plan.invariants.some((i) => i.kind === "no-better-engine")).toBe(false);
  });

  it("watches every acceptable engine for appearing when nothing is usable", () => {
    const plan = planPath(findRouter("keeper"), ALL, observe([]));

    expect(plan.engineId).toBeNull();
    // Keeper accepts device only, so the cloud engine is not watched — it could
    // never make this plan wrong.
    expect(plan.invariants).toContainEqual({ kind: "engine-absent", engineId: "micro" });
    expect(plan.invariants.some((i) => i.kind === "engine-absent" && i.engineId === "claude")).toBe(false);
  });

  it("expires on its own even if nothing observable changed", () => {
    const plan = planPath(findRouter("recall"), ALL, observe(["micro"], true, 1_000));
    expect(plan.expiresAt).toBe(1_000 + PLAN_TTL_MS);
  });
});

describe("checkPlan", () => {
  const plan = planPath(findRouter("recall"), ALL, observe(["ollama"], true, 1_000));

  it("holds while the world matches", () => {
    const check = checkPlan(plan, observe(["ollama"], true, 1_500));
    expect(check.valid).toBe(true);
  });

  it("breaks when the chosen engine stops answering", () => {
    const check = checkPlan(plan, observe([], true, 1_500));
    expect(check).toEqual({ valid: false, reason: "ollama stopped answering" });
  });

  it("breaks when a shorter path opens", () => {
    const check = checkPlan(plan, observe(["ollama", "micro"], true, 1_500));
    expect(check).toEqual({ valid: false, reason: "micro came up and is a shorter path" });
  });

  it("breaks when connectivity flips", () => {
    const check = checkPlan(plan, observe(["ollama"], false, 1_500));
    expect(check).toEqual({ valid: false, reason: "network went down" });
  });

  it("breaks on expiry even when every invariant still holds", () => {
    const check = checkPlan(plan, observe(["ollama"], true, 1_000 + PLAN_TTL_MS));
    expect(check).toEqual({ valid: false, reason: "plan expired" });
  });

  it("breaks a no-engine plan the moment something becomes usable", () => {
    const grounded = planPath(findRouter("keeper"), ALL, observe([], false, 1_000));
    expect(grounded.engineId).toBeNull();

    expect(checkPlan(grounded, observe([], false, 1_200)).valid).toBe(true);
    expect(checkPlan(grounded, observe(["micro"], false, 1_200))).toEqual({
      valid: false,
      reason: "micro became available",
    });
  });
});

describe("advancePlan", () => {
  it("reuses the standing plan and reports it held", () => {
    const first = advancePlan(null, findRouter("recall"), ALL, observe(["micro"], true, 1_000));
    const second = advancePlan(first.plan, findRouter("recall"), ALL, observe(["micro"], true, 1_200));

    expect(first.replanned).toBe(true);
    expect(second.replanned).toBe(false);
    // The same object, not an equal one — nothing was re-derived.
    expect(second.plan).toBe(first.plan);
  });

  it("re-derives and upgrades when a shorter path opens", () => {
    const first = advancePlan(null, findRouter("recall"), ALL, observe(["ollama"], true, 1_000));
    expect(first.plan.engineId).toBe("ollama");

    const second = advancePlan(first.plan, findRouter("recall"), ALL, observe(["ollama", "micro"], true, 1_200));

    expect(second.replanned).toBe(true);
    expect(second.reason).toMatch(/shorter path/);
    expect(second.plan.engineId).toBe("micro");
  });

  it("re-derives rather than reusing another router's plan", () => {
    const recall = advancePlan(null, findRouter("recall"), ALL, observe(["micro"], true, 1_000));
    const keeper = advancePlan(recall.plan, findRouter("keeper"), ALL, observe(["micro"], true, 1_100));

    expect(keeper.replanned).toBe(true);
    expect(keeper.reason).toBe("different router");
    expect(keeper.plan.routerId).toBe("keeper");
  });

  it("drops to no engine when the one it was holding disappears", () => {
    const first = advancePlan(null, findRouter("keeper"), ALL, observe(["micro"], false, 1_000));
    expect(first.plan.engineId).toBe("micro");

    const second = advancePlan(first.plan, findRouter("keeper"), ALL, observe([], false, 1_200));

    expect(second.replanned).toBe(true);
    expect(second.plan.engineId).toBeNull();
  });
});
