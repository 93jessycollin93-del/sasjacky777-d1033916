/**
 * Ticked checklist items for the Realism Overhaul workspace, kept on this device.
 *
 * Same shape as the nav bar's prefs: storage is injected so tests need no DOM,
 * parsing never throws, and a write that storage refuses says so instead of
 * pretending. Only ids and timestamps are stored — never anything secret.
 */
import { allChecklistIds } from "./plan";

export const PZ_PROGRESS_KEY = "jackie.pzRealism.progress";
export const PZ_PROGRESS_VERSION = 1;

export type PzProgress = {
  version: typeof PZ_PROGRESS_VERSION;
  /** Ticked item ids, in no particular order. */
  done: string[];
  updatedAt: string | null;
};

type ReadStore = { getItem: (k: string) => string | null };
type WriteStore = { setItem: (k: string, v: string) => void };
type RemoveStore = { removeItem: (k: string) => void };

export const EMPTY_PROGRESS: PzProgress = { version: PZ_PROGRESS_VERSION, done: [], updatedAt: null };

/**
 * A record from another version, or one naming items that no longer exist, is
 * cleaned rather than trusted: a tick against a renamed task would otherwise
 * count toward progress for work nobody can see.
 */
export function parseProgress(raw: string | null, known: string[] = allChecklistIds()): PzProgress {
  if (!raw) return EMPTY_PROGRESS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_PROGRESS;
  }
  if (!data || typeof data !== "object") return EMPTY_PROGRESS;
  const rec = data as Record<string, unknown>;
  if (rec.version !== PZ_PROGRESS_VERSION || !Array.isArray(rec.done)) return EMPTY_PROGRESS;
  const valid = new Set(known);
  const done = [...new Set(rec.done.filter((id): id is string => typeof id === "string" && valid.has(id)))];
  const updatedAt = typeof rec.updatedAt === "string" && !Number.isNaN(Date.parse(rec.updatedAt)) ? rec.updatedAt : null;
  return { version: PZ_PROGRESS_VERSION, done, updatedAt };
}

export function readProgress(store: ReadStore | null): PzProgress {
  try {
    return parseProgress(store?.getItem(PZ_PROGRESS_KEY) ?? null);
  } catch {
    return EMPTY_PROGRESS;
  }
}

export function writeProgress(store: WriteStore | null, progress: PzProgress): boolean {
  if (!store) return false;
  try {
    store.setItem(PZ_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function resetProgress(store: RemoveStore | null): boolean {
  if (!store) return false;
  try {
    store.removeItem(PZ_PROGRESS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function toggleDone(progress: PzProgress, id: string, now = new Date()): PzProgress {
  const done = progress.done.includes(id) ? progress.done.filter((d) => d !== id) : [...progress.done, id];
  return { version: PZ_PROGRESS_VERSION, done, updatedAt: now.toISOString() };
}
