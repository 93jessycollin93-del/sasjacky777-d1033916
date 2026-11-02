/**
 * World generation: a pure function from (seed, chunk coordinates) to blocks.
 *
 * Pure is the load-bearing word. Saves store only the chunks a player changed,
 * and online guests generate every untouched chunk themselves from the host's
 * seed — so anything here that depended on the order chunks were visited, or
 * on a random number drawn outside a seeded stream, would give two players
 * standing in the same place two different worlds. The tests pin this: the
 * same chunk generated twice, in any order, is byte-identical.
 *
 * Shape of the terrain, coarse to fine:
 *   continentalness → ocean, coast or inland
 *   erosion + ridges → where mountains rise and how sharp they are
 *   detail          → hills and dunes
 *   rivers          → a thin band of low noise carved down to the sea
 * Climate (temperature, humidity) is separate noise and picks the biome.
 */
import { stampStronghold, strongholdsTouching, type Stronghold } from "./stronghold";
import { dungeonsTouching, stampDungeon, type Dungeon } from "./dungeons";
import type { MapId } from "./maps";
import { B } from "./blocks";
import { BiomeId, biomeDef, foliageColor, grassColor, waterColor, type BiomeDef, type TreeKind } from "./biomes";
import { blockIndex, CHUNK_SIZE, CHUNK_VOLUME, DEEPSLATE_LEVEL, SEA_LEVEL, WORLD_HEIGHT } from "./constants";
import { Simplex } from "./noise";
import { hash4, Rng } from "./rng";
import { buildTree, type Place } from "./trees";
import { buildVillage, crowdsVillage, villagesTouching, type Terrain } from "./villages";
import type { Dimension } from "./dimension";

export type WorldType = "default" | "amplified" | "flat" | "large_biomes";

export interface GenSettings {
  seed: number;
  type: WorldType;
  /** Absent means the overworld (saves and workers from before the Nether). */
  dimension?: Dimension;
  /** Catacombs and spider caves (engine/dungeons.ts); absent means yes. */
  dungeons?: boolean;
  /** Lucky blocks scattered on the ground (engine/lucky.ts). */
  lucky?: boolean;
  /** A map pack (engine/maps.ts) the overworld is built as, instead of open terrain. */
  map?: MapId;
  /** Primal's berry bushes in the undergrowth. */
  berries?: boolean;
}

/** What the game and the workers need from any dimension's generator. */
export interface ChunkGenerator {
  readonly seed: number;
  generate(cx: number, cz: number): GeneratedChunk;
  biomeAt(x: number, z: number): number;
  tints(cx: number, cz: number): Tints;
  findSpawn(): { x: number; y: number; z: number };
}

export interface Column {
  height: number;
  biome: BiomeId;
  temperature: number;
  humidity: number;
  river: boolean;
}

export interface GeneratedChunk {
  blocks: Uint16Array;
  meta: Uint8Array;
  /** Biome id per column, x fastest. */
  biomes: Uint8Array;
}

/** Per-column tint colours: grass rgb, foliage rgb, water rgb — 9 bytes a column. */
export type Tints = Uint8Array;

const CAVE_STEP = 4;
const CAVE_NX = CHUNK_SIZE / CAVE_STEP + 1;
const CAVE_NY = WORLD_HEIGHT / CAVE_STEP + 1;
const LAVA_LEVEL = 8;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const BADLANDS_BANDS = [
  B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.TERRACOTTA, B.YELLOW_TERRACOTTA, B.BROWN_TERRACOTTA,
  B.TERRACOTTA, B.RED_TERRACOTTA, B.WHITE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.TERRACOTTA, B.RED_TERRACOTTA,
];

export class Generator implements ChunkGenerator {
  readonly seed: number;
  readonly type: WorldType;
  /** Catacombs and spider caves (engine/dungeons.ts). */
  readonly dungeons: boolean;
  /** Lucky blocks on the ground, a world of the Lucky Blocks mode. */
  readonly lucky: boolean;
  /** Primal's island: the land ringed by ocean. */
  readonly island: boolean;
  /** No villages: the Island is wild, and the Dead Zone's towns are its own (abandoned). */
  readonly noVillages: boolean;
  /** Primal's berry bushes in the undergrowth. */
  readonly berries: boolean;
  private continent: Simplex;
  private erosion: Simplex;
  private ridge: Simplex;
  private detail: Simplex;
  private riverNoise: Simplex;
  private temp: Simplex;
  private humid: Simplex;
  private rare: Simplex;
  private cheese: Simplex;
  private spagA: Simplex;
  private spagB: Simplex;
  private surface: Simplex;
  private columns = new Map<string, Column>();
  private climateScale: number;

