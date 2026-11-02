/**
 * Better dungeons (after YUNG's Better Dungeons and When Dungeons Arise):
 * places underground worth looking for.
 *
 * - Catacombs: a maze of crypt rooms in old stone brick, eight blocks to a
 *   room, joined by arched doorways, with bone pillars, cobwebs, lanterns,
 *   two monster spawners and chests of grave goods; a ladder shaft rises from
 *   one corner room to a mossy ring at the surface, so they can be found
 *   from above as well as broken into from a cave.
 * - Spider caves: a hollow in the rock, its walls strung with cobweb round a
 *   spider spawner, and the chests of whoever did not make it out.
 *
 * Each 256-block region of the overworld may hold one of each, placed from
 * the seed alone and kept well inside the region, so a chunk only ever asks
 * its own region. A plan is its blocks, grouped by chunk, stamped into each
 * chunk as it generates (and cached, since neighbouring chunks share it).
 */
import { B } from "./blocks";
import { WORLD_HEIGHT, blockIndex } from "./constants";
import { enchantedBook, ENCHANTMENTS } from "./enchanting";
import { itemByName, type ItemStack } from "./items";
import { hash4, Rng } from "./rng";

export type DungeonKind = "catacombs" | "spider_cave";

export interface Dungeon {
  key: string;
  kind: DungeonKind;
  /** The middle, and the extent in x and z. */
  x: number;
  y: number;
  z: number;
  bounds: [number, number, number, number];
  /** Blocks by chunk ("cx,cz"), flat as x, y, z, id, meta. */
  blocks: Map<string, number[]>;
  chests: [number, number, number][];
  /** Spawner cells, with the SPAWNER_MOBS index kept in their meta. */
  spawners: [number, number, number][];
  /** Catacombs: the top of the entrance shaft (its surface ring is found when stamping). */
  shaft?: [number, number];
}

export const DUNGEON_REGION = 256;
/** Kept this far inside a region, so a dungeon never crosses into the next. */
const MARGIN = 56;
/** SPAWNER_MOBS (nether.ts) indices: zombie 1, skeleton 2, spider 3. */
const SPAWN_ZOMBIE = 1, SPAWN_SKELETON = 2, SPAWN_SPIDER = 3;

class Plan {
  readonly blocks = new Map<string, number[]>();
  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (y < 1 || y >= WORLD_HEIGHT - 1) return;
    const k = `${x >> 4},${z >> 4}`;
    let list = this.blocks.get(k);
    if (!list) { list = []; this.blocks.set(k, list); }
    list.push(x, y, z, id, meta);
  }
}

/** Old stone brick, as crypt walls are: mostly plain, some mossy, some cracked. */
function wallBrick(rng: Rng): number {
  const r = rng.next();
  return r < 0.55 ? B.STONE_BRICKS : r < 0.8 ? B.MOSSY_STONE_BRICKS : r < 0.95 ? B.CRACKED_STONE_BRICKS : B.MOSSY_COBBLE;
}

