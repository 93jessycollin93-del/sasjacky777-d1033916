import { blockIndex, CHUNK_VOLUME } from "./constants";
import type { ItemStack } from "./items";

/** Chests, furnaces and brewing stands keep inventories; they live beside the block, keyed by its index in the chunk. */
export type BlockEntity = ChestEntity | FurnaceEntity | BrewingEntity;

export interface ChestEntity {
  kind: "chest";
  items: (ItemStack | null)[];
  /** A gravestone's: whose things these were. */
  owner?: string;
}

export interface FurnaceEntity {
  kind: "furnace";
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  /** Ticks of burn left in the current fuel item, and how long that item burns in total. */
  burn: number;
  burnTotal: number;
  /** Progress of the current item, 0..200 ticks. */
  cook: number;
  /** Experience banked by smelting, paid out when the output is taken. */
  xp: number;
}

export interface BrewingEntity {
  kind: "brewing";
  /** The three bottles, the ingredient on top, and blaze powder for fuel. */
  bottles: (ItemStack | null)[];
  ingredient: ItemStack | null;
  fuel: ItemStack | null;
  /** Brews left in the current blaze powder (twenty to a powder). */
  fuelLeft: number;
  /** Ticks until the current brew is done; 0 when idle. */
  brew: number;
}

/** Every stack a block entity holds, in slot order (what spills when it breaks, what a comparator weighs). */
export function entityStacks(e: BlockEntity): (ItemStack | null)[] {
  if (e.kind === "chest") return e.items;
  if (e.kind === "furnace") return [e.input, e.fuel, e.output];
  return [...e.bottles, e.ingredient, e.fuel];
}

export function newBrewing(): BrewingEntity {
  return { kind: "brewing", bottles: [null, null, null], ingredient: null, fuel: null, fuelLeft: 0, brew: 0 };
}

/** A chest-like inventory: 27 for a chest, 5 for a hopper, 9 for a dispenser or dropper. */
export function newChest(size = 27): ChestEntity {
  return { kind: "chest", items: new Array(size).fill(null) };
}

export function newFurnace(): FurnaceEntity {
  return { kind: "furnace", input: null, fuel: null, output: null, burn: 0, burnTotal: 0, cook: 0, xp: 0 };
}

/** Numeric key for chunk maps; valid for |cx|, |cz| < 32768 (half a million blocks either way). */
export function chunkId(cx: number, cz: number): number {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

export class Chunk {
  readonly id: number;
  /** Differs from what the generator would produce — must be saved. */
  modified = false;
  /** Needs a new mesh. */
  dirty = true;
  /** Bumped on every change; a mesh built from an older version is stale on arrival. */
  version = 0;
  /** Which neighbours light has already been exchanged with (bit per direction). */
  seamMask = 0;
  readonly entities = new Map<number, BlockEntity>();

  constructor(
    readonly cx: number,
    readonly cz: number,
    public blocks: Uint16Array,
    public meta: Uint8Array,
    public light: Uint8Array,
    public biomes: Uint8Array,
    public tints: Uint8Array,
  ) {
    this.id = chunkId(cx, cz);
    if (blocks.length !== CHUNK_VOLUME) throw new Error(`chunk ${cx},${cz} has ${blocks.length} blocks, expected ${CHUNK_VOLUME}`);
    // Block ids are sixteen-bit. A byte array here would hold every id below 256
    // and quietly turn every block past it into something else — typed arrays
    // look alike to the type checker, so it is caught here instead.
    if (!(blocks instanceof Uint16Array)) throw new Error(`chunk ${cx},${cz} keeps its blocks in a ${(blocks as object).constructor.name}, not a Uint16Array`);
  }

  get(x: number, y: number, z: number): number {
    return this.blocks[blockIndex(x, y, z)];
  }

  /** Highest non-air block in a column, or -1. */
  top(x: number, z: number): number {
    for (let y = 127; y >= 0; y--) if (this.blocks[blockIndex(x, y, z)] !== 0) return y;
    return -1;
  }
}
