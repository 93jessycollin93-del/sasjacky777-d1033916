/**
 * The Nether: a cavern world between a bedrock floor and a bedrock ceiling,
 * over a sea of lava at y=31, in five biomes.
 *
 * The world here is exactly as tall as the original's Nether (128), so its
 * numbers — the lava sea, where ancient debris hides, how high fortresses
 * stand — carry over unscaled. Terrain is 3D noise sampled on a coarse grid
 * and interpolated, the way the original builds it: a sample per block would
 * cost thirty thousand noise calls a chunk for no visible difference.
 *
 * Everything is a function of the seed and the chunk's position, so every
 * chunk generates the same whichever order they are asked for in, in any
 * worker. Features that reach across a chunk edge (fungus trees, fortresses)
 * are planned from the neighbouring chunks' seeds and clipped to this one.
 */
import { B } from "./blocks";
import { BiomeId } from "./biomes";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "./constants";
import { itemByName, type ItemStack } from "./items";
import { Simplex } from "./noise";
import { hash4, Rng } from "./rng";
import type { GeneratedChunk, Tints } from "./worldgen";

export const NETHER_LAVA_LEVEL = 31;

/** Mobs a spawner can hold, by the index kept in its meta. */
export const SPAWNER_MOBS = ["blaze", "zombie", "skeleton", "spider", "silverfish"] as const;

const STEP_XZ = 4;
const STEP_Y = 8;
const NX = 16 / STEP_XZ + 1;
const NY = WORLD_HEIGHT / STEP_Y + 1;

/** Where each biome sits in the two climate noises; a column takes the nearest. */
const BIOME_POINTS: [BiomeId, number, number][] = [
  [BiomeId.NetherWastes, 0, 0],
  [BiomeId.SoulSandValley, 0, -0.42],
  [BiomeId.CrimsonForest, 0.4, 0.05],
  [BiomeId.WarpedForest, -0.05, 0.42],
  [BiomeId.BasaltDeltas, -0.42, -0.05],
];

type Place = (x: number, y: number, z: number, id: number, meta?: number) => void;

export class NetherGenerator {
  readonly seed: number;
  private shape: Simplex;
  private shape2: Simplex;
  private climateA: Simplex;
  private climateB: Simplex;
  private patch: Simplex;

  constructor(seed: number) {
    this.seed = seed | 0;
    const s = this.seed;
    this.shape = new Simplex(hash4(s, 101));
    this.shape2 = new Simplex(hash4(s, 102));
    this.climateA = new Simplex(hash4(s, 103));
    this.climateB = new Simplex(hash4(s, 104));
    this.patch = new Simplex(hash4(s, 105));
  }

