/**
 * Every star's planets, made up the same way every time.
 *
 * A star on the galaxy map is a place a ship can go, so each has a system:
 * the planets astronomers have found round it where there are any
 * (exoplanets.ts), and otherwise planets drawn the way the surveys say they
 * come. The rules are the ones the statistics of the last thirty years
 * support, simplified:
 *
 * - **Where.** The innermost planet has a period of days to weeks, whatever
 *   the star; each next one is further out by a period ratio of about two in
 *   the tightly packed systems red dwarfs favour (TRAPPIST-1, the Kepler
 *   "peas in a pod"), more in the spread-out ones, and round a Sun-like star
 *   there are often giants beyond the snow line, where ice could condense
 *   (2.7 AU × √L). Kepler's third law gives each orbit's size from its
 *   period and the star's mass.
 * - **How big.** Inside the snow line, mostly worlds of one to a few Earth
 *   masses — smaller round smaller stars; above a few masses most keep a
 *   hydrogen envelope and become mini-Neptunes (the radius valley). Beyond
 *   it, sometimes a giant, more often round heavier stars. A hot Jupiter
 *   round one Sun-like star in a hundred.
 * - **What kind.** The equilibrium temperature (from the starlight at that
 *   distance, with an Earth-like albedo), air kept according to mass, and a
 *   greenhouse that warms it (Earth's 33 K, Venus's 500) decide it: molten,
 *   baked, a hothouse, liquid water, frozen. Where water can be liquid and
 *   something made oxygen, the air is breathable.
 * - **Moons, rings, spin.** Giants have families of moons, the inner one
 *   heated by tides (Io), big icy ones sometimes hazy (Titan); worlds close
 *   to their stars are tidally locked, one face in endless day.
 *
 * Everything is a BodyDef (bodies.ts) with a WorldInfo (worlds.ts), so the
 * flight, the renderer and the landing handle a planet of Tau Ceti exactly as
 * they handle Mars. Each system's star has the id "sun": it is the root of
 * its frames, as the Sun is of ours.
 */
import type { BodyDef } from "./bodies";
import { KNOWN_SYSTEMS, type KnownPlanet } from "./exoplanets";
import { hashInts, rngFrom, SOL, systemOutlook, tempColor, type Star } from "./galaxy";
import { AU, cross, DEG, eccentricAnomaly, eclToEq, fromOrbitPlane, J2000, len, norm, type Vec3 } from "./kepler";
import { gravityOf, LANDABLE_RADIUS, SURFACE_OF, WORLD_LABEL, type Air, type Life, type WorldInfo, type WorldType } from "./worlds";

export const EARTH_RADIUS = 6371;
export const EARTH_GM = 398600.435;
export const SUN_GM = 1.32712440018e11;
export const SUN_RADIUS = 695_700;
const AU_PER_RSUN = SUN_RADIUS / AU;
const MJ = 317.83;

export interface Belt { name: string; inner: number; outer: number; kind: "asteroid" | "kuiper" }

export interface StarSystemDef {
  /** The star's id on the galaxy map. */
  id: string;
  star: Star;
  /** The star's mass in Suns — the catalogue's where a known system gives it, so its planets' years come out right. */
  mass: number;
  /** The star first (id "sun"), then each planet followed by its moons. */
  bodies: BodyDef[];
  belts: Belt[];
  /** Where water could be liquid on an Earth-like world (AU), or null round a star too hot or too faint to have one. */
  habitable: [number, number] | null;
  /** Where ice condenses (AU). */
  snowLine: number;
}

// ---- small helpers -------------------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
const logUniform = (r: () => number, lo: number, hi: number) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * r());
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

/** A star id as a seed. */
function seedOf(text: string): number {
  const codes: number[] = [];
  for (let i = 0; i < text.length; i++) codes.push(text.charCodeAt(i));
  return hashInts(0x5157, ...codes);
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const LETTERS = "bcdefghijklmnopqrstuvwxyz";

const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const mixHex = (a: string, b: string, t: number) => { const x = fromHex(a), y = fromHex(b); return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); };
/** A colour nudged a little lighter or darker, and a little warmer or cooler. */
function vary(h: string, r: () => number, amount = 0.12): string {
  const c = fromHex(h), k = 1 + (r() - 0.5) * amount * 2, w = (r() - 0.5) * amount;
  return toHex([c[0] * k + w * 0.5, c[1] * k, c[2] * k - w * 0.5]);
}

/** Kepler's third law: a (AU) from the period (days) and the masses (Suns). */
export const axisOf = (periodDays: number, mass: number): number => Math.cbrt(mass * (periodDays / 365.25) ** 2);
/** And the period (days) from a (AU). */
export const periodOf = (aAU: number, mass: number): number => 365.25 * Math.sqrt(aAU ** 3 / mass);

/** The habitable zone (AU) of a star, after Kopparapu et al.'s runaway-greenhouse and maximum-greenhouse limits — or null round a star with none worth the name. */
export function habitableZone(st: Star): [number, number] | null {
  if (st.cls === "BD" || st.lum > 1e4 || st.lum < 1e-5) return null;
  return [Math.sqrt(st.lum / 1.1), Math.sqrt(st.lum / 0.36)];
}

/** Equilibrium temperature (K) at a distance (AU) from a star of luminosity L, for an Earth-like albedo of 0.3. */
export const equilibrium = (lum: number, aAU: number): number => 254.6 * Math.pow(lum / (aAU * aAU), 0.25);

