/**
 * Building the county's lots: houses room by room, shops and the town's
 * public buildings, farms, cabins, trailers, the army's camp and the
 * checkpoints on the roads out.
 *
 * Every builder works in its lot's own frame — u along the frontage, v back
 * from the street, the street always to the north — and the Frame turns that
 * onto the lot's real facing, block and facing meta alike. So a house is
 * written once and stands the right way round on either side of any street.
 * Builders write through a setter clipped to one chunk (city.ts's Clip): a
 * house across four chunks is built four times, each keeping its quarter,
 * and every choice comes from the lot's own seed so the four agree.
 *
 * Rooms are three blocks high (floor at the ground, walls above it, the
 * ceiling on the fourth), with windows two blocks tall starting a block up —
 * a sill you can climb onto and through, which is how a window is used when
 * the door is not an option.
 */
import { B, block, CROP_MAX_AGE, isBed, isDoor, isStairs, WOOL_COLORS } from "./blocks";
import { COUNTY_BLOCKS as C, ARM_LEFT, ARM_RIGHT, WINDOW_BROKEN, WINDOW_OPEN, withBoards, withFinish } from "./countyBlocks";
import { SEA_LEVEL } from "./constants";
import { Rng } from "./rng";
import { buildTree } from "./trees";
import { letter, type Clip } from "./city";
import type { Lot, County } from "./county";

/** The top of the ground, as county.ts has it (kept here so the two modules need not import each other at load). */
const G = SEA_LEVEL + 1;
const F = G + 1;

/** Facings: 0 north, 1 south, 2 west, 3 east — in the lot's frame, where north is the street. */
const N = 0, S = 1, W = 2, E = 3;
/** How the lot's frame turns: a local facing to the world's, for each way a lot can face. */
const TURN = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 1, 0], [3, 2, 0, 1]];
/**
 * Whether a block keeps a horizontal facing in meta bits 0-1, which must turn
 * with the lot — furniture, doors, beds, stairs, ladders — and not a plain
 * cube, whose meta means nothing of the kind (a log's is its axis).
 */
const TURNS = new Map<number, boolean>();
function turns(id: number): boolean {
  let t = TURNS.get(id);
  if (t === undefined) {
    const d = block(id);
    t = d.facing === "player" || d.facing === "away" || id === B.LADDER || isDoor(id) || isBed(id) || isStairs(id);
    TURNS.set(id, t);
  }
  return t;
}
const wool = (c: (typeof WOOL_COLORS)[number]) => B.WHITE_WOOL + WOOL_COLORS.indexOf(c);

/** A lot's frame: local (u, v) to the world, and a setter that turns what it places. */
export class Frame {
  readonly W: number;
  readonly D: number;
  constructor(readonly c: Clip | null, readonly lot: Lot) {
    const alongX = lot.face <= 1;
    this.W = alongX ? lot.x1 - lot.x0 + 1 : lot.z1 - lot.z0 + 1;
    this.D = alongX ? lot.z1 - lot.z0 + 1 : lot.x1 - lot.x0 + 1;
  }
  x(u: number, v: number): number {
    const l = this.lot;
    return l.face === 0 ? l.x0 + u : l.face === 1 ? l.x1 - u : l.face === 2 ? l.x0 + v : l.x1 - v;
  }
  z(u: number, v: number): number {
    const l = this.lot;
    return l.face === 0 ? l.z0 + v : l.face === 1 ? l.z1 - v : l.face === 2 ? l.z1 - u : l.z0 + u;
  }
  /** A local facing in world terms. */
  turn(facing: number): number {
    return TURN[this.lot.face][facing & 3];
  }
  set(u: number, y: number, v: number, id: number, meta = 0): void {
    if (!this.c) return;
    this.c.set(this.x(u, v), y, this.z(u, v), id, turns(id) ? (meta & ~3) | this.turn(meta & 3) : meta);
  }
  get(u: number, y: number, v: number): number {
    return this.c ? this.c.get(this.x(u, v), y, this.z(u, v)) : 0;
  }
  box(u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, id: number, meta = 0): void {
    for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++) for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) for (let y = y0; y <= y1; y++) this.set(u, y, v, id, meta);
  }
  /** Whether any of this local rectangle falls in the chunk being built. */
  touches(u0: number, v0: number, u1: number, v1: number): boolean {
    if (!this.c) return false;
    const xa = this.x(u0, v0), xb = this.x(u1, v1), za = this.z(u0, v0), zb = this.z(u1, v1);
    return this.c.touches(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb));
  }
  /** A sign in block letters on a front, reading left to right from the street. */
  sign(text: string, uCentre: number, y: number, v: number, id: number): void {
    if (!this.c) return;
    const len = text.length * 4 - 1;
    const u0 = uCentre + Math.floor(len / 2);
    const x0 = this.x(u0, v), z0 = this.z(u0, v), x1 = this.x(u0 - 1, v), z1 = this.z(u0 - 1, v);
    letter(this.c, { text, x: x0, y, z: z0, dx: x1 - x0, dz: z1 - z0, id });
  }
}

// ---- houses -----------------------------------------------------------------------------------------------

export type RoomKind = "living" | "kitchen" | "bedroom" | "bathroom" | "garage";
export interface Room { kind: RoomKind; u0: number; v0: number; u1: number; v1: number }
interface Door { u: number; v: number; facing: number; id: number }
export interface HousePlan {
  /** The outer walls, inclusive. */
  u0: number; v0: number; u1: number; v1: number;
  rooms: Room[];
  doors: Door[];
  /** Interior walls, as cells. */
  walls: [number, number][];
  garage: Room | null;
  exterior: number;
  inner: number;
  roofStairs: number;
  roofBlock: number;
  /** Where to stand inside, in the world: just inside the front door. */
  spawn: [number, number];
  /** What has happened here: nothing yet, a break-in, or a family that boarded up and did not last. */
  state: "kept" | "ransacked" | "boarded";
}

const SIDING = [C.SIDING_WHITE, C.SIDING_CREAM, C.SIDING_BLUE, C.SIDING_SAGE, C.SIDING_GREY, C.SIDING_YELLOW, C.SIDING_PINK, C.SIDING_BROWN];
const BRICKS = [B.BRICKS, C.TAN_BRICK, C.BROWN_BRICK, C.WHITE_BRICK];
const INNER = [C.DRYWALL, C.DRYWALL, C.WALLPAPER_FLORAL, C.WALLPAPER_STRIPE, C.WALLPAPER_PLAID, C.WOOD_PANELING];
const ROOFS: [number, number][] = [0, 1, 2, 3, 4].map((i) => [C.SHINGLE_STAIRS_GREY + i, C.SHINGLES_GREY + i]);

