/**
 * Critters: the monster-collecting modes' creatures (after Pokémon, and the
 * Minecraft mods Pixelmon and Cobblemon that brought it into block worlds).
 *
 * Every species, move, type and item here is this game's own: names, looks
 * and numbers alike. What is borrowed is the shape of the idea, which no one
 * owns — creatures of elemental types that are strong and weak against one
 * another, turn-based battles of four moves, levels that teach new moves and
 * bring evolutions, capture in a thrown orb, and a party of six.
 *
 * This file is plain data and arithmetic, so the numbers can be tested and
 * tuned in one place; battles are engine/battle.ts, and the creatures in the
 * world are Mob kind "critter" (engine/critterAi.ts).
 */
import type { Rng } from "./rng";

// ---- types ----------------------------------------------------------------------------------------

export const TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "earth", "air", "bug", "stone", "spirit", "dragon"] as const;
export type CritterType = (typeof TYPES)[number];

export const TYPE_NAMES: Record<CritterType, string> = {
  normal: "Normal", fire: "Fire", water: "Water", grass: "Grass", electric: "Electric", ice: "Ice",
  earth: "Earth", air: "Air", bug: "Bug", stone: "Stone", spirit: "Spirit", dragon: "Dragon",
};

/** Each type's colour, for the battle screen's badges and a move's sparks. */
export const TYPE_COLORS: Record<CritterType, string> = {
  normal: "#a8a878", fire: "#f08030", water: "#6890f0", grass: "#78c850", electric: "#f8d030", ice: "#98d8d8",
  earth: "#c8a050", air: "#a890f0", bug: "#a8b820", stone: "#b8a038", spirit: "#9860b8", dragon: "#7038f8",
};

/**
 * What each type does to each other type, where it is not the ordinary 1:
 * 2 is strong, 0.5 weak, 0 nothing at all. Elemental common sense — water
 * puts out fire, fire burns leaves, the ground swallows lightning — rather
 * than any one game's chart.
 */
