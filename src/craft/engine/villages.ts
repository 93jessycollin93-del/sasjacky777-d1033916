/**
 * Villages: where they go, how they are laid out, and how their blocks are
 * stamped into the chunks they cover.
 *
 * Like everything in world generation this is a pure function of the seed. A
 * village's plan comes from its region (one chance per 24×24 chunks) and the
 * terrain heights the generator can report for any column, so each chunk can
 * build its own share of a village without the others existing — the same
 * trick trees use across chunk borders. The game reads the same plan to
 * populate a village once, with villagers at their job sites and an iron golem
 * by the well.
 *
 * Layout follows the original's feel rather than its jigsaw pieces: a well and
 * bell at the centre, dirt roads out in two to four directions, and houses along
 * them with their doors on the road — small and large houses, farms, and a
 * library — in the building style of the biome.
 */
import { B } from "./blocks";
import { BiomeId } from "./biomes";
import { SEA_LEVEL, WORLD_HEIGHT } from "./constants";
import { itemByName, type ItemStack } from "./items";
import { hash4, Rng } from "./rng";

export type Profession =
  | "farmer" | "librarian" | "butcher" | "fisherman" | "fletcher" | "shepherd" | "mason" | "toolsmith" | "cleric" | "leatherworker";

export const PROFESSIONS: readonly Profession[] = [
  "farmer", "librarian", "butcher", "fisherman", "fletcher", "shepherd", "mason", "toolsmith", "cleric", "leatherworker",
];

/** How likely each item is to raise a composter's level, as in the original. */
export const COMPOST_CHANCE: Record<string, number> = {
  wheat_seeds: 0.3, oak_sapling: 0.3, birch_sapling: 0.3, spruce_sapling: 0.3, jungle_sapling: 0.3, acacia_sapling: 0.3,
  oak_leaves: 0.3, birch_leaves: 0.3, spruce_leaves: 0.3, jungle_leaves: 0.3, acacia_leaves: 0.3, short_grass: 0.3,
  melon_slice: 0.5, sugar_cane: 0.5, cactus: 0.5, fern: 0.65, lily_pad: 0.65,
  wheat: 0.65, carrot: 0.65, potato: 0.65, apple: 0.65, pumpkin: 0.65, melon: 0.65, nether_wart: 0.65,
  brown_mushroom: 0.65, red_mushroom: 0.65, dandelion: 0.65, poppy: 0.65, blue_orchid: 0.65, allium: 0.65,
  cornflower: 0.65, oxeye_daisy: 0.65, red_tulip: 0.65, lily_of_the_valley: 0.65,
  bread: 0.85, baked_potato: 0.85, hay_block: 0.85, pumpkin_pie: 1,
};

export const compostChance = (name: string): number | undefined =>
  Object.prototype.hasOwnProperty.call(COMPOST_CHANCE, name) ? COMPOST_CHANCE[name] : undefined;

/**
 * An iron golem built with its head at x,y,z: two iron blocks stacked under
 * it and two more as arms either side of the upper one, along x or along z.
 * Returns the five blocks to turn into the golem, or null if it is no golem.
 */
export function golemParts(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number): [number, number, number][] | null {
  const head = get(x, y, z);
  if (head !== B.CARVED_PUMPKIN && head !== B.JACK_O_LANTERN) return null;
  if (get(x, y - 1, z) !== B.IRON_BLOCK || get(x, y - 2, z) !== B.IRON_BLOCK) return null;
  const armsX = get(x - 1, y - 1, z) === B.IRON_BLOCK && get(x + 1, y - 1, z) === B.IRON_BLOCK;
  const armsZ = get(x, y - 1, z - 1) === B.IRON_BLOCK && get(x, y - 1, z + 1) === B.IRON_BLOCK;
  if (!armsX && !armsZ) return null;
  return [[x, y, z], [x, y - 1, z], [x, y - 2, z],
    ...(armsX ? [[x - 1, y - 1, z], [x + 1, y - 1, z]] : [[x, y - 1, z - 1], [x, y - 1, z + 1]]) as [number, number, number][]];
}

/** The work station that gives a villager each profession. */
export const JOB_BLOCKS: Record<Profession, number> = {
  farmer: B.COMPOSTER, librarian: B.LECTERN, butcher: B.SMOKER, fisherman: B.BARREL, fletcher: B.FLETCHING_TABLE,
  shepherd: B.LOOM, mason: B.STONECUTTER, toolsmith: B.SMITHING_TABLE, cleric: B.BREWING_STAND, leatherworker: B.CAULDRON,
};

