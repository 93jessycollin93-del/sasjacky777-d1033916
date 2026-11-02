/**
 * End cities, planned whole from their seed and then stamped chunk by chunk.
 *
 * A city grows the way the original's do: a house on the island, a tower
 * rising from its roof, and from the tower's floors bridges out to more
 * towers — some of them fat towers holding a loot room — two or three steps
 * deep, each tower crowned with a lookout. Often one crown has a ship moored
 * beside it, with the elytra hung in its cabin and the dragon's head on its
 * prow. Shulkers keep watch on the crowns, the bridges, the loot rooms and
 * the ship.
 *
 * Each piece claims a box before it is built and is dropped if the box meets
 * one already claimed, so a city never builds through itself. The plan is a
 * list of box fills in build order — a later fill overwrites an earlier one,
 * which is how doors are cut and rooms hollowed — and chunk generation stamps
 * the part of each fill that falls in its chunk, so every chunk of a city
 * comes out the same whatever order the chunks generate in.
 */
import { B, Face, FACING_DIRS, OPPOSITE_FACING, WOOL_COLORS } from "./blocks";
import { WORLD_HEIGHT } from "./constants";
import { Rng } from "./rng";

/** An inclusive box of one block: [x0, y0, z0, x1, y1, z1, id, meta]. */
export type Fill = [number, number, number, number, number, number, number, number];

export interface CityPlan {
  fills: Fill[];
  chests: [number, number, number, "city" | "ship"][];
  /** Where a shulker sits: its cell, and the Face of its box that holds to a block. */
  shulkers: [number, number, number, number][];
  /** Brewing stands that come with two potions of Healing II. */
  brewing: [number, number, number][];
  /** The ship's item frame (the cell it hangs in, and the way it faces), which holds the elytra. */
  frame: { face: number; x: number; y: number; z: number } | null;
  /** The ship's middle, at deck level, if it has one. */
  ship: { x: number; y: number; z: number } | null;
  towers: number;
  x0: number; z0: number; x1: number; z1: number;
}

interface Tower {
  cx: number; cz: number;
  /** Half the width, walls included: 3 for a tower, 4 for a fat one. */
  r: number;
  base: number;
  top: number;
  fat: boolean;
  /** Bridges leaving at the top floor, whose way through the crown's parapet stays open. */
  topExits: number[];
}

type Box = [number, number, number, number, number, number];

const MAGENTA_WOOL = 98 + WOOL_COLORS.indexOf("magenta");
/** How far a city may reach from its middle: the chunk search looks this far around. */
export const CITY_REACH = 88;
const MAX_TOP = WORLD_HEIGHT - 8;

class Builder {
  readonly fills: Fill[] = [];
  private claimed: Box[] = [];
  constructor(readonly X: number, readonly Z: number) {}

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0): void {
    this.fills.push([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), id, meta]);
  }
  set(x: number, y: number, z: number, id: number, meta = 0): void {
    this.fill(x, y, z, x, y, z, id, meta);
  }

  /** Takes a box for a piece if nothing claimed meets it (`except` lets a bridge touch the tower it leaves). */
  claim(box: Box, except: Box[] = []): boolean {
    const [x0, y0, z0, x1, y1, z1] = box;
    if (y1 > MAX_TOP + 6 || y0 < 2) return false;
    if (Math.max(Math.abs(x0 - this.X), Math.abs(x1 - this.X), Math.abs(z0 - this.Z), Math.abs(z1 - this.Z)) > CITY_REACH) return false;
    for (const c of this.claimed) {
      if (except.includes(c)) continue;
      if (x0 <= c[3] && x1 >= c[0] && y0 <= c[4] && y1 >= c[1] && z0 <= c[5] && z1 >= c[2]) return false;
    }
    this.claimed.push(box);
    return true;
  }
  lastClaim(): Box {
    return this.claimed[this.claimed.length - 1];
  }
  /** Gives a claim back when the piece it was for turned out not to fit after all. */
  release(box: Box): void {
    const i = this.claimed.indexOf(box);
    if (i >= 0) this.claimed.splice(i, 1);
  }
}

const towerBox = (cx: number, cz: number, r: number, base: number, top: number): Box => [cx - r - 2, base, cz - r - 2, cx + r + 2, top + 5, cz + r + 2];

