/**
 * Light: sky light and block light, 0-15 each, packed into one byte per block
 * (sky in the high nibble, block in the low).
 *
 * Both spread by flood fill, losing one level per block and more through
 * leaves and water. Sky light has one extra rule: at full strength it falls
 * straight down without losing anything, which is why a shaft to the surface
 * is bright all the way to the bottom.
 *
 * Removing light is the part that is easy to get wrong. Placing a block over a
 * torch cannot just "subtract" — the dark has to spread out from where the
 * light was, clearing every level that the removed source produced, and then
 * re-fill from whatever other sources border the cleared region. That is the
 * two-queue algorithm below; without it, lights that go out leave glowing
 * ghosts behind.
 */
import { block, BLOCK_ID_LIMIT } from "./blocks";
import { blockIndex, CHUNK_SIZE, MAX_LIGHT, WORLD_HEIGHT } from "./constants";

export interface LightVolume {
  /** Block id, or -1 when the position is not loaded (treated as a wall). */
  getBlock(x: number, y: number, z: number): number;
  /** Packed light byte, or -1 when not loaded. */
  getLight(x: number, y: number, z: number): number;
  setLight(x: number, y: number, z: number, packed: number): void;
}

export type Channel = 0 | 1; // 0 sky, 1 block

export const skyOf = (packed: number): number => packed >> 4;
export const blockOf = (packed: number): number => packed & 15;

function channelValue(packed: number, ch: Channel): number {
  return ch === 0 ? packed >> 4 : packed & 15;
}
function withChannel(packed: number, ch: Channel, v: number): number {
  return ch === 0 ? (packed & 15) | (v << 4) : (packed & 0xf0) | v;
}

// Precomputed per-block light properties, indexed by id, so the flood fill
// touches two typed arrays instead of a registry object per step.
const OPAQUE = new Uint8Array(BLOCK_ID_LIMIT);
const FILTER = new Uint8Array(BLOCK_ID_LIMIT);
const EMISSION = new Uint8Array(BLOCK_ID_LIMIT);
for (let id = 0; id < BLOCK_ID_LIMIT; id++) {
  const def = block(id);
  OPAQUE[id] = def.opaque ? 1 : 0;
  FILTER[id] = def.lightFilter;
  EMISSION[id] = def.emission;
}
export const isOpaqueId = (id: number): boolean => OPAQUE[id] === 1;
export const emissionOf = (id: number): number => EMISSION[id];

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const DOWN = 3;

/** A growable FIFO of (x, y, z, level) records. */
export class LightQueue {
  private data: Int32Array;
  private head = 0;
  private tail = 0;
  constructor(capacity = 4096) {
    this.data = new Int32Array(capacity * 4);
  }
  push(x: number, y: number, z: number, level = 0): void {
    if (this.tail + 4 > this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail + 4 > this.data.length) {
        const bigger = new Int32Array(this.data.length * 2);
        bigger.set(this.data.subarray(0, this.tail));
        this.data = bigger;
      }
    }
    const d = this.data;
    d[this.tail] = x; d[this.tail + 1] = y; d[this.tail + 2] = z; d[this.tail + 3] = level;
    this.tail += 4;
  }
  get empty(): boolean {
    return this.head >= this.tail;
  }
  /** Pops into `out` (length 4). */
  pop(out: Int32Array): void {
    const d = this.data;
    out[0] = d[this.head]; out[1] = d[this.head + 1]; out[2] = d[this.head + 2]; out[3] = d[this.head + 3];
    this.head += 4;
    if (this.head >= this.tail) this.head = this.tail = 0;
  }
}

const scratch = new Int32Array(4);

/** Spreads light outward from every queued position. */
export function propagateAdd(vol: LightVolume, queue: LightQueue, ch: Channel): void {
  while (!queue.empty) {
    queue.pop(scratch);
    const x = scratch[0], y = scratch[1], z = scratch[2];
    const here = vol.getLight(x, y, z);
    if (here < 0) continue;
    const level = channelValue(here, ch);
    if (level <= 1) continue;
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const nx = x + DX[d], nz = z + DZ[d];
      const id = vol.getBlock(nx, ny, nz);
      if (id < 0 || OPAQUE[id]) continue;
      let next = level - 1 - FILTER[id];
      if (ch === 0 && d === DOWN && level === MAX_LIGHT && FILTER[id] === 0) next = MAX_LIGHT;
      if (next <= 0) continue;
      const packed = vol.getLight(nx, ny, nz);
      if (packed < 0 || channelValue(packed, ch) >= next) continue;
      vol.setLight(nx, ny, nz, withChannel(packed, ch, next));
      queue.push(nx, ny, nz);
    }
  }
}

/**
 * Clears the light that queued removals were responsible for, and queues the
 * surviving neighbours so propagateAdd can refill the gap from them.
 */
export function propagateRemove(vol: LightVolume, removal: LightQueue, refill: LightQueue, ch: Channel): void {
  while (!removal.empty) {
    removal.pop(scratch);
    const x = scratch[0], y = scratch[1], z = scratch[2], level = scratch[3];
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const nx = x + DX[d], nz = z + DZ[d];
      const packed = vol.getLight(nx, ny, nz);
      if (packed <= 0) continue;
      const cur = channelValue(packed, ch);
      if (cur === 0) continue;
      const fellFrom = ch === 0 && d === DOWN && level === MAX_LIGHT && cur === MAX_LIGHT;
      if (cur < level || fellFrom) {
        vol.setLight(nx, ny, nz, withChannel(packed, ch, 0));
        removal.push(nx, ny, nz, cur);
      } else {
        refill.push(nx, ny, nz);
      }
    }
  }
}