export function professionForBlock(id: number): Profession | null {
  for (const p of PROFESSIONS) if (JOB_BLOCKS[p] === id) return p;
  return null;
}

export type VillageStyle = "plains" | "desert" | "savanna" | "taiga" | "snowy";

interface Materials {
  wall: number;
  corner: number;
  floor: number;
  foundation: number;
  roof: number;
  /** Stairs for a pitched roof, or null for a flat one. */
  stairs: number | null;
  path: number;
}

const STYLES: Record<VillageStyle, Materials> = {
  plains: { wall: B.OAK_PLANKS, corner: B.OAK_LOG, floor: B.OAK_PLANKS, foundation: B.COBBLE, roof: B.OAK_PLANKS, stairs: B.OAK_STAIRS, path: B.DIRT_PATH },
  taiga: { wall: B.SPRUCE_PLANKS, corner: B.SPRUCE_LOG, floor: B.SPRUCE_PLANKS, foundation: B.COBBLE, roof: B.SPRUCE_PLANKS, stairs: B.COBBLE_STAIRS, path: B.DIRT_PATH },
  savanna: { wall: B.ACACIA_PLANKS, corner: B.ACACIA_LOG, floor: B.ACACIA_PLANKS, foundation: B.COBBLE, roof: B.ACACIA_PLANKS, stairs: B.OAK_STAIRS, path: B.DIRT_PATH },
  snowy: { wall: B.SPRUCE_PLANKS, corner: B.SPRUCE_LOG, floor: B.SPRUCE_PLANKS, foundation: B.STONE_BRICKS, roof: B.SPRUCE_PLANKS, stairs: B.STONE_BRICK_STAIRS, path: B.DIRT_PATH },
  desert: { wall: B.SANDSTONE, corner: B.SANDSTONE, floor: B.SANDSTONE, foundation: B.SANDSTONE, roof: B.SANDSTONE, stairs: null, path: B.SANDSTONE },
};

const STYLE_OF_BIOME: Partial<Record<number, VillageStyle>> = {
  [BiomeId.Plains]: "plains", [BiomeId.SunflowerPlains]: "plains", [BiomeId.Meadow]: "plains",
  [BiomeId.Desert]: "desert", [BiomeId.Savanna]: "savanna", [BiomeId.Taiga]: "taiga", [BiomeId.SnowyPlains]: "snowy",
};

/** What the plan needs from the generator: terrain height and biome for any column. */
export interface Terrain {
  surfaceY(x: number, z: number): number;
  biomeAt(x: number, z: number): number;
}

export type HouseKind = "small" | "big" | "farm" | "library";

export interface House {
  kind: HouseKind;
  /** Minimum corner and size of the footprint (walls included). */
  x0: number; z0: number; w: number; d: number;
  /** Floor level: the floor blocks sit at y, the room starts at y + 1. */
  y: number;
  /** Which wall faces the road: 0 north, 1 south, 2 west, 3 east. */
  front: number;
  profession: Profession;
  /** Where the work station stands, and where the villager who uses it sleeps. */
  job: [number, number, number];
  bed: [number, number, number] | null;
  chest: [number, number, number] | null;
}

export interface Village {
  key: string;
  x: number; y: number; z: number;
  style: VillageStyle;
  houses: House[];
  /** Road columns (the road follows the ground). */
  roads: [number, number][];
  lamps: [number, number][];
  /** Bounding box, for finding the chunks it touches. */
  x0: number; z0: number; x1: number; z1: number;
}

/** Chunks per side of a village region: at most one village per region. */
export const VILLAGE_REGION = 20;

