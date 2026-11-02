/**
 * What a world is like to stand on: its kind, its ground, how warm, how
 * heavy, what air (if any), what fills its low places, and whether anything
 * lives there. Every world the ship can reach carries one of these — the
 * Solar System's from what the probes found (below), every other star's from
 * the system generator (systems.ts) — and it is what the surface generator
 * builds the ground from, the painter colours the globe by, and the landing
 * checks before it will set the ship down.
 */

export type WorldType =
  | "lava" | "iron" | "barren" | "martian" | "hothouse" | "desert" | "terran" | "ocean" | "tundra"
  | "icy" | "volcanic" | "haze" | "nitrogen"
  | "minineptune" | "icegiant" | "gasgiant" | "hotjupiter";

/** The kinds of ground a world can have: what the surface generator and the globe painter build from. */
export type Surface = "lunar" | "martian" | "volcanic" | "lava" | "hothouse" | "icy" | "nitrogen" | "haze" | "terran" | "ocean" | "desert" | "tundra";

export type Life = "none" | "microbial" | "plants" | "animals";

export interface Air {
  /** Surface pressure, bar (Earth 1). */
  pressure: number;
  /** Whether a person could breathe it unaided: only an Earth-like mix, neither too thin nor too thick. */
  breathable: boolean;
  /** The sky by day, seen from the ground. */
  sky: string;
  /** The air seen edge-on from orbit. */
  glow: string;
}

export interface WorldInfo {
  type: WorldType;
  /** Null for a world with no ground to stand on: the giants and the mini-Neptunes. */
  surface: Surface | null;
  /** Mean temperature at the surface (for a giant, at the one-bar level), K. */
  temp: number;
  /** Surface gravity, in Earth gravities. */
  gravity: number;
  air: Air | null;
  /** What pools in the low ground. */
  liquid: "water" | "lava" | "methane" | null;
  life: Life;
  /** Ground, rock, and an accent (ice caps, salt, frost); plants and sea where there are any. */
  palette: { ground: string; rock: string; accent: string; flora?: string; sea?: string };
  /** For the surface generator: the same world from the same seed. */
  seed: number;
  /** Where water could stay liquid on the surface. */
  habitable: boolean;
  /**
   * Where the facts come from: the Solar System's own ("solar"), a planet in
   * the catalogues ("known"), a real planet whose details are the game's
   * estimate ("approx"), a world the game adds round a real star where none
   * is known ("hypothetical"), or round a made-up star ("generated").
   */
  status: "solar" | "known" | "approx" | "hypothetical" | "generated";
}

export const WORLD_LABEL: Record<WorldType, string> = {
  lava: "Lava world", iron: "Iron world", barren: "Barren rock", martian: "Cold desert", hothouse: "Hothouse world",
  desert: "Desert world", terran: "Earth-like world", ocean: "Ocean world", tundra: "Tundra world", icy: "Ice world",
  volcanic: "Volcanic world", haze: "Hazy world", nitrogen: "Frozen world",
  minineptune: "Mini-Neptune", icegiant: "Ice giant", gasgiant: "Gas giant", hotjupiter: "Hot Jupiter",
};

/** The ground each kind of world has, or null for the giants. */
export const SURFACE_OF: Record<WorldType, Surface | null> = {
  lava: "lava", iron: "lunar", barren: "lunar", martian: "martian", hothouse: "hothouse", desert: "desert", terran: "terran",
  ocean: "ocean", tundra: "tundra", icy: "icy", volcanic: "volcanic", haze: "haze", nitrogen: "nitrogen",
  minineptune: null, icegiant: null, gasgiant: null, hotjupiter: null,
};

/** The smallest world with ground enough to land on and walk, km: below it the ground would be a rubble pile a few kilometres round. */
export const LANDABLE_RADIUS = 150;

/** Earth's surface gravity, km/s² — a GM over a radius squared, divided by this, is gravities. */
export const G0 = 0.00980665;

/** The surface gravity of a body (g) from its GM (km³/s²) and radius (km). */
export const gravityOf = (gm: number, radius: number): number => gm / (radius * radius) / G0;

/**
 * Air for the flight model (newton.ts): scale height (km), density at the
 * ground (kg/m³) and where it stops mattering. The scale height is RT/Mg —
 * warmer and lighter air stands taller — with a mean molecular mass for the
 * kind of air; density is the ideal gas at the surface.
 */
