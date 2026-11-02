/**
 * The cities of the crime-sandbox modes: a grid of avenues and streets,
 * districts with their own buildings, a shore, landmarks — and the lanes the
 * traffic drives and the sidewalks the pedestrians walk.
 *
 * A city is far too big to stamp block by block up front the way the other
 * map packs are (Neon Bay is some five hundred blocks across, and half its
 * towers are fifty tall), so it is a function instead: `fill` builds any one
 * chunk from the seed on demand, in the worker that generates it. Every
 * building is decided per lot from a hash of the seed and the lot, so the
 * same chunk comes out the same wherever it is built, and a building that
 * straddles four chunks is stamped four times, a quarter at a time, through
 * a setter clipped to the chunk being made.
 *
 * Street level is one block above the sea, flat everywhere, sidewalks
 * included: a car has no business climbing a curb, and a curb the physics
 * could not climb would trap every car that touched one.
 *
 * Right-hand traffic. An avenue runs north–south; a street east–west. Each
 * road is nine blocks of asphalt — a four-block lane each way and a centre
 * line — with a two-block sidewalk either side.
 */
import { B, WOOL_COLORS } from "./blocks";
import { blockIndex, SEA_LEVEL, WORLD_HEIGHT } from "./constants";
import { hash4, hashFloat } from "./rng";
import type { GeneratedChunk } from "./worldgen";
import type { ShopKind } from "./shops";

/** The top block of street level; feet stand a block above it. */
export const GROUND = SEA_LEVEL + 1;
export const STREET = GROUND + 1;
/** One road and one lot, repeated: a road corridor (sidewalk, asphalt, sidewalk) then a city block. */
export const PITCH = 40;
export const ROAD = 13;
export const LOT = PITCH - ROAD;
const SIDE = 2;

const wool = (c: (typeof WOOL_COLORS)[number]) => B.WHITE_WOOL + WOOL_COLORS.indexOf(c);

export type CityId = "neon_bay" | "golden_coast";
export type District = "strip" | "beach" | "downtown" | "midtown" | "little" | "docks" | "park" | "villas" | "desert" | "suburb" | "vegas";
export type LandmarkKind = "police" | "hospital" | "guns" | "respray" | "casino" | "tower" | "mall" | "safehouse" | "dealer";

export interface Landmark {
  kind: LandmarkKind;
  name: string;
  /** What its sign says, where the default will not do (the other city's police are not the NBPD). */
  sign?: string;
  /** The lot it stands on. */
  i: number;
  j: number;
}

export interface CitySpec {
  id: CityId;
  name: string;
  /** Lots along x and along z. */
  cols: number;
  rows: number;
  /** The west edge of the first avenue and the north edge of the first street. */
  x0: number;
  z0: number;
  district(i: number, j: number): District;
  landmarks: Landmark[];
  /** Avenue names west to east (cols + 1 of them) and street names north to south (rows + 1). */
  avenues: string[];
  streets: string[];
  /** What each district is called on the screen when you drive into it. */
  districtNames: Record<District, string>;
  /** Sand beyond the east avenue before the sea, in blocks; the other shores are a verge and a sea wall. */
  beach: number;
  /** Sand, not grass, wherever a lot is not paved (a desert city). */
  dry?: boolean;
}

/** A lane: which road (an avenue runs along z, a street along x), and which way along it. */
export interface Lane {
  axis: "x" | "z";
  road: number;
  dir: 1 | -1;
}

// ---- the two cities ----------------------------------------------------------------------------

const NEON_DISTRICTS: Record<District, string> = {
  strip: "Neon Drive", beach: "Glowstick Beach", downtown: "Downtown Doge", midtown: "Mid Town", little: "Little Stonkville",
  docks: "Copium Docks", park: "Touch Grass Park", villas: "Rizz Hills", desert: "The Salt Flats", suburb: "Boomerville", vegas: "The Glitter Mile",
};

/**
 * Neon Bay: an island city of pastel hotels on a beach strip, a glass
 * downtown, docks to the south, and a park in the middle — after the
 * seaside city of the 1980s crime games, with its own streets and people.
 */
export const NEON_BAY: CitySpec = {
  id: "neon_bay",
  name: "Neon Bay",
  cols: 12, rows: 12,
  x0: -246, z0: -246,
  district(i, j) {
    if (i === 11) return "strip";
    if (i >= 9) return "beach";
    if (j === 11 && i <= 7) return "docks";
    if (i >= 4 && i <= 5 && j >= 7 && j <= 8) return "park";
    if (i >= 4 && i <= 7 && j >= 1 && j <= 5) return "downtown";
    if (j === 0 && i <= 3) return "villas";
    if (i <= 2) return "little";
    return "midtown";
  },
  landmarks: [
    { kind: "safehouse", name: "Your Crib", i: 10, j: 6 },
    { kind: "police", name: "NBPD", i: 6, j: 6 },
    { kind: "hospital", name: "St. Ouchie's", i: 3, j: 5 },
    { kind: "guns", name: "Bullet Bazaar", i: 2, j: 3 },
    { kind: "respray", name: "Spray & Pray", i: 8, j: 8 },
    { kind: "casino", name: "The Lucky Doge", i: 10, j: 3 },
    { kind: "tower", name: "Stonks Tower", i: 6, j: 3 },
    { kind: "mall", name: "Mall of Copium", i: 3, j: 9 },
    { kind: "dealer", name: "Yeet Motors", i: 8, j: 2 },
  ],
  avenues: ["Ohio Ave", "Sigma Ave", "Bonk Blvd", "Doge Ave", "Stonks Ave", "HODL Ave", "Moon Ave", "Rizz Ave", "Vibe Ave", "Yeet Ave", "Pastel Ave", "Flamingo Ave", "Neon Drive"],
  streets: ["Skibidi St", "Sus St", "Copium St", "Based St", "Cringe St", "Chad St", "Boomer St", "Zoomer St", "Mid St", "Salty St", "Vaporwave St", "Dock St", "Harbor Way"],
  districtNames: NEON_DISTRICTS,
  beach: 44,
};

/**
 * Golden Coast: San Yeeto, a sprawl in a sunny state — desert to the north
 * and west, a casino strip glittering out of the sand, a downtown of towers,
 * suburbs of lawns and palm trees, docks, and a beach along the east — after
 * the crime-sandbox games' sunny-state city and its desert gambling town,
 * with its own streets and people.
 */
export const GOLDEN_COAST: CitySpec = {
  id: "golden_coast",
  name: "Golden Coast",
  cols: 14, rows: 12,
  x0: -290, z0: -250,
  dry: true,
  district(i, j) {
    if (i === 13) return j >= 5 ? "strip" : "vegas";
    if (i >= 9 && j <= 4) return "vegas";
    if (i >= 11) return "beach";
    if (j <= 1 || i <= 1) return i <= 2 && j >= 8 ? "villas" : "desert";
    if (j === 11 && i <= 8) return "docks";
    if (i >= 6 && i <= 7 && j >= 7 && j <= 8) return "park";
    if (i >= 5 && i <= 8 && j >= 2 && j <= 5) return "downtown";
    if (i >= 2 && i <= 4 && j >= 3 && j <= 5) return "little";
    if (i <= 5 && j >= 6) return i === 2 && j >= 8 ? "villas" : "suburb";
    return "midtown";
  },
  landmarks: [
    { kind: "safehouse", name: "Your Other Crib", i: 4, j: 7 },
    { kind: "police", name: "SYPD", i: 7, j: 6, sign: "SYPD" },
    { kind: "hospital", name: "Mercy Me General", i: 3, j: 4 },
    { kind: "guns", name: "Bullet Bazaar West", i: 2, j: 5 },
    { kind: "respray", name: "Spray & Pray West", i: 8, j: 9 },
    { kind: "casino", name: "The Golden Stonk", i: 10, j: 2, sign: "STONK" },
    { kind: "tower", name: "Hodl Tower", i: 6, j: 3, sign: "HODL" },
    { kind: "mall", name: "Mall of Copium West", i: 5, j: 9, sign: "COPE" },
    { kind: "dealer", name: "Yeet Motors West", i: 9, j: 6 },
  ],
  avenues: ["Tumbleweed Ave", "Cactus Blvd", "Mirage Ave", "Dune Rd", "Sunburn Ave", "Heatwave Blvd", "Jackpot Ave", "Snake Eyes Ave", "Double Down Dr",
    "High Roller Ave", "Big Blind Blvd", "All-In Ave", "Royal Flush Rd", "Bust Ave", "Coast Hwy"],
  streets: ["Dry Heat St", "Mesa St", "Adobe St", "Sagebrush St", "Coyote St", "Lowrider Ln", "Hood St", "Boomer Blvd", "Salsa St", "Taco Tuesday St",
    "Surf St", "Boardwalk", "Pier Rd"],
  districtNames: {
    strip: "Surf Row", beach: "Sunburn Beach", downtown: "Downtown San Yeeto", midtown: "Mid Yeeto", little: "Taco Town", docks: "Rustbucket Docks",
    park: "Chill Pill Park", villas: "Clout Canyon", desert: "The Salty Flats", suburb: "Boomerville", vegas: "The Yeet Strip",
  },
  beach: 40,
};