const DIRS: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/** The village of one region, or null when the dice or the land say no. */
export function villageInRegion(t: Terrain, seed: number, rx: number, rz: number): Village | null {
  const rng = new Rng(hash4(seed, rx, rz, 0x7111a6e));
  if (rng.next() > 0.85) return null;
  // Up to three sites in the region, the first that suits: a village biome, above the sea,
  // and ground within 16 blocks that swings no more than twelve.
  let site: { X: number; Y: number; Z: number; style: VillageStyle } | null = null;
  for (let attempt = 0; attempt < 3 && !site; attempt++) {
    const ccx = rx * VILLAGE_REGION + 4 + rng.int(VILLAGE_REGION - 8);
    const ccz = rz * VILLAGE_REGION + 4 + rng.int(VILLAGE_REGION - 8);
    const X = ccx * 16 + 8, Z = ccz * 16 + 8;
    const style = STYLE_OF_BIOME[t.biomeAt(X, Z)];
    if (!style) continue;
    const Y = t.surfaceY(X, Z);
    if (Y <= SEA_LEVEL || Y > WORLD_HEIGHT - 24) continue;
    let lo = Y, hi = Y;
    for (const [dx, dz] of [[16, 0], [-16, 0], [0, 16], [0, -16], [11, 11], [-11, -11], [11, -11], [-11, 11]]) {
      const h = t.surfaceY(X + dx, Z + dz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 12 || lo <= SEA_LEVEL - 1) continue;
    site = { X, Y, Z, style };
  }
  if (!site) return null;
  const { X, Y, Z, style } = site;

  const houses: House[] = [];
  const roads: [number, number][] = [];
  const lamps: [number, number][] = [];
  const taken: [number, number, number, number][] = [[X - 3, Z - 3, X + 3, Z + 3]]; // the well
  const overlaps = (x0: number, z0: number, x1: number, z1: number) =>
    taken.some(([a, b, c, d]) => x0 <= c + 1 && x1 >= a - 1 && z0 <= d + 1 && z1 >= b - 1);

  // Two to four roads out of the square.
  const dirs = [0, 1, 2, 3].filter(() => rng.next() < 0.8);
  while (dirs.length < 2) { const d = rng.int(4); if (!dirs.includes(d)) dirs.push(d); }
  for (const dir of dirs) {
    const [dx, dz] = DIRS[dir];
    const length = 16 + rng.int(14);
    for (let s = 3; s <= length; s++) for (let l = -1; l <= 1; l++) {
      const x = X + dx * s + (dz !== 0 ? l : 0), z = Z + dz * s + (dx !== 0 ? l : 0);
      roads.push([x, z]);
    }
    taken.push([Math.min(X + dx * 3, X + dx * length) - (dz !== 0 ? 1 : 0), Math.min(Z + dz * 3, Z + dz * length) - (dx !== 0 ? 1 : 0),
      Math.max(X + dx * 3, X + dx * length) + (dz !== 0 ? 1 : 0), Math.max(Z + dz * 3, Z + dz * length) + (dx !== 0 ? 1 : 0)]);
    lamps.push([X + dx * length + (dz !== 0 ? 2 : 0), Z + dz * length + (dx !== 0 ? 2 : 0)]);
    for (let s = 6; s <= length - 2; s += 8 + rng.int(2)) for (const side of [1, -1]) {
      if (rng.next() < 0.15) continue;
      const roll = rng.next();
      const kind: HouseKind = roll < 0.4 ? "small" : roll < 0.62 ? "big" : roll < 0.85 ? "farm" : "library";
      const [w, d] = kind === "small" ? [5, 5] : kind === "big" ? [7, 7] : kind === "farm" ? [7, 9] : [7, 7];
      // The house's front edge is three from the road's middle; it extends away from the road.
      const along = dx !== 0 ? X + dx * s : Z + dz * s;
      let x0: number, z0: number, front: number;
      if (dx !== 0) {
        // Road runs east-west: houses north (side -1) or south (side 1).
        x0 = along - Math.floor(w / 2);
        z0 = side > 0 ? Z + 3 : Z - 3 - d + 1;
        front = side > 0 ? 0 : 1;
      } else {
        z0 = along - Math.floor(w / 2);
        x0 = side > 0 ? X + 3 : X - 3 - d + 1;
        front = side > 0 ? 2 : 3;
      }
      // Along a north-south road the house turns: width runs along z, depth along x.
      const fw = dx !== 0 ? w : d, fd = dx !== 0 ? d : w;
      const x1 = x0 + fw - 1, z1 = z0 + fd - 1;
      if (overlaps(x0, z0, x1, z1)) continue;
      // The floor sits at the ground by the door; skip plots on a slope or in water.
      const doorX = front >= 2 ? (front === 2 ? x0 : x1) : x0 + Math.floor(fw / 2);
      const doorZ = front < 2 ? (front === 0 ? z0 : z1) : z0 + Math.floor(fd / 2);
      const y = t.surfaceY(doorX, doorZ);
      if (y <= SEA_LEVEL) continue;
      const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([a, b]) => t.surfaceY(a, b));
      if (corners.some((h) => Math.abs(h - y) > 5 || h <= SEA_LEVEL - 1)) continue;
      taken.push([x0, z0, x1, z1]);
      const profession: Profession = kind === "farm" ? "farmer" : kind === "library" ? "librarian"
        : PROFESSIONS[2 + rng.int(PROFESSIONS.length - 2)];
      const inX0 = x0 + 1, inZ0 = z0 + 1, inX1 = x1 - 1, inZ1 = z1 - 1;
      // Inside: the station in a back corner, the bed along the back wall, a chest by the door.
      const back = front === 0 ? inZ1 : front === 1 ? inZ0 : front === 2 ? inX1 : inX0;
      let job: [number, number, number], bed: [number, number, number] | null, chest: [number, number, number] | null;
      if (kind === "farm") {
        job = [x0, y + 1, z0];
        bed = null;
        chest = null;
      } else if (front < 2) {
        job = [inX0, y + 1, back];
        bed = [inX1, y + 1, back];
        chest = rng.next() < 0.6 ? [inX1, y + 1, front === 0 ? inZ0 : inZ1] : null;
      } else {
        job = [back, y + 1, inZ0];
        bed = [back, y + 1, inZ1];
        chest = rng.next() < 0.6 ? [front === 2 ? inX0 : inX1, y + 1, inZ1] : null;
      }
      houses.push({ kind, x0, z0, w: fw, d: fd, y, front, profession, job, bed, chest });
    }
  }
  if (houses.length < 2) return null;
  let bx0 = X - 4, bz0 = Z - 4, bx1 = X + 4, bz1 = Z + 4;
  for (const [x, z] of [...roads, ...lamps]) { bx0 = Math.min(bx0, x); bz0 = Math.min(bz0, z); bx1 = Math.max(bx1, x); bz1 = Math.max(bz1, z); }
  for (const h of houses) { bx0 = Math.min(bx0, h.x0); bz0 = Math.min(bz0, h.z0); bx1 = Math.max(bx1, h.x0 + h.w - 1); bz1 = Math.max(bz1, h.z0 + h.d - 1); }
  return { key: `${rx},${rz}`, x: X, y: Y, z: Z, style, houses, roads, lamps, x0: bx0 - 1, z0: bz0 - 1, x1: bx1 + 1, z1: bz1 + 1 };
}

