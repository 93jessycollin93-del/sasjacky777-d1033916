/**
 * Where the Vault's media actually lives.
 *
 * Until now it did not live anywhere. `VaultDashboard`, `LibraryScreen`,
 * `QueueScreen` and `OutputReview` all read `MOCK_MEDIA_ITEMS`, `MOCK_JOBS` and
 * `MOCK_OUTPUTS` from a fixture file — 176 lines of "Podcast Season 2" and
 * friends. There was no supabase call, no edge function, not even a
 * `localStorage` write anywhere under `src/vault/`. The screens were populated
 * and convincing and none of it existed. See `docs/FEATURE_AUDIT.md`.
 *
 * ## Why the bytes stay on the device
 *
 * The obvious move is Supabase Storage, and it is the wrong one here. This
 * project's whole posture is that the network is where updates come from and
 * never where answers come from; the Vault holds someone's own recordings,
 * camera roll and voice notes; and the validator already admits files up to
 * 500 MB. Uploading all of that by default would cost bandwidth, cost money,
 * and move private media off the machine to enable a feature — conversion —
 * that does not need it to leave at all.
 *
 * So blobs live in IndexedDB, which is local, private, offline and large enough.
 * Metadata is small and lives alongside it, so the library reads without a
 * round trip.
 *
 * ## Why IndexedDB directly and not a wrapper
 *
 * One object store per kind, get/put/delete/getAll. A wrapper would be a
 * dependency and a build-size cost to save about forty lines, and the ceremony
 * below is the whole of it.
 */
import type { ConversionJob, MediaItem, OutputAsset } from "./types";

const DB_NAME = "jackie-vault";
const DB_VERSION = 1;

const STORES = {
  media: "media",
  jobs: "jobs",
  outputs: "outputs",
  /** The bytes, keyed by media item or output id. */
  blobs: "blobs",
} as const;

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser has no IndexedDB, so the Vault cannot store anything."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("The Vault's local database refused to open."));
  });

  // A failed open must not be cached as the permanent answer: private-mode
  // browsers and evicted storage both recover, and a page reload should not be
  // the only way back.
  connection.catch(() => {
    connection = null;
  });
  return connection;
}

function run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Vault ${mode} on ${store} failed.`));
      }),
  );
}

// ── Media items ────────────────────────────────────────────────────────────

export async function listMedia(): Promise<MediaItem[]> {
  const all = await run<MediaItem[]>(STORES.media, "readonly", (s) => s.getAll());
  return all.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function getMedia(id: string): Promise<MediaItem | undefined> {
  return run<MediaItem | undefined>(STORES.media, "readonly", (s) => s.get(id));
}

export function putMedia(item: MediaItem): Promise<IDBValidKey> {
  return run(STORES.media, "readwrite", (s) => s.put({ ...item, updatedAt: new Date().toISOString() }));
}

/**
 * Removes an item, its bytes, its jobs and their outputs.
 *
 * All of it, deliberately. Deleting the row and orphaning half a gigabyte of
 * blob is how a local store silently fills a disk, and an output whose source
 * is gone is a row nothing can open.
 */
export async function deleteMedia(id: string): Promise<void> {
  const [jobs, outputs] = await Promise.all([listJobs(), listOutputs()]);
  const doomedJobs = jobs.filter((job) => job.mediaItemId === id);
  const doomedOutputs = outputs.filter(
    (output) => output.sourceMediaItemId === id || doomedJobs.some((j) => j.id === output.conversionJobId),
  );

  await Promise.all([
    run(STORES.media, "readwrite", (s) => s.delete(id)),
    deleteBlob(id),
    ...doomedJobs.map((job) => run(STORES.jobs, "readwrite", (s) => s.delete(job.id))),
    ...doomedOutputs.map((output) =>
      Promise.all([run(STORES.outputs, "readwrite", (s) => s.delete(output.id)), deleteBlob(output.id)]),
    ),
  ]);
}

// ── Jobs ───────────────────────────────────────────────────────────────────

export async function listJobs(): Promise<ConversionJob[]> {
  const all = await run<ConversionJob[]>(STORES.jobs, "readonly", (s) => s.getAll());
  return all.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function putJob(job: ConversionJob): Promise<IDBValidKey> {
  return run(STORES.jobs, "readwrite", (s) => s.put(job));
}

export function deleteJob(id: string): Promise<undefined> {
  return run(STORES.jobs, "readwrite", (s) => s.delete(id));
}

// ── Outputs ────────────────────────────────────────────────────────────────

export async function listOutputs(): Promise<OutputAsset[]> {
  const all = await run<OutputAsset[]>(STORES.outputs, "readonly", (s) => s.getAll());
  return all.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export function putOutput(output: OutputAsset): Promise<IDBValidKey> {
  return run(STORES.outputs, "readwrite", (s) => s.put(output));
}

export async function deleteOutput(id: string): Promise<void> {
  await Promise.all([run(STORES.outputs, "readwrite", (s) => s.delete(id)), deleteBlob(id)]);
}

// ── Bytes ──────────────────────────────────────────────────────────────────

export function putBlob(id: string, blob: Blob): Promise<IDBValidKey> {
  return run(STORES.blobs, "readwrite", (s) => s.put({ id, blob }));
}

export async function getBlob(id: string): Promise<Blob | null> {
  const record = await run<{ id: string; blob: Blob } | undefined>(STORES.blobs, "readonly", (s) => s.get(id));
  return record?.blob ?? null;
}

export function deleteBlob(id: string): Promise<undefined> {
  return run(STORES.blobs, "readwrite", (s) => s.delete(id));
}

/**
 * What the Vault is using, and what the browser will let it use.
 *
 * Shown rather than hidden because the cost of local storage is a real cost:
 * the person is spending their own disk, and a quota that is nearly full
 * explains a failed import far better than the failure itself will.
 */
export async function usage(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}