/** How a house on this lot is laid out: pure, so the spawn point and the builder agree without building it. */
export function housePlan(lot: Lot, style: "old" | "suburban" | "rich" | "small" = "suburban"): HousePlan {
  const f = new Frame(null, lot);
  const r = new Rng(lot.seed);
  const rich = style === "rich";
  const wantGarage = f.W >= (rich ? 26 : 19) && r.next() < (rich ? 0.8 : 0.45);
  const room = f.W - 4 - (wantGarage ? 6 : 0);
  // Ten wide at least: a living room of four and a kitchen of three either side of a wall, inside two outer walls.
  const bw = Math.max(10, Math.min(room, (rich ? 13 : 10) + r.int(5)));
  const bd = Math.max(8, Math.min(f.D - 7, (rich ? 11 : 9) + r.int(4)));
  const u0 = Math.max(1, Math.floor((f.W - bw - (wantGarage ? 6 : 0)) / 2)), v0 = Math.max(3, Math.min(5, f.D - bd - 2));
  const u1 = u0 + bw - 1, v1 = v0 + bd - 1;
  const iu0 = u0 + 1, iu1 = u1 - 1, iv0 = v0 + 1, iv1 = v1 - 1;
  const iw = iu1 - iu0 + 1, id = iv1 - iv0 + 1;
  const rooms: Room[] = [], walls: [number, number][] = [], doors: Door[] = [];
  const wallRow = (ua: number, ub: number, v: number) => { for (let u = ua; u <= ub; u++) walls.push([u, v]); };
  const wallCol = (u: number, va: number, vb: number) => { for (let v = va; v <= vb; v++) walls.push([u, v]); };
  // Front half: living room and kitchen; back half: bedrooms and a bathroom.
  const vs = iv0 + Math.max(3, Math.floor(id / 2));
  const ku = iu0 + Math.max(4, Math.floor(iw * 0.55));
  const living: Room = { kind: "living", u0: iu0, v0: iv0, u1: ku - 1, v1: vs - 1 };
  const kitchen: Room = { kind: "kitchen", u0: ku + 1, v0: iv0, u1: iu1, v1: vs - 1 };
  rooms.push(living, kitchen);
  wallCol(ku, iv0, vs - 1);
  wallRow(iu0, iu1, vs);
  doors.push({ u: ku, v: Math.min(vs - 1, iv0 + 1), facing: E, id: C.PANEL_DOOR });
  const back: Room[] = [];
  let bu = iu0;
  // Every house has a bathroom; even the narrowest (seven inside) fits a bedroom of three beside it.
  const bathW = 3;
  const bedEnd = iu1 - (bathW ? bathW + 1 : 0);
  const beds = bedEnd - iu0 + 1 >= 8 ? 2 : 1;
  for (let i = 0; i < beds; i++) {
    const end = i === beds - 1 ? bedEnd : bu + Math.floor((bedEnd - iu0 + 1) / beds) - 1;
    back.push({ kind: "bedroom", u0: bu, v0: vs + 1, u1: end, v1: iv1 });
    if (end < iu1) wallCol(end + 1, vs + 1, iv1);
    bu = end + 2;
  }
  if (bathW) back.push({ kind: "bathroom", u0: iu1 - bathW + 1, v0: vs + 1, u1: iu1, v1: iv1 });
  rooms.push(...back);
  // A door into each back room, from whichever front room it adjoins.
  for (const b of back) {
    const mid = Math.floor((b.u0 + b.u1) / 2);
    const u = mid === ku ? mid + 1 : mid;
    doors.push({ u, v: vs, facing: S, id: C.PANEL_DOOR });
  }
  const frontU = Math.floor((living.u0 + living.u1) / 2);
  doors.push({ u: frontU, v: v0, facing: N, id: C.FRONT_DOOR });
  // A back door out of the kitchen's side, unless the garage is there.
  if (!wantGarage) doors.push({ u: u1, v: Math.floor((kitchen.v0 + kitchen.v1) / 2), facing: E, id: C.PANEL_DOOR });
  let garage: Room | null = null;
  if (wantGarage) {
    garage = { kind: "garage", u0: u1 + 1, v0: v0 + 1, u1: u1 + 5, v1: Math.min(v1 - 1, v0 + 6) };
    doors.push({ u: u1, v: Math.min(garage.v1, Math.floor((kitchen.v0 + kitchen.v1) / 2)), facing: E, id: C.PANEL_DOOR });
  }
  const brick = style === "old" ? r.next() < 0.7 : rich ? r.next() < 0.5 : r.next() < 0.15;
  const exterior = brick ? BRICKS[r.int(BRICKS.length)] : SIDING[r.int(SIDING.length)];
  const [roofStairs, roofBlock] = ROOFS[r.int(ROOFS.length)];
  const roll = r.next();
  const state = roll < 0.12 ? "ransacked" : roll < 0.16 ? "boarded" : "kept";
  // Just inside the front door, which the furniture always leaves clear.
  const cx = frontU, cz = v0 + 1;
  return {
    u0, v0, u1, v1, rooms, doors, walls, garage, exterior, inner: INNER[r.int(INNER.length)], roofStairs, roofBlock,
    spawn: [f.x(cx, cz) + 0.5, f.z(cx, cz) + 0.5], state,
  };
}

const ROOM_FLOOR: Record<RoomKind, number[]> = {
  living: [C.CARPET_BEIGE, C.CARPET_BROWN, C.CARPET_GREEN, C.HARDWOOD, C.DARK_HARDWOOD, C.CARPET_GREY],
  kitchen: [C.LINOLEUM, C.TERRACOTTA_TILE, C.VINYL_FLOOR, C.HARDWOOD],
  bedroom: [C.CARPET_BLUE, C.CARPET_BEIGE, C.CARPET_RED, C.CARPET_GREY, C.HARDWOOD],
  bathroom: [C.BATH_TILE, C.LINOLEUM],
  garage: [C.CONCRETE],
};

function house(f: Frame, style: "old" | "suburban" | "rich" | "small"): void {
  const p = housePlan(f.lot, style);
  const r = new Rng(f.lot.seed ^ 0x40053);
  yard(f, r, p);
  // Each room papers or panels its own walls: the kitchen and bathroom tiled or plain, the others as the family liked.
  const finishes = new Map<Room, number>();
  for (const room of p.rooms) finishes.set(room, room.kind === "bathroom" ? 6 : room.kind === "kitchen" ? [1, 6, 7][r.int(3)] : [1, 1, 2, 3, 4, 5, 7][r.int(7)]);
  const inside = (u: number, v: number) => {
    const iu = u === p.u0 ? u + 1 : u === p.u1 ? u - 1 : u, iv = v === p.v0 ? v + 1 : v === p.v1 ? v - 1 : v;
    const room = p.rooms.find((m) => iu >= m.u0 && iu <= m.u1 && iv >= m.v0 && iv <= m.v1);
    return room ? finishes.get(room)! : 1;
  };
  shell(f, p.u0, p.v0, p.u1, p.v1, p.exterior, 3, inside);
  for (const room of p.rooms) f.box(room.u0, G, room.v0, room.u1, G, room.v1, ROOM_FLOOR[room.kind][r.int(ROOM_FLOOR[room.kind].length)]);
  for (const [u, v] of p.walls) f.box(u, F, v, u, F + 2, v, p.inner);
  ceiling(f, p.u0, p.v0, p.u1, p.v1, p.exterior);
  gableRoof(f, p.u0, p.v0, p.u1, p.v1, p.roofStairs, p.roofBlock, p.exterior);
  if (p.garage) garageWing(f, p, r);
  const windows = houseWindows(f, p, r);
  for (const d of p.doors) door(f, d.u, d.v, d.id, d.facing, d.id === C.FRONT_DOOR && p.state === "ransacked" ? 4 : 0, d.id === C.FRONT_DOOR && p.state === "boarded" ? 3 : 0);
  for (const room of p.rooms) furnish(f, room, p, r);
  for (const room of p.rooms) f.set(Math.floor((room.u0 + room.u1) / 2), F + 2, Math.floor((room.v0 + room.v1) / 2), C.CEILING_LIGHT);
  aftermath(f, p, r, windows);
}

/**
 * Walls round a rectangle, a concrete footing under them, windows and doors
 * cut in later. `finish` picks the inside face of each stretch of wall (the
 * room behind it decides); corners keep the outside material all round.
 */
function shell(f: Frame, u0: number, v0: number, u1: number, v1: number, id: number, height: number, finish: (u: number, v: number) => number = () => 0): void {
  const wall = (u: number, v: number, facing: number, corner: boolean) => {
    f.set(u, G, v, C.CONCRETE);
    f.box(u, F, v, u, F + height - 1, v, id, corner ? 0 : withFinish(facing, finish(u, v)));
  };
  for (let u = u0; u <= u1; u++) { wall(u, v0, N, u === u0 || u === u1); wall(u, v1, S, u === u0 || u === u1); }
  for (let v = v0 + 1; v < v1; v++) { wall(u0, v, W, false); wall(u1, v, E, false); }
  // Clear the inside (trees from the verge, grass) before the rooms go in.
  for (let u = u0 + 1; u < u1; u++) for (let v = v0 + 1; v < v1; v++) f.box(u, F, v, u, F + height - 1, v, B.AIR);
}

function ceiling(f: Frame, u0: number, v0: number, u1: number, v1: number, edge: number): void {
  for (let u = u0; u <= u1; u++) for (let v = v0; v <= v1; v++) f.set(u, F + 3, v, u === u0 || u === u1 || v === v0 || v === v1 ? edge : C.DRYWALL);
}

/** A pitched roof over the rectangle, ridge running along the frontage, gable ends filled in the wall's material. */
function gableRoof(f: Frame, u0: number, v0: number, u1: number, v1: number, stairs: number, block: number, gable: number): void {
  const base = F + 3;
  for (let k = 0; ; k++) {
    const vf = v0 - 1 + k, vb = v1 + 1 - k, y = base + k;
    if (vf > vb) break;
    for (let u = u0 - 1; u <= u1 + 1; u++) {
      if (vf === vb) { f.set(u, y, vf, block); continue; }
      f.set(u, y, vf, stairs, S);
      f.set(u, y, vb, stairs, N);
      if (u === u0 || u === u1) for (let v = vf + 1; v < vb; v++) if (k > 0) f.set(u, y, v, gable);
    }
  }
}

/** Two-high windows every few blocks along the outside walls, clear of doors and the ends of inside walls. */
function houseWindows(f: Frame, p: HousePlan, r: Rng): [number, number, number][] {
  const out: [number, number, number][] = [];
  const blocked = new Set<string>();
  for (const d of p.doors) for (let k = -1; k <= 1; k++) { blocked.add(`${d.u + k},${d.v}`); blocked.add(`${d.u},${d.v + k}`); }
  // Only where an inside wall meets the outside one: a window there would be half in each room.
  for (const [u, v] of p.walls) {
    if (v === p.v0 + 1) blocked.add(`${u},${p.v0}`);
    if (v === p.v1 - 1) blocked.add(`${u},${p.v1}`);
    if (u === p.u0 + 1) blocked.add(`${p.u0},${v}`);
    if (u === p.u1 - 1) blocked.add(`${p.u1},${v}`);
  }
  const put = (u: number, v: number, facing: number) => {
    if (blocked.has(`${u},${v}`)) return;
    if (p.garage && facing === E && v >= p.garage.v0 - 1 && v <= p.garage.v1 + 1) return;
    f.set(u, F + 1, v, C.HOUSE_WINDOW, facing);
    f.set(u, F + 2, v, C.HOUSE_WINDOW, facing);
    out.push([u, v, facing]);
  };
  for (let u = p.u0 + 2; u < p.u1 - 1; u += 3) { put(u, p.v0, N); put(u, p.v1, S); }
  for (let v = p.v0 + 2; v < p.v1 - 1; v += 3) { put(p.u0, v, W); put(p.u1, v, E); }
  void r;
  return out;
}

