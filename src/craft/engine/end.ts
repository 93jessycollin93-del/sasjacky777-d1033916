/**
 * The End: a ring of obsidian spikes on a floating island of end stone, the
 * exit portal at its heart, and — past a thousand blocks of void — the outer
 * islands in four biomes, grown over with chorus and topped here and there
 * with the towers of an End city.
 *
 * The island field follows the original's shape: a height value per column,
 * a hundred at the centre falling off with distance, and beyond 1024 blocks a
 * scatter of islands each with its own fall-off, the column taking the
 * highest. The value decides everything else — whether there is land, how
 * thick it is, and the biome (Highlands above 40, Midlands above 0, Barrens
 * above -20, small islands below). Islands have flat tops and hang down in
 * cones, as the original's do, because the thickness grows with the value.
 *
 * Like every generator here, a chunk is a pure function of the seed and its
 * position; plants and cities that cross an edge are planned from their own
 * chunk and clipped.
 */
import { B, chorusJoins, FACE_DIRS, Face, FACING_DIRS, OPPOSITE_FACING } from "./blocks";
import { BiomeId } from "./biomes";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "./constants";
import { itemByName, itemDef, type ItemStack } from "./items";
import { rollEnchantments } from "./enchanting";
import { Simplex } from "./noise";
import { hash4, Rng } from "./rng";
import type { GeneratedChunk, Tints } from "./worldgen";
import { CITY_REACH, planCity, stampPlan, type CityPlan } from "./endCity";

/** Blocks from the centre to where the outer islands begin. */
export const OUTER_ISLANDS = 1024;
/** Where the arrival platform stands, as in the original. */
export const END_SPAWN = { x: 100, y: 49, z: 0 } as const;
/** The gateways that open around the main island, one per dragon killed. */
export const GATEWAY_COUNT = 20;
const GATEWAY_RADIUS = 96;
const GATEWAY_Y = 75;
/** How far out a gateway's far end lies (on an island the generator makes sure is there). */
const GATEWAY_EXIT = 1060;

export interface Spike {
  x: number; z: number;
  radius: number;
  /** The obsidian's top; bedrock and the crystal sit on it. */
  height: number;
  /** Caged in iron bars. */
  guarded: boolean;
}

const spikeCache = new Map<number, Spike[]>();

