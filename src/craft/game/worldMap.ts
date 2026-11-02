/**
 * The map of everywhere a player has been (after Xaero's Minimap and World
 * Map, and JourneyMap): every chunk that loads is painted into a 128×128
 * pixel region tile, a pixel a column, coloured by what tops it and shaded
 * by the slope, as the original's paper maps are. The minimap and the full
 * map (M) draw the same tiles, and the tiles are saved beside the world
 * (mapStore.ts) so the map is still there next time.
 *
 * A tile is RGBA: alpha 0 is a column nobody has seen, which the map leaves
 * dark rather than guessing at.
 */
import { buildAtlas, layerOf } from "../engine/atlas";
import { B, block, Face, faceTexture, isFluid, isRedstoneTorch } from "../engine/blocks";
import { blockIndex, WORLD_HEIGHT } from "../engine/constants";
import type { Dimension } from "../engine/dimension";
import { TEX } from "../engine/textures";

/** Chunks along a region's side; a region is REGION_PX pixels square. */
export const REGION = 8;
export const REGION_PX = REGION * 16;

export const regionKey = (dim: Dimension, rx: number, rz: number) => `${dim}:${rx},${rz}`;

/** What a chunk needs to be painted: a Chunk, or a test's stand-in for one. */
export interface PaintableChunk {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  meta: Uint8Array;
  /** Nine bytes a column: grass, foliage and water tints (engine/worldgen.ts). */
  tints: Uint8Array;
}

// ---- colours ---------------------------------------------------------------------------

const colours = new Map<number, [number, number, number]>();

/**
 * A block's colour on the map: the average of its top face's texture, as the
 * world draws it. Worked out once a block and meta, from the same painted
 * textures the renderer uses, so a new block needs no second colour kept in
 * step by hand.
 */
export function mapColor(id: number, meta: number): [number, number, number] {
  const key = id * 16 + (meta & 15);
  let c = colours.get(key);
  if (c) return c;
  const def = block(id);
  const atlas = buildAtlas();
  const layer = layerOf(faceTexture(def, meta, Face.Up));
  const px = atlas.pixels, base = layer * TEX * TEX * 4;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < TEX * TEX; i++) {
    const a = px[base + i * 4 + 3];
    if (a < 128) continue;
    r += px[base + i * 4]; g += px[base + i * 4 + 1]; b += px[base + i * 4 + 2]; n++;
  }
  c = n ? [r / n, g / n, b / n] : [128, 128, 128];
  colours.set(key, c);
  return c;
}

/** Blocks the map looks through to what is under them: they are too small to see from above. */
function seeThrough(id: number): boolean {
  if (id === B.AIR) return true;
  const def = block(id);
  return def.shape === "none" || def.shape === "wire" || (def.shape === "cross" && id !== B.SUGAR_CANE) || id === B.TORCH || isRedstoneTorch(id);
}

/**
 * The top of a column, as the map shows it: in the overworld and the End the
 * highest thing the sky sees; under the Nether's roof, the first floor below
 * the first air beneath it — so the map shows the caverns, not the ceiling.
 */
function surface(c: PaintableChunk, x: number, z: number, roofed: boolean): number {
  let y = WORLD_HEIGHT - 1;
  if (roofed) {
    y = WORLD_HEIGHT - 8;
    while (y > 0 && c.blocks[blockIndex(x, y, z)] !== B.AIR) y--;
  }
  for (; y >= 0; y--) if (!seeThrough(c.blocks[blockIndex(x, y, z)])) return y;
  return -1;
}

// ---- tiles ------------------------------------------------------------------------------

export class WorldMap {
  readonly regions = new Map<string, Uint8ClampedArray>();
  /** Bumped on each change to a region, so a drawer can tell a cached image is stale. */
  readonly versions = new Map<string, number>();
  /** Regions changed since the last save. */
  readonly dirty = new Set<string>();

  region(dim: Dimension, rx: number, rz: number, create: true): Uint8ClampedArray;
  region(dim: Dimension, rx: number, rz: number, create?: false): Uint8ClampedArray | undefined;
  region(dim: Dimension, rx: number, rz: number, create = false): Uint8ClampedArray | undefined {
    const key = regionKey(dim, rx, rz);
    let r = this.regions.get(key);
    if (!r && create) {
      r = new Uint8ClampedArray(REGION_PX * REGION_PX * 4);
      this.regions.set(key, r);
    }
    return r;
  }

