/**
 * The owner of offline state.
 *
 * Everything above this — screens, routers, the sync hub — asks the service and
 * never reaches a storage API directly. It holds the rules that make a
 * partition trustworthy without a network: a checksum on every write, rotating
 * backups per the partition's own declared depth, and a heal path that puts a
 * corrupted partition back from the newest intact copy.
 *
 * Backups live beside records under a reserved key prefix rather than in a
 * second store, so a backup can never be stranded by a device that dropped one
 * database and kept another — and `list`, usage and integrity all filter them
 * out, so a backup is never mistaken for content.
 */
import { PARTITIONS, findPartition } from "./registry";
import { checksum } from "./store";
import type {
  IntegrityReport,
  PartitionId,
  PartitionRecord,
  PartitionStore,
  PartitionUsage,
} from "./types";

/** Reserved. A record key may not start with this. */
export const BACKUP_PREFIX = "__backup__:";

export interface BackupInfo {
  partition: PartitionId;
  stamp: number;
  records: number;
}

export interface HealResult {
  partition: PartitionId;
  /** Keys found corrupt before healing. */
  corrupt: string[];
  /** Stamp of the backup restored from, or 0 when nothing was restored. */
  restoredFrom: number;
  /** True when the partition verified clean after the attempt. */
  healed: boolean;
  detail: string;
}

const bytesOf = (record: PartitionRecord) => record.key.length + record.body.length;

