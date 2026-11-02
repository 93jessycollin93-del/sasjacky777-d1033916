/**
 * How a comet wakes as it nears the Sun: nothing much beyond five AU, where
 * its ices stay frozen; a coma and tails growing inward, the tail's length
 * with the inverse square of the distance, as the sunlight driving it does.
 */
import { AU, len, type Vec3 } from "./kepler";
import type { BodyDef } from "./bodies";

/** How active a comet is at a place: nothing beyond five AU, full by two and a half. */
export function cometActivity(def: BodyDef, helio: Vec3): number {
  const r = len(helio) / AU;
  const k = Math.max(0, Math.min(1, (5 - r) / 2.5));
  return k * (def.activity ?? 0.5);
}

export function tailLength(def: BodyDef, helio: Vec3): number {
  const r = Math.max(0.2, len(helio) / AU);
  return Math.min(1.5e8, (2.2e7 * (def.activity ?? 0.5)) / (r * r)) * Math.min(1, Math.max(0, (5 - r) / 2.5));
}

export function comaSize(def: BodyDef, helio: Vec3): number {
  const r = Math.max(0.2, len(helio) / AU);
  return (6e4 * (def.activity ?? 0.5)) / r;
}

