/**
 * The loaded world on the main thread: every chunk in memory, block access by
 * world coordinate, and the bookkeeping that follows a change — relighting,
 * marking meshes stale, waking neighbouring blocks, telling listeners.
 *
 * All edits go through `setBlock`. Networking, saving, particles and sound
 * subscribe to its change event rather than being called from the places that
 * edit, so a block broken by a creeper is saved and sent to other players the
 * same way as one broken by hand — no path can forget to.
 */
import { block, isFluid } from "./blocks";
import { Chunk, chunkId, type BlockEntity } from "./chunk";
import { blockIndex, WORLD_HEIGHT } from "./constants";
import { emissionOf, isOpaqueId, relightBlock, seamLight, type LightVolume } from "./lighting";

export type ChangeCause = "player" | "remote" | "world" | "load";

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  id: number;
  meta: number;
  prevId: number;
  prevMeta: number;
  cause: ChangeCause;
}

const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function posKey(x: number, y: number, z: number): number {
  return ((x + 1048576) * 2097152 + (z + 1048576)) * 128 + y;
}
export function unpackPos(key: number): [number, number, number] {
  const y = key % 128;
  const rest = (key - y) / 128;
  const z = (rest % 2097152) - 1048576;
  const x = Math.floor(rest / 2097152) - 1048576;
  return [x, y, z];
}

export class World implements LightVolume {
  readonly chunks = new Map<number, Chunk>();
  /** Scheduled block ticks: position → game tick it is due. */
  readonly scheduled = new Map<number, number>();
  private listeners = new Set<(change: BlockChange) => void>();
  private cacheId = -1;
  private cacheChunk: Chunk | undefined;
  tick = 0;
  /**
   * Whether this copy of the world runs block rules. An online guest's copy
   * does not: the host decides where water flows and sand falls, and sends
   * the result, so two players never disagree about it.
   */
  simulates = true;
  /** Ticks until a block reacts to a neighbour changing. */
  delayFor: (id: number) => number = () => 1;

  onChange(listener: (change: BlockChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- chunks --------------------------------------------------------------------

  chunk(cx: number, cz: number): Chunk | undefined {
    const id = chunkId(cx, cz);
    if (id === this.cacheId) return this.cacheChunk;
    const c = this.chunks.get(id);
    this.cacheId = id;
    this.cacheChunk = c;
    return c;
  }

  chunkAt(x: number, z: number): Chunk | undefined {
    return this.chunk(x >> 4, z >> 4);
  }

  isLoaded(x: number, z: number): boolean {
    return this.chunkAt(x, z) !== undefined;
  }

  addChunk(c: Chunk): void {
    this.chunks.set(c.id, c);
    this.cacheId = -1;
    // Exchange light with every neighbour that is already here. The chunk was
    // lit alone in the worker; this is where caves under the seam get their
    // light from next door.
    const present: [number, number][] = [];
    for (const [dx, dz] of NEIGHBOURS) {
      const n = this.chunk(c.cx + dx, c.cz + dz);
      if (n) present.push([n.cx, n.cz]);
    }
    if (present.length) seamLight(this, c.cx, c.cz, present);
    c.dirty = true;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunk(c.cx + dx, c.cz + dz);
        if (n) { n.dirty = true; n.version++; }
      }
    }
  }

  removeChunk(cx: number, cz: number): Chunk | undefined {
    const id = chunkId(cx, cz);
    const c = this.chunks.get(id);
    this.chunks.delete(id);
    this.cacheId = -1;
    return c;
  }

  // ---- blocks -----------------------------------------------------------------------

  /** Block id, or -1 if the chunk is not loaded. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return y < 0 ? -1 : 0;
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    return c.blocks[blockIndex(x & 15, y, z & 15)];
  }

  /** Block id, with anything unloaded or out of range reading as air. */
  blockAt(x: number, y: number, z: number): number {
    const id = this.getBlock(x, y, z);
    return id < 0 ? 0 : id;
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.meta[blockIndex(x & 15, y, z & 15)] : 0;
  }

  getLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 0xf0;
    if (y < 0) return -1;
    const c = this.chunkAt(x, z);
    return c ? c.light[blockIndex(x & 15, y, z & 15)] : -1;
  }

  setLight(x: number, y: number, z: number, packed: number): void {
    const c = this.chunkAt(x, z);
    if (!c) return;
    c.light[blockIndex(x & 15, y, z & 15)] = packed;
    this.markDirty(x, z);
  }

  /** Combined light 0-15 given how bright the sky currently is (0..1). */
  brightness(x: number, y: number, z: number, daylight: number): number {
    const l = this.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
    if (l < 0) return 15 * daylight;
    return Math.max((l >> 4) * daylight, l & 15);
  }

  private markDirty(x: number, z: number): void {
    const cx = x >> 4, cz = z >> 4;
    const lx = x & 15, lz = z & 15;
    const mark = (dx: number, dz: number) => {
      const n = this.chunk(cx + dx, cz + dz);
      if (n) { n.dirty = true; n.version++; }
    };
    mark(0, 0);
    // Edge blocks are part of the neighbour's mesh too (culling, light, AO).
    const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (ex) mark(ex, 0);
    if (ez) mark(0, ez);
    if (ex && ez) mark(ex, ez);
  }

  /**
   * Changes a block. Returns false when nothing changed or the chunk is not
   * loaded — callers that consume an item check this, so a click into an
   * unloaded chunk does not eat the block from the player's hand.
   */
  setBlock(x: number, y: number, z: number, id: number, meta = 0, cause: ChangeCause = "world"): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const i = blockIndex(x & 15, y, z & 15);
    const prevId = c.blocks[i];
    const prevMeta = c.meta[i];
    if (prevId === id && prevMeta === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.modified = true;
    if (prevId !== id) {
      c.entities.delete(i);
      const prevDef = block(prevId), nextDef = block(id);
      if (
        isOpaqueId(prevId) !== isOpaqueId(id) || emissionOf(prevId) !== emissionOf(id) ||
        prevDef.lightFilter !== nextDef.lightFilter
      ) {
        relightBlock(this, x, y, z, id);
      }
    }
    this.markDirty(x, z);
    this.wakeNeighbours(x, y, z);
    const change: BlockChange = { x, y, z, id, meta, prevId, prevMeta, cause };
    for (const l of this.listeners) l(change);
    return true;
  }

  setMeta(x: number, y: number, z: number, meta: number, cause: ChangeCause = "world"): boolean {
    return this.setBlock(x, y, z, this.blockAt(x, y, z), meta, cause);
  }

  // ---- block entities -----------------------------------------------------------------

  getEntity(x: number, y: number, z: number): BlockEntity | undefined {
    const c = this.chunkAt(x, z);
    return c?.entities.get(blockIndex(x & 15, y, z & 15));
  }

  setEntity(x: number, y: number, z: number, e: BlockEntity | undefined): void {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const i = blockIndex(x & 15, y, z & 15);
    if (e) c.entities.set(i, e);
    else c.entities.delete(i);
    c.modified = true;
  }

  // ---- ticks ---------------------------------------------------------------------------

  schedule(x: number, y: number, z: number, delay: number): void {
    const key = posKey(x, y, z);
    const due = this.tick + Math.max(1, delay);
    const cur = this.scheduled.get(key);
    if (cur === undefined || cur > due) this.scheduled.set(key, due);
  }

  /**
   * Neighbours of a change get a tick: sand falls, water flows, torches lose
   * their wall. How soon depends on the block — water moves every 5 ticks and
   * lava every 30, which is what makes lava feel thick.
   */
  wakeNeighbours(x: number, y: number, z: number): void {
    if (!this.simulates) return;
    const wake = (wx: number, wy: number, wz: number) => {
      if (wy < 0 || wy >= WORLD_HEIGHT) return;
      this.schedule(wx, wy, wz, this.delayFor(this.blockAt(wx, wy, wz)));
    };
    wake(x, y, z);
    wake(x + 1, y, z);
    wake(x - 1, y, z);
    wake(x, y + 1, z);
    wake(x, y - 1, z);
    wake(x, y, z + 1);
    wake(x, y, z - 1);
  }

  /** Removes and returns the positions whose tick is due. */
  takeDue(limit = 4000): [number, number, number][] {
    const due: [number, number, number][] = [];
    for (const [key, t] of this.scheduled) {
      if (t > this.tick) continue;
      this.scheduled.delete(key);
      due.push(unpackPos(key));
      if (due.length >= limit) break;
    }
    return due;
  }

  // ---- queries -------------------------------------------------------------------------

  /** y of the highest block that stops movement or is fluid, or -1. */
  topSolid(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = c.blocks[blockIndex(x & 15, y, z & 15)];
      if (id !== 0 && (block(id).solid || isFluid(id))) return y;
    }
    return -1;
  }

  /** Whether the sky is visible straight up from this block (rain reaches it, snow settles). */
  seesSky(x: number, y: number, z: number): boolean {
    const l = this.getLight(x, y, z);
    return l >= 0 && l >> 4 === 15;
  }

  loadedChunks(): IterableIterator<Chunk> {
    return this.chunks.values();
  }
}

