/**
 * Where crafted indexes live.
 *
 * Local first, synced second, and that order is the whole design. An index is
 * the thing that lets a micro model answer on a device with no network — so if
 * reading your own indexes needed a round trip, the feature would be unusable
 * in precisely the situation it exists for. localStorage is the source of
 * truth for reads. Supabase is a second copy that follows you between devices
 * and survives a cleared cache.
 *
 * ## What happens when the two disagree
 *
 * Last write wins, by `updatedAt`, per index. That is a real choice with a real
 * cost — two devices editing the same index between syncs means one edit is
 * lost — and it is the right one here because an index is small,
 * single-author, and rarely edited from two places at once. Anything better
 * (a merge, a CRDT, a conflict UI) costs more than the problem.
 *
 * What it must never do is lose an index that only exists in one place, so a
 * merge is a union: an index missing locally is pulled down, an index missing
 * remotely is pushed up, and only a genuine id collision consults timestamps.
 *
 * ## Deletes
 *
 * A delete is a row removal plus a local tombstone. Without the tombstone the
 * next sync would see an index present remotely and absent locally, treat it as
 * something to pull down, and resurrect what you just deleted.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CraftedIndex } from "./types";

/**
 * The generated `Database` types are produced from the deployed schema, and
 * `crafted_indexes` is newer than the last generation. Until someone runs
 * `supabase gen types typescript --linked` after `db push` — the step
 * CLAUDE.md's deploy section names — the table is not in that union, so the
 * query builder rejects its own table by name.
 *
 * Scoped to this one module and to this one table on purpose: a project-wide
 * loosening of the client would hide the same mistake everywhere else, where it
 * would be a real error rather than a pending codegen step.
 */
const db = supabase as unknown as {
  from(table: string): {
    select(columns: string): Promise<{ data: IndexRow[] | null; error: { message: string } | null }>;
    upsert(rows: unknown[]): Promise<{ error: { message: string } | null }>;
    delete(): { in(column: string, values: string[]): Promise<{ error: { message: string } | null }> };
  };
};

const KEY = "jackie:forge:indexes:v1";
const TOMBSTONE_KEY = "jackie:forge:tombstones:v1";