  private touch(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    this.dirty.add(key);
  }

  /** Paints a chunk's 16×16 columns into its region. */
  paintChunk(dim: Dimension, c: PaintableChunk): void {
    const rx = Math.floor(c.cx / REGION), rz = Math.floor(c.cz / REGION);
    const tile = this.region(dim, rx, rz, true);
    const ox = (c.cx - rx * REGION) * 16, oz = (c.cz - rz * REGION) * 16;
    const roofed = dim === "nether";
    const heights = new Int16Array(16 * 16);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) heights[z * 16 + x] = surface(c, x, z, roofed);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const y = heights[z * 16 + x];
        const o = ((oz + z) * REGION_PX + ox + x) * 4;
        if (y < 0) {
          // Explored nothing: the End's void, a hole to the bottom.
          tile[o] = 8; tile[o + 1] = 6; tile[o + 2] = 14; tile[o + 3] = 255;
          continue;
        }
        const id = c.blocks[blockIndex(x, y, z)];
        const col = (z * 16 + x) * 9;
        let [r, g, b] = mapColor(id, c.meta[blockIndex(x, y, z)]);
        const tint = block(id).tint;
        const t = tint === "grass" ? 0 : tint === "foliage" ? 3 : tint === "water" ? 6 : -1;
        if (t >= 0) {
          r = (r * c.tints[col + t]) / 255; g = (g * c.tints[col + t + 1]) / 255; b = (b * c.tints[col + t + 2]) / 255;
        } else if (tint === "birch") { r *= 0.5; g *= 0.65; b *= 0.33; } else if (tint === "spruce") { r *= 0.38; g *= 0.6; b *= 0.38; }
        let shade = 1;
        if (id === B.WATER) {
          // Deeper water is darker, as the original's maps draw it.
          let depth = 0;
          while (depth < 12 && y - depth - 1 >= 0 && isFluid(c.blocks[blockIndex(x, y - depth - 1, z)])) depth++;
          shade = 1.05 - depth * 0.045;
        } else {
          // The slope, lit from the north-west: higher than the column to the north is brighter.
          const north = z > 0 ? heights[(z - 1) * 16 + x] : y;
          const west = x > 0 ? heights[z * 16 + x - 1] : y;
          const d = y - north + (y - west) * 0.5;
          shade = d > 0 ? 1.12 : d < 0 ? 0.82 : 1;
        }
        tile[o] = r * shade; tile[o + 1] = g * shade; tile[o + 2] = b * shade; tile[o + 3] = 255;
      }
    }
    this.touch(regionKey(dim, rx, rz));
  }

  /** A pixel of the map: [r, g, b, a], a 0 where nobody has been. */
  pixel(dim: Dimension, x: number, z: number): [number, number, number, number] {
    const rx = Math.floor(x / REGION_PX), rz = Math.floor(z / REGION_PX);
    const tile = this.region(dim, rx, rz);
    if (!tile) return [0, 0, 0, 0];
    const o = ((Math.floor(z) - rz * REGION_PX) * REGION_PX + Math.floor(x) - rx * REGION_PX) * 4;
    return [tile[o], tile[o + 1], tile[o + 2], tile[o + 3]];
  }

  /**
   * Adds regions read back from storage. What was painted since the world
   * opened is newer than what was saved, so it wins wherever it has a pixel.
   */
  merge(saved: Iterable<[string, Uint8ClampedArray]>): void {
    for (const [key, data] of saved) {
      if (data.length !== REGION_PX * REGION_PX * 4) continue;
      const here = this.regions.get(key);
      if (!here) this.regions.set(key, data);
      else for (let i = 0; i < here.length; i += 4) {
        if (here[i + 3] === 0) { here[i] = data[i]; here[i + 1] = data[i + 1]; here[i + 2] = data[i + 2]; here[i + 3] = data[i + 3]; }
      }
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    }
  }

  /** The changed regions, handed over for saving; they are clean afterwards. */
  takeDirty(): [string, Uint8ClampedArray][] {
    const out: [string, Uint8ClampedArray][] = [];
    for (const key of this.dirty) {
      const r = this.regions.get(key);
      if (r) out.push([key, r.slice()]);
    }
    this.dirty.clear();
    return out;
  }
}
