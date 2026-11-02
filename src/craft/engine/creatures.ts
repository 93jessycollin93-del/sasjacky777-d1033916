/**
 * Primal's creatures (after ARK: Survival Evolved and Ascended): who they
 * are, what they eat, how hard they are to knock out and tame, and what it
 * takes to ride them. Everything here is plain data and arithmetic — the
 * creatures' behaviour lives with the other mobs (dinoAi.ts) — so the
 * numbers can be tested and tuned in one place.
 *
 * Taming works as it does on the Island: wear a creature's torpor down with
 * tranquilizer arrows or a club until it drops, keep it under with
 * narcoberries or narcotics, and feed it what it likes — kibble best of all —
 * until it is yours. Every blow it takes while it sleeps costs a little of the
 * tame's effectiveness, and so a few of the bonus levels a good tame earns.
 */

export const DINO_KINDS = ["dodo", "dilo", "parasaur", "raptor", "trike", "stego", "rex", "bronto", "ptero", "gigantoraptor"] as const;
export type DinoKind = (typeof DINO_KINDS)[number];

export const isDino = (kind: string): kind is DinoKind => (DINO_KINDS as readonly string[]).includes(kind);

export type Diet = "herbivore" | "carnivore";
/** How a wild one takes to a player: ignores, flees, fights back, warns off, or hunts. */
export type Temper = "passive" | "skittish" | "neutral" | "territorial" | "aggressive";

export interface Creature {
  kind: DinoKind;
  name: string;
  diet: Diet;
  temper: Temper;
  /** Food points a level-1 tame needs, under Evolved's rules. */
  cost: number;
  /** Torpor a level-1 creature can take before it drops. */
  torpor: number;
  /** The saddle it must wear to be ridden; none, it cannot be. */
  saddle?: "saddle" | "heavy_saddle" | "flyer_saddle";
  /** Drawn this much larger than its model (big creatures are modelled small, as the hoglin is). */
  scale: number;
  /** Found only under Ascended's rules. */
  ascendedOnly?: boolean;
  /** What it drops, besides hide: raw meat per kill. */
  meat: [number, number];
  hide: [number, number];
  /** One line on what it is like, for /mode and the field guide. */
  note: string;
}

export const CREATURES: Record<DinoKind, Creature> = {
  dodo: { kind: "dodo", name: "Dodo", diet: "herbivore", temper: "passive", cost: 3, torpor: 12, scale: 1, meat: [1, 2], hide: [0, 1], note: "A plump, flightless bird. Harmless, slow, and lays eggs for kibble." },
  dilo: { kind: "dilo", name: "Dilophosaur", diet: "carnivore", temper: "aggressive", cost: 6, torpor: 18, scale: 1, meat: [1, 3], hide: [1, 2], note: "Small and quick; it spits venom that blinds." },
  parasaur: { kind: "parasaur", name: "Parasaur", diet: "herbivore", temper: "skittish", cost: 10, torpor: 40, saddle: "saddle", scale: 1.5, meat: [2, 4], hide: [2, 4], note: "A crested runner that bolts at the first sign of trouble. The first mount most survivors earn." },
  raptor: { kind: "raptor", name: "Raptor", diet: "carnivore", temper: "aggressive", cost: 12, torpor: 36, saddle: "saddle", scale: 1, meat: [2, 4], hide: [2, 3], note: "A pack hunter, fast and clever. Tamed, a swift mount that bites hard." },
  trike: { kind: "trike", name: "Triceratops", diet: "herbivore", temper: "territorial", cost: 16, torpor: 70, saddle: "saddle", scale: 2, meat: [3, 6], hide: [4, 7], note: "Minds its own business until you get too close — then the horns come down." },
  stego: { kind: "stego", name: "Stegosaurus", diet: "herbivore", temper: "territorial", cost: 22, torpor: 90, saddle: "heavy_saddle", scale: 2, meat: [4, 7], hide: [5, 8], note: "Plated and slow, with a tail that swings like a mace." },
  rex: { kind: "rex", name: "Tyrannosaurus", diet: "carnivore", temper: "aggressive", cost: 40, torpor: 150, saddle: "heavy_saddle", scale: 2.6, meat: [8, 14], hide: [8, 12], note: "The Island's king. Hunts anything that moves. Tame one and nothing hunts you." },
  bronto: { kind: "bronto", name: "Brontosaurus", diet: "herbivore", temper: "neutral", cost: 50, torpor: 240, saddle: "heavy_saddle", scale: 3.2, meat: [10, 16], hide: [10, 16], note: "A walking hill. Gentle, until struck — then its tail clears the ground around it." },
  ptero: { kind: "ptero", name: "Pteranodon", diet: "carnivore", temper: "skittish", cost: 12, torpor: 30, saddle: "flyer_saddle", scale: 1.2, meat: [1, 3], hide: [1, 3], note: "A glider over the coasts. Saddled, it gives you the sky." },
  gigantoraptor: { kind: "gigantoraptor", name: "Gigantoraptor", diet: "carnivore", temper: "neutral", cost: 24, torpor: 90, saddle: "heavy_saddle", scale: 1.8, ascendedOnly: true, meat: [5, 9], hide: [5, 8], note: "Ascended's great feathered raptor: towering, fast, and fierce once roused." },
};

// ---- levels -----------------------------------------------------------------------------------

/** Wild levels run 5 to 150 in fives, as on the Island's hardest official difficulty, the low ones commonest. */
export function wildLevel(random: () => number): number {
  return 5 * (1 + Math.floor(Math.pow(random(), 1.6) * 30));
}

/** Health and torpor grow with level: double at 150. */
export function levelScale(level: number): number {
  return 1 + Math.max(0, level - 1) / 150;
}

