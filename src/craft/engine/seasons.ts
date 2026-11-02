/**
 * Seasons (after Serene Seasons and Fabric Seasons): spring, summer, autumn
 * and winter, a week of days each, counted from the world's clock so every
 * screen — host, guest, a reload — agrees on the date without it being sent.
 *
 * What a season does:
 * - its colour lies over grass and leaves (materials.ts uSeason), easing into
 *   the next over the last two days so the turn is a drift, not a switch;
 * - crops grow faster in spring and slower in autumn, and not at all in
 *   winter under the open sky — a roof of anything, glass included, is a
 *   greenhouse and keeps them going;
 * - winter rain falls as snow wherever it is not hot, settles and freezes
 *   still water; spring and summer melt the snow and ice winter left.
 */
import { DAY_TICKS } from "./constants";
import { BiomeId } from "./biomes";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

/** Days in a season. */
export const SEASON_DAYS = 7;
const SEASON_TICKS = SEASON_DAYS * DAY_TICKS;

export interface SeasonState {
  season: Season;
  /** 1-based day within the season. */
  day: number;
  /** How far through the season, 0-1. */
  progress: number;
}

export function seasonAt(time: number): SeasonState {
  const t = Math.max(0, time);
  const index = Math.floor(t / SEASON_TICKS) % SEASONS.length;
  const into = t % SEASON_TICKS;
  return { season: SEASONS[index], day: Math.floor(into / DAY_TICKS) + 1, progress: into / SEASON_TICKS };
}

export function seasonName(s: Season): string {
  return s[0].toUpperCase() + s.slice(1);
}

/** Each season's colour over grass and leaves, and how strongly it lies: summer is the biome's own. */
const TINT: Record<Season, [number, number, number, number]> = {
  spring: [0.47, 0.82, 0.25, 0.22],
  summer: [1, 1, 1, 0],
  autumn: [0.8, 0.45, 0.14, 0.55],
  winter: [0.62, 0.66, 0.58, 0.45],
};
/** The days at a season's end over which it eases into the next. */
const BLEND_DAYS = 2;

/**
 * The tint for the renderer, [r, g, b, amount]. A hot biome (see `warm`) keeps
 * most of its green: a jungle does not have an autumn.
 */
export function seasonTint(time: number, warmBiome = false): [number, number, number, number] {
  const s = seasonAt(time);
  const here = TINT[s.season];
  const next = TINT[SEASONS[(SEASONS.indexOf(s.season) + 1) % SEASONS.length]];
  const daysLeft = (1 - s.progress) * SEASON_DAYS;
  const k = daysLeft < BLEND_DAYS ? 1 - daysLeft / BLEND_DAYS : 0;
  // Blend the colour only where either end has one, so easing out of summer
  // does not pull the new season's colour toward white.
  const colour = (i: number) => {
    if (here[3] === 0) return next[i];
    if (next[3] === 0) return here[i];
    return here[i] + (next[i] - here[i]) * k;
  };
  const amount = (here[3] + (next[3] - here[3]) * k) * (warmBiome ? 0.25 : 1);
  return [colour(0), colour(1), colour(2), amount];
}

/** Biomes too hot for winter to reach: it neither snows nor turns there. */
const WARM = new Set<number>([BiomeId.Desert, BiomeId.Savanna, BiomeId.Badlands, BiomeId.Jungle, BiomeId.MushroomFields]);
export function warmBiome(biome: number): boolean {
  return WARM.has(biome);
}

/**
 * How fast crops grow, as a multiple of the usual chance. `sheltered` is a
 * roof overhead (glass counts): the greenhouse that keeps a winter farm alive.
 */
export function cropGrowth(season: Season, sheltered: boolean): number {
  switch (season) {
    case "spring": return 1.25;
    case "summer": return 1;
    case "autumn": return sheltered ? 1 : 0.6;
    case "winter": return sheltered ? 1 : 0;
  }
}

/** Saplings wait out the winter rather than stop: a quarter of the usual pace. */
export function saplingGrowth(season: Season, sheltered: boolean): number {
  return season === "winter" && !sheltered ? 0.25 : 1;
}

/** Whether rain here falls as snow this season (a snowy biome's always does). */
export function snowsHere(season: Season | null, biome: number, snowyBiome: boolean): boolean {
  if (snowyBiome) return true;
  return season === "winter" && !warmBiome(biome);
}

/** "Autumn, day 3 of 7" — for the debug screen and the HUD. */
export function seasonLabel(time: number): string {
  const s = seasonAt(time);
  return `${seasonName(s.season)}, day ${s.day} of ${SEASON_DAYS}`;
}