/** The ten spikes around the main island: a ring 42 out, radius 2 to 4, 76 to 103 tall. */
export function endSpikes(seed: number): Spike[] {
  const hit = spikeCache.get(seed);
  if (hit) return hit;
  const rng = new Rng(hash4(seed, 0x591c, 0xe));
  const order = [...Array(10).keys()];
  for (let i = 9; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const spikes = order.map((size, i): Spike => {
    const a = 2 * (-Math.PI + (Math.PI / 10) * i);
    return {
      x: Math.floor(42 * Math.cos(a)), z: Math.floor(42 * Math.sin(a)),
      radius: 2 + Math.floor(size / 3), height: 76 + size * 3, guarded: size === 1 || size === 2,
    };
  });
  spikeCache.set(seed, spikes);
  return spikes;
}

/** Where a crystal stands on a spike: on the bedrock at its top. */
export const crystalSpot = (s: Spike): [number, number, number] => [s.x + 0.5, s.height + 1, s.z + 0.5];

/** The main-island gateway `i`: a ring 96 out at y 75. */
export function gatewayPosition(i: number): [number, number, number] {
  const a = (i / GATEWAY_COUNT) * Math.PI * 2;
  return [Math.floor(GATEWAY_RADIUS * Math.cos(a)), GATEWAY_Y, Math.floor(GATEWAY_RADIUS * Math.sin(a))];
}

/** The index of the gateway out of `GATEWAY_COUNT` in the order they open, for this world. */
export function gatewayOrder(seed: number): number[] {
  const rng = new Rng(hash4(seed, 0x6a7e));
  const order = [...Array(GATEWAY_COUNT).keys()];
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

type Place = (x: number, y: number, z: number, id: number, meta?: number) => void;

interface IslandSeed { x: number; z: number; falloff: number }

export class EndGenerator {
  readonly seed: number;
  private islands: Simplex;
  private detail: Simplex;
  private hills: Simplex;
  private under: Simplex;
  private chosen = new Map<string, IslandSeed | null>();

  constructor(seed: number) {
    this.seed = seed | 0;
    this.islands = new Simplex(hash4(this.seed, 201));
    this.detail = new Simplex(hash4(this.seed, 202));
    this.hills = new Simplex(hash4(this.seed, 203));
    this.under = new Simplex(hash4(this.seed, 204));
  }

  /** The outer island seeded in 16-block cell (ci, cj), if one is. */
  private islandIn(ci: number, cj: number): IslandSeed | null {
    if (ci * ci + cj * cj <= (OUTER_ISLANDS / 16) ** 2) return null;
    const key = `${ci},${cj}`;
    let got = this.chosen.get(key);
    if (got !== undefined) return got;
    got = null;
    if (this.islands.noise2(ci * 0.93, cj * 0.93) < -0.8) {
      got = { x: ci * 16 + 8, z: cj * 16 + 8, falloff: ((Math.abs(ci) * 3439 + Math.abs(cj) * 147) % 13) + 9 };
    }
    if (this.chosen.size > 50000) this.chosen.clear();
    this.chosen.set(key, got);
    return got;
  }

  /** Every island seed whose land could reach into the square x0..x1, z0..z1. */
  private islandsNear(x0: number, z0: number, x1: number, z1: number): IslandSeed[] {
    const out: IslandSeed[] = [];
    const reach = 192;
    for (let cj = Math.floor((z0 - reach) / 16); cj <= Math.floor((z1 + reach) / 16); cj++) {
      for (let ci = Math.floor((x0 - reach) / 16); ci <= Math.floor((x1 + reach) / 16); ci++) {
        const s = this.islandIn(ci, cj);
        if (s) out.push(s);
      }
    }
    // The far ends of the gateways always have land to arrive on.
    for (let i = 0; i < GATEWAY_COUNT; i++) {
      const [gx, gz] = gatewayExitXZ(i);
      if (gx > x0 - 64 && gx < x1 + 64 && gz > z0 - 64 && gz < z1 + 64) out.push({ x: gx, z: gz, falloff: 22 });
    }
    return out;
  }

  /** The height value at a column (the original's "island" value): land where it is above zero. */
  massAt(x: number, z: number, islands?: IslandSeed[]): number {
    let m = Math.max(-100, Math.min(80, 100 - Math.hypot(x, z)));
    const list = islands ?? this.islandsNear(x, z, x, z);
    for (const s of list) {
      const d8 = Math.hypot(x - s.x, z - s.z) / 8;
      m = Math.max(m, Math.max(-100, Math.min(80, 100 - d8 * s.falloff)));
    }
    return m;
  }

  biomeAt(x: number, z: number): BiomeId {
    if (x * x + z * z <= OUTER_ISLANDS * OUTER_ISLANDS) return BiomeId.TheEnd;
    return biomeFor(this.massAt(x, z));
  }

  /** The top and bottom of the land in a column (top < bottom when there is none). */
  column(x: number, z: number, mass: number): [number, number] {
    if (mass <= 0) return [-1, 0];
    const k = Math.min(1, mass / 20);
    let top = 48 + mass * 0.18 + this.detail.fbm2(x / 40, z / 40, 3) * 2.5 * k;
    // The highlands roll in hills.
    if (mass > 40) top += Math.max(0, this.hills.fbm2(x / 70, z / 70, 2)) * 9 * ((mass - 40) / 40);
    const bottom = top - 3 - mass * 0.5 * (0.8 + 0.4 * (this.under.noise2(x / 23, z / 23) + 1) / 2);
    return [Math.floor(top), Math.floor(bottom)];
  }

  private surfaces = new Map<string, number>();

  /** The top of the land at a column, or -1 over the void. */
  surfaceY(x: number, z: number): number {
    const key = `${x},${z}`;
    let y = this.surfaces.get(key);
    if (y !== undefined) return y;
    const [top, bottom] = this.column(x, z, this.massAt(x, z));
    y = top >= bottom ? top : -1;
    if (this.surfaces.size > 20000) this.surfaces.clear();
    this.surfaces.set(key, y);
    return y;
  }

  /** Where the exit portal's bedrock basin sits: on the island at the centre. */
  podiumY(): number {
    return this.surfaceY(0, 0) + 1;
  }

  /** Gateway `i`'s far end: the bedrock cage floating ten over its island, and the ground to land on under it. */
  gatewayExit(i: number): { gateway: [number, number, number]; land: [number, number, number] } {
    const [x, z] = gatewayExitXZ(i);
    const top = this.surfaceY(x, z);
    return { gateway: [x, top + 10, z], land: [x + 2, top + 1, z] };
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(256);
    const x0 = cx * 16, z0 = cz * 16;
    const outer = Math.hypot(x0 + 8, z0 + 8) > OUTER_ISLANDS - 250;
    const islands = outer ? this.islandsNear(x0, z0, x0 + 15, z0 + 15) : [];
    const masses = new Float32Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z;
      const m = this.massAt(wx, wz, islands);
      masses[z * 16 + x] = m;
      biomes[z * 16 + x] = wx * wx + wz * wz <= OUTER_ISLANDS * OUTER_ISLANDS ? BiomeId.TheEnd : biomeFor(m);
      const [top, bottom] = this.column(wx, wz, m);
      for (let y = Math.max(1, bottom); y <= Math.min(WORLD_HEIGHT - 2, top); y++) blocks[blockIndex(x, y, z)] = B.END_STONE;
    }
    const place: Place = (x, y, z, id, m = 0) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT - 1) return;
      const i = blockIndex(lx, y, lz);
      blocks[i] = id;
      meta[i] = m;
    };

    if (Math.abs(x0) < 128 && Math.abs(z0) < 128) this.mainIsland(place, x0, z0);
    if (outer) {
      this.smallIslands(place, cx, cz);
      this.chorus(blocks, meta, cx, cz);
      for (const c of endCitiesTouching(this, cx, cz)) stampPlan(c, place, x0, z0);
      for (let i = 0; i < GATEWAY_COUNT; i++) {
        const [gx, gz] = gatewayExitXZ(i);
        if (gx < x0 - 2 || gx > x0 + 17 || gz < z0 - 2 || gz > z0 + 17) continue;
        buildGateway(place, ...this.gatewayExit(i).gateway);
      }
    }
    return { blocks, meta, biomes };
  }

  /** The spikes, the arrival platform's column of void, and the exit portal's basin. */
  private mainIsland(place: Place, x0: number, z0: number): void {
    for (const s of endSpikes(this.seed)) {
      if (s.x + s.radius + 3 < x0 || s.x - s.radius - 3 > x0 + 15 || s.z + s.radius + 3 < z0 || s.z - s.radius - 3 > z0 + 15) continue;
      const base = this.surfaceY(s.x, s.z) - 12;
      for (let dz = -s.radius; dz <= s.radius; dz++) for (let dx = -s.radius; dx <= s.radius; dx++) {
        if (dx * dx + dz * dz > s.radius * s.radius + 1) continue;
        for (let y = Math.max(1, base); y <= s.height; y++) place(s.x + dx, y, s.z + dz, B.OBSIDIAN);
      }
      place(s.x, s.height, s.z, B.BEDROCK);
      if (s.guarded) {
        for (let dy = 1; dy <= 4; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 4) place(s.x + dx, s.height + dy, s.z + dz, B.IRON_BARS);
        }
      }
    }
    buildPodium(place, 0, this.podiumY(), 0, false);
  }

  /** The smallest islands: lumps a few blocks across, scattered where the big ones thin out. */
  private smallIslands(place: Place, cx: number, cz: number): void {
    const rng = new Rng(hash4(this.seed, cx, cz, 0x5e1));
    if (Math.hypot(cx * 16, cz * 16) < OUTER_ISLANDS || rng.next() > 0.14) return;
    const x = cx * 16 + 4 + rng.int(8), z = cz * 16 + 4 + rng.int(8), y = 55 + rng.int(16);
    if (biomeFor(this.massAt(x, z)) !== BiomeId.SmallEndIslands) return;
    let r = 2 + rng.next() * 2;
    for (let dy = 0; r > 0.5; dy--, r -= 1 + rng.next() * 0.5) {
      for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dz * dz <= (r + 1) * (r + 1)) place(x + dx, y + dy, z + dz, B.END_STONE);
      }
    }
  }

  /** Chorus plants on the highlands (and a few on the midlands), planned per chunk and clipped. */
  private chorus(blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number): void {
    const x0 = cx * 16, z0 = cz * 16;
    const placed: number[] = [];
    for (let scz = cz - 1; scz <= cz + 1; scz++) for (let scx = cx - 1; scx <= cx + 1; scx++) {
      const rng = new Rng(hash4(this.seed, scx, scz, 0xc405));
      const tries = 1 + rng.int(4);
      for (let t = 0; t < tries; t++) {
        const x = scx * 16 + rng.int(16), z = scz * 16 + rng.int(16);
        const plantSeed = rng.int(0x7fffffff);
        const m = this.massAt(x, z);
        if (m <= 40 && !(m > 0 && rng.next() < 0.1)) continue;
        const top = this.surfaceY(x, z);
        if (top < 0) continue;
        const plant = growChorusPlant(x, top + 1, z, new Rng(plantSeed), (px, py, pz) => py > this.surfaceY(px, pz));
        for (const [key, id] of plant) {
          const [px, py, pz] = key.split(",").map(Number);
          const lx = px - x0, lz = pz - z0;
          if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || py >= WORLD_HEIGHT - 1) continue;
          const i = blockIndex(lx, py, lz);
          if (blocks[i] !== B.AIR) continue;
          blocks[i] = id;
          // Arms reaching out of this chunk come from the plan; the rest are settled below from what is here.
          meta[i] = id === B.CHORUS_FLOWER ? 5 : chorusJoinsIn(plant, px, py, pz, () => false) & OUTWARD[(lx === 0 ? 2 : 0) | (lx === 15 ? 1 : 0) | (lz === 0 ? 8 : 0) | (lz === 15 ? 4 : 0)];
          placed.push(i);
        }
      }
    }
    // Where plants grew into each other, an arm joins whatever chorus is beside it, as the block rule would.
    for (const i of placed) {
      if (blocks[i] !== B.CHORUS_PLANT) continue;
      const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
      const inside = chorusJoins((a, b2, c) => (a < 0 || a > 15 || c < 0 || c > 15 ? B.AIR : blocks[blockIndex(a, b2, c)]), lx, y, lz);
      meta[i] |= inside;
    }
  }

  tints(): Tints {
    const out = new Uint8Array(256 * 9);
    for (let i = 0; i < 256; i++) out.set([121, 192, 90, 89, 174, 48, 63, 118, 228], i * 9);
    return out;
  }

  findSpawn(): { x: number; y: number; z: number } {
    return { ...END_SPAWN };
  }
}

