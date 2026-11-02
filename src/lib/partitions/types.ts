/**
 * Offline partitions — the ground the system stands on when there is no network.
 *
 * The rule this layer exists to enforce: offline is the whole product, and
 * online is only a sync-and-download hub. That inverts the usual arrangement,
 * where local storage is a cache that may be evicted and the server holds the
 * truth. Here each partition owns one purpose, reserves its own share of the
 * device budget up front, and keeps its own rotating backups, so losing the
 * network costs nothing and losing a partition costs one restore.
 *
 * A partition is declared once in `PARTITIONS`. Everything else — quota
 * planning, backup rotation, integrity, the micro-AI router that reads it — is
 * derived from that declaration, so a new partition is one entry and no caller
 * changes.
 */

export type PartitionId =
  | "models"
  | "vault"
  | "conversations"
  | "context"
  | "pods"
  | "media";

/** Which specialised micro-AI context router reads a partition. */
export type RouterId = "recall" | "keeper" | "operator" | "maker";

export interface PartitionSpec {
  id: PartitionId;
  name: string;
  /** The one job this partition holds bytes for. */
  purpose: string;
  /**
   * Share of the offline budget claimed by this partition, as a weight. Weights
   * are relative: a partition with weight 4 gets twice the room of weight 2.
   */
  weight: number;
  /** Floor in MB. A partition below its floor cannot do its job at all. */
  floorMB: number;
  /**
   * `critical` partitions are planned first and are never squeezed below their
   * floor — the system reports the budget as insufficient instead of silently
   * handing back a partition too small to work.
   */
  tier: "critical" | "standard";
  /** Rotating backup copies kept for this partition. */
  backupCopies: number;
  /** The specialised router that reads this partition for context. */
  router: RouterId;
}

/** One stored item. `body` is already-serialised content. */
export interface PartitionRecord {
  key: string;
  body: string;
  /** Epoch ms of the last write. */
  updatedAt: number;
  /** FNV-1a of `body`, written at put time and re-checked on verify. */
  checksum: string;
}

/**
 * The storage boundary, and the only part of this layer that touches a device
 * API. Implementations are dumb: they put bytes where they are told and hand
 * them back. Quota, backups, rotation and integrity are the service's job, and
 * run for real against any implementation — which is what lets the tests drive
 * the real service over an in-memory store rather than asserting that a mock
 * was called.
 */
export interface PartitionStore {
  readonly name: string;
  get(partition: PartitionId, key: string): Promise<PartitionRecord | null>;
  put(partition: PartitionId, record: PartitionRecord): Promise<void>;
  delete(partition: PartitionId, key: string): Promise<void>;
  list(partition: PartitionId): Promise<PartitionRecord[]>;
  clear(partition: PartitionId): Promise<void>;
}

export interface PartitionPlan {
  id: PartitionId;
  /** MB granted by the plan. */
  grantedMB: number;
  /** True when the grant is at or above the partition's floor. */
  satisfied: boolean;
}

export interface BudgetPlan {
  budgetMB: number;
  partitions: PartitionPlan[];
  /**
   * True only when every critical partition is at or above its floor. False is
   * the signal to stop and tell the person, not to carry on with a vault that
   * cannot hold anything.
   */
  viable: boolean;
  /** MB left after every floor is met. 0 when the budget is exactly spent. */
  headroomMB: number;
}

export interface PartitionUsage {
  id: PartitionId;
  records: number;
  bytes: number;
  backups: number;
  /** Epoch ms of the newest backup, 0 when there is none. */
  lastBackupAt: number;
}

export interface IntegrityReport {
  id: PartitionId;
  checked: number;
  /** Keys whose stored checksum no longer matches their body. */
  corrupt: string[];
  intact: boolean;
}
