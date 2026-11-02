/**
 * The Milky Way, generated.
 *
 * Two or three hundred billion stars cannot be stored; they can be *made*,
 * the same every time, from where they are. Space is cut into cubes — big
 * ones for rare bright stars, small ones for the common dim ones, so each
 * cube holds about one star of its kind (the scheme Elite's galaxy uses) —
 * and each cube's stars come from a random generator seeded by the cube's
 * coordinates. The number in a cube is drawn from the galaxy's density there,
 * so the stars fall where the real ones do: thick in the bar and the disk,
 * young blue ones strung along the spiral arms, old red ones everywhere.
 *
 * The galaxy (Bland-Hawthorn & Gerhard 2016, and the papers after):
 * - The Sun 8,178 pc (26,670 ly) from the centre (GRAVITY 2019), 20.8 pc
 *   above the plane (Bennett & Bovy 2019).
 * - A thin disk (scale length 2.6 kpc, scale height by age: 60 pc for the
 *   young, 300 pc for the old), a thick disk (900 pc, 12% of old stars
 *   here), a stellar halo falling as r^−3.5.
 * - A boxy bar and bulge (the Dwek "E2" shape, 1.58 × 0.62 × 0.43 kpc)
 *   pointing 27° from the line to the centre, near end in the first quadrant.
 * - Four logarithmic spiral arms pitched 12° — Perseus and Scutum–Centaurus
 *   the major ones in old stars, Sagittarius–Carina and Norma–Outer richer in
 *   gas and young stars — and the Orion Spur the Sun sits in, between the
 *   Sagittarius Arm inside and the Perseus Arm outside.
 * - Local densities (per cubic parsec) from the census of the solar
 *   neighbourhood: about 0.1 stars, three-quarters of them red dwarfs.
 *
 * Coordinates are galactocentric, in parsecs: x from the Sun toward the
 * centre, y the way the Sun is going round (galactic longitude 90°), z to the
 * north galactic pole. The centre is the origin; the Sun is at (−8178, 0, 20.8).
 */
import { type Vec3 } from "./kepler";
import { KNOWN_STARS, LANDMARKS, type Landmark } from "./nearStars";

export const LY_PER_PC = 3.261564;
export const R0 = 8178;
export const Z_SUN = 20.8;
export const SUN_POS: Vec3 = [-R0, 0, Z_SUN];
/** The galaxy is one galaxy, the same in every world: one seed for all of it. */
export const GALAXY_SEED = 0x6d11c3a7;

const DEG = Math.PI / 180;

// ---- where things are ----------------------------------------------------------------------------------------------

/** J2000 equatorial to galactic (Hipparcos, ESA 1997, vol. 1 §1.5.3). */
const EQ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];

/** A direction on the sky (right ascension and declination, degrees) in galactic longitude and latitude (degrees). */
export function toGalactic(ra: number, dec: number): { l: number; b: number; dir: Vec3 } {
  const a = ra * DEG, d = dec * DEG;
  const e: Vec3 = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g: Vec3 = [
    EQ_TO_GAL[0][0] * e[0] + EQ_TO_GAL[0][1] * e[1] + EQ_TO_GAL[0][2] * e[2],
    EQ_TO_GAL[1][0] * e[0] + EQ_TO_GAL[1][1] * e[1] + EQ_TO_GAL[1][2] * e[2],
    EQ_TO_GAL[2][0] * e[0] + EQ_TO_GAL[2][1] * e[1] + EQ_TO_GAL[2][2] * e[2],
  ];
  const l = ((Math.atan2(g[1], g[0]) / DEG) % 360 + 360) % 360;
  return { l, b: Math.asin(Math.max(-1, Math.min(1, g[2]))) / DEG, dir: g };
}

/** A direction in galactic coordinates as one in J2000 equatorial ones: the rotation above, run backwards (its transpose). */
export function galacticToEquatorial(g: Vec3): Vec3 {
  return [
    EQ_TO_GAL[0][0] * g[0] + EQ_TO_GAL[1][0] * g[1] + EQ_TO_GAL[2][0] * g[2],
    EQ_TO_GAL[0][1] * g[0] + EQ_TO_GAL[1][1] * g[1] + EQ_TO_GAL[2][1] * g[2],
    EQ_TO_GAL[0][2] * g[0] + EQ_TO_GAL[1][2] * g[1] + EQ_TO_GAL[2][2] * g[2],
  ];
}

/** Where in the galaxy (galactocentric parsecs) a star is, from where it is in our sky and how far. */
export function galacticPosition(ra: number, dec: number, lightYears: number): Vec3 {
  const { dir } = toGalactic(ra, dec);
  const d = lightYears / LY_PER_PC;
  return [SUN_POS[0] + dir[0] * d, SUN_POS[1] + dir[1] * d, SUN_POS[2] + dir[2] * d];
}

