/**
 * Waystones (after the Waystones mod): stones a player finds or builds and
 * wakes by using them; from any waystone, they can travel to any other they
 * have woken in the same dimension, for a little experience.
 *
 * The world keeps the list of every waystone and its name (WorldMeta), so a
 * name given by one friend is the name all see; each player keeps which ones
 * they have woken (PlayerSave), so finding one is still an achievement of your
 * own. A village keeps one on its square, named for the village.
 */
import { isDimension, type Dimension } from "./dimension";

export interface Waystone {
  name: string;
  x: number;
  y: number;
  z: number;
  dim: Dimension;
}

export const WAYSTONE_NAME_MAX = 24;

export const waystoneKey = (dim: Dimension, x: number, y: number, z: number) => `${dim}:${x},${y},${z}`;

export function sanitizeWaystones(v: unknown): Record<string, Waystone> {
  const out: Record<string, Waystone> = {};
  if (!v || typeof v !== "object") return out;
  for (const w of Object.values(v as Record<string, Partial<Waystone>>).slice(0, 512)) {
    if (!w || typeof w !== "object" || !isDimension(w.dim)) continue;
    if (![w.x, w.y, w.z].every((n) => Number.isInteger(n))) continue;
    const name = typeof w.name === "string" && w.name.trim() ? w.name.trim().slice(0, WAYSTONE_NAME_MAX) : "Waystone";
    out[waystoneKey(w.dim, w.x!, w.y!, w.z!)] = { name, x: w.x!, y: w.y!, z: w.z!, dim: w.dim };
  }
  return out;
}

const FIRST = ["Ash", "Bright", "Cold", "Dun", "Elder", "Fern", "Glen", "Hollow", "Iron", "Kings", "Lark", "Mill", "North", "Oak", "Pine", "Raven", "Stone", "Thorn", "Willow", "Wren"];
const LAST = ["ford", "water", "brook", "vale", "stead", "wick", "haven", "mere", "field", "crest", "hollow", "moor", "reach", "gate", "wood", "barrow"];

/** A name for a waystone that has none, the same every time for the same spot. */
export function waystoneName(x: number, y: number, z: number): string {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) ^ (h >>> 16);
  const u = h >>> 0;
  return FIRST[u % FIRST.length] + LAST[(u >>> 8) % LAST.length];
}

/**
 * Levels of experience a trip costs: one for every 500 blocks, from one to
 * five. Creative travels free — there are no levels to spend.
 */
export function travelCost(from: { x: number; z: number }, to: { x: number; z: number }, creative: boolean): number {
  if (creative) return 0;
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  return Math.max(1, Math.min(5, Math.ceil(d / 500)));
}