function planCatacombs(X: number, Y: number, Z: number, rng: Rng, key: string): Dungeon {
  const plan = new Plan();
  const N = 4 + rng.int(2);
  const C = 8;
  const x0 = X - Math.floor((N * C) / 2), z0 = Z - Math.floor((N * C) / 2);
  const H = 5;
  // The shell: every cell a room, walls shared, floor and ceiling whole.
  for (let x = x0; x <= x0 + N * C; x++) for (let z = z0; z <= z0 + N * C; z++) for (let y = Y; y <= Y + H; y++) {
    const inner = (x - x0) % C !== 0 && (z - z0) % C !== 0 && y > Y && y < Y + H;
    if (inner) plan.set(x, y, z, B.AIR);
    else if (y === Y) plan.set(x, y, z, rng.next() < 0.15 ? B.GRAVEL : rng.next() < 0.5 ? B.COBBLE : B.STONE_BRICKS);
    else plan.set(x, y, z, wallBrick(rng));
  }
  // A maze through the rooms (a spanning tree by random walk), and a few extra doorways for loops.
  const seen = new Set<number>([0]);
  const stack = [0];
  const doors: [number, number][] = [];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const ci = cur % N, cj = Math.floor(cur / N);
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([di, dj]) => [ci + di, cj + dj])
      .filter(([i, j]) => i >= 0 && j >= 0 && i < N && j < N && !seen.has(j * N + i));
    if (!next.length) { stack.pop(); continue; }
    const [ni, nj] = next[rng.int(next.length)];
    const n = nj * N + ni;
    seen.add(n);
    stack.push(n);
    doors.push([cur, n]);
  }
  for (let k = 0; k < N; k++) {
    const a = rng.int(N * N), dir = rng.int(2);
    const b = dir ? a + 1 : a + N;
    if ((dir && (a % N) + 1 < N) || (!dir && b < N * N)) doors.push([a, b]);
  }
  for (const [a, b] of doors) {
    const ai = a % N, aj = Math.floor(a / N), bi = b % N, bj = Math.floor(b / N);
    if (ai !== bi) {
      const wx = x0 + Math.max(ai, bi) * C, mz = z0 + aj * C + C / 2;
      for (let dz = -1; dz <= 1; dz++) for (let y = Y + 1; y <= Y + 3; y++) plan.set(wx, y, mz + dz, B.AIR);
      plan.set(wx, Y + 4, mz, B.CHISELED_STONE_BRICKS);
    } else {
      const wz = z0 + Math.max(aj, bj) * C, mx = x0 + ai * C + C / 2;
      for (let dx = -1; dx <= 1; dx++) for (let y = Y + 1; y <= Y + 3; y++) plan.set(mx + dx, y, wz, B.AIR);
      plan.set(mx, Y + 4, wz, B.CHISELED_STONE_BRICKS);
    }
  }
  // Rooms: two keep spawners, a few keep chests, all have their crypt furniture.
  const cells = Array.from({ length: N * N }, (_, i) => i).filter((i) => i !== 0);
  const pick = () => cells.splice(rng.int(cells.length), 1)[0];
  const spawnRooms = new Set([pick(), pick()]);
  const chestRooms = new Set([pick(), pick(), ...(rng.next() < 0.5 ? [pick()] : [])]);
  const chests: [number, number, number][] = [];
  const spawners: [number, number, number][] = [];
  for (let c = 0; c < N * N; c++) {
    const rx = x0 + (c % N) * C, rz = z0 + Math.floor(c / N) * C;
    const cx = rx + C / 2, cz = rz + C / 2;
    // Bone pillars in the corners, cobwebs up in them.
    for (const [px, pz] of [[rx + 1, rz + 1], [rx + C - 1, rz + 1], [rx + 1, rz + C - 1], [rx + C - 1, rz + C - 1]]) {
      if (rng.next() < 0.5) for (let y = Y + 1; y < Y + H; y++) plan.set(px, y, pz, B.BONE_BLOCK);
      else if (rng.next() < 0.6) plan.set(px, Y + H - 1, pz, B.COBWEB);
    }
    if (spawnRooms.has(c)) {
      spawners.push([cx, Y + 1, cz]);
      plan.set(cx, Y + 1, cz, B.SPAWNER, rng.next() < 0.5 ? SPAWN_SKELETON : SPAWN_ZOMBIE);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) plan.set(cx + dx, Y, cz + dz, B.MOSSY_COBBLE);
    } else if (chestRooms.has(c)) {
      const cz2 = rz + 1 + rng.int(C - 3), cx2 = rx + 2 + rng.int(C - 3);
      chests.push([cx2, Y + 1, cz2]);
      plan.set(cx2, Y + 1, cz2, B.CHEST, rng.int(4));
    } else if (rng.next() < 0.5) {
      // A tomb: a raised slab of chiselled brick in the middle of the room.
      for (let dx = -1; dx <= 1; dx++) plan.set(cx + dx, Y + 1, cz, B.CHISELED_STONE_BRICKS);
    }
    if (rng.next() < 0.4) plan.set(rx + 2, Y + 1, rz + C - 2, B.LANTERN);
  }
  // The way in: a ladder shaft from the first room up to the surface (its height is found while stamping).
  const sx = x0 + C / 2, sz = z0 + C / 2;
  return {
    key, kind: "catacombs", x: X, y: Y, z: Z, bounds: [x0, z0, x0 + N * C, z0 + N * C],
    blocks: plan.blocks, chests, spawners, shaft: [sx, sz],
  };
}