  biomeAt(x: number, z: number): BiomeId {
    const a = this.climateA.fbm2(x / 260, z / 260, 2);
    const b = this.climateB.fbm2(x / 260 + 91.3, z / 260 - 37.7, 2);
    let best = BiomeId.NetherWastes, bestD = Infinity;
    for (const [id, pa, pb] of BIOME_POINTS) {
      const d = (a - pa) ** 2 + (b - pb) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /**
   * Solidity at a point: positive is rock. The floor and ceiling bias close
   * the world top and bottom; in between, the noise leaves the caverns.
   */
  private density(x: number, y: number, z: number, deltas: number): number {
    const n = this.shape.fbm3(x / 110, y / 55, z / 110, 3) + this.shape2.noise3(x / 34, y / 22, z / 34) * 0.25;
    // Gentle near the lava line so the sea spreads wide, then closing fast toward the bedrock.
    const floor = y < 34 ? Math.pow((34 - y) / 12, 1.5) : 0;
    const ceiling = y > 92 ? Math.pow((y - 92) / 22, 1.6) : 0;
    // Basalt deltas are flatter and more open: a low jagged floor under a high roof.
    return n + floor + ceiling - 0.12 - deltas * 0.18;
  }

  private columns = new Map<string, Float32Array>();

  /** The density samples down one grid column (x, z multiples of four), shared by neighbouring chunks. */
  private gridColumn(wx: number, wz: number): Float32Array {
    const key = `${wx},${wz}`;
    let col = this.columns.get(key);
    if (col) return col;
    col = new Float32Array(NY);
    const deltas = this.biomeAt(wx, wz) === BiomeId.BasaltDeltas ? 1 : 0;
    for (let gy = 0; gy < NY; gy++) col[gy] = this.density(wx, gy * STEP_Y, wz, deltas);
    if (this.columns.size > 4096) this.columns.clear();
    this.columns.set(key, col);
    return col;
  }

  /** Interpolated density at a block, computed exactly as generate() computes it. */
  private densityAt(x: number, y: number, z: number): number {
    const gx = Math.floor(x / STEP_XZ) * STEP_XZ, gz = Math.floor(z / STEP_XZ) * STEP_XZ;
    const fx = (x - gx) / STEP_XZ, fz = (z - gz) / STEP_XZ;
    const c00 = this.gridColumn(gx, gz), c10 = this.gridColumn(gx + STEP_XZ, gz);
    const c01 = this.gridColumn(gx, gz + STEP_XZ), c11 = this.gridColumn(gx + STEP_XZ, gz + STEP_XZ);
    const gy = y >> 3, fy = (y & 7) / STEP_Y;
    const d00 = c00[gy] + (c10[gy] - c00[gy]) * fx;
    const d10 = c00[gy + 1] + (c10[gy + 1] - c00[gy + 1]) * fx;
    const d01 = c01[gy] + (c11[gy] - c01[gy]) * fx;
    const d11 = c01[gy + 1] + (c11[gy + 1] - c01[gy + 1]) * fx;
    const d0 = d00 + (d10 - d00) * fy, d1 = d01 + (d11 - d01) * fy;
    return d0 + (d1 - d0) * fz;
  }

  generate(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(256);
    const x0 = cx * 16, z0 = cz * 16;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) biomes[z * 16 + x] = this.biomeAt(x0 + x, z0 + z);

    // Coarse density grid, interpolated per block.
    const grid = new Float32Array(NX * NY * NX);
    for (let gz = 0; gz < NX; gz++) for (let gx = 0; gx < NX; gx++) {
      grid.set(this.gridColumn(x0 + gx * STEP_XZ, z0 + gz * STEP_XZ), (gz * NX + gx) * NY);
    }
    const rng = new Rng(hash4(this.seed, cx, cz, 0x2e7));
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const gx = x >> 2, gz = z >> 2, fx = (x & 3) / STEP_XZ, fz = (z & 3) / STEP_XZ;
      const biome = biomes[z * 16 + x];
      const deltas = biome === BiomeId.BasaltDeltas;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        const i = blockIndex(x, y, z);
        if (y === 0 || y === WORLD_HEIGHT - 1 || (y <= 4 && rng.next() < (5 - y) / 5) || (y >= WORLD_HEIGHT - 5 && rng.next() < (y - (WORLD_HEIGHT - 6)) / 5)) {
          blocks[i] = B.BEDROCK;
          continue;
        }
        const gy = y >> 3, fy = (y & 7) / STEP_Y;
        const at = (ax: number, ay: number, az: number) => grid[((gz + az) * NX + gx + ax) * NY + gy + ay];
        const d00 = at(0, 0, 0) + (at(1, 0, 0) - at(0, 0, 0)) * fx;
        const d10 = at(0, 1, 0) + (at(1, 1, 0) - at(0, 1, 0)) * fx;
        const d01 = at(0, 0, 1) + (at(1, 0, 1) - at(0, 0, 1)) * fx;
        const d11 = at(0, 1, 1) + (at(1, 1, 1) - at(0, 1, 1)) * fx;
        const d0 = d00 + (d10 - d00) * fy, d1 = d01 + (d11 - d01) * fy;
        const d = d0 + (d1 - d0) * fz;
        if (d > 0) {
          blocks[i] = deltas ? (this.patch.noise3((x0 + x) / 9, y / 9, (z0 + z) / 9) > 0.1 ? B.BASALT : B.BLACKSTONE) : B.NETHERRACK;
        } else if (y <= NETHER_LAVA_LEVEL) blocks[i] = B.LAVA;
      }
    }