/** The house on the island: two floors, eleven across, its door on `door`'s side, a chest inside. */
function house(b: Builder, X: number, Y: number, Z: number, door: number, plan: CityPlan): void {
  const [ddx, ddz] = FACING_DIRS[door];
  b.fill(X - 5, Y - 4, Z - 5, X + 5, Y - 1, Z + 5, B.END_STONE_BRICKS);
  b.fill(X - 5, Y, Z - 5, X + 5, Y + 5, Z + 5, B.PURPUR_BLOCK);
  b.fill(X - 4, Y, Z - 4, X + 4, Y + 5, Z + 4, B.AIR);
  for (const [cx, cz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) b.fill(X + cx, Y, Z + cz, X + cx, Y + 5, Z + cz, B.PURPUR_PILLAR);
  // Windows of magenta glass, two to a wall.
  for (const [wx, wz, along] of [[0, -5, true], [0, 5, true], [-5, 0, false], [5, 0, false]] as [number, number, boolean][]) {
    for (const o of [-2, 2]) b.fill(X + wx + (along ? o : 0), Y + 2, Z + wz + (along ? 0 : o), X + wx + (along ? o : 0), Y + 3, Z + wz + (along ? 0 : o), B.MAGENTA_STAINED_GLASS);
  }
  // The door: three wide, three high.
  const px = -ddz, pz = ddx;
  b.fill(X + ddx * 5 - px, Y, Z + ddz * 5 - pz, X + ddx * 5 + px, Y + 2, Z + ddz * 5 + pz, B.AIR);
  b.fill(X - 5, Y + 6, Z - 5, X + 5, Y + 6, Z + 5, B.END_STONE_BRICKS);
  b.fill(X - 5, Y + 6, Z - 5, X + 5, Y + 6, Z - 5, B.PURPUR_BLOCK);
  b.fill(X - 5, Y + 6, Z + 5, X + 5, Y + 6, Z + 5, B.PURPUR_BLOCK);
  b.fill(X - 5, Y + 6, Z - 5, X - 5, Y + 6, Z + 5, B.PURPUR_BLOCK);
  b.fill(X + 5, Y + 6, Z - 5, X + 5, Y + 6, Z + 5, B.PURPUR_BLOCK);
  b.set(X + 4, Y, Z - 4, B.END_ROD, Face.Up);
  const chest: [number, number, number] = [X - 3, Y, Z + 3];
  b.set(...chest, B.CHEST, 1);
  plan.chests.push([...chest, "city"]);
}

/**
 * A tower: purpur walls with pillar corners, a floor every four blocks, a
 * ladder up the inside of its north wall through a gap in each floor, and a
 * magenta window in the middle of the other walls on every storey.
 */
function tower(b: Builder, cx: number, base: number, cz: number, r: number, stories: number, fat: boolean): Tower {
  const top = base + stories * 4;
  b.fill(cx - r, base, cz - r, cx + r, top, cz + r, B.PURPUR_BLOCK);
  b.fill(cx - r + 1, base + 1, cz - r + 1, cx + r - 1, top, cz + r - 1, B.AIR);
  for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) b.fill(cx + dx, base, cz + dz, cx + dx, top, cz + dz, B.PURPUR_PILLAR);
  for (let k = 0; k <= stories; k++) {
    b.fill(cx - r + 1, base + 4 * k, cz - r + 1, cx + r - 1, base + 4 * k, cz + r - 1, B.END_STONE_BRICKS);
    if (k === stories) continue;
    const y = base + 4 * k + 2;
    const w = fat ? 1 : 0;
    b.fill(cx - w, y, cz + r, cx + w, y + (fat ? 1 : 0), cz + r, B.MAGENTA_STAINED_GLASS);
    b.fill(cx - r, y, cz - w, cx - r, y + (fat ? 1 : 0), cz + w, B.MAGENTA_STAINED_GLASS);
    b.fill(cx + r, y, cz - w, cx + r, y + (fat ? 1 : 0), cz + w, B.MAGENTA_STAINED_GLASS);
  }
  // Meta 0: a ladder held by the block to its north.
  b.fill(cx, base + 1, cz - r + 1, cx, top, cz - r + 1, B.LADDER, 0);
  return { cx, cz, r, base, top, fat, topExits: [] };
}

