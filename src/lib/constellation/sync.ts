/**
 * The sync hub.
 *
 * Online is not where the system lives — it is a place it visits to fetch what
 * it does not have and to put a copy of what it does somewhere else. So sync is
 * modelled as a list of steps, each declaring whether it needs a network, and
 * running the offline ones regardless. Pulling the plug mid-sync costs the
 * network steps and nothing else.
 *
 * The order matters and is not arbitrary: back up first, then verify, then talk
 * to the network. A sync that fetched first could overwrite good local state
 * with bad remote state and have no copy to go back to.
 */
export interface SyncStep {
  id: string;
  label: string;
  /** True when this step cannot run without a network. */
  requiresNetwork: boolean;
  run: () => Promise<string>;
}

export interface SyncStepResult {
  id: string;
  label: string;
  outcome: "done" | "skipped" | "failed";
  detail: string;
}

export interface SyncReport {
  startedAt: number;
  online: boolean;
  steps: SyncStepResult[];
  /** True when nothing failed. Skipped network steps offline are not failures. */
  ok: boolean;
}

/**
 * Runs the steps in order. Network steps are skipped — not failed — when
 * offline, because being offline is the expected case, and a red report every
 * time a person is on a train would train them to ignore it.
 */
export async function runSync(
  steps: SyncStep[],
  online: boolean,
  now: () => number = () => Date.now(),
): Promise<SyncReport> {
  const startedAt = now();
  const results: SyncStepResult[] = [];

  for (const step of steps) {
    if (step.requiresNetwork && !online) {
      results.push({
        id: step.id,
        label: step.label,
        outcome: "skipped",
        detail: "offline — will run on the next sync with a network",
      });
      continue;
    }
    try {
      results.push({ id: step.id, label: step.label, outcome: "done", detail: await step.run() });
    } catch (error) {
      results.push({
        id: step.id,
        label: step.label,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    startedAt,
    online,
    steps: results,
    ok: results.every((r) => r.outcome !== "failed"),
  };
}