    this.surface(blocks, biomes, x0, z0);
    this.ores(blocks, rng);
    this.features(blocks, meta, biomes, cx, cz);
    for (const f of fortressesTouching(this.seed, cx, cz)) stampFortress(f, blocks, meta, cx, cz);
    return { blocks, meta, biomes };
  }

  /** Floors take their biome's ground: nylium, soul sand and soil, basalt; the wastes get gravel and soul sand by the lava. */
  private surface(blocks: Uint16Array, biomes: Uint8Array, x0: number, z0: number): void {
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const biome = biomes[z * 16 + x];
      const wx = x0 + x, wz = z0 + z;
      const patch = this.patch.noise2(wx / 14, wz / 14);
      for (let y = 1; y < WORLD_HEIGHT - 2; y++) {
        const i = blockIndex(x, y, z);
        const id = blocks[i];
        if (id !== B.NETHERRACK && id !== B.BASALT && id !== B.BLACKSTONE) continue;
        if (blocks[blockIndex(x, y + 1, z)] !== B.AIR) continue;
        switch (biome) {
          case BiomeId.CrimsonForest: if (id === B.NETHERRACK) blocks[i] = B.CRIMSON_NYLIUM; break;
          case BiomeId.WarpedForest: if (id === B.NETHERRACK) blocks[i] = B.WARPED_NYLIUM; break;
          case BiomeId.SoulSandValley: {
            const top = patch > 0 ? B.SOUL_SAND : B.SOUL_SOIL;
            for (let d = 0; d < 3 && y - d > 0; d++) {
              const j = blockIndex(x, y - d, z);
              if (blocks[j] !== B.NETHERRACK) break;
              blocks[j] = d === 0 ? top : B.SOUL_SOIL;
            }
            break;
          }
          case BiomeId.BasaltDeltas: blocks[i] = patch > 0.2 ? B.BLACKSTONE : B.BASALT; break;
          default:
            // Beaches of gravel and soul sand just above the lava, as in the original's wastes.
            if (y >= NETHER_LAVA_LEVEL - 1 && y <= NETHER_LAVA_LEVEL + 4) {
              if (patch > 0.35) blocks[i] = B.SOUL_SAND;
              else if (patch < -0.45) blocks[i] = B.GRAVEL;
            }
        }
      }
    }
  }

  private ores(blocks: Uint16Array, rng: Rng): void {
    const vein = (id: number, count: number, size: number, yMin: number, yMax: number, hidden = false) => {
      for (let v = 0; v < count; v++) {
        let x = rng.int(16), y = yMin + rng.int(yMax - yMin + 1), z = rng.int(16);
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WORLD_HEIGHT - 1) {
            const i = blockIndex(x, y, z);
            const host = blocks[i];
            if ((host === B.NETHERRACK || (id === B.ANCIENT_DEBRIS && (host === B.BASALT || host === B.BLACKSTONE))) && (!hidden || buried(blocks, x, y, z))) blocks[i] = id;
          }
          x += rng.int(3) - 1; y += rng.int(3) - 1; z += rng.int(3) - 1;
        }
      }
    };
    vein(B.NETHER_QUARTZ_ORE, 14, 9, 10, 117);
    vein(B.NETHER_GOLD_ORE, 9, 7, 10, 117);
    // Ancient debris hides where no air touches it, deep down: found by digging, not by looking.
    vein(B.ANCIENT_DEBRIS, 1, 3, 8, 22, true);
    if (rng.next() < 0.5) vein(B.ANCIENT_DEBRIS, 1, 2, 8, 119, true);
    // Magma around the lava sea's shore.
    for (let n = 0; n < 6; n++) {
      const x = rng.int(16), y = 26 + rng.int(12), z = rng.int(16);
      for (let k = 0; k < 8; k++) {
        const bx = Math.max(0, Math.min(15, x + rng.int(5) - 2)), by = y + rng.int(3) - 1, bz = Math.max(0, Math.min(15, z + rng.int(5) - 2));
        const i = blockIndex(bx, by, bz);
        if (blocks[i] === B.NETHERRACK && exposed(blocks, bx, by, bz)) blocks[i] = B.MAGMA_BLOCK;
      }
    }
  }

  private features(blocks: Uint16Array, meta: Uint8Array, biomes: Uint8Array, cx: number, cz: number): void {
    const x0 = cx * 16, z0 = cz * 16;
    // Only into air (or over plants): features never cut into the terrain they grow on.
    const place: Place = (x, y, z, id, m = 0) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y >= WORLD_HEIGHT - 1) return;
      const i = blockIndex(lx, y, lz);
      const cur = blocks[i];
      if (cur !== B.AIR && cur !== B.CRIMSON_ROOTS && cur !== B.WARPED_ROOTS && cur !== B.WEEPING_VINES && cur !== B.TWISTING_VINES) return;
      blocks[i] = id;
      meta[i] = m;
    };

    // Fungus trees reach over chunk edges, so each is planned in its own chunk and clipped into this one.
    for (let scz = cz - 1; scz <= cz + 1; scz++) for (let scx = cx - 1; scx <= cx + 1; scx++) {
      const rng = new Rng(hash4(this.seed, scx, scz, 0xf0f0));
      for (let t = 0; t < 10; t++) {
        const x = scx * 16 + rng.int(16), z = scz * 16 + rng.int(16), startY = 32 + rng.int(80);
        const treeSeed = rng.int(0x7fffffff);
        const biome = this.biomeAt(x, z);
        if (biome !== BiomeId.CrimsonForest && biome !== BiomeId.WarpedForest) continue;
        const floor = this.floorBelow(x, startY, z);
        if (floor < 0) continue;
        buildFungus(place, x, floor + 1, z, biome === BiomeId.WarpedForest, new Rng(treeSeed));
      }
    }

    const rng = new Rng(hash4(this.seed, cx, cz, 0xdec0));
    const floorAt = (lx: number, lz: number, from: number): number => {
      for (let y = from; y > 1; y--) {
        const id = blocks[blockIndex(lx, y, lz)];
        if (id !== B.AIR && id !== B.LAVA && blocks[blockIndex(lx, y + 1, lz)] === B.AIR) return y;
      }
      return -1;
    };
    const ceilingAt = (lx: number, lz: number, from: number): number => {
      for (let y = from; y < WORLD_HEIGHT - 2; y++) {
        const id = blocks[blockIndex(lx, y, lz)];
        if (id !== B.AIR && id !== B.LAVA && blocks[blockIndex(lx, y - 1, lz)] === B.AIR) return y;
      }
      return -1;
    };

    // Glowstone hangs in clusters from the ceiling.
    for (let n = 0; n < 7; n++) {
      const lx = 4 + rng.int(8), lz = 4 + rng.int(8);
      const c = ceilingAt(lx, lz, 40 + rng.int(70));
      if (c < 0 || blocks[blockIndex(lx, c, lz)] === B.BEDROCK) continue;
      const cluster: [number, number, number][] = [[lx, c - 1, lz]];
      blocks[blockIndex(lx, c - 1, lz)] = B.GLOWSTONE;
      for (let k = 0; k < 90; k++) {
        const x = lx + rng.int(7) - 3, y = c - 1 - rng.int(7), z = lz + rng.int(7) - 3;
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 2) continue;
        const i = blockIndex(x, y, z);
        if (blocks[i] !== B.AIR) continue;
        let touching = 0;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && blocks[blockIndex(nx, y + dy, nz)] === B.GLOWSTONE) touching++;
        }
        if (touching === 1) { blocks[i] = B.GLOWSTONE; cluster.push([x, y, z]); }
      }
    }

    for (let n = 0; n < 48; n++) {
      const lx = rng.int(16), lz = rng.int(16);
      const biome = biomes[lz * 16 + lx];
      const floor = floorAt(lx, lz, 40 + rng.int(80));
      const roll = rng.next();
      if (floor < 0) continue;
      const ground = blocks[blockIndex(lx, floor, lz)];
      const above = blockIndex(lx, floor + 1, lz);
      // floorAt found air above, but a fungus stem planted since may stand there now.
      if (blocks[above] !== B.AIR) continue;
      switch (biome) {
        case BiomeId.CrimsonForest:
          if (ground === B.CRIMSON_NYLIUM) blocks[above] = roll < 0.75 ? B.CRIMSON_ROOTS : roll < 0.95 ? B.CRIMSON_FUNGUS : B.WARPED_FUNGUS;
          break;
        case BiomeId.WarpedForest:
          if (ground === B.WARPED_NYLIUM) blocks[above] = roll < 0.75 ? B.WARPED_ROOTS : roll < 0.95 ? B.WARPED_FUNGUS : B.CRIMSON_FUNGUS;
          else break;
          if (roll > 0.6 && roll < 0.75) {
            // Twisting vines climb from the floor.
            const len = 1 + rng.int(8);
            for (let k = 0; k < len; k++) {
              const i = blockIndex(lx, floor + 1 + k, lz);
              if (floor + 1 + k >= WORLD_HEIGHT - 2 || (k > 0 && blocks[i] !== B.AIR)) break;
              blocks[i] = B.TWISTING_VINES;
            }
          }
          break;
        case BiomeId.SoulSandValley:
          if ((ground === B.SOUL_SOIL || ground === B.SOUL_SAND) && roll < 0.08) blocks[above] = B.SOUL_FIRE;
          break;
        case BiomeId.BasaltDeltas:
          // Columns of basalt stand in clusters on the delta floor.
          if (roll < 0.35) {
            const h = 1 + rng.int(4);
            for (let k = 1; k <= h; k++) {
              const i = blockIndex(lx, floor + k, lz);
              if (blocks[i] !== B.AIR) break;
              blocks[i] = B.BASALT;
            }
          } else if (roll < 0.45 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
            // A little lava pool in a basalt rim.
            let flat = true;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const n2 = blocks[blockIndex(lx + dx, floor, lz + dz)];
              if (n2 === B.AIR || n2 === B.LAVA || blocks[blockIndex(lx + dx, floor + 1, lz + dz)] !== B.AIR) flat = false;
            }
            if (flat) { blocks[blockIndex(lx, floor, lz)] = B.LAVA; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocks[blockIndex(lx + dx, floor, lz + dz)] = B.BASALT; }
          } else if (roll < 0.5) blocks[blockIndex(lx, floor, lz)] = B.MAGMA_BLOCK;
          break;
        default:
          if (ground === B.NETHERRACK && roll < 0.03) blocks[above] = B.FIRE;
      }
    }

    // Weeping vines hang from crimson ceilings.
    for (let n = 0; n < 14; n++) {
      const lx = rng.int(16), lz = rng.int(16);
      if (biomes[lz * 16 + lx] !== BiomeId.CrimsonForest) continue;
      const c = ceilingAt(lx, lz, 40 + rng.int(70));
      if (c < 0) continue;
      const hold = blocks[blockIndex(lx, c, lz)];
      if (hold !== B.NETHERRACK && hold !== B.NETHER_WART_BLOCK) continue;
      const len = 1 + rng.int(9);
      for (let k = 1; k <= len; k++) {
        const i = blockIndex(lx, c - k, lz);
        if (c - k < 2 || blocks[i] !== B.AIR) break;
        blocks[i] = B.WEEPING_VINES;
      }
    }

    // Soul sand valleys: basalt pillars floor to ceiling, and now and then a fossil.
    const centreBiome = biomes[8 * 16 + 8];
    if (centreBiome === BiomeId.SoulSandValley) {
      if (rng.next() < 0.35) {
        const lx = 3 + rng.int(10), lz = 3 + rng.int(10);
        const f = floorAt(lx, lz, 100);
        if (f > 0) for (let y = f + 1; y < WORLD_HEIGHT - 2 && blocks[blockIndex(lx, y, lz)] === B.AIR; y++) blocks[blockIndex(lx, y, lz)] = B.BASALT;
      }
      if (rng.next() < 0.2) {
        // A ribcage of bone blocks half buried in the sand.
        const lx = 4 + rng.int(8), lz = 4 + rng.int(4);
        const f = floorAt(lx, lz, 90);
        if (f > 0) {
          for (let k = 0; k < 8; k++) {
            blocks[blockIndex(lx, f, lz + k)] = B.BONE_BLOCK;
            meta[blockIndex(lx, f, lz + k)] = 2;
            if (k % 2 === 0) for (const side of [-2, 2]) for (let dy = 0; dy <= 2; dy++) {
              const bx = lx + side, by = f + dy;
              if (bx >= 0 && bx < 16 && blocks[blockIndex(bx, by, lz + k)] === B.AIR) blocks[blockIndex(bx, by, lz + k)] = B.BONE_BLOCK;
            }
          }
        }
      }
    }
  }

  /**
   * The floor a fungus at x,z would stand on, searching down from `from`. It
   * reads the density rather than this chunk's blocks, so a tree planned from
   * a neighbouring chunk finds the same floor that chunk generates, and the
   * two halves of a tree across the edge meet.
   */
  private floorBelow(x: number, from: number, z: number): number {
    let above = this.densityAt(x, from + 1, z) > 0;
    for (let y = from; y > NETHER_LAVA_LEVEL; y--) {
      const solid = this.densityAt(x, y, z) > 0;
      if (solid && !above) return y;
      above = solid;
    }
    return -1;
  }

  tints(): Tints {
    // Nothing in the Nether takes a biome tint; the default greens keep any stray plant sensible.
    const out = new Uint8Array(256 * 9);
    for (let i = 0; i < 256; i++) out.set([121, 192, 90, 89, 174, 48, 63, 118, 228], i * 9);
    return out;
  }

  findSpawn(): { x: number; y: number; z: number } {
    return { x: 0.5, y: 64, z: 0.5 };
  }
}