/** Galactic longitude and latitude (degrees) of a point, seen from the Sun, and its distance (pc). */
export function seenFromSun(p: Vec3): { l: number; b: number; d: number } {
  const x = p[0] - SUN_POS[0], y = p[1] - SUN_POS[1], z = p[2] - SUN_POS[2];
  const d = Math.hypot(x, y, z);
  return { l: ((Math.atan2(y, x) / DEG) % 360 + 360) % 360, b: d > 0 ? Math.asin(z / d) / DEG : 0, d };
}

export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---- the shape of the galaxy -----------------------------------------------------------------------------------------

export type Population = "young" | "mid" | "old";

/**
 * Each population's share of the galaxy's parts, relative to its thin disk
 * here: how thick its disk is, how strongly it gathers into the arms, and how
 * much of it is in the bar, the thick disk and the halo.
 */
const POPS: Record<Population, { hz: number; arm: number; bulge: number; thick: number; halo: number }> = {
  young: { hz: 60, arm: 6, bulge: 1.5, thick: 0, halo: 0 },
  mid: { hz: 180, arm: 1.6, bulge: 25, thick: 0.05, halo: 0.001 },
  old: { hz: 300, arm: 0.35, bulge: 110, thick: 0.12, halo: 0.005 },
};

export const PITCH = 12 * DEG;
const K = Math.tan(PITCH);
/** Arms one quarter-turn apart are this factor apart in radius. */
const ARM_STEP = Math.exp((Math.PI / 2) * K);
const ARM_WIDTH = 0.32; // kpc, the Gaussian width

/** The four arms, by their radius (kpc) where they cross the Sun's azimuth, and how strong each is. */
export const ARMS: { name: string; r: number; w: number }[] = [
  { name: "Perseus Arm", r: 10.1, w: 1.0 },
  { name: "Sagittarius–Carina Arm", r: 10.1 / ARM_STEP, w: 0.6 },
  { name: "Scutum–Centaurus Arm", r: 10.1 / ARM_STEP ** 2, w: 1.0 },
  { name: "Norma–Outer Arm", r: 10.1 / ARM_STEP ** 3, w: 0.6 },
];
/** The spur the Sun is in: a stub of arm between Sagittarius and Perseus, a few kiloparsecs long. */
const SPUR = { name: "Orion Spur", r: 8.35, w: 0.45, from: Math.PI - 0.55, to: Math.PI + 0.35 };

/** The bar: its half-lengths (kpc) and angle (the near end at positive longitude). */
const BAR = { a: 1.58, b: 0.62, c: 0.43, angle: 27 * DEG };
const BAR_AXIS: [number, number] = [-Math.cos(BAR.angle), Math.sin(BAR.angle)];
const BAR_SIDE: [number, number] = [Math.sin(BAR.angle), Math.cos(BAR.angle)];

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How strongly a point (R kpc, azimuth θ) sits on a spiral arm (0..1), and which. */
export function armAt(R: number, theta: number): { value: number; arm: string | null } {
  let best = 0, name: string | null = null;
  if (R < 1) return { value: 0, arm: null };
  const lnR = Math.log(R), period = 2 * Math.PI * K;
  const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const taper = smooth(2.6, 4.2, R) * Math.exp(-Math.max(0, R - 14) / 1.5);
  for (const arm of ARMS) {
    let dl = lnR - (Math.log(arm.r) + K * (t - Math.PI));
    dl = ((dl % period) + period * 1.5) % period - period / 2;
    const d = Math.abs(dl) * R * Math.cos(PITCH);
    const v = arm.w * Math.exp(-(d * d) / (2 * ARM_WIDTH * ARM_WIDTH)) * taper;
    if (v > best) { best = v; name = arm.name; }
  }
  // The spur: one short stretch, fading at its ends.
  if (t > SPUR.from - 0.3 && t < SPUR.to + 0.3) {
    const along = smooth(SPUR.from - 0.3, SPUR.from, t) * (1 - smooth(SPUR.to, SPUR.to + 0.3, t));
    const dl = lnR - (Math.log(SPUR.r) + K * (t - Math.PI));
    const d = Math.abs(dl) * R * Math.cos(PITCH);
    const v = SPUR.w * along * Math.exp(-(d * d) / (2 * 0.22 * 0.22));
    if (v > best) { best = v; name = SPUR.name; }
  }
  return { value: best, arm: name };
}

/** The bar's density shape at a point (pc), 1 at the centre. */
function barAt(p: Vec3): number {
  const u = (p[0] * BAR_AXIS[0] + p[1] * BAR_AXIS[1]) / 1000, v = (p[0] * BAR_SIDE[0] + p[1] * BAR_SIDE[1]) / 1000, w = p[2] / 1000;
  return Math.exp(-Math.sqrt((u / BAR.a) ** 2 + (v / BAR.b) ** 2 + (w / BAR.c) ** 2));
}