const cache = new Map<string, Village | null>();

/** Villages whose ground overlaps chunk (cx, cz), or comes within `margin` blocks of it. */
export function villagesTouching(t: Terrain, seed: number, cx: number, cz: number, margin = 0): Village[] {
  const out: Village[] = [];
  const rx0 = Math.floor((cx - 3) / VILLAGE_REGION), rx1 = Math.floor((cx + 3) / VILLAGE_REGION);
  const rz0 = Math.floor((cz - 3) / VILLAGE_REGION), rz1 = Math.floor((cz + 3) / VILLAGE_REGION);
  for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
    const key = `${seed}:${rx},${rz}`;
    let v = cache.get(key);
    if (v === undefined) {
      v = villageInRegion(t, seed, rx, rz);
      if (cache.size > 256) cache.clear();
      cache.set(key, v);
    }
    if (!v) continue;
    if (v.x1 + margin < cx * 16 || v.x0 - margin > cx * 16 + 15 || v.z1 + margin < cz * 16 || v.z0 - margin > cz * 16 + 15) continue;
    out.push(v);
  }
  return out;
}

const roadSets = new WeakMap<Village, Set<string>>();

/**
 * Whether a tree rooted at x,z would grow into the village: its canopy over a
 * roof or its trunk through a floor. Houses and the square keep four blocks
 * clear, which covers the widest canopy; roads keep their own width clear.
 */
export function crowdsVillage(v: Village, x: number, z: number): boolean {
  const M = 4;
  if (x < v.x0 - M || x > v.x1 + M || z < v.z0 - M || z > v.z1 + M) return false;
  if (Math.abs(x - v.x) <= 3 + M && Math.abs(z - v.z) <= 3 + M) return true;
  for (const h of v.houses) {
    if (x >= h.x0 - M && x < h.x0 + h.w + M && z >= h.z0 - M && z < h.z0 + h.d + M) return true;
  }
  let roads = roadSets.get(v);
  if (!roads) {
    roads = new Set([...v.roads, ...v.lamps].map(([rx, rz]) => `${rx},${rz}`));
    roadSets.set(v, roads);
  }
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (roads.has(`${x + dx},${z + dz}`)) return true;
  return false;
}