function gatewayExitXZ(i: number): [number, number] {
  const a = (i / GATEWAY_COUNT) * Math.PI * 2;
  return [Math.floor(GATEWAY_EXIT * Math.cos(a)), Math.floor(GATEWAY_EXIT * Math.sin(a))];
}

export function biomeFor(mass: number): BiomeId {
  return mass > 40 ? BiomeId.EndHighlands : mass >= 0 ? BiomeId.EndMidlands : mass >= -20 ? BiomeId.EndBarrens : BiomeId.SmallEndIslands;
}

/**
 * The exit portal: a bedrock basin seven across with a pillar in its middle
 * and torches on the pillar. `active` fills the basin with portal — after the
 * dragon falls.
 */
export function buildPodium(place: Place, x: number, y: number, z: number, active: boolean): void {
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const r = Math.hypot(dx, dz);
    if (r > 3.5) continue;
    place(x + dx, y - 1, z + dz, B.BEDROCK);
    if (r > 2.5) place(x + dx, y, z + dz, B.BEDROCK);
    else if (dx !== 0 || dz !== 0) place(x + dx, y, z + dz, active ? B.END_PORTAL : B.AIR);
    for (let dy = 1; dy <= 4; dy++) if (dx !== 0 || dz !== 0) place(x + dx, y + dy, z + dz, B.AIR);
  }
  for (let dy = 0; dy <= 3; dy++) place(x, y + dy, z, B.BEDROCK);
  // Torches on the pillar's four sides, standing out from it.
  FACING_DIRS.forEach(([dx, dz], f) => place(x + dx, y + 2, z + dz, B.TORCH, 1 + f));
}

