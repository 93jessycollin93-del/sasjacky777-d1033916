/**
 * The real sync steps, wired to the services that do the work.
 *
 * Kept apart from `runSync` so the runner stays testable without a device: the
 * runner takes steps, these are the steps the app hands it.
 */
import { PARTITIONS } from "@/lib/partitions/registry";
import type { PartitionService } from "@/lib/partitions/service";
import type { ConstellationService } from "./service";
import type { SyncStep } from "./sync";

export function defaultSyncSteps(
  partitions: PartitionService,
  stations: ConstellationService,
): SyncStep[] {
  return [
    {
      id: "backup",
      label: "Back up every partition",
      requiresNetwork: false,
      run: async () => {
        const damaged = await partitions.damagedPartitions();
        const made = await partitions.backupAll();
        const skipped = damaged.length ? ` · skipped ${damaged.join(", ")} pending heal` : "";
        if (made.length === 0) {
          return damaged.length
            ? `nothing copied — ${damaged.join(", ")} damaged, heal runs next`
            : "nothing stored yet — no backup needed";
        }
        const records = made.reduce((sum, b) => sum + b.records, 0);
        return `${made.length} partitions, ${records} records copied${skipped}`;
      },
    },
    {
      id: "verify",
      label: "Verify and heal partitions",
      requiresNetwork: false,
      run: async () => {
        const healed: string[] = [];
        const failed: string[] = [];
        for (const spec of PARTITIONS) {
          const result = await partitions.heal(spec.id);
          if (result.corrupt.length === 0) continue;
          (result.healed ? healed : failed).push(`${spec.id} (${result.detail})`);
        }
        if (failed.length) throw new Error(`could not heal: ${failed.join("; ")}`);
        return healed.length ? `healed ${healed.join("; ")}` : "all partitions intact";
      },
    },
    {
      id: "stations",
      label: "Re-check every station",
      requiresNetwork: true,
      run: async () => {
        const snapshot = await stations.refresh();
        const { liveCount, checkableCount } = snapshot.flow;
        return `${liveCount} of ${checkableCount} checkable stations live`;
      },
    },
  ];
}