function door(f: Frame, u: number, v: number, id: number, facing: number, open = 0, boards = 0): void {
  f.set(u, F, v, id, withBoards(facing | open, boards));
  f.set(u, F + 1, v, id, withBoards(facing | open | 8, boards));
}

function garageWing(f: Frame, p: HousePlan, r: Rng): void {
  const g = p.garage!;
  shell(f, g.u0 - 1, g.v0 - 1, g.u1 + 1, g.v1 + 1, p.exterior, 3);
  f.box(g.u0, G, g.v0, g.u1, G, g.v1, C.CONCRETE);
  f.box(g.u0 - 1, F + 3, g.v0 - 1, g.u1 + 1, F + 3, g.v1 + 1, C.TAR_ROOF);
  // The roll-up door on the street side, three wide, and the drive out to the road.
  for (let u = g.u0 + 1; u <= g.u1 - 1; u++) f.box(u, F, g.v0 - 1, u, F + 2, g.v0 - 1, C.GARAGE_DOOR, N);
  f.box(g.u0 + 1, G, 0, g.u1 - 1, G, g.v0 - 2, C.CONCRETE);
  f.box(g.u0 + 1, F, 0, g.u1 - 1, F + 2, g.v0 - 2, B.AIR);
  f.set(g.u0, F, g.v1, C.METAL_SHELF, S);
  f.set(g.u0 + 1, F, g.v1, C.METAL_SHELF, S);
  f.set(g.u1, F, g.v1, C.WORKBENCH, S);
  f.set(g.u1, F, g.v1 - 1, C.TOOL_CHEST, W);
  if (r.next() < 0.15) f.set(g.u0, F, g.v1 - 2, C.GENERATOR, E);
  if (r.next() < 0.4) f.set(g.u0, F, g.v0 + 1, C.FUEL_DRUM);
  f.set(Math.floor((g.u0 + g.u1) / 2), F + 2, Math.floor((g.v0 + g.v1) / 2), C.CEILING_LIGHT);
}

/** The front path, a porch, a mailbox, a fence round the back and a tree or two. */
function yard(f: Frame, r: Rng, p: HousePlan): void {
  const fu = p.doors.find((d) => d.id === C.FRONT_DOOR)!.u;
  f.box(fu, G, 0, fu, G, p.v0 - 1, C.SIDEWALK);
  f.box(fu - 1, G, p.v0 - 1, fu + 1, G, p.v0 - 1, C.CONCRETE);
  f.set(fu + 2, F, 0, C.MAILBOX, N);
  if (r.next() < 0.5) {
    const fence = r.next() < 0.5 ? C.PICKET_FENCE : C.PRIVACY_FENCE;
    const vb = f.D - 1;
    for (let u = 0; u < f.W; u++) f.set(u, F, vb, fence, N);
    for (let v = p.v1 - 1; v <= vb; v++) { f.set(0, F, v, fence, W); f.set(f.W - 1, F, v, fence, W); }
  }
  // A tree at the back, if the garden runs far enough behind the house to hold one.
  if (r.next() < 0.6 && f.D - 2 - p.v1 >= 4) tree(f, r.next() < 0.5 ? 1 : f.W - 2, f.D - 2, r);
  f.set(p.u0 - 1 >= 0 ? p.u0 - 1 : p.u1 + 1, F, p.v1, C.TRASH_CAN);
}

function tree(f: Frame, u: number, v: number, r: Rng): void {
  if (!f.c) return;
  const x = f.x(u, v), z = f.z(u, v), c = f.c;
  buildTree(r.next() < 0.7 ? "oak" : "birch", (x2, y, z2, id, meta) => { if (c.get(x2, y, z2) === B.AIR) c.set(x2, y, z2, id, meta ?? 0); }, x, F, z, r);
}

// ---- furnishing a room --------------------------------------------------------------------------------------

/** A room's floor cells along one wall, which way things there face (into the room), and whether a cell is free. */
class Furnisher {
  private taken = new Set<string>();
  constructor(readonly f: Frame, readonly room: Room, readonly r: Rng, doors: Door[]) {
    for (const d of doors) for (const [du, dv] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) this.taken.add(`${d.u + du},${d.v + dv}`);
  }
  free(u: number, v: number): boolean {
    return u >= this.room.u0 && u <= this.room.u1 && v >= this.room.v0 && v <= this.room.v1 && !this.taken.has(`${u},${v}`);
  }
  take(u: number, v: number): void { this.taken.add(`${u},${v}`); }
  /** The cells along a wall, in order, and the facing of something standing against it. */
  wall(side: number): { cells: [number, number][]; facing: number } {
    const { u0, v0, u1, v1 } = this.room;
    const cells: [number, number][] = [];
    if (side === N) for (let u = u0; u <= u1; u++) cells.push([u, v0]);
    if (side === S) for (let u = u0; u <= u1; u++) cells.push([u, v1]);
    if (side === W) for (let v = v0; v <= v1; v++) cells.push([u0, v]);
    if (side === E) for (let v = v0; v <= v1; v++) cells.push([u1, v]);
    return { cells, facing: side === N ? S : side === S ? N : side === W ? E : W };
  }
  /** Places a run of blocks against a wall where there is room for all of them; returns the cells, or null. */
  run(side: number, ids: number[], metaOf: (i: number, n: number) => number = () => 0, fromMiddle = false): [number, number][] | null {
    const { cells, facing } = this.wall(side);
    const starts = cells.map((_, i) => i).filter((i) => i + ids.length <= cells.length);
    if (fromMiddle) starts.sort((a, b) => Math.abs(a + ids.length / 2 - cells.length / 2) - Math.abs(b + ids.length / 2 - cells.length / 2));
    for (const s of starts) {
      const pick = cells.slice(s, s + ids.length);
      if (!pick.every(([u, v]) => this.free(u, v))) continue;
      pick.forEach(([u, v], i) => { this.f.set(u, F, v, ids[i], facing | metaOf(i, ids.length)); this.take(u, v); });
      return pick;
    }
    return null;
  }
  /** One thing somewhere along any of the given walls. */
  one(sides: number[], id: number, meta = 0): [number, number] | null {
    for (const side of sides) {
      const got = this.run(side, [id], () => meta);
      if (got) return got[0];
    }
    return null;
  }
}