/** The cells of the exit portal's basin, for lighting it. */
export function podiumPortalCells(x: number, y: number, z: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    if ((dx || dz) && Math.hypot(dx, dz) <= 2.5) out.push([x + dx, y, z + dz]);
  }
  return out;
}

/** A gateway: the portal block, bedrock above and below and in a plus over and under, open on its four sides. */
export function buildGateway(place: Place, x: number, y: number, z: number): void {
  for (let dy = -2; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const centre = dx === 0 && dz === 0;
    let id: number = B.AIR;
    if (dy === 0) id = centre ? B.END_GATEWAY : B.AIR;
    else if (Math.abs(dy) === 2) id = centre ? B.BEDROCK : B.AIR;
    else if (dx === 0 || dz === 0) id = B.BEDROCK;
    place(x + dx, y + dy, z + dz, id);
  }
}

/**
 * A chorus plant as the original grows one at generation: a stalk of one to
 * four, branching up to four times, every tip a flower. `open` answers
 * whether a cell is free of the island. Returns cell → block id.
 */
export function growChorusPlant(x: number, y: number, z: number, rng: Rng, open: (x: number, y: number, z: number) => boolean): Map<string, number> {
  const cells = new Map<string, number>();
  const k = (a: number, b: number, c: number) => `${a},${b},${c}`;
  const empty = (a: number, b: number, c: number) => !cells.has(k(a, b, c)) && open(a, b, c);
  const neighboursEmpty = (a: number, b: number, c: number, except: number) =>
    FACING_DIRS.every(([dx, dz], f) => f === except || empty(a + dx, b, c + dz));
  cells.set(k(x, y, z), B.CHORUS_PLANT);
  const grow = (bx: number, by: number, bz: number, depth: number): void => {
    let height = 1 + rng.int(4);
    if (depth === 0) height++;
    for (let j = 1; j <= height; j++) {
      if (by + j >= WORLD_HEIGHT - 2 || !neighboursEmpty(bx, by + j, bz, -1) || !empty(bx, by + j, bz)) return;
      cells.set(k(bx, by + j, bz), B.CHORUS_PLANT);
    }
    let branched = false;
    if (depth < 4) {
      let n = rng.int(4);
      if (depth === 0) n++;
      for (let i = 0; i < n; i++) {
        const f = rng.int(4);
        const [dx, dz] = FACING_DIRS[f];
        const px = bx + dx, py = by + height, pz = bz + dz;
        if (Math.abs(px - x) < 8 && Math.abs(pz - z) < 8 && empty(px, py, pz) && empty(px, py - 1, pz) && neighboursEmpty(px, py, pz, OPPOSITE_FACING[f])) {
          branched = true;
          cells.set(k(px, py, pz), B.CHORUS_PLANT);
          grow(px, py, pz, depth + 1);
        }
      }
    }
    if (!branched) cells.set(k(bx, by + height, bz), B.CHORUS_FLOWER);
  };
  grow(x, y, z, 0);
  return cells;
}