/** Writes a block of the village; the caller clips to its own chunk. */
export type Stamp = (x: number, y: number, z: number, id: number, meta?: number) => void;

/** Builds every part of a village through `set`, which only keeps what falls in its chunk. */
export function buildVillage(v: Village, t: Terrain, set: Stamp): void {
  const m = STYLES[v.style];
  // Roads follow the ground; grass and plants above them are cleared.
  for (const [x, z] of v.roads) {
    const y = t.surfaceY(x, z);
    if (y < SEA_LEVEL) {
      // A plank bridge where the road crosses water.
      set(x, SEA_LEVEL, z, B.OAK_PLANKS);
      continue;
    }
    set(x, y, z, m.path);
    set(x, y + 1, z, B.AIR);
    set(x, y + 2, z, B.AIR);
  }
  buildWell(v, t, m, set);
  for (const [x, z] of v.lamps) {
    const y = t.surfaceY(x, z);
    set(x, y + 1, z, B.OAK_FENCE);
    set(x, y + 2, z, B.OAK_FENCE);
    set(x, y + 3, z, B.TORCH, 0);
  }
  for (const h of v.houses) {
    if (h.kind === "farm") buildFarm(h, t, m, set);
    else buildHouse(h, t, m, set, v.style);
  }
}

function buildWell(v: Village, t: Terrain, m: Materials, set: Stamp): void {
  const y = v.y;
  // Level the square around it first.
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const x = v.x + dx, z = v.z + dz, g = t.surfaceY(x, z);
    for (let yy = Math.min(g, y) + 1; yy < y; yy++) set(x, yy, z, m.foundation);
    set(x, y, z, Math.abs(dx) <= 2 && Math.abs(dz) <= 2 ? B.COBBLE : m.path);
    for (let yy = y + 1; yy <= Math.max(g, y) + 3; yy++) set(x, yy, z, B.AIR);
  }
  // A 4×4 cobblestone ring round two blocks of water, four posts and a roof.
  for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
    const x = v.x + dx, z = v.z + dz;
    const rim = dx === -1 || dx === 2 || dz === -1 || dz === 2;
    if (rim) set(x, y + 1, z, B.COBBLE);
    else { set(x, y, z, B.WATER); set(x, y - 1, z, B.WATER); set(x, y - 2, z, B.COBBLE); }
    if ((dx === -1 || dx === 2) && (dz === -1 || dz === 2)) { set(x, y + 2, z, B.OAK_FENCE); set(x, y + 3, z, B.OAK_FENCE); }
    set(x, y + 4, z, B.COBBLE_SLAB, 0);
  }
  // The bell that calls the village, in a corner of the square, clear of the roads.
  set(v.x - 2, y + 1, v.z - 2, B.BELL, 1);
  // And in the opposite corner, the village's waystone (engine/waystones.ts), for travellers to wake.
  set(v.x + 3, y + 1, v.z + 3, B.WAYSTONE);
}

function clearAndFound(h: House, t: Terrain, m: Materials, set: Stamp, clearTo: number): void {
  for (let z = h.z0; z < h.z0 + h.d; z++) for (let x = h.x0; x < h.x0 + h.w; x++) {
    const g = t.surfaceY(x, z);
    for (let y = Math.min(g, h.y - 1); y < h.y; y++) set(x, y, z, m.foundation);
    for (let y = h.y + 1; y <= Math.max(g, clearTo); y++) set(x, y, z, B.AIR);
  }
}