function furnish(f: Frame, room: Room, p: HousePlan, r: Rng): void {
  const k = new Furnisher(f, room, r, p.doors);
  const sides = [N, S, W, E].sort(() => r.next() - 0.5);
  const rw = room.u1 - room.u0 + 1, rd = room.v1 - room.v0 + 1;
  switch (room.kind) {
    case "living": {
      const couch = [C.COUCH_BROWN, C.COUCH_BLUE, C.COUCH_GREEN, C.COUCH_FLORAL][r.int(4)];
      const len = Math.min(3, Math.max(2, Math.min(rw, rd) - 2));
      const side = [S, E, W].find((s) => k.run(s, Array(len).fill(couch), (i, n) => (i === 0 ? ARM_RIGHT : 0) | (i === n - 1 ? ARM_LEFT : 0), true));
      if (side !== undefined) {
        const opposite = side === S ? N : side === N ? S : side === E ? W : E;
        k.run(opposite, [C.TELEVISION], () => 0, true);
      }
      k.one(sides, C.ARMCHAIR);
      k.one(sides, C.BOOKCASE);
      k.one(sides, C.FLOOR_LAMP);
      k.one(sides, C.END_TABLE);
      if (r.next() < 0.6) k.one(sides, C.POTTED_PLANT);
      if (r.next() < 0.5) k.one(sides, C.RADIO);
      const mu = Math.floor((room.u0 + room.u1) / 2), mv = Math.floor((room.v0 + room.v1) / 2);
      if (k.free(mu, mv) && rw >= 4 && rd >= 4) { f.set(mu, F, mv, C.COFFEE_TABLE); k.take(mu, mv); }
      break;
    }
    case "kitchen": {
      // Fridge, sink and stove always; counters between them as the wall allows. The longest wall that has room gets them.
      const lineOf = (n: number) => n >= 6 ? [C.FRIDGE, C.COUNTER, C.COUNTER_SINK, C.COUNTER, C.STOVE, C.COUNTER]
        : n === 5 ? [C.FRIDGE, C.COUNTER, C.COUNTER_SINK, C.COUNTER, C.STOVE] : n === 4 ? [C.FRIDGE, C.COUNTER, C.COUNTER_SINK, C.STOVE] : [C.FRIDGE, C.COUNTER_SINK, C.STOVE];
      let side: number | undefined;
      for (let n = Math.min(6, Math.max(rw, rd)); n >= 3 && side === undefined; n--) side = [S, N, E, W].find((s) => k.run(s, lineOf(n)));
      if (side !== undefined) {
        // Cupboards over the counters, a freezer over the fridge, a microwave on one counter.
        const { cells } = k.wall(side);
        const facing = k.wall(side).facing;
        for (const [u, v] of cells) {
          const below = f.get(u, F, v);
          if (below === C.FRIDGE) f.set(u, F + 1, v, C.FREEZER, facing);
          else if (below === C.COUNTER || below === C.COUNTER_SINK) f.set(u, F + 2, v, C.WALL_CABINET, facing);
        }
        const counter = cells.find(([u, v]) => f.get(u, F, v) === C.COUNTER);
        if (counter && r.next() < 0.6) f.set(counter[0], F + 1, counter[1], C.MICROWAVE, facing);
      }
      const mu = Math.floor((room.u0 + room.u1) / 2), mv = Math.floor((room.v0 + room.v1) / 2);
      if (k.free(mu, mv) && rd >= 4) {
        f.set(mu, F, mv, C.DINING_TABLE); k.take(mu, mv);
        for (const [du, dv, face] of [[0, -1, S], [0, 1, N], [-1, 0, E], [1, 0, W]] as const) {
          if (k.free(mu + du, mv + dv) && r.next() < 0.8) { f.set(mu + du, F, mv + dv, C.KITCHEN_CHAIR, face); k.take(mu + du, mv + dv); }
        }
      }
      k.one(sides, C.TRASH_CAN);
      break;
    }
    case "bedroom": {
      const bed = [C.BLUE_BED, C.GREEN_BED, B.RED_BED][r.int(3)];
      // Head against a wall: foot one step out into the room.
      for (const side of [S, E, W, N]) {
        const { cells, facing } = k.wall(side);
        const back = facing === S ? N : facing === N ? S : facing === E ? W : E;
        const [du, dv] = facing === S ? [0, 1] : facing === N ? [0, -1] : facing === E ? [1, 0] : [-1, 0];
        const mid = cells[Math.floor(cells.length / 2)];
        if (!mid || !k.free(mid[0], mid[1]) || !k.free(mid[0] + du, mid[1] + dv)) continue;
        f.set(mid[0] + du, F, mid[1] + dv, bed, back);
        f.set(mid[0], F, mid[1], bed, back | 4);
        k.take(mid[0], mid[1]); k.take(mid[0] + du, mid[1] + dv);
        const beside = cells[Math.floor(cells.length / 2) + 1] ?? cells[Math.floor(cells.length / 2) - 1];
        if (beside && k.free(beside[0], beside[1])) { f.set(beside[0], F, beside[1], C.NIGHTSTAND, facing); k.take(beside[0], beside[1]); }
        break;
      }
      k.one(sides, C.WARDROBE);
      k.one(sides, C.DRESSER);
      if (r.next() < 0.4) {
        const d = k.one(sides, C.DESK);
        void d;
      }
      break;
    }
    case "bathroom": {
      k.one([S, E, W, N], C.TOILET);
      const sink = k.one([S, W, E, N], C.BATHROOM_SINK);
      if (sink) {
        const facing = f.get(sink[0], F, sink[1]);
        void facing;
      }
      k.one([E, W, N, S], C.BATHTUB);
      if (r.next() < 0.4) k.one([N, W, E, S], C.WASHING_MACHINE);
      break;
    }
    case "garage":
      break;
  }
}

/** What the outbreak has already done: a door kicked in and windows smashed, or boards over everything. */
function aftermath(f: Frame, p: HousePlan, r: Rng, windows: [number, number, number][]): void {
  if (p.state === "ransacked") {
    for (const [u, v, facing] of windows) if (r.next() < 0.35) { f.set(u, F + 1, v, C.HOUSE_WINDOW, facing | WINDOW_BROKEN); f.set(u, F + 2, v, C.HOUSE_WINDOW, facing | WINDOW_BROKEN); }
    const living = p.rooms[0];
    for (let i = 0; i < 3; i++) {
      const u = living.u0 + r.int(living.u1 - living.u0 + 1), v = living.v0 + r.int(living.v1 - living.v0 + 1);
      if (f.get(u, F, v) === B.AIR) f.set(u, F, v, i === 0 ? C.BLOOD_SPLATTER : C.LITTER);
    }
  } else if (p.state === "boarded") {
    for (const [u, v, facing] of windows) {
      const boards = 2 + r.int(3);
      f.set(u, F + 1, v, C.HOUSE_WINDOW, withBoards(facing, boards));
      f.set(u, F + 2, v, C.HOUSE_WINDOW, withBoards(facing, boards));
    }
  } else if (r.next() < 0.3) {
    const [u, v, facing] = windows[r.int(Math.max(1, windows.length))] ?? [0, 0, 0];
    if (windows.length) { f.set(u, F + 1, v, C.HOUSE_WINDOW, facing | WINDOW_OPEN); f.set(u, F + 2, v, C.HOUSE_WINDOW, facing | WINDOW_OPEN); }
  }
}

// ---- shops and public buildings -------------------------------------------------------------------------------

interface Hall { u0: number; v0: number; u1: number; v1: number }

const SIGNS: Partial<Record<Lot["kind"], [string, number]>> = {
  grocery: ["FOOD", wool("red")], pharmacy: ["DRUGS", wool("green")], hardware: ["TOOLS", wool("orange")], gun_store: ["GUNS", wool("black")],
  liquor: ["LIQUOR", wool("purple")], bookstore: ["BOOKS", wool("blue")], clothing: ["STYLE", wool("magenta")], diner: ["DINER", wool("red")],
  bar: ["BAR", wool("blue")], police: ["POLICE", wool("blue")], fire_station: ["FIRE", wool("red")], school: ["SCHOOL", wool("yellow")],
  clinic: ["CLINIC", wool("white")], motel: ["MOTEL", wool("red")], library: ["LIBRARY", wool("green")], gas_station: ["GAS", wool("red")],
};

/** A box of a building on a slab, flat-roofed, glass doors in its front, and the space inside. */
function commercial(f: Frame, r: Rng, opts: { setback?: number; height?: number; wall?: number; floor?: number; backRoom?: boolean } = {}): Hall {
  const setback = opts.setback ?? 3, h = opts.height ?? 4;
  const u0 = 1, u1 = f.W - 2, v0 = setback, v1 = f.D - 2;
  const wall = opts.wall ?? [B.BRICKS, C.TAN_BRICK, C.BROWN_BRICK, C.CINDER_BLOCK, C.STUCCO, C.WHITE_BRICK][r.int(6)];
  // The apron out front: a sidewalk to the street.
  f.box(0, G, 0, f.W - 1, G, setback - 1, C.SIDEWALK);
  f.box(0, F, 0, f.W - 1, F + 3, setback - 1, B.AIR);
  shell(f, u0, v0, u1, v1, wall, h, () => 1);
  f.box(u0 + 1, G, v0 + 1, u1 - 1, G, v1 - 1, opts.floor ?? C.VINYL_FLOOR);
  // A ceiling inside, the tar roof over it, and a parapet round the roof's edge.
  f.box(u0, F + h, v0, u1, F + h, v1, C.DRYWALL);
  f.box(u0, F + h + 1, v0, u1, F + h + 1, v1, C.TAR_ROOF);
  for (let u = u0; u <= u1; u++) { f.set(u, F + h + 2, v0, wall); f.set(u, F + h + 2, v1, wall); }
  for (let v = v0; v <= v1; v++) { f.set(u0, F + h + 2, v, wall); f.set(u1, F + h + 2, v, wall); }
  // Double glass doors in the middle of the front, and shop windows either side.
  const mid = Math.floor((u0 + u1) / 2);
  door(f, mid, v0, C.GLASS_DOOR, N);
  door(f, mid + 1, v0, C.GLASS_DOOR, N | 16);
  for (let u = u0 + 2; u < u1 - 1; u++) {
    if (u >= mid - 1 && u <= mid + 2) continue;
    f.set(u, F + 1, v0, C.HOUSE_WINDOW, N); f.set(u, F + 2, v0, C.HOUSE_WINDOW, N);
  }
  // Lights on a grid.
  for (let u = u0 + 3; u < u1; u += 5) for (let v = v0 + 3; v < v1; v += 5) f.set(u, F + h - 1, v, C.CEILING_LIGHT);
  let hall: Hall = { u0: u0 + 1, v0: v0 + 1, u1: u1 - 1, v1: v1 - 1 };
  if (opts.backRoom !== false && v1 - v0 >= 12) {
    // A storeroom across the back, with a bathroom in its corner.
    const bv = v1 - 5;
    f.box(u0 + 1, F, bv, u1 - 1, F + h - 1, bv, C.DRYWALL);
    door(f, mid, bv, C.PANEL_DOOR, S);
    f.box(u0 + 1, G, bv + 1, u1 - 1, G, v1 - 1, C.CONCRETE);
    for (let u = u0 + 1; u < u1 - 4; u += 2) { f.set(u, F, v1 - 1, C.METAL_SHELF, N); if (r.next() < 0.5) f.set(u + 1, F, v1 - 1, C.CRATE); }
    f.box(u1 - 3, F, bv + 1, u1 - 3, F + h - 1, v1 - 1, C.DRYWALL);
    door(f, u1 - 3, bv + 2, C.PANEL_DOOR, E);
    f.set(u1 - 1, F, v1 - 1, C.TOILET, N);
    f.set(u1 - 2, F, v1 - 1, C.BATHROOM_SINK, N);
    f.box(u1 - 2, G, bv + 1, u1 - 1, G, v1 - 1, C.BATH_TILE);
    hall = { ...hall, v1: bv - 1 };
  }
  const sign = SIGNS[f.lot.kind];
  if (sign && sign[0].length * 4 - 1 <= u1 - u0 - 1) f.sign(sign[0], mid, F + h + 3, v0, sign[1]);
  return hall;
}

