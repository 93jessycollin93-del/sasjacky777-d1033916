/**
 * The archivist: keeps every original a fetcher brought back, word for word,
 * on this device. The compressor is allowed to drop detail only because the
 * detail is still here; a step that needs it can be re-run against the full
 * text. IndexedDB, so it works with no network; a Map when IndexedDB is absent
 * (tests, private windows that refuse it), and the archive says which it used.
 */

export interface ArchiveEntry {
  id: string;
  label: string;
  kind: string;
  text: string;
  savedAt: number;
}

const DB = "jackie-chain-archive";
const STORE = "originals";
const memory = new Map<string, ArchiveEntry>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Saves an original. Returns where it went, so a failure to persist is visible. */
export async function archive(
  item: Omit<ArchiveEntry, "id" | "savedAt">,
): Promise<{ entry: ArchiveEntry; where: "device" | "memory" }> {
  const entry: ArchiveEntry = { ...item, id: newId(), savedAt: Date.now() };
  const db = await openDb();
  if (db) {
    try {
      await tx(db, "readwrite", (s) => s.put(entry));
      return { entry, where: "device" };
    } catch {
      // fall through to memory, and say so
    }
  }
  memory.set(entry.id, entry);
  return { entry, where: "memory" };
}

export async function recall(id: string): Promise<ArchiveEntry | null> {
  if (memory.has(id)) return memory.get(id)!;
  const db = await openDb();
  if (!db) return null;
  try {
    return ((await tx(db, "readonly", (s) => s.get(id))) as ArchiveEntry | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function listArchive(): Promise<ArchiveEntry[]> {
  const db = await openDb();
  let stored: ArchiveEntry[] = [];
  if (db) {
    try {
      stored = (await tx(db, "readonly", (s) => s.getAll())) as ArchiveEntry[];
    } catch {
      stored = [];
    }
  }
  return [...stored, ...memory.values()].sort((a, b) => b.savedAt - a.savedAt);
}

export async function clearArchive(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (db) await tx(db, "readwrite", (s) => s.clear()).catch(() => undefined);
}