/**
 * How much an atmosphere of a surface pressure (bar) warms the ground above
 * the equilibrium temperature (K): Earth's 33 K at one bar; a thick carbon
 * dioxide one runs away toward Venus's 500.
 */
export function greenhouse(pressure: number, teq: number): number {
  if (pressure < 0.003) return 0;
  const mild = 33 * Math.pow(Math.min(pressure, 5), 0.3);
  const runaway = pressure > 5 ? 470 * Math.sqrt(Math.min(1, (pressure - 5) / 90)) : 0;
  // A cold world's thick air holds less heat: there is little water vapour in it to help.
  return (mild + runaway) * (teq < 200 ? 0.6 : 1);
}

/** Earth radii for a planet of a mass (Earth masses) and makeup. */
export function radiusFor(mass: number, makeup: "rock" | "ice" | "envelope" | "gas", teq = 300): number {
  switch (makeup) {
    case "rock": return mass < 1 ? Math.pow(mass, 0.3) : Math.pow(mass, 0.27);
    case "ice": return 1.25 * Math.pow(mass, 0.3);
    case "envelope": return 1.55 * Math.pow(mass, 0.33);
    case "gas": {
      const base = mass <= MJ ? 11.2 * (0.84 + 0.16 * clamp(Math.log(mass / 60) / Math.log(MJ / 60), 0, 1)) : 11.2 * Math.pow(mass / MJ, -0.03);
      // A giant roasting close to its star is puffed up by the heat (HD 209458 b, WASP-12 b).
      return base * (1 + clamp((teq - 1000) / 2200, 0, 0.9));
    }
  }
}

/** Where a tide would have locked a world's day to its year (AU): a third of an AU round the Sun, less round a small star. */
export const lockDistance = (mass: number): number => 0.35 * Math.pow(mass, 0.4);

// ---- the kinds of world --------------------------------------------------------------------------------------------

interface Draft {
  letter: string;
  period: number;
  a: number;
  mass: number;
  radius: number;
  e: number;
  status: WorldInfo["status"];
  note?: string;
  iau?: string;
  year?: number;
  candidate?: boolean;
  /** A known planet's makeup, settled by what was measured. */
  makeup?: "rock" | "envelope" | "gas";
  /** A known planet's air, where observations constrain it (bar; 0 for none). */
  air?: number;
  hot?: boolean;
}

/**
 * A known planet's makeup, from what was measured: with both a mass and a
 * radius, its density (above 3.5 g/cm³ it is rock — 55 Cancri e, at 1.9
 * Earth radii, is dense enough); with only one, the radius valley.
 */
export function makeupOfKnown(p: Pick<KnownPlanet, "mass" | "radius">): "rock" | "envelope" | "gas" {
  if (p.radius !== undefined && p.radius >= 6) return "gas";
  if (p.radius !== undefined && p.mass !== undefined) return (5.51 * p.mass) / p.radius ** 3 > 3.5 ? "rock" : "envelope";
  if (p.radius !== undefined) return p.radius >= 1.75 ? "envelope" : "rock";
  const m = p.mass ?? 1;
  return m >= 60 ? "gas" : m >= 6 ? "envelope" : "rock";
}

const SKY_BLUE = "#6f9fe8";

/** A sky's colour by day: an Earth-like air scatters blue, whatever the sun's colour — tinted a little by it. */
function skyFor(type: WorldType, starTemp: number): { sky: string; glow: string } {
  const sun = toHex(tempColor(starTemp));
  switch (type) {
    case "terran": case "ocean": case "tundra": { const s = mixHex(SKY_BLUE, sun, starTemp < 4000 ? 0.45 : 0.15); return { sky: s, glow: mixHex(s, "#ffffff", 0.25) }; }
    case "desert": return { sky: mixHex("#d8c090", sun, 0.2), glow: "#e8d8b0" };
    case "martian": return { sky: mixHex("#c8a07a", sun, 0.2), glow: "#d99a6c" };
    case "hothouse": return { sky: "#d8a860", glow: "#f2dca0" };
    case "haze": return { sky: "#d09040", glow: "#e0a050" };
    case "lava": return { sky: "#5a2a18", glow: "#ff8a4a" };
    default: return { sky: "#000000", glow: "#88aacc" };
  }
}

/** Plant colours by the light they grow in: green under a Sun, olive or teal under an orange star, near-black or purple under a red dwarf. */
function floraFor(starTemp: number, r: () => number): string {
  if (starTemp < 4000) return pick(r, ["#4a1a3a", "#2a2230", "#5a2a4a", "#3a1a2a"]);
  if (starTemp < 5300) return pick(r, ["#5a7a2a", "#2a7a6a", "#6a6a2a"]);
  if (starTemp < 6500) return pick(r, ["#3f8f3a", "#4a8a2a", "#2f7f4a"]);
  return pick(r, ["#8aa83a", "#a8a83a", "#6aa87a"]);
}

