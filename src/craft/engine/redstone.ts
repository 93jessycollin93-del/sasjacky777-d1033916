/**
 * Redstone: power, and everything it moves.
 *
 * The model is the original's, because players build to it:
 *
 *  - A *component* (torch, lever, button, plate, repeater, comparator,
 *    observer, block of redstone, daylight detector, dust) gives power
 *    straight to the blocks next to it — its direct power.
 *  - Some components also power a solid block *strongly*: a torch the block
 *    above it, a lever the block it hangs on, a repeater the block in front.
 *    A strongly powered block passes power on to dust beside it.
 *  - Dust powers the block under it and the blocks it points into only
 *    *weakly*: that block can run a lamp or a piston next to it, but not
 *    more dust. This is what stops a line of dust powering itself round a
 *    corner through a block, and what makes a torch tower work.
 *  - Dust loses one level per block; repeaters restore it to 15 after a
 *    delay; torches invert, a tick late.
 *
 * Dust is solved a network at a time — every connected wire, its sources,
 * then levels spread down from the strongest the way light spreads — so a
 * long line settles in one pass instead of a wire at a time. Components with
 * a delay (torches, repeaters, comparators, pistons, buttons, observers)
 * change on timers of their own, separate from the world's scheduled ticks,
 * which only keep the earliest time and would make a repeater fire early.
 *
 * Runs only where the world simulates; guests see the results as ordinary
 * block changes from the host.
 */
import {
  B, block, containerSize, FACE_DIRS, FACE_OF_FACING, FACING_DIRS, FACING_OF_FACE, Face, isBed, isButton, isDoor,
  isFluid, isPiston, isPlate, isRedstoneTorch, isTrapdoor, OPPOSITE_FACE,
} from "./blocks";
import { entityStacks, type BlockEntity, type Chunk } from "./chunk";
import { WORLD_HEIGHT } from "./constants";
import { maxStack, resolveDrops, type ItemStack } from "./items";
import { fitsInBox, mergeInto, range, sameItem, type Slot } from "./inventory";
import { isBottle, isBrewingFuel, isBrewingIngredient } from "./brewing";
import { railChainPowered } from "./rails";
import { smeltResult, fuelTicks } from "./crafting";
import { posKey, unpackPos, type BlockChange, type World } from "./world";

export type IdGet = (x: number, y: number, z: number) => number;

// ---- what connects to what (shared with the mesher) -------------------------------------------

/** Whether dust beside a block of this kind turns toward it. `toward` is the Face from the dust to it. */
export function dustConnectsTo(id: number, meta: number, toward: number): boolean {
  switch (id) {
    case B.REDSTONE_WIRE: case B.REDSTONE_TORCH: case B.REDSTONE_TORCH_OFF: case B.LEVER:
    case B.STONE_BUTTON: case B.OAK_BUTTON: case B.STONE_PLATE: case B.OAK_PLATE: case B.REDSTONE_BLOCK:
    case B.DAYLIGHT_DETECTOR: case B.COMPARATOR: case B.DETECTOR_RAIL:
      return true;
    case B.REPEATER: {
      // Only along its line: in at the back, out at the front.
      const f = FACE_OF_FACING[meta & 3];
      return f === toward || f === OPPOSITE_FACE[toward];
    }
    case B.OBSERVER:
      // Its output is its back; dust meets it there.
      return OPPOSITE_FACE[meta & 7] === OPPOSITE_FACE[toward];
    default:
      return false;
  }
}

const opaqueCache: boolean[] = [];
function opaque(id: number): boolean {
  let o = opaqueCache[id];
  if (o === undefined) { o = block(id).opaque; opaqueCache[id] = o; }
  return o;
}

/**
 * How dust at x,y,z reaches out in horizontal facing d: 0 not at all, 1 along
 * the ground (or down a step), 2 up the side of the next block.
 */
export function dustConnection(get: IdGet, meta: IdGet, x: number, y: number, z: number, d: number): 0 | 1 | 2 {
  const [dx, dz] = FACING_DIRS[d];
  const nx = x + dx, nz = z + dz;
  const n = get(nx, y, nz);
  if (dustConnectsTo(n, meta(nx, y, nz), FACE_OF_FACING[d])) return 1;
  if (opaque(n)) {
    // Climb: dust on top of the neighbour, with nothing over this dust to cut the corner.
    if (!opaque(get(x, y + 1, z)) && get(nx, y + 1, nz) === B.REDSTONE_WIRE) return 2;
    return 0;
  }
  if (get(nx, y - 1, nz) === B.REDSTONE_WIRE) return 1;
  return 0;
}

/**
 * The horizontal facings dust points into (and so powers): where it connects;
 * a lone connection also points straight on the other way; unconnected dust
 * points everywhere.
 */
export function dustPoints(get: IdGet, meta: IdGet, x: number, y: number, z: number): boolean[] {
  const c = [0, 1, 2, 3].map((d) => dustConnection(get, meta, x, y, z, d) !== 0);
  const count = c.filter(Boolean).length;
  if (count === 0) return [true, true, true, true];
  if (count === 1) {
    const d = c.indexOf(true);
    c[d ^ 1] = true; // 0↔1 (north/south), 2↔3 (west/east)
  }
  return c;
}

/** Dust colour for a power level: a dull maroon when off, bright red at 15. */
export function dustColor(level: number): [number, number, number] {
  const f = level / 15;
  return [Math.round(76 + f * 179), Math.round(f > 0 ? 8 + f * 40 : 0), Math.round(f > 0 ? 4 + f * 10 : 0)];
}

// ---- the simulation ------------------------------------------------------------------------------------

export interface Body {
  x: number; y: number; z: number; width: number; height: number; mob: boolean;
  /** A minecart: detector rails feel these and nothing else. */
  cart?: boolean;
  move(dx: number, dy: number, dz: number): void;
}

export interface RedstoneContext {
  sound(name: string, x: number, y: number, z: number, volume?: number, pitch?: number): void;
  particles(kind: string, x: number, y: number, z: number, count?: number): void;
  dropItems(x: number, y: number, z: number, stacks: ItemStack[]): void;
  primeTnt(x: number, y: number, z: number): void;
  /** Every body that can press a plate or be shoved by a piston: players, mobs, items. */
  bodies(): Body[];
  /** Item entities whose centre is inside a box — what a hopper swallows. Each call may shrink or remove them. */
  takeItemsIn(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, take: (s: ItemStack) => number): void;
  /**
   * A dispenser fires `stack` out of its face. Returns what is left in the
   * slot afterwards (one fewer arrow, an empty bucket), or undefined when it
   * could do nothing special, in which case one item is dropped.
   */
  dispense(x: number, y: number, z: number, face: number, stack: ItemStack): Slot | undefined;
  dropOne(x: number, y: number, z: number, face: number, stack: ItemStack): void;
  /** How bright the sun is now, 0 at night to 1 at noon. */
  sunlight(): number;
  /** A container was changed by redstone (hopper, dispenser): save it and tell other players. */
  containerChanged(x: number, y: number, z: number): void;
  /** Sets up the inventory of a container block that lacks one. */
  ensureContainer(x: number, y: number, z: number): BlockEntity | undefined;
}