const CHART: Partial<Record<CritterType, Partial<Record<CritterType, number>>>> = {
  normal: { stone: 0.5, spirit: 0 },
  fire: { grass: 2, ice: 2, bug: 2, fire: 0.5, water: 0.5, stone: 0.5, dragon: 0.5 },
  water: { fire: 2, earth: 2, stone: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  grass: { water: 2, earth: 2, stone: 2, fire: 0.5, grass: 0.5, air: 0.5, bug: 0.5, dragon: 0.5 },
  electric: { water: 2, air: 2, electric: 0.5, grass: 0.5, dragon: 0.5, earth: 0 },
  ice: { grass: 2, earth: 2, air: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5 },
  earth: { fire: 2, electric: 2, stone: 2, grass: 0.5, bug: 0.5, air: 0 },
  air: { grass: 2, bug: 2, electric: 0.5, stone: 0.5 },
  bug: { grass: 2, spirit: 2, fire: 0.5, air: 0.5 },
  stone: { fire: 2, ice: 2, air: 2, bug: 2, earth: 0.5 },
  spirit: { spirit: 2, normal: 0 },
  dragon: { dragon: 2 },
};

/** A move of one type against a critter of one or two: the product of each. */
export function effectiveness(move: CritterType, defender: readonly CritterType[]): number {
  return defender.reduce((m, t) => m * (CHART[move]?.[t] ?? 1), 1);
}

// ---- moves --------------------------------------------------------------------------------------------

export type Status = "burn" | "poison" | "paralysis" | "sleep";
export const STATUS_NAMES: Record<Status, string> = { burn: "burned", poison: "poisoned", paralysis: "paralysed", sleep: "asleep" };
export const STATUS_TAGS: Record<Status, string> = { burn: "BRN", poison: "PSN", paralysis: "PAR", sleep: "SLP" };

/** Battle stats a move can raise or lower, a stage at a time (-6 to +6). */
export type Stage = "atk" | "def" | "sp" | "spd" | "acc";

export interface MoveDef {
  id: string;
  name: string;
  type: CritterType;
  /** Physical moves pit attack against defence; special ones, special against special; status moves do no harm. */
  category: "physical" | "special" | "status";
  power: number;
  /** Out of 100; 0 never misses. */
  accuracy: number;
  pp: number;
  /** Goes first whatever the speeds (a quick jab); higher first. */
  priority?: number;
  /** A status it may inflict, and the chance out of 100 (status moves: 100). */
  status?: Status;
  chance?: number;
  /** Stages it moves on its user, and on its target (with `chance`, if set, else always). */
  self?: Partial<Record<Stage, number>>;
  foe?: Partial<Record<Stage, number>>;
  /** Heals its user by this share of their most health (status moves), or of the harm done (drain). */
  heal?: number;
  drain?: number;
  /** Harms its user by this share of the harm it did. */
  recoil?: number;
  /** Strikes true more often than most. */
  highCrit?: boolean;
}

const mv = (id: string, name: string, type: CritterType, category: MoveDef["category"], power: number, accuracy: number, pp: number, extra: Partial<MoveDef> = {}): MoveDef =>
  ({ id, name, type, category, power, accuracy, pp, ...extra });

const MOVE_LIST: MoveDef[] = [
  // normal
  mv("tackle", "Tackle", "normal", "physical", 40, 100, 35),
  mv("scratch", "Scratch", "normal", "physical", 40, 100, 35),
  mv("quick_strike", "Quick Strike", "normal", "physical", 40, 100, 30, { priority: 1 }),
  mv("headbutt", "Headbutt", "normal", "physical", 70, 100, 15),
  mv("body_slam", "Body Slam", "normal", "physical", 85, 100, 15, { status: "paralysis", chance: 30 }),
  mv("rampage", "Rampage", "normal", "physical", 120, 85, 5, { recoil: 0.25 }),
  mv("starfall", "Starfall", "normal", "special", 60, 0, 20),
  mv("growl", "Growl", "normal", "status", 0, 100, 40, { foe: { atk: -1 } }),
  mv("leer", "Leer", "normal", "status", 0, 100, 30, { foe: { def: -1 } }),
  mv("brace", "Brace", "normal", "status", 0, 0, 20, { self: { atk: 1, def: 1 } }),
  mv("mend", "Mend", "normal", "status", 0, 0, 10, { heal: 0.5 }),
  // fire
  mv("cinders", "Cinders", "fire", "special", 40, 100, 25, { status: "burn", chance: 10 }),
  mv("hot_bite", "Hot Bite", "fire", "physical", 65, 95, 15, { status: "burn", chance: 10 }),
  mv("flame_jet", "Flame Jet", "fire", "special", 90, 100, 15, { status: "burn", chance: 10 }),
  mv("inferno", "Inferno", "fire", "special", 110, 85, 5, { status: "burn", chance: 30 }),
  mv("scorch", "Scorch", "fire", "status", 0, 85, 15, { status: "burn", chance: 100 }),
  mv("flare_rush", "Flare Rush", "fire", "physical", 120, 100, 15, { recoil: 0.33, status: "burn", chance: 10 }),
  // water
  mv("bubbles", "Bubbles", "water", "special", 40, 100, 30, { foe: { spd: -1 }, chance: 10 }),
  mv("water_jet", "Water Jet", "water", "physical", 40, 100, 20, { priority: 1 }),
  mv("wave_pulse", "Wave Pulse", "water", "special", 60, 100, 20),
  mv("tidal_wave", "Tidal Wave", "water", "special", 90, 100, 15),
  mv("torrent", "Torrent", "water", "special", 110, 80, 5),
  mv("shell_up", "Shell Up", "water", "status", 0, 0, 40, { self: { def: 1 } }),
  // grass
  mv("vine_lash", "Vine Lash", "grass", "physical", 45, 100, 25),
  mv("leaf_cutter", "Leaf Cutter", "grass", "special", 55, 95, 25, { highCrit: true }),
  mv("sap_drain", "Sap Drain", "grass", "special", 75, 100, 10, { drain: 0.5 }),
  mv("drowsy_pollen", "Drowsy Pollen", "grass", "status", 0, 75, 15, { status: "sleep", chance: 100 }),
  mv("petal_storm", "Petal Storm", "grass", "special", 100, 95, 10),
  mv("seed_barrage", "Seed Barrage", "grass", "physical", 80, 100, 15),
  mv("bloom", "Bloom", "grass", "status", 0, 0, 20, { self: { atk: 1, sp: 1 } }),
  // electric
  mv("jolt", "Jolt", "electric", "special", 40, 100, 30, { status: "paralysis", chance: 10 }),
  mv("static_tackle", "Static Tackle", "electric", "physical", 65, 100, 20, { status: "paralysis", chance: 30 }),
  mv("lightning", "Lightning", "electric", "special", 90, 100, 15, { status: "paralysis", chance: 10 }),
  mv("static_field", "Static Field", "electric", "status", 0, 90, 20, { status: "paralysis", chance: 100 }),
  mv("live_wire", "Live Wire", "electric", "physical", 90, 100, 15, { recoil: 0.25 }),
  // ice
  mv("chill", "Chill", "ice", "special", 40, 100, 25),
  mv("ice_dart", "Ice Dart", "ice", "physical", 40, 100, 30, { priority: 1 }),
  mv("frostbite", "Frostbite", "ice", "physical", 65, 95, 15),
  mv("frost_beam", "Frost Beam", "ice", "special", 90, 100, 10),
  mv("blizzard", "Blizzard", "ice", "special", 110, 70, 5),
  // earth
  mv("mud_splash", "Mud Splash", "earth", "special", 20, 100, 10, { foe: { acc: -1 } }),
  mv("sand_toss", "Sand Toss", "earth", "status", 0, 100, 15, { foe: { acc: -1 } }),
  mv("tremor", "Tremor", "earth", "physical", 60, 100, 20, { foe: { spd: -1 } }),
  mv("mud_ball", "Mud Ball", "earth", "special", 65, 85, 10, { foe: { acc: -1 }, chance: 30 }),
  mv("quake", "Quake", "earth", "physical", 100, 100, 10),
  // air
  mv("gust", "Gust", "air", "special", 40, 100, 35),
  mv("peck", "Peck", "air", "physical", 35, 100, 35),
  mv("wing_strike", "Wing Strike", "air", "physical", 60, 0, 20),
  mv("air_blade", "Air Blade", "air", "special", 75, 95, 15),
  mv("sky_dive", "Sky Dive", "air", "physical", 120, 100, 15, { recoil: 0.33 }),
  mv("quicken", "Quicken", "air", "status", 0, 0, 30, { self: { spd: 2 } }),
  // bug
  mv("mandible", "Mandible", "bug", "physical", 60, 100, 20),
  mv("silk_snare", "Silk Snare", "bug", "status", 0, 95, 40, { foe: { spd: -2 } }),
  mv("venom_sting", "Venom Sting", "bug", "physical", 15, 100, 35, { status: "poison", chance: 30 }),
  mv("glow_beam", "Glow Beam", "bug", "special", 75, 100, 15),
  mv("swarm_rush", "Swarm Rush", "bug", "physical", 80, 100, 15),
  mv("stun_dust", "Stun Dust", "bug", "status", 0, 75, 30, { status: "paralysis", chance: 100 }),
  // stone
  mv("pebble_toss", "Pebble Toss", "stone", "physical", 50, 90, 15),
  mv("toughen", "Toughen", "stone", "status", 0, 0, 30, { self: { def: 1 } }),
  mv("rockfall", "Rockfall", "stone", "physical", 75, 90, 10),
  mv("shard_strike", "Shard Strike", "stone", "physical", 100, 80, 5, { highCrit: true }),
  mv("iron_shell", "Iron Shell", "stone", "status", 0, 0, 15, { self: { def: 2 } }),
  // spirit
  mv("spook", "Spook", "spirit", "physical", 30, 100, 30, { status: "paralysis", chance: 30 }),
  mv("shadow_orb", "Shadow Orb", "spirit", "special", 80, 100, 15),
  mv("lull", "Lull", "spirit", "status", 0, 60, 20, { status: "sleep", chance: 100 }),
  mv("mind_blast", "Mind Blast", "spirit", "special", 90, 100, 10),
  mv("focus", "Focus", "spirit", "status", 0, 0, 20, { self: { sp: 2 } }),
  // dragon
  mv("drake_breath", "Drake Breath", "dragon", "special", 60, 100, 20, { status: "paralysis", chance: 30 }),
  mv("drake_claw", "Drake Claw", "dragon", "physical", 80, 100, 15),
  mv("drake_pulse", "Drake Pulse", "dragon", "special", 85, 100, 10),
  mv("war_dance", "War Dance", "dragon", "status", 0, 0, 20, { self: { atk: 1, spd: 1 } }),
  mv("dragon_fury", "Dragon Fury", "dragon", "physical", 120, 90, 10),
  // The internet's own: the meme critters' moves (and anyone else's who learns them).
  mv("bonk", "Bonk", "normal", "physical", 80, 100, 15, { status: "paralysis", chance: 10 }),
  mv("yeet", "Yeet", "normal", "physical", 95, 85, 10),
  mv("zoomies", "Zoomies", "normal", "status", 0, 0, 20, { self: { spd: 2 } }),
  mv("skill_issue", "Skill Issue", "normal", "status", 0, 100, 20, { foe: { def: -2 } }),
  mv("chonk_slam", "Chonk Slam", "normal", "physical", 110, 90, 10, { recoil: 0.25 }),
  mv("cope", "Cope", "normal", "status", 0, 0, 10, { heal: 0.25, self: { def: 1 } }),
  mv("ratio", "Ratio", "spirit", "status", 0, 100, 15, { foe: { atk: -1, sp: -1 } }),
  mv("vibe_check", "Vibe Check", "spirit", "special", 70, 100, 15, { status: "sleep", chance: 15 }),
  mv("emotional_damage", "Emotional Damage", "spirit", "special", 105, 90, 5),
  mv("sus_stare", "Sus Stare", "spirit", "status", 0, 80, 15, { status: "paralysis", chance: 100 }),
  mv("to_the_moon", "To the Moon", "air", "special", 95, 95, 10),
  mv("diamond_hands", "Diamond Hands", "stone", "status", 0, 0, 15, { self: { def: 1, sp: 1 } }),
  mv("rug_pull", "Rug Pull", "earth", "physical", 70, 100, 15, { foe: { spd: -1 } }),
  mv("rickroll", "Rickroll", "stone", "physical", 90, 90, 10, { status: "paralysis", chance: 20 }),
  mv("chill_pill", "Chill Pill", "ice", "special", 60, 100, 15, { status: "sleep", chance: 20 }),
];

export const MOVES: Record<string, MoveDef> = Object.fromEntries(MOVE_LIST.map((m) => [m.id, m]));

// ---- species ------------------------------------------------------------------------------------------

export interface Stats { hp: number; atk: number; def: number; sp: number; spd: number }
export const STAT_KEYS = ["hp", "atk", "def", "sp", "spd"] as const;

export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export interface SpeciesDef {
  id: string;
  name: string;
  types: CritterType[];
  base: Stats;
  /** 3 (a legend) to 255 (anything can catch one). */
  catchRate: number;
  /** Experience a win over one at level 7 earns, before trainer bonuses. */
  xpYield: number;
  /** Moves it learns, by level; at level 1, what it hatches knowing. */
  learnset: [number, string][];
  /** What it becomes: at a level, or (`trade`) when it changes hands. */
  evolves?: { to: string; level: number; trade?: boolean };
  /** Its box in the world, in blocks; drawn from render/critterModels.ts at `scale`. */
  width: number;
  height: number;
  scale: number;
  /** How it gets about: walking, hovering in the air, or at home in water (it swims and wades). */
  moves: "walk" | "fly" | "swim";
  /** Big enough to carry its trainer, and how. */
  ride?: "walk" | "fly";
  rarity: Rarity;
  /** Where it lives in the wilds: biome names and weights. */
  habitat: [string, number][];
  /** One of the three a new trainer chooses between. */
  starter?: boolean;
  note: string;
}

type SpeciesSpec = Omit<SpeciesDef, "id">;

// Learnsets are shared down an evolution line: a critter keeps learning its line's moves as it grows.
const EMBER_LINE: [number, string][] = [[1, "scratch"], [1, "growl"], [7, "cinders"], [12, "quick_strike"], [17, "hot_bite"], [22, "brace"], [28, "flame_jet"], [36, "flare_rush"], [44, "inferno"]];
const AXO_LINE: [number, string][] = [[1, "tackle"], [1, "growl"], [6, "bubbles"], [10, "water_jet"], [14, "wave_pulse"], [20, "shell_up"], [25, "tidal_wave"], [33, "drake_breath"], [42, "torrent"], [48, "drake_pulse"]];
const SPROUT_LINE: [number, string][] = [[1, "tackle"], [1, "growl"], [7, "vine_lash"], [12, "drowsy_pollen"], [16, "leaf_cutter"], [21, "bloom"], [26, "sap_drain"], [32, "seed_barrage"], [38, "tremor"], [44, "petal_storm"], [50, "quake"]];
const CHIRP_LINE: [number, string][] = [[1, "peck"], [1, "growl"], [5, "gust"], [9, "quick_strike"], [13, "wing_strike"], [19, "quicken"], [25, "air_blade"], [33, "sky_dive"]];
const NIBBIT_LINE: [number, string][] = [[1, "tackle"], [1, "leer"], [4, "quick_strike"], [10, "scratch"], [13, "headbutt"], [16, "brace"], [20, "body_slam"], [29, "rampage"]];
const WRIGGLE_LINE: [number, string][] = [[1, "tackle"], [1, "silk_snare"], [5, "venom_sting"], [7, "toughen"], [10, "gust"], [12, "stun_dust"], [16, "glow_beam"], [21, "drowsy_pollen"], [26, "air_blade"], [32, "swarm_rush"]];
const SPARK_LINE: [number, string][] = [[1, "tackle"], [1, "growl"], [5, "jolt"], [9, "static_field"], [13, "quick_strike"], [18, "static_tackle"], [23, "quicken"], [30, "lightning"], [38, "live_wire"]];
const PEBBLE_LINE: [number, string][] = [[1, "tackle"], [1, "toughen"], [6, "pebble_toss"], [11, "mud_splash"], [16, "tremor"], [21, "rockfall"], [29, "iron_shell"], [36, "quake"], [43, "shard_strike"]];
const FROST_LINE: [number, string][] = [[1, "scratch"], [1, "chill"], [6, "ice_dart"], [12, "quick_strike"], [17, "frostbite"], [24, "quicken"], [30, "frost_beam"], [40, "blizzard"]];
const WISP_LINE: [number, string][] = [[1, "spook"], [1, "leer"], [6, "lull"], [11, "cinders"], [17, "shadow_orb"], [25, "focus"], [30, "flame_jet"], [38, "mind_blast"]];
const FIN_LINE: [number, string][] = [[1, "tackle"], [1, "bubbles"], [6, "water_jet"], [12, "headbutt"], [18, "wave_pulse"], [24, "brace"], [30, "frostbite"], [36, "rampage"]];
const SCALE_LINE: [number, string][] = [[1, "scratch"], [1, "leer"], [7, "drake_breath"], [14, "headbutt"], [20, "drake_claw"], [28, "war_dance"], [34, "wing_strike"], [40, "drake_pulse"], [48, "dragon_fury"], [55, "sky_dive"]];
const DOGE_LINE: [number, string][] = [[1, "tackle"], [1, "growl"], [6, "spook"], [11, "quick_strike"], [16, "vibe_check"], [21, "bonk"], [27, "zoomies"], [33, "mind_blast"], [40, "emotional_damage"]];
const CHONK_LINE: [number, string][] = [[1, "tackle"], [1, "growl"], [8, "brace"], [12, "headbutt"], [18, "cope"], [24, "body_slam"], [30, "chonk_slam"], [38, "mend"], [44, "rampage"]];
const FROG_LINE: [number, string][] = [[1, "bubbles"], [1, "growl"], [6, "vine_lash"], [11, "water_jet"], [16, "vibe_check"], [22, "sap_drain"], [28, "tidal_wave"], [35, "petal_storm"]];
const STONK_LINE: [number, string][] = [[1, "bubbles"], [1, "leer"], [5, "water_jet"], [10, "diamond_hands"], [15, "wave_pulse"], [21, "quicken"], [27, "to_the_moon"], [35, "torrent"]];
const SUS_LINE: [number, string][] = [[1, "spook"], [1, "leer"], [6, "sus_stare"], [12, "venom_sting"], [17, "shadow_orb"], [23, "silk_snare"], [29, "ratio"], [36, "emotional_damage"]];
const BONK_LINE: [number, string][] = [[1, "peck"], [1, "leer"], [5, "gust"], [10, "quick_strike"], [15, "wing_strike"], [20, "bonk"], [26, "air_blade"], [32, "yeet"], [38, "sky_dive"]];
const RICK_LINE: [number, string][] = [[1, "tackle"], [1, "toughen"], [6, "pebble_toss"], [12, "diamond_hands"], [17, "rug_pull"], [23, "rockfall"], [29, "rickroll"], [37, "quake"], [45, "shard_strike"]];
const COPE_LINE: [number, string][] = [[1, "spook"], [1, "chill"], [7, "lull"], [12, "cope"], [18, "chill_pill"], [24, "ratio"], [30, "shadow_orb"], [38, "frost_beam"], [46, "emotional_damage"]];
const BOG_LINE: [number, string][] = [[1, "tackle"], [1, "mud_splash"], [6, "sand_toss"], [11, "tremor"], [17, "headbutt"], [23, "mud_ball"], [30, "wave_pulse"], [36, "quake"], [44, "rampage"]];

const SPECIES_SPECS: Record<string, SpeciesSpec> = {
  // The three starters, each with three stages.
  emberkit: {
    name: "Emberkit", types: ["fire"], base: { hp: 39, atk: 52, def: 43, sp: 60, spd: 65 }, catchRate: 45, xpYield: 62, learnset: EMBER_LINE,
    evolves: { to: "cinderlynx", level: 16 }, width: 0.6, height: 0.7, scale: 0.8, moves: "walk", rarity: "rare", habitat: [["Savanna", 1], ["Badlands", 1]], starter: true,
    note: "A kitten whose tail-tip smoulders like a coal. It sleeps curled round it for warmth.",
  },
  cinderlynx: {
    name: "Cinderlynx", types: ["fire"], base: { hp: 58, atk: 64, def: 58, sp: 75, spd: 80 }, catchRate: 45, xpYield: 142, learnset: EMBER_LINE,
    evolves: { to: "pyrolion", level: 36 }, width: 0.8, height: 1.0, scale: 1.05, moves: "walk", rarity: "rare", habitat: [],
    note: "Tufted ears that flicker with flame. It stalks through dry grass without a sound, then pounces.",
  },
  pyrolion: {
    name: "Pyrolion", types: ["fire", "normal"], base: { hp: 78, atk: 104, def: 78, sp: 100, spd: 100 }, catchRate: 45, xpYield: 240, learnset: EMBER_LINE,
    width: 1.2, height: 1.5, scale: 1.5, moves: "walk", ride: "walk", rarity: "rare", habitat: [],
    note: "Its mane is a crown of fire. Its roar carries across a whole plain, and dry brush catches where it walks.",
  },
  axolittle: {
    name: "Axolittle", types: ["water"], base: { hp: 50, atk: 48, def: 60, sp: 50, spd: 43 }, catchRate: 45, xpYield: 63, learnset: AXO_LINE,
    evolves: { to: "axoloch", level: 16 }, width: 0.6, height: 0.5, scale: 0.8, moves: "swim", rarity: "rare", habitat: [["Swamp", 1], ["River", 1]], starter: true,
    note: "Feathery gills and a permanent smile. It regrows a lost tail in a day.",
  },
  axoloch: {
    name: "Axoloch", types: ["water"], base: { hp: 65, atk: 63, def: 80, sp: 65, spd: 58 }, catchRate: 45, xpYield: 142, learnset: AXO_LINE,
    evolves: { to: "tidalotl", level: 36 }, width: 0.9, height: 0.8, scale: 1.1, moves: "swim", rarity: "rare", habitat: [],
    note: "It hides in the reeds with only its gills showing, and waits for the current to bring it dinner.",
  },
  tidalotl: {
    name: "Tidalotl", types: ["water", "dragon"], base: { hp: 85, atk: 85, def: 100, sp: 90, spd: 78 }, catchRate: 45, xpYield: 239, learnset: AXO_LINE,
    width: 1.3, height: 1.3, scale: 1.55, moves: "swim", ride: "walk", rarity: "rare", habitat: [],
    note: "The old stories say a lake's flood is one of these turning over in its sleep.",
  },
  sproutling: {
    name: "Sproutling", types: ["grass"], base: { hp: 45, atk: 49, def: 49, sp: 65, spd: 45 }, catchRate: 45, xpYield: 64, learnset: SPROUT_LINE,
    evolves: { to: "fernfawn", level: 16 }, width: 0.6, height: 0.8, scale: 0.8, moves: "walk", rarity: "rare", habitat: [["Forest", 1], ["Meadow", 1]], starter: true,
    note: "A fawn with a seedling for each antler. It naps in sunbeams and wakes a little taller.",
  },
  fernfawn: {
    name: "Fernfawn", types: ["grass"], base: { hp: 60, atk: 62, def: 63, sp: 80, spd: 60 }, catchRate: 45, xpYield: 142, learnset: SPROUT_LINE,
    evolves: { to: "grovestag", level: 32 }, width: 0.8, height: 1.2, scale: 1.1, moves: "walk", rarity: "rare", habitat: [],
    note: "Its antlers have unfurled into fronds. Wherever it rests, the grass grows back thicker.",
  },
  grovestag: {
    name: "Grovestag", types: ["grass", "earth"], base: { hp: 80, atk: 100, def: 83, sp: 100, spd: 80 }, catchRate: 45, xpYield: 236, learnset: SPROUT_LINE,
    width: 1.3, height: 1.8, scale: 1.5, moves: "walk", ride: "walk", rarity: "rare", habitat: [],
    note: "Birds nest in the living branches of its antlers. It guards its forest like a king.",
  },
  // The commons of the roads and fields.
  chirplet: {
    name: "Chirplet", types: ["normal", "air"], base: { hp: 40, atk: 45, def: 40, sp: 35, spd: 56 }, catchRate: 255, xpYield: 50, learnset: CHIRP_LINE,
    evolves: { to: "galewing", level: 18 }, width: 0.4, height: 0.5, scale: 0.7, moves: "walk", rarity: "common",
    habitat: [["Plains", 10], ["Forest", 8], ["Birch Forest", 8], ["Meadow", 8], ["Flower Plains", 8], ["Savanna", 5], ["Taiga", 5]],
    note: "It hops along the road ahead of travellers, chirping, and never lets them catch up.",
  },
  galewing: {
    name: "Galewing", types: ["normal", "air"], base: { hp: 63, atk: 60, def: 55, sp: 50, spd: 71 }, catchRate: 120, xpYield: 122, learnset: CHIRP_LINE,
    evolves: { to: "stormhawk", level: 36 }, width: 0.6, height: 0.8, scale: 0.95, moves: "fly", rarity: "uncommon",
    habitat: [["Windswept Hills", 6], ["Meadow", 3], ["Plains", 2]],
    note: "It rides the updraft off a hillside for hours without beating its wings once.",
  },
  stormhawk: {
    name: "Stormhawk", types: ["normal", "air"], base: { hp: 83, atk: 90, def: 75, sp: 70, spd: 101 }, catchRate: 45, xpYield: 216, learnset: CHIRP_LINE,
    width: 1.0, height: 1.2, scale: 1.4, moves: "fly", ride: "fly", rarity: "rare", habitat: [["Stony Peaks", 2], ["Windswept Hills", 1]],
    note: "It dives out of thunderheads at the speed of the rain. A trainer on its back sees the whole region.",
  },
  nibbit: {
    name: "Nibbit", types: ["normal"], base: { hp: 30, atk: 56, def: 35, sp: 25, spd: 72 }, catchRate: 255, xpYield: 51, learnset: NIBBIT_LINE,
    evolves: { to: "gnawbit", level: 20 }, width: 0.4, height: 0.4, scale: 0.65, moves: "walk", rarity: "common",
    habitat: [["Plains", 10], ["Savanna", 6], ["Forest", 5], ["Desert", 4], ["Taiga", 4], ["Flower Plains", 6]],
    note: "Its front teeth never stop growing, so it never stops chewing: fences, boots, carts.",
  },
  gnawbit: {
    name: "Gnawbit", types: ["normal"], base: { hp: 55, atk: 81, def: 60, sp: 50, spd: 97 }, catchRate: 127, xpYield: 145, learnset: NIBBIT_LINE,
    width: 0.6, height: 0.6, scale: 0.9, moves: "walk", rarity: "uncommon", habitat: [["Savanna", 3], ["Plains", 2]],
    note: "It gnaws a burrow through a hillside in a night, and the whole warren moves in by morning.",
  },
  wrigglet: {
    name: "Wrigglet", types: ["bug"], base: { hp: 45, atk: 30, def: 35, sp: 20, spd: 45 }, catchRate: 255, xpYield: 39, learnset: WRIGGLE_LINE,
    evolves: { to: "cocoonix", level: 7 }, width: 0.4, height: 0.3, scale: 0.6, moves: "walk", rarity: "common",
    habitat: [["Forest", 10], ["Birch Forest", 10], ["Jungle", 8], ["Dark Forest", 6], ["Swamp", 4]],
    note: "A plump grub that eats its own weight in leaves every day, and is eaten by nearly everything.",
  },
  cocoonix: {
    name: "Cocoonix", types: ["bug"], base: { hp: 50, atk: 20, def: 55, sp: 25, spd: 30 }, catchRate: 120, xpYield: 72, learnset: WRIGGLE_LINE,
    evolves: { to: "lumoth", level: 10 }, width: 0.4, height: 0.6, scale: 0.7, moves: "walk", rarity: "uncommon", habitat: [["Forest", 3], ["Jungle", 3]],
    note: "Silk wound tight round a sleeper. Tap it and it hardens; wait, and it hatches.",
  },
  lumoth: {
    name: "Lumoth", types: ["bug", "air"], base: { hp: 60, atk: 45, def: 50, sp: 90, spd: 70 }, catchRate: 45, xpYield: 178, learnset: WRIGGLE_LINE,
    width: 0.7, height: 0.6, scale: 1.0, moves: "fly", rarity: "uncommon", habitat: [["Dark Forest", 3], ["Jungle", 2], ["Swamp", 2]],
    note: "Its wings glow softly at night. Lost travellers follow it, which is how it leads them home.",
  },
  sparkhog: {
    name: "Sparkhog", types: ["electric"], base: { hp: 35, atk: 55, def: 40, sp: 50, spd: 90 }, catchRate: 190, xpYield: 82, learnset: SPARK_LINE,
    evolves: { to: "stormhog", level: 26 }, width: 0.5, height: 0.45, scale: 0.7, moves: "walk", rarity: "uncommon",
    habitat: [["Meadow", 4], ["Plains", 2], ["Windswept Hills", 3], ["Savanna", 2]],
    note: "Its quills crackle when it is frightened. Stroke it the wrong way and your hair stands on end.",
  },
  stormhog: {
    name: "Stormhog", types: ["electric"], base: { hp: 60, atk: 90, def: 55, sp: 90, spd: 110 }, catchRate: 75, xpYield: 172, learnset: SPARK_LINE,
    width: 0.8, height: 0.7, scale: 1.1, moves: "walk", rarity: "rare", habitat: [["Windswept Hills", 1]],
    note: "It rolls into a ball of lightning and bowls through anything in its way.",
  },
  pebbling: {
    name: "Pebbling", types: ["stone", "earth"], base: { hp: 40, atk: 80, def: 100, sp: 30, spd: 20 }, catchRate: 255, xpYield: 60, learnset: PEBBLE_LINE,
    evolves: { to: "bouldron", level: 25 }, width: 0.5, height: 0.6, scale: 0.75, moves: "walk", rarity: "common",
    habitat: [["Stony Peaks", 10], ["Windswept Hills", 8], ["Badlands", 6], ["Desert", 3], ["Snowy Peaks", 3]],
    note: "Mistaken for a rock until it gets up and walks off. Hikers sit on it by accident.",
  },
  bouldron: {
    name: "Bouldron", types: ["stone", "earth"], base: { hp: 80, atk: 110, def: 130, sp: 55, spd: 45 }, catchRate: 90, xpYield: 177, learnset: PEBBLE_LINE,
    width: 1.1, height: 1.5, scale: 1.4, moves: "walk", ride: "walk", rarity: "uncommon", habitat: [["Stony Peaks", 2], ["Badlands", 1]],
    note: "A walking landslide. It sheds its outer stones each spring and grows a harder coat.",
  },
  frostpaw: {
    name: "Frostpaw", types: ["ice"], base: { hp: 50, atk: 50, def: 45, sp: 65, spd: 60 }, catchRate: 120, xpYield: 67, learnset: FROST_LINE,
    evolves: { to: "blizzfang", level: 30 }, width: 0.6, height: 0.6, scale: 0.8, moves: "walk", rarity: "uncommon",
    habitat: [["Snowy Plains", 8], ["Snowy Taiga", 8], ["Snowy Peaks", 5], ["Frozen River", 3]],
    note: "A white fox cub. Its breath frosts the air even in summer, and snow falls wherever it naps.",
  },
  blizzfang: {
    name: "Blizzfang", types: ["ice"], base: { hp: 75, atk: 95, def: 70, sp: 95, spd: 85 }, catchRate: 60, xpYield: 180, learnset: FROST_LINE,
    width: 1.0, height: 1.2, scale: 1.35, moves: "walk", ride: "walk", rarity: "rare", habitat: [["Snowy Peaks", 1]],
    note: "It howls up a whiteout, then hunts inside it where nothing else can see.",
  },
  wisplet: {
    name: "Wisplet", types: ["spirit"], base: { hp: 30, atk: 35, def: 30, sp: 100, spd: 80 }, catchRate: 120, xpYield: 62, learnset: WISP_LINE,
    evolves: { to: "lanternwisp", level: 25 }, width: 0.5, height: 0.6, scale: 0.75, moves: "fly", rarity: "uncommon",
    habitat: [["Dark Forest", 6], ["Swamp", 5], ["Taiga", 2]],
    note: "A cold little flame that drifts over marshes at night. Nobody knows what it is the ghost of.",
  },
  lanternwisp: {
    name: "Lanternwisp", types: ["spirit", "fire"], base: { hp: 60, atk: 55, def: 60, sp: 115, spd: 95 }, catchRate: 45, xpYield: 175, learnset: WISP_LINE,
    width: 0.6, height: 1.0, scale: 1.0, moves: "fly", rarity: "rare", habitat: [["Dark Forest", 1]],
    note: "It carries its flame inside an old lantern it found. Some say it is looking for its owner.",
  },
  finnip: {
    name: "Finnip", types: ["water"], base: { hp: 45, atk: 67, def: 60, sp: 35, spd: 63 }, catchRate: 225, xpYield: 64, learnset: FIN_LINE,
    evolves: { to: "rippajaw", level: 25 }, width: 0.5, height: 0.4, scale: 0.7, moves: "swim", rarity: "common",
    habitat: [["River", 10], ["Beach", 8], ["Swamp", 4], ["Ocean", 6]],
    note: "It flops ashore to sun itself and flops back when anything comes near. It bites.",
  },
  rippajaw: {
    name: "Rippajaw", types: ["water"], base: { hp: 80, atk: 112, def: 80, sp: 60, spd: 81 }, catchRate: 60, xpYield: 170, learnset: FIN_LINE,
    width: 1.1, height: 0.8, scale: 1.4, moves: "swim", ride: "walk", rarity: "uncommon", habitat: [["Ocean", 2], ["Beach", 1]],
    note: "Rows of teeth that it sheds and regrows all its life. Fishermen find them on the beach like shells.",
  },
  scalekin: {
    name: "Scalekin", types: ["dragon"], base: { hp: 41, atk: 64, def: 45, sp: 50, spd: 50 }, catchRate: 45, xpYield: 60, learnset: SCALE_LINE,
    evolves: { to: "drakeling", level: 30 }, width: 0.5, height: 0.6, scale: 0.75, moves: "walk", rarity: "rare",
    habitat: [["Stony Peaks", 1], ["Badlands", 1], ["Jungle", 1]],
    note: "It hatches from a stone-grey egg deep in the mountains and dreams of flying.",
  },
  drakeling: {
    name: "Drakeling", types: ["dragon"], base: { hp: 61, atk: 84, def: 65, sp: 70, spd: 70 }, catchRate: 45, xpYield: 147, learnset: SCALE_LINE,
    evolves: { to: "wyrmlord", level: 55 }, width: 0.9, height: 1.1, scale: 1.2, moves: "walk", rarity: "rare", habitat: [],
    note: "Its wings are still too small to lift it, and it practises by leaping off ledges. Often.",
  },
  wyrmlord: {
    name: "Wyrmlord", types: ["dragon", "air"], base: { hp: 91, atk: 134, def: 95, sp: 100, spd: 80 }, catchRate: 45, xpYield: 270, learnset: SCALE_LINE,
    width: 1.6, height: 1.9, scale: 1.9, moves: "fly", ride: "fly", rarity: "rare", habitat: [],
    note: "It circles the whole region in a day. Where its shadow passes, other critters hide.",
  },
  bogpup: {
    name: "Bogpup", types: ["earth"], base: { hp: 55, atk: 70, def: 55, sp: 40, spd: 40 }, catchRate: 190, xpYield: 66, learnset: BOG_LINE,
    evolves: { to: "mireback", level: 28 }, width: 0.6, height: 0.5, scale: 0.8, moves: "walk", rarity: "common",
    habitat: [["Swamp", 8], ["River", 4], ["Plains", 3], ["Savanna", 3]],
    note: "It rolls in mud to keep cool and shakes it off on whoever comes to say hello.",
  },
  mireback: {
    name: "Mireback", types: ["earth", "water"], base: { hp: 95, atk: 95, def: 90, sp: 65, spd: 35 }, catchRate: 75, xpYield: 172, learnset: BOG_LINE,
    width: 1.3, height: 1.1, scale: 1.45, moves: "walk", ride: "walk", rarity: "uncommon", habitat: [["Swamp", 2]],
    note: "A broad, patient beast that wades rivers with a family of smaller critters riding on its back.",
  },
  jellispark: {
    name: "Jellispark", types: ["water", "electric"], base: { hp: 55, atk: 40, def: 50, sp: 80, spd: 75 }, catchRate: 150, xpYield: 110, learnset: [
      [1, "bubbles"], [1, "jolt"], [8, "static_field"], [14, "wave_pulse"], [24, "lightning"], [32, "tidal_wave"], [40, "mend"],
    ],
    width: 0.6, height: 0.8, scale: 0.9, moves: "fly", rarity: "uncommon", habitat: [["Beach", 4], ["Ocean", 4], ["Swamp", 2]],
    note: "It drifts over the shallows at dusk, flickering. Waders who brush its tendrils go numb for an hour.",
  },
  mossnail: {
    name: "Mossnail", types: ["grass", "bug"], base: { hp: 60, atk: 50, def: 80, sp: 60, spd: 20 }, catchRate: 190, xpYield: 96, learnset: [
      [1, "tackle"], [1, "toughen"], [6, "vine_lash"], [12, "mandible"], [18, "sap_drain"], [25, "iron_shell"], [32, "seed_barrage"], [40, "mend"],
    ],
    width: 0.6, height: 0.5, scale: 0.85, moves: "walk", rarity: "common", habitat: [["Jungle", 6], ["Swamp", 5], ["Forest", 3], ["Dark Forest", 4]],
    note: "A whole little garden grows on its shell. It is in no hurry to get anywhere, ever.",
  },
  cinderam: {
    name: "Cinderam", types: ["fire", "earth"], base: { hp: 70, atk: 85, def: 70, sp: 60, spd: 55 }, catchRate: 90, xpYield: 150, learnset: [
      [1, "tackle"], [1, "growl"], [8, "cinders"], [14, "headbutt"], [20, "tremor"], [26, "hot_bite"], [33, "quake"], [40, "flare_rush"],
    ],
    width: 1.0, height: 1.1, scale: 1.25, moves: "walk", ride: "walk", rarity: "uncommon", habitat: [["Badlands", 6], ["Desert", 3], ["Savanna", 2]],
    note: "Its horns stay hot enough to cook on. Herders in the badlands follow the flock for warmth at night.",
  },
  // The meme critters: the internet, set loose in the long grass. All original; only the jokes are borrowed.
  dogeling: {
    name: "Dogeling", types: ["normal", "spirit"], base: { hp: 50, atk: 50, def: 45, sp: 55, spd: 60 }, catchRate: 150, xpYield: 70, learnset: DOGE_LINE,
    evolves: { to: "wowdoge", level: 30 }, width: 0.6, height: 0.6, scale: 0.8, moves: "walk", rarity: "common",
    habitat: [["Plains", 5], ["Taiga", 5], ["Meadow", 4], ["Snowy Plains", 3]],
    note: "Such critter. Very small. It says 'wow' at everything it sees, and means it every time.",
  },
  wowdoge: {
    name: "Wowdoge", types: ["normal", "spirit"], base: { hp: 75, atk: 80, def: 70, sp: 90, spd: 95 }, catchRate: 60, xpYield: 175, learnset: DOGE_LINE,
    width: 1.0, height: 1.1, scale: 1.3, moves: "walk", ride: "walk", rarity: "uncommon", habitat: [],
    note: "Much loyal. Very strong. Its bark is heard in capital letters and a font nobody can name.",
  },
  chonklet: {
    name: "Chonklet", types: ["normal"], base: { hp: 90, atk: 55, def: 60, sp: 35, spd: 20 }, catchRate: 180, xpYield: 68, learnset: CHONK_LINE,
    evolves: { to: "megachonk", level: 28 }, width: 0.7, height: 0.6, scale: 0.85, moves: "walk", rarity: "common",
    habitat: [["Plains", 4], ["Flower Plains", 4], ["Savanna", 2]],
    note: "It is not fat. It is big-boned. It is also a little fat, and it knows, and it does not care.",
  },
  megachonk: {
    name: "Megachonk", types: ["normal"], base: { hp: 150, atk: 90, def: 90, sp: 50, spd: 25 }, catchRate: 60, xpYield: 180, learnset: CHONK_LINE,
    width: 1.4, height: 1.2, scale: 1.6, moves: "walk", ride: "walk", rarity: "uncommon", habitat: [],
    note: "An absolute unit. When it sits down, the ground has to deal with it.",
  },
  froggo: {
    name: "Froggo", types: ["water", "grass"], base: { hp: 55, atk: 50, def: 50, sp: 60, spd: 55 }, catchRate: 170, xpYield: 66, learnset: FROG_LINE,
    evolves: { to: "vibefrog", level: 26 }, width: 0.6, height: 0.4, scale: 0.8, moves: "swim", rarity: "common",
    habitat: [["Swamp", 8], ["River", 5], ["Jungle", 2]],
    note: "It sits on a lily pad all day, vibing. Nobody knows what it is vibing to. Nobody dares ask.",
  },
  vibefrog: {
    name: "Vibefrog", types: ["water", "grass"], base: { hp: 80, atk: 70, def: 75, sp: 95, spd: 85 }, catchRate: 70, xpYield: 170, learnset: FROG_LINE,
    width: 1.0, height: 0.7, scale: 1.2, moves: "swim", rarity: "uncommon", habitat: [["Swamp", 1]],
    note: "It croaks one note, perfectly on the beat, and every frog in the swamp joins in. The vibes are immaculate.",
  },
  stonkfish: {
    name: "Stonkfish", types: ["water"], base: { hp: 45, atk: 55, def: 45, sp: 50, spd: 70 }, catchRate: 200, xpYield: 60, learnset: STONK_LINE,
    evolves: { to: "moonfin", level: 30 }, width: 0.5, height: 0.6, scale: 0.75, moves: "swim", rarity: "common",
    habitat: [["Ocean", 8], ["Beach", 4], ["River", 3]],
    note: "It only ever swims up. When it cannot swim up any more, it jumps. Line goes up.",
  },
  moonfin: {
    name: "Moonfin", types: ["water", "air"], base: { hp: 70, atk: 80, def: 70, sp: 95, spd: 110 }, catchRate: 70, xpYield: 175, learnset: STONK_LINE,
    width: 0.9, height: 0.9, scale: 1.25, moves: "fly", rarity: "uncommon", habitat: [],
    note: "Once it leapt so high it came down with frost on its fins. Its fans say it is going to the moon. It keeps coming back.",
  },
  sussling: {
    name: "Sussling", types: ["spirit", "bug"], base: { hp: 45, atk: 45, def: 55, sp: 65, spd: 60 }, catchRate: 120, xpYield: 80, learnset: SUS_LINE,
    evolves: { to: "susquatch", level: 101, trade: true }, width: 0.5, height: 0.8, scale: 0.8, moves: "walk", rarity: "uncommon",
    habitat: [["Dark Forest", 5], ["Swamp", 3], ["Taiga", 2]],
    note: "Nobody saw it arrive. Everybody saw it vent. It evolves only when it is traded away — voted out of one party, into another.",
  },
  susquatch: {
    name: "Susquatch", types: ["spirit", "bug"], base: { hp: 75, atk: 90, def: 80, sp: 105, spd: 90 }, catchRate: 45, xpYield: 190, learnset: SUS_LINE,
    width: 0.9, height: 1.5, scale: 1.3, moves: "walk", rarity: "rare", habitat: [],
    note: "It evolved the day it was traded, ejected from one party and welcomed into another. It remembers who called it sus.",
  },
  bonkbat: {
    name: "Bonkbat", types: ["air", "normal"], base: { hp: 40, atk: 55, def: 40, sp: 40, spd: 75 }, catchRate: 190, xpYield: 58, learnset: BONK_LINE,
    evolves: { to: "bonkarang", level: 24 }, width: 0.5, height: 0.5, scale: 0.7, moves: "fly", rarity: "common",
    habitat: [["Dark Forest", 6], ["Taiga", 4], ["Windswept Hills", 3], ["Badlands", 2]],
    note: "It bonks. That is it. That is the critter.",
  },
  bonkarang: {
    name: "Bonkarang", types: ["air", "normal"], base: { hp: 70, atk: 90, def: 65, sp: 60, spd: 105 }, catchRate: 90, xpYield: 160, learnset: BONK_LINE,
    width: 0.9, height: 0.8, scale: 1.15, moves: "fly", rarity: "uncommon", habitat: [],
    note: "It flies out, bonks something, and comes back. Every time. Scientists are furious.",
  },
  rickrock: {
    name: "Rickrock", types: ["stone"], base: { hp: 60, atk: 70, def: 90, sp: 40, spd: 35 }, catchRate: 150, xpYield: 70, learnset: RICK_LINE,
    evolves: { to: "neverroll", level: 34 }, width: 0.7, height: 0.7, scale: 0.9, moves: "walk", rarity: "common",
    habitat: [["Badlands", 5], ["Windswept Hills", 5], ["Stony Peaks", 4], ["Desert", 2]],
    note: "It rolls up to you very, very slowly. It will never give you up.",
  },
  neverroll: {
    name: "Neverroll", types: ["stone", "earth"], base: { hp: 90, atk: 105, def: 125, sp: 55, spd: 45 }, catchRate: 60, xpYield: 185, learnset: RICK_LINE,
    width: 1.3, height: 1.2, scale: 1.55, moves: "walk", ride: "walk", rarity: "uncommon", habitat: [],
    note: "It has never once let anybody down. It has never run around, nor deserted anyone. It is, frankly, a lot.",
  },
  copiumite: {
    name: "Copiumite", types: ["spirit", "ice"], base: { hp: 50, atk: 45, def: 55, sp: 70, spd: 55 }, catchRate: 90, xpYield: 90, learnset: COPE_LINE,
    evolves: { to: "hopium", level: 36 }, width: 0.5, height: 0.7, scale: 0.8, moves: "fly", rarity: "uncommon",
    habitat: [["Snowy Plains", 4], ["Snowy Taiga", 4], ["Dark Forest", 2]],
    note: "Team Copium's own. It breathes in disappointment and breathes out excuses, and it is never, ever wrong. Ask it.",
  },
  hopium: {
    name: "Hopium", types: ["spirit", "air"], base: { hp: 75, atk: 60, def: 80, sp: 115, spd: 100 }, catchRate: 45, xpYield: 190, learnset: COPE_LINE,
    width: 0.8, height: 1.1, scale: 1.2, moves: "fly", rarity: "rare", habitat: [],
    note: "What copium becomes when it stops coping and starts hoping. It floats a little higher on good days.",
  },
  // The legend: never wild. It waits at the summit of the region (maps.ts), or the end of a long road.
  glaciarch: {
    name: "Glaciarch", types: ["ice", "air"], base: { hp: 90, atk: 85, def: 100, sp: 125, spd: 85 }, catchRate: 3, xpYield: 290, learnset: [
      [1, "gust"], [1, "chill"], [10, "quicken"], [20, "air_blade"], [30, "frost_beam"], [45, "mend"], [55, "blizzard"], [65, "sky_dive"],
    ],
    width: 1.8, height: 2.0, scale: 2.1, moves: "fly", ride: "fly", rarity: "legendary", habitat: [],
    note: "A great bird of living ice. The auroras, they say, are the light caught in its wings.",
  },
};

export const SPECIES: Record<string, SpeciesDef> = Object.fromEntries(Object.entries(SPECIES_SPECS).map(([id, s]) => [id, { id, ...s }]));
export const SPECIES_IDS = Object.keys(SPECIES);
export const STARTERS = SPECIES_IDS.filter((id) => SPECIES[id].starter);
export const isSpecies = (v: unknown): v is string => typeof v === "string" && Object.prototype.hasOwnProperty.call(SPECIES, v);

/** What a species evolves from, or null for a first stage. */
export function preEvolution(species: string): string | null {
  return SPECIES_IDS.find((s) => SPECIES[s].evolves?.to === species) ?? null;
}

/** The first stage of whatever line a species is in. */
export function baseForm(species: string): string {
  for (const s of SPECIES_IDS) if (SPECIES[s].evolves?.to === species) return baseForm(s);
  return species;
}

// ---- levels and stats ---------------------------------------------------------------------------------

export const MAX_LEVEL = 100;

/** Total experience to reach a level: the cube, a little eased so a block world's slower battles still move. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(Math.pow(Math.min(level, MAX_LEVEL), 3) * 0.8);
}

/** The level a total of experience reaches. */
export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
  return l;
}

