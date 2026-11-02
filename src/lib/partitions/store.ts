/**
 * Storage backends for partitions.
 *
 * These are the only files in the layer that touch a device API, and they are
 * kept deliberately stupid: put a record, hand it back, list what is there. The
 * moment one of them starts making a decision, the decision stops being
 * testable, because it can only be exercised by the platform that implements
 * it. IndexedDB in a browser, memory everywhere else, one interface over both.
 */
import type { PartitionId, PartitionRecord, PartitionStore } from "./types";

/**
 * FNV-1a, 32-bit. Not a security hash — a cheap, deterministic fingerprint that
 * tells us a record came back the way it went in, and runs identically in a
 * browser, in Node and in a test without pulling in crypto.
 */
export function checksum(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export class MemoryPartitionStore implements PartitionStore {
  readonly name = "memory";
  private data = new Map<PartitionId, Map<string, PartitionRecord>>();

  private bucket(partition: PartitionId) {
    let bucket = this.data.get(partition);
    if (!bucket) {
      bucket = new Map();
      this.data.set(partition, bucket);
    }
    return bucket;
  }

  async get(partition: PartitionId, key: string) {
    return this.bucket(partition).get(key) ?? null;
  }

  async put(partition: PartitionId, record: PartitionRecord) {
    this.bucket(partition).set(record.key, { ...record });
  }

  async delete(partition: PartitionId, key: string) {
    this.bucket(partition).delete(key);
  }

  async list(partition: PartitionId) {
    return [...this.bucket(partition).values()].map((r) => ({ ...r }));
  }

  async clear(partition: PartitionId) {
    this.bucket(partition).clear();
  }
}

const DB_NAME = "jackie-partitions";
const DB_VERSION = 1;
const OBJECT_STORE = "records";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb request failed"));
  });
}

/**
 * IndexedDB backend. One object store keyed `<partition>::<key>`, with a
 * `partition` index so listing one partition never walks the others — which
 * matters once the model bay holds gigabytes.
 */
export class IndexedDbPartitionStore implements PartitionStore {
  readonly name = "indexeddb";
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(OBJECT_STORE)) {
            const store = db.createObjectStore(OBJECT_STORE, { keyPath: "id" });
            store.createIndex("partition", "partition", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexeddb open failed"));
      });
    }
    return this.db;
  }

  private async tx(mode: IDBTransactionMode) {
    const db = await this.open();
    return db.transaction(OBJECT_STORE, mode).objectStore(OBJECT_STORE);
  }

  async get(partition: PartitionId, key: string) {
    const store = await this.tx("readonly");
    const row = await request<{ record: PartitionRecord } | undefined>(
      store.get(`${partition}::${key}`),
    );
    return row?.record ?? null;
  }

  async put(partition: PartitionId, record: PartitionRecord) {
    const store = await this.tx("readwrite");
    await request(store.put({ id: `${partition}::${record.key}`, partition, record }));
  }

  async delete(partition: PartitionId, key: string) {
    const store = await this.tx("readwrite");
    await request(store.delete(`${partition}::${key}`));
  }

  async list(partition: PartitionId) {
    const store = await this.tx("readonly");
    const rows = await request<Array<{ record: PartitionRecord }>>(
      store.index("partition").getAll(partition),
    );
    return rows.map((r) => r.record);
  }

  async clear(partition: PartitionId) {
    const store = await this.tx("readwrite");
    const keys = await request<IDBValidKey[]>(store.index("partition").getAllKeys(partition));
    for (const key of keys) await request(store.delete(key));
  }
}

/**
 * The one place that asks what platform this is. Callers take a
 * `PartitionStore` and never find out which one they got — that is what keeps a
 * missing IndexedDB (private windows, some embedded webviews) from becoming an
 * `if` in a screen.
 */
export function createPartitionStore(): PartitionStore {
  try {
    if (typeof indexedDB !== "undefined") return new IndexedDbPartitionStore();
  } catch {
    /* fall through to memory */
  }
  return new MemoryPartitionStore();
}
