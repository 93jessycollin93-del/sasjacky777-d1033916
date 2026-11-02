/**
 * The block registry.
 *
 * IDs are stored in saved worlds and sent over the wire, so this list is
 * APPEND-ONLY: never reorder, never delete, never reuse a number. A block that
 * is retired keeps its slot. Reordering would turn every saved house into a
 * different house on next load, and nothing would report it.
 *
 * Every other system reads from here rather than keeping its own notion of a
 * block — the mesher (shape, textures, render layer), physics (collision
 * boxes), lighting (emission, opacity), mining (hardness, tool, harvest tier),
 * audio (material). One table means a new block is one entry, not six edits.
 */

import { COUNTY_BLOCKS, defineCountyBlocks, isCountyBed, isCountyDoor, isShingleSlab, isShingleStairs } from "./countyBlocks";

/** Face order used everywhere: +x, -x, +y, -y, +z, -z. */
export const Face = { East: 0, West: 1, Up: 2, Down: 3, South: 4, North: 5 } as const;
export type FaceIndex = (typeof Face)[keyof typeof Face];

export const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Horizontal facing stored in block meta: 0 north(-z), 1 south(+z), 2 west(-x), 3 east(+x). */
export const FACING_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
export const FACING_TO_FACE = [Face.North, Face.South, Face.West, Face.East] as const;
export const OPPOSITE_FACING = [1, 0, 3, 2] as const;
/** Clockwise rotation of a facing seen from above: north → east → south → west. */
export const CLOCKWISE_FACING = [3, 2, 0, 1] as const;

export type Shape = "none" | "cube" | "cross" | "crop" | "boxes" | "fluid" | "wire" | "rail";
export type RenderLayer = "none" | "opaque" | "cutout" | "translucent";
export type ToolType = "pickaxe" | "axe" | "shovel" | "hoe" | "sword" | "shears";
export type Material =
  | "stone" | "wood" | "dirt" | "grass" | "sand" | "gravel" | "glass" | "wool"
  | "metal" | "plant" | "leaves" | "snow" | "water" | "lava" | "none";
export type Tint = "none" | "grass" | "foliage" | "birch" | "spruce" | "water";

/** An axis-aligned box inside the block, in sixteenths: [x0, y0, z0, x1, y1, z1]. */
export type Box = readonly [number, number, number, number, number, number];
export const FULL_BOX: Box = [0, 0, 0, 16, 16, 16];

export interface FaceTextures {
  top: string;
  bottom: string;
  side: string;
  /** The face the block looks out of — furnace mouth, pumpkin face. Uses meta facing. */
  front?: string;
}

export interface Drop {
  /** Item name, resolved by the item registry — names, not numbers, so a drop table reads as what it drops. */
  item: string;
  min: number;
  max: number;
  chance?: number;
}

export interface BlockDef {
  id: number;
  name: string;
  displayName: string;
  shape: Shape;
  layer: RenderLayer;
  textures: FaceTextures;
  /** Collides with entities. */
  solid: boolean;
  /** Full opaque cube: hides neighbour faces and blocks light completely. */
  opaque: boolean;
  /** Extra light lost passing through (leaves, water). Opaque blocks stop it entirely. */
  lightFilter: number;
  emission: number;
  /** Seconds-ish, as the original's hardness; -1 cannot be broken. */
  hardness: number;
  tool?: ToolType;
  /** Minimum tool tier to get drops: 0 wood/gold, 1 stone, 2 iron, 3 diamond. */
  harvestTier?: number;
  material: Material;
  /** Placing a block into this cell replaces it (air, tall grass, water). */
  replaceable: boolean;
  gravity: boolean;
  climbable: boolean;
  /** Breaks when the block it rests on is removed. */
  needsSupport: boolean;
  tint: Tint;
  /** Animate in the wind (leaves, grass, flowers). */
  waves: boolean;
  /** Drops when mined with the right tool. Undefined: drops itself. Empty array: drops nothing. */
  drops?: Drop[];
  /** Experience dropped on mining, [min, max]. */
  xp?: [number, number];
  /** Returns the model boxes for a given meta (shape "boxes"). */
  boxes?: (meta: number) => Box[];
  /** Collision boxes; defaults to the model boxes for solid blocks, a full cube for solid cubes. */
  collision?: (meta: number) => Box[];
  /** Places with a horizontal facing taken from the player. */
  facing?: "player" | "away" | "wall";
  /** Has an inventory or a screen. */
  interact?: "crafting" | "furnace" | "chest" | "bed" | "door" | "tnt" | "noteblock" | "redstone"
    | "enchanting" | "anvil" | "brewing" | "cauldron" | "composter" | "bell" | "smithing" | "waystone" | "grave" | "cooking" | "healing"
    /** The county's: a window to open, close, climb or board; a tap or tank to drink from; a stove, television, radio, garage door, generator or gas pump. */
    | "window" | "water" | "stove" | "tv" | "radio" | "garage" | "generator" | "fuel";
  /** Slots, for a block that keeps an inventory (interact "chest"); absent is the chest's 27 or the old per-block sizes. */
  container?: number;
  /** What a county container holds when first opened (engine/countyLoot.ts), before the room it stands in is taken into account. */
  loot?: string;
  flammable?: boolean;
  /** Hidden from the creative inventory (technical blocks). */
  hidden?: boolean;
  /** Friction multiplier for ice. */
  slipperiness?: number;
  /** Walking speed multiplier (soul sand style). */
  speedFactor?: number;
  /**
   * Per-box texture for multi-part models (a repeater's torches are not its
   * base). Returning undefined falls back to faceTexture.
   */
  boxTexture?: (meta: number, box: number, face: number) => string | undefined;
  /** Where a box samples its texture from, when that is not where it sits (a small torch shows the torch's head). */
  boxUV?: (meta: number, box: number) => Box | null;
  /** Quarter turns for a face's texture (rotateUV codes), so a sideways piston's wood faces its head. */
  uvRotation?: (meta: number, face: number) => number;
  /** Six-way facing kept in meta bits 0-2 as a Face index (pistons, observers, dispensers, hoppers). */
  facing6?: boolean;
  /** Its texture is ANIM_FRAMES consecutive atlas layers the shader steps through (portal, fire). */
  animated?: boolean;
}

type Partial2<T> = { [K in keyof T]?: T[K] };

const BLOCKS: BlockDef[] = [];
const BY_NAME = new Map<string, BlockDef>();

function tex(all: string): FaceTextures;
function tex(top: string, side: string, bottom?: string): FaceTextures;
function tex(a: string, b?: string, c?: string): FaceTextures {
  if (b === undefined) return { top: a, bottom: a, side: a };
  return { top: a, side: b, bottom: c ?? a };
}

function add(id: number, name: string, displayName: string, opts: Partial2<BlockDef> = {}): BlockDef {
  if (BLOCKS[id]) throw new Error(`block id ${id} used twice (${BLOCKS[id].name}, ${name})`);
  const shape = opts.shape ?? "cube";
  const def: BlockDef = {
    id,
    name,
    displayName,
    shape,
    layer: opts.layer ?? (shape === "none" ? "none" : "opaque"),
    textures: opts.textures ?? tex(name),
    solid: opts.solid ?? shape !== "none",
    opaque: opts.opaque ?? (shape === "cube" && (opts.layer ?? "opaque") === "opaque"),
    lightFilter: opts.lightFilter ?? 0,
    emission: opts.emission ?? 0,
    hardness: opts.hardness ?? 1,
    material: opts.material ?? "stone",
    replaceable: opts.replaceable ?? false,
    gravity: opts.gravity ?? false,
    climbable: opts.climbable ?? false,
    needsSupport: opts.needsSupport ?? false,
    tint: opts.tint ?? "none",
    waves: opts.waves ?? false,
    ...opts,
  } as BlockDef;
  BLOCKS[id] = def;
  BY_NAME.set(name, def);
  return def;
}

// ---- shape helpers -------------------------------------------------------

const plant = (hardness = 0): Partial2<BlockDef> => ({
  shape: "cross", layer: "cutout", solid: false, opaque: false, hardness, material: "plant",
  replaceable: false, needsSupport: true, waves: true,
});

const slabBoxes = (meta: number): Box[] =>
  meta === 2 ? [FULL_BOX] : meta === 1 ? [[0, 8, 0, 16, 16, 16]] : [[0, 0, 0, 16, 8, 16]];

/** Stairs: meta bits 0-1 facing (the high side), bit 2 upside down. */
export function stairBoxes(meta: number): Box[] {
  const facing = meta & 3;
  const upside = (meta & 4) !== 0;
  const base: Box = upside ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
  const y0 = upside ? 0 : 8, y1 = upside ? 8 : 16;
  const step: Box =
    facing === 0 ? [0, y0, 0, 16, y1, 8] :
    facing === 1 ? [0, y0, 8, 16, y1, 16] :
    facing === 2 ? [0, y0, 0, 8, y1, 16] :
                   [8, y0, 0, 16, y1, 16];
  return [base, step];
}

function panelBox(side: number, thickness: number): Box {
  const t = thickness;
  return side === 0 ? [0, 0, 0, 16, 16, t] :
         side === 1 ? [0, 0, 16 - t, 16, 16, 16] :
         side === 2 ? [0, 0, 0, t, 16, 16] :
                      [16 - t, 0, 0, 16, 16, 16];
}

/** Door meta: bits 0-1 facing, bit 2 open, bit 3 upper half, bit 4 hinge on the right. */
export function doorBoxes(meta: number): Box[] {
  const facing = meta & 3;
  const open = (meta & 4) !== 0;
  const hingeRight = (meta & 16) !== 0;
  let side = facing;
  if (open) {
    side = hingeRight ? CLOCKWISE_FACING[CLOCKWISE_FACING[CLOCKWISE_FACING[facing]]] : CLOCKWISE_FACING[facing];
  }
  return [panelBox(side, 3)];
}

/** Ladder meta: the facing of the wall it hangs on (panel sits against that wall). */
const ladderBoxes = (meta: number): Box[] => [panelBox(meta & 3, 1)];

/**
 * Torch meta: 0 standing, 1..4 on a wall (1 + the facing pointing from the
 * wall out to the torch). The stick sits against that wall, at -facing.
 */
export function torchBoxes(meta: number): Box[] {
  if (meta === 0) return [[7, 0, 7, 9, 10, 9]];
  const f = (meta - 1) & 3;
  const [dx, dz] = FACING_DIRS[f];
  const ox = 7 - dx * 6, oz = 7 - dz * 6;
  return [[ox, 3, oz, ox + 2, 13, oz + 2]];
}

/** Face on the other side: East↔West, Up↔Down, South↔North. */
export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4] as const;
/** The Face a horizontal facing (0 north, 1 south, 2 west, 3 east) points out of. */
export const FACE_OF_FACING = FACING_TO_FACE;
/** The horizontal facing for a horizontal Face, or -1 for up and down. */
export const FACING_OF_FACE = [3, 2, -1, -1, 1, 0] as const;

const norm = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
function boxFrom(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  const [ax, bx] = norm(x0, x1), [ay, by] = norm(y0, y1), [az, bz] = norm(z0, z1);
  return [ax, ay, az, bx, by, bz];
}

/**
 * Moves a box drawn lying on the floor onto the face it hangs from: `attach`
 * is the Face pointing from the part to the block holding it (Down for the
 * floor, Up for a ceiling, a side for a wall). Levers and buttons are drawn
 * once and placed six ways by this.
 */
