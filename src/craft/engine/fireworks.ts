/**
 * Fireworks: stars and the rockets that carry them.
 *
 * A star is gunpowder and one or more dyes, with a shape (a fire charge for a
 * large ball, a gold nugget for a star, a feather for a burst), a diamond for
 * a trail and glowstone for a twinkle; a star and more dyes gives it colours
 * to fade to. A rocket is paper and one to three gunpowder — its flight — and
 * up to seven stars. Everything a rocket will do rides on its stack, so it
 * survives saves, trades and the network, and the burst is drawn the same on
 * every screen from the stack alone.
 *
 * A rocket fired from the ground climbs, drifting a little, and bursts: every
 * star at once, each in its own shape and colours. With stars in it, the burst
 * hurts what stands within five blocks. Fired while gliding it pushes the
 * glider along for as long as its flight lasts — and if it carries stars, they
 * go off on the glider when it is spent, as in the original.
 */
import { DYES, itemByName, itemDef, type ItemStack } from "./items";
import type { Slot } from "./inventory";

export const BURST_SHAPES = ["small", "large", "star", "burst"] as const;
export type BurstShape = (typeof BURST_SHAPES)[number];

export interface Burst {
  shape: BurstShape;
  /** Dye indices (items.ts DYES). */
  colors: number[];
  fades?: number[];
  trail?: boolean;
  twinkle?: boolean;
}

export interface Rocket {
  /** 1-3: how long it climbs (and how long it pushes a glider). */
  flight: number;
  bursts: Burst[];
}

/** Each dye's colour in a burst, as 0xRRGGBB — brighter than the dye itself, since it is light against a night sky. */
export const DYE_RGB: readonly number[] = [0xf4f4ff, 0xff3a2a, 0xffe040, 0x4a70ff, 0x40e048, 0xff9424, 0xc458ff, 0x5a5a6a];
const SHAPE_ITEM: Record<string, BurstShape> = { fire_charge: "large", gold_nugget: "star", feather: "burst" };

const dyeIndex = (s: Slot): number => {
  const name = s ? itemDef(s.id)?.name ?? "" : "";
  return name.endsWith("_dye") ? (DYES as readonly string[]).indexOf(name.slice(0, -4)) : -1;
};
const nameOf = (s: Slot): string => (s ? itemDef(s.id)?.name ?? "" : "");

export function sanitizeBurst(v: unknown): Burst | null {
  const b = v as Partial<Burst> | null;
  if (!b || typeof b !== "object" || !BURST_SHAPES.includes(b.shape as BurstShape)) return null;
  const colors = (Array.isArray(b.colors) ? b.colors : []).filter((c) => Number.isInteger(c) && c >= 0 && c < DYES.length).slice(0, 8);
  if (!colors.length) return null;
  const out: Burst = { shape: b.shape as BurstShape, colors };
  const fades = (Array.isArray(b.fades) ? b.fades : []).filter((c) => Number.isInteger(c) && c >= 0 && c < DYES.length).slice(0, 8);
  if (fades.length) out.fades = fades;
  if (b.trail === true) out.trail = true;
  if (b.twinkle === true) out.twinkle = true;
  return out;
}

export function sanitizeRocket(v: unknown): Rocket | null {
  const r = v as Partial<Rocket> | null;
  if (!r || typeof r !== "object") return null;
  const flight = Math.max(1, Math.min(3, Math.floor(Number(r.flight) || 1)));
  const bursts = (Array.isArray(r.bursts) ? r.bursts : []).map(sanitizeBurst).filter((b): b is Burst => b !== null).slice(0, 7);
  return { flight, bursts };
}

/** A rocket without data (older saves, the creative tab) climbs for one and bursts into nothing. */
export function rocketOf(stack: ItemStack | null | undefined): Rocket {
  return stack?.fw ?? { flight: 1, bursts: [] };
}

/**
 * A firework star from the grid: exactly one gunpowder, at least one dye, and
 * at most one each of a shape, a diamond and a glowstone dust. Null otherwise.
 */
