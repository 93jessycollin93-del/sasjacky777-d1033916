/**
 * Biomes: what the surface is made of, what grows on it, and what colour it is.
 *
 * Grass and foliage colours come from a colour map over temperature and
 * humidity rather than from the biome's name, the way the original does it.
 * Temperature and humidity are smooth noise, so the colour shifts gradually
 * across a border instead of snapping at the exact column where the biome id
 * changes — no per-vertex blending pass needed. The handful of biomes with
 * their own palette (swamp, badlands) override it.
 */
import { B } from "./blocks";

export enum BiomeId {
  Ocean = 0,
  DeepOcean,
  FrozenOcean,
  Beach,
  SnowyBeach,
  River,
  FrozenRiver,
  Plains,
  SunflowerPlains,
  Forest,
  BirchForest,
  DarkForest,
  Taiga,
  SnowyPlains,
  SnowyTaiga,
  Desert,
  Savanna,
  Badlands,
  Jungle,
  Swamp,
  WindsweptHills,
  StonyPeaks,
  SnowyPeaks,
  Meadow,
  MushroomFields,
  NetherWastes,
  SoulSandValley,
  CrimsonForest,
  WarpedForest,
  BasaltDeltas,
  TheEnd,
  EndHighlands,
  EndMidlands,
  EndBarrens,
  SmallEndIslands,
  Count,
}

export type TreeKind = "oak" | "big_oak" | "birch" | "spruce" | "jungle" | "acacia" | "dark_oak" | "bush";

export interface BiomeDef {
  id: BiomeId;
  name: string;
  top: number;
  filler: number;
  /** Block under water (ocean floor, river bed). */
  underwater: number;
  /** Trees per chunk, on average, and which kinds. */
  trees: number;
  treeKinds: [TreeKind, number][];
  /** Grass/fern tufts per chunk. */
  grass: number;
  flowers: number[];
  flowerDensity: number;
  snowy: boolean;
  /** Overrides the colour map. */
  grassColor?: number;
  foliageColor?: number;
  waterColor?: number;
  /** Hostile/passive spawning list used by the mob system. */
  passive: string[];
  /** Outside the overworld: the fog and sky colour, 0xRRGGBB. */
  fog?: number;
  /** Specks drifting in the air (the Nether's ash and spores). */
  airborne?: "ash" | "crimson_spores" | "warped_spores" | "soul";
  /** Outside the overworld, what spawns here regardless of light, by weight. */
  spawns?: [string, number][];
}

const PLAINS_FLOWERS = [B.DANDELION, B.POPPY, B.OXEYE_DAISY, B.CORNFLOWER, B.RED_TULIP];
const FOREST_FLOWERS = [B.DANDELION, B.POPPY, B.LILY_OF_THE_VALLEY, B.ALLIUM];
const FARM = ["pig", "cow", "sheep", "chicken"];

function biome(id: BiomeId, name: string, opts: Partial<BiomeDef>): BiomeDef {
  return {
    id,
    name,
    top: B.GRASS,
    filler: B.DIRT,
    underwater: B.SAND,
    trees: 0,
    treeKinds: [["oak", 1]],
    grass: 6,
    flowers: [],
    flowerDensity: 0,
    snowy: false,
    passive: FARM,
    ...opts,
  };
}