export function attachBox(b: Box, attach: number): Box {
  const [x0, y0, z0, x1, y1, z1] = b;
  switch (attach) {
    case Face.Up: return boxFrom(x0, 16 - y0, z0, x1, 16 - y1, z1);
    case Face.North: return boxFrom(x0, z0, y0, x1, z1, y1);
    case Face.South: return boxFrom(x0, z0, 16 - y0, x1, z1, 16 - y1);
    case Face.West: return boxFrom(y0, z0, x0, y1, z1, x1);
    case Face.East: return boxFrom(16 - y0, z0, x0, 16 - y1, z1, x1);
    default: return b;
  }
}

/** Turns a box drawn facing up (+y) to face any of the six directions — pistons, observers. */
export function facingBox(b: Box, facing: number): Box {
  const [x0, y0, z0, x1, y1, z1] = b;
  switch (facing) {
    case Face.Down: return boxFrom(x0, 16 - y0, z0, x1, 16 - y1, z1);
    case Face.North: return boxFrom(x0, z0, 16 - y0, x1, z1, 16 - y1);
    case Face.South: return boxFrom(x0, z0, y0, x1, z1, y1);
    case Face.West: return boxFrom(16 - y0, x0, z0, 16 - y1, x1, z1);
    case Face.East: return boxFrom(y0, x0, z0, y1, x1, z1);
    default: return b;
  }
}

/** Turns a box drawn facing north to one of the four horizontal facings — repeaters, comparators. */
export function hFacingBox(b: Box, facing: number): Box {
  const [x0, y0, z0, x1, y1, z1] = b;
  switch (facing) {
    case 1: return boxFrom(16 - x0, y0, 16 - z0, 16 - x1, y1, 16 - z1);
    case 2: return boxFrom(z0, y0, 16 - x0, z1, y1, 16 - x1);
    case 3: return boxFrom(16 - z0, y0, x0, 16 - z1, y1, x1);
    default: return b;
  }
}

/** World direction that texture +u and +v run along on each face, from the mesher's faceUV. */
const FACE_U: ReadonlyArray<readonly [number, number, number]> = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [1, 0, 0], [-1, 0, 0]];
const FACE_V: ReadonlyArray<readonly [number, number, number]> = [[0, -1, 0], [0, -1, 0], [0, 0, 1], [0, 0, 1], [0, -1, 0], [0, -1, 0]];
const same = (a: readonly number[], b: readonly number[], sign: number) => a[0] === b[0] * sign && a[1] === b[1] * sign && a[2] === b[2] * sign;

/**
 * The rotateUV code that makes a face's texture "up" point along a world
 * direction: how a sideways piston keeps its wooden edge toward its head.
 */
export function uvTowards(face: number, dir: readonly [number, number, number]): number {
  if (same(dir, FACE_V[face], -1)) return 0;
  if (same(dir, FACE_V[face], 1)) return 1;
  if (same(dir, FACE_U[face], -1)) return 2;
  if (same(dir, FACE_U[face], 1)) return 3;
  return 0;
}

/** For a six-way block: texture "up" on its side faces points out of its front. */
const sixWayUV = (meta: number, face: number): number => {
  const f = meta & 7;
  if (face === f || face === OPPOSITE_FACE[f]) return 0;
  return uvTowards(face, FACE_DIRS[f]);
};

const LEVER_BASE: Box = [5, 0, 4, 11, 3, 12];
/** Lever meta: bits 0-2 the Face it hangs from, bit 3 on, bit 4 turned 90° (floor and ceiling only). */
export function leverBoxes(meta: number): Box[] {
  const attach = meta & 7, on = (meta & 8) !== 0, turned = (meta & 16) !== 0;
  let handle: Box = on ? [7, 3, 9, 9, 11, 11] : [7, 3, 5, 9, 11, 7];
  let base = LEVER_BASE;
  if (turned) { base = [base[2], base[1], base[0], base[5], base[4], base[3]]; handle = [handle[2], handle[1], handle[0], handle[5], handle[4], handle[3]]; }
  return [attachBox(base, attach), attachBox(handle, attach)];
}

/** Button meta: bits 0-2 the Face it hangs from, bit 3 pressed. */
export function buttonBoxes(meta: number): Box[] {
  return [attachBox((meta & 8) !== 0 ? [5, 0, 6, 11, 1, 10] : [5, 0, 6, 11, 2, 10], meta & 7)];
}

/** Repeater meta: bits 0-1 facing (the way the signal leaves), bits 2-3 delay − 1, bit 4 powered, bit 5 locked. */
export function repeaterBoxes(meta: number): Box[] {
  const f = meta & 3, delay = ((meta >> 2) & 3) + 1;
  const rear = 6 + (delay - 1) * 2;
  const boxes: Box[] = [[0, 0, 0, 16, 2, 16], [7, 2, 2, 9, 7, 4]];
  // A locked repeater shows a bar across instead of its moving torch.
  boxes.push((meta & 32) !== 0 ? [2, 2, rear, 14, 4, rear + 2] : [7, 2, rear, 9, 7, rear + 2]);
  return boxes.map((b) => hFacingBox(b, f));
}

/** Comparator meta: bits 0-1 facing, bit 2 subtract mode, bits 3-6 output strength. */
export function comparatorBoxes(meta: number): Box[] {
  const f = meta & 3;
  const boxes: Box[] = [[0, 0, 0, 16, 2, 16], [7, 2, 2, 9, 5, 4], [3, 2, 11, 5, 7, 13], [11, 2, 11, 13, 7, 13]];
  return boxes.map((b) => hFacingBox(b, f));
}

/** Piston meta: bits 0-2 facing, bit 3 extended. */
export function pistonBoxes(meta: number): Box[] {
  return [facingBox((meta & 8) !== 0 ? [0, 0, 0, 16, 12, 16] : FULL_BOX, meta & 7)];
}

/** Piston head meta: bits 0-2 facing, bit 3 sticky. The arm reaches back into the base. */
export function pistonHeadBoxes(meta: number): Box[] {
  const f = meta & 7;
  return [facingBox([0, 12, 0, 16, 16, 16], f), facingBox([6, -4, 6, 10, 12, 10], f)];
}

/** Hopper meta: bits 0-2 the Face it outputs through (down or a side), bit 3 disabled by power. */
export function hopperBoxes(meta: number): Box[] {
  const out = meta & 7;
  const spout: Box =
    out === Face.North ? [6, 4, 0, 10, 8, 4] :
    out === Face.South ? [6, 4, 12, 10, 8, 16] :
    out === Face.West ? [0, 4, 6, 4, 8, 10] :
    out === Face.East ? [12, 4, 6, 16, 8, 10] :
    [6, 0, 6, 10, 4, 10];
  return [[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], spout];
}

/** Trapdoor meta: bits 0-1 facing (the hinge side), bit 2 open, bit 3 in the top half, bit 5 powered. */
/** An anvil: a foot, a waist and a long top, broadside to whoever placed it (facing in bits 0-1). */
export function anvilBoxes(meta: number): Box[] {
  const alongX = (meta & 3) < 2;
  const boxes: Box[] = [[2, 0, 2, 14, 4, 14], [4, 4, 3, 12, 5, 13], [6, 5, 4, 10, 10, 12], [3, 10, 0, 13, 16, 16]];
  // Drawn with the top running along z; swapping x and z turns it a quarter.
  return alongX ? boxes.map(([x0, y0, z0, x1, y1, z1]) => [z0, y0, x0, z1, y1, x1] as Box) : boxes;
}

/** A brewing stand: three feet, the rod, and a hanging bottle for each filled slot (meta bits 0-2). */
export function brewingStandBoxes(meta: number): Box[] {
  const boxes: Box[] = [[9, 0, 5, 15, 2, 11], [2, 0, 1, 8, 2, 7], [2, 0, 9, 8, 2, 15], [7, 0, 7, 9, 14, 9]];
  const BOTTLES: Box[] = [[11, 2, 6, 15, 9, 10], [3, 2, 2, 7, 9, 6], [3, 2, 10, 7, 9, 14]];
  for (let i = 0; i < 3; i++) if (meta & (1 << i)) boxes.push(BOTTLES[i]);
  return boxes;
}

/**
 * A cauldron: a floor, four walls on four legs, and — box 9 — the water, whose
 * surface rises with the level in meta bits 0-1. The water stops just short of
 * the walls so the two never fight over the same plane.
 */
export function cauldronBoxes(meta: number): Box[] {
  const boxes: Box[] = [
    [2, 3, 2, 14, 4, 14],
    [0, 3, 0, 2, 16, 16], [14, 3, 0, 16, 16, 16], [2, 3, 0, 14, 16, 2], [2, 3, 14, 14, 16, 16],
    [0, 0, 0, 4, 3, 4], [12, 0, 0, 16, 3, 4], [0, 0, 12, 4, 3, 16], [12, 0, 12, 16, 3, 16],
  ];
  const level = meta & 3;
  if (level > 0) boxes.push([2.01, 4, 2.01, 13.99, 6 + level * 3, 13.99]);
  return boxes;
}

export function trapdoorBoxes(meta: number): Box[] {
  if ((meta & 4) !== 0) return [panelBox(meta & 3, 3)];
  return [(meta & 8) !== 0 ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16]];
}

const redstoneTorchBoxes = torchBoxes;
const SMALL_TORCH_UV: Box = [7, 5, 7, 9, 10, 9];

// ---- the list (append-only) ----------------------------------------------

const P = "pickaxe", A = "axe", S = "shovel", H = "hoe";

