/**
 * Strongholds: the buried halls that hold the only way into the End.
 *
 * As in the original they lie in rings around the world's centre — three in
 * the first ring, more in each ring further out — so a player can find one by
 * following eyes of ender, and every world has one within a long walk of
 * spawn. The rings are closer in than the original's (640 blocks rather than
 * 1280 to the first): a browser world streams chunks more slowly than the
 * original loads them, and a trek twice as long is twice as much waiting.
 *
 * A stronghold is planned in its own coordinates — the portal room at the
 * origin, its entrance to the south — and turned a random quarter to face any
 * way. Every chunk stamps its own share of the plan, so they generate the
 * same in any order, in any worker, like the Nether's fortresses.
 */
import { B, CLOCKWISE_FACING, FRAME_EYE, isStairs } from "./blocks";
import { blockIndex, WORLD_HEIGHT } from "./constants";
import { itemByName, itemDef, type ItemStack } from "./items";
import { rollEnchantments } from "./enchanting";
import { hash4, Rng } from "./rng";

/** Strongholds per ring and the ring's distance band from the centre, in blocks. */
export const STRONGHOLD_RINGS: readonly { count: number; min: number; max: number }[] = [
  { count: 3, min: 640, max: 1152 },
  { count: 6, min: 1792, max: 2560 },
  { count: 10, min: 3072, max: 3840 },
  { count: 15, min: 4352, max: 5120 },
];

export type StrongholdRoom = "portal" | "hub" | "library" | "storeroom" | "prison" | "fountain" | "landing";
type PieceKind = StrongholdRoom | "corridor" | "stairs";

interface Piece {
  kind: PieceKind;
  /** Local, inclusive, walls included. */
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
  /** Corridors and rooms: which local axis they run along from their door. */
  alongX: boolean;
  /** Rooms: +1 or -1, the way they run from the door; the door sits at the near end. */
  dir: number;
}

export interface Stronghold {
  key: string;
  /** The portal room's centre, where eyes of ender lead, and its floor. */
  x: number; y: number; z: number;
  /** Quarter turns clockwise from the local plan. */
  turn: number;
  pieces: Piece[];
  /** World positions of chests, and what kind of room each is in (for its loot). */
  chests: [number, number, number, StrongholdRoom][];
  spawner: [number, number, number];
  /** Frames already holding an eye (bits by frame index). */
  eyes: number;
  /** World bounding box of every piece. */
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
}

let ringCache: { seed: number; list: { x: number; z: number }[] } | null = null;

/** Every stronghold's portal room, ring by ring. */
export function strongholdPositions(seed: number): { x: number; z: number }[] {
  if (ringCache && ringCache.seed === seed) return ringCache.list;
  const rng = new Rng(hash4(seed, 0x5708, 0x4d));
  const list: { x: number; z: number }[] = [];
  for (const ring of STRONGHOLD_RINGS) {
    const start = rng.next() * Math.PI * 2;
    for (let i = 0; i < ring.count; i++) {
      const angle = start + (i / ring.count) * Math.PI * 2 + (rng.next() - 0.5) * (Math.PI / ring.count) * 0.6;
      const d = ring.min + rng.next() * (ring.max - ring.min);
      // At a chunk's middle, so the eye's target and the room share a chunk.
      list.push({ x: Math.floor((Math.cos(angle) * d) / 16) * 16 + 8, z: Math.floor((Math.sin(angle) * d) / 16) * 16 + 8 });
    }
  }
  ringCache = { seed, list };
  return list;
}