function buried(blocks: Uint16Array, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
    const id = blocks[blockIndex(nx, ny, nz)];
    if (id === B.AIR || id === B.LAVA) return false;
  }
  return true;
}

function exposed(blocks: Uint16Array, x: number, y: number, z: number): boolean {
  return !buried(blocks, x, y, z);
}

/**
 * A huge fungus: a stem four to twelve tall under a hat of wart blocks dotted
 * with shroomlights; crimson hats trail weeping vines.
 */
export function buildFungus(place: Place, x: number, y: number, z: number, warped: boolean, rng: Rng): void {
  const stem = warped ? B.WARPED_STEM : B.CRIMSON_STEM;
  const wart = warped ? B.WARPED_WART_BLOCK : B.NETHER_WART_BLOCK;
  const h = 4 + rng.int(9);
  const r = h >= 8 ? 3 : 2;
  const capH = Math.min(h - 2, 2 + rng.int(3));
  const top = y + h;
  for (let k = 0; k < h; k++) place(x, y + k, z, stem, 0);
  for (let yy = top - capH; yy <= top; yy++) {
    const rr = yy === top ? r - 1 : r;
    for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
      const rim = Math.max(Math.abs(dx), Math.abs(dz)) === rr;
      if (yy !== top && !rim) continue;
      if (rim && Math.abs(dx) === rr && Math.abs(dz) === rr && rng.next() < 0.6) continue;
      place(x + dx, yy, z + dz, rng.next() < 0.06 ? B.SHROOMLIGHT : wart, 0);
      if (!warped && yy === top - capH && rim && rng.next() < 0.3) {
        const len = 1 + rng.int(4);
        for (let k = 1; k <= len; k++) place(x + dx, yy - k, z + dz, B.WEEPING_VINES, 0);
      }
    }
  }
  place(x, top, z, wart, 0);
}