/** Experience for beating a critter of this species and level; trainers' critters give half again. */
export function xpReward(species: string, level: number, trainer: boolean): number {
  const s = SPECIES[species];
  return Math.max(1, Math.floor(((s?.xpYield ?? 50) * level) / 7 * (trainer ? 1.5 : 1)));
}

/** A critter's stats at its level: base, doubled, plus its own inborn bent (0-15), scaled — the classic shape. */
export function statsOf(species: string, level: number, iv: Stats): Stats {
  const b = SPECIES[species].base;
  const one = (k: keyof Stats) => Math.floor(((2 * b[k] + iv[k]) * level) / 100);
  return {
    hp: one("hp") + level + 10,
    atk: one("atk") + 5, def: one("def") + 5, sp: one("sp") + 5, spd: one("spd") + 5,
  };
}

// ---- a critter -----------------------------------------------------------------------------------------

export interface KnownMove { id: string; pp: number }

/** One critter: a party member, a box's, or a wild one's for the length of a battle. */
export interface Critter {
  /** Its own, for the life of the save: how the world's partner entity knows which one it is. */
  uid: string;
  species: string;
  nick?: string;
  level: number;
  xp: number;
  hp: number;
  moves: KnownMove[];
  status: Status | null;
  /** Turns of sleep left. */
  sleep?: number;
  iv: Stats;
  /** One in four hundred is a rare colour: it changes nothing but how proud its trainer is. */
  shiny?: boolean;
  /** Who caught it, and where. */
  ot?: string;
  met?: string;
}