function buildFarm(h: House, t: Terrain, m: Materials, set: Stamp): void {
  clearAndFound(h, t, m, set, h.y + 3);
  const crops = [B.WHEAT, B.WHEAT, B.CARROTS, B.POTATOES];
  const crop = crops[Math.abs(h.x0 * 31 + h.z0 * 17) % crops.length];
  const maxAge = crop === B.WHEAT ? 7 : 3;
  const alongX = h.w >= h.d;
  for (let z = h.z0; z < h.z0 + h.d; z++) for (let x = h.x0; x < h.x0 + h.w; x++) {
    const edge = x === h.x0 || z === h.z0 || x === h.x0 + h.w - 1 || z === h.z0 + h.d - 1;
    if (edge) { set(x, h.y, z, m.corner, 0); continue; }
    // A water channel down the middle keeps the whole field moist.
    const channel = alongX ? z === h.z0 + Math.floor(h.d / 2) : x === h.x0 + Math.floor(h.w / 2);
    if (channel) { set(x, h.y, z, B.WATER); continue; }
    set(x, h.y, z, B.FARMLAND, 7);
    set(x, h.y + 1, z, crop, Math.abs(x * 7 + z * 13) % (maxAge + 1));
  }
  set(h.job[0], h.job[1], h.job[2], B.COMPOSTER, 3);
}

function buildHouse(h: House, t: Terrain, m: Materials, set: Stamp, style: VillageStyle): void {
  const wallTop = h.y + 3;
  const roofRise = m.stairs ? Math.ceil(h.w / 2) : 1;
  clearAndFound(h, t, m, set, wallTop + roofRise + 1);
  const x1 = h.x0 + h.w - 1, z1 = h.z0 + h.d - 1;
  const doorX = h.front >= 2 ? (h.front === 2 ? h.x0 : x1) : h.x0 + Math.floor(h.w / 2);
  const doorZ = h.front < 2 ? (h.front === 0 ? h.z0 : z1) : h.z0 + Math.floor(h.d / 2);
  for (let z = h.z0; z <= z1; z++) for (let x = h.x0; x <= x1; x++) {
    set(x, h.y, z, m.floor);
    const wallX = x === h.x0 || x === x1, wallZ = z === h.z0 || z === z1;
    if (!wallX && !wallZ) continue;
    const corner = wallX && wallZ;
    for (let y = h.y + 1; y <= wallTop; y++) {
      // Windows in the middle of each side wall, a block up.
      const mid = (wallZ && !wallX && Math.abs(x - (h.x0 + x1) / 2) < 1) || (wallX && !wallZ && Math.abs(z - (h.z0 + z1) / 2) < 1);
      const window = !corner && mid && y === h.y + 2 && !(x === doorX && z === doorZ);
      set(x, y, z, corner ? m.corner : window ? B.GLASS_PANE : m.wall, 0);
    }
  }
  // The door on the road side (facing in, as a player walking in would place it).
  const inward = [1, 0, 3, 2][h.front];
  set(doorX, h.y + 1, doorZ, B.OAK_DOOR, inward);
  set(doorX, h.y + 2, doorZ, B.OAK_DOOR, inward | 8);
  // A step of path in front of the door.
  const [odx, odz] = DIRS[h.front];
  set(doorX + odx, t.surfaceY(doorX + odx, doorZ + odz), doorZ + odz, m.path);
  buildRoof(h, m, set, wallTop, style);
  // Furniture.
  const [jx, jy, jz] = h.job;
  set(jx, jy, jz, JOB_BLOCKS[h.profession], jobMeta(h.profession, h.front));
  if (h.bed) {
    const [bx, by, bz] = h.bed;
    // The bed's head against the side wall, its foot out into the room.
    const along = h.front < 2 ? (bx > h.x0 + h.w / 2 ? 3 : 2) : (bz > h.z0 + h.d / 2 ? 1 : 0);
    const [fx, fz] = [[0, -1], [0, 1], [-1, 0], [1, 0]][along];
    set(bx - fx, by, bz - fz, B.RED_BED, along);
    set(bx, by, bz, B.RED_BED, along | 4);
  }
  if (h.chest) set(h.chest[0], h.chest[1], h.chest[2], B.CHEST, 0);
  if (h.kind === "library") {
    // Shelves along the inside of the side walls.
    for (let z = h.z0 + 1; z < z1; z++) for (let x = h.x0 + 1; x < x1; x++) {
      const edge = x === h.x0 + 1 || x === x1 - 1 || z === h.z0 + 1 || z === z1 - 1;
      const nearDoor = Math.abs(x - doorX) + Math.abs(z - doorZ) <= 2;
      const reserved = (x === jx && z === jz) || (h.bed && Math.abs(x - h.bed[0]) + Math.abs(z - h.bed[2]) <= 1) || (h.chest && x === h.chest[0] && z === h.chest[2]);
      if (edge && !nearDoor && !reserved) set(x, h.y + 1, z, B.BOOKSHELF);
    }
  }
  // A torch on the inside of the back wall.
  const cx = h.x0 + Math.floor(h.w / 2), cz = h.z0 + Math.floor(h.d / 2);
  const tx = h.front === 2 ? x1 - 1 : h.front === 3 ? h.x0 + 1 : cx;
  const tz = h.front === 0 ? z1 - 1 : h.front === 1 ? h.z0 + 1 : cz;
  set(tx, h.y + 3, tz, B.TORCH, 1 + [0, 1, 2, 3][h.front]);
}