/** A doorway two high through a tower's wall on `dir`'s side, over the floor at `level`. */
function door(b: Builder, t: Tower, dir: number, level: number): void {
  const [dx, dz] = FACING_DIRS[dir];
  b.fill(t.cx + dx * t.r, level + 1, t.cz + dz * t.r, t.cx + dx * t.r, level + 2, t.cz + dz * t.r, B.AIR);
}

/**
 * A bridge three wide from (sx, sz) along `dir`, starting at deck level
 * `level`; if it rises, it climbs four blocks by a staircase in its middle.
 * Returns the deck level of each of its cells.
 */
function bridge(b: Builder, sx: number, level: number, sz: number, dir: number, len: number, rise: number): number[] {
  const [dx, dz] = FACING_DIRS[dir];
  const px = -dz, pz = dx;
  const a = Math.floor(len / 2) - 2;
  const k = (i: number) => (rise ? Math.max(0, Math.min(rise, i - a + 1)) : 0);
  for (let i = 0; i < len; i++) {
    const x = sx + dx * i, z = sz + dz * i;
    const y = level + k(i);
    const climbing = i > 0 && k(i) > k(i - 1);
    b.fill(x - px, y + 1, z - pz, x + px, y + 3, z + pz, B.AIR);
    if (climbing) {
      // A step up: stairs whose high side leads on, on a block of their own.
      b.fill(x - px, y - 1, z - pz, x + px, y - 1, z + pz, B.END_STONE_BRICKS);
      b.fill(x - px, y, z - pz, x + px, y, z + pz, B.PURPUR_STAIRS, dir);
    } else {
      b.fill(x - px, y, z - pz, x + px, y, z + pz, B.END_STONE_BRICKS);
      b.set(x - px, y + 1, z - pz, B.PURPUR_SLAB, 0);
      b.set(x + px, y + 1, z + pz, B.PURPUR_SLAB, 0);
    }
    if (i % 5 === 2 && !climbing) b.fill(x, y - 3, z, x, y - 1, z, B.PURPUR_PILLAR);
  }
  return Array.from({ length: len }, (_, i) => level + k(i));
}

/**
 * A tower's crown: a wider floor overhanging its walls, a rim with a low
 * parapet (open where a bridge leaves), pillars with end rods at the corners.
 */
