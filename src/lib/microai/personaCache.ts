/**
 * Jackie's profile, kept on this device so the on-device engine can answer
 * with the radio off.
 *
 * Every on-device turn used to fetch the persona from `jackie-device` first.
 * That is the right shape online — the persona never ships in the bundle, and
 * one request carrying memory context and none of the conversation is what
 * keeps it the owner's — but it made "offline" a lie: the weights were on the
 * device, the runtime was cached, and the turn still died on a request that
 * could not leave the machine. The failure read as a broken profile service,
 * which is what the person would have gone looking for.
 *
 * So the last profile that arrived successfully is saved here, and used only
 * when the network itself is the thing that failed. Two lines keep it honest:
 * it is stored under the owner's own account id and is only ever served back to
 * that same signed-in account, and it expires — a profile older than the bound
 * may predate a morals change, and an answer from it would be Jackie wearing
 * yesterday's rules. A fresh copy is cheap; a stale one is not.
 *
 * IndexedDB, like the archivist, because it works with no network and survives
 * a reload; a Map when IndexedDB is absent (tests, private windows that refuse
 * it), so a caller never has to branch on storage support.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CachedPersona {
  userId: string;
  prompt: string;
  mode: string;
  fetchedAt: number;
}

/**
 * How long a saved profile may answer for. Long enough that a week in the
 * field with no signal still works; short enough that a morals change made
 * online is picked up on the next visit rather than silently deferred.
 */
export const PERSONA_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const DB = "jackie-device-persona";
const STORE = "profile";
const memory = new Map<string, CachedPersona>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "userId" });
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

/** The signed-in account's id, or null. Never throws: an unreadable session is simply "not signed in". */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Keeps the profile only when there is an account to keep it under. */
export async function saveDevicePersona(entry: CachedPersona): Promise<void> {
  const prompt = entry.prompt?.trim();
  if (!entry.userId || !prompt) return;
  const record = { ...entry, prompt };
  memory.set(entry.userId, record);
  const db = await openDb();
  if (!db) return;
  try {
    await tx(db, "readwrite", (s) => s.put(record));
  } catch {
    // The Map copy still answers this session; losing the durable copy is not
    // a reason to fail a turn that already has its persona in hand.
  } finally {
    db.close();
  }
}

/**
 * The saved profile for this account, or null when there is none, it belongs to
 * someone else, or it is too old to trust. `now` is injectable so the age bound
 * is testable without waiting two weeks.
 */
export async function loadDevicePersona(
  userId: string | null,
  now: number = Date.now(),
): Promise<CachedPersona | null> {
  if (!userId) return null;
  const find = async (): Promise<CachedPersona | null> => {
    const db = await openDb();
    if (!db) return memory.get(userId) ?? null;
    try {
      return (await tx<CachedPersona>(db, "readonly", (s) => s.get(userId))) ?? memory.get(userId) ?? null;
    } catch {
      return memory.get(userId) ?? null;
    } finally {
      db.close();
    }
  };
  const found = await find();
  if (!found?.prompt?.trim()) return null;
  if (!Number.isFinite(found.fetchedAt)) return null;
  if (now - found.fetchedAt > PERSONA_MAX_AGE_MS) return null;
  return found;
}

/** Drops one account's copy, or every copy when no account is named. */
export async function clearDevicePersona(userId?: string | null): Promise<void> {
  if (userId) memory.delete(userId);
  else memory.clear();
  const db = await openDb();
  if (!db) return;
  try {
    if (userId) await tx(db, "readwrite", (s) => s.delete(userId));
    else await tx(db, "readwrite", (s) => s.clear());
  } catch {
    // Nothing to report: the copy is either gone or was never there.
  } finally {
    db.close();
  }
}