export const displayName = (c: Critter): string => c.nick || SPECIES[c.species]?.name || c.species;
export const maxHp = (c: Critter): number => statsOf(c.species, c.level, c.iv).hp;

/** The last four different moves a species has learned by a level. */
export function movesAt(species: string, level: number): string[] {
  const out: string[] = [];
  for (const [l, m] of SPECIES[species].learnset) {
    if (l > level || out.includes(m)) continue;
    out.push(m);
    if (out.length > 4) out.shift();
  }
  return out;
}

let uidCounter = 0;
export function newUid(random: () => number = Math.random): string {
  uidCounter = (uidCounter + 1) % 1296;
  return `${Date.now().toString(36)}${Math.floor(random() * 1679616).toString(36).padStart(4, "0")}${uidCounter.toString(36)}`;
}

export function makeCritter(species: string, level: number, rng: Rng | (() => number), opts: { shiny?: boolean; ot?: string; met?: string } = {}): Critter {
  const random = typeof rng === "function" ? rng : () => rng.next();
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  const iv: Stats = { hp: Math.floor(random() * 16), atk: Math.floor(random() * 16), def: Math.floor(random() * 16), sp: Math.floor(random() * 16), spd: Math.floor(random() * 16) };
  const c: Critter = {
    uid: newUid(random), species, level: lv, xp: xpForLevel(lv), hp: 0,
    moves: movesAt(species, lv).map((id) => ({ id, pp: MOVES[id].pp })), status: null, iv,
    shiny: opts.shiny ?? random() < 1 / 400,
    ...(opts.ot ? { ot: opts.ot } : {}), ...(opts.met ? { met: opts.met } : {}),
  };
  c.hp = maxHp(c);
  if (!c.shiny) delete c.shiny;
  return c;
}