/** Bite grows more slowly: half again at 150. */
export function damageScale(level: number): number {
  return 1 + Math.max(0, level - 1) / 300;
}

export function maxTorpor(kind: DinoKind, level: number): number {
  return CREATURES[kind].torpor * levelScale(level);
}

// ---- torpor ----------------------------------------------------------------------------------

/** Torpor a tranquilizer arrow, a club, a bare fist, a narcoberry and a narcotic add. */
export const TORPOR = { tranq: 14, club: 7, fist: 1.5, narcoberry: 7.5, narcotic: 40 } as const;

/** How much of its full torpor a creature sheds each second: quickly while awake, slowly once down. */
export function torporDecay(unconscious: boolean): number {
  return unconscious ? 0.012 : 0.03;
}

// ---- taming -------------------------------------------------------------------------------------

const MEAT = ["raw_meat", "cooked_meat", "beef", "cooked_beef", "porkchop", "cooked_porkchop", "mutton", "cooked_mutton", "chicken", "cooked_chicken", "venison", "cooked_venison"];
const GREENS = ["mejoberry", "wheat", "apple", "carrot", "potato", "melon_slice", "bread"];

/** What a creature eats, favourite first (after kibble, which every one of them prefers). */
export function diet(kind: DinoKind): string[] {
  return ["kibble", ...(CREATURES[kind].diet === "carnivore" ? MEAT : GREENS)];
}

/** Food points an item is worth to a creature: kibble most, its favourite next, anything else it eats a little. */
export function foodPoints(kind: DinoKind, item: string): number {
  if (item === "kibble") return 6;
  const eats = diet(kind);
  const i = eats.indexOf(item);
  if (i < 0) return 0;
  return i === 1 ? 2 : 1;
}

/** Food points a tame of this level needs. Ascended's gentler rules take a little over half. */
export function tameCost(kind: DinoKind, level: number, ascended: boolean): number {
  return CREATURES[kind].cost * (1 + level / 100) * (ascended ? 0.6 : 1);
}

/** Levels a tame earns on top of its wild ones: up to half again, by how well it went. */
export function bonusLevels(level: number, effectiveness: number): number {
  return Math.floor(level * 0.5 * Math.max(0, Math.min(1, effectiveness)));
}

/** A blow to a sleeping creature costs this share of the tame's effectiveness. */
export const HIT_PENALTY = 0.05;

// ---- where they live -------------------------------------------------------------------------------

type Spawn = [DinoKind, number, number, number];

/** Creatures by biome: kind, weight, fewest and most in a group. */
const SPAWNS: Record<string, Spawn[]> = {
  "Plains": [["dodo", 8, 2, 4], ["parasaur", 6, 1, 3], ["trike", 4, 1, 2], ["raptor", 3, 2, 3], ["bronto", 1, 1, 1], ["gigantoraptor", 1, 1, 1]],
  "Flower Plains": [["dodo", 8, 2, 4], ["parasaur", 6, 1, 3], ["trike", 4, 1, 2]],
  "Forest": [["dodo", 5, 1, 3], ["dilo", 6, 1, 2], ["parasaur", 4, 1, 2], ["stego", 3, 1, 1], ["raptor", 2, 2, 3]],
  "Birch Forest": [["dodo", 5, 1, 3], ["dilo", 5, 1, 2], ["parasaur", 5, 1, 2]],
  "Dark Forest": [["dilo", 6, 1, 3], ["raptor", 4, 2, 3], ["rex", 1, 1, 1]],
  "Jungle": [["dilo", 8, 1, 3], ["stego", 4, 1, 2], ["bronto", 3, 1, 1], ["rex", 1, 1, 1]],
  "Savanna": [["trike", 5, 1, 3], ["raptor", 5, 2, 3], ["bronto", 3, 1, 2], ["rex", 2, 1, 1], ["gigantoraptor", 2, 1, 1]],
  "Desert": [["raptor", 4, 1, 2], ["rex", 1, 1, 1], ["ptero", 3, 1, 2]],
  "Badlands": [["ptero", 5, 1, 3], ["raptor", 3, 1, 2], ["gigantoraptor", 2, 1, 1]],
  "Beach": [["dodo", 6, 1, 3], ["ptero", 6, 1, 3], ["dilo", 2, 1, 2]],
  "Swamp": [["dilo", 6, 1, 3], ["stego", 2, 1, 1], ["bronto", 2, 1, 1]],
  "Meadow": [["parasaur", 6, 1, 3], ["trike", 4, 1, 2], ["ptero", 3, 1, 2]],
  "Windswept Hills": [["ptero", 6, 1, 3], ["rex", 1, 1, 1]],
  "Stony Peaks": [["ptero", 6, 1, 2]],
  "Taiga": [["parasaur", 4, 1, 2], ["raptor", 3, 2, 3], ["stego", 2, 1, 1]],
  "Snowy Plains": [["raptor", 3, 1, 2], ["parasaur", 3, 1, 2]],
  "Snowy Taiga": [["raptor", 3, 1, 2]],
};

/** A group to spawn in a biome, or null where nothing primal lives. */
export function pickCreatures(biome: string, random: () => number, ascended: boolean): { kind: DinoKind; count: number } | null {
  const list = (SPAWNS[biome] ?? []).filter(([k]) => ascended || !CREATURES[k].ascendedOnly);
  if (!list.length) return null;
  const total = list.reduce((t, [, w]) => t + w, 0);
  let roll = random() * total;
  for (const [kind, w, lo, hi] of list) {
    roll -= w;
    if (roll < 0) return { kind, count: lo + Math.floor(random() * (hi - lo + 1)) };
  }
  return null;
}

/** Every biome some creature lives in, for the test that keeps the names real. */
export function spawnBiomes(): string[] {
  return Object.keys(SPAWNS);
}