/** A population's density at a point, before normalising: thin disk (with arms), thick disk, bar, halo. */
function shape(pop: Population, p: Vec3): number {
  const q = POPS[pop];
  const R = Math.hypot(p[0], p[1]) / 1000, z = Math.abs(p[2]);
  const R0k = R0 / 1000;
  // Inside the bar the disk thins out — the bar has swept it up.
  const inner = 0.25 + 0.75 * smooth(1.2, 3.5, R);
  const outer = R > 15 ? Math.exp(-(R - 15) / 1.2) : 1;
  const arms = 1 + q.arm * armAt(R, Math.atan2(p[1], p[0])).value;
  const thin = Math.exp(-(R - R0k) / 2.6 - z / q.hz) * arms * inner * outer;
  const thick = q.thick ? q.thick * Math.exp(-(R - R0k) / 2.0 - z / 900) * outer : 0;
  const bar = q.bulge * barAt(p);
  const r = Math.hypot(R, z / 1000 / 0.7);
  const halo = q.halo ? q.halo * Math.pow(Math.max(r, 1) / R0k, -3.5) : 0;
  return thin + thick + bar + halo;
}

const SHAPE_AT_SUN: Record<Population, number> = {
  young: shape("young", SUN_POS), mid: shape("mid", SUN_POS), old: shape("old", SUN_POS),
};

/** A population's density at a point relative to its density here, at the Sun. */
export function relativeDensity(pop: Population, p: Vec3): number {
  return shape(pop, p) / SHAPE_AT_SUN[pop];
}

// ---- the kinds of star -----------------------------------------------------------------------------------------------

export type StarClass = "O" | "B" | "A" | "F" | "G" | "K" | "M" | "WD" | "BD" | "KIII" | "MIII" | "RSG" | "BSG";

export interface ClassDef {
  cls: StarClass;
  label: string;
  pop: Population;
  /** Stars of this kind per cubic parsec, here. */
  n: number;
  /** The side of the cubes they are made in (pc): about one star of the kind to a cube. */
  cell: number;
  /** How far round the map's focus they are made (pc), and the most it will make. */
  reach: number;
  budget: number;
}

/**
 * The census of the solar neighbourhood, by kind: three-quarters red dwarfs,
 * one star in a thousand a B star, one in three million an O star; white
 * dwarfs, brown dwarfs, and the giants and supergiants that stand out far
 * beyond their numbers.
 */
export const CLASSES: ClassDef[] = [
  { cls: "O", label: "O-type blue giant", pop: "young", n: 8e-9, cell: 256, reach: 3000, budget: 4000 },
  { cls: "BSG", label: "blue supergiant", pop: "young", n: 1e-8, cell: 512, reach: 3000, budget: 2000 },
  { cls: "RSG", label: "red supergiant", pop: "young", n: 1.5e-8, cell: 512, reach: 3000, budget: 2000 },
  { cls: "B", label: "B-type star", pop: "young", n: 1.2e-4, cell: 32, reach: 350, budget: 25000 },
  { cls: "MIII", label: "red giant", pop: "old", n: 2e-5, cell: 32, reach: 500, budget: 12000 },
  { cls: "KIII", label: "orange giant", pop: "old", n: 1.2e-4, cell: 16, reach: 300, budget: 15000 },
  { cls: "A", label: "A-type star", pop: "mid", n: 6e-4, cell: 8, reach: 150, budget: 12000 },
  { cls: "F", label: "F-type star", pop: "mid", n: 3e-3, cell: 4, reach: 60, budget: 8000 },
  { cls: "G", label: "G-type star (like the Sun)", pop: "old", n: 7.5e-3, cell: 4, reach: 60, budget: 10000 },
  { cls: "K", label: "orange dwarf", pop: "old", n: 1.2e-2, cell: 4, reach: 50, budget: 10000 },
  { cls: "WD", label: "white dwarf", pop: "old", n: 5e-3, cell: 4, reach: 40, budget: 5000 },
  { cls: "M", label: "red dwarf", pop: "old", n: 6.5e-2, cell: 2, reach: 30, budget: 12000 },
  { cls: "BD", label: "brown dwarf", pop: "old", n: 2e-2, cell: 2, reach: 12, budget: 3000 },
];
export const CLASS: Record<StarClass, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.cls, c])) as Record<StarClass, ClassDef>;
const CLASS_INDEX: Record<StarClass, number> = Object.fromEntries(CLASSES.map((c, i) => [c.cls, i])) as Record<StarClass, number>;

/** Stars of a kind per cubic parsec at a point. */
export function densityOf(cls: StarClass, p: Vec3): number {
  const c = CLASS[cls];
  return c.n * relativeDensity(c.pop, p);
}

// ---- the stars themselves ------------------------------------------------------------------------------------------

export interface Star {
  /** Stable: the kind, the cube and the star's place in it — or the real star's name. */
  id: string;
  name: string;
  cls: StarClass;
  /** Spectral type as astronomers write it: "G2V", "K1III", "DA4". */
  spectral: string;
  pos: Vec3;
  /** Surface temperature (K), luminosity, mass and radius in Suns. */
  temp: number;
  lum: number;
  mass: number;
  radius: number;
  real?: boolean;
  planets?: number;
  note?: string;
}

