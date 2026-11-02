/**
 * Who you were before: Ashgrove County's occupations and traits, after the
 * zombie survival sandboxes' character creation (Project Zomboid's above
 * all). An occupation brings what you had on you and what you already
 * know; traits cost points or pay them, and together must not overspend.
 *
 * Everything a choice does comes out of one place, `perksOf`, as numbers the
 * rest of the game multiplies by — so a survivor with no choices made is
 * exactly the ordinary player, and a test can read a whole character off one
 * object. The names and wording are this game's own.
 */

export interface Survivor {
  occupation: string;
  traits: string[];
}

/** What a survivor's past does to them, as multipliers (1 = no change) and lists. */
export interface Perks {
  /** Melee damage. */
  melee: number;
  /** Walking and running speed. */
  speed: number;
  /** How fast a wound closes on its own. */
  heal: number;
  /** The chance a scratch or laceration carries the infection (a bite always does). */
  infection: number;
  /** The chance bad food or water makes you ill. */
  sickness: number;
  /** How fast you get hungry. */
  hunger: number;
  /** Extra warmth, as if wearing that much more (0..1). */
  warmth: number;
  /** How far the noise of your running carries. */
  noise: number;
  /** What you already know, as the reading list's names (carpentry, first_aid, generator_guide, …). */
  knows: string[];
  /** What you had on you: [item, count]. */
  kit: [string, number][];
}

export const NO_PERKS: Readonly<Perks> = Object.freeze({
  melee: 1, speed: 1, heal: 1, infection: 1, sickness: 1, hunger: 1, warmth: 0, noise: 1, knows: [], kit: [],
});

type Change = Partial<Omit<Perks, "knows" | "kit">> & { knows?: string[]; kit?: [string, number][] };

export interface Occupation {
  id: string;
  name: string;
  /** Points this job leaves for traits: a job that brings a lot leaves few. */
  points: number;
  about: string;
  perks: Change;
}

export const OCCUPATIONS: readonly Occupation[] = [
  { id: "unemployed", name: "Unemployed", points: 8, about: "Nothing to your name and nothing to unlearn. The most points to spend on who you are.", perks: {} },
  { id: "carpenter", name: "Carpenter", points: 2, about: "Boards a window with one nail a plank. Brought a hammer, planks and nails.",
    perks: { knows: ["carpentry"], kit: [["hammer", 1], ["plank", 6], ["nails", 16]] } },
  { id: "nurse", name: "Nurse", points: 2, about: "Dresses a wound so it heals. Brought sterile bandages and painkillers.",
    perks: { knows: ["first_aid"], heal: 1.15, kit: [["sterile_bandage", 4], ["painkillers", 2], ["disinfectant", 1]] } },
  { id: "electrician", name: "Electrician", points: 0, about: "Can wire up a generator without reading how. Brought a flashlight and wire.",
    perks: { knows: ["electrical", "generator_guide"], kit: [["flashlight", 1], ["electric_wire", 4], ["screwdriver", 1]] } },
  { id: "police_officer", name: "Police Officer", points: -4, about: "Hits harder, and still has the nightstick — and the service pistol, with what was in it.",
    perks: { melee: 1.1, kit: [["nightstick", 1], ["pistol", 1], ["pistol_ammo", 12], ["flashlight", 1]] } },
  { id: "firefighter", name: "Firefighter", points: 0, about: "Fit, strong, used to smoke and heat. Came off shift with a fire axe.",
    perks: { melee: 1.1, speed: 1.05, warmth: 0.15, kit: [["fire_axe", 1]] } },
  { id: "chef", name: "Chef", points: 2, about: "Knows a kitchen, and what keeps. Brought the good knife.",
    perks: { knows: ["cooking"], kit: [["kitchen_knife", 1], ["frying_pan", 1]] } },
  { id: "farmer", name: "Farmer", points: 2, about: "Knows what to plant and when. Brought seed and a spade's worth of patience.",
    perks: { knows: ["farming"], sickness: 0.8, kit: [["wheat_seeds", 12], ["carrot", 6], ["wood_axe", 1]] } },
  { id: "mechanic", name: "Mechanic", points: 2, about: "Knows engines. Brought a wrench and the toolbox habit.",
    perks: { knows: ["mechanics"], kit: [["wrench", 1], ["pipe_wrench", 1], ["duct_tape", 2]] } },
  { id: "burglar", name: "Burglar", points: -2, about: "Moves quietly and brought a crowbar. Doors are a suggestion.",
    perks: { noise: 0.7, kit: [["crowbar", 1]] } },
  { id: "lumberjack", name: "Lumberjack", points: 0, about: "Big arms and an axe you know the weight of.",
    perks: { melee: 1.15, kit: [["wood_axe", 1]] } },
];

export interface Trait {
  id: string;
  name: string;
  /** Points it costs (positive) or gives back (negative). */
  cost: number;
  about: string;
  perks: Change;
  /** Traits that cannot be taken with this one. */
  excludes?: string[];
}

