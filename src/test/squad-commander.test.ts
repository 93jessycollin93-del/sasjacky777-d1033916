import { describe, expect, it, vi } from "vitest";
import { SquadCommander } from "@/lib/squad/commander";
import { WorldObserver } from "@/lib/squad/observer";
import type { InferenceEngine } from "@/lib/microai/contextRouter";
import { SQUADS } from "@/lib/squad/squads";

/**
 * The commander's reason for existing is that a router fielded by two units
 * carries ONE plan. A test that surveyed a single squad would never see the
 * case: Recall is in both Recon and Workshop, and two copies of its plan is two
 * chances to disagree about which engine is answering — which surfaces as one
 * unit reporting ready and the other grounded, on the same router, at the same
 * instant.
 */
const engine = (
  id: string,
  locality: InferenceEngine["locality"],
  available: () => Promise<boolean> = async () => true,
): InferenceEngine => ({
  id,
  name: id,
  locality,
  available,
  run: async (prompt) => ({ text: prompt, model: id }),
});

describe("SquadCommander", () => {
  it("plans every unit from a single look", async () => {
    const probe = vi.fn(async () => true);
    const commander = new SquadCommander([engine("micro", "device", probe)], undefined, () => 1_000);

    const survey = await commander.survey(false);

    expect(survey.squads).toHaveLength(SQUADS.length);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(survey.stats.looks).toBe(1);
  });

  it("shares one plan for a router fielded by more than one unit", async () => {
    const commander = new SquadCommander([engine("micro", "device")], undefined, () => 1_000);
    const survey = await commander.survey(false);

    const recon = survey.squads.find((s) => s.squad.id === "recon")!;
    const workshop = survey.squads.find((s) => s.squad.id === "workshop")!;
    const inRecon = recon.members.find((m) => m.routerId === "recall")!;
    const inWorkshop = workshop.members.find((m) => m.routerId === "recall")!;

    expect(inRecon.plan).toBe(inWorkshop.plan);
    expect(commander.getPlan("recall")).toBe(inRecon.plan);
  });

  it("counts a shared router's re-plan once, not once per unit", async () => {
    const commander = new SquadCommander([engine("micro", "device")], undefined, () => 1_000);
    const first = await commander.survey(false);

    // Every router derived a plan on the first pass, and each is counted once
    // even though recall and operator each sit in two units.
    const fielded = new Set(SQUADS.flatMap((s) => s.members));
    expect(first.replanned).toBe(fielded.size);

    const second = await commander.survey(false);
    expect(second.replanned).toBe(0);
  });

  it("holds every unit's route on an unchanged world", async () => {
    const probe = vi.fn(async () => true);
    const commander = new SquadCommander([engine("micro", "device", probe)], undefined, () => 1_000);

    await commander.survey(false);
    const second = await commander.survey(false);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(second.squads.every((s) => s.members.every((m) => !m.replanned))).toBe(true);
    expect(second.stats).toEqual({ looks: 1, reuses: 1 });
  });

  it("takes a fresh look when told to, even inside the window", async () => {
    const probe = vi.fn(async () => true);
    const commander = new SquadCommander([engine("micro", "device", probe)], undefined, () => 1_000);

    await commander.survey(false);
    await commander.survey(false, true);

    // The one thing worse than a stale plan is a stale plan you just pressed a
    // button to refresh.
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("grounds the units whose lead loses its engine, and only those", async () => {
    let up = true;
    let clock = 1_000;
    const engines = [engine("micro", "device", async () => up)];
    const commander = new SquadCommander(engines, new WorldObserver(engines, () => clock, 1), () => clock);

    const before = await commander.survey(false);
    expect(before.operational).toBe(SQUADS.length);

    up = false;
    clock += 10;
    const after = await commander.survey(false);

    // Offline with nothing on the device: no lead has a path anywhere.
    expect(after.operational).toBe(0);
    for (const squad of after.squads) {
      expect(squad.status, squad.squad.id).toMatch(/no path/);
    }
  });

  it("notifies subscribers on each survey and stops after unsubscribe", async () => {
    const commander = new SquadCommander([engine("micro", "device")], undefined, () => 1_000);
    const seen = vi.fn();
    const unsubscribe = commander.subscribe(seen);

    await commander.survey(false);
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    await commander.survey(false);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("has no snapshot before the first survey", () => {
    const commander = new SquadCommander([], undefined, () => 1_000);
    expect(commander.getSnapshot()).toBeNull();
    expect(commander.getPlan("recall")).toBeNull();
  });
});
