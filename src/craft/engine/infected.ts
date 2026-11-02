/**
 * The infected (Dead Zone and the zombie modes): which mobs count as one.
 * A bite from any of them can open a wound and, now and then, bring on a
 * fever (engine/vitals.ts). The overworld's own zombie counts for bites, but
 * keeps its own shamble; the rest behave as infectedAi.ts says.
 */
export const INFECTED_KINDS = ["infected", "runner", "brute", "spitter", "screamer", "bloater", "shambler", "crawler"] as const;
export type InfectedKind = (typeof INFECTED_KINDS)[number];

/** One of Dead Zone's infected (not the overworld's zombie). */
export const isInfectedMob = (kind: string): kind is InfectedKind => (INFECTED_KINDS as readonly string[]).includes(kind);

/** Anything whose bite can infect: the infected, and the plain zombie. */
export const isInfected = (kind: string): boolean => kind === "zombie" || isInfectedMob(kind);

/** Which infected a spawn brings, by weight: mostly walkers, a few of each worse kind. */
export const INFECTED_SPAWNS: readonly [InfectedKind, number][] = [
  ["infected", 50], ["runner", 18], ["bloater", 10], ["spitter", 8], ["screamer", 6], ["brute", 5],
];

export function pickInfected(random: () => number): InfectedKind {
  const total = INFECTED_SPAWNS.reduce((t, [, w]) => t + w, 0);
  let r = random() * total;
  for (const [k, w] of INFECTED_SPAWNS) { r -= w; if (r < 0) return k; }
  return "infected";
}

/**
 * Ashgrove County's dead, by weight: nearly all shamblers, some crawlers,
 * and very rarely one that still runs — the reference game's mix, where the
 * danger is numbers, not speed.
 */
export const COUNTY_SPAWNS: readonly [InfectedKind, number][] = [
  ["shambler", 84], ["crawler", 12], ["runner", 3], ["bloater", 1],
];

export function pickCountyInfected(random: () => number): InfectedKind {
  const total = COUNTY_SPAWNS.reduce((t, [, w]) => t + w, 0);
  let r = random() * total;
  for (const [k, w] of COUNTY_SPAWNS) { r -= w; if (r < 0) return k; }
  return "shambler";
}

/** How many of the dead may be about one player: a town is thick with them, the fields and woods are not, and night brings more. */
export function countyInfectedCap(inTown: boolean, night: boolean): number {
  return (inTown ? 36 : 12) + (night ? 8 : 0);
}

/** How many come together: a town's crowds, a field's stragglers. */
export function countyGroup(inTown: boolean, random: () => number): number {
  return inTown ? 2 + Math.floor(random() * 4) : 1 + Math.floor(random() * 2);
}