add(0, "air", "Air", { shape: "none", solid: false, opaque: false, replaceable: true, material: "none", hardness: 0, hidden: true, drops: [] });
add(1, "stone", "Stone", { hardness: 1.5, tool: P, harvestTier: 0, drops: [{ item: "cobblestone", min: 1, max: 1 }] });
add(2, "grass_block", "Grass Block", {
  textures: tex("grass_block_top", "grass_block_side", "dirt"), hardness: 0.6, tool: S, material: "grass",
  tint: "grass", drops: [{ item: "dirt", min: 1, max: 1 }],
});
add(3, "dirt", "Dirt", { hardness: 0.5, tool: S, material: "dirt" });
add(4, "cobblestone", "Cobblestone", { hardness: 2, tool: P, harvestTier: 0 });
add(5, "oak_planks", "Oak Planks", { hardness: 2, tool: A, material: "wood", flammable: true });
add(6, "bedrock", "Bedrock", { hardness: -1, drops: [] });
add(7, "water", "Water", {
  shape: "fluid", layer: "translucent", solid: false, opaque: false, replaceable: true, lightFilter: 2,
  hardness: -1, material: "water", textures: tex("water_still"), tint: "water", drops: [], hidden: true,
});
add(8, "lava", "Lava", {
  shape: "fluid", layer: "opaque", solid: false, opaque: false, replaceable: true, emission: 15,
  hardness: -1, material: "lava", textures: tex("lava_still"), drops: [], hidden: true,
});
add(9, "sand", "Sand", { hardness: 0.5, tool: S, material: "sand", gravity: true });
add(10, "gravel", "Gravel", {
  hardness: 0.6, tool: S, material: "gravel", gravity: true,
  drops: [{ item: "flint", min: 1, max: 1, chance: 0.1 }, { item: "gravel", min: 1, max: 1, chance: 1 }],
});
add(11, "oak_log", "Oak Log", { textures: tex("oak_log_top", "oak_log"), hardness: 2, tool: A, material: "wood", flammable: true });
add(12, "oak_leaves", "Oak Leaves", {
  layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.2, tool: "shears", material: "leaves",
  tint: "foliage", waves: true, flammable: true,
  drops: [{ item: "oak_sapling", min: 1, max: 1, chance: 0.05 }, { item: "apple", min: 1, max: 1, chance: 0.02 }, { item: "stick", min: 1, max: 2, chance: 0.04 }],
});
add(13, "glass", "Glass", { layer: "cutout", opaque: false, hardness: 0.3, material: "glass", drops: [] });
add(14, "coal_ore", "Coal Ore", { hardness: 3, tool: P, harvestTier: 0, drops: [{ item: "coal", min: 1, max: 1 }], xp: [0, 2] });
add(15, "iron_ore", "Iron Ore", { hardness: 3, tool: P, harvestTier: 1, drops: [{ item: "raw_iron", min: 1, max: 1 }] });
add(16, "gold_ore", "Gold Ore", { hardness: 3, tool: P, harvestTier: 2, drops: [{ item: "raw_gold", min: 1, max: 1 }] });
add(17, "diamond_ore", "Diamond Ore", { hardness: 3, tool: P, harvestTier: 2, drops: [{ item: "diamond", min: 1, max: 1 }], xp: [3, 7] });
add(18, "redstone_ore", "Redstone Ore", { hardness: 3, tool: P, harvestTier: 2, drops: [{ item: "redstone", min: 4, max: 5 }], xp: [1, 5] });
add(19, "lapis_ore", "Lapis Lazuli Ore", { hardness: 3, tool: P, harvestTier: 1, drops: [{ item: "lapis_lazuli", min: 4, max: 9 }], xp: [2, 5] });
add(20, "emerald_ore", "Emerald Ore", { hardness: 3, tool: P, harvestTier: 2, drops: [{ item: "emerald", min: 1, max: 1 }], xp: [3, 7] });
add(21, "copper_ore", "Copper Ore", { hardness: 3, tool: P, harvestTier: 1, drops: [{ item: "raw_copper", min: 2, max: 5 }] });
add(22, "deepslate", "Deepslate", { textures: tex("deepslate_top", "deepslate"), hardness: 3, tool: P, harvestTier: 0, drops: [{ item: "cobbled_deepslate", min: 1, max: 1 }] });
add(23, "cobbled_deepslate", "Cobbled Deepslate", { hardness: 3.5, tool: P, harvestTier: 0 });
add(24, "deepslate_iron_ore", "Deepslate Iron Ore", { hardness: 4.5, tool: P, harvestTier: 1, drops: [{ item: "raw_iron", min: 1, max: 1 }] });
add(25, "deepslate_gold_ore", "Deepslate Gold Ore", { hardness: 4.5, tool: P, harvestTier: 2, drops: [{ item: "raw_gold", min: 1, max: 1 }] });
add(26, "deepslate_diamond_ore", "Deepslate Diamond Ore", { hardness: 4.5, tool: P, harvestTier: 2, drops: [{ item: "diamond", min: 1, max: 1 }], xp: [3, 7] });
add(27, "deepslate_redstone_ore", "Deepslate Redstone Ore", { hardness: 4.5, tool: P, harvestTier: 2, drops: [{ item: "redstone", min: 4, max: 5 }], xp: [1, 5] });
add(28, "deepslate_lapis_ore", "Deepslate Lapis Ore", { hardness: 4.5, tool: P, harvestTier: 1, drops: [{ item: "lapis_lazuli", min: 4, max: 9 }], xp: [2, 5] });
add(29, "deepslate_coal_ore", "Deepslate Coal Ore", { hardness: 4.5, tool: P, harvestTier: 0, drops: [{ item: "coal", min: 1, max: 1 }], xp: [0, 2] });

add(30, "birch_log", "Birch Log", { textures: tex("birch_log_top", "birch_log"), hardness: 2, tool: A, material: "wood", flammable: true });
add(31, "birch_leaves", "Birch Leaves", {
  layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.2, tool: "shears", material: "leaves", tint: "birch", waves: true,
  drops: [{ item: "birch_sapling", min: 1, max: 1, chance: 0.05 }, { item: "stick", min: 1, max: 2, chance: 0.04 }],
});
add(32, "birch_planks", "Birch Planks", { hardness: 2, tool: A, material: "wood", flammable: true });
add(33, "spruce_log", "Spruce Log", { textures: tex("spruce_log_top", "spruce_log"), hardness: 2, tool: A, material: "wood", flammable: true });
add(34, "spruce_leaves", "Spruce Leaves", {
  layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.2, tool: "shears", material: "leaves", tint: "spruce", waves: true,
  drops: [{ item: "spruce_sapling", min: 1, max: 1, chance: 0.05 }, { item: "stick", min: 1, max: 2, chance: 0.04 }],
});
add(35, "spruce_planks", "Spruce Planks", { hardness: 2, tool: A, material: "wood", flammable: true });
add(36, "jungle_log", "Jungle Log", { textures: tex("jungle_log_top", "jungle_log"), hardness: 2, tool: A, material: "wood", flammable: true });
add(37, "jungle_leaves", "Jungle Leaves", {
  layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.2, tool: "shears", material: "leaves", tint: "foliage", waves: true,
  drops: [{ item: "jungle_sapling", min: 1, max: 1, chance: 0.025 }, { item: "stick", min: 1, max: 2, chance: 0.04 }],
});
add(38, "jungle_planks", "Jungle Planks", { hardness: 2, tool: A, material: "wood", flammable: true });
add(39, "acacia_log", "Acacia Log", { textures: tex("acacia_log_top", "acacia_log"), hardness: 2, tool: A, material: "wood", flammable: true });
add(40, "acacia_leaves", "Acacia Leaves", {
  layer: "cutout", opaque: false, lightFilter: 1, hardness: 0.2, tool: "shears", material: "leaves", tint: "foliage", waves: true,
  drops: [{ item: "acacia_sapling", min: 1, max: 1, chance: 0.05 }, { item: "stick", min: 1, max: 2, chance: 0.04 }],
});
add(41, "acacia_planks", "Acacia Planks", { hardness: 2, tool: A, material: "wood", flammable: true });

add(42, "sandstone", "Sandstone", { textures: tex("sandstone_top", "sandstone", "sandstone_bottom"), hardness: 0.8, tool: P, harvestTier: 0 });
add(43, "red_sand", "Red Sand", { hardness: 0.5, tool: S, material: "sand", gravity: true });
add(44, "terracotta", "Terracotta", { hardness: 1.25, tool: P, harvestTier: 0 });
add(45, "orange_terracotta", "Orange Terracotta", { hardness: 1.25, tool: P, harvestTier: 0 });
add(46, "yellow_terracotta", "Yellow Terracotta", { hardness: 1.25, tool: P, harvestTier: 0 });
add(47, "red_terracotta", "Red Terracotta", { hardness: 1.25, tool: P, harvestTier: 0 });
add(48, "brown_terracotta", "Brown Terracotta", { hardness: 1.25, tool: P, harvestTier: 0 });
add(49, "white_terracotta", "White Terracotta", { hardness: 1.25, tool: P, harvestTier: 0 });
add(50, "snow_block", "Snow Block", { textures: tex("snow"), hardness: 0.2, tool: S, material: "snow", drops: [{ item: "snowball", min: 4, max: 4 }] });
add(51, "snow", "Snow", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 2, 16]], collision: () => [],
  hardness: 0.1, tool: S, material: "snow", replaceable: true, needsSupport: true, textures: tex("snow"),
  drops: [{ item: "snowball", min: 1, max: 1 }],
});
add(52, "ice", "Ice", { layer: "translucent", opaque: false, lightFilter: 2, hardness: 0.5, tool: P, material: "glass", drops: [], slipperiness: 0.98 });

add(53, "oak_sapling", "Oak Sapling", plant());
add(54, "birch_sapling", "Birch Sapling", plant());
add(55, "spruce_sapling", "Spruce Sapling", plant());
add(56, "jungle_sapling", "Jungle Sapling", plant());
add(57, "acacia_sapling", "Acacia Sapling", plant());

add(58, "short_grass", "Grass", { ...plant(), replaceable: true, tint: "grass", drops: [{ item: "wheat_seeds", min: 1, max: 1, chance: 0.125 }] });
add(59, "fern", "Fern", { ...plant(), replaceable: true, tint: "grass", drops: [{ item: "wheat_seeds", min: 1, max: 1, chance: 0.125 }] });
add(60, "dead_bush", "Dead Bush", { ...plant(), replaceable: true, waves: false, drops: [{ item: "stick", min: 0, max: 2 }] });
add(61, "dandelion", "Dandelion", plant());
add(62, "poppy", "Poppy", plant());
add(63, "blue_orchid", "Blue Orchid", plant());
add(64, "allium", "Allium", plant());
add(65, "cornflower", "Cornflower", plant());
add(66, "oxeye_daisy", "Oxeye Daisy", plant());
add(67, "red_tulip", "Red Tulip", plant());
add(68, "lily_of_the_valley", "Lily of the Valley", plant());
add(69, "brown_mushroom", "Brown Mushroom", { ...plant(), waves: false, emission: 1 });
add(70, "red_mushroom", "Red Mushroom", { ...plant(), waves: false });
add(71, "sugar_cane", "Sugar Cane", { ...plant(), waves: false, tint: "grass" });
add(72, "cactus", "Cactus", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[1, 0, 1, 15, 16, 15]],
  collision: () => [[1, 0, 1, 15, 15, 15]],
  textures: tex("cactus_top", "cactus_side", "cactus_bottom"), hardness: 0.4, material: "wool", needsSupport: true,
});

add(73, "clay", "Clay", { hardness: 0.6, tool: S, material: "dirt", drops: [{ item: "clay_ball", min: 4, max: 4 }] });
add(74, "granite", "Granite", { hardness: 1.5, tool: P, harvestTier: 0 });
add(75, "diorite", "Diorite", { hardness: 1.5, tool: P, harvestTier: 0 });
add(76, "andesite", "Andesite", { hardness: 1.5, tool: P, harvestTier: 0 });
add(77, "mossy_cobblestone", "Mossy Cobblestone", { hardness: 2, tool: P, harvestTier: 0 });
add(78, "stone_bricks", "Stone Bricks", { hardness: 1.5, tool: P, harvestTier: 0 });
add(79, "mossy_stone_bricks", "Mossy Stone Bricks", { hardness: 1.5, tool: P, harvestTier: 0 });
add(80, "bricks", "Bricks", { hardness: 2, tool: P, harvestTier: 0 });
add(81, "obsidian", "Obsidian", { hardness: 50, tool: P, harvestTier: 3 });
add(82, "crafting_table", "Crafting Table", {
  textures: { top: "crafting_table_top", side: "crafting_table_side", bottom: "oak_planks", front: "crafting_table_front" },
  hardness: 2.5, tool: A, material: "wood", interact: "crafting", facing: "player",
});
add(83, "furnace", "Furnace", {
  textures: { top: "furnace_top", side: "furnace_side", bottom: "furnace_top", front: "furnace_front" },
  hardness: 3.5, tool: P, harvestTier: 0, interact: "furnace", facing: "player",
});
add(84, "lit_furnace", "Furnace", {
  textures: { top: "furnace_top", side: "furnace_side", bottom: "furnace_top", front: "furnace_front_on" },
  hardness: 3.5, tool: P, harvestTier: 0, interact: "furnace", facing: "player", emission: 13,
  drops: [{ item: "furnace", min: 1, max: 1 }], hidden: true,
});
add(85, "chest", "Chest", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[1, 0, 1, 15, 14, 15]],
  textures: { top: "chest_top", side: "chest_side", bottom: "chest_top", front: "chest_front" },
  hardness: 2.5, tool: A, material: "wood", interact: "chest", facing: "player",
});
add(86, "torch", "Torch", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: torchBoxes, collision: () => [],
  textures: tex("torch"), emission: 14, hardness: 0, material: "wood", needsSupport: true, facing: "wall",
});
add(87, "tnt", "TNT", { textures: tex("tnt_top", "tnt_side", "tnt_bottom"), hardness: 0, material: "grass", interact: "tnt" });
add(88, "bookshelf", "Bookshelf", {
  textures: tex("oak_planks", "bookshelf", "oak_planks"), hardness: 1.5, tool: A, material: "wood",
  drops: [{ item: "book", min: 3, max: 3 }],
});
add(89, "glowstone", "Glowstone", { hardness: 0.3, material: "glass", emission: 15, drops: [{ item: "glowstone_dust", min: 2, max: 4 }] });
add(90, "iron_block", "Block of Iron", { hardness: 5, tool: P, harvestTier: 1, material: "metal" });
add(91, "gold_block", "Block of Gold", { hardness: 3, tool: P, harvestTier: 2, material: "metal" });
add(92, "diamond_block", "Block of Diamond", { hardness: 5, tool: P, harvestTier: 2, material: "metal" });
add(93, "emerald_block", "Block of Emerald", { hardness: 5, tool: P, harvestTier: 2, material: "metal" });
add(94, "coal_block", "Block of Coal", { hardness: 5, tool: P, harvestTier: 0 });
add(95, "lapis_block", "Block of Lapis Lazuli", { hardness: 3, tool: P, harvestTier: 1 });
add(96, "redstone_block", "Block of Redstone", { hardness: 5, tool: P, harvestTier: 0, material: "metal" });
add(97, "copper_block", "Block of Copper", { hardness: 3, tool: P, harvestTier: 1, material: "metal" });