function paletteFor(type: WorldType, starTemp: number, r: () => number): WorldInfo["palette"] {
  const v = (h: string) => vary(h, r);
  switch (type) {
    case "lava": return { ground: v("#2a2220"), rock: v("#141010"), accent: "#ff6a1e" };
    case "iron": return { ground: v("#8a857e"), rock: v("#6a6660"), accent: v("#b0a898") };
    case "barren": return { ground: v(pick(r, ["#9a978f", "#8a7e70", "#7a7874", "#9a8a7a"])), rock: v("#5f5d59"), accent: v("#c8c4bc") };
    case "martian": return { ground: v(pick(r, ["#b5582c", "#a05030", "#c07040", "#9a4a3a"])), rock: v("#7c3b22"), accent: "#ecdcd0" };
    case "hothouse": return { ground: v("#7a5a3a"), rock: v("#4a3a2a"), accent: v("#c89050") };
    case "desert": return { ground: v(pick(r, ["#d8b070", "#c8a060", "#e0c090", "#b89060"])), rock: v("#a07048"), accent: v("#e8d0a0"), flora: floraFor(starTemp, r) };
    case "terran": return { ground: v("#6a5238"), rock: v("#7a7670"), accent: "#eef2f4", flora: floraFor(starTemp, r), sea: v("#2a5a9a") };
    case "ocean": return { ground: v("#d8c89a"), rock: v("#60646a"), accent: "#eef2f4", flora: floraFor(starTemp, r), sea: v("#1a3f7a") };
    case "tundra": return { ground: v("#8a8a7a"), rock: v("#5a5a58"), accent: "#eef2f4", flora: mixHex(floraFor(starTemp, r), "#6a6a5a", 0.5), sea: v("#2a4a6a") };
    case "icy": return { ground: v(pick(r, ["#d8e2ea", "#c8ccd0", "#e4e0d6", "#b0b8c0"])), rock: v("#9fb4c4"), accent: v(pick(r, ["#c89a70", "#9ab8d0", "#8a6a50"])) };
    case "volcanic": return { ground: v("#e0cc50"), rock: v("#8a4a1e"), accent: "#f0f0c8" };
    case "haze": return { ground: v("#8a6a38"), rock: v("#5a4a30"), accent: v("#c89a50"), sea: "#26262c" };
    case "nitrogen": return { ground: v("#e8dcd0"), rock: v("#8a5a3a"), accent: v("#f4e8f0") };
    case "minineptune": return { ground: v(pick(r, ["#8fb8d0", "#a8c8b0", "#b8a8d0", "#c0c8d8"])), rock: v("#6a88a8"), accent: v("#dfe8f0") };
    case "icegiant": return { ground: v(pick(r, ["#9fd6dd", "#6f95ff", "#7ab8c8", "#8fa8e8"])), rock: v("#3f66d8"), accent: v("#d8f0f4") };
    case "gasgiant": return { ground: v(pick(r, ["#d8b48a", "#e3cf9a", "#c8a07a", "#d8c8a8", "#b8906a"])), rock: v("#8a6a4a"), accent: v("#f0e0c0") };
    case "hotjupiter": return { ground: v(pick(r, ["#3a4a8a", "#5a3a2a", "#6a4a3a", "#2a3a6a"])), rock: v("#1a1a2a"), accent: v("#ff9a5a") };
  }
}

/** What an atmosphere is, for a kind of world with a surface pressure. */
function airFor(type: WorldType, pressure: number, life: Life, starTemp: number): Air | null {
  if (pressure < 0.001) return null;
  const { sky, glow } = skyFor(type, starTemp);
  // Oxygen is made by life: a world is breathable only where plants have filled its air, and at a pressure people can take.
  const breathable = (type === "terran" || type === "ocean" || type === "tundra") && (life === "plants" || life === "animals") && pressure >= 0.5 && pressure <= 3;
  return { pressure, breathable, sky, glow };
}

// ---- the planets -------------------------------------------------------------------------------------------------

/** The periods of `n` planets nobody has catalogued: tightly packed round small stars, spread out round bigger ones, with giants beyond the snow line. */
function layout(n: number, st: Star, mass: number, snow: number, r: () => number): { period: number; hot: boolean }[] {
  if (n <= 0) return [];
  const giant = st.cls === "KIII" || st.cls === "MIII" || st.cls === "RSG" || st.cls === "BSG";
  // Nothing orbits inside three stellar radii; a giant has swallowed its inner system, and a white dwarf's planets
  // are the ones that were far enough out to survive it.
  const aMin = Math.max(3 * st.radius * AU_PER_RSUN, 0.006, giant ? 1 : 0, st.cls === "WD" ? 1.5 : 0);
  const compact = r() < (({ M: 0.6, BD: 0.8, K: 0.45, G: 0.35, F: 0.3 } as Record<string, number>)[st.cls] ?? 0.3);
  const hotJupiter = (st.cls === "F" || st.cls === "G" || st.cls === "K") && r() < 0.012;
  let P = hotJupiter ? logUniform(r, 2.5, 5.5) : logUniform(r, 1.5, 35);
  if (axisOf(P, mass) < aMin) P = periodOf(aMin * (1 + 0.4 * r()), mass);
  const out: { period: number; hot: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    out.push({ period: P, hot: hotJupiter && k === 0 });
    const ratio = compact ? clamp(Math.exp(0.64 + 0.28 * gauss(r)), 1.25, 3.5) : clamp(Math.exp(0.95 + 0.45 * gauss(r)), 1.35, 7);
    P *= ratio;
  }
  // Round a Sun-like star, often a giant or two out past the snow line, as Jupiter and Saturn are.
  const sunlike = st.cls === "F" || st.cls === "G" || st.cls === "K";
  if (sunlike && !compact && n >= 3 && r() < 0.5) {
    const outer = Math.min(2, n - 2);
    let a = snow * logUniform(r, 1.05, 2.2);
    for (let k = n - outer; k < n; k++) {
      a = Math.max(a, axisOf(out[k - 1].period, mass) * 1.4);
      out[k] = { period: periodOf(a, mass), hot: false };
      a *= logUniform(r, 1.6, 2.6);
    }
  }
  return out;
}