/** Back to full: health, every move's uses, no status. What a healing station and a night's rest do. */
export function restore(c: Critter): void {
  c.hp = maxHp(c);
  c.status = null;
  delete c.sleep;
  for (const m of c.moves) m.pp = MOVES[m.id]?.pp ?? m.pp;
}

/** Whether a species' level has reached its evolution, and what it becomes. */
export function evolutionFor(c: Critter): string | null {
  const e = SPECIES[c.species]?.evolves;
  return e && !e.trade && c.level >= e.level ? e.to : null;
}

/** What a critter becomes on changing hands, if it is one that evolves by trade; the critter is changed in place. */
export function tradeEvolve(c: Critter): string | null {
  const e = SPECIES[c.species]?.evolves;
  if (!e?.trade) return null;
  const share = c.hp / Math.max(1, maxHp(c));
  c.species = e.to;
  c.hp = Math.max(c.hp > 0 ? 1 : 0, Math.round(maxHp(c) * share));
  return e.to;
}

/** Turns a critter into what it evolves into, keeping its health's share and its moves. */
export function evolve(c: Critter): string | null {
  const to = evolutionFor(c);
  if (!to) return null;
  const share = c.hp / Math.max(1, maxHp(c));
  c.species = to;
  c.hp = Math.max(c.hp > 0 ? 1 : 0, Math.round(maxHp(c) * share));
  return to;
}