  constructor(settings: GenSettings) {
    this.seed = settings.seed | 0;
    this.type = settings.type;
    this.dungeons = settings.dungeons !== false;
    this.lucky = settings.lucky === true;
    this.island = settings.map === "primal_island";
    this.noVillages = this.island || settings.map === "dead_zone" || settings.map === "critter_region" || settings.map === "safari_park";
    this.berries = settings.berries === true || this.island;
    const s = this.seed;
    this.continent = new Simplex(hash4(s, 1));
    this.erosion = new Simplex(hash4(s, 2));
    this.ridge = new Simplex(hash4(s, 3));
    this.detail = new Simplex(hash4(s, 4));
    this.riverNoise = new Simplex(hash4(s, 5));
    this.temp = new Simplex(hash4(s, 6));
    this.humid = new Simplex(hash4(s, 7));
    this.rare = new Simplex(hash4(s, 8));
    this.cheese = new Simplex(hash4(s, 9));
    this.spagA = new Simplex(hash4(s, 10));
    this.spagB = new Simplex(hash4(s, 11));
    this.surface = new Simplex(hash4(s, 12));
    this.climateScale = settings.type === "large_biomes" ? 4 : 1;
  }

  // ---- columns ------------------------------------------------------------------

  column(x: number, z: number): Column {
    const key = `${x},${z}`;
    const hit = this.columns.get(key);
    if (hit) return hit;
    if (this.columns.size > 40000) this.columns.clear();
    const col = this.computeColumn(x, z);
    this.columns.set(key, col);
    return col;
  }

  private computeColumn(x: number, z: number): Column {
    if (this.type === "flat") {
      return { height: 3, biome: BiomeId.Plains, temperature: 0.2, humidity: 0, river: false };
    }
    const cs = this.climateScale;
    let c = this.continent.fbm2(x / (700 * cs), z / (700 * cs), 4) * 1.25 + 0.08;
    const e = this.erosion.fbm2(x / 420, z / 420, 3);
    const ridge = 1 - Math.abs(this.ridge.fbm2(x / 240, z / 240, 4));
    const d = this.detail.fbm2(x / 48, z / 48, 3);
    // The Island: all land within a few hundred blocks, sinking to open ocean beyond.
    if (this.island) c = lerp(-1.25, Math.max(c, 0.04), 1 - smoothstep(440, 680, Math.hypot(x, z)));

    let h: number;
    if (c < -0.55) h = lerp(30, 44, smoothstep(-1.2, -0.55, c));
    else if (c < -0.25) h = lerp(44, 56, (c + 0.55) / 0.3);
    else if (c < -0.12) h = lerp(56, 63.5, (c + 0.25) / 0.13);
    else h = 64 + (c + 0.12) * 12;
    h += d * (c > -0.12 ? 5 : 2.5);

    const mountain = smoothstep(0.08, -0.45, e) * smoothstep(-0.2, 0.08, c);
    const amp = this.type === "amplified" ? 2.1 : 1;
    h += mountain * ridge * ridge * 56 * amp;
    if (this.type === "amplified" && h > 64) h = 64 + (h - 64) * 1.35;

    const temperature = this.temp.fbm2(x / (900 * cs), z / (900 * cs), 3) * 1.35 - Math.max(0, h - 82) * 0.014;
    const humidity = this.humid.fbm2(x / (800 * cs), z / (800 * cs), 3) * 1.35;

    // Rivers: the band where the river noise crosses zero, carved into a bed
    // just below sea level and blended back into the land either side.
    const rv = Math.abs(this.riverNoise.fbm2(x / 380, z / 380, 3));
    const width = 0.032;
    let river = false;
    if (rv < width && h > SEA_LEVEL - 3 && mountain < 0.55) {
      const t = rv / width;
      const bed = SEA_LEVEL - 3 + t * t * 4;
      h = lerp(bed, h, smoothstep(0.35, 1, t));
      river = t < 0.75;
    }

    const rareV = this.rare.noise2(x / (320 * cs), z / (320 * cs));
    let biome = this.pickBiome(Math.floor(h), c, mountain, temperature, humidity, river, rareV);
    if (biome === BiomeId.Badlands && h > SEA_LEVEL + 2) {
      // Mesa plateaus: terraced steps rather than rolling hills.
      const plateau = smoothstep(0.1, 0.5, this.detail.noise2(x / 90, z / 90)) * 18;
      h += Math.floor(plateau / 4) * 4;
    }
    if (h > WORLD_HEIGHT - 6) h = WORLD_HEIGHT - 6;
    if (h < 6) h = 6;
    if (biome === BiomeId.Ocean && h < SEA_LEVEL - 14) biome = BiomeId.DeepOcean;
    return { height: h, biome, temperature, humidity, river };
  }