/** Aisles of shelving across a hall, front to back, with room to walk. */
function aisles(f: Frame, h: Hall, shelf: number, front = 3): void {
  for (let u = h.u0 + 1; u <= h.u1 - 1; u += 3) {
    for (let v = h.v0 + front; v <= h.v1 - 2; v++) f.set(u, F, v, shelf, u % 2 ? E : W);
  }
}

function shop(f: Frame, r: Rng): void {
  const kind = f.lot.kind;
  const gas = kind === "gas_station";
  const h = commercial(f, r, { setback: gas ? 12 : 3, floor: kind === "hardware" ? C.PAINTED_CONCRETE : C.VINYL_FLOOR });
  const mid = Math.floor((h.u0 + h.u1) / 2);
  const checkout = () => { f.set(h.u0 + 1, F, h.v0 + 1, C.CHECKOUT, E); f.set(h.u0 + 1, F, h.v0 + 2, C.CHECKOUT, E); };
  switch (kind) {
    case "grocery": case "liquor":
      aisles(f, h, C.STORE_SHELF);
      for (let u = h.u0; u <= h.u1; u++) if (u !== mid && u !== mid + 1) f.set(u, F, h.v1, C.COOLER, N);
      checkout();
      break;
    case "pharmacy":
      aisles(f, h, C.STORE_SHELF);
      for (let u = h.u0 + 1; u <= h.u1 - 1; u++) f.set(u, F, h.v1 - 1, u === mid ? B.AIR : C.CHECKOUT, N);
      for (let u = h.u0; u <= h.u1; u++) if (u !== mid) f.set(u, F, h.v1, C.STORE_SHELF, N);
      checkout();
      break;
    case "hardware":
      aisles(f, h, C.METAL_SHELF);
      f.set(h.u1, F, h.v1, C.TOOL_CHEST, W);
      f.set(h.u1, F, h.v1 - 1, C.GENERATOR, W);
      checkout();
      break;
    case "gun_store":
      for (let v = h.v0 + 1; v <= h.v1; v++) { f.set(h.u0, F, v, C.GUN_RACK, E); f.set(h.u1, F, v, C.GUN_RACK, W); }
      for (let u = h.u0 + 2; u <= h.u1 - 2; u++) f.set(u, F, h.v0 + 3, C.CHECKOUT, N);
      f.set(mid, F, h.v1, C.SAFE, N);
      break;
    case "bookstore": case "library":
      for (let v = h.v0 + 1; v <= h.v1; v++) { f.set(h.u0, F, v, C.BOOKCASE, E); f.set(h.u1, F, v, C.BOOKCASE, W); }
      for (let u = h.u0 + 2; u <= h.u1 - 2; u += 3) for (let v = h.v0 + 4; v <= h.v1 - 1; v++) f.set(u, F, v, C.BOOKCASE, u % 2 ? E : W);
      if (kind === "library") for (let u = h.u0 + 3; u <= h.u1 - 3; u += 3) { f.set(u, F, h.v0 + 2, C.DESK, N); f.set(u, F, h.v0 + 1, C.OFFICE_CHAIR, S); }
      else checkout();
      break;
    case "clothing":
      for (let u = h.u0 + 1; u <= h.u1 - 1; u += 3) for (let v = h.v0 + 3; v <= h.v1 - 1; v += 2) f.set(u, F, v, C.CLOTHING_RACK, E);
      checkout();
      break;
    case "gas_station": {
      aisles(f, h, C.STORE_SHELF);
      f.set(h.u1, F, h.v1, C.COOLER, N);
      f.set(h.u1 - 1, F, h.v1, C.COOLER, N);
      f.set(h.u0, F, h.v1, C.VENDING_MACHINE, N);
      checkout();
      // The pumps, under a canopy on posts, between the store and the road.
      const pu0 = 3, pu1 = f.W - 4;
      f.box(0, G, 0, f.W - 1, G, 11, C.ASPHALT);
      f.box(0, F, 0, f.W - 1, F + 4, 11, B.AIR);
      for (let u = pu0 + 2; u <= pu1 - 2; u += 5) { f.set(u, F, 5, C.GAS_PUMP, N); f.set(u, F, 7, C.GAS_PUMP, S); }
      for (const [u, v] of [[pu0, 3], [pu1, 3], [pu0, 9], [pu1, 9]]) f.box(u, F, v, u, F + 3, v, C.LAMP_POST);
      f.box(pu0, F + 4, 3, pu1, F + 4, 9, C.CORRUGATED_METAL);
      for (let u = pu0 + 2; u <= pu1 - 2; u += 4) f.set(u, F + 3, 6, C.CEILING_LIGHT);
      break;
    }
  }
}

function diner(f: Frame, r: Rng): void {
  const h = commercial(f, r, { floor: C.LINOLEUM });
  const bar = f.lot.kind === "bar";
  // The counter down one side, stools in front of it.
  for (let v = h.v0 + 2; v <= h.v1 - 2; v++) { f.set(h.u1 - 1, F, v, C.COUNTER, W); f.set(h.u1 - 2, F, v, C.KITCHEN_CHAIR, E); }
  for (let v = h.v0 + 2; v <= h.v1 - 2; v += 2) f.set(h.u1, F, v, bar ? C.COOLER : C.FRIDGE, W);
  // Tables along the windows and down the middle.
  for (let u = h.u0 + 1; u <= h.u1 - 4; u += 3) for (let v = h.v0 + 2; v <= h.v1 - 1; v += 3) {
    f.set(u, F, v, C.DINING_TABLE);
    f.set(u, F, v - 1, C.KITCHEN_CHAIR, S);
    f.set(u, F, v + 1, C.KITCHEN_CHAIR, N);
  }
  // The kitchen: stoves and counters along the storeroom wall.
  f.set(h.u0, F, h.v1, C.STOVE, N); f.set(h.u0 + 1, F, h.v1, C.STOVE, N); f.set(h.u0 + 2, F, h.v1, C.COUNTER, N); f.set(h.u0 + 3, F, h.v1, C.COUNTER_SINK, N);
  f.set(h.u0 + 4, F, h.v1, C.FREEZER, N);
  if (bar) f.set(h.u0, F, h.v0 + 1, C.RADIO, E);
}

function office(f: Frame, r: Rng): void {
  const kind = f.lot.kind;
  const h = commercial(f, r, { floor: C.CARPET_GREY, backRoom: kind !== "church" });
  const mid = Math.floor((h.u0 + h.u1) / 2);
  switch (kind) {
    case "police": {
      for (let u = h.u0 + 2; u <= h.u1 - 2; u++) if (u !== mid && u !== mid + 1) f.set(u, F, h.v0 + 3, C.CHECKOUT, N);
      for (let u = h.u0; u <= h.u1; u += 2) f.set(u, F, h.v1, C.LOCKER, N);
      for (let v = h.v0 + 5; v <= h.v1 - 2; v += 3) { f.set(h.u0, F, v, C.DESK, E); f.set(h.u0 + 1, F, v, C.OFFICE_CHAIR, W); f.set(h.u0, F, v + 1, C.FILING_CABINET, E); }
      // The cells: bars across the far corner.
      for (let v = h.v0 + 5; v <= h.v1 - 2; v++) f.box(h.u1 - 3, F, v, h.u1 - 3, F + 2, v, B.IRON_BARS);
      f.set(h.u1 - 1, F, h.v0 + 6, C.HOSPITAL_BED, S); f.set(h.u1 - 1, F, h.v0 + 5, C.HOSPITAL_BED, S | 4);
      f.set(h.u1, F, h.v1 - 1, C.GUN_RACK, W);
      break;
    }
    case "fire_station": {
      for (let v = h.v0 + 1; v <= h.v1; v += 2) f.set(h.u0, F, v, C.LOCKER, E);
      for (let u = h.u1 - 4; u <= h.u1; u += 2) { f.set(u, F, h.v1, C.BLUE_BED, N); f.set(u, F, h.v1 - 1, C.BLUE_BED, N | 4); }
      f.set(mid, F, h.v1, C.STOVE, N); f.set(mid + 1, F, h.v1, C.FRIDGE, N); f.set(mid - 1, F, h.v1, C.COUNTER, N);
      // The engine bay's big doors in the front.
      for (let u = h.u0 + 1; u <= h.u0 + 5; u++) f.box(u, F, h.v0 - 1, u, F + 2, h.v0 - 1, C.GARAGE_DOOR, N);
      break;
    }
    case "school": {
      for (let u = h.u0 + 1; u <= h.u1 - 1; u += 2) f.set(u, F, h.v0, C.LOCKER, S);
      for (let u = h.u0 + 2; u <= h.u1 - 2; u += 2) for (let v = h.v0 + 4; v <= h.v1 - 3; v += 2) f.set(u, F, v, C.SCHOOL_DESK, N);
      f.set(mid, F, h.v0 + 2, C.DESK, S);
      f.set(h.u0, F, h.v1, C.BOOKCASE, E); f.set(h.u1, F, h.v1, C.BOOKCASE, W);
      break;
    }
    case "church": {
      for (let v = h.v0 + 3; v <= h.v1 - 4; v += 2) {
        for (let u = h.u0 + 1; u <= mid - 1; u++) f.set(u, F, v, C.CHURCH_PEW, N);
        for (let u = mid + 2; u <= h.u1 - 1; u++) f.set(u, F, v, C.CHURCH_PEW, N);
      }
      f.box(mid - 1, F, h.v1 - 1, mid + 2, F, h.v1 - 1, C.DINING_TABLE);
      f.set(h.u0, F, h.v1, C.POTTED_PLANT); f.set(h.u1, F, h.v1, C.POTTED_PLANT);
      f.set(mid, F + 5, h.v0, B.GOLD_BLOCK); f.set(mid, F + 6, h.v0, B.GOLD_BLOCK); f.set(mid - 1, F + 6, h.v0, B.GOLD_BLOCK); f.set(mid + 1, F + 6, h.v0, B.GOLD_BLOCK);
      f.set(mid, F + 7, h.v0, B.GOLD_BLOCK);
      break;
    }
    case "clinic": {
      for (let u = h.u0 + 1; u <= h.u1 - 1; u += 2) f.set(u, F, h.v0 + 1, C.KITCHEN_CHAIR, S);
      f.set(h.u1, F, h.v0 + 1, C.VENDING_MACHINE, W);
      for (let u = h.u0 + 1; u <= h.u1 - 2; u += 4) {
        f.set(u, F, h.v1, C.HOSPITAL_BED, N); f.set(u, F, h.v1 - 1, C.HOSPITAL_BED, N | 4);
        f.set(u + 1, F, h.v1, C.COUNTER, N); f.set(u + 1, F + 2, h.v1, C.MEDICINE_CABINET, N);
      }
      for (let u = h.u0; u <= h.u1; u++) if (u % 3 === 0) f.set(u, F, h.v0 + 5, C.STORE_SHELF, S);
      break;
    }
    default: {
      for (let u = h.u0 + 1; u <= h.u1 - 1; u += 3) for (let v = h.v0 + 2; v <= h.v1 - 1; v += 3) {
        f.set(u, F, v, C.DESK, N); f.set(u, F, v - 1, C.OFFICE_CHAIR, S);
      }
      for (let v = h.v0 + 1; v <= h.v1; v += 2) f.set(h.u1, F, v, C.FILING_CABINET, W);
      f.set(h.u0, F, h.v1, C.COOLER, E);
      if (r.next() < 0.3) f.set(h.u0, F, h.v1 - 2, C.SAFE, E);
    }
  }
}