export const CITIES: Record<CityId, CitySpec> = { neon_bay: NEON_BAY, golden_coast: GOLDEN_COAST };

// ---- lots ------------------------------------------------------------------------------------------

type Style = "glass" | "deco" | "brick" | "warehouse" | "villa" | "civic";

/** One box of a building: its footprint, the height it starts at and how tall it is, and how it is dressed. */
interface Building {
  x0: number; z0: number; x1: number; z1: number;
  y0: number; h: number;
  style: Style;
  wall: number;
  trim: number;
  /** The chance a window is lit. */
  lit: number;
  /** A shop's or a lobby's ground floor you can walk into. */
  open: boolean;
  /** Neon up the corners. */
  neon?: number;
  /** No parapet: a lower tier with another on top of it. */
  capped?: boolean;
}

export interface Sign { text: string; x: number; y: number; z: number; dx: number; dz: number; id: number; back?: number }

export interface LotPlan {
  i: number;
  j: number;
  district: District;
  landmark: Landmark | null;
  /** The lot's north-west corner. */
  x0: number;
  z0: number;
  buildings: Building[];
  palms: [number, number, number][];
  trees: [number, number][];
  signs: Sign[];
  /** Where a parked car stands, and which way it faces. */
  parking: [number, number, number, number][];
  /** Anything a landmark adds by hand (a counter, a garage door, a pool). */
  extra: ((c: Clip) => void) | null;
  ground: number;
}

/**
 * A setter clipped to one chunk: everything a builder places outside it is
 * dropped, so a building can be written whole and each chunk keeps its part.
 */
export class Clip {
  readonly minX: number; readonly minZ: number;
  readonly maxX: number; readonly maxZ: number;
  constructor(readonly cx: number, readonly cz: number, readonly out: GeneratedChunk) {
    this.minX = cx * 16; this.minZ = cz * 16; this.maxX = this.minX + 15; this.maxZ = this.minZ + 15;
  }
  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ || y < 1 || y >= WORLD_HEIGHT - 1) return;
    const i = blockIndex(x - this.minX, y, z - this.minZ);
    this.out.blocks[i] = id;
    this.out.meta[i] = meta;
  }
  get(x: number, y: number, z: number): number {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ || y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.out.blocks[blockIndex(x - this.minX, y, z - this.minZ)];
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0): void {
    const ax = Math.max(x0, this.minX), bx = Math.min(x1, this.maxX), az = Math.max(z0, this.minZ), bz = Math.min(z1, this.maxZ);
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) for (let y = y0; y <= y1; y++) this.set(x, y, z, id, meta);
  }
  touches(x0: number, z0: number, x1: number, z1: number): boolean {
    return x1 >= this.minX && x0 <= this.maxX && z1 >= this.minZ && z0 <= this.maxZ;
  }
}

// ---- lettering ------------------------------------------------------------------------------------

/** Block letters three wide and five tall, for the signs on the buildings. */
const FONT: Record<string, string> = {
  A: "###|#.#|###|#.#|#.#", B: "##.|#.#|##.|#.#|##.", C: "###|#..|#..|#..|###", D: "##.|#.#|#.#|#.#|##.", E: "###|#..|##.|#..|###",
  F: "###|#..|##.|#..|#..", G: "###|#..|#.#|#.#|###", H: "#.#|#.#|###|#.#|#.#", I: "###|.#.|.#.|.#.|###", J: "..#|..#|..#|#.#|###",
  K: "#.#|##.|#..|##.|#.#", L: "#..|#..|#..|#..|###", M: "#.#|###|###|#.#|#.#", N: "#.#|###|###|###|#.#", O: "###|#.#|#.#|#.#|###",
  P: "###|#.#|###|#..|#..", Q: "###|#.#|#.#|###|..#", R: "###|#.#|##.|#.#|#.#", S: "###|#..|###|..#|###", T: "###|.#.|.#.|.#.|.#.",
  U: "#.#|#.#|#.#|#.#|###", V: "#.#|#.#|#.#|#.#|.#.", W: "#.#|#.#|###|###|#.#", X: "#.#|#.#|.#.|#.#|#.#", Y: "#.#|#.#|.#.|.#.|.#.",
  Z: "###|..#|.#.|#..|###", "0": "###|#.#|#.#|#.#|###", "1": ".#.|##.|.#.|.#.|###", "2": "###|..#|###|#..|###", "3": "###|..#|###|..#|###",
  "4": "#.#|#.#|###|..#|..#", "5": "###|#..|###|..#|###", "6": "###|#..|###|#.#|###", "7": "###|..#|..#|..#|..#", "8": "###|#.#|###|#.#|###",
  "9": "###|#.#|###|..#|###", $: ".#.|###|##.|.##|###", "!": ".#.|.#.|.#.|...|.#.", "&": ".#.|#.#|.#.|#.#|.##", "'": ".#.|.#.|...|...|...",
  ".": "...|...|...|...|.#.", "-": "...|...|###|...|...", " ": "...|...|...|...|...",
};

/** How many blocks long a sign's text runs. */
export function signLength(text: string): number {
  return Math.max(0, text.length * 4 - 1);
}

/**
 * Letters in blocks, running from (x, z) in the direction (dx, dz), their
 * baseline at y. Reading left to right for someone facing the sign means
 * the text runs to that person's right: along +x on a sign facing south,
 * along -z on one facing east.
 */
export function letter(c: Clip, s: Sign): void {
  let at = 0;
  for (const ch of s.text.toUpperCase()) {
    const rows = (FONT[ch] ?? FONT[" "]).split("|");
    rows.forEach((row, r) => [...row].forEach((px, k) => {
      const x = s.x + s.dx * (at + k), z = s.z + s.dz * (at + k), y = s.y + 4 - r;
      if (px === "#") c.set(x, y, z, s.id);
      else if (s.back !== undefined) c.set(x, y, z, s.back);
    }));
    at += 4;
  }
}

// ---- the city ------------------------------------------------------------------------------------

const PASTELS = ["pink", "light_blue", "yellow", "lime", "white", "cyan", "magenta", "orange"] as const;
const LIGHTS = [B.GLOWSTONE, B.SEA_LANTERN, B.SHROOMLIGHT, B.REDSTONE_LAMP_ON];
const HOTEL_NAMES = ["VIBES", "YEET", "RIZZ", "STONKS", "DOGE", "BONK", "SLAY", "GOAT", "HODL", "BASED", "POGGERS", "SHEESH", "NO CAP", "MID", "SUS"];