/**
 * The Face bits that point out of a chunk from a cell on its edge, indexed by
 * which edges the cell is on (1 east, 2 west, 4 south, 8 north).
 */
const OUTWARD: number[] = [...Array(16).keys()].map((e) =>
  ((e & 1) ? 1 << Face.East : 0) | ((e & 2) ? 1 << Face.West : 0) | ((e & 4) ? 1 << Face.South : 0) | ((e & 8) ? 1 << Face.North : 0));

/** The join bits for a planned chorus cell: its neighbours in the plan, and end stone under it. */
function chorusJoinsIn(plant: Map<string, number>, x: number, y: number, z: number, ground: (x: number, y: number, z: number) => boolean): number {
  let m = 0;
  for (let f = 0; f < 6; f++) {
    const [dx, dy, dz] = FACE_DIRS[f];
    if (plant.has(`${x + dx},${y + dy},${z + dz}`) || (f === Face.Down && ground(x, y - 1, z))) m |= 1 << f;
  }
  return m;
}

// ---- End cities -------------------------------------------------------------------------------

/** Chunks per side of an End city region: at most one city in each. */
export const CITY_REGION = 20;

export interface EndCity extends CityPlan {
  key: string;
  /** The base house's centre and floor. */
  x: number; y: number; z: number;
}