function motel(f: Frame, r: Rng): void {
  const u0 = 1, u1 = f.W - 2, v0 = 8, v1 = Math.min(f.D - 2, v0 + 8);
  f.box(0, G, 0, f.W - 1, G, v0 - 1, C.ASPHALT);
  f.box(0, F, 0, f.W - 1, F + 3, v0 - 1, B.AIR);
  shell(f, u0, v0, u1, v1, C.STUCCO, 3);
  f.box(u0, F + 3, v0 - 2, u1, F + 3, v1, C.TAR_ROOF);
  for (let u = u0; u <= u1; u += 2) f.set(u, F + 2, v0 - 2, C.LAMP_POST);
  // Units four wide, each a door, a window, a bed, a TV and a bathroom at the back.
  for (let a = u0; a + 4 <= u1; a += 4) {
    if (a > u0) f.box(a, F, v0 + 1, a, F + 2, v1 - 1, C.STUCCO);
    f.box(a + 1, G, v0 + 1, a + 3, G, v1 - 1, C.CARPET_RED);
    door(f, a + 1, v0, C.PANEL_DOOR, N);
    f.set(a + 3, F + 1, v0, C.HOUSE_WINDOW, N); f.set(a + 3, F + 2, v0, C.HOUSE_WINDOW, N);
    f.set(a + 2, F, v0 + 5, B.RED_BED, N); f.set(a + 2, F, v0 + 4, B.RED_BED, N | 4);
    f.set(a + 3, F, v0 + 4, C.NIGHTSTAND, W);
    f.set(a + 1, F, v0 + 3, C.TELEVISION, E);
    f.set(a + 1, F, v1 - 1, C.TOILET, N); f.set(a + 3, F, v1 - 1, C.BATHROOM_SINK, N);
    f.set(a + 2, F + 2, v0 + 3, C.CEILING_LIGHT);
  }
  f.sign("MOTEL", Math.floor((u0 + u1) / 2), F + 5, v0, SIGNS.motel![1]);
  void r;
}

function warehouse(f: Frame, r: Rng): void {
  const u0 = 1, u1 = f.W - 2, v0 = 3, v1 = f.D - 2;
  f.box(0, G, 0, f.W - 1, G, v0 - 1, C.CONCRETE);
  f.box(0, F, 0, f.W - 1, F + 3, v0 - 1, B.AIR);
  shell(f, u0, v0, u1, v1, r.next() < 0.5 ? C.CORRUGATED_METAL : C.RUSTY_METAL, 6);
  f.box(u0 + 1, G, v0 + 1, u1 - 1, G, v1 - 1, C.PAINTED_CONCRETE);
  f.box(u0, F + 6, v0, u1, F + 6, v1, C.CORRUGATED_METAL);
  for (let u = u0 + 2; u <= u0 + 5; u++) f.box(u, F, v0, u, F + 3, v0, C.GARAGE_DOOR, N);
  door(f, u1 - 3, v0, C.METAL_DOOR, N);
  for (let u = u0 + 2; u <= u1 - 2; u += 3) for (let v = v0 + 4; v <= v1 - 2; v++) {
    if ((v - v0) % 6 === 0) continue;
    f.set(u, F, v, r.next() < 0.5 ? C.CRATE : C.METAL_SHELF, E);
    if (r.next() < 0.4) f.set(u, F + 1, v, C.CRATE);
  }
  for (let u = u0 + 4; u < u1; u += 6) for (let v = v0 + 4; v < v1; v += 6) f.set(u, F + 5, v, C.CEILING_LIGHT);
}

// ---- rural and special lots ------------------------------------------------------------------------------------

function trailer(f: Frame, r: Rng): void {
  const u0 = 2, u1 = Math.min(f.W - 3, 7), v0 = 2, v1 = Math.min(f.D - 2, 13);
  shell(f, u0, v0, u1, v1, [C.SIDING_WHITE, C.SIDING_CREAM, C.CORRUGATED_METAL][r.int(3)], 3);
  f.box(u0 + 1, G, v0 + 1, u1 - 1, G, v1 - 1, C.CARPET_BROWN);
  f.box(u0, F + 3, v0, u1, F + 3, v1, C.CORRUGATED_METAL);
  door(f, u0 + 1, v0, C.PANEL_DOOR, N);
  f.set(u1, F + 1, v0 + 3, C.HOUSE_WINDOW, E); f.set(u1, F + 2, v0 + 3, C.HOUSE_WINDOW, E);
  f.set(u0, F + 1, v1 - 3, C.HOUSE_WINDOW, W); f.set(u0, F + 2, v1 - 3, C.HOUSE_WINDOW, W);
  f.set(u1 - 1, F, v0 + 1, C.COUNTER, S); f.set(u1 - 1, F, v0 + 2, C.STOVE, W); f.set(u1 - 1, F, v0 + 3, C.FRIDGE, W);
  f.set(u0 + 1, F, v0 + 4, C.COUCH_FLORAL, E | ARM_LEFT | ARM_RIGHT);
  f.set(u1 - 1, F, v0 + 5, C.TELEVISION, W);
  f.set(u0 + 2, F, v1 - 1, B.RED_BED, S); f.set(u0 + 2, F, v1 - 2, B.RED_BED, S | 4);
  f.set(u1 - 1, F, v1 - 1, C.TOILET, N);
  f.set(u1 - 1, F, v1 - 2, C.BATHROOM_SINK, W);
  f.set(u0 + 2, F + 2, v0 + 4, C.CEILING_LIGHT);
  if (r.next() < 0.5) f.set(u1 + 1, F, v0 + 1, C.TRASH_CAN);
}

function cabin(f: Frame, r: Rng): void {
  const u0 = 2, u1 = f.W - 3, v0 = 2, v1 = Math.min(f.D - 3, v0 + 8);
  shell(f, u0, v0, u1, v1, B.SPRUCE_LOG, 3);
  f.box(u0 + 1, G, v0 + 1, u1 - 1, G, v1 - 1, B.SPRUCE_PLANKS);
  ceiling(f, u0, v0, u1, v1, B.SPRUCE_LOG);
  gableRoof(f, u0, v0, u1, v1, C.SHINGLE_STAIRS_GREEN, C.SHINGLES_GREEN, B.SPRUCE_PLANKS);
  door(f, Math.floor((u0 + u1) / 2), v0, C.FRONT_DOOR, N);
  for (const [u, v, facing] of [[u0 + 2, v0, N], [u1 - 2, v0, N], [u0, v0 + 4, W], [u1, v0 + 4, E], [u0 + 3, v1, S]] as const) {
    f.set(u, F + 1, v, C.HOUSE_WINDOW, facing); f.set(u, F + 2, v, C.HOUSE_WINDOW, facing);
  }
  f.set(u0 + 1, F, v1 - 1, C.BLUE_BED, W); f.set(u0 + 2, F, v1 - 1, C.BLUE_BED, W | 4);
  f.set(u1 - 1, F, v1 - 1, C.STOVE, N); f.set(u1 - 2, F, v1 - 1, C.COUNTER, N);
  f.set(u1 - 1, F, v0 + 1, C.ARMCHAIR, W);
  f.set(Math.floor((u0 + u1) / 2), F, v0 + 4, C.DINING_TABLE);
  f.set(u0 + 1, F, v0 + 1, C.BOOKCASE, E);
  f.set(Math.floor((u0 + u1) / 2), F + 2, v0 + 4, C.CEILING_LIGHT);
  // A dock out onto the lake, behind.
  f.box(Math.floor((u0 + u1) / 2), G, v1 + 1, Math.floor((u0 + u1) / 2), G, f.D - 1, B.SPRUCE_PLANKS);
  if (r.next() < 0.5) f.set(u1, F, v0 - 1, C.PICNIC_TABLE, N);
}