/** Main-sequence anchors by spectral type (0–69: O0 … M9): temperature, mass, luminosity, radius (after Pecaut & Mamajek). */
const MS: [number, number, number, number, number][] = [
  [5, 41000, 40, 400000, 12], [10, 31000, 17, 40000, 7], [15, 15700, 4.6, 600, 3.1], [20, 9700, 2.3, 40, 2.2],
  [25, 8200, 1.9, 13, 1.7], [30, 7200, 1.6, 6, 1.5], [35, 6500, 1.35, 3, 1.3], [40, 5900, 1.08, 1.35, 1.1],
  [42, 5770, 1.0, 1.0, 1.0], [45, 5600, 0.95, 0.8, 0.93], [50, 5200, 0.85, 0.45, 0.85], [55, 4400, 0.7, 0.16, 0.7],
  [60, 3850, 0.57, 0.07, 0.6], [65, 3050, 0.16, 0.003, 0.2], [69, 2400, 0.08, 0.0003, 0.1],
];
const LETTERS = "OBAFGKM";

function mainSequence(code: number): { temp: number; mass: number; lum: number; radius: number } {
  let i = 0;
  while (i < MS.length - 2 && MS[i + 1][0] <= code) i++;
  const [c0, t0, m0, l0, r0] = MS[i], [c1, t1, m1, l1, r1] = MS[Math.min(i + 1, MS.length - 1)];
  const f = c1 === c0 ? 0 : Math.max(0, Math.min(1, (code - c0) / (c1 - c0)));
  const lerp = (a: number, b: number) => a + (b - a) * f;
  const glerp = (a: number, b: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * f);
  return { temp: glerp(t0, t1), mass: glerp(m0, m1), lum: glerp(l0, l1), radius: lerp(r0, r1) };
}

const STEFAN_T_SUN = 5772;
/** A radius (Suns) from luminosity and temperature: L = R² T⁴. */
const radiusOf = (lum: number, temp: number) => Math.sqrt(lum) * (STEFAN_T_SUN / temp) ** 2;

/** A star of a kind, from a random draw: its type, temperature, luminosity, mass and radius. */
export function starPhysics(cls: StarClass, r: () => number): Pick<Star, "spectral" | "temp" | "lum" | "mass" | "radius"> {
  const sub = Math.floor(r() * 10);
  switch (cls) {
    case "O": case "B": case "A": case "F": case "G": case "K": case "M": {
      const letter = LETTERS.indexOf(cls);
      // O stars start at O3; M dwarfs are more often late than early.
      const s = cls === "O" ? 3 + Math.floor(r() * 7) : cls === "M" ? Math.min(9, Math.floor(Math.sqrt(r()) * 10)) : sub;
      const ms = mainSequence(letter * 10 + s);
      return { spectral: `${cls}${s}V`, ...ms };
    }
    case "WD": {
      // Most white dwarfs have cooled for billions of years.
      const temp = 4500 + 25000 * r() ** 2.5;
      const radius = 0.012 * (0.9 + 0.2 * r());
      return { spectral: `D${temp > 12000 ? "A" : temp > 7000 ? "B" : "C"}${Math.max(1, Math.min(9, Math.round(50400 / temp)))}`, temp, radius, lum: radius * radius * (temp / STEFAN_T_SUN) ** 4, mass: 0.55 + 0.2 * r() };
    }
    case "BD": {
      const temp = 500 + 1800 * r();
      const spectral = temp > 1300 ? `L${Math.min(9, Math.floor((2300 - temp) / 110))}` : temp > 600 ? `T${Math.min(9, Math.floor((1300 - temp) / 80))}` : "Y0";
      const radius = 0.09 + 0.03 * r();
      return { spectral, temp, radius, lum: radius * radius * (temp / STEFAN_T_SUN) ** 4, mass: 0.02 + 0.05 * r() };
    }
    case "KIII": {
      const temp = 4900 - 700 * r(), lum = 40 + 400 * r() ** 2;
      return { spectral: `K${sub}III`, temp, lum, mass: 1 + 1.5 * r(), radius: radiusOf(lum, temp) };
    }
    case "MIII": {
      const temp = 3900 - 700 * r(), lum = 300 + 3000 * r() ** 2;
      return { spectral: `M${sub}III`, temp, lum, mass: 1 + 2 * r(), radius: radiusOf(lum, temp) };
    }
    case "RSG": {
      const temp = 3700 - 300 * r(), lum = 3e4 + 2.5e5 * r() ** 2;
      return { spectral: `M${Math.min(5, sub)}I${r() < 0.4 ? "a" : "ab"}`, temp, lum, mass: 12 + 18 * r(), radius: radiusOf(lum, temp) };
    }
    case "BSG": {
      const temp = 9000 + 21000 * r(), lum = 4e4 + 4e5 * r() ** 2;
      const letter = temp > 10000 ? "B" : "A";
      return { spectral: `${letter}${sub}Ia`, temp, lum, mass: 15 + 25 * r(), radius: radiusOf(lum, temp) };
    }
  }
}