export const WOOL_COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;
const WOOL_BASE = 98;
WOOL_COLORS.forEach((color, i) => {
  const title = color.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  add(WOOL_BASE + i, `${color}_wool`, `${title} Wool`, { hardness: 0.8, tool: "shears", material: "wool", flammable: true });
});
// 98..113 are wool.

add(114, "pumpkin", "Pumpkin", { textures: tex("pumpkin_top", "pumpkin_side"), hardness: 1, tool: A, material: "wood" });
add(115, "carved_pumpkin", "Carved Pumpkin", {
  textures: { top: "pumpkin_top", side: "pumpkin_side", bottom: "pumpkin_top", front: "carved_pumpkin" },
  hardness: 1, tool: A, material: "wood", facing: "player",
});
add(116, "jack_o_lantern", "Jack o'Lantern", {
  textures: { top: "pumpkin_top", side: "pumpkin_side", bottom: "pumpkin_top", front: "jack_o_lantern" },
  hardness: 1, tool: A, material: "wood", facing: "player", emission: 15,
});
add(117, "melon", "Melon", { textures: tex("melon_top", "melon_side"), hardness: 1, tool: A, material: "wood", drops: [{ item: "melon_slice", min: 3, max: 7 }] });
add(118, "farmland", "Farmland", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 15, 16]],
  textures: tex("farmland", "dirt"), hardness: 0.6, tool: S, material: "dirt", drops: [{ item: "dirt", min: 1, max: 1 }],
});
add(119, "dirt_path", "Dirt Path", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 15, 16]],
  textures: tex("dirt_path_top", "dirt_path_side", "dirt"), hardness: 0.65, tool: S, material: "grass",
  drops: [{ item: "dirt", min: 1, max: 1 }],
});
add(120, "wheat", "Wheat Crops", {
  shape: "crop", layer: "cutout", solid: false, opaque: false, hardness: 0, material: "plant", needsSupport: true,
  textures: tex("wheat_stage_7"), hidden: true, waves: true,
});
add(121, "carrots", "Carrots", {
  shape: "crop", layer: "cutout", solid: false, opaque: false, hardness: 0, material: "plant", needsSupport: true,
  textures: tex("carrots_stage_3"), hidden: true, waves: true,
});
add(122, "potatoes", "Potatoes", {
  shape: "crop", layer: "cutout", solid: false, opaque: false, hardness: 0, material: "plant", needsSupport: true,
  textures: tex("potatoes_stage_3"), hidden: true, waves: true,
});
add(123, "oak_door", "Oak Door", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: doorBoxes,
  textures: tex("oak_door_top"), hardness: 3, tool: A, material: "wood", interact: "door", hidden: true,
  drops: [{ item: "oak_door", min: 1, max: 1 }],
});
add(124, "ladder", "Ladder", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: ladderBoxes, climbable: true,
  textures: tex("ladder"), hardness: 0.4, tool: A, material: "wood", facing: "wall",
});
add(125, "red_bed", "Red Bed", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 9, 16]],
  textures: { top: "bed_foot_top", side: "bed_side", bottom: "oak_planks" },
  hardness: 0.2, material: "wool", interact: "bed", hidden: true, drops: [{ item: "red_bed", min: 1, max: 1 }],
});
add(126, "oak_slab", "Oak Slab", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: slabBoxes, textures: tex("oak_planks"),
  hardness: 2, tool: A, material: "wood",
});
add(127, "cobblestone_slab", "Cobblestone Slab", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: slabBoxes, textures: tex("cobblestone"),
  hardness: 2, tool: P, harvestTier: 0,
});
add(128, "stone_slab", "Stone Slab", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: slabBoxes, textures: tex("stone"),
  hardness: 2, tool: P, harvestTier: 0,
});
add(129, "stone_brick_slab", "Stone Brick Slab", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: slabBoxes, textures: tex("stone_bricks"),
  hardness: 2, tool: P, harvestTier: 0,
});
add(130, "oak_stairs", "Oak Stairs", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: stairBoxes, textures: tex("oak_planks"),
  hardness: 2, tool: A, material: "wood", facing: "away",
});
add(131, "cobblestone_stairs", "Cobblestone Stairs", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: stairBoxes, textures: tex("cobblestone"),
  hardness: 2, tool: P, harvestTier: 0, facing: "away",
});
add(132, "stone_brick_stairs", "Stone Brick Stairs", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: stairBoxes, textures: tex("stone_bricks"),
  hardness: 1.5, tool: P, harvestTier: 0, facing: "away",
});
add(133, "lantern", "Lantern", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]],
  textures: tex("lantern"), emission: 15, hardness: 3.5, tool: P, material: "metal", needsSupport: true,
});
add(134, "hay_block", "Hay Bale", { textures: tex("hay_block_top", "hay_block_side"), hardness: 0.5, tool: H, material: "grass" });
add(135, "lily_pad", "Lily Pad", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[0, 0, 0, 16, 1, 16]], collision: () => [[1, 0, 1, 15, 1, 15]],
  textures: tex("lily_pad"), hardness: 0, material: "plant", tint: "foliage", needsSupport: true,
});
add(136, "smooth_stone", "Smooth Stone", { textures: tex("smooth_stone"), hardness: 2, tool: P, harvestTier: 0 });
add(137, "sea_lantern", "Sea Lantern", { hardness: 0.3, material: "glass", emission: 15 });
add(138, "packed_ice", "Packed Ice", { hardness: 0.5, tool: P, material: "glass", drops: [], slipperiness: 0.98 });
add(139, "podzol", "Podzol", { textures: tex("podzol_top", "podzol_side", "dirt"), hardness: 0.5, tool: S, material: "dirt", drops: [{ item: "dirt", min: 1, max: 1 }] });
add(140, "coarse_dirt", "Coarse Dirt", { hardness: 0.5, tool: S, material: "dirt" });
add(141, "mud", "Mud", { hardness: 0.5, tool: S, material: "dirt", speedFactor: 0.8 });
add(142, "moss_block", "Moss Block", { hardness: 0.1, tool: H, material: "grass" });
add(143, "amethyst_block", "Block of Amethyst", { hardness: 1.5, tool: P, material: "glass" });
add(144, "cobweb", "Cobweb", {
  shape: "cross", layer: "cutout", solid: false, opaque: false, lightFilter: 1, hardness: 4, tool: "sword",
  material: "wool", speedFactor: 0.25, drops: [{ item: "string", min: 1, max: 1 }],
});
add(145, "oak_fence", "Oak Fence", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[6, 0, 6, 10, 16, 10]],
  collision: () => [[6, 0, 6, 10, 24, 10]], textures: tex("oak_planks"), hardness: 2, tool: A, material: "wood",
});
add(146, "glass_pane", "Glass Pane", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[7, 0, 0, 9, 16, 16], [0, 0, 7, 16, 16, 9]],
  textures: tex("glass"), hardness: 0.3, material: "glass", drops: [],
});
add(147, "note_block", "Note Block", { hardness: 0.8, tool: A, material: "wood", interact: "noteblock" });
add(148, "calcite", "Calcite", { hardness: 0.75, tool: P, harvestTier: 0 });
add(149, "tuff", "Tuff", { hardness: 1.5, tool: P, harvestTier: 0 });
add(150, "polished_granite", "Polished Granite", { hardness: 1.5, tool: P, harvestTier: 0 });
add(151, "polished_diorite", "Polished Diorite", { hardness: 1.5, tool: P, harvestTier: 0 });
add(152, "polished_andesite", "Polished Andesite", { hardness: 1.5, tool: P, harvestTier: 0 });
add(153, "chiseled_stone_bricks", "Chiseled Stone Bricks", { hardness: 1.5, tool: P, harvestTier: 0 });
add(154, "cracked_stone_bricks", "Cracked Stone Bricks", { hardness: 1.5, tool: P, harvestTier: 0 });