function farm(f: Frame, r: Rng): void {
  // The farmhouse at the front, its own small lot within the farm.
  const houseLot: Lot = { ...f.lot, kind: "house", ...lotRect(f, 0, 0, 19, 20), seed: f.lot.seed ^ 0xfa12 };
  house(new Frame(f.c, houseLot), "small");
  // The barn.
  const bu0 = f.W - 18, bu1 = f.W - 3, bv0 = 4, bv1 = 18;
  shell(f, bu0, bv0, bu1, bv1, C.BARN_SIDING, 5);
  f.box(bu0 + 1, G, bv0 + 1, bu1 - 1, G, bv1 - 1, B.COARSE_DIRT);
  gableRoof(f, bu0, bv0 - 2, bu1, bv1, C.SHINGLE_STAIRS_RED, C.SHINGLES_RED, C.BARN_SIDING);
  for (let u = bu0; u <= bu1; u++) f.box(u, F + 5, bv0 - 1, u, F + 5, bv1, C.RUSTY_METAL);
  for (let u = bu0 + 5; u <= bu0 + 9; u++) f.box(u, F, bv0, u, F + 3, bv0, C.GARAGE_DOOR, N);
  for (let v = bv0 + 2; v < bv1; v += 2) { f.set(bu0 + 1, F, v, B.HAY); if (r.next() < 0.5) f.set(bu0 + 1, F + 1, v, B.HAY); }
  f.set(bu1 - 1, F, bv1 - 1, C.CRATE); f.set(bu1 - 1, F, bv1 - 2, C.METAL_SHELF, W); f.set(bu1 - 2, F, bv1 - 1, C.FUEL_DRUM);
  // A silo beside it.
  const su = bu0 - 4, sv = bv0 + 3;
  for (let y = F; y <= F + 14; y++) for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) {
    if (Math.abs(du) + Math.abs(dv) > 3) continue;
    const edge = Math.abs(du) === 2 || Math.abs(dv) === 2 || Math.abs(du) + Math.abs(dv) === 3;
    f.set(su + du, y, sv + dv, edge ? (y === F + 14 ? C.CORRUGATED_METAL : B.SMOOTH_STONE) : B.AIR);
  }
  // Fields of crops behind, watered by a ditch, fenced.
  const fv0 = 23, fv1 = f.D - 3, fu0 = 2, fu1 = f.W - 3;
  const crop = [B.WHEAT, B.CARROTS, B.POTATOES][r.int(3)];
  for (let u = fu0; u <= fu1; u++) for (let v = fv0; v <= fv1; v++) {
    const edge = u === fu0 || u === fu1 || v === fv0 || v === fv1;
    if (edge) { f.set(u, F, v, B.OAK_FENCE); continue; }
    if ((u - fu0) % 9 === 4) { f.set(u, G, v, B.WATER); continue; }
    f.set(u, G, v, B.FARMLAND, 7);
    f.set(u, F, v, crop, 1 + r.int(CROP_MAX_AGE[crop]));
  }
  f.set(Math.floor((fu0 + fu1) / 2), F, fv0, B.OAK_FENCE);
  f.set(Math.floor((fu0 + fu1) / 2) + 1, F, fv0, B.AIR);
  // A dirt drive in.
  f.box(bu0 + 5, G, 0, bu0 + 9, G, bv0 - 1, C.DIRT_ROAD);
}

/** A sub-rectangle of a lot, in world terms, from local corners. */
function lotRect(f: Frame, u0: number, v0: number, u1: number, v1: number): { x0: number; z0: number; x1: number; z1: number } {
  const xs = [f.x(u0, v0), f.x(u1, v1)], zs = [f.z(u0, v0), f.z(u1, v1)];
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
}

function park(f: Frame, r: Rng): void {
  const mu = Math.floor(f.W / 2);
  f.box(mu, G, 0, mu, G, f.D - 1, C.SIDEWALK);
  for (let v = 3; v < f.D - 2; v += 5) { f.set(mu - 1, F, v, C.BENCH, E); f.set(mu + 1, F, v, C.BENCH, W); }
  f.set(2, F, f.D - 3, C.PICNIC_TABLE, N); f.set(f.W - 3, F, f.D - 3, C.PICNIC_TABLE, N);
  f.set(mu + 1, F, 1, C.TRASH_CAN);
  tree(f, 2, 3, r); tree(f, f.W - 3, 4, r);
}

function waterTower(f: Frame): void {
  const cu = Math.floor(f.W / 2), cv = Math.floor(f.D / 2);
  for (const [du, dv] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) for (let y = F; y < F + 16; y++) f.set(cu + du, y, cv + dv, C.LAMP_POST);
  for (let y = F + 16; y <= F + 22; y++) for (let du = -4; du <= 4; du++) for (let dv = -4; dv <= 4; dv++) {
    const d = Math.hypot(du, dv);
    if (d <= 4.3) f.set(cu + du, y, cv + dv, d > 3.3 || y === F + 16 || y === F + 22 ? B.IRON_BLOCK : B.WATER);
  }
  f.set(cu, F + 23, cv, B.IRON_BLOCK);
  f.set(cu, F + 24, cv, C.STREET_LAMP);
}

function cemetery(f: Frame, r: Rng): void {
  for (let u = 0; u < f.W; u++) { f.set(u, F, 0, B.IRON_BARS); f.set(u, F, f.D - 1, B.IRON_BARS); }
  for (let v = 0; v < f.D; v++) { f.set(0, F, v, B.IRON_BARS); f.set(f.W - 1, F, v, B.IRON_BARS); }
  f.box(Math.floor(f.W / 2), F, 0, Math.floor(f.W / 2) + 1, F, 0, B.AIR);
  for (let u = 3; u < f.W - 3; u += 3) for (let v = 3; v < f.D - 3; v += 3) {
    if (r.next() < 0.15) continue;
    f.set(u, F, v, r.next() < 0.7 ? B.STONE_BRICK_SLAB : B.COBBLE_STAIRS, N);
    if (r.next() < 0.1) f.set(u, F + 1, v, B.POPPY);
  }
  tree(f, 2, f.D - 3, r);
}

function campground(f: Frame, r: Rng): void {
  for (const [u, v] of [[3, 3], [9, 3], [3, 9], [9, 9]]) f.set(u, F, v, C.PICNIC_TABLE, N);
  // A tent: green canvas over a frame.
  const t = wool("green");
  f.box(5, F, 6, 8, F, 6, t); f.box(5, F + 1, 6, 8, F + 1, 6, t);
  f.set(6, F, 7, B.AIR); f.set(7, F, 7, B.AIR);
  f.set(12, F, 12, C.TRASH_CAN);
  void r;
}

function checkpoint(f: Frame, r: Rng): void {
  // Sandbags across the front, a tent, crates, and floodlights on poles.
  for (let u = 0; u < f.W; u++) if (u % 5 !== 2) f.set(u, F, 1, C.SANDBAGS);
  for (let u = 1; u < f.W - 1; u += 4) f.set(u, F, 0, C.JERSEY_BARRIER, N);
  const t = wool("green");
  f.box(3, F, 5, 10, F + 2, 11, t);
  f.box(4, F, 6, 9, F + 1, 10, B.AIR);
  f.set(6, F, 5, B.AIR); f.set(6, F + 1, 5, B.AIR);
  f.set(4, F, 10, C.MILITARY_CRATE, N); f.set(5, F, 10, C.MILITARY_CRATE, N); f.set(8, F, 10, C.HOSPITAL_BED, W); f.set(9, F, 10, C.HOSPITAL_BED, W | 4);
  f.set(9, F, 6, C.RADIO, W);
  for (const u of [1, f.W - 2]) { f.box(u, F, 3, u, F + 3, 3, C.LAMP_POST); f.set(u, F + 4, 3, C.STREET_LAMP); }
  for (let v = 2; v < f.D; v++) { f.set(0, F, v, C.CHAIN_LINK, W); f.set(f.W - 1, F, v, C.CHAIN_LINK, W); }
  if (r.next() < 0.5) f.set(12, F, 12, C.BLOOD_SPLATTER);
}