export function starFromGrid(grid: Slot[]): ItemStack | null {
  let gunpowder = 0, shape: BurstShape = "small", shapes = 0, trail = false, twinkle = false;
  const colors: number[] = [];
  for (const s of grid) {
    if (!s) continue;
    const name = nameOf(s);
    const dye = dyeIndex(s);
    if (name === "gunpowder") gunpowder++;
    else if (dye >= 0) colors.push(dye);
    else if (SHAPE_ITEM[name]) { shape = SHAPE_ITEM[name]; shapes++; }
    else if (name === "diamond") { if (trail) return null; trail = true; }
    else if (name === "glowstone_dust") { if (twinkle) return null; twinkle = true; }
    else return null;
  }
  if (gunpowder !== 1 || !colors.length || shapes > 1) return null;
  const burst: Burst = { shape, colors };
  if (trail) burst.trail = true;
  if (twinkle) burst.twinkle = true;
  return { id: itemByName("firework_star").id, count: 1, burst };
}

/** A star and dyes: the same star, fading to those colours. */
export function fadeFromGrid(grid: Slot[]): ItemStack | null {
  let star: ItemStack | null = null;
  const fades: number[] = [];
  for (const s of grid) {
    if (!s) continue;
    if (nameOf(s) === "firework_star") { if (star || !s.burst) return null; star = s; continue; }
    const dye = dyeIndex(s);
    if (dye < 0) return null;
    fades.push(dye);
  }
  if (!star?.burst || !fades.length) return null;
  return { ...star, count: 1, burst: { ...star.burst, fades } };
}

/** Paper, one to three gunpowder and up to seven stars: three rockets. */
export function rocketFromGrid(grid: Slot[]): ItemStack | null {
  let paper = 0, gunpowder = 0;
  const bursts: Burst[] = [];
  for (const s of grid) {
    if (!s) continue;
    const name = nameOf(s);
    if (name === "paper") paper++;
    else if (name === "gunpowder") gunpowder++;
    else if (name === "firework_star" && s.burst) bursts.push(s.burst);
    else return null;
  }
  if (paper !== 1 || gunpowder < 1 || gunpowder > 3 || bursts.length > 7) return null;
  return { id: itemByName("firework_rocket").id, count: 3, fw: { flight: gunpowder, bursts } };
}

/** How many ticks a rocket climbs before it bursts: the original's ten a level of flight, and a little chance. */
export function rocketLife(flight: number, random: () => number): number {
  return 10 * (flight + 1) + Math.floor(random() * 6) + Math.floor(random() * 7);
}

/** What a burst does to something `distance` away: nothing without stars, up to 5 + 2 a star within five blocks. */
export function burstDamage(rocket: Rocket, distance: number): number {
  if (!rocket.bursts.length || distance >= 5) return 0;
  return (5 + rocket.bursts.length * 2) * Math.sqrt((5 - distance) / 5);
}

/**
 * A burst packed into a particle kind name, so the one "particles" message
 * that every screen already understands carries its shape and colours:
 * "fw|shape|colors|fades|trail+twinkle".
 */
export function burstParticle(b: Burst): string {
  return `fw|${BURST_SHAPES.indexOf(b.shape)}|${b.colors.join(",")}|${(b.fades ?? []).join(",")}|${b.trail ? 1 : 0}${b.twinkle ? 1 : 0}`;
}

export function parseBurstParticle(kind: string): Burst | null {
  const parts = kind.split("|");
  if (parts[0] !== "fw" || parts.length !== 5) return null;
  const nums = (t: string) => (t ? t.split(",").map(Number) : []);
  return sanitizeBurst({
    shape: BURST_SHAPES[Number(parts[1])], colors: nums(parts[2]), fades: nums(parts[3]),
    trail: parts[4][0] === "1", twinkle: parts[4][1] === "1",
  });
}

const SHAPE_NAMES: Record<BurstShape, string> = { small: "Small Ball", large: "Large Ball", star: "Star-shaped", burst: "Burst" };
const colorName = (i: number) => {
  const d = DYES[i] ?? "white";
  return `${d[0].toUpperCase()}${d.slice(1)}`;
};

/** A star's description, for tooltips: its shape, colours, fade and extras. */
export function burstLines(b: Burst): string[] {
  const lines = [SHAPE_NAMES[b.shape], b.colors.map(colorName).join(" ")];
  if (b.fades?.length) lines.push(`Fade to ${b.fades.map(colorName).join(" ")}`);
  if (b.trail) lines.push("Trail");
  if (b.twinkle) lines.push("Twinkle");
  return lines;
}