function planSpiderCave(X: number, Y: number, Z: number, rng: Rng, key: string): Dungeon {
  const plan = new Plan();
  const R = 6 + rng.int(3), RY = Math.max(4, Math.floor(R * 0.6));
  const wobble = (x: number, y: number, z: number) => 0.85 + 0.25 * Math.sin(x * 1.3 + z * 0.7) * Math.cos(y * 1.1 + x * 0.5);
  const inside = (x: number, y: number, z: number) => ((x - X) / R) ** 2 + ((y - Y) / RY) ** 2 + ((z - Z) / R) ** 2 < wobble(x, y, z);
  for (let x = X - R - 1; x <= X + R + 1; x++) for (let z = Z - R - 1; z <= Z + R + 1; z++) for (let y = Y - RY - 1; y <= Y + RY + 1; y++) {
    if (inside(x, y, z)) {
      // Webs cling to the walls and hang from the roof.
      const edge = !inside(x + 1, y, z) || !inside(x - 1, y, z) || !inside(x, y + 1, z) || !inside(x, y, z + 1) || !inside(x, y, z - 1);
      plan.set(x, y, z, edge && y > Y - RY + 1 && rng.next() < 0.35 ? B.COBWEB : B.AIR);
    } else if (y < Y - RY + 2 && inside(x, y + 1, z)) plan.set(x, y, z, rng.next() < 0.3 ? B.MOSSY_COBBLE : B.COBBLE);
  }
  // The floor: flattened so the spawner and chests stand.
  const fy = Y - RY + 2;
  for (let x = X - 2; x <= X + 2; x++) for (let z = Z - 2; z <= Z + 2; z++) plan.set(x, fy - 1, z, B.MOSSY_COBBLE);
  plan.set(X, fy, Z, B.SPAWNER, SPAWN_SPIDER);
  for (let x = X - 2; x <= X + 2; x++) for (let z = Z - 2; z <= Z + 2; z++) if ((x !== X || z !== Z)) for (let y = fy; y < fy + 3; y++) plan.set(x, y, z, B.AIR);
  const chests: [number, number, number][] = [[X + 2, fy, Z], [X - 2, fy, Z - 1]].slice(0, 1 + rng.int(2)) as [number, number, number][];
  for (const [cx, cy, cz] of chests) plan.set(cx, cy, cz, B.CHEST, rng.int(4));
  return {
    key, kind: "spider_cave", x: X, y: Y, z: Z, bounds: [X - R - 1, Z - R - 1, X + R + 1, Z + R + 1],
    blocks: plan.blocks, chests, spawners: [[X, fy, Z]],
  };
}

const cache = new Map<string, Dungeon[]>();