/** A mass (Earth masses) for a planet nobody has weighed, by where it is. */
function massFor(a: number, snow: number, starMass: number, hot: boolean, r: () => number): number {
  if (hot) return logUniform(r, 90, 1200);
  if (a > snow) {
    const pGiant = 0.07 + 0.22 * Math.min(1.6, starMass);
    if (r() < pGiant) return a < 4 * snow && r() < 0.75 ? logUniform(r, 60, 2500) : logUniform(r, 10, 40);
    return clamp(0.6 * Math.exp(1.0 * gauss(r)), 0.01, 8);
  }
  return clamp((1.2 * Math.sqrt(starMass) + 0.4) * Math.exp(0.85 * gauss(r)), 0.03, 25);
}

interface Classified {
  type: WorldType;
  makeup: "rock" | "ice" | "envelope" | "gas";
  pressure: number;
  temp: number;
  life: Life;
}

/**
 * What a planet is, from where it is and how heavy: the chain of reasoning
 * the module's comment gives. `measured` is a known planet's own makeup,
 * which overrides the guess from its mass.
 */
function classify(mass: number, a: number, st: Star, snow: number, r: () => number, known: "rock" | "envelope" | "gas" | null, allowLife: boolean, knownAir?: number): Classified {
  const teq = equilibrium(st.lum, a);
  const beyond = a > snow;
  // The radius valley: above a few Earth masses most planets keep a hydrogen envelope.
  const envelope = known ? known === "envelope" : mass >= 20 || r() < smooth(2.5, 8, mass) * 0.9 + (beyond ? 0.1 : 0);
  if (known === "gas" || (!known && mass >= 60)) {
    return { type: teq > 900 || a < 0.1 ? "hotjupiter" : "gasgiant", makeup: "gas", pressure: 1, temp: Math.max(teq, 70), life: "none" };
  }
  if (envelope) return { type: mass >= 12 && beyond ? "icegiant" : "minineptune", makeup: "envelope", pressure: 1, temp: Math.max(teq, 40), life: "none" };
  const icy = beyond && mass < 3;
  const makeup = icy ? "ice" : "rock";
  // Air, kept by heavy worlds and stripped from light ones; a red dwarf's flares strip what is close to it.
  let airChance = smooth(0.08, 0.6, mass);
  if (st.cls === "M" && a < 0.1) airChance *= 0.6;
  const hasAir = teq < 1000 && r() < airChance;
  const drawn = hasAir ? clamp(Math.pow(mass, 1.5) * Math.exp(1.2 * gauss(r)), 0.005, 200) : 0;
  // Where telescopes have constrained a known planet's air, that wins over the draw (TRAPPIST-1 b and c are bare).
  const pressure = knownAir ?? drawn;
  const temp = teq + greenhouse(pressure, teq);
  let type: WorldType;
  if (teq > 1000 || temp >= 900) type = "lava";
  else if (pressure < 0.02) {
    if (pressure >= 0.003 && temp > 150 && temp < 300 && !icy) type = "martian";
    else if (teq > 400 && mass < 0.3) type = "iron";
    else if (icy || teq < 150) type = beyond || teq < 110 ? (mass < 0.05 && r() < 0.4 ? "nitrogen" : "icy") : "barren";
    else type = "barren";
  } else if (temp > 420) type = pressure >= 5 ? "hothouse" : "desert";
  // Too hot for seas but not for a steamy, scorched desert; the water long since gone to space.
  else if (temp > 330) type = "desert";
  // Liquid water needs air enough that it does not simply boil away: below a third of a bar the seas would be gone.
  else if (temp >= 273) {
    const roll = r();
    type = pressure < 0.3 ? "desert" : mass < 0.3 ? (roll < 0.5 ? "desert" : "terran") : roll < 0.3 ? "ocean" : roll < 0.75 ? "terran" : "desert";
  } else if (temp >= 240) type = pressure < 0.3 ? "martian" : "tundra";
  else if (teq < 120 && pressure > 0.5 && mass < 0.4) type = "haze";
  // Cold under thick air is a snowball; under thin air, a Mars.
  else if (icy || temp < 150 || pressure >= 0.3) type = "icy";
  else type = "martian";
  let life: Life = "none";
  if (allowLife) {
    const roll = r();
    if (type === "terran") life = roll < 0.8 ? (r() < 0.5 ? "animals" : "plants") : "microbial";
    else if (type === "ocean") life = roll < 0.6 ? (r() < 0.4 ? "animals" : "plants") : "microbial";
    else if (type === "tundra") life = roll < 0.5 ? "plants" : roll < 0.8 ? "microbial" : "none";
    else if (type === "desert" && temp < 330) life = roll < 0.25 ? "plants" : "none";
    else if (type === "haze" || type === "icy") life = roll < 0.05 ? "microbial" : "none";
  }
  return { type, makeup, pressure, temp, life };
}

/** A body's pole as right ascension and declination, from a direction in the ecliptic frame (the system's reference plane). */
function poleFrom(v: Vec3): [number, number] {
  const q = eclToEq(norm(v));
  return [((Math.atan2(q[1], q[0]) / DEG) % 360 + 360) % 360, Math.asin(clamp(q[2], -1, 1)) / DEG];
}