// ---- fortresses ----------------------------------------------------------------------------

/** Chunks per side of a fortress region: at most one fortress per region. */
export const FORTRESS_REGION = 12;

export type PieceKind = "bridge" | "corridor" | "crossing" | "spawner" | "wart";

export interface Piece {
  kind: PieceKind;
  /** Inclusive footprint. */
  x0: number; z0: number; x1: number; z1: number;
  /** Bridges and corridors run along x (true) or z. */
  alongX: boolean;
}

export interface Fortress {
  key: string;
  y: number;
  pieces: Piece[];
  chests: [number, number, number][];
  spawners: [number, number, number][];
  /** Bounding box of every piece, for the fortress's own mobs. */
  x0: number; z0: number; x1: number; z1: number;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The fortress planned for a region, or null. */
export function fortressInRegion(seed: number, rx: number, rz: number): Fortress | null {
  const rng = new Rng(hash4(seed, rx, rz, 0xf0e7));
  if (rng.next() > 0.7) return null;
  const X = (rx * FORTRESS_REGION + 3 + rng.int(FORTRESS_REGION - 6)) * 16 + 8;
  const Z = (rz * FORTRESS_REGION + 3 + rng.int(FORTRESS_REGION - 6)) * 16 + 8;
  const Y = 48 + rng.int(18);
  const pieces: Piece[] = [];
  const chests: [number, number, number][] = [];
  const spawners: [number, number, number][] = [];
  const room = (kind: PieceKind, cx: number, cz: number, half: number) => {
    pieces.push({ kind, x0: cx - half, z0: cz - half, x1: cx + half, z1: cz + half, alongX: true });
    if (kind === "spawner") spawners.push([cx, Y + 3, cz]);
    if (kind === "wart") chests.push([cx + half - 1, Y + 1, cz + half - 1]);
  };
  const run = (fromX: number, fromZ: number, dx: number, dz: number, length: number, enclosed: boolean): [number, number] => {
    const ex = fromX + dx * length, ez = fromZ + dz * length;
    pieces.push({
      kind: enclosed ? "corridor" : "bridge",
      x0: Math.min(fromX, ex) - (dz !== 0 ? 2 : 0), x1: Math.max(fromX, ex) + (dz !== 0 ? 2 : 0),
      z0: Math.min(fromZ, ez) - (dx !== 0 ? 2 : 0), z1: Math.max(fromZ, ez) + (dx !== 0 ? 2 : 0),
      alongX: dx !== 0,
    });
    return [ex, ez];
  };

  room("crossing", X, Z, 3);
  // Two to four arms out of the central crossing, each a long bridge to a room; rooms put
  // a blaze spawner and a wart garden in every fortress, then whatever the dice say.
  const arms = DIRS.filter(() => rng.next() < 0.75);
  while (arms.length < 2) { const d = DIRS[rng.int(4)]; if (!arms.includes(d)) arms.push(d); }
  const rooms: PieceKind[] = ["spawner", "wart"];
  arms.forEach(([dx, dz], i) => {
    const len = 22 + rng.int(18);
    const [ex, ez] = run(X + dx * 4, Z + dz * 4, dx, dz, len, rng.next() < 0.3);
    const kind = rooms[i] ?? (rng.next() < 0.5 ? "spawner" : rng.next() < 0.5 ? "wart" : "crossing");
    const half = kind === "crossing" ? 3 : 4;
    const cx = ex + dx * (half + 1), cz = ez + dz * (half + 1);
    room(kind, cx, cz, half);
    if (kind === "crossing" && rng.next() < 0.6) chests.push([cx + 2, Y + 1, cz + 2]);
    // A side branch off the far room, crosswise.
    if (rng.next() < 0.6) {
      const [sx, sz] = dx !== 0 ? [0, rng.next() < 0.5 ? 1 : -1] : [rng.next() < 0.5 ? 1 : -1, 0];
      const len2 = 12 + rng.int(14);
      const [bx, bz] = run(cx + sx * (half + 1), cz + sz * (half + 1), sx, sz, len2, rng.next() < 0.5);
      const kind2: PieceKind = rng.next() < 0.5 ? "spawner" : "wart";
      room(kind2, bx + sx * 5, bz + sz * 5, 4);
    }
  });
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (const p of pieces) { bx0 = Math.min(bx0, p.x0); bz0 = Math.min(bz0, p.z0); bx1 = Math.max(bx1, p.x1); bz1 = Math.max(bz1, p.z1); }
  return { key: `${rx},${rz}`, y: Y, pieces, chests, spawners, x0: bx0, z0: bz0, x1: bx1, z1: bz1 };
}

const fortressCache = new Map<string, Fortress | null>();

/** Fortresses whose footprint overlaps chunk (cx, cz). */
export function fortressesTouching(seed: number, cx: number, cz: number): Fortress[] {
  const out: Fortress[] = [];
  const reach = 6;
  for (let rx = Math.floor((cx - reach) / FORTRESS_REGION); rx <= Math.floor((cx + reach) / FORTRESS_REGION); rx++) {
    for (let rz = Math.floor((cz - reach) / FORTRESS_REGION); rz <= Math.floor((cz + reach) / FORTRESS_REGION); rz++) {
      const key = `${seed}:${rx},${rz}`;
      let f = fortressCache.get(key);
      if (f === undefined) {
        f = fortressInRegion(seed, rx, rz);
        if (fortressCache.size > 256) fortressCache.clear();
        fortressCache.set(key, f);
      }
      if (!f || f.x1 < cx * 16 || f.x0 > cx * 16 + 15 || f.z1 < cz * 16 || f.z0 > cz * 16 + 15) continue;
      out.push(f);
    }
  }
  return out;
}

/** Whether a point is inside a fortress, where blazes and wither skeletons spawn. */
export function inFortress(seed: number, x: number, y: number, z: number): boolean {
  for (const f of fortressesTouching(seed, Math.floor(x) >> 4, Math.floor(z) >> 4)) {
    if (y < f.y - 1 || y > f.y + 7) continue;
    if (f.pieces.some((p) => x >= p.x0 && x <= p.x1 + 1 && z >= p.z0 && z <= p.z1 + 1)) return true;
  }
  return false;
}

/** Writes this chunk's share of a fortress into its arrays. */
export function stampFortress(f: Fortress, blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number): void {
  const x0 = cx * 16, z0 = cz * 16;
  const Y = f.y;
  const inside = (x: number, z: number) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
  const set = (x: number, y: number, z: number, id: number, m = 0) => {
    if (!inside(x, z) || y < 1 || y >= WORLD_HEIGHT - 1) return;
    const i = blockIndex(x - x0, y, z - z0);
    blocks[i] = id;
    meta[i] = m;
  };
  const get = (x: number, y: number, z: number) => (inside(x, z) ? blocks[blockIndex(x - x0, y, z - z0)] : B.NETHERRACK);
  /** A leg from under the deck down to solid ground, through air and lava alike. */
  const pillar = (x: number, z: number, from: number) => {
    for (let y = from; y > 1; y--) {
      const id = get(x, y, z);
      if (id !== B.AIR && id !== B.LAVA && id !== B.FIRE) break;
      set(x, y, z, B.NETHER_BRICKS);
    }
  };

  for (const p of f.pieces) {
    if (p.x1 < x0 || p.x0 > x0 + 15 || p.z1 < z0 || p.z0 > z0 + 15) continue;
    for (let z = Math.max(p.z0, z0); z <= Math.min(p.z1, z0 + 15); z++) {
      for (let x = Math.max(p.x0, x0); x <= Math.min(p.x1, x0 + 15); x++) {
        const edgeX = x === p.x0 || x === p.x1, edgeZ = z === p.z0 || z === p.z1;
        const along = p.alongX ? x - p.x0 : z - p.z0;
        const side = p.alongX ? edgeZ : edgeX;
        switch (p.kind) {
          case "bridge": {
            set(x, Y, z, B.NETHER_BRICKS);
            for (let y = Y + 1; y <= Y + 4; y++) set(x, y, z, B.AIR);
            if (side) set(x, Y + 1, z, B.NETHER_BRICK_FENCE);
            // Arches every seven blocks, on legs down to the ground.
            if (along % 7 === 3) { set(x, Y - 1, z, B.NETHER_BRICKS); if (side) pillar(x, z, Y - 2); }
            break;
          }
          case "corridor": {
            set(x, Y, z, B.NETHER_BRICKS);
            set(x, Y + 5, z, B.NETHER_BRICKS);
            for (let y = Y + 1; y <= Y + 4; y++) {
              const window = (y === Y + 2 || y === Y + 3) && along % 3 === 1;
              set(x, y, z, side ? (window ? B.NETHER_BRICK_FENCE : B.NETHER_BRICKS) : B.AIR);
            }
            if (along % 7 === 3 && side) pillar(x, z, Y - 1);
            break;
          }
          case "crossing": {
            set(x, Y, z, B.NETHER_BRICKS);
            for (let y = Y + 1; y <= Y + 4; y++) set(x, y, z, B.AIR);
            // Fence posts at the corners only: the arms meet it on every side.
            if (edgeX && edgeZ) set(x, Y + 1, z, B.NETHER_BRICK_FENCE);
            if (edgeX && edgeZ) pillar(x, z, Y - 1);
            break;
          }
          case "spawner": {
            const cxp = (p.x0 + p.x1) >> 1, czp = (p.z0 + p.z1) >> 1;
            const r = Math.max(Math.abs(x - cxp), Math.abs(z - czp));
            set(x, Y, z, B.NETHER_BRICKS);
            for (let y = Y + 1; y <= Y + 5; y++) set(x, y, z, B.AIR);
            if (r <= 2) set(x, Y + 1, z, B.NETHER_BRICKS);
            if (r <= 1) set(x, Y + 2, z, B.NETHER_BRICKS);
            // Steps up the dais from each side.
            if (r === 3 && (x === cxp || z === czp)) {
              const facing = x === cxp ? (z < czp ? 1 : 0) : (x < cxp ? 3 : 2);
              set(x, Y + 1, z, B.NETHER_BRICK_STAIRS, facing);
            }
            if (r === 0) set(x, Y + 3, z, B.SPAWNER, 0);
            if ((edgeX || edgeZ) && !(x === cxp || z === czp)) set(x, Y + 1, z, B.NETHER_BRICK_FENCE);
            if (edgeX && edgeZ) pillar(x, z, Y - 1);
            break;
          }
          case "wart": {
            const wall = edgeX || edgeZ;
            const cxp = (p.x0 + p.x1) >> 1, czp = (p.z0 + p.z1) >> 1;
            const door = (x === cxp || z === czp) && wall;
            set(x, Y, z, B.NETHER_BRICKS);
            set(x, Y + 6, z, B.NETHER_BRICKS);
            for (let y = Y + 1; y <= Y + 5; y++) {
              const window = !door && y === Y + 3 && (x + z) % 2 === 0;
              set(x, y, z, wall && !(door && y <= Y + 3) ? (window ? B.NETHER_BRICK_FENCE : B.NETHER_BRICKS) : B.AIR);
            }
            // Beds of soul sand along two sides, their wart at every stage.
            const bed = !wall && (x === p.x0 + 1 || x === p.x1 - 1) && z > p.z0 + 1 && z < p.z1 - 1;
            if (bed) {
              set(x, Y + 1, z, B.SOUL_SAND);
              set(x, Y + 2, z, B.NETHER_WART, hash4(f.y, x, z) & 3);
            }
            if (edgeX && edgeZ) pillar(x, z, Y - 1);
            break;
          }
        }
      }
    }
  }
  for (const [x, y, z] of f.chests) {
    if (inside(x, z)) set(x, y, z, B.CHEST, 0);
  }
}

/** What a fortress chest holds: gold, iron, a diamond or two, wart, and now and then gear. */
export function fortressLoot(items: (ItemStack | null)[], seed: number): void {
  const rng = new Rng(seed);
  const table: [string, number, number, number][] = [
    ["diamond", 1, 3, 0.25], ["iron_ingot", 1, 5, 0.5], ["gold_ingot", 1, 3, 0.6], ["golden_sword", 1, 1, 0.2],
    ["golden_chestplate", 1, 1, 0.2], ["flint_and_steel", 1, 1, 0.2], ["nether_wart", 3, 7, 0.4], ["obsidian", 2, 4, 0.2],
    ["gold_nugget", 3, 9, 0.4],
  ];
  for (const [name, lo, hi, chance] of table) {
    if (rng.next() >= chance) continue;
    const slot = rng.int(items.length);
    if (items[slot]) continue;
    items[slot] = { id: itemByName(name).id, count: lo + rng.int(hi - lo + 1) };
  }
}