/** The nearest stronghold's portal room to x, z. */
export function nearestStronghold(seed: number, x: number, z: number): { x: number; y: number; z: number } {
  let best = 0, bestD = Infinity;
  const list = strongholdPositions(seed);
  list.forEach((p, i) => {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  const s = planStronghold(seed, best);
  return { x: s.x, y: s.y, z: s.z };
}

const ROOM_SIZE: Record<Exclude<StrongholdRoom, "portal" | "hub" | "landing">, [number, number, number]> = {
  // Across, along, height above the floor.
  library: [11, 15, 7],
  storeroom: [9, 9, 5],
  prison: [9, 9, 5],
  fountain: [9, 9, 6],
};

const planCache = new Map<string, Stronghold>();

/** The plan of the `index`th stronghold. */
export function planStronghold(seed: number, index: number): Stronghold {
  const key = `${seed}:${index}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const { x: X, z: Z } = strongholdPositions(seed)[index];
  const rng = new Rng(hash4(seed, index, 0x57a6));
  const Y = 20 + rng.int(10);
  const pieces: Piece[] = [];
  const corridors: Piece[] = [];
  const box = (kind: PieceKind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, alongX: boolean, dir = 1): Piece => ({
    kind, x0: Math.min(x0, x1), y0, z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1, z1: Math.max(z0, z1), alongX, dir,
  });
  const corridor = (alongX: boolean, a0: number, a1: number, across: number): void => {
    corridors.push(alongX ? box("corridor", a0, Y - 1, across - 2, a1, Y + 3, across + 2, true) : box("corridor", across - 2, Y - 1, a0, across + 2, Y + 3, a1, false));
  };
  /** A room whose door is in the wall at `near` on the running axis, running `dir` from it. */
  const room = (kind: keyof typeof ROOM_SIZE, alongX: boolean, near: number, dir: number, across: number): Piece => {
    const [w, d, h] = ROOM_SIZE[kind];
    const far = near + dir * (d - 1);
    const p = alongX
      ? box(kind, near, Y - 1, across - (w - 1) / 2, far, Y + h, across + (w - 1) / 2, true, dir)
      : box(kind, across - (w - 1) / 2, Y - 1, near, across + (w - 1) / 2, Y + h, far, false, dir);
    pieces.push(p);
    return p;
  };

  // The portal room at the origin, its door in the south wall, and a hall south of it.
  pieces.push(box("portal", -5, Y - 1, -8, 5, Y + 7, 7, false));
  const l0 = 6 + rng.int(8);
  corridor(false, 7, 7 + l0, 0);
  const h0 = 7 + l0, hz = h0 + 5;
  pieces.push(box("hub", -5, Y - 1, h0, 5, Y + 5, h0 + 10, false));

  const kinds = (["library", "storeroom", "prison", "fountain"] as const).slice();
  for (let i = kinds.length - 1; i > 0; i--) { const j = rng.int(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  // West and east of the hub, a hall to a room; from each, maybe a hall on northward to another.
  for (const [side, first, second] of [[-1, kinds[0], kinds[2]], [1, kinds[1], kinds[3]]] as const) {
    const len = 6 + rng.int(10);
    const near = side * (5 + len);
    corridor(true, side * 5, near, hz);
    const r = room(first, true, near, side, hz);
    if (rng.next() < 0.6) {
      const mid = (r.x0 + r.x1) >> 1;
      const len2 = 5 + rng.int(8);
      corridor(false, r.z0, r.z0 - len2, mid);
      room(second, false, r.z0 - len2, -1, mid);
    }
  }

  // South of the hub, stairs climbing toward the surface to a small landing: the stronghold's way in.
  const steps = 10 + rng.int(4);
  const s0 = h0 + 10;
  corridors.push(box("stairs", -2, Y - 1, s0, 2, Y + steps + 4, s0 + steps + 1, false));
  pieces.push(box("landing", -3, Y + steps - 1, s0 + steps + 1, 3, Y + steps + 4, s0 + steps + 7, false));
  pieces.push(...corridors);

  const turn = rng.int(4);
  const toWorld = (lx: number, lz: number): [number, number] => {
    let x = lx, z = lz;
    for (let k = 0; k < turn; k++) [x, z] = [-z, x];
    return [X + x, Z + z];
  };
  const chests: [number, number, number, StrongholdRoom][] = [];
  for (const p of pieces) {
    for (const [lx, ly, lz] of roomChests(p)) {
      const [wx, wz] = toWorld(lx, lz);
      chests.push([wx, ly, wz, p.kind as StrongholdRoom]);
    }
  }
  let eyes = 0;
  for (let i = 0; i < 12; i++) if (rng.next() < 0.1) eyes |= 1 << i;
  const [spx, spz] = toWorld(3, 0);
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const p of pieces) {
    const [ax, az] = toWorld(p.x0, p.z0), [cx, cz] = toWorld(p.x1, p.z1);
    bx0 = Math.min(bx0, ax, cx); bx1 = Math.max(bx1, ax, cx); bz0 = Math.min(bz0, az, cz); bz1 = Math.max(bz1, az, cz);
    by0 = Math.min(by0, p.y0); by1 = Math.max(by1, p.y1);
  }
  const s: Stronghold = {
    key, x: X, y: Y, z: Z, turn, pieces, chests, spawner: [spx, Y + 3, spz], eyes,
    x0: bx0, y0: by0, z0: bz0, x1: bx1, y1: by1, z1: bz1,
  };
  if (planCache.size > 64) planCache.clear();
  planCache.set(key, s);
  return s;
}

/** Local positions of the chests a room holds. */
function roomChests(p: Piece): [number, number, number][] {
  const y = p.y0 + 1;
  const along = (a: number, c: number): [number, number, number] => {
    // `a` counts from the door end, `c` across from the middle.
    const near = p.dir > 0 ? (p.alongX ? p.x0 : p.z0) : (p.alongX ? p.x1 : p.z1);
    const mid = p.alongX ? (p.z0 + p.z1) >> 1 : (p.x0 + p.x1) >> 1;
    const pa = near + p.dir * a;
    return p.alongX ? [pa, y, mid + c] : [mid + c, y, pa];
  };
  const depth = (p.alongX ? p.x1 - p.x0 : p.z1 - p.z0) + 1;
  if (p.kind === "library") return [along(depth - 2, 0)];
  if (p.kind === "storeroom") return [along(depth - 2, -3), along(depth - 2, 3)];
  return [];
}

/** Strongholds whose bounds reach into chunk (cx, cz). */
export function strongholdsTouching(seed: number, cx: number, cz: number): Stronghold[] {
  const out: Stronghold[] = [];
  const x = cx * 16 + 8, z = cz * 16 + 8;
  strongholdPositions(seed).forEach((p, i) => {
    // Nothing reaches more than ~80 blocks from its portal room: skip the far ones before planning them.
    if (Math.abs(p.x - x) > 112 || Math.abs(p.z - z) > 112) return;
    const s = planStronghold(seed, i);
    if (s.x1 < cx * 16 || s.x0 > cx * 16 + 15 || s.z1 < cz * 16 || s.z0 > cz * 16 + 15) return;
    out.push(s);
  });
  return out;
}

/** Whether a point is inside a stronghold's halls (for the advancement, and for silverfish). */
export function inStronghold(seed: number, x: number, y: number, z: number): boolean {
  for (const s of strongholdsTouching(seed, Math.floor(x) >> 4, Math.floor(z) >> 4)) {
    if (y < s.y0 || y > s.y1 + 1) continue;
    const [lx, lz] = toLocal(s, Math.floor(x), Math.floor(z));
    if (s.pieces.some((p) => lx >= p.x0 && lx <= p.x1 && lz >= p.z0 && lz <= p.z1 && y >= p.y0 && y <= p.y1)) return true;
  }
  return false;
}

function toLocal(s: Stronghold, wx: number, wz: number): [number, number] {
  let x = wx - s.x, z = wz - s.z;
  for (let k = 0; k < s.turn; k++) [x, z] = [z, -x];
  return [x, z];
}

const rotateFacing = (f: number, turn: number): number => {
  for (let k = 0; k < turn; k++) f = CLOCKWISE_FACING[f];
  return f;
};

/** Meta for a block drawn in the local plan, turned with the stronghold. */
function turnMeta(id: number, m: number, turn: number): number {
  if (!turn) return m;
  if (isStairs(id) || id === B.END_PORTAL_FRAME || id === B.CHEST) return (m & ~3) | rotateFacing(m & 3, turn);
  if (id === B.TORCH && m > 0) return 1 + rotateFacing(m - 1, turn);
  return m;
}

/** The frames around the portal, in the local plan: x, z, facing (into the ring). */
export const FRAME_RING: readonly [number, number, number][] = [
  [-2, -4, 3], [-2, -3, 3], [-2, -2, 3], [2, -4, 2], [2, -3, 2], [2, -2, 2],
  [-1, -5, 1], [0, -5, 1], [1, -5, 1], [-1, -1, 0], [0, -1, 0], [1, -1, 0],
];

/** Writes this chunk's share of a stronghold into its arrays. */
export function stampStronghold(s: Stronghold, blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number): void {
  const x0 = cx * 16, z0 = cz * 16;
  const Y = s.y;
  const wall = (x: number, y: number, z: number) => {
    const h = hash4(s.x ^ 0x5b, x, y, z) & 15;
    return h < 3 ? B.MOSSY_STONE_BRICKS : h < 5 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS;
  };
  for (const p of s.pieces) {
    for (let wz = z0; wz < z0 + 16; wz++) for (let wx = x0; wx < x0 + 16; wx++) {
      const [lx, lz] = toLocal(s, wx, wz);
      if (lx < p.x0 || lx > p.x1 || lz < p.z0 || lz > p.z1) continue;
      for (let y = Math.max(1, p.y0); y <= Math.min(WORLD_HEIGHT - 2, p.y1); y++) {
        const got = pieceBlock(p, lx, y, lz, Y, s, wall);
        if (!got) continue;
        const i = blockIndex(wx - x0, y, wz - z0);
        blocks[i] = got[0];
        meta[i] = turnMeta(got[0], got[1], s.turn);
      }
    }
  }
}

type Cell = [number, number] | null;

/** What a piece puts at a local cell (null leaves the terrain as it is). */
function pieceBlock(p: Piece, x: number, y: number, z: number, Y: number, s: Stronghold, wall: (x: number, y: number, z: number) => number): Cell {
  const shell = x === p.x0 || x === p.x1 || y === p.y0 || y === p.y1 || z === p.z0 || z === p.z1;
  const W = (): Cell => [wall(x, y, z), 0];
  const AIR: Cell = [B.AIR, 0];
  // Along and across the piece, counted from its door.
  const near = p.dir > 0 ? (p.alongX ? p.x0 : p.z0) : (p.alongX ? p.x1 : p.z1);
  const a = ((p.alongX ? x : z) - near) * p.dir;
  const c = (p.alongX ? z : x) - (p.alongX ? (p.z0 + p.z1) >> 1 : (p.x0 + p.x1) >> 1);
  const depth = (p.alongX ? p.x1 - p.x0 : p.z1 - p.z0) + 1;
  const halfW = ((p.alongX ? p.z1 - p.z0 : p.x1 - p.x0)) >> 1;

  switch (p.kind) {
    case "corridor": {
      // Open at both ends, where it meets a room's wall and cuts the doorway.
      const side = p.alongX ? z === p.z0 || z === p.z1 : x === p.x0 || x === p.x1;
      if (y === p.y0 || y === p.y1 || side) return W();
      const run = p.alongX ? x : z;
      // A torch on one wall every seven blocks, standing out from it.
      if (y === Y + 1 && run % 7 === 0 && (p.alongX ? z === p.z0 + 1 : x === p.x0 + 1)) return [B.TORCH, 1 + (p.alongX ? 1 : 3)];
      if (y === Y + 2 && hash4(s.x, x, y, z) % 23 === 0) return [B.COBWEB, 0];
      return AIR;
    }
    case "stairs": {
      // Climbs one block a step along +z from the hub (i = 0) to the landing (i = steps + 1).
      const i = z - p.z0, steps = p.z1 - p.z0 - 1;
      const floor = i === 0 ? Y - 1 : Y + Math.min(i, steps) - 1;
      const side = x === p.x0 || x === p.x1;
      if (y < Y - 1 || y > floor + 5) return null;
      if (side || y === floor + 5) return W();
      if (y < floor) return W();
      if (y === floor) return i === 0 || i > steps ? W() : [B.STONE_BRICK_STAIRS, 1];
      return AIR;
    }
    case "portal": return portalRoom(x, y, z, Y, s, shell, W);
    default: break;
  }
  if (shell) return W();
  switch (p.kind) {
    case "hub": {
      // Four stubby pillars, each with a torch on top.
      const hx = x, hz = z - ((p.z0 + p.z1) >> 1);
      if (Math.abs(hx) === 3 && Math.abs(hz) === 3) return y <= Y + 1 ? W() : y === Y + 2 ? [B.TORCH, 0] : AIR;
      return AIR;
    }
    case "library": {
      const top = y >= Y + 4;
      if (Math.abs(c) === halfW - 1 && a >= 2 && a <= depth - 3 && y <= Y + 3) return [B.BOOKSHELF, 0];
      if (Math.abs(c) === 2 && a >= 4 && a <= depth - 5) return y <= Y + 2 ? [B.BOOKSHELF, 0] : y === Y + 3 && (a === 4 || a === depth - 5) ? [B.TORCH, 0] : AIR;
      if (top && hash4(s.z, x, y, z) % 19 === 0) return [B.COBWEB, 0];
      if (a === depth - 2 && c === 0 && y === Y) return [B.CHEST, p.alongX ? (p.dir > 0 ? 2 : 3) : (p.dir > 0 ? 0 : 1)];
      return AIR;
    }
    case "storeroom": {
      if (a === depth - 2 && Math.abs(c) === 3 && y === Y) return [B.CHEST, p.alongX ? (p.dir > 0 ? 2 : 3) : (p.dir > 0 ? 0 : 1)];
      if (a === depth - 2 && c === 0 && y === Y) return [B.CRAFTING_TABLE, 0];
      if (a === 2 && Math.abs(c) === 3 && y === Y) return [B.TORCH, 0];
      return AIR;
    }
    case "prison": {
      // Two cells against the far wall behind a row of bars, a wall between them.
      if (a >= depth - 3 && a <= depth - 2 && c === 0 && y <= Y + 2) return W();
      if (a === depth - 4 && Math.abs(c) <= halfW - 1 && y <= Y + 2) return [B.IRON_BARS, 0];
      if (a === 1 && Math.abs(c) === halfW - 1 && y === Y) return [B.TORCH, 0];
      return AIR;
    }
    case "fountain": {
      const mid = (depth - 1) >> 1;
      const da = Math.abs(a - mid), dc = Math.abs(c);
      // A basin with a spring in it; the rim holds the water in.
      if (da <= 1 && dc <= 1 && y === Y) return da === 0 && dc === 0 ? [B.WATER, 0] : W();
      if (da === 3 && dc === 3 && y === Y) return [B.TORCH, 0];
      return AIR;
    }
    case "landing":
      if (Math.abs(c) === 2 && a === 3 && y === p.y0 + 1) return [B.TORCH, 0];
      return AIR;
  }
  return AIR;
}

/**
 * The portal room: a raised dais at the north end with the ring of twelve
 * frames over a pool of lava, steps up to it from the door, a silverfish
 * spawner on the landing, and barred windows down the long walls.
 */
function portalRoom(x: number, y: number, z: number, Y: number, s: Stronghold, shell: boolean, W: () => Cell): Cell {
  if (shell) {
    if ((x === -5 || x === 5) && (y === Y + 3 || y === Y + 4) && z % 3 === 0 && z > -8 && z < 7) return [B.IRON_BARS, 0];
    return W();
  }
  const inDais = x >= -3 && x <= 3 && z >= -6 && z <= 0;
  if (inDais && y <= Y + 2) {
    if (y === Y + 2 && x >= -1 && x <= 1 && z >= -4 && z <= -2) return [B.LAVA, 0];
    return W();
  }
  if (y === Y + 3) {
    const f = FRAME_RING.findIndex(([fx, fz]) => fx === x && fz === z);
    if (f >= 0) return [B.END_PORTAL_FRAME, FRAME_RING[f][2] | ((s.eyes >> f) & 1 ? FRAME_EYE : 0)];
    if (s.eyes === 0xfff && x >= -1 && x <= 1 && z >= -4 && z <= -2) return [B.END_PORTAL, 0];
    if (x === 3 && z === 0) return [B.SPAWNER, SPAWNER_SILVERFISH];
  }
  // Steps from the floor up onto the dais, climbing north.
  if (x >= -1 && x <= 1 && z >= 1 && z <= 3) {
    const top = Y + (3 - z);
    if (y < top) return W();
    if (y === top) return [B.STONE_BRICK_STAIRS, 0];
  }
  return [B.AIR, 0];
}

/** The silverfish's index in SPAWNER_MOBS (nether.ts). */
export const SPAWNER_SILVERFISH = 4;

/**
 * The twelve frames of a portal the frame at x,y,z belongs to, if all of them
 * hold an eye: returns the nine cells inside to fill with portal. Tries every
 * 3×3 the frame could border.
 */
export function findEndPortal(get: (x: number, y: number, z: number) => number, getMeta: (x: number, y: number, z: number) => number, x: number, y: number, z: number): [number, number, number][] | null {
  const lit = (fx: number, fz: number) => get(fx, y, fz) === B.END_PORTAL_FRAME && (getMeta(fx, y, fz) & FRAME_EYE) !== 0;
  for (let cz = z - 2; cz <= z + 2; cz++) for (let cx = x - 2; cx <= x + 2; cx++) {
    // (cx, cz) is the middle of the 3×3; the frame must be on its ring.
    const dx = x - cx, dz = z - cz;
    const onRing = (Math.abs(dx) === 2 && Math.abs(dz) <= 1) || (Math.abs(dz) === 2 && Math.abs(dx) <= 1);
    if (!onRing) continue;
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) {
      ok = lit(cx - 2, cz + i) && lit(cx + 2, cz + i) && lit(cx + i, cz - 2) && lit(cx + i, cz + 2);
    }
    if (!ok) continue;
    const cells: [number, number, number][] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cells.push([cx + i, y, cz + j]);
    return cells;
  }
  return null;
}

/** A stronghold chest's contents: libraries hold paper and enchanted books; storerooms, food, iron and pearls. */
export function strongholdLoot(items: (ItemStack | null)[], seed: number, room: StrongholdRoom): void {
  const rng = new Rng(seed);
  const table: [string, number, number, number][] = room === "library"
    ? [["paper", 2, 7, 0.8], ["book", 1, 3, 0.6], ["enchanted_book", 1, 1, 0.9], ["enchanted_book", 1, 1, 0.5]]
    : [["ender_pearl", 1, 2, 0.5], ["iron_ingot", 1, 5, 0.5], ["gold_ingot", 1, 3, 0.4], ["bread", 1, 3, 0.6], ["apple", 1, 3, 0.5],
      ["redstone", 4, 9, 0.3], ["diamond", 1, 3, 0.15], ["iron_pickaxe", 1, 1, 0.2], ["iron_sword", 1, 1, 0.2],
      ["iron_chestplate", 1, 1, 0.1], ["golden_apple", 1, 1, 0.08], ["enchanted_book", 1, 1, 0.15]];
  for (const [name, lo, hi, chance] of table) {
    if (rng.next() >= chance) continue;
    const slot = rng.int(items.length);
    if (items[slot]) continue;
    if (name === "enchanted_book") {
      const ench = rollEnchantments(rng.int(0x7fffffff), 0, 10 + rng.int(21), itemDef(itemByName("book").id)!);
      if (Object.keys(ench).length) items[slot] = { id: itemByName("enchanted_book").id, count: 1, ench };
      continue;
    }
    items[slot] = { id: itemByName(name).id, count: lo + rng.int(hi - lo + 1) };
  }
}