const MAX_NETWORK = 4096;
const MAX_PASSES = 64;
const PISTON_LIMIT = 12;
const TORCH_BURNOUT_TOGGLES = 8;

/** Blocks a piston cannot move at all. */
function immovable(id: number, meta: number): boolean {
  if (id === B.BEDROCK || id === B.OBSIDIAN || id === B.PISTON_HEAD) return true;
  if (isPiston(id) && (meta & 8) !== 0) return true;
  if (containerSize(id) > 0 || id === B.FURNACE || id === B.LIT_FURNACE) return true;
  if (isDoor(id) || isBed(id)) return true;
  return block(id).hardness < 0;
}

/** Blocks a piston breaks instead of pushing: plants, torches, dust, anything that hangs off another block. */
function breaksWhenPushed(id: number): boolean {
  const def = block(id);
  if (id === 0 || isFluid(id)) return false;
  return def.replaceable || def.needsSupport || def.shape === "cross" || def.shape === "crop" || def.shape === "wire";
}

export class Redstone {
  /** Positions whose component must re-evaluate. */
  private pending = new Set<number>();
  /** Delayed component changes: position → tick due. */
  readonly timers = new Map<number, number>();
  /** When each torch last flipped, to catch a clock running too fast. */
  private torchToggles = new Map<number, number[]>();
  private burntOut = new Map<number, number>();
  /** Things that act on their own clock: hoppers, daylight detectors, pressed plates. */
  private tracked = new Map<number, number>();
  private hopperCooldown = new Map<number, number>();
  private writingDust = false;
  private doneThisPass = new Set<number>();
  private tick = 0;

  constructor(private world: World, private ctx: RedstoneContext) {}

  // ---- reading the world ----------------------------------------------------------------------------

  private id = (x: number, y: number, z: number): number => this.world.blockAt(x, y, z);
  private meta = (x: number, y: number, z: number): number => this.world.getMeta(x, y, z);

  /** A solid block that carries power on (not a component, not a machine that only listens). */
  private conductor(id: number): boolean {
    if (!opaque(id)) return false;
    return id !== B.REDSTONE_BLOCK && id !== B.OBSERVER && !isPiston(id) && id !== B.DISPENSER && id !== B.DROPPER;
  }

  private isComponent(id: number): boolean {
    return id === B.REDSTONE_WIRE || isRedstoneTorch(id) || id === B.LEVER || isButton(id) || isPlate(id) ||
      id === B.REDSTONE_BLOCK || id === B.REPEATER || id === B.COMPARATOR || id === B.OBSERVER || id === B.DAYLIGHT_DETECTOR ||
      id === B.DETECTOR_RAIL;
  }

  /** The Face from a torch to the block holding it. */
  private torchAttach(meta: number): number {
    if (meta === 0) return Face.Down;
    return OPPOSITE_FACE[FACE_OF_FACING[(meta - 1) & 3]];
  }

  /** Power a component at x,y,z gives straight to its neighbour through Face f. */
  directPower(x: number, y: number, z: number, f: number): number {
    const id = this.id(x, y, z);
    const m = this.meta(x, y, z);
    switch (id) {
      case B.REDSTONE_WIRE: {
        const level = m & 15;
        if (level === 0 || f === Face.Up) return 0;
        if (f === Face.Down) return level;
        const d = FACING_OF_FACE[f];
        return dustPoints(this.id, this.meta, x, y, z)[d] ? level : 0;
      }
      case B.REDSTONE_TORCH: return f === this.torchAttach(m) ? 0 : 15;
      case B.LEVER: case B.STONE_BUTTON: case B.OAK_BUTTON: return (m & 8) !== 0 ? 15 : 0;
      case B.STONE_PLATE: case B.OAK_PLATE: return (m & 1) !== 0 ? 15 : 0;
      case B.REDSTONE_BLOCK: return 15;
      case B.REPEATER: return (m & 16) !== 0 && f === FACE_OF_FACING[m & 3] ? 15 : 0;
      case B.COMPARATOR: return f === FACE_OF_FACING[m & 3] ? (m >> 3) & 15 : 0;
      case B.OBSERVER: return (m & 8) !== 0 && f === OPPOSITE_FACE[m & 7] ? 15 : 0;
      case B.DAYLIGHT_DETECTOR: return m & 15;
      case B.DETECTOR_RAIL: return (m & 8) !== 0 ? 15 : 0;
      default: return 0;
    }
  }

  /** Power a component drives *into* the solid block through Face f, making it strongly powered. */
  strongPower(x: number, y: number, z: number, f: number): number {
    const id = this.id(x, y, z);
    const m = this.meta(x, y, z);
    switch (id) {
      case B.REDSTONE_TORCH: return f === Face.Up && this.torchAttach(m) !== Face.Up ? 15 : 0;
      case B.LEVER: case B.STONE_BUTTON: case B.OAK_BUTTON: return (m & 8) !== 0 && f === (m & 7) ? 15 : 0;
      case B.STONE_PLATE: case B.OAK_PLATE: return (m & 1) !== 0 && f === Face.Down ? 15 : 0;
      case B.REPEATER: return (m & 16) !== 0 && f === FACE_OF_FACING[m & 3] ? 15 : 0;
      case B.COMPARATOR: return f === FACE_OF_FACING[m & 3] ? (m >> 3) & 15 : 0;
      case B.OBSERVER: return (m & 8) !== 0 && f === OPPOSITE_FACE[m & 7] ? 15 : 0;
      // A detector rail drives the block it sits on, like a pressure plate.
      case B.DETECTOR_RAIL: return (m & 8) !== 0 && f === Face.Down ? 15 : 0;
      default: return 0;
    }
  }