// ---- randomness that is the same every time --------------------------------------------------------------------------

/** A 32-bit hash of integers (a murmur-style mix): the seed of a cube. */
export function hashInts(...v: number[]): number {
  let h = GALAXY_SEED ^ 0x9e3779b9;
  for (const x of v) {
    let k = Math.imul(x | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Mulberry32: a small, fast generator for a cube's own draws. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Poisson draw: how many stars, on average λ, a cube holds. */
function poisson(r: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(r)));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= r(); } while (p > L);
  return k - 1;
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
}

// ---- names -------------------------------------------------------------------------------------------------------------

const SYLLABLES = ["ka", "vor", "el", "tha", "rin", "sa", "mor", "du", "ae", "lis", "qua", "ren", "ob", "ix", "tal", "vey", "gor", "ne", "sul", "ar", "phe", "cyr", "om", "zan", "hel", "ru", "bri", "ost", "yl", "dra"];
const SUFFIXES = ["Reach", "Drift", "Expanse", "Verge", "Deep", "March", "Shoal", "Fold", "Veil", "Hollow", "Span", "Rim", "Gulf", "Tract", "Mire", "Crown"];
/** The side of a named sector, pc. */
export const SECTOR = 1000;

/** A sector of the galaxy's name, the same every time: "Ostvey Drift". */
export function sectorName(sx: number, sy: number, sz: number): string {
  const r = rngFrom(hashInts(7, sx, sy, sz));
  const n = 2 + Math.floor(r() * 2);
  let word = "";
  for (let i = 0; i < n; i++) word += SYLLABLES[Math.floor(r() * SYLLABLES.length)];
  return `${word[0].toUpperCase()}${word.slice(1)} ${SUFFIXES[Math.floor(r() * SUFFIXES.length)]}`;
}

const B36 = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** A generated star's catalogue name: its sector, its kind, and a code from its cube. */
function designation(cls: StarClass, p: Vec3, seed: number, k: number): string {
  const sx = Math.floor(p[0] / SECTOR), sy = Math.floor(p[1] / SECTOR), sz = Math.floor(p[2] / SECTOR);
  let code = "", h = hashInts(seed, k);
  for (let i = 0; i < 4; i++) { code += B36[h % B36.length]; h = Math.floor(h / B36.length); }
  const letter = cls === "WD" ? "D" : cls === "BD" ? "L" : cls[0];
  return `${sectorName(sx, sy, sz)} ${letter}${code.slice(0, 2)}-${code.slice(2)}`;
}

// ---- making the stars round a point ----------------------------------------------------------------------------------

/** The real stars, placed: the neighbourhood is the real one. */
export const REAL_STARS: Star[] = KNOWN_STARS.map((k) => {
  const pos = galacticPosition(k.ra, k.dec, k.ly);
  const parsed = parseSpectral(k.sp);
  const ms = parsed.letter >= 0 && parsed.lumClass === "V" ? mainSequence(parsed.letter * 10 + parsed.sub) : null;
  const temp = parsed.temp ?? ms?.temp ?? 5000;
  const lum = k.lum ?? ms?.lum ?? 1;
  return {
    id: `real:${k.name}`, name: k.name, cls: parsed.cls, spectral: k.sp, pos, temp, lum,
    mass: ms?.mass ?? (parsed.cls === "WD" ? 1.0 : parsed.cls === "RSG" || parsed.cls === "BSG" ? 18 : 1.5),
    radius: radiusOf(lum, temp), real: true, planets: k.planets, note: k.note,
  };
});

/** The places that are not single stars, placed. */
export const LANDMARK_POS: (Landmark & { pos: Vec3 })[] = [
  ...LANDMARKS.map((m) => ({ ...m, pos: galacticPosition(m.ra, m.dec, m.ly) })),
];
export const SGR_A: { name: string; note: string; pos: Vec3 } = {
  name: "Sagittarius A*",
  note: "The black hole at the centre of the Milky Way: four million Suns in a space smaller than Mercury's orbit, imaged by the Event Horizon Telescope in 2022.",
  pos: [0, 0, 0],
};

/** What a spectral type says: its class, its subtype, its luminosity class, and for the odd ones a temperature. */
export function parseSpectral(sp: string): { cls: StarClass; letter: number; sub: number; lumClass: string; temp?: number } {
  const s = sp.replace(/^sd/, "");
  if (s.startsWith("D")) return { cls: "WD", letter: -1, sub: 0, lumClass: "D", temp: 50400 / Math.max(1, parseFloat(s.slice(2)) || 5) };
  if (s === "LBV") return { cls: "BSG", letter: 1, sub: 0, lumClass: "Ia", temp: 25000 };
  const letter = LETTERS.indexOf(s[0]);
  const sub = parseFloat(s.slice(1)) || 0;
  const lumClass = /Ia\+|Iab|Ia|Ib/.test(s) ? "I" : /III/.test(s) ? "III" : /II/.test(s) ? "II" : /IV/.test(s) ? "IV" : "V";
  const giantTemp = letter >= 0 ? mainSequence(letter * 10 + sub).temp * (letter >= 4 ? 0.9 : 1) : undefined;
  let cls: StarClass = letter >= 0 ? (LETTERS[letter] as StarClass) : "G";
  if (lumClass === "I" || lumClass === "II") cls = letter >= 5 ? "RSG" : "BSG";
  else if (lumClass === "III") cls = letter >= 6 ? "MIII" : "KIII";
  return { cls, letter, sub, lumClass, temp: lumClass === "V" || lumClass === "IV" ? undefined : giantTemp };
}