/** An orbit normal tilted from the reference plane's by an angle, toward an azimuth. */
function tilted(incl: number, azimuth: number): Vec3 {
  return [Math.sin(incl) * Math.cos(azimuth), Math.sin(incl) * Math.sin(azimuth), Math.cos(incl)];
}

/** The node and inclination (degrees) of the plane perpendicular to a pole, in the reference frame. */
function planeOf(pole: Vec3): { i: number; node: number } {
  const p = norm(pole);
  const i = Math.acos(clamp(p[2], -1, 1)) / DEG;
  // The ascending node lies along z × p.
  const n = cross([0, 0, 1], p);
  const node = len(n) < 1e-9 ? 0 : ((Math.atan2(n[1], n[0]) / DEG) % 360 + 360) % 360;
  return { i, node };
}

const kmText = (km: number) => `${Math.round(km).toLocaleString("en")} km`;
const auText = (au: number) => (au < 0.1 ? `${au.toFixed(3)} AU` : au < 10 ? `${au.toFixed(2)} AU` : `${Math.round(au)} AU`);
function yearText(days: number): string {
  if (days < 2) return `${(days * 24).toFixed(0)} hours`;
  if (days < 400) return `${days.toFixed(days < 10 ? 1 : 0)} days`;
  return `${(days / 365.25).toFixed(days < 3650 ? 1 : 0)} years`;
}

function sizeWord(radiusEarth: number, type: WorldType): string {
  if (type === "gasgiant" || type === "hotjupiter") return radiusEarth > 12 ? "A giant larger than Jupiter" : radiusEarth > 9 ? "A giant about Jupiter's size" : "A giant the size of Saturn";
  if (type === "icegiant" || type === "minineptune") return radiusEarth > 3.5 ? "A world the size of Neptune" : "A world between the Earth and Neptune in size";
  if (radiusEarth < 0.2) return "A small world";
  if (radiusEarth < 0.45) return "A world the size of the Moon";
  if (radiusEarth < 0.75) return "A world the size of Mars";
  if (radiusEarth < 0.92) return "A world a little smaller than the Earth";
  if (radiusEarth < 1.1) return "A world the size of the Earth";
  if (radiusEarth < 1.5) return "A world a little larger than the Earth";
  return "A super-Earth";
}

const TYPE_LINE: Record<WorldType, string> = {
  lava: "its day side is a sea of molten rock",
  iron: "baked, airless and cratered, like Mercury",
  barren: "airless rock, cratered and still",
  martian: "a cold desert of rusty dust under a thin sky",
  hothouse: "crushed under a thick, scalding air, like Venus",
  desert: "a dry world of sand and bare rock",
  terran: "with seas and dry land, where water stays liquid",
  ocean: "covered by one deep ocean, with only a scatter of islands",
  tundra: "cold, its seas mostly frozen, its land under snow",
  icy: "a crust of ice over rock",
  volcanic: "wracked by volcanoes, stained yellow with sulphur",
  haze: "under a thick orange haze, with lakes of liquid methane",
  nitrogen: "frozen solid: plains of nitrogen and methane ice",
  minineptune: "with no surface to stand on: deep hydrogen air over a hot, dense interior",
  icegiant: "an ice giant of water, ammonia and methane under hydrogen",
  gasgiant: "a gas giant banded with clouds",
  hotjupiter: "a gas giant roasting in its star's glare",
};

const LIFE_LINE: Record<Life, string> = {
  none: "",
  microbial: "Something microbial lives in it.",
  plants: "Plants — of a kind — cover its land, and have filled its air with oxygen.",
  animals: "It teems with life: plants, and animals that graze and hunt among them.",
};

function describe(name: string, type: WorldType, radiusEarth: number, aAU: number, star: Star, period: number, temp: number, locked: boolean, life: Life, status: WorldInfo["status"], moons: number, note?: string): string {
  const parts = [`${sizeWord(radiusEarth, type)}, ${auText(aAU)} from ${star.name}: ${TYPE_LINE[type]}. A year there lasts ${yearText(period)}.`];
  const c = Math.round(temp - 273.15);
  parts.push(type === "gasgiant" || type === "hotjupiter" || type === "icegiant" || type === "minineptune"
    ? `At its cloud tops it is ${c} °C.`
    : `The ground averages ${c} °C${locked ? ", though one face is locked toward the star in endless day and the other in endless night" : ""}.`);
  if (LIFE_LINE[life]) parts.push(LIFE_LINE[life]);
  if (moons) parts.push(`${moons === 1 ? "One moon goes" : `${moons} moons go`} round it.`);
  if (note) parts.push(note);
  if (status === "hypothetical") parts.push(`No planet is known here: this one is the game's own invention for ${star.name}.`);
  if (status === "approx") parts.push("A real planet is known about here; its details are the game's estimate.");
  return parts.join(" ");
}

// ---- building a system ------------------------------------------------------------------------------------------

const cache = new Map<string, StarSystemDef>();

/** The system round a star, the same every time — or null for the Sun, whose system is the real one (bodies.ts). */
export function systemOf(star: Star): StarSystemDef | null {
  if (star.id === SOL.id) return null;
  const hit = cache.get(star.id);
  if (hit) return hit;
  const sys = build(star);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(star.id, sys);
  return sys;
}