// ---- redstone (155-178) ----
add(155, "redstone_wire", "Redstone Dust", {
  shape: "wire", layer: "cutout", solid: false, opaque: false, hardness: 0, material: "none", needsSupport: true,
  boxes: () => [[0, 0, 0, 16, 1, 16]], collision: () => [],
  textures: tex("redstone_dust_line"), hidden: true, drops: [{ item: "redstone", min: 1, max: 1 }],
});
add(156, "redstone_torch", "Redstone Torch", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: redstoneTorchBoxes, collision: () => [],
  textures: tex("redstone_torch"), emission: 7, hardness: 0, material: "wood", needsSupport: true, facing: "wall",
});
add(157, "redstone_torch_off", "Redstone Torch", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: redstoneTorchBoxes, collision: () => [],
  textures: tex("redstone_torch_off"), hardness: 0, material: "wood", needsSupport: true, facing: "wall", hidden: true,
  drops: [{ item: "redstone_torch", min: 1, max: 1 }],
});
add(158, "lever", "Lever", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: leverBoxes, collision: () => [],
  textures: tex("cobblestone"), boxTexture: (_m, box) => (box === 1 ? "lever" : undefined),
  hardness: 0.5, material: "wood", needsSupport: true, interact: "redstone",
});
add(159, "stone_button", "Stone Button", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: buttonBoxes, collision: () => [],
  textures: tex("stone"), hardness: 0.5, material: "stone", needsSupport: true, interact: "redstone",
});
add(160, "oak_button", "Oak Button", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: buttonBoxes, collision: () => [],
  textures: tex("oak_planks"), hardness: 0.5, material: "wood", needsSupport: true, interact: "redstone",
});
add(161, "stone_pressure_plate", "Stone Pressure Plate", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: () => [[1, 0, 1, 15, 1, 15]], collision: () => [],
  textures: tex("stone"), hardness: 0.5, tool: P, harvestTier: 0, needsSupport: true,
});
add(162, "oak_pressure_plate", "Oak Pressure Plate", {
  shape: "boxes", layer: "cutout", solid: false, opaque: false, boxes: () => [[1, 0, 1, 15, 1, 15]], collision: () => [],
  textures: tex("oak_planks"), hardness: 0.5, tool: A, material: "wood", needsSupport: true,
});
add(163, "redstone_lamp", "Redstone Lamp", { hardness: 0.3, material: "glass" });
add(164, "redstone_lamp_on", "Redstone Lamp", { hardness: 0.3, material: "glass", emission: 15, hidden: true, drops: [{ item: "redstone_lamp", min: 1, max: 1 }] });
add(165, "repeater", "Redstone Repeater", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: repeaterBoxes, collision: () => [[0, 0, 0, 16, 2, 16]],
  textures: tex("repeater", "smooth_stone"), hardness: 0, material: "stone", needsSupport: true, facing: "away", interact: "redstone",
  boxTexture: (m, box, face) => (box === 0 ? (face === Face.Up ? ((m & 16) !== 0 ? "repeater_on" : "repeater") : "smooth_stone")
    : box === 2 && (m & 32) !== 0 ? "bedrock" : (m & 16) !== 0 ? "redstone_torch" : "redstone_torch_off"),
  boxUV: (m, box) => (box === 0 || (box === 2 && (m & 32) !== 0) ? null : SMALL_TORCH_UV),
  uvRotation: (m, face) => (face === Face.Up ? m & 3 : 0),
});
add(166, "comparator", "Redstone Comparator", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: comparatorBoxes, collision: () => [[0, 0, 0, 16, 2, 16]],
  textures: tex("comparator", "smooth_stone"), hardness: 0, material: "stone", needsSupport: true, facing: "away", interact: "redstone",
  boxTexture: (m, box, face) => (box === 0 ? (face === Face.Up ? ((m & 0x78) !== 0 ? "comparator_on" : "comparator") : "smooth_stone")
    : box === 1 ? ((m & 4) !== 0 ? "redstone_torch" : "redstone_torch_off") : (m & 0x78) !== 0 ? "redstone_torch" : "redstone_torch_off"),
  boxUV: (_m, box) => (box === 0 ? null : SMALL_TORCH_UV),
  uvRotation: (m, face) => (face === Face.Up ? m & 3 : 0),
});
const pistonTex = (sticky: boolean) => (m: number, _box: number, face: number): string | undefined => {
  const f = m & 7;
  if (face === f) return (m & 8) !== 0 ? "piston_inner" : sticky ? "piston_top_sticky" : "piston_top";
  if (face === OPPOSITE_FACE[f]) return "piston_bottom";
  return "piston_side";
};
add(167, "piston", "Piston", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: pistonBoxes, facing6: true, textures: tex("piston_side"),
  boxTexture: pistonTex(false), uvRotation: sixWayUV, hardness: 1.5, tool: P, material: "stone",
});
add(168, "sticky_piston", "Sticky Piston", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: pistonBoxes, facing6: true, textures: tex("piston_side"),
  boxTexture: pistonTex(true), uvRotation: sixWayUV, hardness: 1.5, tool: P, material: "stone",
});
add(169, "piston_head", "Piston Head", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: pistonHeadBoxes, facing6: true, textures: tex("piston_side"),
  boxTexture: (m, box, face) => {
    const f = m & 7;
    if (box === 1) return "piston_arm";
    if (face === f) return (m & 8) !== 0 ? "piston_top_sticky" : "piston_top";
    if (face === OPPOSITE_FACE[f]) return "piston_top";
    return "piston_head_side";
  },
  uvRotation: sixWayUV, hardness: 1.5, material: "stone", hidden: true, drops: [],
});
add(170, "observer", "Observer", {
  facing6: true, textures: tex("observer_side"), hardness: 3, tool: P, harvestTier: 0, uvRotation: sixWayUV,
  boxTexture: (m, _box, face) => {
    const f = m & 7;
    if (face === f) return "observer_front";
    if (face === OPPOSITE_FACE[f]) return (m & 8) !== 0 ? "observer_back_on" : "observer_back";
    return "observer_side";
  },
});
add(171, "daylight_detector", "Daylight Detector", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 6, 16]],
  textures: tex("daylight_detector_top", "daylight_detector_side"), hardness: 0.2, tool: A, material: "wood", interact: "redstone",
  boxTexture: (m, _b, face) => (face === Face.Up && (m & 16) !== 0 ? "daylight_detector_inverted_top" : undefined),
});
add(172, "hopper", "Hopper", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: hopperBoxes, collision: () => [FULL_BOX], facing6: true,
  textures: tex("hopper_top", "hopper_outside", "hopper_outside"), hardness: 3, tool: P, harvestTier: 0, material: "metal",
  interact: "chest",
});
const dispenserTex = (front: string) => (m: number, _b: number, face: number): string | undefined => {
  const f = m & 7;
  if (face === f) return f === Face.Up || f === Face.Down ? `${front}_vertical` : front;
  if (face === Face.Up || face === Face.Down) return "furnace_top";
  return "furnace_side";
};
add(173, "dispenser", "Dispenser", {
  facing6: true, textures: tex("furnace_side"), boxTexture: dispenserTex("dispenser_front"),
  hardness: 3.5, tool: P, harvestTier: 0, interact: "chest",
});
add(174, "dropper", "Dropper", {
  facing6: true, textures: tex("furnace_side"), boxTexture: dispenserTex("dropper_front"),
  hardness: 3.5, tool: P, harvestTier: 0, interact: "chest",
});
add(175, "iron_door", "Iron Door", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: doorBoxes,
  textures: tex("iron_door_top"), hardness: 5, tool: P, harvestTier: 0, material: "metal", hidden: true,
  drops: [{ item: "iron_door", min: 1, max: 1 }],
});
add(176, "oak_trapdoor", "Oak Trapdoor", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: trapdoorBoxes, textures: tex("oak_trapdoor"),
  hardness: 3, tool: A, material: "wood", interact: "door",
});
add(177, "iron_trapdoor", "Iron Trapdoor", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: trapdoorBoxes, textures: tex("iron_trapdoor"),
  hardness: 5, tool: P, harvestTier: 0, material: "metal",
});
add(178, "slime_block", "Slime Block", {
  layer: "translucent", opaque: false, lightFilter: 1, hardness: 0, material: "wool", slipperiness: 0.8,
});

// ---- enchanting and brewing (179+) -----------------------------------------------------

add(179, "enchanting_table", "Enchanting Table", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[0, 0, 0, 16, 12, 16], [4, 13, 5, 12, 14, 11]],
  collision: () => [[0, 0, 0, 16, 12, 16]],
  textures: tex("enchanting_table_top", "enchanting_table_side", "obsidian"), hardness: 5, tool: P, harvestTier: 0,
  emission: 7, interact: "enchanting",
  // The open book resting above the table (the original's floats and turns; this one rests).
  boxTexture: (_m, box, face) => (box === 1 ? (face === Face.Up ? "enchanting_book" : "enchanting_book_edge") : undefined),
});
const anvil = (id: number, name: string, displayName: string, top: string) => add(id, name, displayName, {
  shape: "boxes", layer: "cutout", opaque: false, boxes: anvilBoxes, facing: "player", gravity: true,
  textures: tex(top, "anvil", "anvil"), hardness: 5, tool: P, harvestTier: 0, material: "metal", interact: "anvil",
  boxTexture: (_m, box, face) => (box === 3 && face === Face.Up ? top : "anvil"),
  uvRotation: (m, face) => (face === Face.Up && (m & 3) >= 2 ? 1 : 0),
});
anvil(180, "anvil", "Anvil", "anvil_top");
anvil(181, "chipped_anvil", "Chipped Anvil", "anvil_top_chipped");
anvil(182, "damaged_anvil", "Damaged Anvil", "anvil_top_damaged");
add(183, "brewing_stand", "Brewing Stand", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: brewingStandBoxes, collision: () => [[1, 0, 1, 15, 2, 15], [7, 0, 7, 9, 14, 9]],
  textures: tex("brewing_stand_base"), hardness: 0.5, tool: P, harvestTier: 0, material: "metal", emission: 1, interact: "brewing",
  boxTexture: (_m, box) => (box <= 2 ? "brewing_stand_base" : box === 3 ? "brewing_stand_rod" : "brewing_bottle"),
});
// ---- rails (185+) --------------------------------------------------------------------------

/** A rail's thin collision and selection box; a slope is a half-height wedge approximated as a slab. */
const railBoxes = (meta: number, curves: boolean): Box[] => {
  const shape = curves ? meta & 15 : meta & 7;
  return shape >= 2 && shape <= 5 ? [[0, 0, 0, 16, 8, 16]] : [[0, 0, 0, 16, 2, 16]];
};
const rail = (id: number, name: string, displayName: string, tex: (m: number) => string, curves: boolean) => add(id, name, displayName, {
  shape: "rail", layer: "cutout", opaque: false, solid: false, textures: { top: tex(0), side: tex(0), bottom: tex(0) },
  boxes: (m) => railBoxes(m, curves), collision: () => [], hardness: 0.7, tool: P, material: "metal", needsSupport: true,
  boxTexture: (m) => tex(m),
});
rail(185, "rail", "Rail", (m) => ((m & 15) >= 6 ? "rail_corner" : "rail"), true);
rail(186, "powered_rail", "Powered Rail", (m) => ((m & 8) !== 0 ? "powered_rail_on" : "powered_rail"), false);
rail(187, "detector_rail", "Detector Rail", (m) => ((m & 8) !== 0 ? "detector_rail_on" : "detector_rail"), false);
rail(188, "activator_rail", "Activator Rail", (m) => ((m & 8) !== 0 ? "activator_rail_on" : "activator_rail"), false);

// ---- village job sites (189+) ------------------------------------------------------------

/** A composter: a wooden tub whose compost (box 5) rises with the level in meta, 0-7, and 8 when ready. */
export function composterBoxes(meta: number): Box[] {
  const boxes: Box[] = [[2, 0, 2, 14, 2, 14], [0, 0, 0, 2, 16, 16], [14, 0, 0, 16, 16, 16], [2, 0, 0, 14, 16, 2], [2, 0, 14, 14, 16, 16]];
  const level = Math.min(8, meta & 15);
  if (level > 0) boxes.push([2.01, 2, 2.01, 13.99, level >= 8 ? 15 : 2 + level * 1.75, 13.99]);
  return boxes;
}
add(189, "composter", "Composter", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: composterBoxes, collision: () => composterBoxes(0),
  textures: tex("composter_top", "composter_side", "composter_bottom"), hardness: 0.6, tool: A, material: "wood",
  interact: "composter", flammable: true,
  boxTexture: (m, box, face) => (box === 5 ? ((m & 15) >= 8 ? "compost_ready" : "compost") : box === 0 && face === Face.Up ? "composter_bottom" : undefined),
});
add(190, "lectern", "Lectern", {
  shape: "boxes", layer: "cutout", opaque: false, facing: "player",
  boxes: (m) => ([[0, 0, 0, 16, 2, 16], [4, 2, 4, 12, 13, 12], [0, 13, 0, 16, 15, 16]] as Box[]).map((b) => hFacingBox(b, m & 3)),
  textures: tex("lectern_top", "lectern_side", "oak_planks"), hardness: 2.5, tool: A, material: "wood", flammable: true,
});
add(191, "smoker", "Smoker", {
  facing: "player", textures: { top: "smoker_top", bottom: "smoker_bottom", side: "smoker_side", front: "smoker_front" },
  hardness: 3.5, tool: P, harvestTier: 0,
});
add(192, "barrel", "Barrel", {
  facing6: true, textures: tex("barrel_side"), hardness: 2.5, tool: A, material: "wood", interact: "chest", flammable: true,
  boxTexture: (m, _b, face) => (face === (m & 7) ? "barrel_top" : face === OPPOSITE_FACE[m & 7] ? "barrel_bottom" : "barrel_side"),
  uvRotation: sixWayUV,
});
add(193, "fletching_table", "Fletching Table", {
  facing: "player", textures: { top: "fletching_table_top", bottom: "oak_planks", side: "fletching_table_side", front: "fletching_table_front" },
  hardness: 2.5, tool: A, material: "wood", flammable: true,
});
add(194, "loom", "Loom", {
  facing: "player", textures: { top: "loom_top", bottom: "loom_bottom", side: "loom_side", front: "loom_front" },
  hardness: 2.5, tool: A, material: "wood", flammable: true,
});
add(195, "stonecutter", "Stonecutter", {
  shape: "boxes", layer: "cutout", opaque: false, facing: "player",
  boxes: (m) => [[0, 0, 0, 16, 9, 16] as Box, hFacingBox([1, 9, 7.5, 15, 16, 8.5], m & 3)],
  textures: tex("stonecutter_top", "stonecutter_side", "stonecutter_bottom"), hardness: 3.5, tool: P, harvestTier: 0,
  boxTexture: (_m, box) => (box === 1 ? "stonecutter_saw" : undefined),
});
add(196, "smithing_table", "Smithing Table", {
  facing: "player", textures: { top: "smithing_table_top", bottom: "smithing_table_bottom", side: "smithing_table_side", front: "smithing_table_front" },
  hardness: 2.5, tool: A, material: "wood", flammable: true, interact: "smithing",
});
add(197, "bell", "Bell", {
  shape: "boxes", layer: "cutout", opaque: false, facing: "player", interact: "bell",
  // Two stone posts and a beam across, the bell hanging from it (posts along the player's view).
  boxes: (m) => ([[0, 0, 6, 2, 16, 10], [14, 0, 6, 16, 16, 10], [2, 13, 7, 14, 15, 9], [5, 6, 5, 11, 13, 11], [4, 4, 4, 12, 6, 12]] as Box[])
    .map((b) => hFacingBox(b, m & 3)),
  collision: () => [[0, 0, 0, 16, 16, 16]],
  textures: tex("bell_top", "bell_side"), hardness: 5, tool: P, harvestTier: 0, material: "metal",
  boxTexture: (_m, box) => (box <= 2 ? "smooth_stone" : undefined),
});