/** Where only the real stars are: inside it, nothing is made up. */
export const KNOWN_BUBBLE_PC = 13.2 / LY_PER_PC;

/** The stars of one cube: the same every time it is asked for. */
export function starsInCell(cls: StarClass, ix: number, iy: number, iz: number): Star[] {
  const c = CLASS[cls];
  const seed = hashInts(CLASS_INDEX[cls], ix, iy, iz);
  const r = rngFrom(seed);
  const s = c.cell;
  const origin: Vec3 = [ix * s, iy * s, iz * s];
  const at = (u: number, v: number, w: number): Vec3 => [origin[0] + u * s, origin[1] + v * s, origin[2] + w * s];
  // Cubes no taller than their stars' disk is thick: the density at the centre will do. Taller ones: sampled, and
  // the stars placed where it is thickest, or the young stars of a 256-pc cube would spread far above a disk only
  // 60 pc thick.
  let lambda: number, peak = 0;
  const samples: Vec3[] = [];
  const sampled = s > POPS[c.pop].hz / 2;
  if (!sampled) {
    lambda = densityOf(cls, at(0.5, 0.5, 0.5)) * s ** 3;
  } else {
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      const q = at(((i & 1) + r()) / 2, (((i >> 1) & 1) + r()) / 2, (((i >> 2) & 1) + r()) / 2);
      const d = densityOf(cls, q);
      samples.push(q);
      sum += d; peak = Math.max(peak, d);
    }
    // The disk's midplane may pass between the samples: look there too.
    if (origin[2] <= 0 && origin[2] + s >= 0) { const d = densityOf(cls, at(0.5, 0.5, -origin[2] / s)); peak = Math.max(peak, d); sum += d; lambda = (sum / 9) * s ** 3; }
    else lambda = (sum / 8) * s ** 3;
  }
  const count = poisson(r, lambda);
  const out: Star[] = [];
  for (let k = 0; k < count; k++) {
    let pos = at(r(), r(), r());
    if (sampled && peak > 0) {
      for (let tries = 0; tries < 24; tries++) {
        const q = at(r(), r(), r());
        if (r() * peak * 1.3 < densityOf(cls, q)) { pos = q; break; }
        if (tries === 23) pos = q;
      }
    }
    // Around the Sun the real stars are the neighbourhood; nothing made up is put among them.
    if (distance(pos, SUN_POS) < KNOWN_BUBBLE_PC) continue;
    const phys = starPhysics(cls, r);
    out.push({ id: `${cls}:${ix}:${iy}:${iz}:${k}`, name: designation(cls, pos, seed, k), cls, pos, ...phys });
  }
  return out;
}

/** The star with a generated id, made again from its cube. */
export function starById(id: string): Star | null {
  if (id === SOL.id) return SOL;
  if (id.startsWith("real:")) return REAL_STARS.find((s) => s.id === id) ?? null;
  const [cls, ix, iy, iz] = id.split(":");
  if (!CLASS[cls as StarClass]) return null;
  return starsInCell(cls as StarClass, +ix, +iy, +iz).find((s) => s.id === id) ?? null;
}

export interface StarField {
  center: Vec3;
  stars: Star[];
  /** How far round the centre each kind was made (pc): the budget may have pulled it in. */
  reach: Record<StarClass, number>;
}

/** The Sun, as the map shows it: one star among the rest. */
export const SOL: Star = {
  id: "real:Sol", name: "Sol (the Sun)", cls: "G", spectral: "G2V", pos: SUN_POS, temp: 5772, lum: 1, mass: 1, radius: 1, real: true, planets: 8,
  note: "Home: an ordinary yellow dwarf, 4.6 billion years old, halfway round its 230-million-year orbit of the galaxy.",
};

/**
 * One kind of star round a point, out to its reach — drawn in where the
 * galaxy is thick, to keep within the kind's budget.
 */