export class PartitionService {
  constructor(
    private readonly store: PartitionStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get backendName() {
    return this.store.name;
  }

  /** Writes a record and stamps it with its checksum. */
  async put(partition: PartitionId, key: string, body: string): Promise<PartitionRecord> {
    if (key.startsWith(BACKUP_PREFIX)) {
      throw new Error(`"${BACKUP_PREFIX}" is reserved for backups`);
    }
    const record: PartitionRecord = {
      key,
      body,
      updatedAt: this.now(),
      checksum: checksum(body),
    };
    await this.store.put(partition, record);
    return record;
  }

  /**
   * Reads a record, refusing one whose body no longer matches its checksum.
   * Returning damaged content would let corruption travel into an answer; the
   * caller is meant to heal and retry.
   */
  async get(partition: PartitionId, key: string): Promise<PartitionRecord | null> {
    const record = await this.store.get(partition, key);
    if (!record) return null;
    if (checksum(record.body) !== record.checksum) {
      throw new Error(`${partition}/${key} failed its checksum`);
    }
    return record;
  }

  async delete(partition: PartitionId, key: string): Promise<void> {
    await this.store.delete(partition, key);
  }

  /** Live records only — never the backups stored alongside them. */
  async list(partition: PartitionId): Promise<PartitionRecord[]> {
    const all = await this.store.list(partition);
    return all.filter((r) => !r.key.startsWith(BACKUP_PREFIX));
  }

  private async backups(partition: PartitionId): Promise<PartitionRecord[]> {
    const all = await this.store.list(partition);
    return all
      .filter((r) => r.key.startsWith(BACKUP_PREFIX))
      .sort((a, b) => stampOf(b.key) - stampOf(a.key));
  }

  /**
   * Snapshots every live record into one backup, then drops the oldest copies
   * beyond the partition's declared depth. A partition with nothing in it is
   * not backed up — an empty snapshot would rotate a real one out.
   *
   * A partition with damage in it is not backed up either, and that is the
   * important one. Copying a corrupted record produces a backup that is itself
   * perfectly valid — its own checksum covers the damaged body — so the next
   * restore would faithfully put the damage back, and the rotation would push
   * the last good copy out to make room for it. Refusing here is what keeps a
   * heal possible: the newest surviving backup stays a clean one.
   */
  async backup(partition: PartitionId): Promise<BackupInfo | null> {
    const records = await this.list(partition);
    if (records.length === 0) return null;
    if (records.some((r) => checksum(r.body) !== r.checksum)) return null;

    const stamp = this.now();
    const body = JSON.stringify(records);
    await this.store.put(partition, {
      key: `${BACKUP_PREFIX}${stamp}`,
      body,
      updatedAt: stamp,
      checksum: checksum(body),
    });

    const depth = findPartition(partition).backupCopies;
    const kept = await this.backups(partition);
    for (const stale of kept.slice(depth)) await this.store.delete(partition, stale.key);

    return { partition, stamp, records: records.length };
  }

  async listBackups(partition: PartitionId): Promise<BackupInfo[]> {
    const rows = await this.backups(partition);
    return rows.map((r) => ({
      partition,
      stamp: stampOf(r.key),
      records: safeParse(r.body).length,
    }));
  }

  /**
   * Replaces live records from a backup — the newest by default. Backups whose
   * own checksum fails are skipped rather than restored, so a bad copy cannot
   * overwrite content that is merely suspect.
   */
  async restore(partition: PartitionId, stamp?: number): Promise<BackupInfo | null> {
    const candidates = await this.backups(partition);
    const chosen = stamp
      ? candidates.filter((r) => stampOf(r.key) === stamp)
      : candidates;

    for (const backup of chosen) {
      if (checksum(backup.body) !== backup.checksum) continue;
      const records = safeParse(backup.body);
      if (records.length === 0) continue;
      // A backup can be intact as a file and still hold damaged records, if it
      // was taken before that check existed. Restoring it would hand the
      // damage back, so the copy is skipped and an older one is tried.
      if (records.some((r) => checksum(r.body) !== r.checksum)) continue;

      for (const live of await this.list(partition)) {
        await this.store.delete(partition, live.key);
      }
      for (const record of records) await this.store.put(partition, record);
      return { partition, stamp: stampOf(backup.key), records: records.length };
    }
    return null;
  }

  /** Re-hashes every live record and names the ones that no longer match. */
  async verify(partition: PartitionId): Promise<IntegrityReport> {
    const records = await this.list(partition);
    const corrupt = records.filter((r) => checksum(r.body) !== r.checksum).map((r) => r.key);
    return { id: partition, checked: records.length, corrupt, intact: corrupt.length === 0 };
  }

  /**
   * Verify, and if anything is damaged, restore from the newest intact backup
   * and verify again. The result says what was wrong and whether it is now
   * right — a heal that could not fix it reports `healed: false` rather than
   * reporting success and leaving the damage in place.
   */
  async heal(partition: PartitionId): Promise<HealResult> {
    const before = await this.verify(partition);
    if (before.intact) {
      return {
        partition,
        corrupt: [],
        restoredFrom: 0,
        healed: true,
        detail: `${before.checked} records intact`,
      };
    }

    const restored = await this.restore(partition);
    if (!restored) {
      return {
        partition,
        corrupt: before.corrupt,
        restoredFrom: 0,
        healed: false,
        detail: `${before.corrupt.length} damaged, no intact backup to restore from`,
      };
    }

    const after = await this.verify(partition);
    return {
      partition,
      corrupt: before.corrupt,
      restoredFrom: restored.stamp,
      healed: after.intact,
      detail: after.intact
        ? `restored ${restored.records} records from backup ${restored.stamp}`
        : `restored from backup ${restored.stamp}, still ${after.corrupt.length} damaged`,
    };
  }

  async usage(partition: PartitionId): Promise<PartitionUsage> {
    const records = await this.list(partition);
    const backups = await this.backups(partition);
    return {
      id: partition,
      records: records.length,
      bytes: records.reduce((sum, r) => sum + bytesOf(r), 0),
      backups: backups.length,
      lastBackupAt: backups.length ? stampOf(backups[0].key) : 0,
    };
  }

  async usageAll(): Promise<PartitionUsage[]> {
    return Promise.all(PARTITIONS.map((p) => this.usage(p.id)));
  }

  /**
   * Backs up every partition that has content and is intact. Used before a sync
   * pulls anything in, so a bad fetch always has somewhere to fall back to.
   */
  async backupAll(): Promise<BackupInfo[]> {
    const results: BackupInfo[] = [];
    for (const spec of PARTITIONS) {
      const info = await this.backup(spec.id);
      if (info) results.push(info);
    }
    return results;
  }

  /**
   * Partitions holding damaged records right now. `backupAll` skips these, so
   * the sync step can say which were passed over instead of reporting a clean
   * run that quietly copied less than it claimed.
   */
  async damagedPartitions(): Promise<PartitionId[]> {
    const damaged: PartitionId[] = [];
    for (const spec of PARTITIONS) {
      if (!(await this.verify(spec.id)).intact) damaged.push(spec.id);
    }
    return damaged;
  }
}

function stampOf(key: string): number {
  return Number(key.slice(BACKUP_PREFIX.length)) || 0;
}

function safeParse(body: string): PartitionRecord[] {
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as PartitionRecord[]) : [];
  } catch {
    return [];
  }
}
