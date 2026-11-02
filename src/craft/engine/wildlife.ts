/**
 * Where the wildlife lives (after Alex's Mobs and Naturalist): wolf packs in
 * the forests and taiga, deer in the woods and meadows, bears in the cold
 * pines and the dark forest. The game's spawner asks here for a share of its
 * daytime animal spawns when the world keeps wildlife.
 */
import type { MobKind } from "./mobs";

export interface WildSpawn {
  kind: MobKind;
  weight: number;
  min: number;
  max: number;
}

const WILD: Record<string, WildSpawn[]> = {
  "Forest": [{ kind: "wolf", weight: 3, min: 2, max: 4 }, { kind: "deer", weight: 6, min: 2, max: 3 }],
  "Birch Forest": [{ kind: "deer", weight: 8, min: 2, max: 4 }],
  "Dark Forest": [{ kind: "bear", weight: 4, min: 1, max: 1 }, { kind: "deer", weight: 3, min: 1, max: 2 }],
  "Taiga": [{ kind: "wolf", weight: 6, min: 2, max: 4 }, { kind: "bear", weight: 3, min: 1, max: 2 }, { kind: "deer", weight: 4, min: 2, max: 3 }],
  "Snowy Taiga": [{ kind: "wolf", weight: 6, min: 2, max: 4 }, { kind: "bear", weight: 2, min: 1, max: 1 }],
  "Meadow": [{ kind: "deer", weight: 6, min: 2, max: 4 }],
  "Windswept Hills": [{ kind: "wolf", weight: 2, min: 1, max: 3 }],
};

/** One wild spawn for a biome, by weight; null where nothing wild lives. `random` is 0..1. */
export function pickWildlife(biome: string, random: () => number): WildSpawn | null {
  const list = WILD[biome];
  if (!list) return null;
  let roll = random() * list.reduce((t, s) => t + s.weight, 0);
  for (const s of list) {
    roll -= s.weight;
    if (roll < 0) return s;
  }
  return list[list.length - 1];
}
