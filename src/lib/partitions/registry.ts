/**
 * The partition table, and the pure planner that divides a device budget
 * between its entries.
 *
 * `planBudget` is deliberately free of storage, clocks and platform checks: it
 * takes a number of megabytes and returns who gets what. That makes the one
 * decision that matters offline — whether this device can actually hold the
 * system — a function you can pin to the exact numbers of a real phone in a
 * test, rather than a behaviour you can only observe by filling a disk.
 */
import type { BudgetPlan, PartitionId, PartitionPlan, PartitionSpec } from "./types";

/**
 * Declared once. Order is the planning order, so the vault and the models are
 * served before media that can be re-fetched.
 */
export const PARTITIONS: PartitionSpec[] = [
  {
    id: "vault",
    name: "Vault",
    purpose: "Identity, keys and the records that must survive a wipe of everything else.",
    weight: 1,
    floorMB: 64,
    tier: "critical",
    backupCopies: 5,
    router: "keeper",
  },
  {
    id: "models",
    name: "Model Bay",
    purpose: "Downloaded model weights. The reason inference keeps working with the radio off.",
    weight: 8,
    floorMB: 1200,
    tier: "critical",
    backupCopies: 1,
    router: "operator",
  },
  {
    id: "context",
    name: "Context Store",
    purpose: "Embeddings and retrieval indexes the micro-AI routers read to answer offline.",
    weight: 3,
    floorMB: 256,
    tier: "critical",
    backupCopies: 3,
    router: "recall",
  },
  {
    id: "conversations",
    name: "Conversations",
    purpose: "Every thread, message and attachment, written locally first.",
    weight: 2,
    floorMB: 128,
    tier: "standard",
    backupCopies: 5,
    router: "recall",
  },
  {
    id: "pods",
    name: "Pod State",
    purpose: "Pod seeds, fold surfaces and the state a pod resumes from.",
    weight: 1,
    floorMB: 64,
    tier: "standard",
    backupCopies: 3,
    router: "maker",
  },
  {
    id: "media",
    name: "Media Cache",
    purpose: "Generated images and audio. The one partition safe to evict first.",
    weight: 2,
    floorMB: 32,
    tier: "standard",
    backupCopies: 1,
    router: "maker",
  },
];

export function findPartition(id: PartitionId): PartitionSpec {
  const spec = PARTITIONS.find((p) => p.id === id);
  if (!spec) throw new Error(`unknown partition: ${id}`);
  return spec;
}

/** Sum of every floor. Below this the system cannot run fully offline. */
export const MINIMUM_BUDGET_MB = PARTITIONS.reduce((sum, p) => sum + p.floorMB, 0);

/**
 * Divides `budgetMB` across the table: critical floors first, then standard
 * floors, then whatever is left shared out by weight.
 *
 * A budget too small to cover the critical floors returns `viable: false` with
 * the partitions that came up short still named — the caller is expected to say
 * so, not to proceed with a model bay that cannot hold a model.
 */
export function planBudget(budgetMB: number): BudgetPlan {
  const budget = Number.isFinite(budgetMB) && budgetMB > 0 ? Math.floor(budgetMB) : 0;
  const granted = new Map<PartitionId, number>(PARTITIONS.map((p) => [p.id, 0]));
  let remaining = budget;

  const award = (spec: PartitionSpec, amount: number) => {
    const give = Math.max(0, Math.min(remaining, amount));
    granted.set(spec.id, (granted.get(spec.id) ?? 0) + give);
    remaining -= give;
  };

  for (const spec of PARTITIONS.filter((p) => p.tier === "critical")) award(spec, spec.floorMB);
  for (const spec of PARTITIONS.filter((p) => p.tier === "standard")) award(spec, spec.floorMB);

  if (remaining > 0) {
    const totalWeight = PARTITIONS.reduce((sum, p) => sum + p.weight, 0);
    const surplus = remaining;
    for (const spec of PARTITIONS) {
      award(spec, Math.floor((surplus * spec.weight) / totalWeight));
    }
  }

  const partitions: PartitionPlan[] = PARTITIONS.map((spec) => {
    const grantedMB = granted.get(spec.id) ?? 0;
    return { id: spec.id, grantedMB, satisfied: grantedMB >= spec.floorMB };
  });

  const viable = PARTITIONS.filter((p) => p.tier === "critical").every(
    (p) => (granted.get(p.id) ?? 0) >= p.floorMB,
  );

  return {
    budgetMB: budget,
    partitions,
    viable,
    headroomMB: Math.max(0, budget - MINIMUM_BUDGET_MB),
  };
}
