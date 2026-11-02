/**
 * Survival past hunger, for the modes that ask for it: thirst and body
 * temperature (Primal, after ARK) and wounds — bleeding, sickness, broken
 * bones (Dead Zone, after DayZ). Pure numbers over a small state, so the
 * rules can be tested without a world; Game.tickVitals feeds them the
 * surroundings and carries out what they decide.
 */

import { COUNTY_WATER } from "./countyItems";

export interface Vitals {
  /** 0..20, as food is. */
  water: number;
  /** Body temperature, °C. */
  temp: number;
  /** Open cuts, each bleeding until bandaged. */
  bleeding: number;
  /** Ticks of sickness left (food poisoning, a bad drink, an infected bite). */
  sick: number;
  /** A broken leg: slow, until splinted. */
  broken: boolean;
  /**
   * Seconds since the county's infection got in (0: it has not). Unlike a
   * fever it has no cure: it runs its course and the body gets up again.
   */
  infection: number;
}

export const freshVitals = (): Vitals => ({ water: 20, temp: 37, bleeding: 0, sick: 0, broken: false, infection: 0 });

/**
 * Which of the vitals a mode keeps. `knox` is Ashgrove County's rule, after
 * Project Zomboid's: a wound from the dead may carry an infection nothing
 * cures — a bite always does — and you learn it only when the symptoms come.
 */
export interface VitalsRules { thirst?: boolean; temperature?: boolean; wounds?: boolean; knox?: boolean }

/**
 * The infection's course, in seconds of play (a county day is twenty
 * minutes): nothing for half a day, then queasy, then sick to the stomach,
 * then a fever that eats at you, and at two and a half days the end.
 */
export const KNOX = { queasy: 600, nauseous: 1200, fever: 1800, failing: 2400, turn: 3000 } as const;

/** 0 clean or not showing yet, 1 queasy, 2 nauseous, 3 feverish, 4 failing. */
export function knoxStage(v: Pick<Vitals, "infection">): 0 | 1 | 2 | 3 | 4 {
  const t = v.infection;
  return t <= 0 || t < KNOX.queasy ? 0 : t < KNOX.nauseous ? 1 : t < KNOX.fever ? 2 : t < KNOX.failing ? 3 : 4;
}

export type KnoxWound = "scratch" | "laceration" | "bite";

/**
 * What a blow from one of the county's dead did: mostly a scratch through
 * the clothes, sometimes a tear, and sometimes teeth. The chance each carries
 * the infection is the reference game's: a scratch seldom, a laceration now
 * and then, a bite always.
 */
export function knoxWound(random: () => number, skin = 1): { wound: KnoxWound; infects: boolean; bleeds: boolean } {
  const r = random();
  const wound: KnoxWound = r < 0.15 ? "bite" : r < 0.45 ? "laceration" : "scratch";
  // Thick or thin skin (engine/survivors.ts) moves the odds for a scratch or a tear — never for a bite.
  const chance = wound === "bite" ? 1 : Math.min(1, (wound === "laceration" ? 0.25 : 0.07) * skin);
  return { wound, infects: random() < chance, bleeds: wound !== "scratch" || random() < 0.3 };
}

/** What a player's surroundings are doing to them this second. */
export interface Surroundings {
  /** The biome's name (for its climate). */
  biome: string;
  dimension: "overworld" | "nether" | "end";
  night: boolean;
  raining: boolean;
  inWater: boolean;
  /** Block height of the player's feet. */
  y: number;
  /** Warmth nearby — fire, lava, a lit furnace, a torch — 0 (none) to 1 (standing at a campfire). */
  heat: number;
  /** How much of the body armour covers, 0..1. */
  insulation: number;
  sprinting: boolean;
}