/**
 * Experience in: levels gained, and the moves each new level teaches (the
 * move is learned when there is room; otherwise it waits in `offered` for its
 * trainer to choose). Health rises with the new maximum.
 */
export function gainXp(c: Critter, amount: number): { levels: number[]; learned: string[]; offered: string[] } {
  const out = { levels: [] as number[], learned: [] as string[], offered: [] as string[] };
  if (c.level >= MAX_LEVEL) return out;
  const before = maxHp(c);
  c.xp += Math.max(0, Math.floor(amount));
  while (c.level < MAX_LEVEL && c.xp >= xpForLevel(c.level + 1)) {
    c.level++;
    out.levels.push(c.level);
    for (const [l, m] of SPECIES[c.species].learnset) {
      if (l !== c.level || c.moves.some((k) => k.id === m)) continue;
      if (c.moves.length < 4) { c.moves.push({ id: m, pp: MOVES[m].pp }); out.learned.push(m); } else out.offered.push(m);
    }
  }
  if (out.levels.length && c.hp > 0) c.hp = Math.min(maxHp(c), c.hp + (maxHp(c) - before));
  return out;
}

/** A critter from a save or a network message, trusted for nothing: every field checked and clamped. */
export function sanitizeCritter(v: unknown): Critter | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isSpecies(o.species)) return null;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.floor(x))) : d);
  const ivIn = (o.iv && typeof o.iv === "object" ? o.iv : {}) as Record<string, unknown>;
  const iv = Object.fromEntries(STAT_KEYS.map((k) => [k, num(ivIn[k], 0, 15, 0)])) as unknown as Stats;
  const level = num(o.level, 1, MAX_LEVEL, 5);
  const moves = (Array.isArray(o.moves) ? o.moves : []).flatMap((m): KnownMove[] => {
    if (!m || typeof m !== "object") return [];
    const { id, pp } = m as { id?: unknown; pp?: unknown };
    if (typeof id !== "string" || !MOVES[id]) return [];
    return [{ id, pp: num(pp, 0, MOVES[id].pp, MOVES[id].pp) }];
  }).filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, 4);
  const c: Critter = {
    uid: typeof o.uid === "string" && o.uid.length > 0 ? o.uid.slice(0, 32) : newUid(),
    species: o.species, level, xp: num(o.xp, xpForLevel(level), xpForLevel(Math.min(MAX_LEVEL, level + 1)), xpForLevel(level)),
    hp: 0, moves: moves.length ? moves : movesAt(o.species, level).map((id) => ({ id, pp: MOVES[id].pp })),
    status: o.status === "burn" || o.status === "poison" || o.status === "paralysis" || o.status === "sleep" ? o.status : null, iv,
  };
  c.hp = num(o.hp, 0, maxHp(c), maxHp(c));
  if (c.status === "sleep") c.sleep = num(o.sleep, 0, 3, 1);
  if (typeof o.nick === "string" && o.nick.trim()) c.nick = o.nick.trim().slice(0, 16);
  if (o.shiny === true) c.shiny = true;
  if (typeof o.ot === "string") c.ot = o.ot.slice(0, 16);
  if (typeof o.met === "string") c.met = o.met.slice(0, 40);
  return c;
}