export function flightAir(w: WorldInfo): { H: number; rho0: number; top: number } | null {
  if (!w.air || w.air.pressure < 0.001) return null;
  const hydrogen = w.type === "minineptune" || w.type === "icegiant" || w.type === "gasgiant" || w.type === "hotjupiter";
  const molar = hydrogen ? 0.0023 : w.type === "hothouse" || w.type === "martian" ? 0.044 : 0.029;
  const g = Math.max(0.05, w.gravity) * 9.80665;
  const H = (8.314 * w.temp) / (molar * g) / 1000;
  const rho0 = (w.air.pressure * 100000 * molar) / (8.314 * w.temp);
  return { H, rho0, top: Math.min(3000, H * 17) };
}

// ---- the Solar System's worlds ----------------------------------------------------------------------------------

type SolWorld = Omit<WorldInfo, "gravity" | "seed" | "status" | "habitable"> & { gm?: number };

const rockyGrey = { ground: "#9a978f", rock: "#5f5d59", accent: "#c8c4bc" };
const iceGrey = { ground: "#c8c8c4", rock: "#9a9a98", accent: "#e8e8e8" };
const uranian = { ground: "#8a8a88", rock: "#5a5a58", accent: "#b8b8b4" };

/**
 * The Solar System's worlds with ground to stand on, from the probes and the
 * telescopes: mean surface temperatures, airs and colours rounded to what
 * shows. The Earth is not here — it is the overworld itself.
 */
