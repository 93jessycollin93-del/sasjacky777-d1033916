/**
 * Ambient sound (after AmbientSounds and Dynamic Surroundings): now and then,
 * the place the player stands in makes a noise — birds in a forest by day,
 * crickets and owls at night, frogs in a swamp, surf on a beach, wind on a
 * peak, water dripping in a cave, the Nether's low moan and the End's hum.
 *
 * This only chooses; audio.ts makes each sound. Asked once a second, it
 * answers with a cue or nothing, so the quiet between sounds is part of it.
 */
import type { Dimension } from "./dimension";

export type AmbientCue =
  | "birds" | "crickets" | "owl" | "frogs" | "waves" | "wind" | "leaves"
  | "cave_drip" | "cave_rumble" | "nether_moan" | "end_hum";

export interface AmbientPlace {
  dimension: Dimension;
  /** The biome's name, as biomes.ts gives it. */
  biome: string;
  night: boolean;
  raining: boolean;
  /** No sky overhead and little light: a cave, a mine, a cellar. */
  underground: boolean;
  /** Feet height. */
  y: number;
  /** Open water within a few blocks. */
  nearWater: boolean;
}

const FOREST = /Forest|Taiga|Jungle|Meadow|Plains|Savanna|Swamp/;

/** A cue for this second, or null for quiet. `random` is 0..1. */
export function ambientCue(p: AmbientPlace, random: () => number): AmbientCue | null {
  const roll = random();
  if (p.dimension === "nether") return roll < 0.12 ? "nether_moan" : null;
  if (p.dimension === "end") return roll < 0.08 ? "end_hum" : null;
  if (p.underground) return roll < 0.1 ? "cave_drip" : roll < 0.13 ? "cave_rumble" : null;
  if (p.y > 100) return roll < 0.15 ? "wind" : null;
  if (p.raining) return roll < 0.05 ? "wind" : null;
  if (p.nearWater && /Beach|Ocean/.test(p.biome)) return roll < 0.2 ? "waves" : null;
  if (p.biome.includes("Swamp") && p.night) return roll < 0.25 ? "frogs" : null;
  if (p.night) return roll < 0.2 ? "crickets" : roll < 0.24 ? "owl" : null;
  if (FOREST.test(p.biome)) return roll < 0.18 ? "birds" : roll < 0.23 ? "leaves" : null;
  return roll < 0.05 ? "wind" : null;
}