export interface SyncReport {
  pushed: number;
  pulled: number;
  /** Ids where both sides had changed and the newer one won. */
  resolved: string[];
  /** Null when the sync worked; a sentence a person can act on when it did not. */
  error: string | null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // A corrupt or unavailable store must not take the forge down with it:
    // private-mode browsers throw on access, and a bad value is recoverable by
    // saving over it.
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Every index on this device, newest first. */
export function listLocal(): CraftedIndex[] {
  const all = readJson<CraftedIndex[]>(KEY, []);
  return [...all].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function findLocal(id: string): CraftedIndex | null {
  return listLocal().find((i) => i.id === id) ?? null;
}

/**
 * Saves one index, replacing any with the same id.
 *
 * Returns false when the write did not happen — a full or unavailable store —
 * rather than resolving as though it had. A forge that reports a save it did
 * not make is the exact failure rule 8 is about, and it is worse here than
 * elsewhere because the thing lost is something the person wrote.
 */
export function saveLocal(index: CraftedIndex): boolean {
  const all = readJson<CraftedIndex[]>(KEY, []).filter((i) => i.id !== index.id);
  all.push({ ...index, updatedAt: new Date().toISOString() });
  // Saving over a deleted id revives it deliberately, so its tombstone goes.
  const tombstones = readJson<Record<string, string>>(TOMBSTONE_KEY, {});
  if (tombstones[index.id]) {
    delete tombstones[index.id];
    writeJson(TOMBSTONE_KEY, tombstones);
  }
  return writeJson(KEY, all);
}

export function deleteLocal(id: string): boolean {
  const all = readJson<CraftedIndex[]>(KEY, []);
  const remaining = all.filter((i) => i.id !== id);
  if (remaining.length === all.length) return false;

  const tombstones = readJson<Record<string, string>>(TOMBSTONE_KEY, {});
  tombstones[id] = new Date().toISOString();
  writeJson(TOMBSTONE_KEY, tombstones);
  return writeJson(KEY, remaining);
}

export function listTombstones(): Record<string, string> {
  return readJson<Record<string, string>>(TOMBSTONE_KEY, {});
}

/** Rows as the table stores them. */
interface IndexRow {
  id: string;
  user_id?: string;
  spec: CraftedIndex;
  updated_at: string;
}

/**
 * Merges local and remote.
 *
 * Pure, and separated from the network on purpose: this is the part with the
 * decisions in it, so it is the part worth testing without a database.
 */
export function mergeIndexes(
  local: CraftedIndex[],
  remote: CraftedIndex[],
  tombstones: Record<string, string>,
): { merged: CraftedIndex[]; toPush: CraftedIndex[]; toPull: CraftedIndex[]; resolved: string[] } {
  const byId = new Map<string, CraftedIndex>();
  const toPush: CraftedIndex[] = [];
  const toPull: CraftedIndex[] = [];
  const resolved: string[] = [];

  for (const index of local) byId.set(index.id, index);

  for (const incoming of remote) {
    const deletedAt = tombstones[incoming.id];
    if (deletedAt && deletedAt >= (incoming.updatedAt ?? "")) {
      // Deleted here after it was last changed there: stay deleted rather than
      // resurrecting it on the next sync.
      continue;
    }

    const mine = byId.get(incoming.id);
    if (!mine) {
      byId.set(incoming.id, incoming);
      toPull.push(incoming);
      continue;
    }
    if ((incoming.updatedAt ?? "") > (mine.updatedAt ?? "")) {
      byId.set(incoming.id, incoming);
      toPull.push(incoming);
      resolved.push(incoming.id);
    } else if ((mine.updatedAt ?? "") > (incoming.updatedAt ?? "")) {
      toPush.push(mine);
      resolved.push(mine.id);
    }
  }

  const remoteIds = new Set(remote.map((i) => i.id));
  for (const mine of local) {
    if (!remoteIds.has(mine.id)) toPush.push(mine);
  }

  return { merged: [...byId.values()], toPush, toPull, resolved };
}

/**
 * Pulls, merges, pushes.
 *
 * Signed out is not an error: the forge works offline and without an account,
 * and reporting "not signed in" as a failure every time would train people to
 * ignore the one message that matters.
 */
export async function syncIndexes(): Promise<SyncReport> {
  const quiet: SyncReport = { pushed: 0, pulled: 0, resolved: [], error: null };

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return quiet;

  const { data, error } = await db
    .from("crafted_indexes")
    .select("id, spec, updated_at");

  if (error) {
    return { ...quiet, error: `Could not read your synced indexes: ${error.message}` };
  }

  // The row's `updated_at` is stamped by a trigger and overrides whatever the
  // spec carries. The spec's own timestamp is written by a client, and a client
  // that sets it to the year 3000 — by accident, a wrong system clock, or
  // otherwise — would win every conflict for ever. The server's clock decides.
  const remote: CraftedIndex[] = (data ?? [])
    .map((row) => (row?.spec ? { ...row.spec, updatedAt: row.updated_at ?? row.spec.updatedAt } : null))
    .filter((spec): spec is CraftedIndex => !!spec && typeof spec.id === "string");

  const local = listLocal();
  const tombstones = listTombstones();
  const { merged, toPush, toPull, resolved } = mergeIndexes(local, remote, tombstones);

  writeJson(KEY, merged);

  const deletedIds = Object.keys(tombstones);
  if (deletedIds.length > 0) {
    await db.from("crafted_indexes").delete().in("id", deletedIds);
  }

  if (toPush.length > 0) {
    const rows = toPush.map((index) => ({
      id: index.id,
      user_id: userId,
      spec: index,
      updated_at: index.updatedAt,
    }));
    const { error: pushError } = await db.from("crafted_indexes").upsert(rows);
    if (pushError) {
      return {
        pushed: 0,
        pulled: toPull.length,
        resolved,
        error: `Your indexes are saved on this device, but syncing them failed: ${pushError.message}`,
      };
    }
  }

  return { pushed: toPush.length, pulled: toPull.length, resolved, error: null };
}