/** What a biome's air is like at midday, °C. */
const CLIMATE: Record<string, number> = {
  "Desert": 40, "Badlands": 37, "Savanna": 31, "Jungle": 29, "Swamp": 24, "Beach": 24, "Plains": 21, "Flower Plains": 21,
  "Mushroom Fields": 19, "Forest": 18, "Birch Forest": 17, "Dark Forest": 16, "River": 16, "Ocean": 15, "Deep Ocean": 12,
  "Meadow": 13, "Windswept Hills": 8, "Taiga": 6, "Stony Peaks": 2, "Snowy Beach": -2, "Frozen River": -6, "Frozen Ocean": -6,
  "Snowy Taiga": -8, "Snowy Plains": -10, "Snowy Peaks": -16,
};

/** The air's temperature where the player stands, °C. */
export function ambient(s: Surroundings): number {
  if (s.dimension === "nether") return 52 + s.heat * 10;
  if (s.dimension === "end") return 4 + s.heat * 20;
  let t = CLIMATE[s.biome] ?? 18;
  if (s.night) t -= 9;
  if (s.raining) t -= 5;
  if (s.inWater) t -= 8;
  if (s.y > 96) t -= (s.y - 96) * 0.25;
  return t + s.heat * 26;
}

/**
 * Where the body is heading in this air: comfortable from 15 to 28 °C;
 * colder, clothing holds warmth in; hotter, it holds heat in too.
 */
export function bodyTarget(air: number, insulation: number): number {
  if (air < 15) return 37 - (15 - air) * 0.2 * (1 - insulation * 0.75);
  if (air > 28) return 37 + (air - 28) * 0.18 * (1 + insulation * 0.6);
  return 37;
}

export type VitalsEvent =
  | { kind: "hurt"; amount: number; cause: "thirst" | "cold" | "heat" | "bleeding" | "sickness" | "infection" }
  /** The infection has run its course: the player dies, and gets up again as one of them. */
  | { kind: "turn" }
  | { kind: "hunger"; amount: number }
  | { kind: "message"; text: string }
  | { kind: "cough" };

/**
 * One second of it: water drains (faster running or hot), the body drifts
 * toward the air's temperature, cuts bleed, sickness runs its course. Returns
 * what the game should do about it.
 */
export function vitalsSecond(v: Vitals, rules: VitalsRules, s: Surroundings, second: number): VitalsEvent[] {
  const out: VitalsEvent[] = [];
  if (rules.temperature) {
    const target = bodyTarget(ambient(s), s.insulation);
    v.temp += (target - v.temp) * 0.02;
    if (v.temp < 35 && second % (v.temp < 33 ? 3 : 8) === 0) { out.push({ kind: "hurt", amount: 1, cause: "cold" }, { kind: "hunger", amount: 1 }); }
    if (v.temp > 39.5 && second % (v.temp > 41 ? 3 : 8) === 0) out.push({ kind: "hurt", amount: 1, cause: "heat" });
  }
  if (rules.thirst) {
    const hot = rules.temperature && v.temp > 38;
    // About a point every forty seconds: a full bar lasts a little over a day.
    const drain = (1 / 40) * (s.sprinting ? 1.6 : 1) * (hot ? 2 : 1) * (s.dimension === "nether" ? 2 : 1);
    v.water = Math.max(0, v.water - drain);
    if (v.water <= 0 && second % 5 === 0) out.push({ kind: "hurt", amount: 1, cause: "thirst" });
  }
  if (rules.wounds) {
    if (v.bleeding > 0 && second % Math.max(1, 5 - v.bleeding) === 0) out.push({ kind: "hurt", amount: 1, cause: "bleeding" });
    if (v.sick > 0) {
      v.sick = Math.max(0, v.sick - 20);
      if (second % 20 === 0) {
        out.push({ kind: "cough" }, { kind: "hunger", amount: 2 });
        v.water = Math.max(0, v.water - 2);
      }
      if (second % 30 === 0) out.push({ kind: "hurt", amount: 1, cause: "sickness" });
      if (v.sick === 0) out.push({ kind: "message", text: "You feel better." });
    }
  }
  if (rules.knox && v.infection > 0) {
    const was = knoxStage(v);
    v.infection++;
    const now = knoxStage(v);
    if (now !== was) out.push({ kind: "message", text: KNOX_WORDS[now] });
    if (now >= 2 && second % 30 === 0) out.push({ kind: "hunger", amount: 1 });
    if (now >= 3) v.temp = Math.max(v.temp, 38.6 + (now - 3) * 1.2);
    if (now === 4 && second % 12 === 0) out.push({ kind: "hurt", amount: 1, cause: "infection" });
    if (v.infection >= KNOX.turn) out.push({ kind: "turn" });
  }
  return out;
}