// ---- in the wild ------------------------------------------------------------------------------------------

/** Wild levels by distance from the world's centre: two by the spawn, climbing a level every fifty blocks, to 60. */
export function wildLevelAt(distance: number, random: () => number): number {
  const base = 2 + distance / 50;
  return Math.max(2, Math.min(60, Math.round(base + (random() - 0.5) * 4)));
}

/**
 * A wild critter for a biome at a level: a species that lives there, grown into
 * whatever its line would be at that level (most of the time — a few stay small).
 */
export function pickWild(biome: string, level: number, random: () => number): string | null {
  const list = SPECIES_IDS.flatMap((id) => SPECIES[id].habitat.filter(([b]) => b === biome).map(([, w]) => [id, w] as [string, number]));
  if (!list.length) return null;
  const total = list.reduce((t, [, w]) => t + w, 0);
  let roll = random() * total;
  let pick = list[list.length - 1][0];
  for (const [id, w] of list) { roll -= w; if (roll < 0) { pick = id; break; } }
  // Grown up to its level, as a critter of that age in the wild would be — and never older than its level allows
  // (a stage met below the level its line reaches it at is its younger self).
  for (let s = SPECIES[pick].evolves; s && level >= s.level && random() < 0.8; s = SPECIES[pick].evolves) pick = s.to;
  for (let from = preEvolution(pick); from && level < SPECIES[from].evolves!.level; from = preEvolution(pick)) pick = from;
  return pick;
}

