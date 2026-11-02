/**
 * Where the world map's tiles are kept: a database of their own, beside the
 * saves rather than in them. Adding a store to the save database would mean
 * raising its version, and a second tab still open on the old version blocks
 * that upgrade — which the save code (rightly) treats as a failure and falls
 * back to memory. A map is not worth risking a world's saves for, so it gets
 * its own database, at version 1, that nothing else ever needs to upgrade.
 *
 * Without IndexedDB it keeps the tiles in memory: the map works for the
 * session and is gone after, which is the most that can be done.
 */
const DB_NAME = "blockcraft-maps";

interface StoredRegion {
  key: string;
  world: string;
  region: string;
  data: Uint8Array;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

export class MapStore {
  private db: Promise<IDBDatabase | null> | null = null;
  private memory = new Map<string, StoredRegion>();

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("regions")) req.result.createObjectStore("regions", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      // A map that cannot be stored is a map for this session only, not an error to stop the game for.
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this.db;
  }

  private range(world: string): IDBKeyRange {
    return IDBKeyRange.bound(`${world}|`, `${world}|￿`);
  }

  /** Every saved region of a world, as [region key, RGBA]. */
  async load(world: string): Promise<[string, Uint8ClampedArray][]> {
    const db = await this.open();
    let rows: StoredRegion[];
    if (!db) rows = [...this.memory.values()].filter((r) => r.world === world);
    else {
      try {
        rows = await request(db.transaction("regions", "readonly").objectStore("regions").getAll(this.range(world)) as IDBRequest<StoredRegion[]>);
      } catch {
        return [];
      }
    }
    return rows.map((r) => [r.region, new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength)]);
  }

  async save(world: string, regions: [string, Uint8ClampedArray][]): Promise<void> {
    if (!regions.length) return;
    const rows = regions.map(([region, px]): StoredRegion => ({ key: `${world}|${region}`, world, region, data: new Uint8Array(px.buffer, px.byteOffset, px.byteLength) }));
    const db = await this.open();
    if (!db) { for (const r of rows) this.memory.set(r.key, r); return; }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("regions", "readwrite");
      const os = tx.objectStore("regions");
      for (const r of rows) os.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("could not save the map"));
      tx.onabort = () => reject(tx.error ?? new Error("could not save the map (storage full?)"));
    });
  }

  async deleteWorld(world: string): Promise<void> {
    for (const k of [...this.memory.keys()]) if (k.startsWith(`${world}|`)) this.memory.delete(k);
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction("regions", "readwrite");
      tx.objectStore("regions").delete(this.range(world));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  }
}