/** A station's meta: most face the door; a barrel's lid faces up; tubs and stands start empty. */
function jobMeta(p: Profession, front: number): number {
  switch (p) {
    case "fisherman": return 2; // Face.Up
    case "leatherworker": return 2; // a cauldron two-thirds full
    case "cleric": case "farmer": return 0;
    default: return front;
  }
}

function buildRoof(h: House, m: Materials, set: Stamp, wallTop: number, style: VillageStyle): void {
  const x1 = h.x0 + h.w - 1, z1 = h.z0 + h.d - 1;
  if (!m.stairs) {
    // Desert houses: a flat roof with a low parapet.
    for (let z = h.z0; z <= z1; z++) for (let x = h.x0; x <= x1; x++) {
      set(x, wallTop + 1, z, m.roof);
      if (x === h.x0 || x === x1 || z === h.z0 || z === z1) set(x, wallTop + 2, z, B.SANDSTONE);
    }
    return;
  }
  // A pitched roof: stairs stepping in from the two long sides, gables filled at the ends.
  const alongX = h.w >= h.d; // the ridge runs along the longer side
  const span = alongX ? h.d : h.w;
  const layers = Math.ceil(span / 2);
  for (let i = 0; i < layers; i++) {
    const y = wallTop + 1 + i;
    const lo = (alongX ? h.z0 : h.x0) + i, hi = (alongX ? z1 : x1) - i;
    for (let a = alongX ? h.x0 - 1 : h.z0 - 1; a <= (alongX ? x1 + 1 : z1 + 1); a++) {
      if (lo === hi) {
        if (alongX) set(a, y, lo, m.roof); else set(lo, y, a, m.roof);
        continue;
      }
      // The high side of each stair faces the ridge.
      if (alongX) { set(a, y, lo, m.stairs, 1); set(a, y, hi, m.stairs, 0); }
      else { set(lo, y, a, m.stairs, 3); set(hi, y, a, m.stairs, 2); }
      if (a === (alongX ? h.x0 : h.z0) || a === (alongX ? x1 : z1)) {
        for (let b = lo + 1; b < hi; b++) { if (alongX) set(a, y, b, m.wall); else set(b, y, a, m.wall); }
      }
    }
  }
  if (style === "snowy" && span % 2 === 1) {
    // Snow settled on the ridge.
    const y = wallTop + layers + 1;
    for (let a = alongX ? h.x0 - 1 : h.z0 - 1; a <= (alongX ? x1 + 1 : z1 + 1); a++) {
      const mid = alongX ? h.z0 + Math.floor(h.d / 2) : h.x0 + Math.floor(h.w / 2);
      if (alongX) set(a, y, mid, B.SNOW); else set(mid, y, a, B.SNOW);
    }
  }
}

/** What a village chest holds: food and seeds, some ore, now and then an emerald or a book. */
export function villageLoot(items: (ItemStack | null)[], seed: number): void {
  const rng = new Rng(seed);
  const table: [string, number, number, number][] = [
    ["bread", 1, 4, 0.7], ["wheat", 2, 7, 0.5], ["wheat_seeds", 2, 6, 0.5], ["apple", 1, 3, 0.4], ["potato", 1, 4, 0.3],
    ["carrot", 1, 4, 0.3], ["iron_ingot", 1, 3, 0.25], ["emerald", 1, 3, 0.2], ["coal", 2, 6, 0.3], ["book", 1, 2, 0.15],
    ["oak_sapling", 1, 3, 0.2], ["torch", 2, 6, 0.3], ["leather", 1, 3, 0.2],
  ];
  for (const [name, lo, hi, chance] of table) {
    if (rng.next() >= chance) continue;
    const slot = rng.int(items.length);
    if (items[slot]) continue;
    items[slot] = { id: itemByName(name).id, count: lo + rng.int(hi - lo + 1) };
  }
}