add(184, "cauldron", "Cauldron", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: cauldronBoxes, collision: () => cauldronBoxes(0),
  textures: tex("cauldron_top", "cauldron_side", "cauldron_bottom"), hardness: 2, tool: P, harvestTier: 0, material: "metal",
  interact: "cauldron",
  boxTexture: (m, box, face) => ((m & 3) > 0 && box === 9 ? "cauldron_water" : box === 0 ? (face === Face.Up ? "cauldron_inner" : "cauldron_bottom") : undefined),
});

// ---- the Nether (198+) -------------------------------------------------------------------

const NYLIUM_BELOW = "netherrack";
add(198, "netherrack", "Netherrack", { hardness: 0.4, tool: P, harvestTier: 0 });
add(199, "nether_quartz_ore", "Nether Quartz Ore", {
  hardness: 3, tool: P, harvestTier: 0, drops: [{ item: "quartz", min: 1, max: 1 }], xp: [2, 5],
});
add(200, "nether_gold_ore", "Nether Gold Ore", {
  hardness: 3, tool: P, harvestTier: 0, drops: [{ item: "gold_nugget", min: 2, max: 6 }], xp: [0, 1],
});
// A little lower than a full block, so whatever walks on it sinks in and slows.
add(201, "soul_sand", "Soul Sand", {
  hardness: 0.5, tool: S, material: "sand", speedFactor: 0.4, collision: () => [[0, 0, 0, 16, 14, 16]],
});
add(202, "soul_soil", "Soul Soil", { hardness: 0.5, tool: S, material: "sand" });
add(203, "basalt", "Basalt", { textures: tex("basalt_top", "basalt_side"), hardness: 1.25, tool: P, harvestTier: 0 });
add(204, "blackstone", "Blackstone", { textures: tex("blackstone_top", "blackstone"), hardness: 1.5, tool: P, harvestTier: 0 });
add(205, "magma_block", "Magma Block", { hardness: 0.5, tool: P, harvestTier: 0, emission: 3 });
add(206, "nether_bricks", "Nether Bricks", { hardness: 2, tool: P, harvestTier: 0 });
add(207, "nether_brick_fence", "Nether Brick Fence", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[6, 0, 6, 10, 16, 10]],
  collision: () => [[6, 0, 6, 10, 24, 10]], textures: tex("nether_bricks"), hardness: 2, tool: P, harvestTier: 0,
});
add(208, "nether_brick_stairs", "Nether Brick Stairs", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: stairBoxes, textures: tex("nether_bricks"),
  hardness: 2, tool: P, harvestTier: 0, facing: "away",
});
// The crop, planted from the nether_wart item; four stages in meta.
add(209, "nether_wart", "Nether Wart", {
  shape: "crop", layer: "cutout", solid: false, opaque: false, hardness: 0, material: "plant", needsSupport: true,
  textures: tex("nether_wart_stage_2"), hidden: true, drops: [{ item: "nether_wart", min: 1, max: 1 }],
});
add(210, "crimson_nylium", "Crimson Nylium", {
  textures: tex("crimson_nylium", "crimson_nylium_side", NYLIUM_BELOW), hardness: 0.4, tool: P, harvestTier: 0,
  drops: [{ item: "netherrack", min: 1, max: 1 }],
});
add(211, "warped_nylium", "Warped Nylium", {
  textures: tex("warped_nylium", "warped_nylium_side", NYLIUM_BELOW), hardness: 0.4, tool: P, harvestTier: 0,
  drops: [{ item: "netherrack", min: 1, max: 1 }],
});
// Nether wood does not burn: no fire spreads through a crimson forest.
add(212, "crimson_stem", "Crimson Stem", { textures: tex("crimson_stem_top", "crimson_stem"), hardness: 2, tool: A, material: "wood" });
add(213, "warped_stem", "Warped Stem", { textures: tex("warped_stem_top", "warped_stem"), hardness: 2, tool: A, material: "wood" });
add(214, "crimson_planks", "Crimson Planks", { hardness: 2, tool: A, material: "wood" });
add(215, "warped_planks", "Warped Planks", { hardness: 2, tool: A, material: "wood" });
add(216, "nether_wart_block", "Nether Wart Block", { hardness: 1, tool: H, material: "leaves" });
add(217, "warped_wart_block", "Warped Wart Block", { hardness: 1, tool: H, material: "leaves" });
add(218, "shroomlight", "Shroomlight", { hardness: 1, tool: H, material: "leaves", emission: 15 });
add(219, "crimson_fungus", "Crimson Fungus", { ...plant(), waves: false });
add(220, "warped_fungus", "Warped Fungus", { ...plant(), waves: false });
add(221, "crimson_roots", "Crimson Roots", { ...plant(), replaceable: true });
add(222, "warped_roots", "Warped Roots", { ...plant(), replaceable: true });
add(223, "weeping_vines", "Weeping Vines", { ...plant(), waves: false, climbable: true, drops: [{ item: "weeping_vines", min: 1, max: 1, chance: 0.33 }] });
add(224, "twisting_vines", "Twisting Vines", { ...plant(), waves: false, climbable: true, drops: [{ item: "twisting_vines", min: 1, max: 1, chance: 0.33 }] });
// The portal's sheet: thin along its axis (meta 0 spans x, 1 spans z), walked through, never mined.
add(225, "nether_portal", "Nether Portal", {
  shape: "boxes", layer: "translucent", solid: false, opaque: false, emission: 11, hardness: -1, material: "glass",
  boxes: (m) => [(m & 1) === 0 ? [0, 0, 6, 16, 16, 10] : [6, 0, 0, 10, 16, 16]], collision: () => [],
  textures: tex("nether_portal"), hidden: true, drops: [], animated: true,
});
add(226, "fire", "Fire", {
  shape: "cross", layer: "cutout", solid: false, opaque: false, emission: 15, hardness: 0, material: "none",
  replaceable: true, needsSupport: true, textures: tex("fire"), hidden: true, drops: [], animated: true,
});
add(227, "soul_fire", "Soul Fire", {
  shape: "cross", layer: "cutout", solid: false, opaque: false, emission: 10, hardness: 0, material: "none",
  replaceable: true, needsSupport: true, textures: tex("soul_fire"), hidden: true, drops: [], animated: true,
});
add(228, "bone_block", "Bone Block", { textures: tex("bone_block_top", "bone_block_side"), hardness: 2, tool: P, harvestTier: 0 });
add(229, "ancient_debris", "Ancient Debris", {
  textures: tex("ancient_debris_top", "ancient_debris_side"), hardness: 30, tool: P, harvestTier: 3, material: "metal",
});
add(230, "quartz_block", "Block of Quartz", { textures: tex("quartz_block_top", "quartz_block_side"), hardness: 0.8, tool: P, harvestTier: 0 });
// A cage that breeds its mob (meta names which, from SPAWNER_MOBS) while a player is near.
add(231, "spawner", "Monster Spawner", {
  layer: "cutout", opaque: false, hardness: 5, tool: P, harvestTier: 0, material: "metal", drops: [], xp: [15, 43], hidden: true,
});

// ---- the End (232+) ----------------------------------------------------------------------

add(232, "end_stone", "End Stone", { hardness: 3, tool: P, harvestTier: 0 });
add(233, "end_stone_bricks", "End Stone Bricks", { hardness: 3, tool: P, harvestTier: 0 });
add(234, "purpur_block", "Purpur Block", { hardness: 1.5, tool: P, harvestTier: 0 });
add(235, "purpur_pillar", "Purpur Pillar", { textures: tex("purpur_pillar_top", "purpur_pillar"), hardness: 1.5, tool: P, harvestTier: 0 });
add(236, "purpur_stairs", "Purpur Stairs", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: stairBoxes, textures: tex("purpur_block"),
  hardness: 1.5, tool: P, harvestTier: 0, facing: "away",
});
// Meta: the Face the rod points out of, away from what holds it.
export function endRodBoxes(meta: number): Box[] {
  const f = meta & 7;
  return [facingBox([6, 0, 6, 10, 1, 10], f), facingBox([7, 1, 7, 9, 16, 9], f)];
}
add(237, "end_rod", "End Rod", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: endRodBoxes, emission: 14, hardness: 0, material: "glass",
  textures: tex("end_rod"), boxTexture: (_m, box) => (box === 0 ? "end_rod_base" : undefined),
});
/**
 * Chorus plant: a knot with an arm out toward each chorus or end stone it
 * joins, the six joins kept in meta as bits by Face (updated as neighbours
 * come and go). Unsupported, it snaps, and so does everything above it.
 */