function build(st: Star): StarSystemDef {
  const known = st.real ? KNOWN_SYSTEMS[st.name] : undefined;
  const mass = known?.mass ?? st.mass;
  const r = rngFrom(seedOf(st.id));
  const snow = 2.7 * Math.sqrt(st.lum);
  const hz = habitableZone(st);
  const gmStar = SUN_GM * mass;
  const allowLife = !known;

  // ---- the planets' orbits and masses
  const drafts: Draft[] = [];
  if (known) {
    const sorted = [...known.planets].sort((x, y) => x.period - y.period);
    for (const p of sorted) {
      const makeup = makeupOfKnown(p);
      const pm = p.mass ?? (makeup === "rock" ? Math.pow(p.radius ?? 1, 3.7) : makeup === "envelope" ? Math.pow((p.radius ?? 2.5) / 1.55, 3) : 300);
      drafts.push({
        letter: p.letter, period: p.period, a: axisOf(p.period, mass), mass: pm, radius: p.radius ?? radiusFor(pm, makeup, equilibrium(st.lum, axisOf(p.period, mass))),
        e: p.e ?? clamp(Math.abs(0.03 * gauss(r)), 0, 0.15), status: "known", note: p.note, iau: p.name, year: p.year, candidate: p.candidate, makeup, air: p.air,
      });
    }
  } else {
    const outlook = systemOutlook(st);
    const status: WorldInfo["status"] = st.real ? (st.planets !== undefined ? "approx" : "hypothetical") : "generated";
    const orbits = layout(outlook.planets, st, mass, snow, r);
    orbits.forEach((o, k) => {
      const a = axisOf(o.period, mass);
      const m = massFor(a, snow, mass, o.hot, r);
      drafts.push({ letter: LETTERS[k], period: o.period, a, mass: m, radius: 0, e: o.hot ? 0.01 : clamp(Math.abs((a > snow ? 0.08 : 0.04) * gauss(r)), 0, 0.3), status, hot: o.hot });
    });
  }

  // Eccentric orbits that would cross their neighbour's are rounded off: a system that has lasted billions of years
  // is one whose orbits keep clear of each other. The catalogue's own eccentricities are left as measured.
  for (let k = 1; k < drafts.length; k++) {
    const inner = drafts[k - 1], d = drafts[k];
    const reach = inner.a * (1 + inner.e) * 1.05;
    if (d.a * (1 - d.e) <= reach && d.status !== "known") d.e = clamp((d.a - reach) / d.a, 0, d.e);
  }

  const bodies: BodyDef[] = [];
  const starColor = toHex(tempColor(st.temp));
  bodies.push({
    id: "sun", name: st.name, kind: "star", parent: null, radius: st.radius * SUN_RADIUS, gm: gmStar, rotation: 600 + r() * 400,
    pole: poleFrom([0, 0, 1]), orbit: { kind: "fixed" }, color: starColor, look: "gen",
    facts: starFacts(st, known ? known.planets.length : drafts.length, hz, snow),
  });

  const belts: Belt[] = [];
  let prevA = 0;
  for (const d of drafts) {
    const c = classify(d.mass, d.a, st, snow, r, d.makeup ?? null, allowLife, d.air);
    if (!d.makeup) d.radius = radiusFor(d.mass, c.makeup, c.temp);
    const radiusKm = d.radius * EARTH_RADIUS;
    const gm = EARTH_GM * d.mass;
    const locked = d.a < lockDistance(mass);
    const obliquity = locked ? 0 : r() < 0.1 ? (60 + 50 * r()) * DEG : Math.min(45, Math.abs(20 * gauss(r))) * DEG;
    const incl = Math.min(8, Math.abs(1.5 * gauss(r)));
    const node = r() * 360, peri = r() * 360, M0 = r() * 360;
    const normal = tilted(incl * DEG, (node - 90) * DEG);
    const spinAxis = locked ? normal : tiltAway(normal, obliquity, r() * 2 * Math.PI);
    const giant = c.type === "gasgiant" || c.type === "icegiant" || c.type === "hotjupiter" || c.type === "minineptune";
    const rotation = locked ? d.period * 24 : (giant ? 9 + 9 * r() : Math.exp(Math.log(12) + Math.log(3.5) * r())) * (r() < 0.08 ? -1 : 1);
    const palette = paletteFor(c.type, st.temp, r);
    const air = giant ? { pressure: 1, breathable: false, sky: "#000000", glow: palette.accent } : airFor(c.type, c.pressure, c.life, st.temp);
    const name = `${st.name} ${d.letter}`;
    const id = d.letter;
    const world: WorldInfo = {
      type: c.type, surface: radiusKm >= LANDABLE_RADIUS ? SURFACE_OF[c.type] : null, temp: c.temp, gravity: gravityOf(gm, radiusKm), air,
      liquid: c.type === "terran" || c.type === "ocean" || c.type === "tundra" ? "water" : c.type === "lava" ? "lava" : c.type === "haze" ? "methane" : null,
      life: c.life, palette, seed: seedOf(`${st.id}/${id}`), habitable: c.type === "terran" || c.type === "ocean" || c.type === "tundra",
      status: d.candidate ? "known" : d.status,
    };
    // ---- its moons
    const moons = moonsFor(d, c.type, radiusKm, gm, spinAxis, st, snow, hz, allowLife, r);
    const rings = (c.type === "gasgiant" && r() < 0.3) || (c.type === "icegiant" && r() < 0.45)
      ? { inner: radiusKm * (1.25 + 0.25 * r()), outer: radiusKm * (1.8 + 0.6 * r()), style: c.type === "gasgiant" ? (r() < 0.5 ? "saturn" as const : "jupiter" as const) : r() < 0.5 ? "uranus" as const : "neptune" as const }
      : undefined;
    const note = [d.iau ? `The IAU named it ${d.iau}.` : "", d.year ? `Found in ${d.year}${d.candidate ? " — a candidate not yet confirmed" : ""}.` : "", d.note ?? ""].filter(Boolean).join(" ");
    bodies.push({
      id, name, kind: "planet", parent: "sun", radius: radiusKm, gm, rotation, locked, pole: poleFrom(spinAxis),
      orbit: { kind: "kepler", a: d.a * AU, e: d.e, i: incl, node, peri, M0, period: d.period },
      color: palette.ground, look: "gen", rings,
      atmosphere: air ? { color: air.glow, height: giant ? radiusKm * 0.02 : 60 * Math.min(3, air.pressure), density: Math.min(2, giant ? 0.5 : air.pressure) } : undefined,
      facts: describe(name, c.type, d.radius, d.a, st, d.period, c.temp, locked, c.life, world.status, moons.length, note || undefined),
      world,
    });
    bodies.push(...moons);
    // A belt of rubble in a wide gap inside a giant, as the asteroid belt is inside Jupiter.
    if (c.type === "gasgiant" && prevA > 0 && d.a / prevA > 3.2 && !belts.length && r() < 0.7) belts.push({ name: `${st.name} asteroid belt`, inner: prevA * 1.4, outer: d.a * 0.72, kind: "asteroid" });
    prevA = d.a;
  }
  if (prevA > snow && r() < 0.5) belts.push({ name: `${st.name} outer belt`, inner: prevA * 1.3, outer: prevA * 2, kind: "kuiper" });
  return { id: st.id, star: st, mass, bodies, belts, habitable: hz, snowLine: snow };
}

