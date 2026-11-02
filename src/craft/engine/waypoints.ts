/**
 * Waypoints (after Xaero's and JourneyMap's): named places a player keeps,
 * drawn on both maps and — within range — as a label floating over the spot
 * in the world, with how far it is. Dying leaves one where you fell, so the
 * walk back to your things is not a guess.
 *
 * They belong to the player (PlayerSave), so each friend in a shared world
 * has their own, and a guest's travel home with the host's save.
 */
import { isDimension, type Dimension } from "./dimension";

export interface Waypoint {
  name: string;
  x: number;
  y: number;
  z: number;
  dim: Dimension;
  /** Index into WAYPOINT_COLORS. */
  color: number;
  /** Hidden from the world and the minimap, still on the list. */
  hidden?: boolean;
  /** Where the player last died; there is only ever one. */
  death?: boolean;
}

export const WAYPOINT_COLORS = ["#ff5555", "#55ff55", "#5599ff", "#ffff55", "#ff55ff", "#55ffff", "#ffaa00", "#ffffff"] as const;
export const MAX_WAYPOINTS = 64;
export const WAYPOINT_NAME_MAX = 24;

export function sanitizeWaypoint(v: unknown): Waypoint | null {
  const w = v as Partial<Waypoint> | null;
  if (!w || typeof w !== "object") return null;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);
  const x = num(w.x), y = num(w.y), z = num(w.z);
  if (x === null || y === null || z === null || !isDimension(w.dim)) return null;
  const name = typeof w.name === "string" ? w.name.trim().slice(0, WAYPOINT_NAME_MAX) : "";
  const out: Waypoint = {
    name: name || "Waypoint", x, y, z, dim: w.dim,
    color: Number.isInteger(w.color) && (w.color as number) >= 0 && (w.color as number) < WAYPOINT_COLORS.length ? (w.color as number) : 0,
  };
  if (w.hidden === true) out.hidden = true;
  if (w.death === true) out.death = true;
  return out;
}

export function sanitizeWaypoints(v: unknown): Waypoint[] {
  return (Array.isArray(v) ? v : []).map(sanitizeWaypoint).filter((w): w is Waypoint => w !== null).slice(0, MAX_WAYPOINTS);
}

/** The list with this death's waypoint in place of the last one. */
export function withDeathPoint(list: readonly Waypoint[], x: number, y: number, z: number, dim: Dimension): Waypoint[] {
  const rest = list.filter((w) => !w.death);
  return [{ name: "Death", x: Math.floor(x), y: Math.floor(y), z: Math.floor(z), dim, color: 0, death: true }, ...rest].slice(0, MAX_WAYPOINTS);
}

/** A name for a new waypoint that is not already on the list: "Waypoint 3". */
export function nextWaypointName(list: readonly Waypoint[]): string {
  for (let i = 1; ; i++) {
    const n = `Waypoint ${i}`;
    if (!list.some((w) => w.name === n)) return n;
  }
}

/** Whole blocks between a point and a waypoint, as the label shows it. */
export function waypointDistance(w: Waypoint, x: number, y: number, z: number): number {
  return Math.round(Math.hypot(w.x + 0.5 - x, w.y - y, w.z + 0.5 - z));
}