const cityCache = new Map<string, EndCity | null>();

export function cityInRegion(gen: EndGenerator, rx: number, rz: number): EndCity | null {
  const key = `${gen.seed}:${rx},${rz}`;
  const hit = cityCache.get(key);
  if (hit !== undefined) return hit;
  const rng = new Rng(hash4(gen.seed, rx, rz, 0xc17));
  let city: EndCity | null = null;
  const x = (rx * CITY_REGION + 5 + rng.int(CITY_REGION - 10)) * 16 + 8;
  const z = (rz * CITY_REGION + 5 + rng.int(CITY_REGION - 10)) * 16 + 8;
  if (rng.next() < 0.6 && Math.hypot(x, z) > OUTER_ISLANDS + 100 && gen.massAt(x, z) > 45) {
    const y = gen.surfaceY(x, z) + 1;
    city = { key, x, y, z, ...planCity(hash4(gen.seed, rx, rz, 0xc18), x, y, z) };
  }
  if (cityCache.size > 256) cityCache.clear();
  cityCache.set(key, city);
  return city;
}

export function endCitiesTouching(gen: EndGenerator, cx: number, cz: number): EndCity[] {
  const out: EndCity[] = [];
  const reach = Math.ceil(CITY_REACH / 16) + 1;
  for (let rx = Math.floor((cx - reach) / CITY_REGION); rx <= Math.floor((cx + reach) / CITY_REGION); rx++) {
    for (let rz = Math.floor((cz - reach) / CITY_REGION); rz <= Math.floor((cz + reach) / CITY_REGION); rz++) {
      const c = cityInRegion(gen, rx, rz);
      if (c && c.x1 >= cx * 16 && c.x0 <= cx * 16 + 15 && c.z1 >= cz * 16 && c.z0 <= cz * 16 + 15) out.push(c);
    }
  }
  return out;
}

/**
 * An End city chest: gold, iron, diamonds, emeralds and enchanted iron and
 * diamond gear. A ship's chests lean richer; its elytra hang in the cabin's
 * frame, not in a chest.
 */
export function cityLoot(items: (ItemStack | null)[], seed: number, ship: boolean): void {
  const rng = new Rng(seed);
  const table: [string, number, number, number, boolean][] = [
    ["diamond", 2, 7, 0.35, false], ["iron_ingot", 4, 8, 0.6, false], ["gold_ingot", 2, 7, 0.6, false], ["emerald", 2, 6, 0.4, false],
    ["diamond_sword", 1, 1, 0.12, true], ["diamond_pickaxe", 1, 1, 0.12, true], ["diamond_chestplate", 1, 1, 0.1, true],
    ["iron_sword", 1, 1, 0.2, true], ["iron_helmet", 1, 1, 0.15, true], ["iron_boots", 1, 1, 0.15, true], ["ender_pearl", 1, 3, 0.2, false],
  ];
  for (const [name, lo, hi, chance, enchant] of table) {
    if (rng.next() >= chance * (ship ? 1.3 : 1)) continue;
    const slot = rng.int(items.length);
    if (items[slot]) continue;
    const stack: ItemStack = { id: itemByName(name).id, count: lo + rng.int(hi - lo + 1) };
    if (enchant) {
      const ench = rollEnchantments(rng.int(0x7fffffff), 0, 20 + rng.int(20), itemDef(stack.id)!);
      if (Object.keys(ench).length) stack.ench = ench;
    }
    items[slot] = stack;
  }
}