/** Road blocks: asphalt, its centre line and its crossings. What pedestrians keep off (unless running for their lives). */
export const ASPHALT = B.BLACKSTONE;
export const CENTRE_LINE = wool("yellow");
export const ZEBRA = wool("white");
/** The dark between a crossing's stripes: road to a car, crossing to a pedestrian. */
export const ZEBRA_GAP = B.COAL_BLOCK;
export const SIDEWALK = B.SMOOTH_STONE;
export const CURB = B.STONE_BRICKS;
export const isRoadBlock = (id: number): boolean => id === ASPHALT || id === CENTRE_LINE || id === ZEBRA || id === ZEBRA_GAP;

export class City {
  readonly minX: number; readonly maxX: number;
  readonly minZ: number; readonly maxZ: number;
  private readonly lots = new Map<number, LotPlan>();

  constructor(readonly spec: CitySpec, readonly seed: number) {
    this.minX = spec.x0; this.maxX = spec.x0 + spec.cols * PITCH + ROAD - 1;
    this.minZ = spec.z0; this.maxZ = spec.z0 + spec.rows * PITCH + ROAD - 1;
  }

  /** The west (or north) edge of avenue (or street) k. */
  roadStart(axis: "x" | "z", k: number): number {
    return (axis === "z" ? this.spec.x0 : this.spec.z0) + k * PITCH;
  }

  /**
   * Where a coordinate falls across the grid: on road k at offset o (0..12),
   * in lot k at offset o (0..26), or outside the city.
   */
  across(v: number, horizontal: boolean): { road: number; o: number } | { lot: number; o: number } | null {
    const count = horizontal ? this.spec.cols : this.spec.rows;
    const t = v - (horizontal ? this.spec.x0 : this.spec.z0);
    if (t < 0) return null;
    const k = Math.floor(t / PITCH), o = t - k * PITCH;
    if (o < ROAD) return k <= count ? { road: k, o } : null;
    return k < count ? { lot: k, o: o - ROAD } : null;
  }

  inside(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }

  /** The lane's line: the x of an avenue's lane, the z of a street's. Traffic keeps right. */
  laneLine(l: Lane): number {
    const start = this.roadStart(l.axis, l.road);
    const southOrEastHalf = l.axis === "z" ? l.dir === -1 : l.dir === 1;
    return start + (southOrEastHalf ? 9 : 4);
  }

  /** The lot at (i, j), planned once and kept. */
  lot(i: number, j: number): LotPlan {
    const key = i * 1000 + j;
    let p = this.lots.get(key);
    if (!p) { p = this.planLot(i, j); this.lots.set(key, p); }
    return p;
  }

  /** The district under a point, and what it is called; the sea and the shore past the grid have names of their own. */
  districtAt(x: number, z: number): { district: District | null; name: string } {
    const s = this.spec;
    if (x < this.minX - 8 || x > this.maxX + s.beach || z < this.minZ - 8 || z > this.maxZ + 8) return { district: null, name: "The Salty Sea" };
    if (x > this.maxX) return { district: "beach", name: s.districtNames.beach };
    // A road belongs to the lot past its middle.
    const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    const i = clamp(Math.floor((x - s.x0 - ROAD / 2) / PITCH), s.cols), j = clamp(Math.floor((z - s.z0 - ROAD / 2) / PITCH), s.rows);
    const d = s.district(i, j);
    return { district: d, name: s.districtNames[d] };
  }

  /** The road under a point, by name, or null off the roads. */
  streetAt(x: number, z: number): string | null {
    const ax = this.across(x, true), az = this.across(z, false);
    if (ax && "road" in ax && ax.o >= SIDE && ax.o < ROAD - SIDE) return this.spec.avenues[ax.road] ?? null;
    if (az && "road" in az && az.o >= SIDE && az.o < ROAD - SIDE) return this.spec.streets[az.road] ?? null;
    return null;
  }

  /** A landmark's lot, by kind. */
  landmark(kind: LandmarkKind): LotPlan | null {
    const l = this.spec.landmarks.find((m) => m.kind === kind);
    return l ? this.lot(l.i, l.j) : null;
  }

  /** Where a landmark's door is: the middle of its lot's street-facing side, on the sidewalk. */
  landmarkDoor(kind: LandmarkKind): [number, number, number] | null {
    const p = this.landmark(kind);
    if (!p) return null;
    return [p.x0 + LOT / 2, STREET, p.z0 + LOT + 0.5];
  }

  // ---- planning ------------------------------------------------------------------------------

  private rnd(i: number, j: number, salt: number): number {
    return hashFloat(this.seed ^ 0x5eed, i * 131 + salt, j * 173 + salt * 7, salt);
  }