  /** How powered a solid block is: strongly by components, or weakly by dust pointing into it. */
  blockPower(x: number, y: number, z: number, strongOnly = false): number {
    let best = 0;
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const n = this.id(nx, ny, nz);
      if (!this.isComponent(n)) continue;
      const back = OPPOSITE_FACE[f];
      best = Math.max(best, this.strongPower(nx, ny, nz, back));
      if (!strongOnly && n === B.REDSTONE_WIRE) best = Math.max(best, this.directPower(nx, ny, nz, back));
      if (best >= 15) return 15;
    }
    return best;
  }

  /** Power reaching x,y,z from its neighbour through Face f. */
  powerFrom(x: number, y: number, z: number, f: number): number {
    const [dx, dy, dz] = FACE_DIRS[f];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const n = this.id(nx, ny, nz);
    if (this.isComponent(n)) return this.directPower(nx, ny, nz, OPPOSITE_FACE[f]);
    if (this.conductor(n)) return this.blockPower(nx, ny, nz);
    return 0;
  }

  /** The strongest power reaching a machine from any side (but one). */
  inputPower(x: number, y: number, z: number, except = -1): number {
    let best = 0;
    for (let f = 0; f < 6; f++) {
      if (f === except) continue;
      best = Math.max(best, this.powerFrom(x, y, z, f));
      if (best >= 15) return 15;
    }
    return best;
  }

  // ---- change tracking -----------------------------------------------------------------------------------

  private mark(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.pending.add(posKey(x, y, z));
  }

  private markAround(x: number, y: number, z: number): void {
    for (const [dx, dy, dz] of FACE_DIRS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      this.mark(nx, ny, nz);
      // Through a solid block, to the machines on its far sides.
      if (this.conductor(this.id(nx, ny, nz))) for (const [ex, ey, ez] of FACE_DIRS) this.mark(nx + ex, ny + ey, nz + ez);
    }
  }

  /** Every block change in the world passes through here. */
  onChange(c: BlockChange): void {
    if (!this.world.simulates) return;
    const { x, y, z } = c;
    const wire = c.id === B.REDSTONE_WIRE || c.prevId === B.REDSTONE_WIRE;
    if (!(this.writingDust && c.id === B.REDSTONE_WIRE)) this.mark(x, y, z);
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIRS[f];
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const n = this.id(nx, ny, nz);
      // A dust network writing its own levels does not need to re-solve itself.
      if (!(this.writingDust && n === B.REDSTONE_WIRE)) this.mark(nx, ny, nz);
      if (this.conductor(n)) {
        for (const [ex, ey, ez] of FACE_DIRS) {
          if (this.writingDust && this.id(nx + ex, ny + ey, nz + ez) === B.REDSTONE_WIRE) continue;
          this.mark(nx + ex, ny + ey, nz + ez);
        }
      }
      // Observers watch the block in front of them.
      if (n === B.OBSERVER && (this.meta(nx, ny, nz) & 7) === OPPOSITE_FACE[f]) this.observe(nx, ny, nz);
    }
    if (wire) {
      // Dust steps up and down blocks: the wires on the diagonals are part of the same line.
      for (const [dx, dz] of FACING_DIRS) { this.mark(x + dx, y + 1, z + dz); this.mark(x + dx, y - 1, z + dz); }
    }
    // Pistons and their heads come and go together when a player breaks one.
    if (c.cause !== "load" && c.prevId === B.PISTON_HEAD && c.id !== B.PISTON_HEAD) this.headRemoved(x, y, z, c.prevMeta);
    if (c.cause !== "load" && isPiston(c.prevId) && !isPiston(c.id) && (c.prevMeta & 8) !== 0) this.baseRemoved(x, y, z, c.prevMeta);
    if (c.id === B.HOPPER || c.id === B.DAYLIGHT_DETECTOR) this.tracked.set(posKey(x, y, z), c.id);
    if (containerSize(c.prevId) > 0 || c.prevId === B.FURNACE || c.prevId === B.LIT_FURNACE) this.markAround(x, y, z);
  }

  /** A container's contents changed: comparators reading it must look again. */
  containerChanged(x: number, y: number, z: number): void {
    this.markAround(x, y, z);
  }

  /** Picks up the machines in a chunk that was just loaded, and settles anything saved halfway through. */
  onChunkLoaded(c: Chunk): void {
    const bx = c.cx * 16, bz = c.cz * 16;
    const b = c.blocks;
    for (let i = 0; i < b.length; i++) {
      const id = b[i];
      if (id < B.REDSTONE_WIRE || id > B.SLIME_BLOCK) continue;
      const x = bx + (i & 15), z = bz + ((i >> 4) & 15), y = i >> 8;
      const m = c.meta[i];
      if (id === B.HOPPER || id === B.DAYLIGHT_DETECTOR) this.tracked.set(posKey(x, y, z), id);
      // Timers are not saved: a button pressed at save time must still pop back out.
      if ((isButton(id) && (m & 8) !== 0) || (isPlate(id) && (m & 1) !== 0) || (id === B.OBSERVER && (m & 8) !== 0)
        || (id === B.DETECTOR_RAIL && (m & 8) !== 0)) this.setTimer(x, y, z, 10);
      if (id === B.REPEATER || id === B.COMPARATOR || isRedstoneTorch(id) || id === B.REDSTONE_LAMP_ON) this.mark(x, y, z);
    }
  }

  private setTimer(x: number, y: number, z: number, delay: number): void {
    const key = posKey(x, y, z);
    if (!this.timers.has(key)) this.timers.set(key, this.tick + Math.max(1, delay));
  }

  private hasTimer(x: number, y: number, z: number): boolean {
    return this.timers.has(posKey(x, y, z));
  }

  // ---- the tick ------------------------------------------------------------------------------------------

  step(worldTick: number): void {
    this.tick = worldTick;
    // Timers due now.
    const due: number[] = [];
    for (const [key, t] of this.timers) if (t <= this.tick) due.push(key);
    for (const key of due) {
      this.timers.delete(key);
      const [x, y, z] = unpackPos(key);
      if (this.world.isLoaded(x, z)) this.onTimer(x, y, z);
    }
    this.pressurePlates();
    if (this.tick % 20 === 0) this.daylightDetectors();
    this.hoppers();
    this.settle();
  }

  /** Re-evaluates everything marked, in passes, until nothing more changes. */
  settle(): void {
    for (let pass = 0; pass < MAX_PASSES && this.pending.size; pass++) {
      const batch = [...this.pending];
      this.pending.clear();
      this.doneThisPass.clear();
      for (const key of batch) {
        const [x, y, z] = unpackPos(key);
        if (!this.world.isLoaded(x, z)) continue;
        this.update(x, y, z);
      }
    }
    // Anything still pending after that many passes is an instant loop; it resumes next tick rather than hang.
  }

  private update(x: number, y: number, z: number): void {
    const id = this.id(x, y, z);
    if (id === 0) return;
    const m = this.meta(x, y, z);
    switch (id) {
      case B.REDSTONE_WIRE:
        if (!this.doneThisPass.has(posKey(x, y, z))) this.solveDust(x, y, z);
        return;
      case B.REDSTONE_TORCH: case B.REDSTONE_TORCH_OFF: {
        const lit = id === B.REDSTONE_TORCH;
        const powered = this.powerFrom(x, y, z, this.torchAttach(m)) > 0;
        if (lit === powered) this.setTimer(x, y, z, 2);
        return;
      }
      case B.REDSTONE_LAMP:
        if (this.inputPower(x, y, z) > 0) this.world.setBlock(x, y, z, B.REDSTONE_LAMP_ON, 0, "world");
        return;
      case B.REDSTONE_LAMP_ON:
        if (this.inputPower(x, y, z) === 0) this.setTimer(x, y, z, 4);
        return;
      case B.REPEATER: {
        const locked = this.repeaterLocked(x, y, z, m);
        if (locked !== ((m & 32) !== 0)) {
          this.world.setMeta(x, y, z, locked ? m | 32 : m & ~32, "world");
          return;
        }
        if (locked) return;
        const input = this.powerFrom(x, y, z, OPPOSITE_FACE[FACE_OF_FACING[m & 3]]) > 0;
        if (input !== ((m & 16) !== 0)) this.setTimer(x, y, z, (((m >> 2) & 3) + 1) * 2);
        return;
      }
      case B.COMPARATOR:
        if (this.comparatorOutput(x, y, z, m) !== ((m >> 3) & 15)) this.setTimer(x, y, z, 2);
        return;
      case B.PISTON: case B.STICKY_PISTON: {
        const powered = this.inputPower(x, y, z, m & 7) > 0;
        if (powered !== ((m & 8) !== 0)) this.setTimer(x, y, z, 1);
        return;
      }
      case B.PISTON_HEAD: {
        // A head with no base behind it (the base was removed some other way) goes too.
        const [dx, dy, dz] = FACE_DIRS[m & 7];
        const base = this.id(x - dx, y - dy, z - dz);
        if (!isPiston(base) || (this.meta(x - dx, y - dy, z - dz) & 15) !== ((m & 7) | 8)) this.world.setBlock(x, y, z, B.AIR, 0, "world");
        return;
      }
      case B.OAK_DOOR: case B.IRON_DOOR:
        this.updateDoor(x, y, z, id, m);
        return;
      case B.OAK_TRAPDOOR: case B.IRON_TRAPDOOR: {
        const powered = this.inputPower(x, y, z) > 0;
        if (powered !== ((m & 32) !== 0)) {
          const next = powered ? (m | 32 | 4) : (m & ~32 & ~4);
          this.world.setMeta(x, y, z, next, "world");
          this.ctx.sound(powered ? "door_open" : "door_close", x + 0.5, y + 0.5, z + 0.5, 0.6);
        }
        return;
      }
      case B.TNT:
        if (this.inputPower(x, y, z) > 0) {
          this.world.setBlock(x, y, z, B.AIR, 0, "world");
          this.ctx.primeTnt(x, y, z);
        }
        return;
      case B.NOTE_BLOCK: {
        const powered = this.inputPower(x, y, z) > 0;
        if (powered !== ((m & 32) !== 0)) {
          this.world.setMeta(x, y, z, powered ? m | 32 : m & ~32, "world");
          if (powered) {
            const pitch = m & 31;
            this.ctx.sound("note", x + 0.5, y + 0.5, z + 0.5, 1, 0.5 + (pitch / 24) * 1.5);
            this.ctx.particles("note", x + 0.5, y + 1.2, z + 0.5, 1);
          }
        }
        return;
      }
      case B.DISPENSER: case B.DROPPER: {
        const powered = this.inputPower(x, y, z) > 0;
        if (powered !== ((m & 8) !== 0)) {
          this.world.setMeta(x, y, z, powered ? m | 8 : m & ~8, "world");
          if (powered) this.setTimer(x, y, z, 4);
        }
        return;
      }
      case B.STONE_BUTTON: case B.OAK_BUTTON:
        // Pressed by a hand (here or a guest's, arriving as a block change): spring back after a while.
        if ((m & 8) !== 0 && !this.hasTimer(x, y, z)) this.setTimer(x, y, z, id === B.OAK_BUTTON ? 30 : 20);
        return;
      case B.HOPPER: {
        const disabled = this.inputPower(x, y, z) > 0;
        if (disabled !== ((m & 8) !== 0)) this.world.setMeta(x, y, z, disabled ? m | 8 : m & ~8, "world");
        return;
      }
      case B.POWERED_RAIL: case B.ACTIVATOR_RAIL: {
        // Powered straight from redstone, or along a line of the same rail up to eight long.
        const powered = railChainPowered(this.id, this.meta, (rx, ry, rz) => this.inputPower(rx, ry, rz) > 0, x, y, z);
        if (powered !== ((m & 8) !== 0)) this.world.setMeta(x, y, z, powered ? m | 8 : m & ~8, "world");
        return;
      }
    }
  }

  private onTimer(x: number, y: number, z: number): void {
    const id = this.id(x, y, z);
    const m = this.meta(x, y, z);
    switch (id) {
      case B.REDSTONE_TORCH: case B.REDSTONE_TORCH_OFF: {
        const key = posKey(x, y, z);
        const lit = id === B.REDSTONE_TORCH;
        const powered = this.powerFrom(x, y, z, this.torchAttach(m)) > 0;
        if (lit && powered) {
          this.world.setBlock(x, y, z, B.REDSTONE_TORCH_OFF, m, "world");
          // A torch flicking on and off every tick is a clock gone wild: it burns out for a while.
          const recent = (this.torchToggles.get(key) ?? []).filter((t) => this.tick - t < 60);
          recent.push(this.tick);
          this.torchToggles.set(key, recent);
          if (recent.length >= TORCH_BURNOUT_TOGGLES) {
            this.burntOut.set(key, this.tick + 160);
            this.ctx.sound("fizz", x + 0.5, y + 0.5, z + 0.5, 0.5, 2);
            this.ctx.particles("smoke", x + 0.5, y + 0.8, z + 0.5, 5);
            this.setTimer(x, y, z, 160);
          }
        } else if (!lit && !powered) {
          const until = this.burntOut.get(key);
          if (until !== undefined && until > this.tick) { this.setTimer(x, y, z, until - this.tick); return; }
          this.burntOut.delete(key);
          this.world.setBlock(x, y, z, B.REDSTONE_TORCH, m, "world");
        }
        return;
      }
      case B.REDSTONE_LAMP_ON:
        if (this.inputPower(x, y, z) === 0) this.world.setBlock(x, y, z, B.REDSTONE_LAMP, 0, "world");
        return;
      case B.REPEATER: {
        if ((m & 32) !== 0) return;
        const input = this.powerFrom(x, y, z, OPPOSITE_FACE[FACE_OF_FACING[m & 3]]) > 0;
        const powered = (m & 16) !== 0;
        if (powered && !input) this.world.setMeta(x, y, z, m & ~16, "world");
        else if (!powered) {
          this.world.setMeta(x, y, z, m | 16, "world");
          // A pulse shorter than the delay still comes out the full delay long.
          if (!input) this.setTimer(x, y, z, (((m >> 2) & 3) + 1) * 2);
        }
        return;
      }
      case B.COMPARATOR: {
        const out = this.comparatorOutput(x, y, z, m);
        if (out !== ((m >> 3) & 15)) this.world.setMeta(x, y, z, (m & 7) | (out << 3), "world");
        return;
      }
      case B.PISTON: case B.STICKY_PISTON: {
        const powered = this.inputPower(x, y, z, m & 7) > 0;
        const extended = (m & 8) !== 0;
        if (powered && !extended) this.extend(x, y, z, id, m);
        else if (!powered && extended) this.retract(x, y, z, id, m);
        return;
      }
      case B.STONE_BUTTON: case B.OAK_BUTTON:
        if ((m & 8) !== 0) {
          this.world.setMeta(x, y, z, m & ~8, "world");
          this.ctx.sound("click", x + 0.5, y + 0.5, z + 0.5, 0.3, 0.5);
        }
        return;
      case B.DETECTOR_RAIL:
        if ((m & 8) !== 0 && !this.cartOn(x, y, z)) this.world.setMeta(x, y, z, m & ~8, "world");
        else if ((m & 8) !== 0) this.setTimer(x, y, z, 20);
        return;
      case B.STONE_PLATE: case B.OAK_PLATE:
        if ((m & 1) !== 0 && !this.plateOccupied(x, y, z, id)) {
          this.world.setMeta(x, y, z, 0, "world");
          this.ctx.sound("click", x + 0.5, y + 0.1, z + 0.5, 0.3, 0.5);
        } else if ((m & 1) !== 0) this.setTimer(x, y, z, 10);
        return;
      case B.OBSERVER:
        if ((m & 8) === 0) {
          this.world.setMeta(x, y, z, m | 8, "world");
          this.setTimer(x, y, z, 2);
        } else this.world.setMeta(x, y, z, m & ~8, "world");
        return;
      case B.DISPENSER: case B.DROPPER:
        this.fire(x, y, z, id, m & 7);
        return;
    }
  }

  // ---- dust ------------------------------------------------------------------------------------------------

  private solveDust(sx: number, sy: number, sz: number): void {
    // Collect the network.
    const index = new Map<number, number>();
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    const adj: number[][] = [];
    const visit = (x: number, y: number, z: number): number => {
      const key = posKey(x, y, z);
      let i = index.get(key);
      if (i !== undefined) return i;
      i = xs.length;
      index.set(key, i);
      xs.push(x); ys.push(y); zs.push(z); adj.push([]);
      return i;
    };
    visit(sx, sy, sz);
    for (let i = 0; i < xs.length && xs.length < MAX_NETWORK; i++) {
      const x = xs[i], y = ys[i], z = zs[i];
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = FACING_DIRS[d];
        const nx = x + dx, nz = z + dz;
        let target: [number, number, number] | null = null;
        const n = this.id(nx, y, nz);
        if (n === B.REDSTONE_WIRE) target = [nx, y, nz];
        else if (opaque(n)) {
          if (!opaque(this.id(x, y + 1, z)) && this.id(nx, y + 1, nz) === B.REDSTONE_WIRE) target = [nx, y + 1, nz];
        } else if (this.id(nx, y - 1, nz) === B.REDSTONE_WIRE) target = [nx, y - 1, nz];
        if (!target || !this.world.isLoaded(target[0], target[2])) continue;
        const j = visit(target[0], target[1], target[2]);
        adj[i].push(j);
      }
    }
    const n = xs.length;
    const level = new Array<number>(n).fill(0);
    const buckets: number[][] = Array.from({ length: 16 }, () => []);
    for (let i = 0; i < n; i++) {
      this.doneThisPass.add(posKey(xs[i], ys[i], zs[i]));
      let src = 0;
      for (let f = 0; f < 6 && src < 15; f++) {
        const [dx, dy, dz] = FACE_DIRS[f];
        const px = xs[i] + dx, py = ys[i] + dy, pz = zs[i] + dz;
        const nid = this.id(px, py, pz);
        if (nid === B.REDSTONE_WIRE) continue;
        if (this.isComponent(nid)) src = Math.max(src, this.directPower(px, py, pz, OPPOSITE_FACE[f]));
        else if (this.conductor(nid)) src = Math.max(src, this.blockPower(px, py, pz, true));
      }
      level[i] = src;
      if (src > 0) buckets[src].push(i);
    }
    for (let l = 15; l > 1; l--) {
      for (const i of buckets[l]) {
        if (level[i] !== l) continue;
        for (const j of adj[i]) {
          if (level[j] < l - 1) { level[j] = l - 1; buckets[l - 1].push(j); }
        }
      }
    }
    this.writingDust = true;
    try {
      for (let i = 0; i < n; i++) {
        const cur = this.meta(xs[i], ys[i], zs[i]);
        if ((cur & 15) !== level[i]) this.world.setMeta(xs[i], ys[i], zs[i], level[i], "world");
      }
    } finally {
      this.writingDust = false;
    }
  }

  // ---- components --------------------------------------------------------------------------------------------

  /** A repeater is locked by a powered repeater or comparator pointing into its side. */
  private repeaterLocked(x: number, y: number, z: number, m: number): boolean {
    const f = m & 3;
    for (const side of f < 2 ? [2, 3] : [0, 1]) {
      const [dx, dz] = FACING_DIRS[side];
      const nx = x + dx, nz = z + dz;
      const n = this.id(nx, y, nz);
      if (n !== B.REPEATER && n !== B.COMPARATOR) continue;
      const nm = this.meta(nx, y, nz);
      // Pointing at us: its facing is the opposite of the side we looked through.
      if ((nm & 3) !== (side ^ 1)) continue;
      if (n === B.REPEATER ? (nm & 16) !== 0 : ((nm >> 3) & 15) > 0) return true;
    }
    return false;
  }

  /** What a comparator puts out: its rear, compared with (or less) the strongest side. */
  private comparatorOutput(x: number, y: number, z: number, m: number): number {
    const front = FACE_OF_FACING[m & 3];
    const backFace = OPPOSITE_FACE[front];
    const [bx, , bz] = FACE_DIRS[backFace];
    let rear = this.powerFrom(x, y, z, backFace);
    const container = this.containerSignal(x + bx, y, z + bz);
    if (container >= 0) rear = Math.max(rear, container);
    let side = 0;
    const f = m & 3;
    for (const sd of f < 2 ? [2, 3] : [0, 1]) {
      const sf = FACE_OF_FACING[sd];
      const [dx, , dz] = FACE_DIRS[sf];
      const n = this.id(x + dx, y, z + dz);
      // Sides only listen to dust, repeaters, comparators and blocks of redstone.
      if (n === B.REDSTONE_WIRE || n === B.REPEATER || n === B.COMPARATOR || n === B.REDSTONE_BLOCK) {
        side = Math.max(side, this.directPower(x + dx, y, z + dz, OPPOSITE_FACE[sf]));
      }
    }
    if ((m & 4) !== 0) return Math.max(0, rear - side);
    return rear >= side ? rear : 0;
  }

  /** The original's fullness signal for a container, or -1 when it is not one. */
  containerSignal(x: number, y: number, z: number): number {
    const id = this.id(x, y, z);
    if (!containerSize(id) && id !== B.FURNACE && id !== B.LIT_FURNACE && id !== B.BREWING_STAND) return -1;
    const e = this.world.getEntity(x, y, z);
    if (!e) return 0;
    const slots: Slot[] = entityStacks(e);
    let fill = 0, any = false;
    for (const s of slots) if (s) { any = true; fill += s.count / maxStack(s.id); }
    if (!any) return 0;
    return Math.floor(1 + (fill / slots.length) * 14);
  }

  private updateDoor(x: number, y: number, z: number, id: number, m: number): void {
    const lowerY = (m & 8) !== 0 ? y - 1 : y;
    if (this.id(x, lowerY, z) !== id || this.id(x, lowerY + 1, z) !== id) return;
    const lower = this.meta(x, lowerY, z);
    const powered = this.inputPower(x, lowerY, z) > 0 || this.inputPower(x, lowerY + 1, z) > 0;
    if (powered === ((lower & 32) !== 0)) return;
    const open = powered;
    const next = (lower & ~(4 | 32)) | (open ? 4 : 0) | (powered ? 32 : 0);
    const wasOpen = (lower & 4) !== 0;
    this.world.setBlock(x, lowerY, z, id, next, "world");
    this.world.setBlock(x, lowerY + 1, z, id, next | 8, "world");
    if (wasOpen !== open) this.ctx.sound(open ? "door_open" : "door_close", x + 0.5, lowerY + 1, z + 0.5, 0.8);
  }

  /** An observer saw the block in front of it change: a short pulse out of its back. */
  private observe(x: number, y: number, z: number): void {
    const m = this.meta(x, y, z);
    if ((m & 8) !== 0) return;
    this.setTimer(x, y, z, 2);
  }

  // ---- plates, daylight, hoppers --------------------------------------------------------------------------

  private plateOccupied(x: number, y: number, z: number, id: number): boolean {
    for (const b of this.ctx.bodies()) {
      if (id === B.STONE_PLATE && !b.mob) continue;
      const h = b.width / 2;
      if (b.x + h > x + 0.0625 && b.x - h < x + 0.9375 && b.z + h > z + 0.0625 && b.z - h < z + 0.9375 && b.y < y + 0.25 && b.y + b.height > y) return true;
    }
    return false;
  }

  private cartOn(x: number, y: number, z: number): boolean {
    for (const b of this.ctx.bodies()) {
      if (b.cart && Math.floor(b.x) === x && Math.floor(b.z) === z && Math.floor(b.y + 0.3) === y) return true;
    }
    return false;
  }

  private pressurePlates(): void {
    for (const b of this.ctx.bodies()) {
      const x = Math.floor(b.x), y = Math.floor(b.y + 0.01), z = Math.floor(b.z);
      // A minecart on a detector rail switches it on for as long as it stays.
      if (b.cart) {
        const ry = Math.floor(b.y + 0.3);
        if (this.id(x, ry, z) === B.DETECTOR_RAIL && (this.meta(x, ry, z) & 8) === 0) {
          this.world.setMeta(x, ry, z, this.meta(x, ry, z) | 8, "world");
          this.setTimer(x, ry, z, 20);
        }
        continue;
      }
      const id = this.id(x, y, z);
      if (!isPlate(id)) continue;
      if (id === B.STONE_PLATE && !b.mob) continue;
      const m = this.meta(x, y, z);
      if ((m & 1) !== 0) continue;
      this.world.setMeta(x, y, z, 1, "world");
      this.ctx.sound("click", x + 0.5, y + 0.1, z + 0.5, 0.3, 0.6);
      this.setTimer(x, y, z, 20);
    }
  }

  private daylightDetectors(): void {
    const sun = this.ctx.sunlight();
    for (const [key, kind] of this.tracked) {
      if (kind !== B.DAYLIGHT_DETECTOR) continue;
      const [x, y, z] = unpackPos(key);
      if (!this.world.isLoaded(x, z)) continue;
      if (this.id(x, y, z) !== B.DAYLIGHT_DETECTOR) { this.tracked.delete(key); continue; }
      const m = this.meta(x, y, z);
      const l = this.world.getLight(x, y, z);
      const sky = l < 0 ? 0 : l >> 4;
      let level = Math.max(0, Math.min(15, Math.round(sky * sun)));
      if ((m & 16) !== 0) level = 15 - level;
      if (level !== (m & 15)) this.world.setMeta(x, y, z, (m & 16) | level, "world");
    }
  }

  private hoppers(): void {
    for (const [key, kind] of this.tracked) {
      if (kind !== B.HOPPER) continue;
      const [x, y, z] = unpackPos(key);
      if (!this.world.isLoaded(x, z)) continue;
      if (this.id(x, y, z) !== B.HOPPER) { this.tracked.delete(key); this.hopperCooldown.delete(key); continue; }
      const ready = this.hopperCooldown.get(key) ?? 0;
      if (ready > this.tick) continue;
      const m = this.meta(x, y, z);
      if ((m & 8) !== 0) continue;
      const moved = this.hopperStep(x, y, z, m & 7);
      if (moved) this.hopperCooldown.set(key, this.tick + 8);
    }
  }

  private slotsAt(x: number, y: number, z: number): Slot[] | null {
    const id = this.id(x, y, z);
    if (!containerSize(id)) return null;
    let e = this.world.getEntity(x, y, z);
    if (!e) e = this.ctx.ensureContainer(x, y, z);
    return e && e.kind === "chest" ? e.items : null;
  }

  /** Pushes one item out, then pulls one in. Returns whether anything moved. */
  private hopperStep(x: number, y: number, z: number, out: number): boolean {
    const own = this.slotsAt(x, y, z);
    if (!own) return false;
    let moved = false;
    // Out.
    const [dx, dy, dz] = FACE_DIRS[out === Face.Up ? Face.Down : out];
    const tx = x + dx, ty = y + dy, tz = z + dz;
    for (let i = 0; i < own.length && !moved; i++) {
      const s = own[i];
      if (!s) continue;
      if (this.insertOne(tx, ty, tz, s, out === Face.Down ? Face.Up : OPPOSITE_FACE[out])) {
        own[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
        moved = true;
        this.ctx.containerChanged(x, y, z);
        this.ctx.containerChanged(tx, ty, tz);
        this.markAround(tx, ty, tz);
      }
    }
    // In, from a container above or items lying on top.
    const above = this.id(x, y + 1, z);
    const fromSlots = this.slotsAt(x, y + 1, z);
    if (fromSlots) {
      for (let i = 0; i < fromSlots.length; i++) {
        const s = fromSlots[i];
        if (!s) continue;
        const left = mergeInto({ ...s, count: 1 }, own, range(0, own.length));
        if (left === null) {
          fromSlots[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
          this.ctx.containerChanged(x, y + 1, z);
          this.ctx.containerChanged(x, y, z);
          moved = true;
          break;
        }
      }
    } else if (above === B.BREWING_STAND) {
      // A hopper under a stand takes the finished bottles, never a brew in progress.
      const e = this.world.getEntity(x, y + 1, z);
      const i = e?.kind === "brewing" && e.brew === 0 ? e.bottles.findIndex((b) => b !== null) : -1;
      if (e?.kind === "brewing" && i >= 0 && mergeInto({ ...e.bottles[i]!, count: 1 }, own, range(0, own.length)) === null) {
        e.bottles[i] = null;
        this.ctx.containerChanged(x, y + 1, z);
        this.ctx.containerChanged(x, y, z);
        moved = true;
      }
    } else if (above === B.FURNACE || above === B.LIT_FURNACE) {
      const e = this.world.getEntity(x, y + 1, z);
      if (e?.kind === "furnace" && e.output) {
        const left = mergeInto({ ...e.output, count: 1 }, own, range(0, own.length));
        if (left === null) {
          e.output = e.output.count > 1 ? { ...e.output, count: e.output.count - 1 } : null;
          this.ctx.containerChanged(x, y + 1, z);
          this.ctx.containerChanged(x, y, z);
          moved = true;
        }
      }
    } else if (!block(above).opaque) {
      let took = false;
      this.ctx.takeItemsIn(x, y + 1, z, x + 1, y + 2, z + 1, (s) => {
        let taken = 0;
        while (taken < s.count) {
          const left = mergeInto({ ...s, count: 1 }, own, range(0, own.length));
          if (left !== null) break;
          taken++;
        }
        if (taken) took = true;
        return taken;
      });
      if (took) { this.ctx.containerChanged(x, y, z); moved = true; }
    }
    if (moved) this.markAround(x, y, z);
    return moved;
  }

  /** Puts one of `s` into the container at x,y,z, entering through Face `from`. */
  insertOne(x: number, y: number, z: number, s: ItemStack, from: number): boolean {
    const id = this.id(x, y, z);
    const one: ItemStack = { ...s, count: 1 };
    if (id === B.FURNACE || id === B.LIT_FURNACE) {
      const e = this.world.getEntity(x, y, z);
      if (e?.kind !== "furnace") return false;
      // Into the top goes what is cooked; into the sides, what burns.
      if (from === Face.Up) {
        if (!smeltResult(s.id)) return false;
        if (!e.input) { e.input = one; return true; }
        if (e.input.id === s.id && e.input.count < maxStack(s.id)) { e.input = { ...e.input, count: e.input.count + 1 }; return true; }
        return false;
      }
      if (fuelTicks(s.id) <= 0) return false;
      if (!e.fuel) { e.fuel = one; return true; }
      if (e.fuel.id === s.id && e.fuel.count < maxStack(s.id)) { e.fuel = { ...e.fuel, count: e.fuel.count + 1 }; return true; }
      return false;
    }
    if (id === B.BREWING_STAND) {
      const e = this.world.getEntity(x, y, z);
      if (e?.kind !== "brewing") return false;
      // From above: the ingredient. From the sides: blaze powder, or a bottle into a free slot.
      if (from === Face.Up) {
        if (!isBrewingIngredient(s)) return false;
        if (!e.ingredient) { e.ingredient = one; return true; }
        if (sameItem(e.ingredient, s) && e.ingredient.count < maxStack(s.id)) { e.ingredient = { ...e.ingredient, count: e.ingredient.count + 1 }; return true; }
        return false;
      }
      if (isBrewingFuel(s)) {
        if (!e.fuel) { e.fuel = one; return true; }
        if (e.fuel.count < maxStack(s.id)) { e.fuel = { ...e.fuel, count: e.fuel.count + 1 }; return true; }
        return false;
      }
      const free = isBottle(s) ? e.bottles.findIndex((b) => b === null) : -1;
      if (free < 0) return false;
      e.bottles[free] = one;
      return true;
    }
    const slots = this.slotsAt(x, y, z);
    if (!slots) return false;
    if (id === B.SHULKER_BOX && !fitsInBox(one)) return false;
    return mergeInto(one, slots, range(0, slots.length)) === null;
  }

  private fire(x: number, y: number, z: number, id: number, face: number): void {
    const slots = this.slotsAt(x, y, z);
    if (!slots) return;
    const filled = slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) {
      this.ctx.sound("click", x + 0.5, y + 0.5, z + 0.5, 0.5, 1.2);
      return;
    }
    const i = filled[Math.floor(Math.random() * filled.length)];
    const s = slots[i]!;
    const [dx, dy, dz] = FACE_DIRS[face];
    if (id === B.DROPPER) {
      // A dropper feeds a container in front of it, or drops the item.
      const tx = x + dx, ty = y + dy, tz = z + dz;
      if (this.slotsAt(tx, ty, tz) || this.id(tx, ty, tz) === B.FURNACE) {
        if (!this.insertOne(tx, ty, tz, s, OPPOSITE_FACE[face])) return;
        this.ctx.containerChanged(tx, ty, tz);
      } else this.ctx.dropOne(x, y, z, face, s);
      slots[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
    } else {
      const after = this.ctx.dispense(x, y, z, face, s);
      if (after === undefined) {
        this.ctx.dropOne(x, y, z, face, s);
        slots[i] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
      } else slots[i] = after;
    }
    this.ctx.sound("click", x + 0.5, y + 0.5, z + 0.5, 0.5, 1);
    this.ctx.containerChanged(x, y, z);
    this.markAround(x, y, z);
  }

  // ---- pistons ------------------------------------------------------------------------------------------------

  /**
   * The blocks a piston would move, and the ones it would break, starting
   * from `start` and moving along `dir`. Slime blocks drag their neighbours.
   * Null when something immovable is in the way or it is too many.
   */
  private resolve(start: [number, number, number], dir: number, piston: [number, number, number]): { move: [number, number, number][]; brk: [number, number, number][] } | null {
    const [mx, my, mz] = FACE_DIRS[dir];
    const move: [number, number, number][] = [];
    const brk: [number, number, number][] = [];
    const seen = new Set<number>();
    const queue: { p: [number, number, number]; pushed: boolean }[] = [{ p: start, pushed: true }];
    while (queue.length) {
      const { p, pushed } = queue.shift()!;
      const [x, y, z] = p;
      const key = posKey(x, y, z);
      if (seen.has(key)) continue;
      if (x === piston[0] && y === piston[1] && z === piston[2]) continue;
      if (y < 0 || y >= WORLD_HEIGHT) { if (pushed) return null; continue; }
      if (!this.world.isLoaded(x, z)) { if (pushed) return null; continue; }
      const id = this.id(x, y, z);
      if (id === 0 || isFluid(id)) { seen.add(key); continue; }
      if (breaksWhenPushed(id)) {
        seen.add(key);
        if (pushed) brk.push(p);
        continue;
      }
      if (immovable(id, this.meta(x, y, z))) {
        if (pushed) return null;
        continue;
      }
      seen.add(key);
      move.push(p);
      if (move.length > PISTON_LIMIT) return null;
      // Whatever is in front along the way must move too.
      queue.push({ p: [x + mx, y + my, z + mz], pushed: true });
      if (id === B.SLIME_BLOCK) {
        for (const [dx, dy, dz] of FACE_DIRS) {
          const q: [number, number, number] = [x + dx, y + dy, z + dz];
          if (dx === mx && dy === my && dz === mz) continue;
          queue.push({ p: q, pushed: false });
        }
      }
    }
    // The last block of each line must end up somewhere free (or breakable): check destinations.
    const moving = new Set(move.map(([x, y, z]) => posKey(x, y, z)));
    for (const [x, y, z] of move) {
      const tx = x + mx, ty = y + my, tz = z + mz;
      if (moving.has(posKey(tx, ty, tz))) continue;
      if (tx === piston[0] && ty === piston[1] && tz === piston[2]) return null;
      if (ty < 0 || ty >= WORLD_HEIGHT || !this.world.isLoaded(tx, tz)) return null;
      const t = this.id(tx, ty, tz);
      if (t !== 0 && !isFluid(t) && !breaksWhenPushed(t)) return null;
    }
    return { move, brk };
  }

  /** Moves blocks one step along `dir`, carrying anything standing in the way. */
  private shift(list: [number, number, number][], brk: [number, number, number][], dir: number): void {
    const [mx, my, mz] = FACE_DIRS[dir];
    for (const [x, y, z] of brk) {
      const id = this.id(x, y, z);
      this.ctx.dropItems(x + 0.5, y + 0.3, z + 0.5, resolveDrops(block(id).drops, id, Math.random));
      this.world.setBlock(x, y, z, B.AIR, 0, "world");
    }
    const saved = list.map(([x, y, z]) => ({ x, y, z, id: this.id(x, y, z), meta: this.meta(x, y, z) }));
    const dest = new Set(saved.map((b) => posKey(b.x + mx, b.y + my, b.z + mz)));
    for (const b of saved) if (!dest.has(posKey(b.x, b.y, b.z))) this.world.setBlock(b.x, b.y, b.z, B.AIR, 0, "world");
    for (const b of saved) {
      const tx = b.x + mx, ty = b.y + my, tz = b.z + mz;
      const cur = this.id(tx, ty, tz);
      if (cur !== 0 && breaksWhenPushed(cur)) this.ctx.dropItems(tx + 0.5, ty + 0.3, tz + 0.5, resolveDrops(block(cur).drops, cur, Math.random));
      this.world.setBlock(tx, ty, tz, b.id, b.meta, "world");
    }
    // Carry bodies in the moved blocks' way, or riding on top of them.
    const cells = saved.map((b) => [b.x + mx, b.y + my, b.z + mz] as const);
    for (const body of this.ctx.bodies()) {
      const h = body.width / 2;
      const hit = cells.some(([cx, cy, cz]) =>
        body.x + h > cx && body.x - h < cx + 1 && body.z + h > cz && body.z - h < cz + 1 &&
        body.y < cy + 1.05 && body.y + body.height > cy);
      if (hit) body.move(mx, my > 0 ? my + 0.01 : my, mz);
    }
  }

  private extend(x: number, y: number, z: number, id: number, m: number): void {
    const f = m & 7;
    const [dx, dy, dz] = FACE_DIRS[f];
    const front: [number, number, number] = [x + dx, y + dy, z + dz];
    const res = this.resolve(front, f, [x, y, z]);
    if (!res) return;
    this.shift(res.move, res.brk, f);
    const cur = this.id(front[0], front[1], front[2]);
    if (cur !== 0 && breaksWhenPushed(cur)) this.ctx.dropItems(front[0] + 0.5, front[1] + 0.3, front[2] + 0.5, resolveDrops(block(cur).drops, cur, Math.random));
    this.world.setMeta(x, y, z, f | 8, "world");
    this.world.setBlock(front[0], front[1], front[2], B.PISTON_HEAD, f | (id === B.STICKY_PISTON ? 8 : 0), "world");
    this.ctx.sound("piston_out", x + 0.5, y + 0.5, z + 0.5, 0.5);
  }

  private retract(x: number, y: number, z: number, id: number, m: number): void {
    const f = m & 7;
    const [dx, dy, dz] = FACE_DIRS[f];
    const fx = x + dx, fy = y + dy, fz = z + dz;
    this.world.setMeta(x, y, z, f, "world");
    if (this.id(fx, fy, fz) === B.PISTON_HEAD) this.world.setBlock(fx, fy, fz, B.AIR, 0, "world");
    if (id === B.STICKY_PISTON) {
      const tx = fx + dx, ty = fy + dy, tz = fz + dz;
      const t = this.id(tx, ty, tz);
      if (t !== 0 && !isFluid(t) && !breaksWhenPushed(t) && !immovable(t, this.meta(tx, ty, tz))) {
        const res = this.resolve([tx, ty, tz], OPPOSITE_FACE[f], [x, y, z]);
        if (res) this.shift(res.move, [], OPPOSITE_FACE[f]);
      }
    }
    this.ctx.sound("piston_in", x + 0.5, y + 0.5, z + 0.5, 0.5);
  }

  /** A head broken by hand takes its base with it, as one piston. */
  private headRemoved(x: number, y: number, z: number, meta: number): void {
    const [dx, dy, dz] = FACE_DIRS[meta & 7];
    const bx = x - dx, by = y - dy, bz = z - dz;
    const base = this.id(bx, by, bz);
    if (!isPiston(base) || (this.meta(bx, by, bz) & 8) === 0) return;
    this.world.setBlock(bx, by, bz, B.AIR, 0, "world");
    this.ctx.dropItems(bx + 0.5, by + 0.3, bz + 0.5, [{ id: base, count: 1 }]);
  }

  /** An extended base that disappears leaves no head floating. */
  private baseRemoved(x: number, y: number, z: number, meta: number): void {
    const [dx, dy, dz] = FACE_DIRS[meta & 7];
    const hx = x + dx, hy = y + dy, hz = z + dz;
    if (this.id(hx, hy, hz) === B.PISTON_HEAD && (this.meta(hx, hy, hz) & 7) === (meta & 7)) this.world.setBlock(hx, hy, hz, B.AIR, 0, "world");
  }

}

/** Whether a block id is one the redstone module can react to at all — for cheap filtering. */
export function isRedstoneBlock(id: number): boolean {
  return (id >= B.REDSTONE_WIRE && id <= B.SLIME_BLOCK) || id === B.REDSTONE_BLOCK || isDoor(id) || isTrapdoor(id) || id === B.TNT || id === B.NOTE_BLOCK;
}