const addQ = new LightQueue();
const removeQ = new LightQueue();

/** Relights around one block that changed from `oldId` to `newId`. The block is already written. */
export function relightBlock(vol: LightVolume, x: number, y: number, z: number, newId: number): void {
  for (let ch = 0 as Channel; ch <= 1; ch = (ch + 1) as Channel) {
    const packed = vol.getLight(x, y, z);
    if (packed < 0) return;
    const old = channelValue(packed, ch);
    if (old > 0) {
      vol.setLight(x, y, z, withChannel(packed, ch, 0));
      removeQ.push(x, y, z, old);
      propagateRemove(vol, removeQ, addQ, ch);
    }
    if (ch === 1 && EMISSION[newId] > 0) {
      const p = vol.getLight(x, y, z);
      vol.setLight(x, y, z, withChannel(p, 1, EMISSION[newId]));
      addQ.push(x, y, z);
    }
    if (!OPAQUE[newId]) {
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= WORLD_HEIGHT) {
          // Above the world is open sky.
          if (ch === 0 && ny >= WORLD_HEIGHT) {
            const p = vol.getLight(x, y, z);
            vol.setLight(x, y, z, withChannel(p, 0, FILTER[newId] ? MAX_LIGHT - FILTER[newId] : MAX_LIGHT));
            addQ.push(x, y, z);
          }
          continue;
        }
        const n = vol.getLight(x + DX[d], ny, z + DZ[d]);
        if (n > 0 && channelValue(n, ch) > 0) addQ.push(x + DX[d], ny, z + DZ[d]);
      }
    }
    propagateAdd(vol, addQ, ch);
  }
}

/** A single chunk as a light volume; everything outside it reads as unloaded. */
export class ChunkVolume implements LightVolume {
  constructor(
    private blocks: Uint16Array,
    private light: Uint8Array,
    private x0: number,
    private z0: number,
  ) {}
  getBlock(x: number, y: number, z: number): number {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return -1;
    return this.blocks[blockIndex(lx, y, lz)];
  }
  getLight(x: number, y: number, z: number): number {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return -1;
    return this.light[blockIndex(lx, y, lz)];
  }
  setLight(x: number, y: number, z: number, packed: number): void {
    this.light[blockIndex(x - this.x0, y, z - this.z0)] = packed;
  }
}

/**
 * Lights a freshly generated or loaded chunk on its own. Light from
 * neighbouring chunks arrives later through `seamLight`, once both exist.
 */
export function lightChunk(blocks: Uint16Array, cx: number, cz: number): Uint8Array {
  const light = new Uint8Array(blocks.length);
  const vol = new ChunkVolume(blocks, light, cx * CHUNK_SIZE, cz * CHUNK_SIZE);
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  const sky = new LightQueue(8192);
  const blk = new LightQueue(256);

  // Sky: straight down each column until something stops it.
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      let level = MAX_LIGHT;
      for (let y = WORLD_HEIGHT - 1; y >= 0 && level > 0; y--) {
        const id = blocks[blockIndex(x, y, z)];
        if (OPAQUE[id]) break;
        level = Math.max(0, level - FILTER[id]);
        light[blockIndex(x, y, z)] = level << 4;
      }
    }
  }
  // Then sideways, from every lit cell that borders a darker open one.
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const i = blockIndex(x, y, z);
        const id = blocks[i];
        if (EMISSION[id]) {
          light[i] |= EMISSION[id];
          blk.push(x0 + x, y, z0 + z);
        }
        const s = light[i] >> 4;
        if (s <= 1) continue;
        let seed = false;
        for (let d = 0; d < 6 && !seed; d++) {
          const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
          if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= WORLD_HEIGHT) continue;
          const ni = blockIndex(nx, ny, nz);
          if (!OPAQUE[blocks[ni]] && (light[ni] >> 4) < s - 1) seed = true;
        }
        if (seed) sky.push(x0 + x, y, z0 + z);
      }
    }
  }
  propagateAdd(vol, sky, 0);
  propagateAdd(vol, blk, 1);
  return light;
}

/**
 * Lets light cross the border between chunk (cx, cz) and whichever of its
 * four neighbours are loaded. Every border cell on both sides is queued and
 * the ordinary flood fill does the rest, in both directions.
 */
export function seamLight(vol: LightVolume, cx: number, cz: number, neighbours: readonly [number, number][]): void {
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  const qs: LightQueue[] = [new LightQueue(8192), new LightQueue(1024)];
  for (const [ncx, ncz] of neighbours) {
    const dx = ncx - cx, dz = ncz - cz;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let i = 0; i < CHUNK_SIZE; i++) {
        let ax: number, az: number, bx: number, bz: number;
        if (dx !== 0) {
          ax = dx > 0 ? x0 + 15 : x0; bx = ax + dx; az = bz = z0 + i;
        } else {
          az = dz > 0 ? z0 + 15 : z0; bz = az + dz; ax = bx = x0 + i;
        }
        const la = vol.getLight(ax, y, az), lb = vol.getLight(bx, y, bz);
        if (la < 0 || lb < 0) continue;
        for (const ch of [0, 1] as Channel[]) {
          const va = channelValue(la, ch), vb = channelValue(lb, ch);
          if (va > vb + 1) qs[ch].push(ax, y, az);
          else if (vb > va + 1) qs[ch].push(bx, y, bz);
        }
      }
    }
  }
  propagateAdd(vol, qs[0], 0);
  propagateAdd(vol, qs[1], 1);
}