export function classNear(center: Vec3, c: ClassDef, scale = 1): { stars: Star[]; reach: number } {
  const here = densityOf(c.cls, center);
  const byBudget = here > 0 ? Math.cbrt(c.budget / ((4 / 3) * Math.PI * here)) : c.reach;
  const r = Math.max(c.cell, Math.min(c.reach * scale, byBudget));
  const s = c.cell, stars: Star[] = [];
  const lo = center.map((v) => Math.floor((v - r) / s)), hi = center.map((v) => Math.floor((v + r) / s));
  const slack = (s * Math.sqrt(3)) / 2;
  for (let ix = lo[0]; ix <= hi[0]; ix++) for (let iy = lo[1]; iy <= hi[1]; iy++) for (let iz = lo[2]; iz <= hi[2]; iz++) {
    const cx = (ix + 0.5) * s - center[0], cy = (iy + 0.5) * s - center[1], cz = (iz + 0.5) * s - center[2];
    if (Math.hypot(cx, cy, cz) > r + slack) continue;
    for (const st of starsInCell(c.cls, ix, iy, iz)) if (distance(st.pos, center) <= r) stars.push(st);
  }
  return { stars, reach: r };
}

/** The real stars (and the Sun) within a distance of a point. */
export function realNear(center: Vec3, r: number): Star[] {
  return [SOL, ...REAL_STARS].filter((st) => distance(st.pos, center) <= r);
}

/**
 * Every star round a point, out to each kind's reach — the rare bright kinds
 * far, the common dim ones near — and the real ones among them.
 */
export function starsNear(center: Vec3, scale = 1): StarField {
  const stars: Star[] = [];
  const reach = {} as Record<StarClass, number>;
  for (const c of CLASSES) {
    const got = classNear(center, c, scale);
    reach[c.cls] = got.reach;
    stars.push(...got.stars);
  }
  stars.push(...realNear(center, Math.max(reach.O, 60)));
  return { center, stars, reach };
}

// ---- the galaxy as a whole -------------------------------------------------------------------------------------------

/** Which part of the galaxy a point is in, in words. */
export function regionAt(p: Vec3): string {
  const R = Math.hypot(p[0], p[1]) / 1000, z = Math.abs(p[2]);
  if (Math.hypot(p[0], p[1], p[2]) < 30) return "the Galactic Centre";
  if (barAt(p) > 0.35) return R < 1 ? "the bulge" : "the Galactic bar";
  if (z > 2500) return "the stellar halo";
  if (R > 16) return "beyond the edge of the disk";
  const a = armAt(R, Math.atan2(p[1], p[0]));
  if (a.arm && a.value > 0.3) return `the ${a.arm}`;
  if (z > 800) return "the thick disk, above the plane";
  return R > 13 ? "the outer disk" : "the disk, between the arms";
}

/**
 * Roughly how many stars the galaxy holds: each population's parts integrated
 * — the disks over the plane (their exponential thickness integrates to twice
 * the scale height), the bar as the ellipsoid it is (∫e^−s dV = 8πabc), the
 * halo in shells — and scaled by each kind's density here.
 */
export function totalStars(): number {
  const R0k = R0 / 1000, dR = 250, nT = 48, dT = (2 * Math.PI) / nT;
  let total = 0;
  for (const pop of ["young", "mid", "old"] as Population[]) {
    const q = POPS[pop];
    let thin = 0, thick = 0;
    for (let R = dR / 2; R < 20000; R += dR) {
      const Rk = R / 1000;
      const inner = 0.25 + 0.75 * smooth(1.2, 3.5, Rk), outer = Rk > 15 ? Math.exp(-(Rk - 15) / 1.2) : 1;
      for (let t = 0; t < nT; t++) {
        const arms = 1 + q.arm * armAt(Rk, t * dT).value;
        thin += Math.exp(-(Rk - R0k) / 2.6) * arms * inner * outer * R * dR * dT;
        thick += Math.exp(-(Rk - R0k) / 2.0) * outer * R * dR * dT;
      }
    }
    thin *= 2 * q.hz;
    thick *= q.thick * 2 * 900;
    const bar = q.bulge * 8 * Math.PI * BAR.a * BAR.b * BAR.c * 1e9;
    let halo = 0;
    if (q.halo) for (let rr = 50; rr < 60000; rr += 100) halo += q.halo * Math.pow(Math.max(rr / 1000, 1) / R0k, -3.5) * 4 * Math.PI * rr * rr * 100 * 0.7;
    const perPop = (thin + thick + bar + halo) / SHAPE_AT_SUN[pop];
    for (const c of CLASSES) if (c.pop === pop) total += c.n * perPop;
  }
  return total;
}

/** A point cloud of the whole galaxy for the map, seeded: old disk, bar, young arms, glowing nebulae, dust, clusters. */
export interface CloudPoint { pos: Vec3; color: [number, number, number]; size: number; dark?: boolean }

