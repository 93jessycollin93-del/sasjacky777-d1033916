/**
 * Worlds in the cloud: a copy of a world its owner chooses to upload, so it
 * can be downloaded on another device. Play never touches this — worlds live
 * in IndexedDB — so every failure here is reported as the cloud button not
 * working, in words that say what to do, and never as the world being at risk.
 *
 * Every call returns a verdict rather than throwing, so a screen can show the
 * sentence and carry on.
 */
import { edition, GAME_NAME } from "../edition";
import type { SaveStore, WorldMeta } from "./save";

/**
 * `craft_worlds` is newer than the generated Database types (they are
 * regenerated after `supabase db push`, per CLAUDE.md's deploy section), so
 * the query builder does not know it by name yet. The loosening is scoped to
 * this module and this table, as src/lib/forge/store.ts does for its own.
 */
type Result<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
type CloudDb = {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } | null }> };
  from(table: "craft_worlds"): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): Result<CloudRow[]>;
      eq(column: string, value: string): { maybeSingle(): Result<{ data: string } | null> };
    };
    upsert(row: Record<string, unknown>): Result<null>;
    delete(): { eq(column: string, value: string): Result<null> };
  };
};

/** Why there is no cloud here: the solo copy has no account to file worlds under. */
export const NO_CLOUD = `Cloud saves live in the SAS-JACKY edition of ${GAME_NAME}, which has an account to keep them under. This copy keeps worlds on this computer — use Export… to carry one to another device.`;

class NoCloud extends Error {}

/** Whether this copy offers cloud saves at all — the world list hides the buttons when it does not. */
export function cloudAvailable(): boolean {
  const e = edition();
  return e.cloud && !!e.online;
}

function cloudDb(): CloudDb {
  const e = edition();
  if (!e.cloud || !e.online) throw new NoCloud(NO_CLOUD);
  return e.online as unknown as CloudDb;
}

interface CloudRow {
  id: string;
  name: string;
  summary: CloudSummary;
  updated_at: string;
}

export interface CloudSummary {
  gameMode: string;
  hardcore: boolean;
  cheats: boolean;
  day: number;
  seed: number;
  lastPlayed: number;
  bytes: number;
  thumbnail?: string;
}

export interface CloudWorld {
  id: string;
  name: string;
  summary: CloudSummary;
  updatedAt: string;
}

// Both arms name both fields, so the verdict reads the same with or without strict null checks.
export type Verdict<T> = { ok: true; value: T; error?: undefined } | { ok: false; error: string; value?: undefined };

/** Matches the table's CHECK constraint, with room to spare for the JSON wrapper. */
export const CLOUD_LIMIT_BYTES = 12 * 1024 * 1024;

/** The sentence for a failed call: what went wrong, and what the person can do about it. */
export function explainCloudError(message: string, code?: string): string {
  if (code === "42P01" || code === "PGRST205" || (/craft_worlds/.test(message) && /does not exist|could not find|schema cache/i.test(message))) {
    return "Cloud saves are not switched on for this server yet (the craft_worlds table has not been created). The owner adds it with `supabase db push`. Your worlds on this device are unaffected.";
  }
  if (/failed to fetch|network|load failed|ERR_/i.test(message)) {
    return "Could not reach the cloud — check the connection and try again. Your worlds on this device are unaffected.";
  }
  if (/JWT|token|not authenticated|permission denied|row-level security/i.test(message)) {
    return "The cloud would not accept this sign-in. Sign out and in again, then retry.";
  }
  if (/craft_worlds_data_bounded|too large|payload/i.test(message)) {
    return "This world is too large for a cloud save. Export it to a file instead.";
  }
  return `The cloud refused: ${message}`;
}

async function currentUser(): Promise<string | null> {
  const { data } = await cloudDb().auth.getSession();
  return data?.session?.user?.id ?? null;
}

const SIGN_IN = "Sign in to keep worlds in the cloud — worlds on this device work without an account.";

export async function listCloudWorlds(): Promise<Verdict<CloudWorld[]>> {
  try {
    if (!(await currentUser())) return { ok: false, error: SIGN_IN };
    const { data, error } = await cloudDb().from("craft_worlds").select("id, name, summary, updated_at").order("updated_at", { ascending: false });
    if (error) return { ok: false, error: explainCloudError(error.message, error.code) };
    return { ok: true, value: (data ?? []).map((r) => ({ id: r.id, name: r.name, summary: r.summary, updatedAt: r.updated_at })) };
  } catch (err) {
    return { ok: false, error: err instanceof NoCloud ? err.message : explainCloudError((err as Error).message) };
  }
}

export async function uploadWorld(saves: SaveStore, meta: WorldMeta): Promise<Verdict<CloudWorld>> {
  try {
    const user = await currentUser();
    if (!user) return { ok: false, error: SIGN_IN };
    const text = await saves.exportText(meta.id);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > CLOUD_LIMIT_BYTES) {
      return { ok: false, error: `"${meta.name}" is ${(bytes / 1048576).toFixed(1)} MB, more than a cloud save holds (${CLOUD_LIMIT_BYTES / 1048576} MB). Export it to a file instead.` };
    }
    const summary: CloudSummary = {
      gameMode: meta.gameMode, hardcore: meta.hardcore, cheats: meta.cheats, day: Math.floor(meta.time / 24000) + 1,
      seed: meta.seed, lastPlayed: meta.lastPlayed, bytes, thumbnail: meta.thumbnail,
    };
    const { error } = await cloudDb().from("craft_worlds").upsert({ id: meta.id, user_id: user, name: meta.name.slice(0, 64), summary, data: text });
    if (error) return { ok: false, error: explainCloudError(error.message, error.code) };
    return { ok: true, value: { id: meta.id, name: meta.name, summary, updatedAt: new Date().toISOString() } };
  } catch (err) {
    return { ok: false, error: err instanceof NoCloud ? err.message : explainCloudError((err as Error).message) };
  }
}

/** Brings a cloud world onto this device, replacing this device's copy of the same world if there is one. */
export async function downloadWorld(saves: SaveStore, id: string): Promise<Verdict<WorldMeta>> {
  try {
    if (!(await currentUser())) return { ok: false, error: SIGN_IN };
    const { data, error } = await cloudDb().from("craft_worlds").select("data").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: explainCloudError(error.message, error.code) };
    if (!data?.data) return { ok: false, error: "That world is no longer in the cloud." };
    return { ok: true, value: await saves.importWorld(data.data, { keepId: true }) };
  } catch (err) {
    return { ok: false, error: err instanceof NoCloud ? err.message : `The cloud copy could not be opened: ${(err as Error).message}` };
  }
}

export async function deleteCloudWorld(id: string): Promise<Verdict<null>> {
  try {
    if (!(await currentUser())) return { ok: false, error: SIGN_IN };
    const { error } = await cloudDb().from("craft_worlds").delete().eq("id", id);
    if (error) return { ok: false, error: explainCloudError(error.message, error.code) };
    return { ok: true, value: null };
  } catch (err) {
    return { ok: false, error: err instanceof NoCloud ? err.message : explainCloudError((err as Error).message) };
  }
}
