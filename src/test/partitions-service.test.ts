import { beforeEach, describe, expect, it } from "vitest";
import { PartitionService } from "@/lib/partitions/service";
import { MemoryPartitionStore, checksum } from "@/lib/partitions/store";
import { findPartition } from "@/lib/partitions/registry";

/**
 * These drive the real service over a real in-memory store. Nothing about
 * backups, rotation, checksums or healing is stubbed — deleting any of that
 * logic fails these tests, which is the only reason to trust them.
 *
 * The store is the sole stand-in, and it is dumb: it puts records in a Map and
 * hands them back. Corruption is induced by writing through the store directly,
 * which is exactly what a failing disk does behind the service's back.
 */
describe("PartitionService", () => {
  let store: MemoryPartitionStore;
  let clock: number;
  let service: PartitionService;

  beforeEach(() => {
    store = new MemoryPartitionStore();
    clock = 1_000;
    service = new PartitionService(store, () => clock);
  });

  it("stamps a checksum on write and returns the record on read", async () => {
    await service.put("vault", "sigil", "core identity");
    const record = await service.get("vault", "sigil");

    expect(record?.body).toBe("core identity");
    expect(record?.checksum).toBe(checksum("core identity"));
  });

  it("refuses to hand back a record whose body no longer matches its checksum", async () => {
    await service.put("vault", "sigil", "core identity");
    // Corrupt it the way a bad write would: body changed, checksum stale.
    const stored = (await store.get("vault", "sigil"))!;
    await store.put("vault", { ...stored, body: "tampered" });

    await expect(service.get("vault", "sigil")).rejects.toThrow(/checksum/);
  });

  it("keeps backups out of the record list, usage and integrity checks", async () => {
    await service.put("conversations", "thread-1", "hello");
    await service.backup("conversations");

    const records = await service.list("conversations");
    const usage = await service.usage("conversations");

    expect(records.map((r) => r.key)).toEqual(["thread-1"]);
    expect(usage.records).toBe(1);
    expect(usage.backups).toBe(1);
    expect(usage.lastBackupAt).toBe(1_000);
  });

  it("rotates backups down to the partition's declared depth", async () => {
    const depth = findPartition("pods").backupCopies;
    await service.put("pods", "seed", "a");

    for (let i = 0; i < depth + 3; i++) {
      clock += 10;
      await service.backup("pods");
    }

    const backups = await service.listBackups("pods");
    expect(backups).toHaveLength(depth);
    // The newest survive; the oldest are the ones dropped.
    expect(backups[0].stamp).toBeGreaterThan(backups[backups.length - 1].stamp);
  });

  it("does not back up an empty partition, so a real copy is never rotated out", async () => {
    await service.put("pods", "seed", "a");
    clock += 10;
    await service.backup("pods");

    await service.delete("pods", "seed");
    clock += 10;
    const empty = await service.backup("pods");

    expect(empty).toBeNull();
    expect(await service.listBackups("pods")).toHaveLength(1);
  });

  it("restores the newest backup over whatever is live now", async () => {
    await service.put("conversations", "thread-1", "first");
    clock += 10;
    await service.backup("conversations");

    await service.put("conversations", "thread-1", "second");
    await service.put("conversations", "thread-2", "extra");

    const restored = await service.restore("conversations");

    expect(restored?.records).toBe(1);
    expect((await service.get("conversations", "thread-1"))?.body).toBe("first");
    expect(await service.get("conversations", "thread-2")).toBeNull();
  });

  it("heals a corrupted partition from its backup and says so", async () => {
    await service.put("context", "index", "good");
    clock += 10;
    await service.backup("context");

    const stored = (await store.get("context", "index"))!;
    await store.put("context", { ...stored, body: "rot" });

    expect((await service.verify("context")).intact).toBe(false);

    const result = await service.heal("context");

    expect(result.corrupt).toEqual(["index"]);
    expect(result.healed).toBe(true);
    expect(result.restoredFrom).toBe(1_010);
    expect((await service.get("context", "index"))?.body).toBe("good");
  });

  it("reports a failed heal instead of claiming success when there is no backup", async () => {
    await service.put("context", "index", "good");
    const stored = (await store.get("context", "index"))!;
    await store.put("context", { ...stored, body: "rot" });

    const result = await service.heal("context");

    expect(result.healed).toBe(false);
    expect(result.restoredFrom).toBe(0);
    expect(result.detail).toMatch(/no intact backup/);
    // The damage is still there — nothing pretended to fix it.
    expect((await service.verify("context")).corrupt).toEqual(["index"]);
  });

  it("skips a backup whose own checksum fails rather than restoring damage", async () => {
    await service.put("context", "index", "good");
    clock += 10;
    await service.backup("context");

    // Damage the backup itself, then the live record.
    const backups = await store.list("context");
    const backup = backups.find((r) => r.key.startsWith("__backup__:"))!;
    await store.put("context", { ...backup, body: "[]" });
    const live = (await store.get("context", "index"))!;
    await store.put("context", { ...live, body: "rot" });

    const result = await service.heal("context");

    expect(result.healed).toBe(false);
    expect(result.detail).toMatch(/no intact backup/);
  });

  it("refuses to back up a partition holding damage, so the last good copy survives", async () => {
    await service.put("context", "index", "good");
    clock += 10;
    await service.backup("context");

    const stored = (await store.get("context", "index"))!;
    await store.put("context", { ...stored, body: "rot" });

    clock += 10;
    const attempted = await service.backup("context");

    expect(attempted).toBeNull();
    // Still exactly the one clean copy — the damage did not rotate it out, and
    // a heal is therefore still possible.
    const backups = await service.listBackups("context");
    expect(backups).toHaveLength(1);
    expect(backups[0].stamp).toBe(1_010);
    expect((await service.heal("context")).healed).toBe(true);
  });

  it("names the partitions holding damage", async () => {
    await service.put("context", "index", "good");
    await service.put("vault", "sigil", "fine");
    const stored = (await store.get("context", "index"))!;
    await store.put("context", { ...stored, body: "rot" });

    expect(await service.damagedPartitions()).toEqual(["context"]);
  });

  it("skips a backup that is intact as a file but holds damaged records", async () => {
    // A copy taken before backups refused damage: its own checksum is valid,
    // the record inside it is not. Restoring it would hand the damage back.
    await service.put("pods", "seed", "good");
    clock += 10;
    await service.backup("pods");

    const goodStamp = clock;
    const damagedRecord = { key: "seed", body: "rot", updatedAt: clock, checksum: "deadbeef" };
    const body = JSON.stringify([damagedRecord]);
    clock += 10;
    await store.put("pods", {
      key: `__backup__:${clock}`,
      body,
      updatedAt: clock,
      checksum: checksum(body),
    });

    const restored = await service.restore("pods");

    expect(restored?.stamp).toBe(goodStamp);
    expect((await service.get("pods", "seed"))?.body).toBe("good");
  });

  it("reserves the backup key prefix so a record cannot masquerade as a copy", async () => {
    await expect(service.put("vault", "__backup__:1", "sneaky")).rejects.toThrow(/reserved/);
  });

  it("backs up every partition that holds something, and only those", async () => {
    await service.put("vault", "sigil", "a");
    await service.put("pods", "seed", "b");

    const made = await service.backupAll();

    expect(made.map((b) => b.partition).sort()).toEqual(["pods", "vault"]);
  });
});