/** A direction tipped away from `n` by an angle (radians), toward an azimuth round it: a spin axis leaning from its orbit's normal. */
function tiltAway(n: Vec3, angle: number, azimuth: number): Vec3 {
  const u = norm(Math.abs(n[2]) < 0.9 ? cross(n, [0, 0, 1]) : cross(n, [1, 0, 0]));
  const w = cross(n, u);
  const s = Math.sin(angle), c = Math.cos(angle);
  return norm([
    n[0] * c + (u[0] * Math.cos(azimuth) + w[0] * Math.sin(azimuth)) * s,
    n[1] * c + (u[1] * Math.cos(azimuth) + w[1] * Math.sin(azimuth)) * s,
    n[2] * c + (u[2] * Math.cos(azimuth) + w[2] * Math.sin(azimuth)) * s,
  ]);
}

/** A planet's moons: families round the giants, the odd big one round a rocky world. */
function moonsFor(d: Draft, type: WorldType, radiusKm: number, gm: number, spinAxis: Vec3, st: Star, snow: number, hz: [number, number] | null, allowLife: boolean, r: () => number): BodyDef[] {
  // Close to a small star a planet's pull cannot hold a moon for long.
  const hill = d.a * AU * Math.cbrt((d.mass * EARTH_GM) / (3 * SUN_GM * st.mass));
  if (hill < radiusKm * 6) return [];
  let n = 0;
  switch (type) {
    case "gasgiant": n = 2 + Math.floor(r() * 5); break;
    case "icegiant": n = 1 + Math.floor(r() * 4); break;
    case "minineptune": n = r() < 0.3 ? 1 : 0; break;
    case "hotjupiter": n = 0; break;
    default: n = d.mass > 0.4 && r() < 0.25 ? 1 : 0;
  }
  const out: BodyDef[] = [];
  const plane = planeOf(spinAxis);
  const giant = type === "gasgiant" || type === "icegiant";
  let a = radiusKm * (giant ? 4.5 + 2 * r() : 25 + 35 * r());
  const inHz = !!hz && d.a >= hz[0] && d.a <= hz[1];
  for (let k = 0; k < n && a < hill * 0.4; k++) {
    // Moon masses: a ten-thousandth of a giant's, give or take a factor of ten (the Galilean moons, Titan); a
    // fiftieth of a rocky world's (our Moon is an eightieth of the Earth).
    let mass = giant ? d.mass * Math.pow(10, -5.3 + 1.5 * r()) : d.mass * (0.005 + 0.02 * r());
    // Round a giant in the habitable zone, now and then a moon big enough to hold air and seas: a Pandora.
    const pandora = giant && inHz && k === 1 && r() < 0.35;
    if (pandora) mass = 0.15 + 0.5 * r();
    const icyMoon = d.a > snow * 0.8 && !pandora;
    const radius = radiusFor(mass, icyMoon ? "ice" : "rock") * EARTH_RADIUS;
    const mgm = EARTH_GM * mass;
    const period = (2 * Math.PI * Math.sqrt(a ** 3 / (gm + mgm))) / 86400;
    let mtype: WorldType, pressure = 0, life: Life = "none";
    const teq = equilibrium(st.lum, d.a);
    if (pandora) {
      pressure = 0.6 + r() * 1.2;
      const t = teq + greenhouse(pressure, teq);
      mtype = t > 273 && t < 330 ? (r() < 0.3 ? "ocean" : "terran") : t >= 240 && t <= 273 ? "tundra" : "desert";
      if (allowLife && mtype !== "desert") life = r() < 0.75 ? "animals" : "plants";
    } else if (giant && k === 0 && n >= 3 && r() < 0.7) mtype = "volcanic";
    else if (icyMoon) {
      mtype = radius > 2000 && r() < 0.3 ? "haze" : radius < 700 && r() < 0.3 ? "nitrogen" : "icy";
      if (mtype === "haze") pressure = 0.8 + r();
    } else mtype = teq > 400 ? "iron" : "barren";
    const temp = teq + greenhouse(pressure, teq);
    const palette = paletteFor(mtype, st.temp, r);
    const air = airFor(mtype, pressure, life, st.temp);
    const id = `${d.letter}.${k + 1}`;
    const name = `${st.name} ${d.letter} ${ROMAN[k]}`;
    const world: WorldInfo = {
      type: mtype, surface: radius >= LANDABLE_RADIUS ? SURFACE_OF[mtype] : null, temp, gravity: gravityOf(mgm, radius), air,
      liquid: mtype === "terran" || mtype === "ocean" || mtype === "tundra" ? "water" : mtype === "volcanic" ? "lava" : mtype === "haze" ? "methane" : null,
      life, palette, seed: seedOf(`${st.id}/${id}`), habitable: pandora && mtype !== "desert", status: d.status === "known" ? "hypothetical" : d.status,
    };
    out.push({
      id, name, kind: "moon", parent: d.letter, radius, gm: mgm, rotation: period * 24, locked: true, pole: poleFrom(spinAxis),
      orbit: { kind: "kepler", a, e: 0.001 + 0.01 * r(), i: plane.i, node: plane.node, peri: r() * 360, M0: r() * 360, period },
      color: palette.ground, look: "gen",
      atmosphere: air ? { color: air.glow, height: 40 * Math.min(3, air.pressure), density: Math.min(2, air.pressure) } : undefined,
      facts: `${pandora ? "A moon as big as a small planet" : radius > 1500 ? "A large moon" : "A moon"} of ${st.name} ${d.letter}, ${kmText(a)} out: ${TYPE_LINE[mtype]}. It goes round in ${yearText(period)}, one face always toward its planet.${LIFE_LINE[life] ? ` ${LIFE_LINE[life]}` : ""}${world.status === "hypothetical" ? " No moon is known here: this one is the game's own invention." : ""}`,
      world,
    });
    a *= 1.55 + 0.6 * r();
  }
  return out;
}