export function galaxyCloud(counts = { disk: 50000, bar: 32000, young: 38000, hii: 2500, dust: 22000, globular: 150 }): CloudPoint[] {
  const r = rngFrom(hashInts(99, 1));
  const out: CloudPoint[] = [];
  const gamma2 = (scale: number) => -scale * Math.log(Math.max(1e-12, r() * r()));
  const laplace = (h: number) => (r() < 0.5 ? -1 : 1) * -h * Math.log(Math.max(1e-12, r()));
  const disk = (hz: number, armBoost: number, shift = 1): Vec3 | null => {
    const R = gamma2(2600);
    if (R > 18000) return null;
    const th = r() * 2 * Math.PI;
    const inner = 0.25 + 0.75 * smooth(1200, 3500, R);
    const arm = armAt((R / 1000) * shift, th).value;
    if (r() > inner * (1 + armBoost * arm) / (1 + armBoost)) return null;
    return [R * Math.cos(th), R * Math.sin(th), laplace(hz)];
  };
  let guard = 0;
  const fill = (n: number, make: () => CloudPoint | null) => {
    for (let i = 0; i < n && guard < 5e6; guard++) { const p = make(); if (p) { out.push(p); i++; } }
  };
  fill(counts.disk, () => { const p = disk(300, 0.35); return p && { pos: p, color: [0.8, 0.69, 0.54], size: 70 }; });
  fill(counts.bar, () => {
    // An exp(−s) ellipsoid: s from a Γ(3) distribution, direction uniform.
    const s = -Math.log(Math.max(1e-12, r() * r() * r()));
    const u = r() * 2 - 1, ph = r() * 2 * Math.PI, q = Math.sqrt(1 - u * u);
    const a = BAR.a * 1000 * s * q * Math.cos(ph), b = BAR.b * 1000 * s * q * Math.sin(ph), c = BAR.c * 1000 * s * u;
    return { pos: [a * BAR_AXIS[0] + b * BAR_SIDE[0], a * BAR_AXIS[1] + b * BAR_SIDE[1], c], color: [1.0, 0.76, 0.48], size: 90 };
  });
  // The arms' young stars outshine their numbers: a few thousand O and B stars light a whole arm.
  fill(counts.young, () => { const p = disk(80, 8); return p && { pos: p, color: [0.95, 1.15, 1.55], size: 55 }; });
  fill(counts.hii, () => { const p = disk(50, 40); return p && armAt(Math.hypot(p[0], p[1]) / 1000, Math.atan2(p[1], p[0])).value > 0.6 ? { pos: p, color: [1.6, 0.6, 0.95], size: 70 } : null; });
  // Dust lanes run along the inner edge of each arm.
  fill(counts.dust, () => { const p = disk(60, 10, 1.035); return p && { pos: p, color: [0.07, 0.05, 0.035], size: 120, dark: true }; });
  fill(counts.globular, () => {
    const rad = 1500 * Math.pow(Math.max(1e-6, r()), -0.45);
    if (rad > 40000) return null;
    const u = r() * 2 - 1, ph = r() * 2 * Math.PI, q = Math.sqrt(1 - u * u);
    return { pos: [rad * q * Math.cos(ph), rad * q * Math.sin(ph), rad * u], color: [1.0, 0.9, 0.6], size: 25 };
  });
  return out;
}

/** A star's colour from its surface temperature: red below 3,500 K, white at 6,500, blue above 10,000. */
export function tempColor(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [1500, [1.0, 0.42, 0.18]], [2500, [1.0, 0.6, 0.35]], [3500, [1.0, 0.74, 0.52]], [4500, [1.0, 0.85, 0.7]], [5500, [1.0, 0.94, 0.86]],
    [6500, [0.97, 0.97, 1.0]], [8000, [0.84, 0.89, 1.0]], [10000, [0.74, 0.81, 1.0]], [15000, [0.66, 0.75, 1.0]], [30000, [0.6, 0.7, 1.0]],
  ];
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t <= b) { const f = (t - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]; }
  }
  return stops[stops.length - 1][1];
}

/**
 * How bright a star looks from a distance (parsecs), as an apparent
 * magnitude: its absolute magnitude (the Sun's is 4.83, and each factor of
 * 2.5 in luminosity is one step brighter) dimmed by five magnitudes for every
 * tenfold step of distance past ten parsecs.
 */
export function apparentMagnitude(lum: number, pc: number): number {
  return 4.83 - 2.5 * Math.log10(Math.max(1e-12, lum)) + 5 * Math.log10(Math.max(1e-6, pc) / 10);
}

/** What a star's planets are likely to be, before anyone has been there: how many, and where water could be liquid (AU). */
export function systemOutlook(st: Star): { planets: number; habitable: [number, number] | null } {
  const r = rngFrom(hashInts(11, ...st.id.split("").map((ch) => ch.charCodeAt(0))));
  const mean = st.cls === "G" || st.cls === "K" ? 5 : st.cls === "M" || st.cls === "F" ? 3.5 : st.cls === "A" ? 2.5
    : st.cls === "WD" || st.cls === "BD" ? 0.6 : st.cls === "KIII" || st.cls === "MIII" ? 2 : 0.8;
  const planets = st.planets ?? poisson(r, mean);
  const hz: [number, number] | null = st.cls === "BD" || st.lum > 1e4 ? null : [Math.sqrt(st.lum / 1.1), Math.sqrt(st.lum / 0.53)];
  return { planets, habitable: hz };
}