function crown(b: Builder, t: Tower, plan: CityPlan, rng: Rng): void {
  const R = t.r + 2, { cx, cz, top } = t;
  b.fill(cx - R, top + 1, cz - R, cx + R, top + 4, cz + R, B.AIR);
  b.fill(cx - R, top, cz - R, cx + R, top, cz + R, B.END_STONE_BRICKS);
  // The ladder comes up through the crown's floor.
  b.set(cx, top, cz - t.r + 1, B.LADDER, 0);
  for (let d = -R; d <= R; d++) {
    for (const [x, z] of [[cx + d, cz - R], [cx + d, cz + R], [cx - R, cz + d], [cx + R, cz + d]]) {
      b.set(x, top, z, B.PURPUR_BLOCK);
      b.set(x, top + 1, z, B.PURPUR_SLAB, 0);
    }
  }
  for (const [dx, dz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    b.fill(cx + dx, top + 1, cz + dz, cx + dx, top + 2, cz + dz, B.PURPUR_PILLAR);
    b.set(cx + dx, top + 3, cz + dz, B.END_ROD, Face.Up);
  }
  // Undersides: the overhang stepped in with stairs is too fussy at this size; a band of purpur reads as one.
  b.fill(cx - R + 1, top - 1, cz - R + 1, cx + R - 1, top - 1, cz + R - 1, B.PURPUR_BLOCK);
  b.fill(cx - t.r + 1, top - 1, cz - t.r + 1, cx + t.r - 1, top - 1, cz + t.r - 1, B.AIR);
  b.set(cx, top - 1, cz - t.r + 1, B.LADDER, 0);
  for (const dir of t.topExits) {
    const [dx, dz] = FACING_DIRS[dir];
    b.fill(cx + dx * R - dz, top + 1, cz + dz * R + dx, cx + dx * R + dz, top + 1, cz + dz * R - dx, B.AIR);
  }
  // Someone keeps watch.
  const c = rng.int(4);
  const [sx, sz] = [[-1, -1], [1, -1], [-1, 1], [1, 1]][c];
  plan.shulkers.push([cx + sx * (R - 2), top + 1, cz + sz * (R - 2), Face.Down]);
}

/** A fat tower's loot room on its first storey: two chests, a brewing stand of healing, and two shulkers overhead. */
function lootRoom(b: Builder, t: Tower, plan: CityPlan): void {
  const y = t.base + 1;
  const chests: [number, number, number][] = [[t.cx + t.r - 1, y, t.cz - 1], [t.cx + t.r - 1, y, t.cz + 1]];
  for (const c of chests) { b.set(...c, B.CHEST, 2); plan.chests.push([...c, "city"]); }
  b.set(t.cx, y, t.cz + 1, B.BREWING_STAND);
  plan.brewing.push([t.cx, y, t.cz + 1]);
  plan.shulkers.push([t.cx - 2, y + 2, t.cz + 2, Face.Up], [t.cx + 2, y + 2, t.cz + 2, Face.Up]);
}

/**
 * The ship: a purpur hull twenty-one long across `dir`, its deck at `y`, two
 * masts with magenta sails, a cabin at the stern with the loot, a brewing
 * stand and the elytra in a frame on its back wall, and the dragon's head on
 * the prow. The bridge that reaches it arrives amidships.
 */
function ship(b: Builder, sx: number, y: number, sz: number, dir: number, plan: CityPlan, rng: Rng): void {
  // The ship's own axis runs across the bridge; `a` along it (the bow at +11), `c` along the bridge.
  const [ax, az] = FACING_DIRS[dir < 2 ? 3 : 1];
  const [cxd, czd] = FACING_DIRS[dir];
  const at = (a: number, c: number): [number, number] => [sx + ax * a + cxd * c, sz + az * a + czd * c];
  const half = (level: number, a: number): number => {
    const d = Math.abs(a);
    if (level === -3) return d <= 7 ? 0 : -1;
    if (level === -2) return d <= 8 ? 1 : d === 9 ? 0 : -1;
    if (level === -1) return d <= 9 ? 2 : d === 10 ? 1 : -1;
    return d <= 9 ? 2 : d === 10 ? 1 : d === 11 ? 0 : -1;
  };
  for (let a = -11; a <= 11; a++) {
    for (const level of [-3, -2, -1, 0]) {
      const h = half(level, a);
      if (h < 0) continue;
      for (let c = -h; c <= h; c++) {
        const [x, z] = at(a, c);
        b.set(x, y + level, z, B.PURPUR_BLOCK);
        if (level === 0) {
          b.fill(x, y + 1, z, x, y + 4, z, B.AIR);
          if (Math.abs(c) === h && Math.abs(a) < 9) b.set(x, y + 1, z, B.PURPUR_SLAB, 0);
        }
      }
    }
  }
  // Amidships, where the bridge arrives, the rail is open.
  for (const c of [-2, 2]) { const [x, z] = at(0, c); b.set(x, y + 1, z, B.AIR); }
  // Masts and sails.
  for (const m of [-2, 4]) {
    const [x, z] = at(m, 0);
    b.fill(x, y + 1, z, x, y + 10, z, B.PURPUR_PILLAR);
    b.set(x, y + 11, z, B.END_ROD, Face.Up);
    const [x0, z0] = at(m, -3), [x1, z1] = at(m, 3);
    b.fill(x0, y + 5, z0, x1, y + 9, z1, MAGENTA_WOOL);
    b.fill(x, y + 5, z, x, y + 9, z, B.PURPUR_PILLAR);
  }
  // The stern cabin: walls three high, a roof, a door toward the bow.
  const [s0x, s0z] = at(-10, -2), [s1x, s1z] = at(-6, 2);
  b.fill(s0x, y + 1, s0z, s1x, y + 4, s1z, B.PURPUR_BLOCK);
  const [i0x, i0z] = at(-9, -1), [i1x, i1z] = at(-7, 1);
  b.fill(i0x, y + 1, i0z, i1x, y + 3, i1z, B.AIR);
  const [dx0, dz0] = at(-6, 0);
  b.fill(dx0, y + 1, dz0, dx0, y + 2, dz0, B.AIR);
  const [wx, wz] = at(-8, 2), [wx2, wz2] = at(-8, -2);
  b.set(wx, y + 2, wz, B.MAGENTA_STAINED_GLASS);
  b.set(wx2, y + 2, wz2, B.MAGENTA_STAINED_GLASS);
  const [c1x, c1z] = at(-9, -1), [c2x, c2z] = at(-9, 1);
  b.set(c1x, y + 1, c1z, B.CHEST, 0);
  b.set(c2x, y + 1, c2z, B.CHEST, 0);
  plan.chests.push([c1x, y + 1, c1z, "ship"], [c2x, y + 1, c2z, "ship"]);
  const [bx, bz] = at(-7, -1);
  b.set(bx, y + 1, bz, B.BREWING_STAND);
  plan.brewing.push([bx, y + 1, bz]);
  // The elytra hangs on the stern wall inside, facing the door.
  const [fx, fz] = at(-9, 0);
  const forward = ax === 1 ? Face.East : ax === -1 ? Face.West : az === 1 ? Face.South : Face.North;
  plan.frame = { face: forward, x: fx, y: y + 2, z: fz };
  // The dragon's head on the prow, looking out ahead.
  const [hx, hz] = at(11, 0);
  const headFacing = ax === 1 ? 3 : ax === -1 ? 2 : az === 1 ? 1 : 0;
  b.set(hx, y + 1, hz, B.DRAGON_HEAD, headFacing);
  // Two shulkers aboard: one on deck by the mainmast, one in the cabin's roof.
  const [s1, s2] = at(1, rng.next() < 0.5 ? -1 : 1);
  plan.shulkers.push([s1, y + 1, s2, Face.Down]);
  const [r1, r2] = at(-8, 1);
  plan.shulkers.push([r1, y + 3, r2, Face.Up]);
  plan.ship = { x: sx, y, z: sz };
}

/** Lays out a whole city whose house stands at (X, Y, Z) on the island. */
export function planCity(seed: number, X: number, Y: number, Z: number): CityPlan {
  const rng = new Rng(seed);
  const b = new Builder(X, Z);
  const plan: CityPlan = { fills: b.fills, chests: [], shulkers: [], brewing: [], frame: null, ship: null, towers: 0, x0: X, z0: Z, x1: X, z1: Z };
  const doorSide = rng.int(4);
  b.claim([X - 6, Y - 4, Z - 6, X + 6, Y + 6, Z + 6]);
  house(b, X, Y, Z, doorSide, plan);
  // The first tower rises from the house roof; the way up is a ladder on a pillar inside.
  const main = tower(b, X, Y + 6, Z, 3, 3 + rng.int(2), false);
  b.claim(towerBox(X, Z, 3, Y + 7, main.top));
  const mainBox = b.lastClaim();
  b.fill(X, Y, Z - 3, X, Y + 6, Z - 3, B.PURPUR_PILLAR);
  b.fill(X, Y + 1, Z - 2, X, Y + 6, Z - 2, B.LADDER, 0);
  const towers: Tower[] = [main];
  const boxes = new Map<Tower, Box>([[main, mainBox]]);
  const queue: { t: Tower; depth: number; from: number }[] = [{ t: main, depth: 0, from: -1 }];
  while (queue.length) {
    const { t, depth, from } = queue.shift()!;
    if (depth >= 3) continue;
    const dirs = [0, 1, 2, 3].filter((d) => d !== from);
    for (let i = dirs.length - 1; i > 0; i--) { const j = rng.int(i + 1); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }
    const branches = depth === 0 ? 2 + rng.int(2) : 1 + rng.int(2);
    for (const dir of dirs.slice(0, branches)) {
      if (depth > 0 && rng.next() < 0.3) continue;
      const stories = (t.top - t.base) / 4;
      const k = 1 + rng.int(Math.max(1, stories));
      const level = t.base + 4 * Math.min(stories, k);
      const len = 7 + rng.int(4) * 2;
      const fat = depth >= 1 && rng.next() < 0.4;
      const r = fat ? 4 : 3;
      const childStories = fat ? 2 : 2 + rng.int(3);
      const rise = rng.next() < 0.5 && level + 4 + childStories * 4 <= MAX_TOP ? 4 : 0;
      const childBase = level + rise;
      if (childBase + childStories * 4 > MAX_TOP) continue;
      const [dx, dz] = FACING_DIRS[dir];
      const sx = t.cx + dx * (t.r + 1), sz = t.cz + dz * (t.r + 1);
      const ex = sx + dx * len, ez = sz + dz * len;
      const ccx = ex + dx * r, ccz = ez + dz * r;
      const bridgeBox: Box = [Math.min(sx, ex - dx) - 1, level - 3, Math.min(sz, ez - dz) - 1, Math.max(sx, ex - dx) + 1, childBase + 3, Math.max(sz, ez - dz) + 1];
      if (!b.claim(bridgeBox, [boxes.get(t)!])) continue;
      const bBox = b.lastClaim();
      if (!b.claim(towerBox(ccx, ccz, r, childBase, childBase + childStories * 4), [bBox])) {
        b.release(bBox);
        continue;
      }
      const child = tower(b, ccx, childBase, ccz, r, childStories, fat);
      boxes.set(child, b.lastClaim());
      door(b, t, dir, level);
      if (level === t.top) t.topExits.push(dir);
      const decks = bridge(b, sx, level, sz, dir, len, rise);
      door(b, child, OPPOSITE_FACING[dir], childBase);
      if (fat) lootRoom(b, child, plan);
      // A shulker on some bridges, beside the walkway on the flat before the far tower.
      if (rng.next() < 0.4) {
        const m = len - 2;
        const [hx, hy, hz] = [sx + dx * m - dz, decks[m] + 1, sz + dz * m + dx];
        // It sits in place of the rail there.
        b.set(hx, hy, hz, B.AIR);
        plan.shulkers.push([hx, hy, hz, Face.Down]);
      }
      towers.push(child);
      queue.push({ t: child, depth: depth + 1, from: OPPOSITE_FACING[dir] });
    }
  }
  // Maybe a ship, moored off the highest crown that has room for it.
  if (rng.next() < 0.75) {
    const byHeight = [...towers].sort((p, q) => q.top - p.top);
    done: for (const t of byHeight) {
      for (const dir of [0, 1, 2, 3]) {
        if (t.topExits.includes(dir)) continue;
        const [dx, dz] = FACING_DIRS[dir];
        const R = t.r + 2;
        const sx = t.cx + dx * (R + 1), sz = t.cz + dz * (R + 1);
        const len = 4;
        const shipX = sx + dx * (len + 2), shipZ = sz + dz * (len + 2);
        const along = dx === 0;
        const shipBox: Box = along
          ? [shipX - 12, t.top - 4, shipZ - 4, shipX + 12, t.top + 12, shipZ + 4]
          : [shipX - 4, t.top - 4, shipZ - 12, shipX + 4, t.top + 12, shipZ + 12];
        if (t.top + 12 > WORLD_HEIGHT - 2) continue;
        const bridgeBox: Box = [Math.min(sx, sx + dx * (len - 1)) - 1, t.top - 3, Math.min(sz, sz + dz * (len - 1)) - 1, Math.max(sx, sx + dx * (len - 1)) + 1, t.top + 3, Math.max(sz, sz + dz * (len - 1)) + 1];
        if (!b.claim(bridgeBox, [boxes.get(t)!])) continue;
        const bBox = b.lastClaim();
        if (!b.claim(shipBox, [bBox])) { b.release(bBox); continue; }
        t.topExits.push(dir);
        bridge(b, sx, t.top, sz, dir, len, 0);
        ship(b, shipX, t.top, shipZ, dir, plan, rng);
        break done;
      }
    }
  }
  for (const t of towers) crown(b, t, plan, rng);
  plan.towers = towers.length;
  for (const f of plan.fills) {
    plan.x0 = Math.min(plan.x0, f[0]); plan.z0 = Math.min(plan.z0, f[2]);
    plan.x1 = Math.max(plan.x1, f[3]); plan.z1 = Math.max(plan.z1, f[5]);
  }
  return plan;
}

/** Stamps the part of a city inside the chunk whose corner is (x0, z0). */
export function stampPlan(plan: CityPlan, place: (x: number, y: number, z: number, id: number, meta?: number) => void, x0: number, z0: number): void {
  const x1 = x0 + 15, z1 = z0 + 15;
  if (plan.x1 < x0 || plan.x0 > x1 || plan.z1 < z0 || plan.z0 > z1) return;
  for (const [fx0, fy0, fz0, fx1, fy1, fz1, id, meta] of plan.fills) {
    if (fx1 < x0 || fx0 > x1 || fz1 < z0 || fz0 > z1) continue;
    const ax = Math.max(fx0, x0), bx = Math.min(fx1, x1), az = Math.max(fz0, z0), bz = Math.min(fz1, z1);
    for (let y = fy0; y <= fy1; y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) place(x, y, z, id, meta);
  }
}