export const BIOMES: BiomeDef[] = [
  biome(BiomeId.Ocean, "Ocean", { top: B.SAND, filler: B.SAND, underwater: B.GRAVEL, grass: 0, passive: [] }),
  biome(BiomeId.DeepOcean, "Deep Ocean", { top: B.GRAVEL, filler: B.GRAVEL, underwater: B.GRAVEL, grass: 0, passive: [] }),
  biome(BiomeId.FrozenOcean, "Frozen Ocean", { top: B.GRAVEL, filler: B.GRAVEL, underwater: B.GRAVEL, grass: 0, snowy: true, passive: [] }),
  biome(BiomeId.Beach, "Beach", { top: B.SAND, filler: B.SAND, grass: 0, passive: [] }),
  biome(BiomeId.SnowyBeach, "Snowy Beach", { top: B.SAND, filler: B.SAND, grass: 0, snowy: true, passive: [] }),
  biome(BiomeId.River, "River", { underwater: B.SAND, grass: 2, passive: [] }),
  biome(BiomeId.FrozenRiver, "Frozen River", { underwater: B.GRAVEL, grass: 0, snowy: true, passive: [] }),
  biome(BiomeId.Plains, "Plains", { trees: 0.15, treeKinds: [["oak", 8], ["big_oak", 1]], grass: 40, flowers: PLAINS_FLOWERS, flowerDensity: 3, passive: FARM }),
  biome(BiomeId.SunflowerPlains, "Flower Plains", { trees: 0.1, grass: 30, flowers: [...PLAINS_FLOWERS, B.ALLIUM, B.BLUE_ORCHID], flowerDensity: 14 }),
  biome(BiomeId.Forest, "Forest", { trees: 9, treeKinds: [["oak", 8], ["birch", 2], ["big_oak", 1]], grass: 12, flowers: FOREST_FLOWERS, flowerDensity: 2 }),
  biome(BiomeId.BirchForest, "Birch Forest", { trees: 9, treeKinds: [["birch", 1]], grass: 12, flowers: FOREST_FLOWERS, flowerDensity: 2 }),
  biome(BiomeId.DarkForest, "Dark Forest", { trees: 16, treeKinds: [["dark_oak", 6], ["oak", 2]], grass: 6, flowers: [B.LILY_OF_THE_VALLEY], flowerDensity: 1, grassColor: 0x507a32, foliageColor: 0x3f6b24 }),
  biome(BiomeId.Taiga, "Taiga", { trees: 9, treeKinds: [["spruce", 1]], grass: 14, flowers: [B.BROWN_MUSHROOM, B.RED_MUSHROOM], flowerDensity: 0.6, passive: FARM }),
  biome(BiomeId.SnowyPlains, "Snowy Plains", { trees: 0.2, treeKinds: [["spruce", 1]], grass: 0, snowy: true, passive: ["chicken"] }),
  biome(BiomeId.SnowyTaiga, "Snowy Taiga", { trees: 7, treeKinds: [["spruce", 1]], grass: 3, snowy: true, passive: ["sheep"] }),
  biome(BiomeId.Desert, "Desert", { top: B.SAND, filler: B.SANDSTONE, grass: 0, passive: ["chicken"] }),
  biome(BiomeId.Savanna, "Savanna", { trees: 1, treeKinds: [["acacia", 4], ["oak", 1]], grass: 40, passive: FARM, grassColor: 0xbfb755, foliageColor: 0xaea42a }),
  biome(BiomeId.Badlands, "Badlands", { top: B.RED_SAND, filler: B.TERRACOTTA, grass: 0, passive: [], grassColor: 0x90814d, foliageColor: 0x9e814d }),
  biome(BiomeId.Jungle, "Jungle", { trees: 16, treeKinds: [["jungle", 4], ["bush", 5], ["oak", 1]], grass: 30, flowers: [B.DANDELION, B.POPPY], flowerDensity: 1, passive: ["chicken", "pig"] }),
  biome(BiomeId.Swamp, "Swamp", { trees: 2, treeKinds: [["oak", 1]], grass: 8, flowers: [B.BLUE_ORCHID], flowerDensity: 1, grassColor: 0x6a7039, foliageColor: 0x6a7039, waterColor: 0x617b64, underwater: B.MUD }),
  biome(BiomeId.WindsweptHills, "Windswept Hills", { trees: 1, treeKinds: [["spruce", 2], ["oak", 1]], grass: 6, passive: ["sheep"] }),
  biome(BiomeId.StonyPeaks, "Stony Peaks", { top: B.STONE, filler: B.STONE, grass: 0, passive: [] }),
  biome(BiomeId.SnowyPeaks, "Snowy Peaks", { top: B.SNOW_BLOCK, filler: B.STONE, grass: 0, snowy: true, passive: [] }),
  biome(BiomeId.Meadow, "Meadow", { trees: 0.3, treeKinds: [["birch", 1], ["oak", 1]], grass: 50, flowers: [B.DANDELION, B.CORNFLOWER, B.ALLIUM, B.OXEYE_DAISY, B.POPPY], flowerDensity: 10, passive: ["sheep", "cow"] }),
  biome(BiomeId.MushroomFields, "Mushroom Fields", { top: B.MOSS, grass: 0, trees: 0, flowers: [B.RED_MUSHROOM, B.BROWN_MUSHROOM], flowerDensity: 4, passive: ["cow"] }),
  biome(BiomeId.NetherWastes, "Nether Wastes", { top: B.NETHERRACK, filler: B.NETHERRACK, grass: 0, passive: [], fog: 0x330808,
    spawns: [["zombified_piglin", 100], ["ghast", 25], ["magma_cube", 6], ["piglin", 20], ["enderman", 4]] }),
  biome(BiomeId.SoulSandValley, "Soul Sand Valley", { top: B.SOUL_SAND, filler: B.SOUL_SOIL, grass: 0, passive: [], fog: 0x1b4745, airborne: "soul",
    spawns: [["skeleton", 30], ["ghast", 20], ["enderman", 3]] }),
  biome(BiomeId.CrimsonForest, "Crimson Forest", { top: B.CRIMSON_NYLIUM, filler: B.NETHERRACK, grass: 0, passive: [], fog: 0x330303, airborne: "crimson_spores",
    spawns: [["zombified_piglin", 30], ["hoglin", 18], ["piglin", 12]] }),
  biome(BiomeId.WarpedForest, "Warped Forest", { top: B.WARPED_NYLIUM, filler: B.NETHERRACK, grass: 0, passive: [], fog: 0x1a051a, airborne: "warped_spores",
    spawns: [["enderman", 10]] }),
  biome(BiomeId.BasaltDeltas, "Basalt Deltas", { top: B.BASALT, filler: B.BLACKSTONE, grass: 0, passive: [], fog: 0x685f70, airborne: "ash",
    spawns: [["magma_cube", 30], ["ghast", 8]] }),
  biome(BiomeId.TheEnd, "The End", { top: B.AIR, filler: B.AIR, grass: 0, passive: [], fog: 0x1a1224, spawns: [["enderman", 10]] }),
  biome(BiomeId.EndHighlands, "End Highlands", { top: B.AIR, filler: B.AIR, grass: 0, passive: [], fog: 0x1a1224, spawns: [["enderman", 10]] }),
  biome(BiomeId.EndMidlands, "End Midlands", { top: B.AIR, filler: B.AIR, grass: 0, passive: [], fog: 0x1a1224, spawns: [["enderman", 10]] }),
  biome(BiomeId.EndBarrens, "End Barrens", { top: B.AIR, filler: B.AIR, grass: 0, passive: [], fog: 0x1a1224, spawns: [["enderman", 10]] }),
  biome(BiomeId.SmallEndIslands, "Small End Islands", { top: B.AIR, filler: B.AIR, grass: 0, passive: [], fog: 0x1a1224, spawns: [["enderman", 10]] }),
];

