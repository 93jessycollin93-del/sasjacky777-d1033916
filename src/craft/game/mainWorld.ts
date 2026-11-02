/**
 * The main world: Ashgrove County, always in the world list, never gone.
 *
 * Every other world is the player's to make and throw away. This one is the
 * game's: the same county on every device (a fixed seed, a fixed start date),
 * made again from nothing whenever it is missing. Deleting it resets it —
 * its saved chunks and players go, and it comes back exactly as it was first
 * made, every house shut and every cupboard full — because the point of it
 * is to be a place, not a save file.
 *
 * Nothing about it is stored anywhere but the ordinary world store: the
 * pristine version is a function of this file, so "reset" is "delete, then
 * write the function's result back".
 */
import { applyMode, modeDef } from "../modes/modes";
import { newWorldMeta, type SaveStore, type WorldMeta } from "./save";

export const MAIN_WORLD_ID = "main-ashgrove";
export const MAIN_WORLD_NAME = "Ashgrove County";
/** Its seed, the same everywhere, so everyone's county is the same county. */
export const MAIN_WORLD_SEED = 0x1994_07_14 | 0;
/** The morning the county was sealed: the sky over it is that summer's (a Julian day, at midnight). */
export const MAIN_WORLD_EPOCH = 2449547.5;
/** Where on the Earth it lies, for the sun, the moon and the stars: river country in the middle of the continent. */
export const MAIN_WORLD_PLACE = { lat: 38, lon: -86 };

export function isMainWorld(w: Pick<WorldMeta, "id"> | string | null | undefined): boolean {
  return (typeof w === "string" ? w : w?.id) === MAIN_WORLD_ID;
}

/** The main world as it is before anyone has set foot in it. */
export function pristineMainWorld(): WorldMeta {
  const def = modeDef("ashgrove");
  if (!def) throw new Error("The Ashgrove County mode is missing, so the main world cannot be made.");
  const meta = newWorldMeta({
    name: MAIN_WORLD_NAME, seed: MAIN_WORLD_SEED, seedText: "ashgrove", type: "default", gameMode: def.gameMode,
    difficulty: def.difficulty ?? 2, hardcore: false, cheats: false,
  });
  meta.id = MAIN_WORLD_ID;
  // Nine in the morning, the first day: a few hours of light to find your feet in.
  meta.time = 3000;
  meta.skyEpoch = MAIN_WORLD_EPOCH;
  meta.place = { ...MAIN_WORLD_PLACE };
  // Clear skies to start; the weather's own timers take it from there.
  meta.weather = { rain: 0, thunder: 0, rainTimer: 36000, thunderTimer: 120000 };
  return applyMode(meta, def);
}

/** The main world from this browser's saves, made fresh first if it is not there. */
export async function ensureMainWorld(saves: SaveStore): Promise<WorldMeta> {
  const have = await saves.getWorld(MAIN_WORLD_ID);
  if (have) return have;
  const fresh = pristineMainWorld();
  await saves.putWorld(fresh);
  return fresh;
}

/** Deleting the main world: everything it saved goes, and it is made again as it began. */
export async function resetMainWorld(saves: SaveStore): Promise<WorldMeta> {
  await saves.deleteWorld(MAIN_WORLD_ID);
  const fresh = pristineMainWorld();
  await saves.putWorld(fresh);
  return fresh;
}
