import { describe, expect, it } from "vitest";
import { runSync, type SyncStep } from "@/lib/constellation/sync";
import { defaultSyncSteps } from "@/lib/constellation/steps";
import { PartitionService } from "@/lib/partitions/service";
import { MemoryPartitionStore } from "@/lib/partitions/store";
import { ConstellationService } from "@/lib/constellation/service";
import { buildStations } from "@/lib/constellation/stations";

/**
 * Sync is the one place the network is allowed to matter, and the rule is that
 * losing it costs the network steps and nothing else. Both branches are pinned
 * here — offline skips rather than fails, and a genuine failure is still a
 * failure — because a runner that failed the whole sync offline would make the
 * offline-first claim false in the exact situation it is for.
 */
const step = (id: string, requiresNetwork: boolean, run: () => Promise<string>): SyncStep => ({
  id,
  label: id,
  requiresNetwork,
  run,
});

describe("runSync", () => {
  it("runs the local steps and skips the network ones when offline", async () => {
    const ran: string[] = [];
    const report = await runSync(
      [
        step("backup", false, async () => {
          ran.push("backup");
          return "copied";
        }),
        step("pull", true, async () => {
          ran.push("pull");
          return "fetched";
        }),
      ],
      false,
    );

    expect(ran).toEqual(["backup"]);
    expect(report.ok).toBe(true);
    expect(report.steps.map((s) => s.outcome)).toEqual(["done", "skipped"]);
    expect(report.steps[1].detail).toMatch(/offline/);
  });

  it("runs everything when online", async () => {
    const report = await runSync(
      [step("backup", false, async () => "copied"), step("pull", true, async () => "fetched")],
      true,
    );

    expect(report.steps.map((s) => s.outcome)).toEqual(["done", "done"]);
    expect(report.ok).toBe(true);
  });

  it("records a failing step as failed and keeps going", async () => {
    const report = await runSync(
      [
        step("verify", false, async () => {
          throw new Error("could not heal: context");
        }),
        step("after", false, async () => "still ran"),
      ],
      true,
    );

    expect(report.ok).toBe(false);
    expect(report.steps[0]).toMatchObject({ outcome: "failed", detail: "could not heal: context" });
    expect(report.steps[1].outcome).toBe("done");
  });
});

describe("the default sync steps", () => {
  it("backs up and verifies real partitions before it touches the network", async () => {
    const store = new MemoryPartitionStore();
    const partitions = new PartitionService(store, () => 5_000);
    const stations = new ConstellationService(
      buildStations({
        fetch: async () => new Response("", { status: 200 }),
        jackyStatus: async () => "engine ok",
        storageBudgetMB: async () => 100_000,
        shellWorker: async () => "shell worker controlling · 1283 files held locally",
      }),
      () => false,
    );

    await partitions.put("vault", "sigil", "core identity");

    const steps = defaultSyncSteps(partitions, stations);
    expect(steps.map((s) => s.id)).toEqual(["backup", "verify", "stations"]);

    const report = await runSync(steps, false);

    expect(report.ok).toBe(true);
    expect(report.steps[0].detail).toMatch(/1 partitions, 1 records copied/);
    expect(report.steps[1].detail).toBe("all partitions intact");
    expect(report.steps[2].outcome).toBe("skipped");
    // The backup is real: it is on disk and restorable with no network.
    expect(await partitions.listBackups("vault")).toHaveLength(1);
  });

  it("heals damage found during a sync and reports what it fixed", async () => {
    const store = new MemoryPartitionStore();
    let clock = 5_000;
    const partitions = new PartitionService(store, () => clock);
    const stations = new ConstellationService([], () => false);

    await partitions.put("context", "index", "good");
    clock += 10;
    await partitions.backup("context");

    const stored = (await store.get("context", "index"))!;
    await store.put("context", { ...stored, body: "rot" });

    const report = await runSync(defaultSyncSteps(partitions, stations), false);

    expect(report.ok).toBe(true);
    expect(report.steps[1].detail).toMatch(/healed context/);
    expect((await partitions.get("context", "index"))?.body).toBe("good");
  });
});