export function biomeDef(id: number): BiomeDef {
  return BIOMES[id] ?? BIOMES[BiomeId.Plains];
}

type RGB = [number, number, number];

function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function fromInt(c: number): RGB {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

// Corners of the colour map: [cold-dry, cold-wet, hot-dry, hot-wet].
const GRASS_MAP: RGB[] = [fromInt(0x80b497), fromInt(0x60a17b), fromInt(0xbfb755), fromInt(0x47cd33)];
const FOLIAGE_MAP: RGB[] = [fromInt(0x60a17b), fromInt(0x4d8f69), fromInt(0xaea42a), fromInt(0x1eb312)];

/** temperature and humidity in [-1, 1]. */
function colorMap(map: RGB[], temperature: number, humidity: number): RGB {
  const t = Math.max(0, Math.min(1, (temperature + 0.6) / 1.4));
  const h = Math.max(0, Math.min(1, (humidity + 0.6) / 1.4)) * t;
  const cold = lerp3(map[0], map[1], h);
  const hot = lerp3(map[2], map[3], h);
  return lerp3(cold, hot, t);
}

export function grassColor(b: BiomeDef, temperature: number, humidity: number): RGB {
  return b.grassColor !== undefined ? fromInt(b.grassColor) : colorMap(GRASS_MAP, temperature, humidity);
}
export function foliageColor(b: BiomeDef, temperature: number, humidity: number): RGB {
  return b.foliageColor !== undefined ? fromInt(b.foliageColor) : colorMap(FOLIAGE_MAP, temperature, humidity);
}
export function waterColor(b: BiomeDef): RGB {
  if (b.waterColor !== undefined) return fromInt(b.waterColor);
  if (b.snowy) return fromInt(0x3938c9);
  if (b.id === BiomeId.Jungle || b.id === BiomeId.Savanna) return fromInt(0x3ab2d8);
  return fromInt(0x3f76e4);
}