/** What each stage feels like, as it arrives. */
const KNOX_WORDS = [
  "", "You feel queasy. Something you ate, maybe.", "Your stomach turns over and over. This is not food poisoning.",
  "You are burning up. The wound has gone black at the edges.", "You can barely stand. You know what is coming.",
] as const;

/** Water from what was just eaten or drunk. */
export function waterFrom(item: string): number {
  switch (item) {
    case "water_bottle": case "potion_water_bottle": return 8;
    case "water_canteen": return 12;
    case "soda_can": return 6;
    case "milk_bucket": return 6;
    case "melon_slice": return 3;
    case "mejoberry": return 2;
    case "apple": case "carrot": return 1;
    case "mushroom_stew": case "beef_stew": case "venison_stew": case "chicken_soup": case "vegetable_soup": case "pumpkin_soup": case "hearty_stew": return 4;
    default: return COUNTY_WATER[item] ?? 0;
  }
}

/** The chance, 0..1, that eating or drinking this made you sick (with wounds on). */
export function sicknessChance(item: string): number {
  switch (item) {
    case "rotten_flesh": return 0.6;
    case "spoiled_food": return 0.7;
    case "raw_meat": case "beef": case "porkchop": case "mutton": case "venison": return 0.25;
    case "chicken": return 0.4;
    case "pond_water": return 0.2;
    default: return 0;
  }
}

/** Ticks a bout of sickness lasts: ten minutes, unless antibiotics end it. */
export const SICKNESS_TICKS = 12000;
/** How far a fall must be to break a leg, in blocks. */
export const BREAK_FALL = 7;

/** A line for the HUD: how warm, and whatever else is wrong. */
export function statusLine(v: Vitals, rules: VitalsRules): string[] {
  const out: string[] = [];
  if (rules.temperature) out.push(`${v.temp.toFixed(1)}°C${v.temp < 35 ? " Freezing" : v.temp < 36.2 ? " Cold" : v.temp > 39.5 ? " Overheating" : v.temp > 38 ? " Hot" : ""}`);
  if (rules.wounds) {
    if (v.bleeding) out.push(v.bleeding > 1 ? `Bleeding ×${v.bleeding}` : "Bleeding");
    if (v.sick) out.push("Sick");
    if (v.broken) out.push("Broken leg");
  }
  if (rules.knox) {
    // The reference game's moodles, as words: what the body is telling you, worst first.
    const stage = knoxStage(v);
    if (stage) out.unshift(["", "Queasy", "Nauseous", "Feverish", "Failing"][stage]);
    if (rules.thirst && v.water < 10) out.push(v.water < 3 ? "Parched" : v.water < 6 ? "Very thirsty" : "Thirsty");
  }
  return out;
}

export function sanitizeVitals(v: unknown): Vitals {
  const f = freshVitals();
  if (!v || typeof v !== "object") return f;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d);
  return {
    water: num(o.water, 0, 20, f.water), temp: num(o.temp, 20, 45, f.temp), bleeding: Math.floor(num(o.bleeding, 0, 3, 0)),
    sick: Math.floor(num(o.sick, 0, SICKNESS_TICKS, 0)), broken: o.broken === true,
    infection: Math.floor(num(o.infection, 0, KNOX.turn, 0)),
  };
}