export function chorusBoxes(meta: number): Box[] {
  const boxes: Box[] = [[4, 4, 4, 12, 12, 12]];
  const ARMS: Box[] = [[12, 4, 4, 16, 12, 12], [0, 4, 4, 4, 12, 12], [4, 12, 4, 12, 16, 12], [4, 0, 4, 12, 4, 12], [4, 4, 12, 12, 12, 16], [4, 4, 0, 12, 12, 4]];
  for (let f = 0; f < 6; f++) if (meta & (1 << f)) boxes.push(ARMS[f]);
  return boxes;
}
/** The joins a chorus plant at x,y,z makes: a bit by Face for each chorus, flower or (below) end stone next to it. */
export function chorusJoins(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number): number {
  let m = 0;
  for (let f = 0; f < 6; f++) {
    const [dx, dy, dz] = FACE_DIRS[f];
    const n = get(x + dx, y + dy, z + dz);
    if (n === 238 || n === 239 || (f === Face.Down && n === 232)) m |= 1 << f;
  }
  return m;
}
add(238, "chorus_plant", "Chorus Plant", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: chorusBoxes, hardness: 0.4, tool: A, material: "plant",
  needsSupport: true, drops: [{ item: "chorus_fruit", min: 0, max: 1 }],
});
// Meta: age 0-5; at 5 the flower is spent and will not grow again.
add(239, "chorus_flower", "Chorus Flower", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[1, 1, 1, 15, 15, 15], [4, 0, 4, 12, 1, 12]],
  hardness: 0.4, tool: A, material: "plant", needsSupport: true,
  boxTexture: (m) => ((m & 7) >= 5 ? "chorus_flower_dead" : undefined),
});
// Meta: bits 0-1 the way the frame faces (into the ring), bit 2 an eye of ender set in it.
export const FRAME_EYE = 4;
add(240, "end_portal_frame", "End Portal Frame", {
  shape: "boxes", layer: "cutout", opaque: false, facing: "player", hardness: -1, material: "stone", drops: [],
  boxes: (m) => ((m & FRAME_EYE) !== 0 ? [[0, 0, 0, 16, 13, 16], [4, 13, 4, 12, 16, 12]] : [[0, 0, 0, 16, 13, 16]]),
  textures: tex("end_portal_frame_top", "end_portal_frame_side", "end_stone"),
  boxTexture: (_m, box) => (box === 1 ? "end_portal_frame_eye" : undefined),
  emission: 1,
});
// The portal's floor: a sheet at knee height the player drops through. Never mined.
add(241, "end_portal", "End Portal", {
  shape: "boxes", layer: "translucent", solid: false, opaque: false, emission: 15, hardness: -1, material: "glass",
  boxes: () => [[0, 11, 0, 16, 12, 16]], collision: () => [], textures: tex("end_portal"), hidden: true, drops: [], animated: true,
});
// A gateway: a cube of the portal's starfield inside a bedrock cage, touched to be carried out to the far islands.
add(242, "end_gateway", "End Gateway", {
  layer: "translucent", solid: false, opaque: false, emission: 15, hardness: -1, material: "glass",
  collision: () => [], textures: tex("end_portal"), hidden: true, drops: [], animated: true,
});
// The dragon's egg: it falls like sand, and flees whoever touches it.
add(243, "dragon_egg", "Dragon Egg", {
  shape: "boxes", layer: "cutout", opaque: false, gravity: true, emission: 1, hardness: 3, material: "stone",
  boxes: () => [[6, 15, 6, 10, 16, 10], [5, 14, 5, 11, 15, 11], [4, 13, 4, 12, 14, 12], [3, 11, 3, 13, 13, 13], [2, 8, 2, 14, 11, 14], [1, 3, 1, 15, 8, 15], [2, 1, 2, 14, 3, 14], [3, 0, 3, 13, 1, 13]],
});
add(244, "iron_bars", "Iron Bars", {
  shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[7, 0, 0, 9, 16, 16], [0, 0, 7, 16, 16, 9]],
  textures: tex("iron_bars"), hardness: 5, tool: P, harvestTier: 0, material: "metal",
});

/**
 * Shulker box colours, by the number kept in meta bits 3-6 and on the item
 * (`color`): 0 is the shulker's own purple, then the dyes in items.ts DYES order.
 */
export const BOX_COLORS = ["", "white", "red", "yellow", "blue", "green", "orange", "purple", "black"] as const;
export const boxColorOf = (meta: number): number => (meta >> 3) & 15;
const boxTex = (part: "top" | "side" | "bottom", color: number) => `shulker_box_${part}${BOX_COLORS[color] ? `_${BOX_COLORS[color]}` : ""}`;
// A shulker box: a chest that keeps what is in it when it is broken, so a
// whole inventory travels as one item. Meta bits 0-2: the Face its lid opens
// toward; bits 3-6: its colour.
add(245, "shulker_box", "Shulker Box", {
  facing6: true, textures: tex("shulker_box_top", "shulker_box_side", "shulker_box_bottom"), hardness: 2, tool: P, material: "stone",
  interact: "chest", drops: [],
  boxTexture: (m, _b, face) => boxTex(face === (m & 7) ? "top" : face === OPPOSITE_FACE[m & 7] ? "bottom" : "side", boxColorOf(m)),
  uvRotation: sixWayUV,
});
// The dragon's head, from the prow of an End ship: set down facing whoever places it, or worn.
add(246, "dragon_head", "Dragon Head", {
  shape: "boxes", layer: "cutout", opaque: false, facing: "player", hardness: 1, material: "stone",
  boxes: (m) => ([[3, 0, 5, 13, 9, 15], [5, 0, 0, 11, 5, 5], [4, 9, 10, 6, 12, 14], [10, 9, 10, 12, 12, 14]] as Box[]).map((b) => hFacingBox(b, m & 3)),
  textures: tex("dragon_head_top", "dragon_head_side"),
  boxTexture: (m, box, face) => {
    if (box >= 2) return "dragon_head_horn";
    if (box === 1) return face === Face.Up ? "dragon_head_snout_top" : "dragon_head_snout";
    return face === FACING_TO_FACE[m & 3] ? "dragon_head_face" : face === Face.Up ? "dragon_head_top" : "dragon_head_side";
  },
});
add(247, "purpur_slab", "Purpur Slab", {
  shape: "boxes", layer: "opaque", opaque: false, boxes: slabBoxes, textures: tex("purpur_block"),
  hardness: 2, tool: P, harvestTier: 0,
});
add(248, "magenta_stained_glass", "Magenta Stained Glass", {
  layer: "translucent", opaque: false, hardness: 0.3, material: "glass", drops: [],
});
// A gravestone (engine/graves.ts): a headstone on a low plinth, holding what its player carried.
// It gives back what it holds when used or broken, and nothing of itself.
add(250, "gravestone", "Gravestone", {
  shape: "boxes", layer: "opaque", opaque: false, facing: "player", hardness: 1.5, material: "stone", hidden: true, drops: [],
  interact: "grave",
  boxes: (m) => ([[1, 0, 2, 15, 2, 14], [3, 2, 6, 13, 13, 10], [5, 13, 6, 11, 15, 10]] as Box[]).map((b) => hFacingBox(b, m & 3)),
  textures: tex("gravestone"),
});
// A lucky block (engine/lucky.ts): break it and something happens. It drops nothing of itself.
// Primal's berry bushes: picked by hand (right click), bare for a while after, then fruiting again.
// Meta bit 0 is "picked".
for (const [id, name, display] of [[253, "mejoberry_bush", "Mejoberry Bush"], [254, "narcoberry_bush", "Narcoberry Bush"]] as const) {
  add(id, name, display, {
    ...plant(), tint: "none", textures: tex(name), flammable: true,
    drops: [{ item: name.replace("_bush", ""), min: 1, max: 2 }],
    boxTexture: (meta) => ((meta & 1) !== 0 ? `${name}_bare` : undefined),
  });
}
add(252, "lucky_block", "Lucky Block", {
  textures: tex("lucky_block"), hardness: 0.3, material: "wood", drops: [], emission: 4,
});
// A cooking pot (engine/cooking.ts): an iron pot with handles and a lid, set over heat to cook meals.
add(251, "cooking_pot", "Cooking Pot", {
  shape: "boxes", layer: "cutout", opaque: false, hardness: 2, tool: P, harvestTier: 0, material: "metal", interact: "cooking",
  boxes: () => [[2, 0, 2, 14, 9, 14], [0, 5, 6, 2, 7, 10], [14, 5, 6, 16, 7, 10], [3, 9, 3, 13, 10, 13], [7, 10, 7, 9, 11, 9]],
  textures: tex("cooking_pot_top", "cooking_pot_side", "cooking_pot_bottom"),
});
// A waystone (engine/waystones.ts): a carved pillar on a plinth, its rune glowing faintly.
add(249, "waystone", "Waystone", {
  shape: "boxes", layer: "cutout", opaque: false, hardness: 5, tool: P, harvestTier: 0, material: "stone", emission: 6,
  boxes: () => [[1, 0, 1, 15, 3, 15], [3, 3, 3, 13, 14, 13], [4, 14, 4, 12, 16, 12]],
  textures: tex("waystone_top", "waystone_side"), interact: "waystone",
  boxTexture: (_m, box, face) => (box === 0 ? "waystone_base" : face === Face.Up || face === Face.Down ? "waystone_top" : "waystone_side"),
});

// A healing station (the critter modes): a counter with a glowing dome, where a trainer's critters are healed
// and their goods are bought. The last free block id.
add(255, "healing_station", "Healing Station", {
  shape: "boxes", layer: "cutout", opaque: false, hardness: 3, tool: P, harvestTier: 0, material: "metal", emission: 12, interact: "healing",
  boxes: () => [[0, 0, 0, 16, 10, 16], [3, 10, 3, 13, 15, 13]],
  textures: tex("healing_station_top", "healing_station_side"),
  boxTexture: (_m, box, face) => (box === 1 ? "healing_station_dome" : face === Face.Up ? "healing_station_top" : face === Face.Down ? "healing_station_bottom" : "healing_station_side"),
});

// The county (engine/countyBlocks.ts): ids from 4096, every one after the one-byte blocks.
defineCountyBlocks({ add, tex, stairBoxes, slabBoxes, doorBoxes, hFacingBox });

export const BLOCK_COUNT = BLOCKS.length;
/**
 * One past the highest block id: the size of a table indexed by id. Ids are
 * sixteen-bit (chunks keep them in Uint16Arrays); the first 256 filled the
 * one-byte ids the engine began with, and blocks since start at
 * FIRST_WIDE_BLOCK so they never share an id with a plain item (those count
 * up from 256, and a block's item has the block's own id).
 */
export const BLOCK_ID_LIMIT = BLOCKS.length;

const AIR_DEF = BLOCKS[0];
export function block(id: number): BlockDef {
  return BLOCKS[id] ?? AIR_DEF;
}
export function blockByName(name: string): BlockDef {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`unknown block ${name}`);
  return def;
}
export function allBlocks(): readonly BlockDef[] {
  return BLOCKS.filter(Boolean);
}