function starFacts(st: Star, planets: number, hz: [number, number] | null, snow: number): string {
  const parts = [`${st.spectral}: ${Math.round(st.temp).toLocaleString("en")} K at the surface, ${st.lum < 0.01 ? st.lum.toPrecision(2) : st.lum.toFixed(st.lum < 10 ? 2 : 0)} times the Sun's light, ${st.mass.toFixed(2)} of its mass.`];
  parts.push(planets ? `${planets} planet${planets === 1 ? "" : "s"} go${planets === 1 ? "es" : ""} round it.` : "Nothing is known to go round it.");
  if (hz) parts.push(`Water could be liquid on a world between ${auText(hz[0])} and ${auText(hz[1])} out; ice condenses beyond ${auText(snow)}.`);
  if (st.note) parts.push(st.note);
  return parts.join(" ");
}

// ---- where everything is -------------------------------------------------------------------------------------------

/** A body's position relative to its parent (km), from its Kepler elements at a date. */
export function keplerPosition(o: Extract<BodyDef["orbit"], { kind: "kepler" }>, jd: number): Vec3 {
  const M = (o.M0 + (360 / o.period) * (jd - J2000)) * DEG;
  const E = eccentricAnomaly(M, o.e);
  const xp = o.a * (Math.cos(E) - o.e), yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  return fromOrbitPlane(xp, yp, o.node * DEG, o.i * DEG, o.peri * DEG);
}

/** Every body of a system at a date, km from its star. */
export function systemPositions(sys: StarSystemDef, jd: number): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  out.set("sun", [0, 0, 0]);
  for (const b of sys.bodies) {
    if (b.orbit.kind !== "kepler") continue;
    const p = keplerPosition(b.orbit, jd);
    const base = out.get(b.parent ?? "sun") ?? [0, 0, 0];
    out.set(b.id, [base[0] + p[0], base[1] + p[1], base[2] + p[2]]);
  }
  return out;
}

/** The sum of what a system's planets are, for the galaxy map's card: "2 rocky, 1 ocean, 1 gas giant". */
export function systemSummary(sys: StarSystemDef): { planets: number; moons: number; habitable: number; life: number; kinds: string } {
  const planets = sys.bodies.filter((b) => b.kind === "planet");
  const moons = sys.bodies.filter((b) => b.kind === "moon");
  const count = new Map<string, number>();
  for (const p of planets) { const k = WORLD_LABEL[p.world!.type]; count.set(k, (count.get(k) ?? 0) + 1); }
  const worlds = [...planets, ...moons].map((b) => b.world!);
  return {
    planets: planets.length, moons: moons.length, habitable: worlds.filter((w) => w.habitable).length,
    life: worlds.filter((w) => w.life === "plants" || w.life === "animals").length,
    kinds: [...count.entries()].map(([k, n]) => `${n} × ${k.toLowerCase()}`).join(", "),
  };
}