  private planLot(i: number, j: number): LotPlan {
    const s = this.spec;
    const x0 = s.x0 + i * PITCH + ROAD, z0 = s.z0 + j * PITCH + ROAD;
    const district = s.district(i, j);
    const landmark = s.landmarks.find((m) => m.i === i && m.j === j) ?? null;
    const p: LotPlan = { i, j, district, landmark, x0, z0, buildings: [], palms: [], trees: [], signs: [], parking: [], extra: null, ground: s.dry ? B.SAND : B.GRASS };
    const r = (salt: number) => this.rnd(i, j, salt);
    const pick = <T,>(a: readonly T[], salt: number): T => a[Math.floor(r(salt) * a.length) % a.length];
    const X1 = x0 + LOT - 1, Z1 = z0 + LOT - 1;
    const add = (b: Omit<Building, "y0" | "open" | "lit"> & Partial<Pick<Building, "y0" | "open" | "lit">>) =>
      p.buildings.push({ y0: STREET, open: false, lit: 0.45, ...b });

    if (landmark) { this.planLandmark(p, landmark); return p; }

    switch (district) {
      case "strip": {
        // An art-deco hotel facing the sea: pastel, stacked in tiers, neon up its corners, its name on the roof.
        p.ground = B.WHITE_TERRACOTTA;
        const colour = wool(pick(PASTELS, 1));
        const h = 12 + Math.floor(r(2) * 5) * 4;
        const neon = pick([B.SEA_LANTERN, B.GLOWSTONE, B.MAGENTA_STAINED_GLASS, B.SHROOMLIGHT], 3);
        add({ x0: x0 + 3, z0: z0 + 3, x1: X1 - 5, z1: Z1 - 3, h, style: "deco", wall: colour, trim: B.QUARTZ_BLOCK, neon, open: true, capped: true });
        add({ x0: x0 + 7, z0: z0 + 7, x1: X1 - 9, z1: Z1 - 7, y0: STREET + h, h: 8, style: "deco", wall: colour, trim: B.QUARTZ_BLOCK, neon });
        // Its name stands on the lower roof, over the sea, reading right for someone on the beach.
        const name = pick(HOTEL_NAMES, 4);
        const len = signLength(name);
        if (len <= LOT - 6) p.signs.push({ text: name, x: X1 - 6, y: STREET + h, z: z0 + Math.floor((LOT + len) / 2) - 1, dx: 0, dz: -1, id: neon === B.MAGENTA_STAINED_GLASS ? B.SEA_LANTERN : neon });
        for (const z of [z0 + 1, Z1 - 1]) p.palms.push([X1 - 1, z, 7 + Math.floor(r(z) * 3)]);
        break;
      }
      case "beach": {
        // Pastel apartments over shops, and a pool behind the odd one.
        p.ground = B.WHITE_TERRACOTTA;
        const two = r(5) < 0.5;
        const spans: [number, number][] = two ? [[z0 + 2, z0 + 12], [z0 + 15, Z1 - 2]] : [[z0 + 3, Z1 - 3]];
        spans.forEach(([a, b], k) => add({
          x0: x0 + 3, z0: a, x1: X1 - 3, z1: b, h: 8 + Math.floor(r(6 + k) * 4) * 4, style: "deco", wall: wool(pick(PASTELS, 7 + k)),
          trim: B.QUARTZ_BLOCK, open: true, neon: r(9 + k) < 0.4 ? B.SEA_LANTERN : undefined,
        }));
        p.palms.push([x0 + 1, z0 + 1, 7], [X1 - 1, Z1 - 1, 8]);
        break;
      }
      case "downtown": {
        // Glass towers, stepping in as they climb.
        p.ground = B.SMOOTH_STONE;
        const h1 = 20 + Math.floor(r(1) * 5) * 4, h2 = 8 + Math.floor(r(2) * 4) * 4;
        const wall = pick([B.QUARTZ_BLOCK, B.IRON_BLOCK, wool("light_gray"), B.CALCITE, wool("cyan"), B.SMOOTH_STONE], 3);
        add({ x0: x0 + 2, z0: z0 + 2, x1: X1 - 2, z1: Z1 - 2, h: h1, style: "glass", wall, trim: wall, open: true, lit: 0.5, capped: true });
        add({ x0: x0 + 5, z0: z0 + 5, x1: X1 - 5, z1: Z1 - 5, y0: STREET + h1, h: h2, style: "glass", wall, trim: wall, lit: 0.5 });
        break;
      }
      case "midtown": {
        const kind = r(1);
        if (kind < 0.12) { this.planParking(p); break; }
        if (kind < 0.22) { this.planPark(p, false); break; }
        p.ground = B.SMOOTH_STONE;
        if (kind < 0.55) {
          add({ x0: x0 + 2, z0: z0 + 2, x1: X1 - 2, z1: Z1 - 2, h: 12 + Math.floor(r(2) * 6) * 4, style: r(3) < 0.5 ? "glass" : "brick",
            wall: pick([B.BRICKS, B.STONE_BRICKS, B.WHITE_TERRACOTTA, wool("light_gray"), B.SANDSTONE], 4), trim: B.SMOOTH_STONE, open: true, lit: 0.45 });
        } else this.planQuad(p, [B.BRICKS, B.WHITE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA, B.SANDSTONE, wool("light_blue")], 4, 12);
        break;
      }
      case "little": {
        p.ground = B.SMOOTH_STONE;
        if (r(1) < 0.2) { this.planParking(p); break; }
        this.planQuad(p, [B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA, B.RED_TERRACOTTA, wool("lime"), wool("pink"), wool("light_blue"), B.WHITE_TERRACOTTA], 4, 8);
        break;
      }
      case "docks": {
        // Warehouses in a yard of stacked containers.
        p.ground = B.ANDESITE;
        add({ x0: x0 + 2, z0: z0 + 2, x1: X1 - 9, z1: Z1 - 2, h: 9 + Math.floor(r(1) * 3) * 2, style: "warehouse",
          wall: pick([B.IRON_BLOCK, wool("light_gray"), B.TERRACOTTA, wool("gray")], 2), trim: B.IRON_BLOCK, lit: 0.1 });
        p.extra = (c) => {
          for (let k = 0; k < 4; k++) {
            const cz = z0 + 2 + k * 6, colour = wool(pick(["red", "blue", "orange", "green", "yellow", "gray"], 10 + k));
            const high = 1 + Math.floor(r(20 + k) * 2);
            for (let t = 0; t < high; t++) c.box(X1 - 6, STREET + t * 3, cz, X1 - 2, STREET + t * 3 + 2, cz + 3, t % 2 ? wool(pick(["cyan", "purple", "brown"], 30 + k)) : colour);
          }
        };
        break;
      }
      case "park": this.planPark(p, true); break;
      case "villas": {
        // A villa with a pool and palms: the hills' idea of modest.
        const colour = wool(pick(["white", "pink", "yellow", "light_blue"], 1));
        add({ x0: x0 + 4, z0: z0 + 3, x1: X1 - 4, z1: z0 + 13, h: 8, style: "villa", wall: colour, trim: B.QUARTZ_BLOCK, open: true, lit: 0.5 });
        p.extra = (c) => {
          c.box(x0 + 6, GROUND - 1, z0 + 16, X1 - 6, GROUND, Z1 - 4, B.WATER);
          c.box(x0 + 5, GROUND, z0 + 15, X1 - 5, GROUND, z0 + 15, B.QUARTZ_BLOCK);
          c.box(x0 + 5, GROUND, Z1 - 3, X1 - 5, GROUND, Z1 - 3, B.QUARTZ_BLOCK);
        };
        p.palms.push([x0 + 2, Z1 - 2, 7], [X1 - 2, Z1 - 2, 8], [x0 + 2, z0 + 15, 6]);
        break;
      }
      case "desert": this.planDesert(p); break;
      case "suburb": {
        // Lawns kept green against the desert, and a palm to every house.
        p.ground = B.GRASS;
        this.planQuad(p, [wool("white"), wool("yellow"), wool("light_blue"), B.WHITE_TERRACOTTA, B.ORANGE_TERRACOTTA, wool("pink")], 4, 4);
        for (const b of p.buildings) { b.style = "villa"; b.x0 += 1; b.z0 += 1; b.x1 -= 1; b.z1 -= 1; }
        for (const [dx, dz] of [[1, 1], [LOT - 2, 1], [1, LOT - 2], [LOT - 2, LOT - 2]]) p.palms.push([x0 + dx, z0 + dz, 5 + Math.floor(r(dx + dz) * 3)]);
        break;
      }
      case "vegas": {
        // A casino hotel: a gold-trimmed tower on a podium, its name in lights, a fountain out front.
        p.ground = B.WHITE_TERRACOTTA;
        const wall = wool(pick(["yellow", "magenta", "red", "purple", "white", "cyan"], 1));
        const h = 24 + Math.floor(r(2) * 6) * 4;
        const neon = pick([B.GLOWSTONE, B.SEA_LANTERN, B.SHROOMLIGHT], 3);
        add({ x0: x0 + 2, z0: z0 + 2, x1: X1 - 2, z1: z0 + 16, h: 8, style: "deco", wall, trim: B.GOLD_BLOCK, neon, open: true, capped: true, lit: 0.8 });
        add({ x0: x0 + 5, z0: z0 + 4, x1: X1 - 5, z1: z0 + 13, y0: STREET + 8, h, style: "glass", wall: B.GOLD_BLOCK, trim: B.GOLD_BLOCK, lit: 0.8 });
        const name = pick(["YOLO", "LUCKY", "BONK", "RICH", "STONK", "HODL", "WOW", "ALLIN", "SLAY", "BASED"], 4);
        const len = signLength(name);
        p.signs.push({ text: name, x: x0 + Math.floor((LOT - len) / 2), y: STREET + 8 + h - 6, z: z0 + 14, dx: 1, dz: 0, id: neon });
        p.extra = (c) => {
          const mx = x0 + 13, mz = Z1 - 5;
          for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
            const d = Math.hypot(dx, dz);
            if (d <= 3.4) c.set(mx + dx, GROUND, mz + dz, d > 2.4 ? B.GOLD_BLOCK : B.WATER);
          }
          c.box(mx, STREET, mz, mx, STREET + 3, mz, B.QUARTZ_BLOCK);
          c.set(mx, STREET + 4, mz, B.GLOWSTONE);
        };
        p.palms.push([x0 + 1, Z1 - 1, 7], [X1 - 1, Z1 - 1, 7]);
        break;
      }
    }
    return p;
  }

  /** The desert: a motel, a gas station, or sand with cacti and dead bushes. */
  private planDesert(p: LotPlan): void {
    const X1 = p.x0 + LOT - 1, Z1 = p.z0 + LOT - 1;
    const r = (salt: number) => this.rnd(p.i, p.j, salt);
    p.ground = B.SAND;
    const kind = r(1);
    const b = (x0: number, z0: number, x1: number, z1: number, h: number, wall: number, trim: number, extra: Partial<Building> = {}) =>
      p.buildings.push({ x0, z0, x1, z1, y0: STREET, h, style: "villa", wall, trim, lit: 0.5, open: true, ...extra });
    if (kind < 0.4) {
      // A motel: a long low block of rooms, its name on the roof, its pool empty.
      b(p.x0 + 2, p.z0 + 2, X1 - 2, p.z0 + 8, 5, wool(r(2) < 0.5 ? "pink" : "cyan"), B.WHITE_TERRACOTTA);
      b(p.x0 + 2, p.z0 + 9, p.x0 + 8, Z1 - 4, 5, wool(r(2) < 0.5 ? "pink" : "cyan"), B.WHITE_TERRACOTTA);
      p.signs.push({ text: "MOTEL", x: p.x0 + 4, y: STREET + 6, z: p.z0 + 5, dx: 1, dz: 0, id: B.SEA_LANTERN });
      p.extra = (c) => c.box(p.x0 + 13, GROUND - 1, p.z0 + 13, X1 - 4, GROUND, Z1 - 5, B.SMOOTH_STONE);
    } else if (kind < 0.7) {
      // A gas station: a lit canopy over the pumps, and the shop behind.
      p.ground = B.SMOOTH_STONE;
      b(p.x0 + 4, p.z0 + 2, X1 - 4, p.z0 + 8, 5, B.WHITE_TERRACOTTA, B.RED_TERRACOTTA, { style: "civic" });
      p.extra = (c) => {
        const y = STREET + 5;
        c.box(p.x0 + 4, y, p.z0 + 12, X1 - 4, y, Z1 - 4, B.QUARTZ_BLOCK);
        c.box(p.x0 + 4, y, p.z0 + 12, X1 - 4, y, p.z0 + 12, B.SEA_LANTERN);
        c.box(p.x0 + 4, y, Z1 - 4, X1 - 4, y, Z1 - 4, B.SEA_LANTERN);
        for (const x of [p.x0 + 5, X1 - 5]) for (const z of [p.z0 + 13, Z1 - 5]) c.box(x, STREET, z, x, y - 1, z, B.IRON_BARS);
        for (const x of [p.x0 + 10, p.x0 + 16]) { c.set(x, STREET, p.z0 + 17, B.IRON_BLOCK); c.set(x, STREET + 1, p.z0 + 17, B.REDSTONE_LAMP_ON); }
      };
      p.signs.push({ text: "GAS", x: p.x0 + 9, y: STREET + 6, z: p.z0 + 5, dx: 1, dz: 0, id: B.GLOWSTONE });
    } else {
      // Open sand: cacti, dead bushes, the odd skeleton of a car's worth of scrap.
      p.extra = (c) => {
        for (let k = 0; k < 10; k++) {
          const x = p.x0 + 1 + Math.floor(r(200 + k) * (LOT - 2)), z = p.z0 + 1 + Math.floor(r(220 + k) * (LOT - 2));
          if (k % 3 === 0) c.set(x, STREET, z, B.DEAD_BUSH);
          else c.box(x, STREET, z, x, STREET + 1 + (k % 3), z, B.CACTUS);
        }
      };
    }
  }

  /** Four shops or walk-ups round a cross of alleys. */
  private planQuad(p: LotPlan, walls: number[], lo: number, hi: number): void {
    const X1 = p.x0 + LOT - 1, Z1 = p.z0 + LOT - 1;
    const r = (salt: number) => this.rnd(p.i, p.j, salt);
    const rects: [number, number, number, number][] = [
      [p.x0 + 1, p.z0 + 1, p.x0 + 11, p.z0 + 11], [p.x0 + 15, p.z0 + 1, X1 - 1, p.z0 + 11],
      [p.x0 + 1, p.z0 + 15, p.x0 + 11, Z1 - 1], [p.x0 + 15, p.z0 + 15, X1 - 1, Z1 - 1],
    ];
    rects.forEach(([a, b, c, d], k) => {
      if (r(40 + k) < 0.08) { p.trees.push([Math.floor((a + c) / 2), Math.floor((b + d) / 2)]); return; }
      p.buildings.push({
        x0: a, z0: b, x1: c, z1: d, y0: STREET, h: lo + Math.floor(r(50 + k) * ((hi - lo) / 4 + 1)) * 4, style: "brick",
        wall: walls[Math.floor(r(60 + k) * walls.length) % walls.length], trim: r(70 + k) < 0.5 ? B.SMOOTH_STONE : B.QUARTZ_BLOCK, lit: 0.4, open: true,
      });
    });
  }

  private planParking(p: LotPlan): void {
    p.ground = B.SMOOTH_STONE;
    const X1 = p.x0 + LOT - 1;
    for (let x = p.x0 + 3; x + 2 <= X1 - 2; x += 4) {
      p.parking.push([x + 1.5, STREET, p.z0 + 4.5, 0]);
      p.parking.push([x + 1.5, STREET, p.z0 + LOT - 5.5, Math.PI]);
    }
    p.extra = (c) => {
      for (let x = p.x0 + 3; x <= X1 - 2; x += 4) {
        c.box(x, GROUND, p.z0 + 2, x, GROUND, p.z0 + 7, wool("white"));
        c.box(x, GROUND, p.z0 + LOT - 8, x, GROUND, p.z0 + LOT - 3, wool("white"));
      }
    };
  }

  private planPark(p: LotPlan, big: boolean): void {
    p.ground = B.GRASS;
    const X1 = p.x0 + LOT - 1, Z1 = p.z0 + LOT - 1;
    const r = (salt: number) => this.rnd(p.i, p.j, salt);
    for (let k = 0; k < (big ? 6 : 4); k++) {
      const x = p.x0 + 3 + Math.floor(r(80 + k) * (LOT - 6)), z = p.z0 + 3 + Math.floor(r(90 + k) * (LOT - 6));
      if (Math.abs(x - (p.x0 + 13)) < 6 && Math.abs(z - (p.z0 + 13)) < 6) continue;
      if (k % 2) p.palms.push([x, z, 6 + Math.floor(r(100 + k) * 3)]); else p.trees.push([x, z]);
    }
    p.extra = (c) => {
      // Paths crossing at a fountain.
      const mx = p.x0 + 13, mz = p.z0 + 13;
      c.box(p.x0, GROUND, mz - 1, X1, GROUND, mz + 1, B.DIRT_PATH);
      c.box(mx - 1, GROUND, p.z0, mx + 1, GROUND, Z1, B.DIRT_PATH);
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const d = Math.hypot(dx, dz);
        if (d <= 4.4) c.set(mx + dx, GROUND, mz + dz, d > 3.4 ? B.STONE_BRICKS : B.WATER);
        if (d > 3.4 && d <= 4.4) c.set(mx + dx, STREET, mz + dz, B.STONE_BRICK_SLAB);
      }
      c.box(mx, STREET, mz, mx, STREET + 2, mz, B.QUARTZ_BLOCK);
      c.set(mx, STREET + 3, mz, B.SEA_LANTERN);
      // Benches along the paths.
      for (const [bx, bz] of [[p.x0 + 5, mz - 2], [X1 - 5, mz + 2], [mx - 2, p.z0 + 5], [mx + 2, Z1 - 5]]) c.set(bx, STREET, bz, B.OAK_SLAB);
      for (let k = 0; k < 14; k++) {
        const x = p.x0 + Math.floor(r(120 + k) * LOT), z = p.z0 + Math.floor(r(140 + k) * LOT);
        if (c.get(x, GROUND, z) === B.GRASS && c.get(x, STREET, z) === B.AIR) c.set(x, STREET, z, [B.POPPY, B.DANDELION, B.BLUE_ORCHID, B.ALLIUM, B.SHORT_GRASS][k % 5]);
      }
    };
  }

  private planLandmark(p: LotPlan, m: Landmark): void {
    const x0 = p.x0, z0 = p.z0, X1 = x0 + LOT - 1, Z1 = z0 + LOT - 1;
    const b = (x0_: number, z0_: number, x1: number, z1: number, h: number, style: Style, wall: number, trim: number, extra: Partial<Building> = {}) =>
      p.buildings.push({ x0: x0_, z0: z0_, x1, z1, y0: STREET, h, style, wall, trim, lit: 0.6, open: true, ...extra });
    // Signs face south, over the street the landmark's door opens on, centred.
    const sign = (text: string, y: number, id: number, back?: number) => {
      const len = signLength(text);
      p.signs.push({ text, x: x0 + Math.floor((LOT - len) / 2), y, z: Z1 - 1, dx: 1, dz: 0, id, back });
    };
    switch (m.kind) {
      case "police":
        p.ground = B.SMOOTH_STONE;
        b(x0 + 2, z0 + 2, X1 - 2, z0 + 14, 12, "civic", wool("blue"), B.QUARTZ_BLOCK);
        p.signs.push({ text: m.sign ?? "NBPD", x: x0 + Math.floor((LOT - signLength(m.sign ?? "NBPD")) / 2), y: STREET + 13, z: z0 + 14, dx: 1, dz: 0, id: B.SEA_LANTERN });
        for (let x = x0 + 3; x + 2 <= X1 - 2; x += 5) p.parking.push([x + 1.5, STREET, z0 + 20.5, 0]);
        break;
      case "hospital":
        p.ground = B.SMOOTH_STONE;
        b(x0 + 2, z0 + 2, X1 - 2, Z1 - 6, 16, "civic", B.QUARTZ_BLOCK, B.WHITE_TERRACOTTA);
        p.extra = (c) => {
          // The red cross over the doors.
          const cx = x0 + 13, y = STREET + 11;
          c.box(cx - 1, y - 3, Z1 - 5, cx + 1, y + 3, Z1 - 5, wool("red"));
          c.box(cx - 3, y - 1, Z1 - 5, cx + 3, y + 1, Z1 - 5, wool("red"));
        };
        sign("ER", STREET + 5, wool("red"));
        break;
      case "guns":
        p.ground = B.SMOOTH_STONE;
        b(x0 + 3, z0 + 6, X1 - 3, Z1 - 3, 7, "brick", B.BRICKS, B.IRON_BLOCK);
        p.extra = (c) => { for (const f of this.shopPlan(p)) c.set(f.x, f.y, f.z, f.id); };
        sign("GUNS", STREET + 8, B.SHROOMLIGHT);
        break;
      case "respray":
        p.ground = B.SMOOTH_STONE;
        // A garage open at the front, deep enough to drive into.
        b(x0 + 5, z0 + 4, X1 - 5, Z1 - 2, 7, "warehouse", wool("magenta"), B.IRON_BLOCK, { open: false, lit: 0 });
        p.extra = (c) => {
          c.box(x0 + 9, STREET, z0 + 5, X1 - 9, STREET + 4, Z1 - 2, B.AIR);
          c.box(x0 + 9, GROUND, z0 + 5, X1 - 9, GROUND, Z1 - 2, B.SMOOTH_STONE);
          c.box(x0 + 9, STREET + 5, z0 + 8, X1 - 9, STREET + 5, z0 + 8, B.SEA_LANTERN);
        };
        sign("SPRAY", STREET + 8, B.SEA_LANTERN);
        break;
      case "casino":
        p.ground = B.WHITE_TERRACOTTA;
        b(x0 + 2, z0 + 2, X1 - 2, Z1 - 4, 14, "deco", wool("yellow"), B.GOLD_BLOCK, { neon: B.GLOWSTONE });
        p.extra = (c) => this.casinoInterior(c, p);
        sign(m.sign ?? "DOGE", STREET + 15, B.GLOWSTONE);
        break;
      case "tower": {
        p.ground = B.SMOOTH_STONE;
        b(x0 + 2, z0 + 2, X1 - 2, Z1 - 2, 36, "glass", B.QUARTZ_BLOCK, B.QUARTZ_BLOCK, { lit: 0.7, capped: true });
        b(x0 + 5, z0 + 5, X1 - 5, Z1 - 5, 14, "glass", B.QUARTZ_BLOCK, B.GOLD_BLOCK, { y0: STREET + 36, lit: 0.7, capped: true, open: false });
        b(x0 + 9, z0 + 9, X1 - 9, Z1 - 9, 6, "glass", B.GOLD_BLOCK, B.GOLD_BLOCK, { y0: STREET + 50, lit: 0.9, open: false });
        p.extra = (c) => {
          const cx = x0 + 13, cz = z0 + 13;
          c.box(cx, STREET + 57, cz, cx, STREET + 62, cz, B.IRON_BARS);
          c.set(cx, STREET + 63, cz, B.REDSTONE_BLOCK);
        };
        p.signs.push({ text: m.sign ?? "STONKS", x: x0 + Math.floor((LOT - signLength(m.sign ?? "STONKS")) / 2), y: STREET + 40, z: Z1 - 5 + 1, dx: 1, dz: 0, id: B.EMERALD_BLOCK });
        break;
      }
      case "mall":
        p.ground = B.SMOOTH_STONE;
        b(x0 + 2, z0 + 2, X1 - 2, z0 + 15, 10, "deco", wool("pink"), B.QUARTZ_BLOCK, { neon: B.SEA_LANTERN });
        for (let x = x0 + 3; x + 2 <= X1 - 2; x += 4) p.parking.push([x + 1.5, STREET, z0 + 21.5, Math.PI]);
        p.signs.push({ text: m.sign ?? "COPIUM", x: x0 + Math.floor((LOT - signLength(m.sign ?? "COPIUM")) / 2), y: STREET + 11, z: z0 + 15, dx: 1, dz: 0, id: B.SEA_LANTERN });
        break;
      case "dealer":
        p.ground = B.QUARTZ_BLOCK;
        b(x0 + 2, z0 + 2, X1 - 2, z0 + 10, 8, "glass", B.IRON_BLOCK, B.IRON_BLOCK, { lit: 0.8 });
        p.extra = (c) => { for (const f of this.shopPlan(p)) c.set(f.x, f.y, f.z, f.id); };
        for (let x = x0 + 3; x + 2 <= X1 - 2; x += 5) p.parking.push([x + 1.5, STREET, z0 + 17.5, 0]);
        p.signs.push({ text: "YEET", x: x0 + 7, y: STREET + 9, z: z0 + 10, dx: 1, dz: 0, id: B.GLOWSTONE });
        break;
      case "safehouse":
        p.ground = B.WHITE_TERRACOTTA;
        // A pastel walk-up with a garage, and the bed you wake up in.
        b(x0 + 4, z0 + 4, X1 - 4, z0 + 14, 8, "villa", wool("cyan"), B.QUARTZ_BLOCK);
        // Nose out, toward the street.
        p.parking.push([x0 + 13.5, STREET, z0 + 20.5, Math.PI]);
        p.palms.push([x0 + 2, Z1 - 2, 7], [X1 - 2, Z1 - 2, 7]);
        p.extra = (c) => c.box(x0 + 11, GROUND, z0 + 16, x0 + 16, GROUND, Z1, B.SMOOTH_STONE);
        break;
    }
  }

  /**
   * The shops' counters: the Bullet Bazaar's, with its wares on the wall
   * behind, and Yeet Motors' sales desk. Using one opens the shop.
   */
  shopPlan(p: LotPlan): { shop: ShopKind; x: number; y: number; z: number; id: number }[] {
    const out: { shop: ShopKind; x: number; y: number; z: number; id: number }[] = [];
    if (p.landmark?.kind === "guns") {
      for (let x = p.x0 + 8; x <= p.x0 + LOT - 9; x++) out.push({ shop: "guns", x, y: STREET, z: p.z0 + 12, id: B.IRON_BLOCK });
      for (let x = p.x0 + 6; x <= p.x0 + LOT - 7; x += 2) out.push({ shop: "guns", x, y: STREET + 1, z: p.z0 + 7, id: B.IRON_BARS });
    } else if (p.landmark?.kind === "dealer") {
      for (let x = p.x0 + 11; x <= p.x0 + 15; x++) out.push({ shop: "cars", x, y: STREET, z: p.z0 + 5, id: B.QUARTZ_BLOCK });
    }
    return out;
  }

  /** The Lucky Doge's floor: slots, blackjack, roulette and poker, each listed so using it deals you in. */
  private casinoInterior(c: Clip, p: LotPlan): void {
    for (const f of this.casinoPlan(p)) c.set(f.x, f.y, f.z, f.id);
  }

  /** Every block of the casino's machines and tables, with the game each plays. */
  casinoPlan(p: LotPlan): { game: "slots" | "blackjack" | "roulette" | "poker"; x: number; y: number; z: number; id: number }[] {
    const out: { game: "slots" | "blackjack" | "roulette" | "poker"; x: number; y: number; z: number; id: number }[] = [];
    const x0 = p.x0, z0 = p.z0, X1 = x0 + LOT - 1;
    for (let x = x0 + 5; x <= X1 - 5; x += 2) {
      out.push({ game: "slots", x, y: STREET, z: z0 + 5, id: B.PURPUR_BLOCK }, { game: "slots", x, y: STREET + 1, z: z0 + 5, id: B.SEA_LANTERN });
    }
    for (const tx of [x0 + 5, x0 + 15]) for (let x = tx; x < tx + 4; x++) for (let z = z0 + 10; z < z0 + 13; z++) {
      out.push({ game: "blackjack", x, y: STREET, z, id: x === tx || x === tx + 3 || z === z0 + 10 || z === z0 + 12 ? B.SPRUCE_PLANKS : wool("green") });
    }
    for (let x = x0 + 10; x < x0 + 15; x++) for (let z = z0 + 15; z < z0 + 18; z++) {
      out.push({ game: "roulette", x, y: STREET, z, id: x === x0 + 12 && z === z0 + 16 ? B.GOLD_BLOCK : (x + z) % 2 ? wool("red") : wool("black") });
    }
    for (let z = z0 + 8; z <= z0 + 18; z += 2) out.push({ game: "poker", x: X1 - 4, y: STREET, z, id: B.LAPIS_BLOCK }, { game: "poker", x: X1 - 4, y: STREET + 1, z, id: B.SEA_LANTERN });
    return out;
  }

  // ---- building --------------------------------------------------------------------------------

  /** Builds chunk (cx, cz) of the city and its shores into `out`. */
  fill(cx: number, cz: number, out: GeneratedChunk): void {
    const c = new Clip(cx, cz, out);
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) this.column(c, c.minX + lx, c.minZ + lz);
    // Lots, and anything of theirs that reaches past their edge (a palm's fronds).
    const reach = 4;
    const li = this.lotRange(c.minX - reach, c.maxX + reach, true), lj = this.lotRange(c.minZ - reach, c.maxZ + reach, false);
    for (let i = li[0]; i <= li[1]; i++) for (let j = lj[0]; j <= lj[1]; j++) this.buildLot(c, this.lot(i, j));
    this.shorePalms(c);
  }

  private lotRange(a: number, b: number, horizontal: boolean): [number, number] {
    const count = horizontal ? this.spec.cols : this.spec.rows;
    const o = horizontal ? this.spec.x0 : this.spec.z0;
    // Lot k runs from o + k·PITCH + ROAD to o + (k + 1)·PITCH − 1.
    return [Math.max(0, Math.floor((a - o) / PITCH)), Math.min(count - 1, Math.floor((b - o - ROAD) / PITCH))];
  }

  /** The ground of one column: sea, beach, verge, road, sidewalk or lot, with the street lamps and crossings. */
  private column(c: Clip, x: number, z: number): void {
    const s = this.spec;
    const beachEdge = this.maxX + s.beach;
    const land = x >= this.minX - 8 && x <= beachEdge && z >= this.minZ - 8 && z <= this.maxZ + 8;
    c.set(x, 0, z, B.BEDROCK);
    if (!land) {
      // The sea: a sandy floor shelving away from the island.
      const off = Math.max(this.minX - 8 - x, x - beachEdge, this.minZ - 8 - z, z - this.maxZ - 8, 0);
      const floor = Math.max(40, SEA_LEVEL - 3 - Math.floor(off / 3));
      c.box(x, 1, z, x, floor - 3, z, B.STONE);
      c.box(x, floor - 2, z, x, floor, z, B.SAND);
      c.box(x, floor + 1, z, x, SEA_LEVEL, z, B.WATER);
      return;
    }
    c.box(x, 1, z, x, GROUND - 4, z, B.STONE);
    c.box(x, GROUND - 3, z, x, GROUND - 1, z, B.DIRT);
    if (x > this.maxX) {
      // The beach, running down into the sea.
      const d = x - this.maxX;
      const top = d < s.beach - 12 ? GROUND : d < s.beach - 6 ? GROUND - 1 : GROUND - 2;
      c.box(x, GROUND - 3, z, x, top, z, B.SAND);
      if (top < SEA_LEVEL) c.box(x, top + 1, z, x, SEA_LEVEL, z, B.WATER);
      if (d > 4 && d < s.beach - 14 && hashFloat(this.seed, x, z, 7) < 0.004) this.umbrella(c, x, z);
      return;
    }
    if (!this.inside(x, z)) {
      // The verge round the other three shores, and a sea wall.
      const edge = x === this.minX - 8 || z === this.minZ - 8 || z === this.maxZ + 8;
      c.set(x, GROUND, z, edge ? B.STONE_BRICKS : s.dry ? B.SAND : B.GRASS);
      if (edge) c.set(x, STREET, z, B.STONE_BRICK_SLAB);
      return;
    }
    const ax = this.across(x, true), az = this.across(z, false);
    const xRoad = !!ax && "road" in ax, zRoad = !!az && "road" in az;
    const xo = ax?.o ?? 0, zo = az?.o ?? 0;
    const xLane = xRoad && xo >= SIDE && xo < ROAD - SIDE, zLane = zRoad && zo >= SIDE && zo < ROAD - SIDE;
    if (xLane || zLane) {
      let id: number = ASPHALT;
      // Zebra crossings where a sidewalk crosses a road; a centre line down the middle between junctions.
      if (xLane && zRoad && !zLane) id = xo % 2 === 0 ? ZEBRA : ZEBRA_GAP;
      else if (zLane && xRoad && !xLane) id = zo % 2 === 0 ? ZEBRA : ZEBRA_GAP;
      else if (xLane && !zRoad && xo === 6) id = CENTRE_LINE;
      else if (zLane && !xRoad && zo === 6) id = CENTRE_LINE;
      c.set(x, GROUND, z, id);
      return;
    }
    if (xRoad || zRoad) {
      // Sidewalk, its outer rows the curb.
      const curb = (xRoad && (xo === 1 || xo === ROAD - 2)) || (zRoad && (zo === 1 || zo === ROAD - 2));
      c.set(x, GROUND, z, curb ? CURB : SIDEWALK);
      // Street lamps every ten blocks on the curb, clear of the junctions.
      const along = xRoad && !zRoad ? z : zRoad && !xRoad ? x : null;
      if (curb && along !== null && ((along % 10) + 10) % 10 === 5) {
        c.box(x, STREET, z, x, STREET + 3, z, B.IRON_BARS);
        c.set(x, STREET + 4, z, this.spec.dry ? B.SHROOMLIGHT : B.SEA_LANTERN);
      }
      return;
    }
    // A lot: its ground, which its plan may pave over.
    c.set(x, GROUND, z, this.spec.dry ? B.SAND : B.GRASS);
  }

  private buildLot(c: Clip, p: LotPlan): void {
    const X1 = p.x0 + LOT - 1, Z1 = p.z0 + LOT - 1;
    if (c.touches(p.x0, p.z0, X1, Z1)) c.box(p.x0, GROUND, p.z0, X1, GROUND, Z1, p.ground);
    for (const b of p.buildings) if (c.touches(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1)) this.building(c, b);
    for (const [x, z, h] of p.palms) if (c.touches(x - 3, z - 3, x + 3, z + 3)) palm(c, x, z, h);
    for (const [x, z] of p.trees) if (c.touches(x - 2, z - 2, x + 2, z + 2)) tree(c, x, z);
    if (p.extra && c.touches(p.x0 - 1, p.z0 - 1, X1 + 1, Z1 + 1)) p.extra(c);
    for (const s of p.signs) {
      const len = signLength(s.text);
      if (c.touches(Math.min(s.x, s.x + s.dx * len), Math.min(s.z, s.z + s.dz * len), Math.max(s.x, s.x + s.dx * len), Math.max(s.z, s.z + s.dz * len))) letter(c, s);
    }
  }

  /**
   * One box of a building. Its walls carry the style's windows, with a
   * room behind each — lit or dark, a floor's bay at a time, so a tower at
   * night is a grid of lit offices rather than confetti — and its core is
   * solid, which the mesher never draws. An open ground floor is hollow and
   * lit, with doors in the middle of every side.
   */
  private building(c: Clip, b: Building): void {
    const top = b.y0 + b.h - 1;
    const x0 = Math.max(b.x0, c.minX), x1 = Math.min(b.x1, c.maxX), z0 = Math.max(b.z0, c.minZ), z1 = Math.min(b.z1, c.maxZ);
    const midX = Math.floor((b.x0 + b.x1) / 2), midZ = Math.floor((b.z0 + b.z1) / 2);
    const lobbyTop = b.open && b.y0 === STREET ? STREET + 3 : -1;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === b.x0 || x === b.x1, ez = z === b.z0 || z === b.z1;
      const edge = ex || ez, corner = ex && ez;
      const inner = !edge && (x === b.x0 + 1 || x === b.x1 - 1 || z === b.z0 + 1 || z === b.z1 - 1);
      // Along the wall: position on the face (for window bays) and the face's own middle (for doors).
      // A door is one block wide: wide enough to walk in, too narrow for a car to follow.
      const along = ex ? z - b.z0 : x - b.x0;
      const door = edge && !corner && (ex ? z === midZ : x === midX);
      for (let y = b.y0; y <= top; y++) {
        const f = y - b.y0;
        let id: number;
        if (y <= lobbyTop) {
          if (edge) id = corner ? b.trim : door && y <= STREET + 2 ? B.AIR : b.style === "warehouse" ? b.wall : y === STREET + 3 ? b.trim : B.GLASS;
          else id = B.AIR;
          if (!edge && y === STREET + 3) id = (x - b.x0) % 4 === 2 && (z - b.z0) % 4 === 2 ? B.SEA_LANTERN : b.trim;
        } else if (edge) id = this.facade(b, x, y, z, f, along, corner);
        else if (inner) id = this.room(b, x, y, z, f, along);
        else id = y === top ? b.trim : B.STONE;
        c.set(x, y, z, id);
      }
      // The roof: a parapet round the edge, gravel and the odd vent within.
      if (!b.capped) {
        if (edge) c.set(x, top + 1, z, b.trim);
        else if (hash4(this.seed, x, z, top) % 97 === 0) c.set(x, top + 1, z, B.IRON_BLOCK);
      }
    }
  }

  private facade(b: Building, x: number, y: number, z: number, f: number, along: number, corner: boolean): number {
    const k = f % 4;
    if (corner) {
      if (b.neon && f > 3) return b.neon;
      return b.trim;
    }
    switch (b.style) {
      case "glass": return along % 5 === 0 ? b.wall : k === 0 ? b.trim : B.GLASS;
      case "deco": return k === 0 ? b.trim : (k === 1 || k === 2) && along % 3 !== 0 ? B.GLASS_PANE : b.wall;
      case "civic": return k === 0 ? b.trim : (k === 1 || k === 2) && along % 4 !== 0 ? B.GLASS : b.wall;
      case "villa": return k === 0 ? b.trim : (k === 1 || k === 2) && along % 4 >= 2 ? B.GLASS : b.wall;
      case "warehouse": return f === b.h - 2 && along % 4 !== 0 ? B.GLASS : b.wall;
      case "brick": default: return k === 0 && f > 0 ? b.trim : (k === 1 || k === 2) && along % 3 === 1 ? B.GLASS_PANE : b.wall;
    }
  }

  /** The room behind a window: lit or dark, decided per bay of each floor so offices light up whole. */
  private room(b: Building, x: number, y: number, z: number, f: number, _along: number): number {
    const floor = Math.floor(f / 4);
    const bay = Math.floor((x + z) / 3);
    const h = hashFloat(this.seed, floor * 7919 + bay, b.x0 * 31 + b.z0, 11);
    if (h < b.lit) return LIGHTS[hash4(this.seed, b.x0, b.z0, floor) & 3];
    return y % 4 === 0 ? B.STONE : wool("black");
  }

  private umbrella(c: Clip, x: number, z: number): void {
    c.box(x, STREET, z, x, STREET + 2, z, B.OAK_FENCE);
    const colour = wool(["red", "yellow", "cyan", "pink", "lime"][hash4(this.seed, x, z) % 5] as (typeof WOOL_COLORS)[number]);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) c.set(x + dx, STREET + 3, z + dz, colour);
  }

  /** Palms along the beach avenue's sea side, and on the sand. */
  private shorePalms(c: Clip): void {
    const x = this.maxX - 1;
    if (x + 3 >= c.minX && x - 3 <= c.maxX) {
      for (let z = this.minZ + 8; z <= this.maxZ - 8; z += 12) {
        const az = this.across(z, false);
        if (az && "road" in az) continue;
        if (c.touches(x - 3, z - 3, x + 3, z + 3)) palm(c, x, z, 7 + (hash4(this.seed, z, 3) % 3));
      }
    }
    for (let z = this.minZ; z <= this.maxZ; z += 17) {
      const px = this.maxX + 8 + (hash4(this.seed, z, 5) % 12);
      if (c.touches(px - 3, z - 3, px + 3, z + 3)) palm(c, px, z, 6 + (hash4(this.seed, z, 9) % 4));
    }
  }
}