/** Named ids, so generation and game code read as words rather than numbers. */
export const B = {
  AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLE: 4, OAK_PLANKS: 5, BEDROCK: 6, WATER: 7, LAVA: 8,
  SAND: 9, GRAVEL: 10, OAK_LOG: 11, OAK_LEAVES: 12, GLASS: 13, COAL_ORE: 14, IRON_ORE: 15,
  GOLD_ORE: 16, DIAMOND_ORE: 17, REDSTONE_ORE: 18, LAPIS_ORE: 19, EMERALD_ORE: 20, COPPER_ORE: 21,
  DEEPSLATE: 22, COBBLED_DEEPSLATE: 23, DS_IRON: 24, DS_GOLD: 25, DS_DIAMOND: 26, DS_REDSTONE: 27,
  DS_LAPIS: 28, DS_COAL: 29, BIRCH_LOG: 30, BIRCH_LEAVES: 31, BIRCH_PLANKS: 32, SPRUCE_LOG: 33,
  SPRUCE_LEAVES: 34, SPRUCE_PLANKS: 35, JUNGLE_LOG: 36, JUNGLE_LEAVES: 37, JUNGLE_PLANKS: 38,
  ACACIA_LOG: 39, ACACIA_LEAVES: 40, ACACIA_PLANKS: 41, SANDSTONE: 42, RED_SAND: 43, TERRACOTTA: 44,
  ORANGE_TERRACOTTA: 45, YELLOW_TERRACOTTA: 46, RED_TERRACOTTA: 47, BROWN_TERRACOTTA: 48,
  WHITE_TERRACOTTA: 49, SNOW_BLOCK: 50, SNOW: 51, ICE: 52, OAK_SAPLING: 53, BIRCH_SAPLING: 54,
  SPRUCE_SAPLING: 55, JUNGLE_SAPLING: 56, ACACIA_SAPLING: 57, SHORT_GRASS: 58, FERN: 59,
  DEAD_BUSH: 60, DANDELION: 61, POPPY: 62, BLUE_ORCHID: 63, ALLIUM: 64, CORNFLOWER: 65,
  OXEYE_DAISY: 66, RED_TULIP: 67, LILY_OF_THE_VALLEY: 68, BROWN_MUSHROOM: 69, RED_MUSHROOM: 70,
  SUGAR_CANE: 71, CACTUS: 72, CLAY: 73, GRANITE: 74, DIORITE: 75, ANDESITE: 76, MOSSY_COBBLE: 77,
  STONE_BRICKS: 78, MOSSY_STONE_BRICKS: 79, BRICKS: 80, OBSIDIAN: 81, CRAFTING_TABLE: 82,
  FURNACE: 83, LIT_FURNACE: 84, CHEST: 85, TORCH: 86, TNT: 87, BOOKSHELF: 88, GLOWSTONE: 89,
  IRON_BLOCK: 90, GOLD_BLOCK: 91, DIAMOND_BLOCK: 92, EMERALD_BLOCK: 93, COAL_BLOCK: 94,
  LAPIS_BLOCK: 95, REDSTONE_BLOCK: 96, COPPER_BLOCK: 97, WHITE_WOOL: 98, PUMPKIN: 114,
  CARVED_PUMPKIN: 115, JACK_O_LANTERN: 116, MELON: 117, FARMLAND: 118, DIRT_PATH: 119, WHEAT: 120,
  CARROTS: 121, POTATOES: 122, OAK_DOOR: 123, LADDER: 124, RED_BED: 125, OAK_SLAB: 126,
  COBBLE_SLAB: 127, STONE_SLAB: 128, STONE_BRICK_SLAB: 129, OAK_STAIRS: 130, COBBLE_STAIRS: 131,
  STONE_BRICK_STAIRS: 132, LANTERN: 133, HAY: 134, LILY_PAD: 135, SMOOTH_STONE: 136,
  SEA_LANTERN: 137, PACKED_ICE: 138, PODZOL: 139, COARSE_DIRT: 140, MUD: 141, MOSS: 142,
  AMETHYST: 143, COBWEB: 144, OAK_FENCE: 145, GLASS_PANE: 146, NOTE_BLOCK: 147, CALCITE: 148,
  TUFF: 149, CHISELED_STONE_BRICKS: 153, CRACKED_STONE_BRICKS: 154,
  REDSTONE_WIRE: 155, REDSTONE_TORCH: 156, REDSTONE_TORCH_OFF: 157, LEVER: 158, STONE_BUTTON: 159,
  OAK_BUTTON: 160, STONE_PLATE: 161, OAK_PLATE: 162, REDSTONE_LAMP: 163, REDSTONE_LAMP_ON: 164,
  REPEATER: 165, COMPARATOR: 166, PISTON: 167, STICKY_PISTON: 168, PISTON_HEAD: 169, OBSERVER: 170,
  DAYLIGHT_DETECTOR: 171, HOPPER: 172, DISPENSER: 173, DROPPER: 174, IRON_DOOR: 175, OAK_TRAPDOOR: 176,
  IRON_TRAPDOOR: 177, SLIME_BLOCK: 178,
  ENCHANTING_TABLE: 179, ANVIL: 180, CHIPPED_ANVIL: 181, DAMAGED_ANVIL: 182, BREWING_STAND: 183, CAULDRON: 184,
  RAIL: 185, POWERED_RAIL: 186, DETECTOR_RAIL: 187, ACTIVATOR_RAIL: 188,
  COMPOSTER: 189, LECTERN: 190, SMOKER: 191, BARREL: 192, FLETCHING_TABLE: 193, LOOM: 194, STONECUTTER: 195,
  SMITHING_TABLE: 196, BELL: 197,
  NETHERRACK: 198, NETHER_QUARTZ_ORE: 199, NETHER_GOLD_ORE: 200, SOUL_SAND: 201, SOUL_SOIL: 202, BASALT: 203,
  BLACKSTONE: 204, MAGMA_BLOCK: 205, NETHER_BRICKS: 206, NETHER_BRICK_FENCE: 207, NETHER_BRICK_STAIRS: 208,
  NETHER_WART: 209, CRIMSON_NYLIUM: 210, WARPED_NYLIUM: 211, CRIMSON_STEM: 212, WARPED_STEM: 213,
  CRIMSON_PLANKS: 214, WARPED_PLANKS: 215, NETHER_WART_BLOCK: 216, WARPED_WART_BLOCK: 217, SHROOMLIGHT: 218,
  CRIMSON_FUNGUS: 219, WARPED_FUNGUS: 220, CRIMSON_ROOTS: 221, WARPED_ROOTS: 222, WEEPING_VINES: 223,
  TWISTING_VINES: 224, NETHER_PORTAL: 225, FIRE: 226, SOUL_FIRE: 227, BONE_BLOCK: 228, ANCIENT_DEBRIS: 229,
  QUARTZ_BLOCK: 230, SPAWNER: 231,
  END_STONE: 232, END_STONE_BRICKS: 233, PURPUR_BLOCK: 234, PURPUR_PILLAR: 235, PURPUR_STAIRS: 236, END_ROD: 237,
  CHORUS_PLANT: 238, CHORUS_FLOWER: 239, END_PORTAL_FRAME: 240, END_PORTAL: 241, END_GATEWAY: 242, DRAGON_EGG: 243,
  IRON_BARS: 244, SHULKER_BOX: 245, DRAGON_HEAD: 246, PURPUR_SLAB: 247, MAGENTA_STAINED_GLASS: 248, WAYSTONE: 249, GRAVESTONE: 250, COOKING_POT: 251, LUCKY_BLOCK: 252,
  MEJOBERRY_BUSH: 253, NARCOBERRY_BUSH: 254, HEALING_STATION: 255,
  ...COUNTY_BLOCKS,
} as const;

/** Blocks that stand on an axis kept in meta like a log's (0 up, 1 along x, 2 along z). */
export const isPillar = (id: number): boolean =>
  isLog(id) || id === B.CRIMSON_STEM || id === B.WARPED_STEM || id === B.BASALT || id === B.BONE_BLOCK || id === B.PURPUR_PILLAR;
export const isFire = (id: number): boolean => id === B.FIRE || id === B.SOUL_FIRE;
export const isNylium = (id: number): boolean => id === B.CRIMSON_NYLIUM || id === B.WARPED_NYLIUM;

export const isFluid = (id: number): boolean => id === B.WATER || id === B.LAVA;
export const isLog = (id: number): boolean =>
  id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG || id === B.JUNGLE_LOG || id === B.ACACIA_LOG;
export const isLeaves = (id: number): boolean =>
  id === B.OAK_LEAVES || id === B.BIRCH_LEAVES || id === B.SPRUCE_LEAVES || id === B.JUNGLE_LEAVES || id === B.ACACIA_LEAVES;
export const isCrop = (id: number): boolean => id === B.WHEAT || id === B.CARROTS || id === B.POTATOES;
export const isSapling = (id: number): boolean => id >= B.OAK_SAPLING && id <= B.ACACIA_SAPLING;
export const isSlab = (id: number): boolean => (id >= B.OAK_SLAB && id <= B.STONE_BRICK_SLAB) || id === B.PURPUR_SLAB || isShingleSlab(id);
export const isStairs = (id: number): boolean =>
  (id >= B.OAK_STAIRS && id <= B.STONE_BRICK_STAIRS) || id === B.NETHER_BRICK_STAIRS || id === B.PURPUR_STAIRS || isShingleStairs(id);
export const isDoor = (id: number): boolean => id === B.OAK_DOOR || id === B.IRON_DOOR || isCountyDoor(id);
/** Every bed: two blocks, a foot and a head, slept in and spawned at. */
export const isBed = (id: number): boolean => id === B.RED_BED || isCountyBed(id);
export const isTrapdoor = (id: number): boolean => id === B.OAK_TRAPDOOR || id === B.IRON_TRAPDOOR;
export const isButton = (id: number): boolean => id === B.STONE_BUTTON || id === B.OAK_BUTTON;
export const isPlate = (id: number): boolean => id === B.STONE_PLATE || id === B.OAK_PLATE;
export const isRedstoneTorch = (id: number): boolean => id === B.REDSTONE_TORCH || id === B.REDSTONE_TORCH_OFF;
export const isPiston = (id: number): boolean => id === B.PISTON || id === B.STICKY_PISTON;
/** Blocks that keep an inventory in a block entity, and how many slots. */
export function containerSize(id: number): number {
  const slots = BLOCKS[id]?.container;
  if (slots) return slots;
  return id === B.CHEST || id === B.BARREL || id === B.SHULKER_BOX ? 27 : id === B.HOPPER ? 5 : id === B.DISPENSER || id === B.DROPPER ? 9 : 0;
}

/** Maximum growth stage for crops (meta holds the age). */
export const CROP_MAX_AGE: Record<number, number> = { [B.WHEAT]: 7, [B.CARROTS]: 3, [B.POTATOES]: 3 };

/**
 * The texture a given face shows, accounting for facing and log axis.
 * Logs keep their axis in meta (0 up, 1 x, 2 z) so a sideways log shows its
 * rings on the ends rather than bark on every face.
 */
export function faceTexture(def: BlockDef, meta: number, face: number): string {
  const t = def.textures;
  if (isPillar(def.id)) {
    const axis = meta & 3;
    const end = axis === 0 ? face === Face.Up || face === Face.Down : axis === 1 ? face === Face.East || face === Face.West : face === Face.South || face === Face.North;
    return end ? t.top : t.side;
  }
  if (def.boxTexture) {
    const t2 = def.boxTexture(meta, 0, face);
    if (t2) return t2;
  }
  if (def.id === B.OAK_DOOR) return (meta & 8) !== 0 ? "oak_door_top" : "oak_door_bottom";
  if (isCountyDoor(def.id)) return (meta & 8) !== 0 ? t.top : t.side;
  if (def.id === B.IRON_DOOR) return (meta & 8) !== 0 ? "iron_door_top" : "iron_door_bottom";
  if (isBed(def.id)) {
    // The red bed came first and has the plain names; the county's carry their own.
    const pre = def.id === B.RED_BED ? "bed" : def.name;
    const head = (meta & 4) !== 0;
    if (face === Face.Up) return head ? `${pre}_head_top` : `${pre}_foot_top`;
    if (face === Face.Down) return "oak_planks";
    return head ? `${pre}_head_side` : `${pre}_side`;
  }
  if (isCrop(def.id)) {
    const base = def.id === B.WHEAT ? "wheat" : def.id === B.CARROTS ? "carrots" : "potatoes";
    return `${base}_stage_${meta & 7}`;
  }
  // Four ages over three pictures: the middle two look alike, as in the original.
  if (def.id === B.NETHER_WART) return `nether_wart_stage_${[0, 1, 1, 2][meta & 3]}`;
  if (face === Face.Up) return t.top;
  if (face === Face.Down) return t.bottom;
  if (t.front && def.facing === "player" && FACING_TO_FACE[meta & 3] === face) return t.front;
  return t.side;
}

/** Model boxes for a block with this meta; a full cube for plain cubes. */
export function modelBoxes(def: BlockDef, meta: number): Box[] {
  if (def.boxes) return def.boxes(meta);
  return [FULL_BOX];
}

/** Boxes an entity collides with. Empty for non-solid blocks. */
export function collisionBoxes(def: BlockDef, meta: number): Box[] {
  if (!def.solid) return [];
  if (def.collision) return def.collision(meta);
  if (def.boxes) return def.boxes(meta);
  return [FULL_BOX];
}

/** Primal's berry bushes, which fruit, are picked, and fruit again. */
export const isBerryBush = (id: number): boolean => id === B.MEJOBERRY_BUSH || id === B.NARCOBERRY_BUSH;
