import { describe, expect, it, vi } from "vitest";
import {
  assignSquad,
  findSquad,
  planAllSquads,
  planSquad,
  squadLead,
  squadReach,
  SQUADS,
  unassignedRouters,
} from "@/lib/squad/squads";
import { WorldObserver } from "@/lib/squad/observer";
import { advancePlan, type Observation, type PathPlan } from "@/lib/squad/pathPlanner";
import { findRouter, type InferenceEngine } from "@/lib/microai/contextRouter";
import { PARTITIONS } from "@/lib/partitions/registry";
import type { RouterId } from "@/lib/partitions/types";

const engine = (id: string, locality: InferenceEngine["locality"], available = true): InferenceEngine => ({
  id,
  name: id,
  locality,
  available: async () => available,
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

describe("the squad table", () => {
  it("fields every router in at least one unit", () => {
    expect(unassignedRouters()).toEqual([]);
  });

  it("names a lead that exists, and gives every unit a doctrine", () => {
    for (const squad of SQUADS) {
      expect(squad.members.length, squad.id).toBeGreaterThan(0);
      expect(squadLead(squad).id).toBe(squad.members[0]);
      expect(squad.doctrine.length, squad.id).toBeGreaterThan(20);
    }
  });

  it("reaches only partitions its members actually read", () => {
    for (const squad of SQUADS) {
      const allowed = new Set(
        squad.members.flatMap((id) => findRouter(id).reads),
      );
      for (const partition of squadReach(squad)) {
        expect(allowed.has(partition), `${squad.id} → ${partition}`).toBe(true);
      }
    }
  });

  it("gives Vault Guard exactly the vault, and nothing else", () => {
    const vaultPartitions = PARTITIONS.filter((p) => p.router === "keeper").map((p) => p.id);
    expect(squadReach(findSquad("vault-guard"))).toEqual(vaultPartitions);
  });
});

describe("assignSquad", () => {
  it("sends a model question to the Armory", () => {
    expect(assignSquad("can this device load the 7b model").id).toBe("armory");
  });

  it("sends a build request to the Workshop", () => {
    expect(assignSquad("generate an image for the pod surface").id).toBe("workshop");
  });

  it("sends anything about keys to the Vault Guard", () => {
    expect(assignSquad("rotate the api key in the vault").id).toBe("vault-guard");
  });

  it("falls back to Recon, never to the Vault Guard", () => {
    for (const vague of ["hello", "", "do the thing", "zzzz"]) {
      const squad = assignSquad(vague);
      expect(squad.id, vague).toBe("recon");
    }
  });
});

describe("planSquad", () => {
  it("plans every member from one observation", () => {
    const plan = planSquad(findSquad("recon"), ALL, observe(["micro"]));

    expect(plan.members.map((m) => m.routerId)).toEqual(["recall", "operator"]);
    expect(plan.members[0].role).toBe("lead");
    expect(plan.members[1].role).toBe("support");
    expect(plan.operational).toBe(true);
  });

  it("is not operational when the lead has no path, however healthy the support", () => {
    // Workshop leads with Maker (device→lan→network); Operator supports and is
    // device+lan only. Nothing is ready, so nobody has a path.
    const grounded = planSquad(findSquad("workshop"), ALL, observe([]));
    expect(grounded.operational).toBe(false);
    expect(grounded.status).toMatch(/lead maker has no path/);
  });

  it("stays operational on a degraded unit and names who is grounded", () => {
    // Only the cloud is up: Maker (lead) can use it, Operator and Recall
    // cannot — Operator has no network rung, Recall would accept one.
    const plan = planSquad(findSquad("workshop"), ALL, observe(["claude"], true));

    expect(plan.operational).toBe(true);
    expect(plan.grounded).toEqual(["operator"]);
    expect(plan.status).toMatch(/operational on 2\/3/);
  });

  it("holds a member's standing plan instead of re-deriving it", () => {
    const first = planSquad(findSquad("recon"), ALL, observe(["micro"], true, 1_000));
    const carried = new Map<RouterId, PathPlan>(first.members.map((m) => [m.routerId, m.plan]));

    const second = planSquad(findSquad("recon"), ALL, observe(["micro"], true, 1_200), carried);

    expect(first.replanned).toBe(2);
    expect(second.replanned).toBe(0);
    expect(second.members[0].plan).toBe(first.members[0].plan);
  });

  it("re-plans only the members a change actually affects", () => {
    // Recall (device→lan→network) and Operator (device→lan) both on the LAN.
    const first = planSquad(findSquad("recon"), ALL, observe(["ollama"], true, 1_000));
    const carried = new Map<RouterId, PathPlan>(first.members.map((m) => [m.routerId, m.plan]));

    // The cloud comes up. Neither router prefers it over the LAN, so nothing
    // should move — a plan that churned here would be re-deriving for nothing.
    const second = planSquad(findSquad("recon"), ALL, observe(["ollama", "claude"], true, 1_200), carried);

    expect(second.replanned).toBe(0);
    expect(second.members.every((m) => m.plan.engineId === "ollama")).toBe(true);
  });

  it("requires two paths for a consensus formation", () => {
    const consensus = { ...findSquad("recon"), formation: "parallel-consensus" as const };

    // Recall can use the cloud; Operator cannot. One path is not a consensus.
    expect(planSquad(consensus, ALL, observe(["claude"], true)).operational).toBe(false);
    expect(planSquad(consensus, ALL, observe(["claude"], true)).status).toMatch(/consensus needs two/);

    // Both reach the LAN.
    expect(planSquad(consensus, ALL, observe(["ollama"], true)).operational).toBe(true);
  });
});

describe("planAllSquads", () => {
  it("plans every unit against the same single observation", () => {
    const observation = observe(["micro"]);
    const plans = planAllSquads(ALL, observation);

    expect(plans).toHaveLength(SQUADS.length);
    for (const plan of plans) {
      for (const member of plan.members) {
        expect(member.plan.from).toBe(observation);
      }
    }
  });

  it("derives one plan per router, not one per router per unit", () => {
    const plans = planAllSquads(ALL, observe(["micro"]));
    const byRouter = new Map<RouterId, PathPlan[]>();

    for (const squad of plans) {
      for (const member of squad.members) {
        byRouter.set(member.routerId, [...(byRouter.get(member.routerId) ?? []), member.plan]);
      }
    }

    // Recall and Operator are each fielded by more than one unit; every unit
    // must be holding the same object, or they can drift apart later.
    const shared = [...byRouter.entries()].filter(([, held]) => held.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const [routerId, held] of shared) {
      expect(new Set(held).size, `${routerId} carries ${held.length} plans`).toBe(1);
    }

    // And the derivation happened once: the later units held it.
    const derivations = plans.flatMap((s) => s.members.filter((m) => m.replanned).map((m) => m.routerId));
    expect(new Set(derivations).size).toBe(derivations.length);
  });
});

describe("WorldObserver", () => {
  it("takes one look and serves every caller from it", async () => {
    const probe = vi.fn(async () => true);
    const engines: InferenceEngine[] = [
      { id: "micro", name: "micro", locality: "device", available: probe, run: async () => ({ text: "", model: "" }) },
    ];
    const clock = 1_000;
    const observer = new WorldObserver(engines, () => clock);

    await observer.observe(true);
    await observer.observe(true);
    await observer.observe(true);

    // Three questions, one round trip — the saving the squads are built on.
    expect(probe).toHaveBeenCalledTimes(1);
    expect(observer.getStats()).toEqual({ looks: 1, reuses: 2 });
  });

  it("looks again once the window lapses", async () => {
    const probe = vi.fn(async () => true);
    const engines: InferenceEngine[] = [
      { id: "micro", name: "micro", locality: "device", available: probe, run: async () => ({ text: "", model: "" }) },
    ];
    let clock = 1_000;
    const observer = new WorldObserver(engines, () => clock, 500);

    await observer.observe(true);
    clock += 600;
    await observer.observe(true);

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("always looks again when connectivity flips", async () => {
    const probe = vi.fn(async () => true);
    const engines: InferenceEngine[] = [
      { id: "micro", name: "micro", locality: "device", available: probe, run: async () => ({ text: "", model: "" }) },
    ];
    const observer = new WorldObserver(engines, () => 1_000);

    await observer.observe(true);
    await observer.observe(false);

    // The cached answer is least trustworthy at exactly this moment, so the
    // window does not protect it.
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("treats an engine that throws while reporting readiness as not ready", async () => {
    const engines: InferenceEngine[] = [
      {
        id: "flaky",
        name: "flaky",
        locality: "device",
        available: async () => {
          throw new Error("probe blew up");
        },
        run: async () => ({ text: "", model: "" }),
      },
    ];
    const observer = new WorldObserver(engines, () => 1_000);

    expect((await observer.observe(true)).readyEngines.size).toBe(0);
  });

  it("shares one in-flight look between concurrent callers", async () => {
    const probe = vi.fn(async () => true);
    const engines: InferenceEngine[] = [
      { id: "micro", name: "micro", locality: "device", available: probe, run: async () => ({ text: "", model: "" }) },
    ];
    const observer = new WorldObserver(engines, () => 1_000);

    const [a, b] = await Promise.all([observer.observe(true), observer.observe(true)]);

    expect(a).toBe(b);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports nothing seen before the first look", () => {
    const observer = new WorldObserver([], () => 1_000);
    expect(observer.peek()).toBeNull();
  });
});

describe("the planner and the observer together", () => {
  it("costs one look and one derivation across ten questions", async () => {
    const probe = vi.fn(async () => true);
    const engines: InferenceEngine[] = [
      { id: "micro", name: "micro", locality: "device", available: probe, run: async () => ({ text: "", model: "" }) },
    ];
    let clock = 1_000;
    const observer = new WorldObserver(engines, () => clock);
    const router = findRouter("recall");

    let plan: PathPlan | null = null;
    let derivations = 0;

    for (let i = 0; i < 10; i++) {
      clock += 100;
      const observation = await observer.observe(true);
      const advanced = advancePlan(plan, router, engines, observation);
      plan = advanced.plan;
      if (advanced.replanned) derivations += 1;
    }

    // Ten questions: one round trip to the engine, one route derived. The other
    // nine are set lookups against the standing plan's invariants.
    expect(probe).toHaveBeenCalledTimes(1);
    expect(derivations).toBe(1);
    expect(observer.getStats()).toEqual({ looks: 1, reuses: 9 });
  });

  it("re-derives exactly once when the world changes once", async () => {
    let ready = false;
    const engines: InferenceEngine[] = [
      { id: "micro", name: "micro", locality: "device", available: async () => ready, run: async () => ({ text: "", model: "" }) },
    ];
    let clock = 1_000;
    // A short window so each question takes a fresh look at a changing world.
    const observer = new WorldObserver(engines, () => clock, 1);
    const router = findRouter("recall");

    let plan: PathPlan | null = null;
    const derivations: string[] = [];

    for (let i = 0; i < 6; i++) {
      clock += 10;
      if (i === 3) ready = true;
      const advanced = advancePlan(plan, router, engines, await observer.observe(false));
      plan = advanced.plan;
      if (advanced.replanned) derivations.push(advanced.reason);
    }

    expect(derivations).toEqual(["no plan yet", "micro became available"]);
    expect(plan?.engineId).toBe("micro");
  });
});