  private pickBiome(h: number, c: number, mountain: number, t: number, hu: number, river: boolean, rare: number): BiomeId {
    const cold = t < -0.45;
    if (h < SEA_LEVEL - 1) {
      if (river) return cold ? BiomeId.FrozenRiver : BiomeId.River;
      if (cold) return BiomeId.FrozenOcean;
      return h < SEA_LEVEL - 14 ? BiomeId.DeepOcean : BiomeId.Ocean;
    }
    if (river && h <= SEA_LEVEL + 1) return cold ? BiomeId.FrozenRiver : BiomeId.River;
    if (h <= SEA_LEVEL + 2 && c < -0.05 && mountain < 0.3) return cold ? BiomeId.SnowyBeach : BiomeId.Beach;
    if (h > 96) return t < 0.15 ? BiomeId.SnowyPeaks : BiomeId.StonyPeaks;
    if (h > 84) return t < -0.25 ? BiomeId.SnowyPeaks : BiomeId.WindsweptHills;
    if (h > 76 && mountain > 0.35 && t > -0.3) return BiomeId.Meadow;
    if (cold) return hu > 0 ? BiomeId.SnowyTaiga : BiomeId.SnowyPlains;
    if (t < -0.15) return hu > -0.2 ? BiomeId.Taiga : BiomeId.Plains;
    if (t > 0.45) {
      if (hu < -0.15) return rare > 0.3 ? BiomeId.Badlands : BiomeId.Desert;
      if (hu > 0.3) return BiomeId.Jungle;
      return BiomeId.Savanna;
    }
    if (rare < -0.72 && c > 0.1) return BiomeId.MushroomFields;
    if (hu > 0.42 && h <= SEA_LEVEL + 4) return BiomeId.Swamp;
    if (hu > 0.4) return BiomeId.DarkForest;
    if (hu > 0.12) return rare > 0.25 ? BiomeId.BirchForest : BiomeId.Forest;
    if (hu > -0.12) return BiomeId.Forest;
    return rare > 0.5 ? BiomeId.SunflowerPlains : BiomeId.Plains;
  }

  /** Integer y of the top terrain block (before caves and trees). */
  surfaceY(x: number, z: number): number {
    return Math.floor(this.column(x, z).height);
  }

  biomeAt(x: number, z: number): number {
    return this.column(x, z).biome;
  }

  // ---- caves ---------------------------------------------------------------------

  private caveSample(x: number, y: number, z: number): [number, number, number] {
    return [
      this.cheese.fbm3(x / 64, y / 36, z / 64, 2),
      this.spagA.noise3(x / 42, y / 26, z / 42),
      this.spagB.noise3(x / 42, y / 26, z / 42),
    ];
  }

  private carvedFrom(cheese: number, a: number, b: number, y: number, surface: number, underwater: boolean): boolean {
    if (y <= 0) return false;
    // No carving right under a lake or the sea: an opening there would leave
    // a wall of still water hanging over a cave.
    if (underwater && y > surface - 6) return false;
    const depth = surface - y;
    if (cheese > 0.56 && depth > 7) return true;
    const tunnel = a * a + b * b;
    const width = depth < 4 ? 0.006 : 0.012;
    return tunnel < width && y < surface + 1;
  }