/** The dungeons of a region: at most one catacomb and one spider cave, from the seed alone. */
export function dungeonsInRegion(seed: number, rx: number, rz: number): Dungeon[] {
  const k = `${seed}:${rx},${rz}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const out: Dungeon[] = [];
  const at = (salt: number) => {
    const rng = new Rng(hash4(seed, rx, rz, salt));
    return { rng, x: rx * DUNGEON_REGION + MARGIN + rng.int(DUNGEON_REGION - MARGIN * 2), z: rz * DUNGEON_REGION + MARGIN + rng.int(DUNGEON_REGION - MARGIN * 2) };
  };
  const c = at(0xca7a);
  if (c.rng.next() < 0.45) out.push(planCatacombs(c.x, 14 + c.rng.int(14), c.z, c.rng, `catacombs:${rx},${rz}`));
  const s = at(0x5b1d);
  if (s.rng.next() < 0.5) {
    const sp = planSpiderCave(s.x, 16 + s.rng.int(20), s.z, s.rng, `spider:${rx},${rz}`);
    // Two dungeons do not share rock: the cave gives way to the catacombs.
    const [a0, b0, a1, b1] = sp.bounds;
    if (!out.some((d) => a0 <= d.bounds[2] + 4 && a1 >= d.bounds[0] - 4 && b0 <= d.bounds[3] + 4 && b1 >= d.bounds[1] - 4)) out.push(sp);
  }
  if (cache.size > 64) cache.clear();
  cache.set(k, out);
  return out;
}

/** The dungeons reaching into a chunk. */
export function dungeonsTouching(seed: number, cx: number, cz: number): Dungeon[] {
  const rx = Math.floor((cx * 16) / DUNGEON_REGION), rz = Math.floor((cz * 16) / DUNGEON_REGION);
  return dungeonsInRegion(seed, rx, rz).filter((d) => d.blocks.has(`${cx},${cz}`) || (d.shaft && d.shaft[0] >> 4 === cx && d.shaft[1] >> 4 === cz));
}

/**
 * A dungeon's share of a chunk, into its blocks. A catacomb's shaft climbs
 * from its first room to the surface of this very chunk — found here, where
 * the column is already built — and is ringed there with mossy brick.
 */
export function stampDungeon(d: Dungeon, blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number): void {
  const list = d.blocks.get(`${cx},${cz}`) ?? [];
  const x0 = cx * 16, z0 = cz * 16;
  for (let i = 0; i < list.length; i += 5) {
    const idx = blockIndex(list[i] - x0, list[i + 1], list[i + 2] - z0);
    blocks[idx] = list[i + 3];
    meta[idx] = list[i + 4];
  }
  if (d.shaft && d.shaft[0] >> 4 === cx && d.shaft[1] >> 4 === cz) {
    const [sx, sz] = d.shaft;
    const lx = sx - x0, lz = sz - z0;
    // The surface: the highest solid ground in the shaft's column.
    let top = WORLD_HEIGHT - 2;
    while (top > d.y + 6 && (blocks[blockIndex(lx, top, lz)] === B.AIR || blocks[blockIndex(lx, top, lz)] === B.WATER || blocks[blockIndex(lx, top, lz)] >= B.DANDELION && blocks[blockIndex(lx, top, lz)] <= B.LILY_OF_THE_VALLEY)) top--;
    if (blocks[blockIndex(lx, top, lz)] === B.WATER) return;
    const put = (x: number, y: number, z: number, id: number, m = 0) => {
      const ax = x - x0, az = z - z0;
      if (ax < 0 || ax > 15 || az < 0 || az > 15 || y < 1 || y >= WORLD_HEIGHT - 1) return;
      blocks[blockIndex(ax, y, az)] = id;
      meta[blockIndex(ax, y, az)] = m;
    };
    for (let y = d.y + 1; y <= top + 1; y++) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) put(sx, y, sz, B.LADDER, 0);
        // The ladder's own wall runs all the way down, a pillar in the room below; the rest of the shaft starts above its roof.
        else if (dx === 0 && dz === -1) put(sx, y, sz - 1, B.STONE_BRICKS);
        else if (y > d.y + 4) put(sx + dx, y, sz + dz, B.MOSSY_STONE_BRICKS);
      }
    }
    // Above ground: a low ring, open to the sky, to be found by.
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) put(sx + dx, top + 2, sz + dz, B.MOSSY_COBBLE);
    put(sx, top + 2, sz, B.AIR);
    put(sx, top + 3, sz, B.AIR);
  }
}

/** What a dungeon's chest holds: bones and grave goods; the older the dead, the richer. */
export function dungeonLoot(items: (ItemStack | null)[], seed: number, kind: DungeonKind): void {
  const rng = new Rng(seed);
  const table: [string, number, number, number][] = kind === "catacombs"
    ? [["bone", 2, 6, 0.9], ["rotten_flesh", 1, 5, 0.6], ["gold_ingot", 1, 4, 0.5], ["iron_ingot", 1, 5, 0.6], ["diamond", 1, 2, 0.2],
      ["golden_apple", 1, 1, 0.15], ["bread", 1, 3, 0.4], ["lapis_lazuli", 2, 6, 0.4], ["emerald", 1, 3, 0.3],
      ["iron_helmet", 1, 1, 0.15], ["iron_sword", 1, 1, 0.15], ["ender_pearl", 1, 2, 0.2]]
    : [["string", 3, 9, 0.9], ["spider_eye", 1, 4, 0.7], ["gold_ingot", 1, 3, 0.45], ["iron_ingot", 1, 4, 0.5], ["diamond", 1, 1, 0.15],
      ["bone", 1, 4, 0.5], ["arrow", 4, 12, 0.5], ["bow", 1, 1, 0.2], ["golden_apple", 1, 1, 0.1]];
  for (const [name, lo, hi, chance] of table) {
    if (rng.next() >= chance) continue;
    let id: number;
    try { id = itemByName(name).id; } catch { continue; }
    const slot = rng.int(items.length);
    if (!items[slot]) items[slot] = { id, count: lo + rng.int(hi - lo + 1) };
  }
  // A catacomb's chest may keep an enchanted book.
  if (kind === "catacombs" && rng.next() < 0.35) {
    const e = ENCHANTMENTS[rng.int(ENCHANTMENTS.length)];
    const slot = rng.int(items.length);
    if (!items[slot]) items[slot] = enchantedBook(e.name, 1 + rng.int(e.maxLevel));
  }
}