/** A palm: a leaning trunk and fronds drooping from the crown. */
function palm(c: Clip, x: number, z: number, h: number): void {
  for (let y = 0; y < h; y++) c.set(x + (y > h - 3 ? 1 : 0), STREET + y, z, B.JUNGLE_LOG);
  const tx = x + 1, ty = STREET + h;
  c.set(tx, ty, z, B.JUNGLE_LEAVES);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    c.set(tx + dx, ty, z + dz, B.JUNGLE_LEAVES);
    c.set(tx + dx * 2, ty, z + dz * 2, B.JUNGLE_LEAVES);
    c.set(tx + dx * 3, ty - 1, z + dz * 3, B.JUNGLE_LEAVES);
  }
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) c.set(tx + dx, ty - 1 + 1, z + dz, B.JUNGLE_LEAVES);
}

/** A round little street tree. */
function tree(c: Clip, x: number, z: number): void {
  for (let y = 0; y < 4; y++) c.set(x, STREET + y, z, B.OAK_LOG);
  for (let dy = 2; dy <= 5; dy++) {
    const r = dy >= 5 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if ((dx || dz || dy > 3) && !(Math.abs(dx) === 2 && Math.abs(dz) === 2)) c.set(x + dx, STREET + dy, z + dz, B.OAK_LEAVES);
    }
  }
}

const cities = new Map<string, City>();
/** The city of a spec and seed, built once. */
export function cityOf(id: CityId, seed: number): City {
  const key = `${id}:${seed}`;
  let c = cities.get(key);
  if (!c) {
    c = new City(CITIES[id], seed);
    if (cities.size > 4) cities.clear();
    cities.set(key, c);
  }
  return c;
}