  /** Whether the cave field carves this exact block — the same answer generation gives. */
  isCarved(x: number, y: number, z: number): boolean {
    if (this.type === "flat") return false;
    const gx = Math.floor(x / CAVE_STEP) * CAVE_STEP, gy = Math.floor(y / CAVE_STEP) * CAVE_STEP, gz = Math.floor(z / CAVE_STEP) * CAVE_STEP;
    const tx = (x - gx) / CAVE_STEP, ty = (y - gy) / CAVE_STEP, tz = (z - gz) / CAVE_STEP;
    const v: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const dx = i & 1, dy = (i >> 1) & 1, dz = (i >> 2) & 1;
      const s = this.caveSample(gx + dx * CAVE_STEP, gy + dy * CAVE_STEP, gz + dz * CAVE_STEP);
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      v[0] += s[0] * w; v[1] += s[1] * w; v[2] += s[2] * w;
    }
    const surface = this.surfaceY(x, z);
    return this.carvedFrom(v[0], v[1], v[2], y, surface, surface < SEA_LEVEL + 1);
  }

  // ---- chunks ---------------------------------------------------------------------

  generate(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;

    if (this.type === "flat") {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        blocks[blockIndex(x, 0, z)] = B.BEDROCK;
        blocks[blockIndex(x, 1, z)] = B.DIRT;
        blocks[blockIndex(x, 2, z)] = B.DIRT;
        blocks[blockIndex(x, 3, z)] = B.GRASS;
        biomes[z * 16 + x] = BiomeId.Plains;
      }
      return { blocks, meta, biomes };
    }

    const heights = new Int16Array(256);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = this.column(x0 + x, z0 + z);
        heights[z * 16 + x] = Math.floor(col.height);
        biomes[z * 16 + x] = col.biome;
        this.fillColumn(blocks, x, z, x0 + x, z0 + z, col);
      }
    }

    this.carveCaves(blocks, heights, x0, z0);
    this.placeOres(blocks, cx, cz, biomes);
    this.decorate(blocks, cx, cz, heights, biomes);
    this.placeFeatures(blocks, meta, cx, cz);
    for (const s of strongholdsTouching(this.seed, cx, cz)) stampStronghold(s, blocks, meta, cx, cz);
    if (this.dungeons) for (const d of dungeonsTouching(this.seed, cx, cz)) stampDungeon(d, blocks, meta, cx, cz);
    this.placeVillages(blocks, meta, cx, cz);
    this.freeze(blocks, biomes);
    return { blocks, meta, biomes };
  }

  /** The villages overlapping this chunk, built after trees so their roads and houses win. */
  private placeVillages(blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number): void {
    const x0 = cx * 16, z0 = cz * 16;
    for (const v of this.villagesAt(cx, cz)) {
      buildVillage(v, this, (x, y, z, id, m = 0) => {
        const lx = x - x0, lz = z - z0;
        if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 1 || y >= WORLD_HEIGHT) return;
        const i = blockIndex(lx, y, lz);
        blocks[i] = id;
        meta[i] = m;
      });
    }
  }

  /** The strongholds reaching into a chunk, for the game to fill their chests. None in a flat world. */
  strongholdsAt(cx: number, cz: number): Stronghold[] {
    if (this.type === "flat") return [];
    return strongholdsTouching(this.seed, cx, cz);
  }

  /** The catacombs and spider caves reaching into a chunk, for the game to fill their chests. */
  dungeonsAt(cx: number, cz: number): Dungeon[] {
    if (this.type === "flat" || !this.dungeons) return [];
    return dungeonsTouching(this.seed, cx, cz);
  }

  /** The villages overlapping a chunk, for the game to populate. */
  villagesAt(cx: number, cz: number): ReturnType<typeof villagesTouching> {
    // The Island is wild: nobody lives there but what you tame; the Dead Zone's people are gone.
    if (this.type === "flat" || this.noVillages) return [];
    return villagesTouching(this, this.seed, cx, cz);
  }

  private fillColumn(blocks: Uint16Array, x: number, z: number, wx: number, wz: number, col: Column): void {
    const h = Math.floor(col.height);
    const b = biomeDef(col.biome);
    const underwater = h < SEA_LEVEL;
    const depth = 3 + Math.floor((this.surface.noise2(wx / 12, wz / 12) + 1) * 1.5);
    const slateEdge = DEEPSLATE_LEVEL + Math.floor(this.surface.noise2(wx / 7, wz / 7 + 100) * 2);
    blocks[blockIndex(x, 0, z)] = B.BEDROCK;
    for (let y = 1; y <= h; y++) {
      let id: number;
      if (y < 5 && hash4(wx, y, wz, this.seed) % 5 >= y) id = B.BEDROCK;
      else if (y < slateEdge) id = B.DEEPSLATE;
      else id = B.STONE;
      const fromTop = h - y;
      if (fromTop < depth && id === B.STONE) {
        if (col.biome === BiomeId.Badlands) {
          id = fromTop < 2 ? B.RED_SAND : BADLANDS_BANDS[((y + Math.floor(this.surface.noise2(wx / 40, wz / 40) * 2)) % BADLANDS_BANDS.length + BADLANDS_BANDS.length) % BADLANDS_BANDS.length];
        } else if (underwater) {
          id = fromTop === 0 ? this.seabed(b, wx, wz) : fromTop < 3 ? (b.underwater === B.MUD ? B.DIRT : b.underwater) : id;
        } else if (fromTop === 0) {
          id = b.top;
          if (b.id === BiomeId.StonyPeaks && (hash4(wx, wz, this.seed, 3) & 7) === 0) id = B.GRAVEL;
          if (b.id === BiomeId.WindsweptHills && h > 90) id = B.STONE;
          if ((b.id === BiomeId.Taiga || b.id === BiomeId.SnowyTaiga) && this.surface.noise2(wx / 9, wz / 9) > 0.45) id = B.PODZOL;
          if (b.id === BiomeId.DarkForest && this.surface.noise2(wx / 7, wz / 7) > 0.55) id = B.COARSE_DIRT;
        } else {
          id = b.filler;
          if (b.filler === B.SANDSTONE && fromTop < 3) id = B.SAND;
        }
      }
      blocks[blockIndex(x, y, z)] = id;
    }
    for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[blockIndex(x, y, z)] = B.WATER;
  }

  private seabed(b: BiomeDef, wx: number, wz: number): number {
    const n = this.surface.noise2(wx / 16 + 50, wz / 16);
    if (b.id === BiomeId.River || b.id === BiomeId.Swamp) return n > 0.4 ? B.CLAY : n < -0.4 ? B.GRAVEL : b.underwater;
    if (b.id === BiomeId.Ocean) return n > 0.3 ? B.SAND : n < -0.5 ? B.CLAY : B.GRAVEL;
    return b.underwater;
  }

  private carveCaves(blocks: Uint16Array, heights: Int16Array, x0: number, z0: number): void {
    // Sample the three cave fields on a coarse 4-block lattice and interpolate
    // between — a twentieth of the noise evaluations of sampling every block,
    // and the tunnels come out smoother for it.
    const grid = new Float32Array(CAVE_NX * CAVE_NY * CAVE_NX * 3);
    let maxH = 0;
    for (let i = 0; i < 256; i++) maxH = Math.max(maxH, heights[i]);
    const topCell = Math.min(CAVE_NY - 1, Math.ceil((maxH + 2) / CAVE_STEP) + 1);
    for (let gz = 0; gz < CAVE_NX; gz++) {
      for (let gx = 0; gx < CAVE_NX; gx++) {
        for (let gy = 0; gy <= topCell; gy++) {
          const s = this.caveSample(x0 + gx * CAVE_STEP, gy * CAVE_STEP, z0 + gz * CAVE_STEP);
          const o = ((gz * CAVE_NX + gx) * CAVE_NY + gy) * 3;
          grid[o] = s[0]; grid[o + 1] = s[1]; grid[o + 2] = s[2];
        }
      }
    }
    const at = (gx: number, gy: number, gz: number, k: number) => grid[((gz * CAVE_NX + gx) * CAVE_NY + gy) * 3 + k];
    for (let z = 0; z < 16; z++) {
      const gz = z >> 2, tz = (z & 3) / CAVE_STEP;
      for (let x = 0; x < 16; x++) {
        const gx = x >> 2, tx = (x & 3) / CAVE_STEP;
        const surface = heights[z * 16 + x];
        const underwater = surface < SEA_LEVEL + 1;
        for (let y = 1; y <= Math.min(surface + 1, WORLD_HEIGHT - 1); y++) {
          const gy = y >> 2, ty = (y & 3) / CAVE_STEP;
          if (gy + 1 > topCell) break;
          const v = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            const c00 = lerp(at(gx, gy, gz, k), at(gx + 1, gy, gz, k), tx);
            const c10 = lerp(at(gx, gy + 1, gz, k), at(gx + 1, gy + 1, gz, k), tx);
            const c01 = lerp(at(gx, gy, gz + 1, k), at(gx + 1, gy, gz + 1, k), tx);
            const c11 = lerp(at(gx, gy + 1, gz + 1, k), at(gx + 1, gy + 1, gz + 1, k), tx);
            v[k] = lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
          }
          if (!this.carvedFrom(v[0], v[1], v[2], y, surface, underwater)) continue;
          const i = blockIndex(x, y, z);
          const id = blocks[i];
          if (id === B.BEDROCK || id === B.WATER) continue;
          blocks[i] = y <= LAVA_LEVEL ? B.LAVA : B.AIR;
        }
      }
    }
  }

  private placeOres(blocks: Uint16Array, cx: number, cz: number, biomes: Uint8Array): void {
    const rng = new Rng(hash4(this.seed, cx, cz, 0x0e5));
    const center = biomes[8 * 16 + 8];
    const mountainous = center === BiomeId.WindsweptHills || center === BiomeId.StonyPeaks || center === BiomeId.SnowyPeaks || center === BiomeId.Meadow;
    const vein = (stoneId: number, deepId: number, tries: number, minY: number, maxY: number, size: number) => {
      for (let t = 0; t < tries; t++) {
        // Triangular distribution: veins cluster at the middle of their band.
        const y = Math.floor(minY + (rng.next() + rng.next()) / 2 * (maxY - minY));
        let x = rng.int(16), z = rng.int(16), yy = y;
        const n = Math.max(1, Math.floor(size * (0.6 + rng.next() * 0.6)));
        for (let i = 0; i < n; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && yy > 0 && yy < WORLD_HEIGHT) {
            const idx = blockIndex(x, yy, z);
            if (blocks[idx] === B.STONE) blocks[idx] = stoneId;
            else if (blocks[idx] === B.DEEPSLATE) blocks[idx] = deepId;
          }
          const dir = rng.int(6);
          if (dir === 0) x++; else if (dir === 1) x--; else if (dir === 2) z++; else if (dir === 3) z--; else if (dir === 4) yy++; else yy--;
        }
      }
    };
    vein(B.GRANITE, B.DEEPSLATE, 2, 20, 90, 28);
    vein(B.DIORITE, B.DEEPSLATE, 2, 20, 90, 28);
    vein(B.ANDESITE, B.DEEPSLATE, 2, 20, 90, 28);
    vein(B.TUFF, B.TUFF, 2, 1, 22, 24);
    vein(B.GRAVEL, B.GRAVEL, 2, 10, 90, 22);
    vein(B.DIRT, B.DEEPSLATE, 2, 20, 90, 22);
    vein(B.COAL_ORE, B.DS_COAL, 18, 20, 120, 12);
    vein(B.IRON_ORE, B.DS_IRON, 12, 4, 72, 8);
    if (mountainous) vein(B.IRON_ORE, B.DS_IRON, 8, 60, 120, 9);
    vein(B.COPPER_ORE, B.COPPER_ORE, 7, 20, 64, 10);
    vein(B.GOLD_ORE, B.DS_GOLD, 3, 2, 34, 8);
    if (center === BiomeId.Badlands) vein(B.GOLD_ORE, B.DS_GOLD, 12, 34, 90, 8);
    vein(B.REDSTONE_ORE, B.DS_REDSTONE, 6, 2, 18, 7);
    vein(B.LAPIS_ORE, B.DS_LAPIS, 2, 4, 40, 7);
    vein(B.DIAMOND_ORE, B.DS_DIAMOND, 3, 1, 17, 6);
    if (mountainous) vein(B.EMERALD_ORE, B.EMERALD_ORE, 4, 40, 120, 1);
  }

  /** Single-block plants: only ever in this chunk, so no neighbour replay is needed. */
  private decorate(blocks: Uint16Array, cx: number, cz: number, heights: Int16Array, biomes: Uint8Array): void {
    const rng = new Rng(hash4(this.seed, cx, cz, 0xdec0));
    const x0 = cx * 16, z0 = cz * 16;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = heights[z * 16 + x];
        if (h + 1 >= WORLD_HEIGHT) continue;
        const b = biomeDef(biomes[z * 16 + x]);
        const ground = blocks[blockIndex(x, h, z)];
        const above = blockIndex(x, h + 1, z);
        if (blocks[above] !== B.AIR) {
          // Lily pads float on swamp water.
          if (b.id === BiomeId.Swamp && blocks[above] === B.WATER && h >= SEA_LEVEL - 3 && rng.next() < 0.04) {
            const pad = blockIndex(x, SEA_LEVEL + 1, z);
            if (blocks[pad] === B.AIR) blocks[pad] = B.LILY_PAD;
          }
          continue;
        }
        if (this.lucky && (ground === B.GRASS || ground === B.SAND || ground === B.SNOW_BLOCK) && rng.next() < 1 / 450) {
          blocks[above] = B.LUCKY_BLOCK;
          continue;
        }
        if (this.berries && (ground === B.GRASS || ground === B.PODZOL) && rng.next() < 1 / 70) {
          blocks[above] = rng.next() < 0.72 ? B.MEJOBERRY_BUSH : B.NARCOBERRY_BUSH;
          continue;
        }
        if (ground === B.GRASS || ground === B.PODZOL || ground === B.MOSS) {
          if (b.flowerDensity > 0 && b.flowers.length) {
            const patch = this.surface.noise2((x0 + x) / 10, (z0 + z) / 10);
            if (patch > 0.3 && rng.next() < b.flowerDensity / 40) {
              const pick = Math.abs(hash4(Math.floor((x0 + x) / 6), Math.floor((z0 + z) / 6), this.seed)) % b.flowers.length;
              blocks[above] = b.flowers[pick];
              continue;
            }
          }
          if (rng.next() < b.grass / 256) {
            blocks[above] = (b.id === BiomeId.Taiga || b.id === BiomeId.SnowyTaiga || b.id === BiomeId.Jungle) && rng.next() < 0.4 ? B.FERN : B.SHORT_GRASS;
            continue;
          }
          if (rng.next() < 0.0006 && (b.id === BiomeId.Plains || b.id === BiomeId.Forest || b.id === BiomeId.Taiga)) {
            blocks[above] = B.PUMPKIN;
            continue;
          }
          if (b.id === BiomeId.Jungle && rng.next() < 0.002) { blocks[above] = B.MELON; continue; }
        }
        if (ground === B.SAND || ground === B.RED_SAND) {
          if ((b.id === BiomeId.Desert || b.id === BiomeId.Badlands) && rng.next() < 0.006) {
            blocks[above] = B.DEAD_BUSH;
            continue;
          }
          if (b.id === BiomeId.Desert && rng.next() < 0.004 && x > 0 && x < 15 && z > 0 && z < 15) {
            const tall = 1 + rng.int(3);
            for (let i = 1; i <= tall && h + i < WORLD_HEIGHT; i++) blocks[blockIndex(x, h + i, z)] = B.CACTUS;
            continue;
          }
        }
        // Sugar cane grows on the bank, beside water.
        if ((ground === B.GRASS || ground === B.SAND || ground === B.DIRT) && h === SEA_LEVEL && rng.next() < 0.18) {
          const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
            const nx = x + dx, nz = z + dz;
            return nx >= 0 && nx < 16 && nz >= 0 && nz < 16 && blocks[blockIndex(nx, h, nz)] === B.WATER;
          });
          if (nearWater) {
            const tall = 1 + rng.int(3);
            for (let i = 1; i <= tall; i++) blocks[blockIndex(x, h + i, z)] = B.SUGAR_CANE;
          }
        }
      }
    }
    // Mushrooms in the dark.
    for (let i = 0; i < 2; i++) {
      const x = rng.int(16), z = rng.int(16), y = 10 + rng.int(40);
      if (blocks[blockIndex(x, y, z)] === B.AIR && blocks[blockIndex(x, y - 1, z)] === B.STONE) {
        blocks[blockIndex(x, y, z)] = rng.next() < 0.5 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
      }
    }
  }

  /** Trees, replayed from this chunk and its eight neighbours and clipped to this chunk. */
  private placeFeatures(blocks: Uint16Array, meta: Uint8Array, cx: number, cz: number): void {
    const x0 = cx * 16, z0 = cz * 16;
    const place: Place = (x, y, z, id, m = 0, force = false) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 1 || y >= WORLD_HEIGHT) return;
      const i = blockIndex(lx, y, lz);
      const cur = blocks[i];
      if (id === B.DIRT) {
        if (cur === B.GRASS || cur === B.PODZOL) blocks[i] = B.DIRT;
        return;
      }
      const replaceable = cur === B.AIR || cur === B.SHORT_GRASS || cur === B.FERN || cur === B.SNOW || (cur >= B.DANDELION && cur <= B.LILY_OF_THE_VALLEY);
      const leafy = cur === B.OAK_LEAVES || cur === B.BIRCH_LEAVES || cur === B.SPRUCE_LEAVES || cur === B.JUNGLE_LEAVES || cur === B.ACACIA_LEAVES;
      if (replaceable || (force && leafy)) {
        blocks[i] = id;
        meta[i] = m;
      }
    };
    for (let scx = cx - 1; scx <= cx + 1; scx++) {
      for (let scz = cz - 1; scz <= cz + 1; scz++) {
        const rng = new Rng(hash4(this.seed, scx, scz, 0x7ee5));
        const attempts = 16;
        for (let t = 0; t < attempts; t++) {
          const x = scx * 16 + rng.int(16), z = scz * 16 + rng.int(16);
          const roll = rng.next();
          const kindRoll = rng.next();
          const treeSeed = rng.int(0x7fffffff);
          const col = this.column(x, z);
          const b = biomeDef(col.biome);
          if (roll >= b.trees / attempts) continue;
          const y = Math.floor(col.height);
          if (y < SEA_LEVEL || y + 16 >= WORLD_HEIGHT) continue;
          if (b.top !== B.GRASS && b.top !== B.MOSS) continue;
          if (this.isCarved(x, y, z) || this.isCarved(x, y + 1, z)) continue;
          // Village ground stays clear: a canopy left over a roof, or a trunk through a floor, looks broken.
          if (villagesTouching(this as Terrain, this.seed, x >> 4, z >> 4, 4).some((v) => crowdsVillage(v, x, z))) continue;
          const kind = pickWeighted(b.treeKinds, kindRoll);
          buildTree(kind, place, x, y + 1, z, new Rng(treeSeed));
        }
      }
    }
  }

  /** Snow on the ground and ice on the water in cold biomes. */
  private freeze(blocks: Uint16Array, biomes: Uint8Array): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const b = biomeDef(biomes[z * 16 + x]);
        if (!b.snowy) continue;
        for (let y = WORLD_HEIGHT - 2; y > 0; y--) {
          const i = blockIndex(x, y, z);
          const id = blocks[i];
          if (id === B.AIR) continue;
          if (id === B.WATER) { if (y === SEA_LEVEL) blocks[i] = B.ICE; }
          else if (id !== B.SNOW_BLOCK && id !== B.ICE && id !== B.LAVA && id !== B.CACTUS && !(id >= B.SHORT_GRASS && id <= B.SUGAR_CANE)) {
            blocks[blockIndex(x, y + 1, z)] = B.SNOW;
          } else if (id === B.SHORT_GRASS || id === B.FERN) {
            blocks[i] = B.SNOW;
          }
          break;
        }
      }
    }
  }

  // ---- tints ---------------------------------------------------------------------------

  tints(cx: number, cz: number): Tints {
    const out = new Uint8Array(256 * 9);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const col = this.column(cx * 16 + x, cz * 16 + z);
        const b = biomeDef(col.biome);
        const g = grassColor(b, col.temperature, col.humidity);
        const f = foliageColor(b, col.temperature, col.humidity);
        const w = waterColor(b);
        const o = (z * 16 + x) * 9;
        out[o] = g[0]; out[o + 1] = g[1]; out[o + 2] = g[2];
        out[o + 3] = f[0]; out[o + 4] = f[1]; out[o + 5] = f[2];
        out[o + 6] = w[0]; out[o + 7] = w[1]; out[o + 8] = w[2];
      }
    }
    return out;
  }

  /** A column near the origin that is dry land, for the first spawn. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
        const col = this.column(x, z);
        const h = Math.floor(col.height);
        if (h >= SEA_LEVEL + 1 && h < 90 && biomeDef(col.biome).top !== B.SAND || (this.type === "flat")) {
          return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: this.surfaceY(0, 0) + 1, z: 0.5 };
  }
}

function pickWeighted<T>(options: [T, number][], roll: number): T {
  let total = 0;
  for (const [, w] of options) total += w;
  let r = roll * total;
  for (const [v, w] of options) {
    r -= w;
    if (r < 0) return v;
  }
  return options[options.length - 1][0];
}

export type { TreeKind };