/** Camp Hadley: a fenced post of barracks, an armoury, headquarters, a mess hall, a motor pool, towers and a helipad. */
function militaryBase(f: Frame, r: Rng): void {
  // In the base's own frame the gate faces west, onto Post Road: u runs north–south, v east from the fence.
  const Wd = f.W, Dd = f.D;
  for (let u = 0; u < Wd; u++) for (const v of [0, Dd - 1]) { f.set(u, F, v, C.CHAIN_LINK, N); f.set(u, F + 1, v, C.CHAIN_LINK, N); f.set(u, F + 2, v, C.BARBED_WIRE); }
  for (let v = 0; v < Dd; v++) for (const u of [0, Wd - 1]) { f.set(u, F, v, C.CHAIN_LINK, W); f.set(u, F + 1, v, C.CHAIN_LINK, W); f.set(u, F + 2, v, C.BARBED_WIRE); }
  // The gate, where Post Road comes in, and the camp's own road to the buildings.
  const gu = f.lot.gate ?? Math.floor(Wd / 2);
  for (let u = gu - 3; u <= gu + 3; u++) { f.set(u, F, 0, C.JERSEY_BARRIER, W); f.set(u, F + 1, 0, B.AIR); f.set(u, F + 2, 0, B.AIR); }
  f.box(gu - 3, G, 0, gu + 3, G, 30, C.ASPHALT);
  f.box(Math.min(10, gu), G, 28, Math.max(gu + 3, 110), G, 32, C.ASPHALT);
  for (const du of [-5, 5]) { f.box(gu + du, F, 2, gu + du, F + 1, 2, C.SANDBAGS); }
  // Barracks: long cinder-block halls of beds and lockers.
  const building = (u0: number, v0: number, w: number, d: number, fill: (h: Hall) => void, wall: number = C.CINDER_BLOCK) => {
    const u1 = u0 + w - 1, v1 = v0 + d - 1;
    shell(f, u0, v0, u1, v1, wall, 4);
    f.box(u0 + 1, G, v0 + 1, u1 - 1, G, v1 - 1, C.PAINTED_CONCRETE);
    f.box(u0, F + 4, v0, u1, F + 4, v1, C.TAR_ROOF);
    door(f, u0, Math.floor((v0 + v1) / 2), C.METAL_DOOR, W);
    for (let v = v0 + 2; v < v1 - 1; v += 3) { f.set(u1, F + 1, v, C.HOUSE_WINDOW, E); f.set(u1, F + 2, v, C.HOUSE_WINDOW, E); }
    for (let u = u0 + 3; u < u1; u += 5) f.set(u, F + 3, Math.floor((v0 + v1) / 2), C.CEILING_LIGHT);
    fill({ u0: u0 + 1, v0: v0 + 1, u1: u1 - 1, v1: v1 - 1 });
  };
  const barracks = (h: Hall) => {
    for (let u = h.u0; u <= h.u1; u += 2) {
      f.set(u, F, h.v0, B.RED_BED, S | 4); f.set(u, F, h.v0 + 1, B.RED_BED, S);
      f.set(u, F, h.v1, B.RED_BED, N | 4); f.set(u, F, h.v1 - 1, B.RED_BED, N);
      if (u + 1 <= h.u1) { f.set(u + 1, F, h.v0, C.LOCKER, S); f.set(u + 1, F, h.v1, C.LOCKER, N); }
    }
  };
  for (let i = 0; i < 4; i++) building(10 + i * 22, 40, 18, 12, barracks);
  building(10, 70, 16, 12, (h) => {
    for (let u = h.u0; u <= h.u1; u++) { f.set(u, F, h.v0, C.MILITARY_CRATE, S); f.set(u, F, h.v1, C.MILITARY_CRATE, N); }
    for (let u = h.u0 + 2; u <= h.u1 - 2; u += 3) f.set(u, F, Math.floor((h.v0 + h.v1) / 2), C.GUN_RACK, E);
  });
  building(34, 70, 20, 14, (h) => {
    for (let u = h.u0 + 1; u <= h.u1 - 1; u += 3) for (let v = h.v0 + 2; v <= h.v1 - 2; v += 3) { f.set(u, F, v, C.DINING_TABLE); f.set(u, F, v - 1, C.KITCHEN_CHAIR, S); f.set(u, F, v + 1, C.KITCHEN_CHAIR, N); }
    for (let u = h.u0; u <= h.u1; u += 2) f.set(u, F, h.v1, u % 4 ? C.STOVE : C.FRIDGE, N);
  });
  building(60, 70, 16, 12, (h) => {
    for (let u = h.u0 + 1; u <= h.u1 - 1; u += 3) { f.set(u, F, h.v0 + 2, C.DESK, S); f.set(u, F, h.v0 + 3, C.OFFICE_CHAIR, N); }
    for (let u = h.u0; u <= h.u1; u++) f.set(u, F, h.v1, C.FILING_CABINET, N);
    f.set(h.u1, F, h.v0, C.SAFE, W);
  });
  // The motor pool: a metal shed of garage bays.
  building(84, 70, 24, 16, (h) => {
    for (let u = h.u0; u <= h.u1; u += 4) { f.set(u, F, h.v1, C.TOOL_CHEST, N); f.set(u + 1, F, h.v1, C.METAL_SHELF, N); }
    f.set(h.u0, F, h.v0, C.GENERATOR, S); f.set(h.u0 + 1, F, h.v0, C.FUEL_DRUM); f.set(h.u0 + 2, F, h.v0, C.FUEL_DRUM);
  }, C.CORRUGATED_METAL);
  // The helipad.
  const hu = 60, hv = 110;
  f.box(hu - 7, G, hv - 7, hu + 7, G, hv + 7, C.CONCRETE);
  for (let d = -4; d <= 4; d++) { f.set(hu - 3, G, hv + d, C.PAINTED_CONCRETE); f.set(hu + 3, G, hv + d, C.PAINTED_CONCRETE); }
  for (let d = -3; d <= 3; d++) f.set(hu + d, G, hv, C.PAINTED_CONCRETE);
  // Tents in rows.
  for (let i = 0; i < 6; i++) {
    const tu = 12 + i * 12, tv = 130;
    f.box(tu, F, tv, tu + 6, F + 2, tv + 6, wool("green"));
    f.box(tu + 1, F, tv + 1, tu + 5, F + 1, tv + 5, B.AIR);
    f.set(tu + 3, F, tv, B.AIR); f.set(tu + 3, F + 1, tv, B.AIR);
    f.set(tu + 1, F, tv + 5, C.MILITARY_CRATE, N);
    f.set(tu + 5, F, tv + 5, C.HOSPITAL_BED, W);
  }
  // Watchtowers at the corners.
  for (const [u, v] of [[3, 3], [Wd - 4, 3], [3, Dd - 4], [Wd - 4, Dd - 4]]) {
    for (let y = F; y < F + 7; y++) for (const [du, dv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) f.set(u + du, y, v + dv, B.SPRUCE_LOG);
    f.box(u - 2, F + 7, v - 2, u + 2, F + 7, v + 2, B.SPRUCE_PLANKS);
    for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) if (Math.abs(du) === 2 || Math.abs(dv) === 2) f.set(u + du, F + 8, v + dv, C.SANDBAGS);
    for (let y = F; y < F + 7; y++) f.set(u, y, v, B.LADDER, N);
    f.set(u + 2, F + 9, v + 2, C.STREET_LAMP);
  }
  // Sandbag emplacements round the ground.
  for (let i = 0; i < 8; i++) {
    const u = 10 + r.int(Wd - 20), v = 95 + r.int(30);
    for (let d = -2; d <= 2; d++) f.set(u + d, F, v, C.SANDBAGS);
  }
}

// ---- the dispatcher --------------------------------------------------------------------------------------------

export function stampLot(c: Clip, lot: Lot, county: County): void {
  if (!c.touches(lot.x0, lot.z0, lot.x1, lot.z1)) return;
  const f = new Frame(c, lot);
  const r = new Rng(lot.seed ^ 0x5a17);
  // The lot's ground: mown grass, nothing growing over what is about to be built.
  for (let u = 0; u < f.W; u++) for (let v = 0; v < f.D; v++) {
    if (!f.touches(u, v, u, v)) continue;
    f.set(u, G, v, B.GRASS);
    for (let y = F; y < F + 26; y++) f.set(u, y, v, B.AIR);
  }
  const style = county.townAt(lot.x0, lot.z0)?.style ?? "small";
  switch (lot.kind) {
    case "house": case "farmhouse": return house(f, style);
    case "trailer": return trailer(f, r);
    case "cabin": return cabin(f, r);
    case "farm": return farm(f, r);
    case "park": return park(f, r);
    case "water_tower": return waterTower(f);
    case "cemetery": return cemetery(f, r);
    case "campground": return campground(f, r);
    case "checkpoint": return checkpoint(f, r);
    case "military": return militaryBase(f, r);
    case "grocery": case "pharmacy": case "hardware": case "gun_store": case "liquor": case "bookstore": case "clothing": case "gas_station": case "library":
      return shop(f, r);
    case "diner": case "bar": return diner(f, r);
    case "police": case "fire_station": case "school": case "church": case "clinic": case "office": return office(f, r);
    case "motel": return motel(f, r);
    case "warehouse": case "barn": return warehouse(f, r);
  }
}