export const SOL_WORLDS: Record<string, SolWorld> = {
  mercury: { type: "iron", surface: "lunar", temp: 440, air: null, liquid: null, life: "none", palette: { ground: "#8a857e", rock: "#6a6660", accent: "#b0a898" } },
  venus: {
    type: "hothouse", surface: "hothouse", temp: 737, liquid: null, life: "none",
    air: { pressure: 92, breathable: false, sky: "#d8a860", glow: "#f2dca0" }, palette: { ground: "#7a5a3a", rock: "#4a3a2a", accent: "#c89050" },
  },
  mars: {
    type: "martian", surface: "martian", temp: 210, liquid: null, life: "none",
    air: { pressure: 0.006, breathable: false, sky: "#c8a07a", glow: "#d99a6c" }, palette: { ground: "#b5582c", rock: "#7c3b22", accent: "#ecdcd0" },
  },
  moon: { type: "barren", surface: "lunar", temp: 250, air: null, liquid: null, life: "none", palette: rockyGrey },
  io: { type: "volcanic", surface: "volcanic", temp: 110, air: null, liquid: "lava", life: "none", palette: { ground: "#e0cc50", rock: "#8a4a1e", accent: "#f0f0c8" } },
  europa: { type: "icy", surface: "icy", temp: 102, air: null, liquid: null, life: "none", palette: { ground: "#e4e0d6", rock: "#b0907a", accent: "#9ab8d0" } },
  ganymede: { type: "icy", surface: "icy", temp: 110, air: null, liquid: null, life: "none", palette: { ground: "#b0a898", rock: "#6a625a", accent: "#e0e0e8" } },
  callisto: { type: "icy", surface: "icy", temp: 134, air: null, liquid: null, life: "none", palette: { ground: "#6a5e52", rock: "#4a4038", accent: "#d8d8e0" } },
  mimas: { type: "icy", surface: "icy", temp: 64, air: null, liquid: null, life: "none", palette: iceGrey },
  enceladus: { type: "icy", surface: "icy", temp: 75, air: null, liquid: null, life: "none", palette: { ground: "#f4f8fc", rock: "#c8d8e8", accent: "#a0c8f0" } },
  tethys: { type: "icy", surface: "icy", temp: 86, air: null, liquid: null, life: "none", palette: iceGrey },
  dione: { type: "icy", surface: "icy", temp: 87, air: null, liquid: null, life: "none", palette: iceGrey },
  rhea: { type: "icy", surface: "icy", temp: 76, air: null, liquid: null, life: "none", palette: iceGrey },
  titan: {
    type: "haze", surface: "haze", temp: 94, liquid: "methane", life: "none",
    air: { pressure: 1.45, breathable: false, sky: "#d09040", glow: "#e0a050" }, palette: { ground: "#8a6a38", rock: "#5a4a30", accent: "#c89a50", sea: "#26262c" },
  },
  iapetus: { type: "icy", surface: "icy", temp: 110, air: null, liquid: null, life: "none", palette: { ground: "#d8d4cc", rock: "#3a2a20", accent: "#8a6a50" } },
  miranda: { type: "icy", surface: "icy", temp: 60, air: null, liquid: null, life: "none", palette: uranian },
  ariel: { type: "icy", surface: "icy", temp: 60, air: null, liquid: null, life: "none", palette: uranian },
  umbriel: { type: "icy", surface: "icy", temp: 75, air: null, liquid: null, life: "none", palette: { ground: "#5a5a58", rock: "#3a3a38", accent: "#d0d0c8" } },
  titania: { type: "icy", surface: "icy", temp: 70, air: null, liquid: null, life: "none", palette: uranian },
  oberon: { type: "icy", surface: "icy", temp: 75, air: null, liquid: null, life: "none", palette: { ground: "#7a7470", rock: "#4e4844", accent: "#b8b0a8" } },
  triton: { type: "nitrogen", surface: "nitrogen", temp: 38, air: null, liquid: null, life: "none", palette: { ground: "#e8d8d0", rock: "#b89080", accent: "#a07060" } },
  proteus: { type: "barren", surface: "lunar", temp: 51, air: null, liquid: null, life: "none", palette: { ground: "#4a4846", rock: "#34322f", accent: "#6a6660" } },
  nereid: { type: "icy", surface: "icy", temp: 50, air: null, liquid: null, life: "none", palette: iceGrey },
  pluto: { type: "nitrogen", surface: "nitrogen", temp: 44, air: null, liquid: null, life: "none", palette: { ground: "#e8dcd0", rock: "#8a5a3a", accent: "#f4e8f0" } },
  charon: { type: "icy", surface: "icy", temp: 53, air: null, liquid: null, life: "none", palette: { ground: "#9a9690", rock: "#6a6660", accent: "#8a4a38" } },
  ceres: { type: "barren", surface: "lunar", temp: 168, air: null, liquid: null, life: "none", palette: { ground: "#5a5854", rock: "#3e3c3a", accent: "#f0f0ec" } },
  eris: { type: "nitrogen", surface: "nitrogen", temp: 42, air: null, liquid: null, life: "none", palette: { ground: "#f0eee8", rock: "#c8c0b8", accent: "#ffffff" } },
  haumea: { type: "icy", surface: "icy", temp: 50, air: null, liquid: null, life: "none", palette: { ground: "#e8e8e4", rock: "#a8a49c", accent: "#b04030" } },
  makemake: { type: "nitrogen", surface: "nitrogen", temp: 35, air: null, liquid: null, life: "none", palette: { ground: "#d8b8a0", rock: "#a07860", accent: "#f0e0d0" } },
  sedna: { type: "nitrogen", surface: "nitrogen", temp: 14, air: null, liquid: null, life: "none", palette: { ground: "#b05a3a", rock: "#7a3a24", accent: "#d08060" } },
  quaoar: { type: "icy", surface: "icy", temp: 44, air: null, liquid: null, life: "none", palette: { ground: "#9a6a50", rock: "#6a4a38", accent: "#c8a890" } },
  vesta: { type: "barren", surface: "lunar", temp: 170, air: null, liquid: null, life: "none", palette: { ground: "#8c8a86", rock: "#5e5a54", accent: "#bab6ae" } },
  pallas: { type: "barren", surface: "lunar", temp: 164, air: null, liquid: null, life: "none", palette: { ground: "#7a7874", rock: "#54524e", accent: "#a8a49c" } },
  hygiea: { type: "barren", surface: "lunar", temp: 160, air: null, liquid: null, life: "none", palette: { ground: "#4a4846", rock: "#34322f", accent: "#6a6660" } },
};

/** A small hash of a body's id, for its surface's seed. */
export function seedOfText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The Solar System body's world, if it has ground to stand on (the Earth is the overworld, not one of these). */
export function solWorld(id: string, gm: number | undefined, radius: number): WorldInfo | null {
  const w = SOL_WORLDS[id];
  if (!w || radius < LANDABLE_RADIUS) return null;
  // Small moons without a measured GM: ice at 1.2 t/m³ if icy, rock at 2.5.
  const mass = gm ?? 6.6743e-20 * (4 / 3) * Math.PI * Math.pow(radius * 1000, 3) * (w.type === "icy" || w.type === "nitrogen" ? 1200 : 2500);
  return { ...w, gravity: gravityOf(mass, radius), seed: seedOfText(`sol:${id}`), status: "solar", habitable: false };
}