/** Every biome some critter lives in, for the test that keeps the names real. */
export function habitatBiomes(): string[] {
  return [...new Set(SPECIES_IDS.flatMap((id) => SPECIES[id].habitat.map(([b]) => b)))];
}

// ---- capture ---------------------------------------------------------------------------------------------------

/** The orbs, and how much better than the plain one each is at holding a critter. */
export const ORBS: Record<string, { name: string; bonus: number }> = {
  capture_orb: { name: "Capture Orb", bonus: 1 },
  silver_orb: { name: "Silver Orb", bonus: 1.5 },
  gold_orb: { name: "Gold Orb", bonus: 2 },
  star_orb: { name: "Star Orb", bonus: 255 },
  park_orb: { name: "Park Orb", bonus: 1.5 },
};

/**
 * The chance an orb holds: the classic shape — the lower its health, the
 * likelier; a sleeping or paralysed critter likelier still — worked out as
 * four shakes, each of which it must fail to break free of.
 */
export function catchOdds(species: string, hp: number, max: number, status: Status | null, orbBonus: number, extra = 1): { a: number; shake: number; chance: number } {
  const rate = SPECIES[species]?.catchRate ?? 45;
  const statusBonus = status === "sleep" ? 2 : status ? 1.5 : 1;
  const a = Math.min(255, ((3 * max - 2 * Math.max(1, hp)) * rate * orbBonus * statusBonus * extra) / (3 * max));
  if (a >= 255) return { a, shake: 1, chance: 1 };
  const shake = Math.pow(a / 255, 3 / 16);
  return { a, shake, chance: Math.pow(shake, 4) };
}

/** Throws the orb: how many times it shakes (0-3), and whether it holds. */
export function throwOrb(odds: { shake: number }, random: () => number): { shakes: number; caught: boolean } {
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (random() >= odds.shake) return { shakes: Math.min(3, shakes), caught: false };
    shakes++;
  }
  return { shakes: 3, caught: true };
}

// ---- healing and other goods -------------------------------------------------------------------------------------

/** What each of the critter medicines does. */
export const MEDICINE: Record<string, { name: string; heal?: number; full?: boolean; cure?: boolean; revive?: boolean; level?: boolean }> = {
  herbal_tonic: { name: "Herbal Tonic", heal: 20 },
  strong_tonic: { name: "Strong Tonic", heal: 60 },
  cure_all: { name: "Cure-All", cure: true },
  revival_herb: { name: "Revival Herb", revive: true },
  honey_cake: { name: "Honey Cake", level: true },
};

/** A medicine on a critter: what changed, in words, or why it would do nothing. */
export function giveMedicine(c: Critter, item: string): { ok: boolean; text: string } {
  const m = MEDICINE[item];
  const name = displayName(c);
  if (!m) return { ok: false, text: "That is not a medicine." };
  const max = maxHp(c);
  if (m.revive) {
    if (c.hp > 0) return { ok: false, text: `${name} has not fainted.` };
    c.hp = Math.floor(max / 2);
    c.status = null;
    return { ok: true, text: `${name} is back on its feet.` };
  }
  if (c.hp <= 0) return { ok: false, text: `${name} has fainted — it needs a Revival Herb.` };
  if (m.heal) {
    if (c.hp >= max) return { ok: false, text: `${name} is already at full health.` };
    const was = c.hp;
    c.hp = Math.min(max, c.hp + m.heal);
    return { ok: true, text: `${name} recovered ${c.hp - was} health.` };
  }
  if (m.cure) {
    if (!c.status) return { ok: false, text: `${name} is not suffering from anything.` };
    c.status = null;
    delete c.sleep;
    return { ok: true, text: `${name} is cured.` };
  }
  if (m.level) {
    if (c.level >= MAX_LEVEL) return { ok: false, text: `${name} cannot grow any more.` };
    const r = gainXp(c, xpForLevel(c.level + 1) - c.xp);
    return { ok: true, text: `${name} grew to level ${c.level}!${r.learned.length ? ` It learned ${r.learned.map((x) => MOVES[x].name).join(", ")}.` : ""}` };
  }
  return { ok: false, text: "Nothing happened." };
}

/** A trainer's goods at a healing station's counter, and their price in coins. */
export const SHOP: [string, number][] = [
  ["capture_orb", 20], ["silver_orb", 60], ["gold_orb", 120], ["herbal_tonic", 30], ["strong_tonic", 70], ["cure_all", 40], ["revival_herb", 150],
];

// ---- a trainer's card -------------------------------------------------------------------------------------------

export const PARTY_MAX = 6;
export const BOX_MAX = 240;

/** Everything one player has as a trainer: kept in their player save, so it follows them into any world of theirs. */
export interface TrainerCard {
  party: Critter[];
  box: Critter[];
  /** Species met in battle, and species caught: the field guide. */
  seen: string[];
  caught: string[];
  badges: string[];
  /** Trainers beaten, by id: a beaten trainer does not challenge again. */
  beaten: string[];
  coins: number;
  /** The starter they chose, which decides the rival's. */
  starter?: string;
  /** One-life runs: the areas whose single encounter has been used. */
  encounters?: string[];
  /** Where they wake after losing a battle with nothing left standing: the last healing station they used. */
  center?: [number, number, number];
  /** The Battle Spire: the current run's streak and rentals, and the best streak ever. */
  spire?: { streak: number; seed: number };
  spireBest?: number;
  /** The critter walking with them, out of its orb, by uid. */
  walking?: string;
  /** Against other players: link battles won and lost, and critters traded away. */
  link?: { wins: number; losses: number; trades: number };
}

export const freshCard = (): TrainerCard => ({ party: [], box: [], seen: [], caught: [], badges: [], beaten: [], coins: 100 });

/** A card from a save, every critter and list checked. */
export function sanitizeCard(v: unknown): TrainerCard {
  const c = freshCard();
  if (!v || typeof v !== "object") return c;
  const o = v as Record<string, unknown>;
  const critters = (x: unknown, max: number) => (Array.isArray(x) ? x.map(sanitizeCritter).filter((k): k is Critter => k !== null).slice(0, max) : []);
  const names = (x: unknown, max: number, ok: (s: string) => boolean = () => true) =>
    (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === "string" && s.length <= 64 && ok(s)))].slice(0, max) : []);
  c.party = critters(o.party, PARTY_MAX);
  c.box = critters(o.box, BOX_MAX);
  c.seen = names(o.seen, 256, isSpecies);
  c.caught = names(o.caught, 256, isSpecies);
  c.badges = names(o.badges, 16);
  c.beaten = names(o.beaten, 512);
  c.coins = typeof o.coins === "number" && Number.isFinite(o.coins) ? Math.max(0, Math.min(9_999_999, Math.floor(o.coins))) : 100;
  if (isSpecies(o.starter)) c.starter = o.starter;
  if (Array.isArray(o.encounters)) c.encounters = names(o.encounters, 128);
  const ctr = o.center;
  if (Array.isArray(ctr) && ctr.length === 3 && ctr.every((n) => typeof n === "number" && Number.isFinite(n))) c.center = ctr as [number, number, number];
  const sp = o.spire as Record<string, unknown> | undefined;
  if (sp && typeof sp.streak === "number" && typeof sp.seed === "number") c.spire = { streak: Math.max(0, Math.floor(sp.streak)), seed: Math.floor(sp.seed) | 0 };
  if (typeof o.spireBest === "number") c.spireBest = Math.max(0, Math.floor(o.spireBest));
  if (typeof o.walking === "string" && c.party.some((k) => k.uid === o.walking)) c.walking = o.walking;
  const ln = o.link as Record<string, unknown> | undefined;
  if (ln && typeof ln === "object") {
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.min(999_999, Math.floor(x))) : 0);
    c.link = { wins: n(ln.wins), losses: n(ln.losses), trades: n(ln.trades) };
  }
  return c;
}

/** A new critter goes into the party if there is room, else the box; says which (or that both are full). */
export function addCritter(card: TrainerCard, c: Critter): "party" | "box" | "full" {
  if (!card.caught.includes(c.species)) card.caught.push(c.species);
  if (!card.seen.includes(c.species)) card.seen.push(c.species);
  if (card.party.length < PARTY_MAX) { card.party.push(c); return "party"; }
  if (card.box.length < BOX_MAX) { card.box.push(c); return "box"; }
  return "full";
}

/** Whether any of the party can still battle. */
export const canBattle = (card: TrainerCard): boolean => card.party.some((c) => c.hp > 0);