export const TRAITS: readonly Trait[] = [
  { id: "strong", name: "Strong", cost: 6, about: "Hits a third harder.", perks: { melee: 1.3 }, excludes: ["weak"] },
  { id: "weak", name: "Weak", cost: -6, about: "Hits a quarter softer.", perks: { melee: 0.75 }, excludes: ["strong"] },
  { id: "athletic", name: "Athletic", cost: 6, about: "Runs faster and further.", perks: { speed: 1.12 }, excludes: ["unfit"] },
  { id: "unfit", name: "Unfit", cost: -6, about: "Slower on your feet.", perks: { speed: 0.9 }, excludes: ["athletic"] },
  { id: "fast_healer", name: "Fast Healer", cost: 4, about: "Wounds close half again as fast.", perks: { heal: 1.6 }, excludes: ["slow_healer"] },
  { id: "slow_healer", name: "Slow Healer", cost: -4, about: "Wounds take their time.", perks: { heal: 0.6 }, excludes: ["fast_healer"] },
  { id: "thick_skinned", name: "Thick Skinned", cost: 8, about: "A scratch or a tear is half as likely to carry the infection. A bite still does.",
    perks: { infection: 0.5 }, excludes: ["thin_skinned"] },
  { id: "thin_skinned", name: "Thin Skinned", cost: -8, about: "Scratches and tears carry the infection more often.", perks: { infection: 1.6 }, excludes: ["thick_skinned"] },
  { id: "iron_gut", name: "Iron Gut", cost: 3, about: "Bad food and bad water seldom make you ill.", perks: { sickness: 0.4 }, excludes: ["weak_stomach"] },
  { id: "weak_stomach", name: "Weak Stomach", cost: -3, about: "Anything off makes you ill.", perks: { sickness: 1.8 }, excludes: ["iron_gut"] },
  { id: "light_eater", name: "Light Eater", cost: 4, about: "Gets hungry more slowly.", perks: { hunger: 0.75 }, excludes: ["hearty_appetite"] },
  { id: "hearty_appetite", name: "Hearty Appetite", cost: -4, about: "Always hungry.", perks: { hunger: 1.35 }, excludes: ["light_eater"] },
  { id: "graceful", name: "Graceful", cost: 4, about: "Running makes less noise.", perks: { noise: 0.6 }, excludes: ["clumsy"] },
  { id: "clumsy", name: "Clumsy", cost: -2, about: "Every step is heard.", perks: { noise: 1.5 }, excludes: ["graceful"] },
  { id: "outdoorsman", name: "Outdoorsman", cost: 2, about: "Used to weather: the cold takes longer to reach you.", perks: { warmth: 0.35 } },
  { id: "handy", name: "Handy", cost: 4, about: "Knows carpentry: one nail a plank.", perks: { knows: ["carpentry"] } },
  { id: "first_aider", name: "First Aider", cost: 4, about: "Took the course: your dressings heal.", perks: { knows: ["first_aid"] } },
];

export const occupation = (id: string): Occupation | undefined => OCCUPATIONS.find((o) => o.id === id);
export const trait = (id: string): Trait | undefined => TRAITS.find((t) => t.id === id);

/** Points left for a choice: the occupation's, less what the traits cost. */
export function pointsLeft(s: Survivor): number {
  const o = occupation(s.occupation);
  return (o?.points ?? 0) - s.traits.reduce((t, id) => t + (trait(id)?.cost ?? 0), 0);
}

/** Why a choice cannot be taken, or null when it can. */
export function invalid(s: Survivor): string | null {
  if (!occupation(s.occupation)) return "Choose what you did for a living.";
  const seen = new Set<string>();
  for (const id of s.traits) {
    const t = trait(id);
    if (!t) return `There is no trait called ${id}.`;
    if (seen.has(id)) return `${t.name} is taken twice.`;
    seen.add(id);
  }
  for (const id of s.traits) for (const x of trait(id)!.excludes ?? []) if (seen.has(x)) return `${trait(id)!.name} and ${trait(x)!.name} cannot both be true.`;
  if (pointsLeft(s) < 0) return "That is more than your points allow: drop a good trait, or take a bad one.";
  return null;
}

/** A saved choice made safe: unknown names dropped, and anything invalid thrown out whole. */
export function sanitizeSurvivor(v: unknown): Survivor | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s: Survivor = {
    occupation: typeof o.occupation === "string" ? o.occupation : "",
    traits: Array.isArray(o.traits) ? o.traits.filter((t): t is string => typeof t === "string").slice(0, 32) : [],
  };
  return invalid(s) ? null : s;
}

/** Everything a survivor's past does, folded together: multipliers multiply, warmth adds, lists join. */
export function perksOf(s: Survivor | null): Perks {
  if (!s) return { ...NO_PERKS, knows: [], kit: [] };
  const out: Perks = { ...NO_PERKS, knows: [], kit: [] };
  const changes = [occupation(s.occupation)?.perks, ...s.traits.map((id) => trait(id)?.perks)];
  for (const c of changes) {
    if (!c) continue;
    for (const k of ["melee", "speed", "heal", "infection", "sickness", "hunger", "noise"] as const) if (c[k] !== undefined) out[k] *= c[k]!;
    if (c.warmth) out.warmth = Math.min(1, out.warmth + c.warmth);
    if (c.knows) out.knows.push(...c.knows.filter((k) => !out.knows.includes(k)));
    if (c.kit) out.kit.push(...c.kit);
  }
  return out;
}
