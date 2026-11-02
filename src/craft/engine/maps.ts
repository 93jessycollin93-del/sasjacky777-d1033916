/**
 * Map packs: whole worlds built for a game mode rather than grown from noise
 * — the islands of SkyBlock, the lone block of OneBlock, a parkour course in
 * the sky, a colosseum for waves of monsters, the layered floors of TNT Run,
 * the arena of the Survival Games (real terrain with a cornucopia at its
 * heart), Primal's Island (a land ringed by sea, its three obelisks
 * standing over it), the Dead Zone (abandoned towns, a hospital and a
 * military base on real terrain) and the zombie bunker (rooms behind doors
 * that cost points, boarded windows, wall buys). Each is laid out from the seed alone, so every worker and every
 * friend in the world builds the same one, and stamped chunk by chunk as the
 * world generates, like the other structures.
 *
 * A map that keeps natural terrain wraps the ordinary generator and lays its
 * pieces over it; the rest are void with their pieces floating in it.
 */
import { B, WOOL_COLORS } from "./blocks";
import { BiomeId, biomeDef, foliageColor, grassColor, waterColor } from "./biomes";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "./constants";
import { itemByName, type ItemStack } from "./items";
import { hash4, Rng } from "./rng";
import type { ChunkGenerator, GeneratedChunk, Generator, Tints } from "./worldgen";
import type { CasinoGame } from "./casino";
import { cityOf, STREET, type City } from "./city";
import { CORDON, countyOf, type County } from "./county";
import type { ShopKind } from "./shops";

export const MAP_IDS = ["skyblock", "oneblock", "void", "parkour", "colosseum", "tnt_run", "sg_arena", "primal_island", "dead_zone", "zombie_bunker", "critter_region", "safari_park", "battle_spire", "high_roller", "neon_bay", "golden_coast", "county"] as const;
export type MapId = (typeof MAP_IDS)[number];
export const isMapId = (v: unknown): v is MapId => typeof v === "string" && (MAP_IDS as readonly string[]).includes(v);

export interface MapInfo {
  name: string;
  description: string;
}

export const MAPS: Record<MapId, MapInfo> = {
  skyblock: { name: "SkyBlock", description: "A little L of dirt, a tree and a chest, hanging over the void. A sand island waits across the gap." },
  oneblock: { name: "OneBlock", description: "One block in the void. Break it, and it comes back as something else." },
  void: { name: "The Void", description: "A single platform in an empty world: a blank page for building." },
  parkour: { name: "Parkour Paradise", description: "A course of jumps in the sky, four stages hard, with gold checkpoints and a diamond finish." },
  colosseum: { name: "The Colosseum", description: "A sand-floored arena ringed in stone, with four gates the waves come through." },
  tnt_run: { name: "TNT Run Floors", description: "Three floors of wool over the void. Every block you step on falls away." },
  sg_arena: { name: "Survival Games Arena", description: "Real terrain around a cornucopia of chests, twelve spawn pads, and loot hidden in the wild." },
  primal_island: { name: "The Island", description: "An island some fourteen hundred blocks across, ringed by open sea, with three great obelisks. You wake on its southern beach." },
  dead_zone: { name: "The Dead Zone", description: "Three abandoned towns, a hospital, and a military base to the north — real terrain, overrun." },
  zombie_bunker: { name: "The Bunker", description: "A concrete bunker on a slab in the sky: a start room, two more behind doors, boarded windows, and guns on the walls." },
  critter_region: { name: "The Critter Region", description: "Six towns up one long road — four gyms, the League at the end, trainers on every route — and a summit above it all." },
  safari_park: { name: "The Safari Park", description: "A fenced park of meadow, pond, grove, rocks and marsh, full of critters to catch." },
  battle_spire: { name: "The Battle Spire", description: "A round arena at the top of a spire, where challengers step up one after another." },
  high_roller: { name: "The Golden Stonk", description: "A casino floor: rows of slots, blackjack and roulette tables, a video poker bar, the wheel and the Stonks terminal." },
  neon_bay: { name: "Neon Bay", description: "An island city some five hundred blocks across: a beach strip of pastel hotels, a glass downtown, docks, a park, and a casino — with traffic, people and a car of your own." },
  county: { name: "Ashgrove County", description: "A sealed-off county on a river: five towns of furnished houses and shops, farms, a lake, an army camp, and the quarantine fence round it all." },
  golden_coast: { name: "Golden Coast", description: "San Yeeto: desert, a casino strip glittering out of the sand, suburbs of lawns and palms, a downtown of towers, docks and a beach — with traffic, people and a car of your own." },
};

/** Loot tables a map's chests are filled from (see mapLoot). */
export type MapLoot = "skyblock_start" | "skyblock_sand" | "sg_center" | "sg_wild" | "arena_gear" | "dz_house" | "dz_medical" | "dz_military";

/** Something for sale in the zombie bunker: a gun on the wall, the mystery box, a perk, or a door. */
export interface Buy {
  kind: "gun" | "box" | "perk" | "door";
  name: string;
  price: number;
  /** The pad to stand on (and sneak) to buy, as the block the buyer stands on. */
  pad: [number, number, number];
  /** A gun's item. */
  item?: string;
  /** A door's blocks, cleared when it is bought. */
  door?: [number, number, number][];
}

/** A boarded window of the zombie bunker: its boards, the pad inside to repair them from, and where the infected gather outside. */
export interface BunkerWindow {
  boards: [number, number, number][];
  pad: [number, number, number];
  spawn: [number, number, number];
}

export interface MapLayout {
  map: MapId;
  spawn: [number, number, number];
  /** Blocks by chunk ("cx,cz"), flat as x, y, z, id, meta. */
  blocks: Map<string, number[]>;
  chests: [number, number, number, MapLoot][];
  /** Keeps the ordinary terrain under the map's pieces. */
  terrain: boolean;
  /** OneBlock: the block that comes back. */
  oneBlock?: [number, number, number];
  /** Parkour: the checkpoint pads in order (the start first); the finish pad last. */
  checkpoints?: [number, number, number][];
  /** Survival Games: the pads the players and tributes start on. Colosseum: the gates the waves come through. */
  pads?: [number, number, number][];
  /** Where a mode's border centres, and how wide the play area is. */
  center: [number, number];
  radius: number;
  /** Falling below this is out (void maps). */
  floorY: number;
  /** TNT Run: the floors' heights, top first. */
  floors?: number[];
  /** The zombie bunker's wall buys, box, perk and doors, and its windows. */
  buys?: Buy[];
  windows?: BunkerWindow[];
  /** The critter modes: named areas and the levels of the critters met there (the region's routes and towns, the park's corners). */
  areas?: CritterArea[];
  /** Where the map's trainers stand, and which way they watch the road. */
  npcs?: { id: string; x: number; y: number; z: number; yaw: number }[];
  /** The legend's perch: the region's summit. */
  legend?: [number, number, number];
  /** Casino machines and tables: every block of each, and the game it plays. */
  casino?: { game: CasinoGame; x: number; y: number; z: number }[];
  /** A city built chunk by chunk from the seed (engine/city.ts), rather than from `blocks`. */
  city?: City;
  /** Shop counters: every block of each, and the shop it opens. */
  shops?: { shop: ShopKind; x: number; y: number; z: number }[];
  /** A county built chunk by chunk from the seed (engine/county.ts). */
  county?: County;
}

/** A named stretch of a critter map. */
export interface CritterArea {
  name: string;
  x0: number; z0: number; x1: number; z1: number;
  /** Wild critters here are of these levels. */
  levels: [number, number];
  /** Whose critters live here, whatever the land underfoot (a park's pond, a cave). */
  biome?: string;
  /** No wild critters at all: a town. */
  quiet?: boolean;
}

class Plan {
  readonly blocks = new Map<string, number[]>();
  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (y < 1 || y >= WORLD_HEIGHT - 1) return;
    const k = `${x >> 4},${z >> 4}`;
    let list = this.blocks.get(k);
    if (!list) { list = []; this.blocks.set(k, list); }
    list.push(x, y, z, id, meta);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0): void {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, id, meta);
  }
}

const wool = (color: (typeof WOOL_COLORS)[number]) => B.WHITE_WOOL + WOOL_COLORS.indexOf(color);

/** An oak: a five-log trunk and a round crown, as the islands start with. */
function oak(p: Plan, x: number, y: number, z: number): void {
  for (let dy = 0; dy < 5; dy++) p.set(x, y + dy, z, B.OAK_LOG);
  for (let dy = 3; dy <= 6; dy++) {
    const r = dy >= 5 ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if ((dx || dz || dy > 4) && !(Math.abs(dx) === 2 && Math.abs(dz) === 2)) p.set(x + dx, y + dy, z + dz, B.OAK_LEAVES);
    }
  }
}

function skyblock(): Omit<MapLayout, "map"> {
  const p = new Plan();
  // The classic L: three layers, grass on top, a block of bedrock under where you stand.
  for (let x = 0; x <= 5; x++) for (let z = 0; z <= 5; z++) {
    if (x >= 3 && z >= 3) continue;
    p.set(x, 60, z, x === 1 && z === 1 ? B.BEDROCK : B.DIRT);
    p.set(x, 61, z, B.DIRT);
    p.set(x, 62, z, B.GRASS);
  }
  oak(p, 4, 63, 1);
  p.set(0, 63, 5, B.CHEST, 1);
  // The sand island, far enough to need a bridge.
  for (let x = 60; x <= 62; x++) for (let z = 0; z <= 2; z++) { p.set(x, 60, z, B.SANDSTONE); p.set(x, 61, z, B.SAND); p.set(x, 62, z, B.SAND); }
  p.set(62, 63, 2, B.CACTUS);
  p.set(60, 63, 0, B.CHEST, 1);
  return {
    spawn: [1.5, 63, 1.5], blocks: p.blocks, terrain: false, center: [2, 2], radius: 400, floorY: 0,
    chests: [[0, 63, 5, "skyblock_start"], [60, 63, 0, "skyblock_sand"]],
  };
}

function oneblock(): Omit<MapLayout, "map"> {
  const p = new Plan();
  p.set(0, 64, 0, B.GRASS);
  return { spawn: [0.5, 65, 0.5], blocks: p.blocks, terrain: false, chests: [], oneBlock: [0, 64, 0], center: [0, 0], radius: 400, floorY: 0 };
}

function voidMap(): Omit<MapLayout, "map"> {
  const p = new Plan();
  p.box(-2, 64, -2, 2, 64, 2, B.SMOOTH_STONE);
  return { spawn: [0.5, 65, 0.5], blocks: p.blocks, terrain: false, chests: [], center: [0, 0], radius: 2000, floorY: 0 };
}

/** One jump of the parkour course: the gap to clear, the step up or down, and what the landing is made of. */
export interface Jump { gap: number; dy: number; block: number }

/**
 * The course's jumps, stage by stage. Every jump is one this game's physics
 * can make (craft-modes.test.ts sprint-jumps each kind): a gap of up to three
 * on the level, two when stepping up a block, four when dropping one.
 */
export function parkourJumps(seed: number): Jump[] {
  const rng = new Rng(hash4(seed, 0x9a4c));
  const out: Jump[] = [];
  const stages: [number, () => Jump][] = [
    [12, () => ({ gap: 1 + rng.int(2), dy: rng.next() < 0.4 ? 1 : 0, block: B.OAK_PLANKS })],
    [12, () => { const dy = [-1, 0, 1][rng.int(3)]; return { gap: dy > 0 ? 2 : 2 + rng.int(2), dy, block: B.STONE_BRICKS }; }],
    [12, () => { const dy = rng.next() < 0.5 ? -1 : 0; return { gap: dy < 0 ? 3 + rng.int(2) : 2 + rng.int(2), dy, block: rng.next() < 0.3 ? B.PACKED_ICE : B.QUARTZ_BLOCK }; }],
    [12, () => { const dy = rng.next() < 0.35 ? 1 : 0; return { gap: dy > 0 ? 2 : 3, dy, block: B.OBSIDIAN }; }],
  ];
  for (const [n, make] of stages) {
    for (let i = 0; i < n; i++) {
      const j = make();
      // A climbing jump from ice would slide off: keep ice for the level and the drops.
      if (j.block === B.PACKED_ICE && j.dy > 0) j.dy = 0;
      out.push(j);
    }
  }
  return out;
}

function parkour(seed: number): Omit<MapLayout, "map"> {
  const p = new Plan();
  const rng = new Rng(hash4(seed, 0x51de));
  let x = 0, y = 100, z = 0;
  // The start: a pad of gold, with a railing of glass so a new runner does not step off backwards.
  p.box(-2, y, -2, 2, y, 2, B.GOLD_BLOCK);
  for (let i = -2; i <= 2; i++) p.set(i, y + 1, -3, B.GLASS);
  const checkpoints: [number, number, number][] = [[0, y + 1, 0]];
  const jumps = parkourJumps(seed);
  let minY = y;
  jumps.forEach((j, i) => {
    // Mostly forward, drifting a little to the side, never back on itself.
    // A sideways step lengthens the jump, so only the shorter jumps take one.
    const side = j.gap <= 2 && j.dy <= 0 && rng.next() < 0.35 ? (rng.next() < 0.5 ? -1 : 1) : 0;
    z += j.gap + 1;
    x += side;
    y += j.dy;
    minY = Math.min(minY, y);
    const pad = (i + 1) % 12 === 0;
    if (pad) {
      p.box(x - 1, y, z - 1, x + 1, y, z + 1, i === jumps.length - 1 ? B.DIAMOND_BLOCK : B.GOLD_BLOCK);
      p.set(x, y + 1, z + 1, B.LANTERN);
      checkpoints.push([x, y + 1, z]);
      z += 1;
    } else p.set(x, y, z, j.block);
  });
  return {
    spawn: [0.5, 101, 0.5], blocks: p.blocks, terrain: false, chests: [], checkpoints,
    center: [0, Math.round(z / 2)], radius: z, floorY: minY - 12,
  };
}

function colosseum(): Omit<MapLayout, "map"> {
  const p = new Plan();
  const R = 22, Y = 64;
  const gates: [number, number, number][] = [];
  for (let x = -R - 8; x <= R + 8; x++) for (let z = -R - 8; z <= R + 8; z++) {
    const d = Math.hypot(x, z);
    if (d > R + 8) continue;
    for (let y = Y - 6; y < Y; y++) p.set(x, y, z, y === Y - 6 ? B.BEDROCK : B.STONE);
    if (d <= R) p.set(x, Y, z, (x + z) % 7 === 0 ? B.SANDSTONE : B.SAND);
    else if (d <= R + 2) {
      // The wall, with a gate at each point of the compass.
      const gate = (Math.abs(x) <= 1 && Math.abs(z) > R - 1) || (Math.abs(z) <= 1 && Math.abs(x) > R - 1);
      p.set(x, Y, z, B.STONE_BRICKS);
      for (let y = Y + 1; y <= Y + 7; y++) p.set(x, y, z, gate && y <= Y + 3 ? B.AIR : y === Y + 7 ? B.CHISELED_STONE_BRICKS : (x * 3 + y + z) % 11 === 0 ? B.MOSSY_STONE_BRICKS : B.STONE_BRICKS);
      if (gate) p.set(x, Y + 4, z, B.IRON_BARS);
    } else {
      // Terraced seats for a crowd that never comes.
      const tier = Math.floor(d - R - 2);
      p.set(x, Y, z, B.STONE_BRICKS);
      for (let y = Y + 1; y <= Y + 7 + tier; y++) p.set(x, y, z, y === Y + 7 + tier ? B.STONE_BRICK_SLAB : B.STONE_BRICKS);
    }
  }
  for (const [gx, gz] of [[0, -(R + 5)], [R + 5, 0], [0, R + 5], [-(R + 5), 0]]) {
    // A tunnel behind each gate, where the monsters wait.
    const ax = Math.sign(gx), az = Math.sign(gz);
    for (let s = R + 1; s <= R + 7; s++) for (let w = -1; w <= 1; w++) for (let y = Y + 1; y <= Y + 3; y++) {
      p.set(ax * s + (az !== 0 ? w : 0), y, az * s + (ax !== 0 ? w : 0), B.AIR);
    }
    gates.push([ax * (R + 5), Y + 1, az * (R + 5)]);
  }
  for (const [lx, lz] of [[R - 1, R - 8], [-(R - 1), -(R - 8)], [R - 8, -(R - 1)], [-(R - 8), R - 1]]) p.set(lx, Y + 1, lz, B.LANTERN);
  p.set(2, Y + 1, 2, B.CHEST, 0);
  return {
    spawn: [0.5, Y + 1, 0.5], blocks: p.blocks, terrain: false, chests: [[2, Y + 1, 2, "arena_gear"]], pads: gates,
    center: [0, 0], radius: R, floorY: Y - 10,
  };
}

function tntRun(): Omit<MapLayout, "map"> {
  const p = new Plan();
  const floors = [90, 84, 78];
  const colors = [wool("yellow"), wool("orange"), wool("red")];
  floors.forEach((y, i) => {
    for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) p.set(x, y, z, (x + z) % 2 === 0 ? colors[i] : wool(i === 0 ? "lime" : i === 1 ? "magenta" : "purple"));
  });
  return { spawn: [0.5, 91, 0.5], blocks: p.blocks, terrain: false, chests: [], floors, center: [0, 0], radius: 15, floorY: 70 };
}

/**
 * Primal's Island. The generator shapes the land itself (worldgen.ts sinks
 * everything past a radius into the sea); the map adds the three obelisks —
 * red, green and blue, as on the Island — and wakes you on the southern beach.
 */
function primalIsland(base: Generator): Omit<MapLayout, "map"> {
  const p = new Plan();
  const obelisks: [number, number, number][] = [[0, -280, wool("red")], [-242, 140, wool("green")], [242, 140, wool("blue")]];
  for (const [ox, oz, color] of obelisks) {
    const y = Math.max(64, base.surfaceY(ox, oz));
    // A stepped plinth of obsidian, a column of its colour, and a lantern crown seen from far off.
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const edge = Math.max(Math.abs(dx), Math.abs(dz));
      for (let yy = y - 4; yy <= y + (edge <= 2 ? 2 : 1); yy++) p.set(ox + dx, yy, oz + dz, B.OBSIDIAN);
    }
    for (let yy = y + 3; yy <= y + 34; yy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      p.set(ox + dx, yy, oz + dz, (yy - y) % 8 === 0 ? B.SEA_LANTERN : color);
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) p.set(ox + dx, y + 35, oz + dz, B.GLOWSTONE);
  }
  // The south beach: coming in from the open sea, the first dry ground (a river inland is not the coast).
  let sz = 300;
  for (let z = 780; z > 300; z -= 2) {
    if (base.surfaceY(0, z) >= 63) { sz = z - 3; break; }
  }
  const sy = Math.max(63, base.surfaceY(0, sz)) + 1;
  return { spawn: [0.5, sy, sz + 0.5], blocks: p.blocks, terrain: true, chests: [], center: [0, 0], radius: 700, floorY: -64 };
}

/**
 * A house of the Dead Zone, on the ground at (x0, z0): a foundation where the
 * ground falls away, a plank floor, walls with a door and windows (a few
 * blocks long gone), a flat roof, and a chest somebody never came back for.
 */
function ruin(p: Plan, base: Generator, rng: Rng, x0: number, z0: number, w: number, d: number, wall: number, chests: MapLayout["chests"], table: MapLoot, count = 1): void {
  const y = base.surfaceY(x0 + (w >> 1), z0 + (d >> 1)) + 1;
  for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
    const s = base.surfaceY(x, z);
    for (let yy = Math.min(s, y - 1); yy < y; yy++) p.set(x, yy, z, B.COBBLE);
    p.set(x, y, z, B.OAK_PLANKS);
    const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
    for (let yy = y + 1; yy <= y + 3; yy++) p.set(x, yy, z, edge && rng.next() > 0.06 ? wall : B.AIR);
    p.set(x, y + 4, z, rng.next() < 0.08 ? B.AIR : B.COBBLE_SLAB);
    for (let yy = y + 5; yy <= y + 9; yy++) p.set(x, yy, z, B.AIR);
  }
  // The door on the south side, windows east and west.
  const dx = x0 + (w >> 1);
  p.set(dx, y + 1, z0 + d - 1, B.AIR); p.set(dx, y + 2, z0 + d - 1, B.AIR);
  p.set(x0, y + 2, z0 + (d >> 1), B.GLASS_PANE); p.set(x0 + w - 1, y + 2, z0 + (d >> 1), B.GLASS_PANE);
  for (let i = 0; i < count; i++) {
    const cx = x0 + 1 + i * 2, cz = z0 + 1;
    p.set(cx, y + 1, cz, B.CHEST);
    chests.push([cx, y + 1, cz, table]);
  }
  if (rng.next() < 0.5) p.set(x0 + w - 2, y + 1, z0 + 1, B.CRAFTING_TABLE);
}

/** A town: two gravel roads crossing, and houses along them. */
function town(p: Plan, base: Generator, rng: Rng, cx: number, cz: number, houses: number, chests: MapLayout["chests"]): void {
  // Below sea level the surface is a seabed or a riverbed: no road runs along it.
  const road = (x: number, z: number) => { const y = base.surfaceY(x, z); if (y >= 63) p.set(x, y, z, B.GRAVEL); };
  for (let i = -34; i <= 34; i++) for (const w of [-1, 0, 1]) { road(cx + i, cz + w); road(cx + w, cz + i); }
  const lots: [number, number][] = [[-12, -12], [4, -12], [-12, 4], [4, 4], [-26, -12], [18, -12], [-26, 4], [18, 4], [-12, -26], [4, 20]];
  const walls = [B.COBBLE, B.OAK_PLANKS, B.BRICKS, B.STONE_BRICKS, B.SPRUCE_PLANKS];
  lots.slice(0, houses).forEach(([ox, oz]) => {
    // The outer lots lie past what dryNear checked; a house there with a corner in the sea stood as a cobble slab over the water.
    if ([[0, 0], [9, 0], [0, 8], [9, 8]].some(([dx, dz]) => base.surfaceY(cx + ox + dx, cz + oz + dz) < 63)) return;
    ruin(p, base, rng, cx + ox, cz + oz, 7 + rng.int(3), 6 + rng.int(2), walls[rng.int(walls.length)], chests, "dz_house", 1 + rng.int(2));
  });
}

/** Dry, fairly level ground near (x, z): a town is not built in the sea. */
function dryNear(base: Generator, x: number, z: number): [number, number] {
  for (let r = 0; r <= 240; r += 12) {
    for (let a = 0; a < Math.max(1, r / 4); a++) {
      const t = (a / Math.max(1, r / 4)) * Math.PI * 2;
      const cx = Math.round(x + Math.cos(t) * r), cz = Math.round(z + Math.sin(t) * r);
      const h = base.surfaceY(cx, cz);
      if (h < 64 || h > 90) continue;
      // Dry across the whole plot, not just its middle.
      if ([[-16, 0], [16, 0], [0, -16], [0, 16]].every(([dx, dz]) => base.surfaceY(cx + dx, cz + dz) >= 63)) return [cx, cz];
    }
  }
  return [x, z];
}

function deadZone(seed: number, base: Generator): Omit<MapLayout, "map"> {
  const p = new Plan();
  const rng = new Rng(hash4(seed, 0xdead));
  const chests: MapLayout["chests"] = [];
  const home = base.findSpawn();
  const [t0x, t0z] = dryNear(base, Math.floor(home.x), Math.floor(home.z));
  const towns: [number, number, number][] = [
    [t0x, t0z, 10],
    [...dryNear(base, t0x + 230 + rng.int(40), t0z - 140 + rng.int(60)), 8],
    [...dryNear(base, t0x - 210 - rng.int(40), t0z + 170 + rng.int(40)), 8],
  ];
  for (const [x, z, n] of towns) town(p, base, rng, x, z, n, chests);
  // The hospital, at the main town's edge: white walls, a red cross over the door, three cabinets of medicine.
  const hx = t0x + 22, hz = t0z + 18;
  ruin(p, base, rng, hx, hz, 13, 9, B.WHITE_WOOL, chests, "dz_medical", 3);
  const hy = base.surfaceY(hx + 6, hz + 4) + 1;
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]]) p.set(hx + 6 + dx, hy + 3 + dy, hz + 9, wool("red"));
  // The military base, north: a fenced compound on levelled ground, barracks, tents and a helipad.
  const [mx, mz] = dryNear(base, t0x + rng.int(60) - 30, t0z - 320 - rng.int(40));
  const my = base.surfaceY(mx, mz) + 1;
  for (let x = mx - 20; x <= mx + 20; x++) for (let z = mz - 20; z <= mz + 20; z++) {
    const s = base.surfaceY(x, z);
    for (let yy = Math.min(s, my - 1); yy < my; yy++) p.set(x, yy, z, B.COARSE_DIRT);
    for (let yy = my; yy <= my + 8; yy++) p.set(x, yy, z, B.AIR);
    const edge = Math.abs(x - mx) === 20 || Math.abs(z - mz) === 20;
    const gate = z === mz + 20 && Math.abs(x - mx) <= 2;
    if (edge && !gate) { p.set(x, my, z, B.IRON_BARS); p.set(x, my + 1, z, B.IRON_BARS); }
  }
  const barracksY = my - 1;
  for (let x = mx - 12; x <= mx - 2; x++) for (let z = mz - 14; z <= mz - 8; z++) {
    const edge = x === mx - 12 || x === mx - 2 || z === mz - 14 || z === mz - 8;
    p.set(x, barracksY, z, B.SMOOTH_STONE);
    for (let yy = barracksY + 1; yy <= barracksY + 3; yy++) p.set(x, yy, z, edge ? B.STONE_BRICKS : B.AIR);
    p.set(x, barracksY + 4, z, B.STONE_BRICK_SLAB);
  }
  p.set(mx - 7, barracksY + 1, mz - 8, B.AIR); p.set(mx - 7, barracksY + 2, mz - 8, B.AIR);
  for (const cx of [mx - 10, mx - 7, mx - 4]) { p.set(cx, barracksY + 1, mz - 13, B.CHEST); chests.push([cx, barracksY + 1, mz - 13, "dz_military"]); }
  for (const [tx, tz] of [[mx + 6, mz - 10], [mx + 6, mz + 4]]) {
    // A tent: an A-frame of green wool over a chest.
    for (let dz = 0; dz < 5; dz++) for (let dx = -2; dx <= 2; dx++) {
      const h = 2 - Math.abs(dx);
      p.set(tx + dx, my + h, tz + dz, wool("green"));
    }
    p.set(tx, my, tz + 2, B.CHEST);
    chests.push([tx, my, tz + 2, "dz_military"]);
  }
  for (let x = mx - 12; x <= mx - 4; x++) for (let z = mz + 4; z <= mz + 12; z++) p.set(x, my - 1, z, B.SMOOTH_STONE);
  for (const [dx, dz] of [[-10, 6], [-10, 7], [-10, 8], [-10, 9], [-10, 10], [-6, 6], [-6, 7], [-6, 8], [-6, 9], [-6, 10], [-9, 8], [-8, 8], [-7, 8]]) p.set(mx + dx, my - 1, mz + dz, wool("yellow"));
  // You come to on dry ground south of the main town, within sight of its roofs.
  const [sx, sz] = dryNear(base, t0x, t0z + 50);
  return { spawn: [sx + 0.5, base.surfaceY(sx, sz) + 1, sz + 0.5], blocks: p.blocks, terrain: true, chests, center: [t0x, t0z - 100], radius: 600, floorY: -64 };
}

/**
 * The zombie bunker (after Call of Duty's zombies): a slab in the sky, a
 * start room with two more behind doors, windows boarded with fences the
 * infected tear down (and players board up again), guns on the walls, a
 * mystery box and a perk.
 */
function zombieBunker(): Omit<MapLayout, "map"> {
  const p = new Plan();
  const Y = 64;
  // The slab and a stone yard round the building, where the infected come from.
  p.box(-34, Y - 1, -22, 34, Y - 1, 22, B.BEDROCK);
  p.box(-34, Y, -22, 34, Y, 22, B.STONE);
  // The building: floor, outer walls four high, and the two inner walls with their doors.
  p.box(-23, Y, -7, 23, Y, 7, B.SMOOTH_STONE);
  for (let x = -23; x <= 23; x++) for (let z = -7; z <= 7; z++) {
    const outer = Math.abs(x) === 23 || Math.abs(z) === 7;
    const inner = Math.abs(x) === 8;
    if (!outer && !inner) continue;
    for (let y = Y + 1; y <= Y + 4; y++) p.set(x, y, z, B.STONE_BRICKS);
  }
  for (const [x, z] of [[-4, -6], [4, -6], [-4, 6], [4, 6], [-16, -6], [16, 6], [-16, 6], [16, -6]]) p.set(x, Y + 3, z, B.LANTERN);
  const buys: Buy[] = [];
  const doorBlocks = (x: number): [number, number, number][] => [-1, 0, 1].flatMap((z) => [1, 2, 3].map((dy): [number, number, number] => [x, Y + dy, z]));
  for (const x of [-8, 8]) for (const [bx, by, bz] of doorBlocks(x)) p.set(bx, by, bz, B.OAK_PLANKS);
  buys.push({ kind: "door", name: "West door", price: 750, pad: [-7, Y, 0], door: doorBlocks(-8) });
  buys.push({ kind: "door", name: "East door", price: 750, pad: [7, Y, 0], door: doorBlocks(8) });
  // Wall buys on gold pads; the mystery box on emerald; the perk on redstone.
  const pad = (x: number, z: number, id: number) => p.set(x, Y, z, id);
  pad(6, -5, B.GOLD_BLOCK); buys.push({ kind: "gun", name: "Shotgun", item: "shotgun", price: 500, pad: [6, Y, -5] });
  pad(-6, 5, B.GOLD_BLOCK); buys.push({ kind: "gun", name: "Pistol rounds", item: "pistol", price: 250, pad: [-6, Y, 5] });
  pad(-20, 5, B.GOLD_BLOCK); buys.push({ kind: "gun", name: "Assault rifle", item: "assault_rifle", price: 1200, pad: [-20, Y, 5] });
  pad(20, -5, B.GOLD_BLOCK); buys.push({ kind: "gun", name: "Hunting rifle", item: "hunting_rifle", price: 1000, pad: [20, Y, -5] });
  pad(20, 5, B.EMERALD_BLOCK); buys.push({ kind: "box", name: "Mystery box", price: 950, pad: [20, Y, 5] });
  pad(-20, -5, B.REDSTONE_BLOCK); buys.push({ kind: "perk", name: "Tough Skin", price: 2500, pad: [-20, Y, -5] });
  // Windows: a gap two high in the outer wall, boarded with fences; the pad inside, the gathering point outside.
  const windows: BunkerWindow[] = [];
  for (const [x, side] of [[-3, -1], [3, 1], [0, 1], [-16, -1], [-16, 1], [16, -1], [16, 1]] as const) {
    const z = side * 7;
    const boards: [number, number, number][] = [[x, Y + 1, z], [x, Y + 2, z]];
    for (const [bx, by, bz] of boards) p.set(bx, by, bz, B.OAK_FENCE);
    windows.push({ boards, pad: [x, Y, z - side], spawn: [x + 0.5, Y + 1, z + side * 12 + 0.5] });
  }
  return { spawn: [0.5, Y + 1, 0.5], blocks: p.blocks, terrain: false, chests: [], center: [0, 0], radius: 34, floorY: Y - 10, buys, windows };
}

// ---- the critter modes ----------------------------------------------------------------------------------------------

/** Which way a trainer faces to look at (dx, dz): the yaw a mob turns to (Mob.faceTo). */
const facing = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/**
 * A building of the critter region on the ground at (x0, z0): a foundation where
 * the land falls away, a floor, walls with a doorway on one side and windows,
 * a roof. Returns the floor's height (what stands on it stands one above).
 */
function critterHouse(p: Plan, base: Generator, x0: number, z0: number, w: number, d: number, door: "north" | "south" | "east" | "west",
  wall: number, roof: number, floor: number = B.OAK_PLANKS, height = 4): number {
  const y = base.surfaceY(x0 + (w >> 1), z0 + (d >> 1)) + 1;
  for (let x = x0 - 1; x <= x0 + w; x++) for (let z = z0 - 1; z <= z0 + d; z++) {
    const s = base.surfaceY(x, z);
    const inside = x >= x0 && x < x0 + w && z >= z0 && z < z0 + d;
    // A step of ground all round, so the door never opens onto a drop.
    for (let yy = Math.min(s, y - 1); yy < y; yy++) p.set(x, yy, z, inside ? B.COBBLE : B.GRASS);
    for (let yy = y; yy <= y + height + 4; yy++) p.set(x, yy, z, B.AIR);
    if (!inside) continue;
    p.set(x, y - 1, z, floor);
    const edge = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
    for (let yy = y; yy < y + height; yy++) if (edge) p.set(x, yy, z, wall);
    p.set(x, y + height, z, roof);
  }
  // The doorway, in the middle of its side; windows along the other walls.
  const mx = x0 + (w >> 1), mz = z0 + (d >> 1);
  const dx = door === "west" ? x0 : door === "east" ? x0 + w - 1 : mx;
  const dz = door === "north" ? z0 : door === "south" ? z0 + d - 1 : mz;
  for (const yy of [y, y + 1]) p.set(dx, yy, dz, B.AIR);
  if (door !== "west") p.set(x0, y + 1, mz, B.GLASS_PANE);
  if (door !== "east") p.set(x0 + w - 1, y + 1, mz, B.GLASS_PANE);
  if (door !== "north") p.set(mx, y + 1, z0, B.GLASS_PANE);
  if (door !== "south") p.set(mx, y + 1, z0 + d - 1, B.GLASS_PANE);
  p.set(mx, y + height - 1, mz, B.LANTERN);
  return y;
}

/** A gym's colours: its walls, roof and floor, by the type it keeps to. */
const GYM_LOOK: Record<string, [number, number, number]> = {
  stone: [B.STONE_BRICKS, B.STONE_BRICK_SLAB, B.SMOOTH_STONE],
  water: [wool("light_blue"), B.LAPIS_BLOCK, B.PACKED_ICE],
  electric: [B.YELLOW_TERRACOTTA, B.GOLD_BLOCK, B.SMOOTH_STONE],
  spirit: [B.BLACKSTONE, B.OBSIDIAN, B.BLACKSTONE],
};

/**
 * The critter region (after the monster-collecting games' regions): six places
 * up one long road north — Home Town with the professor's lab, four towns each
 * with a gym, and the League — every town with a healing station, trainers
 * along every route, the rival waiting at three turns of the road, and above
 * it all a summit where the legend perches. Real terrain; the road crosses
 * water on a bridge.
 */
function critterRegion(seed: number, base: Generator): Omit<MapLayout, "map"> {
  const p = new Plan();
  const rng = new Rng(hash4(seed, 0xc417));
  const home = base.findSpawn();
  const towns: [number, number][] = [dryNear(base, Math.floor(home.x), Math.floor(home.z))];
  for (let i = 1; i < 6; i++) {
    const [px, pz] = towns[i - 1];
    towns.push(dryNear(base, px + rng.int(81) - 40, pz - 150));
  }
  const npcs: NonNullable<MapLayout["npcs"]> = [];
  const areas: CritterArea[] = [];
  const TOWN_NAMES = ["Home Town", "Granite Town", "Tide Town", "Static Town", "Lantern Town", "the League"];
  const ROUTES: [string, [number, number]][] = [["Route 1", [2, 5]], ["Route 2", [8, 13]], ["Route 3", [16, 24]], ["Route 4", [28, 36]], ["Victory Road", [38, 46]]];
  const ROUTE_TRAINERS = [["r1_tom", "r1_ivy", "rival1"], ["r2_finn", "r2_coral", "r2_sol"], ["r3_rowan", "r3_selene", "rival2", "r3_gus"], ["r4_jun", "r4_lin", "r4_reyes"], []];
  /** Team Copium by route: an id, how far along the road, and which side of it (0: in the road). */
  const COPIUM: [string, number, number][][] = [[], [["tc_grunt1", 0.38, -1]], [["tc_grunt2", 0.3, -1], ["tc_hank", 0.7, 1]], [["tc_grunt3", 0.375, 1], ["tc_dana", 0.625, -1]], [["tc_ceo", 0.5, 0]]];

  // The road, town to town: gravel three wide on the ground, planks where it crosses water, cleared above.
  for (let i = 0; i < 5; i++) {
    const [ax, az] = towns[i], [bx, bz] = towns[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = 0; t <= len; t += 0.5) {
      const cx = ax + ux * t, cz = az + uz * t;
      for (const w of [-1, 0, 1]) {
        const x = Math.round(cx - uz * w), z = Math.round(cz + ux * w);
        const sy = base.surfaceY(x, z);
        const y = Math.max(sy, 63);
        p.set(x, y, z, sy < 63 ? B.OAK_PLANKS : B.GRAVEL);
        for (let yy = y + 1; yy <= y + 4; yy++) p.set(x, yy, z, B.AIR);
      }
      // Lamps down the roadside, every so often.
      if (Math.round(t * 2) % 36 === 0 && t > 20 && t < len - 20) {
        const lx = Math.round(cx - uz * 2.5), lz = Math.round(cz + ux * 2.5);
        const ly = Math.max(base.surfaceY(lx, lz), 63) + 1;
        p.set(lx, ly, lz, B.OAK_FENCE); p.set(lx, ly + 1, lz, B.OAK_FENCE); p.set(lx, ly + 2, lz, B.LANTERN);
      }
    }
    // The route's trainers stand beside the road and watch across it; a rival stands in it, facing whoever comes up it.
    const ids = ROUTE_TRAINERS[i];
    ids.forEach((id, k) => {
      const f = (k + 1) / (ids.length + 1);
      const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f;
      const side = k % 2 === 0 ? 1 : -1;
      const onRoad = id.startsWith("rival");
      const x = Math.round(cx - uz * (onRoad ? 0 : side * 3)), z = Math.round(cz + ux * (onRoad ? 0 : side * 3));
      const y = Math.max(base.surfaceY(x, z), 63) + 1;
      npcs.push({ id, x: x + 0.5, y, z: z + 0.5, yaw: onRoad ? facing(-ux, -uz) : facing(uz * side, -ux * side) });
    });
    // Team Copium stands between the route's own trainers (their places are unchanged); the CEO blocks Victory Road itself.
    for (const [id, f, side] of COPIUM[i]) {
      const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f;
      const x = Math.round(cx - uz * side * 3), z = Math.round(cz + ux * side * 3);
      const y = Math.max(base.surfaceY(x, z), 63) + 1;
      npcs.push({ id, x: x + 0.5, y, z: z + 0.5, yaw: side === 0 ? facing(-ux, -uz) : facing(uz * side, -ux * side) });
    }
    const [name, levels] = ROUTES[i];
    areas.push({ name, x0: Math.min(ax, bx) - 60, z0: Math.min(az, bz) - 20, x1: Math.max(ax, bx) + 60, z1: Math.max(az, bz) + 20, levels });
  }

  // The towns: a healing station in each, a gym in four, the professor's lab in the first, the League last.
  const gymTypes = ["stone", "water", "electric", "spirit"];
  const gymIds = [["g1_dale", "g1_brom"], ["g2_kai", "g2_marina"], ["g3_ohm", "g3_volta"], ["g4_veil"]];
  towns.forEach(([cx, cz], i) => {
    areas.unshift({ name: TOWN_NAMES[i], x0: cx - 32, z0: cz - 32, x1: cx + 32, z1: cz + 32, levels: [2, 5], quiet: true });
    if (i < 5) {
      // The healing station: a white hall with a red roof, east of the road, its door facing it.
      const hy = critterHouse(p, base, cx + 4, cz - 4, 9, 7, "west", B.WHITE_WOOL, wool("red"), B.QUARTZ_BLOCK);
      p.set(cx + 11, hy, cz - 1, B.HEALING_STATION);
      p.set(cx + 11, hy, cz - 3, B.LANTERN);
      // Two houses for the people who live here.
      critterHouse(p, base, cx + 4, cz + 8, 7, 6, "west", rng.next() < 0.5 ? B.OAK_PLANKS : B.BRICKS, B.OAK_SLAB);
      critterHouse(p, base, cx - 12, cz + 9, 7, 6, "east", rng.next() < 0.5 ? B.SPRUCE_PLANKS : B.COBBLE, B.COBBLE_SLAB);
    }
    if (i === 0) {
      // The professor's lab, west of the road: a quartz hall with the professor inside, facing the door.
      const ly = critterHouse(p, base, cx - 16, cz - 6, 11, 9, "east", B.QUARTZ_BLOCK, B.SMOOTH_STONE, B.QUARTZ_BLOCK);
      for (const [dx, dz] of [[1, 1], [1, 7], [3, 1], [3, 7]]) p.set(cx - 16 + dx, ly, cz - 6 + dz, B.BOOKSHELF);
      npcs.push({ id: "professor", x: cx - 13.5, y: ly, z: cz - 1.5, yaw: facing(1, 0) });
    } else if (i < 5) {
      // The gym, west of the road, in its type's colours: its trainers in the aisle, its leader at the back.
      const [wall, roof, floor] = GYM_LOOK[gymTypes[i - 1]];
      const gy = critterHouse(p, base, cx - 20, cz - 7, 15, 11, "east", wall, roof, floor, 6);
      const ids = gymIds[i - 1];
      const leader = ids[ids.length - 1];
      npcs.push({ id: leader, x: cx - 18.5, y: gy, z: cz - 1.5, yaw: facing(1, 0) });
      if (ids.length > 1) npcs.push({ id: ids[0], x: cx - 12.5, y: gy, z: cz - 4.5, yaw: facing(0, 1) });
      for (const dz of [-5, 3]) p.set(cx - 17, gy, cz + dz, B.LANTERN);
    } else {
      // The League: a great hall of quartz and gold at the road's end, the rival at its door and the Champion within.
      const gy = critterHouse(p, base, cx - 9, cz - 22, 19, 17, "south", B.QUARTZ_BLOCK, B.GOLD_BLOCK, B.QUARTZ_BLOCK, 7);
      for (let z = cz - 20; z <= cz - 7; z++) p.set(cx, gy - 1, z, wool("red"));
      p.set(cx - 5, gy, cz - 8, B.HEALING_STATION);
      npcs.push({ id: "rival3", x: cx + 0.5, y: gy, z: cz - 8.5, yaw: facing(0, 1) });
      npcs.push({ id: "league_aria", x: cx + 0.5, y: gy, z: cz - 19.5, yaw: facing(0, 1) });
      areas.unshift({ name: "the League", x0: cx - 12, z0: cz - 25, x1: cx + 12, z1: cz - 3, levels: [40, 46], quiet: true });
    }
  });

  // The summit: the highest ground near the League, crowned with ice, where the legend waits.
  const [lx, lz] = towns[5];
  let peak: [number, number, number] = [lx + 40, base.surfaceY(lx + 40, lz), lz];
  for (let x = lx - 160; x <= lx + 160; x += 8) for (let z = lz - 160; z <= lz + 60; z += 8) {
    const h = base.surfaceY(x, z);
    if (h > peak[1]) peak = [x, h, z];
  }
  const [px, py, pz] = peak;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    const r = Math.hypot(x, z);
    if (r > 4.5) continue;
    for (let yy = base.surfaceY(px + x, pz + z) + 1; yy <= py; yy++) p.set(px + x, yy, pz + z, B.PACKED_ICE);
    p.set(px + x, py + 1, pz + z, r > 3.5 ? B.PACKED_ICE : B.SNOW_BLOCK);
    for (let yy = py + 2; yy <= py + 8; yy++) p.set(px + x, yy, pz + z, B.AIR);
    if (r > 3.5 && (x + z) % 3 === 0) { p.set(px + x, py + 2, pz + z, B.PACKED_ICE); p.set(px + x, py + 3, pz + z, B.ICE); }
  }
  areas.unshift({ name: "the Summit", x0: px - 10, z0: pz - 10, x1: px + 10, z1: pz + 10, levels: [45, 50], quiet: true });

  // Every trainer outdoors stands in a clearing: out of the trees, on grass, where a passer-by can see them.
  for (const n of npcs) {
    const nx = Math.floor(n.x), nz = Math.floor(n.z);
    // Indoors (the lab, the gyms, the League) and on the road itself (the rival), the ground is already right.
    if (n.id === "professor" || n.id.startsWith("g") || n.id === "league_aria" || n.id.startsWith("rival") || n.id === "tc_ceo") continue;
    for (let x = nx - 1; x <= nx + 1; x++) for (let z = nz - 1; z <= nz + 1; z++) {
      const sy = base.surfaceY(x, z);
      if (sy >= 63) p.set(x, sy, z, B.GRASS);
      for (let yy = Math.max(sy, 63) + 1; yy <= Math.max(sy, 63) + 6; yy++) p.set(x, yy, z, B.AIR);
    }
  }
  const [sx, sz] = towns[0];
  const sy = Math.max(base.surfaceY(sx, sz + 6), 63) + 1;
  return {
    spawn: [sx + 0.5, sy, sz + 6.5], blocks: p.blocks, terrain: true, chests: [], center: [sx, sz - 350], radius: 900, floorY: -64,
    areas, npcs, legend: [px + 0.5, py + 2, pz + 0.5],
  };
}

/**
 * The Safari Park (after the monster-collecting games' safari zones): a fenced
 * park on real ground, its corners given over to meadow, pond, grove and
 * rocks — each with its own critters — and a marsh in the middle. No battles:
 * throw orbs, bait and mud, and catch what you can before the time runs out.
 */
function safariPark(seed: number, base: Generator): Omit<MapLayout, "map"> {
  const p = new Plan();
  const rng = new Rng(hash4(seed, 0x5afa));
  const s = base.findSpawn();
  const [cx, cz] = dryNear(base, Math.floor(s.x), Math.floor(s.z));
  const R = 70;
  // The fence: two high all round, a gate in the south side.
  for (let t = -R; t <= R; t++) {
    for (const [x, z] of [[cx + t, cz - R], [cx + t, cz + R], [cx - R, cz + t], [cx + R, cz + t]]) {
      if (z === cz + R && Math.abs(x - cx) <= 2) continue;
      const y = Math.max(base.surfaceY(x, z), 62) + 1;
      p.set(x, y, z, B.OAK_FENCE); p.set(x, y + 1, z, B.OAK_FENCE);
      if (t % 12 === 0) p.set(x, y + 2, z, B.LANTERN);
    }
  }
  // The pond, north-east: water dug into the ground, reeds at its edge.
  const [ox, oz] = [cx + 35, cz - 35];
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    const r = Math.hypot(x, z);
    if (r > 12) continue;
    const y = base.surfaceY(ox + x, oz + z);
    if (r < 10.5) { for (let yy = y - 2; yy <= y; yy++) p.set(ox + x, yy, oz + z, B.WATER); for (let yy = y + 1; yy <= y + 3; yy++) p.set(ox + x, yy, oz + z, B.AIR); }
    else if (rng.next() < 0.4) { p.set(ox + x, y, oz + z, B.SAND); p.set(ox + x, y + 1, oz + z, B.SUGAR_CANE); }
  }
  // The rocks, south-east: boulders of stone and cobble.
  for (let i = 0; i < 14; i++) {
    const bx = cx + 20 + rng.int(40), bz = cz + 20 + rng.int(40), by = base.surfaceY(bx, bz) + 1, r = 1 + rng.int(3);
    for (let x = -r; x <= r; x++) for (let y = 0; y <= r; y++) for (let z = -r; z <= r; z++) {
      if (Math.hypot(x, y * 1.3, z) <= r + 0.3) p.set(bx + x, by + y, bz + z, rng.next() < 0.3 ? B.COBBLE : rng.next() < 0.5 ? B.ANDESITE : B.STONE);
    }
  }
  // The meadow, north-west: flowers everywhere.
  const FLOWERS = [B.DANDELION, B.POPPY, B.CORNFLOWER, B.ALLIUM, B.OXEYE_DAISY];
  for (let i = 0; i < 260; i++) {
    const fx = cx - 60 + rng.int(58), fz = cz - 60 + rng.int(58), fy = base.surfaceY(fx, fz);
    if (fy >= 63) p.set(fx, fy + 1, fz, FLOWERS[rng.int(FLOWERS.length)]);
  }
  // The marsh, in the middle: mud and shallow pools.
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
    if (Math.hypot(x, z) > 10) continue;
    const y = base.surfaceY(cx + x, cz + z);
    p.set(cx + x, y, cz + z, (x * 7 + z * 3) % 5 === 0 ? B.WATER : B.MUD);
  }
  // The gatehouse: the keeper's hut inside the gate, with a healing station.
  const gy = critterHouse(p, base, cx + 4, cz + R - 12, 7, 6, "west", B.SPRUCE_PLANKS, B.OAK_SLAB);
  p.set(cx + 9, gy, cz + R - 9, B.HEALING_STATION);
  const areas: CritterArea[] = [
    { name: "the Marsh", x0: cx - 12, z0: cz - 12, x1: cx + 12, z1: cz + 12, levels: [10, 22], biome: "Swamp" },
    { name: "the Meadow", x0: cx - R, z0: cz - R, x1: cx, z1: cz, levels: [5, 20], biome: "Meadow" },
    { name: "the Pond", x0: cx, z0: cz - R, x1: cx + R, z1: cz, levels: [8, 24], biome: "Beach" },
    { name: "the Grove", x0: cx - R, z0: cz, x1: cx, z1: cz + R, levels: [6, 22], biome: "Dark Forest" },
    { name: "the Rocks", x0: cx, z0: cz, x1: cx + R, z1: cz + R, levels: [10, 26], biome: "Stony Peaks" },
  ];
  const sy = Math.max(base.surfaceY(cx, cz + R - 4), 63) + 1;
  return { spawn: [cx + 0.5, sy, cz + R - 3.5], blocks: p.blocks, terrain: true, chests: [], center: [cx, cz], radius: R, floorY: -64, areas };
}

/**
 * The Battle Spire (after the battle towers of the monster-collecting
 * games): a round floor at the top of a spire over the void, a healing
 * station, a gold pad to step on for the next challenger, and the spot they
 * step up to.
 */
function battleSpire(): Omit<MapLayout, "map"> {
  const p = new Plan();
  const Y = 100;
  for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) {
    const r = Math.hypot(x, z);
    if (r > 16.5) continue;
    p.set(x, Y - 1, z, B.QUARTZ_BLOCK);
    p.set(x, Y, z, r > 15.5 ? B.GLASS : Math.abs(r - 10) < 0.6 ? B.GOLD_BLOCK : B.SMOOTH_STONE);
    if (r > 15.5) { p.set(x, Y + 1, z, B.GLASS); p.set(x, Y + 2, z, B.GLASS); }
  }
  // The spire itself, falling away beneath.
  for (let y = Y - 40; y < Y - 1; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (Math.abs(x) === 3 || Math.abs(z) === 3) p.set(x, y, z, B.QUARTZ_BLOCK);
  for (const [x, z] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
    for (let y = Y + 1; y <= Y + 5; y++) p.set(x, y, z, B.QUARTZ_BLOCK);
    p.set(x, Y + 6, z, B.SEA_LANTERN);
  }
  p.set(0, Y, 2, B.EMERALD_BLOCK);
  p.set(0, Y + 1, 12, B.HEALING_STATION);
  return {
    spawn: [0.5, Y + 1, 8.5], blocks: p.blocks, terrain: false, chests: [], center: [0, 0], radius: 16, floorY: Y - 45,
    // The pad the player steps on for a battle; where the challenger steps up to.
    pads: [[0, Y, 2], [0, Y + 1, -6]],
  };
}

/** Letters five blocks tall in a three-wide pixel font, for signs made of blocks. */
const SIGN_FONT: Record<string, string[]> = {
  S: ["###", "#..", "###", "..#", "###"], T: ["###", ".#.", ".#.", ".#.", ".#."], O: ["###", "#.#", "#.#", "#.#", "###"],
  N: ["#.#", "##.", "#.#", "#.#", "#.#"], K: ["#.#", "##.", "#..", "##.", "#.#"], G: ["###", "#..", "#.#", "#.#", "###"],
  L: ["#..", "#..", "#..", "#..", "###"], D: ["##.", "#.#", "#.#", "#.#", "##."], E: ["###", "#..", "##.", "#..", "###"],
  C: ["###", "#..", "#..", "#..", "###"], A: ["###", "#.#", "###", "#.#", "#.#"], I: ["###", ".#.", ".#.", ".#.", "###"],
  " ": ["...", "...", "...", "...", "..."], "$": [".#.", "###", "##.", ".##", "###"],
};

/** Writes a word in blocks on a wall that faces along z, left to right in +x, its baseline at y. */
function signWord(p: Plan, word: string, x0: number, y: number, z: number, id: number): void {
  let x = x0;
  for (const ch of word) {
    const rows = SIGN_FONT[ch] ?? SIGN_FONT[" "];
    rows.forEach((row, r) => [...row].forEach((c, i) => { if (c === "#") p.set(x + i, y + 4 - r, z, id); }));
    x += 4;
  }
}

/**
 * The Golden Stonk: a casino floor in the sky. Red carpet with gold, quartz
 * walls, lights in the ceiling; rows of slot machines, blackjack and
 * roulette tables, a video poker bar along one wall, the wheel on another,
 * and the Stonks terminal's chart glowing on a third. Every block of a
 * machine or table is listed with the game it plays, so using any of them
 * sits the player down at it.
 */
function casinoFloor(): Omit<MapLayout, "map"> {
  const p = new Plan();
  const casino: NonNullable<MapLayout["casino"]> = [];
  const Y = 64, X0 = -30, X1 = 30, Z0 = -22, Z1 = 22, H = 9;
  const put = (x: number, y: number, z: number, id: number, game?: CasinoGame) => { p.set(x, y, z, id); if (game) casino.push({ game, x, y, z }); };
  for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
    const wall = x === X0 || x === X1 || z === Z0 || z === Z1;
    p.set(x, Y - 1, z, B.QUARTZ_BLOCK);
    // Red carpet, with a gold diamond lattice through it.
    p.set(x, Y, z, wall ? B.QUARTZ_BLOCK : (x + z) % 6 === 0 || (x - z) % 6 === 0 ? wool("yellow") : wool("red"));
    for (let y = Y + 1; y < Y + H; y++) p.set(x, y, z, wall ? (y === Y + 1 || y === Y + H - 1 ? B.GOLD_BLOCK : B.QUARTZ_BLOCK) : B.AIR);
    p.set(x, Y + H, z, !wall && x % 5 === 0 && z % 5 === 0 ? B.GLOWSTONE : B.QUARTZ_BLOCK);
  }
  // Slot machines: two banks of purple cabinets with glowing screens, back to back.
  for (const z of [-12, -10, 10, 12]) for (let x = -24; x <= -8; x += 2) {
    put(x, Y + 1, z, B.PURPUR_BLOCK, "slots");
    put(x, Y + 2, z, B.SEA_LANTERN, "slots");
    put(x, Y + 3, z, B.MAGENTA_STAINED_GLASS, "slots");
  }
  // Blackjack tables: green felt on dark legs.
  for (const [tx, tz] of [[4, -12], [12, -12], [4, 10], [12, 10]]) {
    for (let x = tx; x < tx + 4; x++) for (let z = tz; z < tz + 3; z++) {
      put(x, Y + 1, z, x === tx || x === tx + 3 || z === tz || z === tz + 2 ? B.SPRUCE_PLANKS : wool("green"), "blackjack");
    }
  }
  // Roulette tables: felt, with the wheel in the middle — red, black and a gold spindle.
  for (const [tx, tz] of [[-4, -4], [8, -4]]) {
    for (let x = tx; x < tx + 5; x++) for (let z = tz; z < tz + 5; z++) {
      const cx = x - tx - 2, cz = z - tz - 2;
      const id = cx === 0 && cz === 0 ? B.GOLD_BLOCK : Math.abs(cx) <= 1 && Math.abs(cz) <= 1 ? ((cx + cz) % 2 === 0 ? wool("black") : wool("red")) : wool("green");
      put(x, Y + 1, z, id, "roulette");
    }
  }
  // The video poker bar along the east wall.
  for (let z = -16; z <= 16; z += 2) {
    put(X1 - 2, Y + 1, z, B.LAPIS_BLOCK, "poker");
    put(X1 - 2, Y + 2, z, B.SEA_LANTERN, "poker");
  }
  // The wheel, standing against the north wall: a disc of coloured segments round a gold hub.
  const wheelColors = [wool("white"), wool("blue"), wool("yellow"), wool("lime"), wool("magenta"), wool("red")];
  for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
    const r = Math.hypot(dx, dy);
    if (r > 5.4) continue;
    const seg = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 18) % wheelColors.length;
    put(dx, Y + 3 + 3 + dy, Z0 + 1, r < 1.2 ? B.GOLD_BLOCK : r > 4.6 ? B.GOLD_BLOCK : wheelColors[seg], "wheel");
  }
  put(0, Y + 12, Z0 + 1, B.REDSTONE_BLOCK, "wheel");
  // The Stonks terminal on the west wall: a black screen with a green line that only goes up.
  for (let dz = -6; dz <= 6; dz++) for (let dy = 0; dy < 6; dy++) {
    const line = Math.round(dy) === Math.min(5, Math.max(0, Math.floor((dz + 6) / 2.4)));
    put(X0 + 1, Y + 2 + dy, dz, line ? wool("lime") : wool("black"), "crash");
  }
  for (let dz = -3; dz <= 3; dz++) put(X0 + 2, Y + 1, dz, B.EMERALD_BLOCK, "crash");
  // Pillars, and the name over the door in pink.
  for (const [x, z] of [[-20, -4], [20, -4], [-20, 4], [20, 4]]) for (let y = Y + 1; y < Y + H; y++) p.set(x, y, z, y === Y + H - 1 ? B.GOLD_BLOCK : B.QUARTZ_BLOCK);
  signWord(p, "STONKS", -11, Y + 3, Z1 - 1, wool("pink"));
  // The cashier's cage by the door.
  for (let x = -3; x <= 3; x++) { p.set(x, Y + 1, Z1 - 4, B.GOLD_BLOCK); p.set(x, Y + 2, Z1 - 4, B.IRON_BARS); }
  return { spawn: [0.5, Y + 1, Z1 - 2.5], blocks: p.blocks, terrain: false, chests: [], center: [0, 0], radius: 40, floorY: Y - 10, casino };
}

/**
 * A city (Neon Bay, Golden Coast): built chunk by chunk as the world
 * generates (engine/city.ts). You start outside your crib; the casino's
 * tables and the shops' counters are listed so using one deals you in.
 */
function cityMap(id: "neon_bay" | "golden_coast", seed: number): Omit<MapLayout, "map"> {
  const city = cityOf(id, seed);
  const home = city.landmark("safehouse");
  const casinoLot = city.landmark("casino");
  const casino = casinoLot ? city.casinoPlan(casinoLot).map(({ game, x, y, z }) => ({ game, x, y, z })) : [];
  const shops = (["guns", "dealer"] as const).flatMap((k) => { const lot = city.landmark(k); return lot ? city.shopPlan(lot).map(({ shop, x, y, z }) => ({ shop, x, y, z })) : []; });
  const spawn: [number, number, number] = home ? [home.x0 + 8.5, STREET, home.z0 + 19.5] : [0.5, STREET, 0.5];
  const cx = Math.round((city.minX + city.maxX) / 2), cz = Math.round((city.minZ + city.maxZ) / 2);
  return { spawn, blocks: new Map(), terrain: false, chests: [], center: [cx, cz], radius: 420, floorY: 0, casino, city, shops };
}

/** Ashgrove County: the whole map is the county's own chunk builder; the player wakes in a house in Millbrook. */
function countyMap(seed: number): Omit<MapLayout, "map"> {
  const county = countyOf(seed);
  return { spawn: county.spawn, blocks: new Map(), terrain: false, chests: [], center: [0, 0], radius: CORDON, floorY: 0, county };
}

function sgArena(seed: number, base: Generator): Omit<MapLayout, "map"> {
  const p = new Plan();
  const s = base.findSpawn();
  const cx = Math.floor(s.x), cz = Math.floor(s.z), y = base.surfaceY(cx, cz);
  // The cornucopia's floor: a round platform of smooth stone, cleared above.
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) {
    if (Math.hypot(x, z) > 14.5) continue;
    for (let yy = y - 3; yy <= y; yy++) p.set(cx + x, yy, cz + z, yy === y ? B.SMOOTH_STONE : B.STONE);
    for (let yy = y + 1; yy <= y + 6; yy++) p.set(cx + x, yy, cz + z, B.AIR);
  }
  // The horn itself: a golden arch over the centre chests.
  for (let i = -2; i <= 2; i++) { p.set(cx + i, y + 4, cz - 2, B.GOLD_BLOCK); p.set(cx + i, y + 4, cz + 2, B.GOLD_BLOCK); }
  for (let yy = y + 1; yy <= y + 3; yy++) for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) p.set(cx + dx, yy, cz + dz, B.GOLD_BLOCK);
  const chests: MapLayout["chests"] = [];
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) { p.set(cx + dx, y + 1, cz + dz, B.CHEST); chests.push([cx + dx, y + 1, cz + dz, "sg_center"]); }
  const pads: [number, number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const px = cx + Math.round(Math.cos(a) * 11), pz = cz + Math.round(Math.sin(a) * 11);
    p.set(px, y, pz, B.IRON_BLOCK);
    pads.push([px, y + 1, pz]);
  }
  // Chests hidden in the wild, on the ground within the arena.
  const rng = new Rng(hash4(seed, 0x5a11));
  for (let i = 0; i < 28; i++) {
    const a = rng.next() * Math.PI * 2, r = 30 + rng.next() * 110;
    const x = cx + Math.round(Math.cos(a) * r), z = cz + Math.round(Math.sin(a) * r);
    const gy = base.surfaceY(x, z);
    if (gy < 63) continue;
    p.set(x, gy + 1, z, B.CHEST, rng.int(4));
    chests.push([x, gy + 1, z, "sg_wild"]);
  }
  return { spawn: [cx + 0.5, y + 1, cz + 0.5], blocks: p.blocks, terrain: true, chests, pads, center: [cx, cz], radius: 150, floorY: 0 };
}

const layouts = new Map<string, MapLayout>();

/** A map's layout for a seed, the same every time. Terrain maps need the ordinary generator to stand on. */
export function mapLayout(map: MapId, seed: number, base: Generator): MapLayout {
  const key = `${map}:${seed}`;
  let l = layouts.get(key);
  if (!l) {
    const made = map === "skyblock" ? skyblock() : map === "oneblock" ? oneblock() : map === "void" ? voidMap()
      : map === "parkour" ? parkour(seed) : map === "colosseum" ? colosseum() : map === "tnt_run" ? tntRun()
        : map === "primal_island" ? primalIsland(base) : map === "dead_zone" ? deadZone(seed, base) : map === "zombie_bunker" ? zombieBunker()
          : map === "critter_region" ? critterRegion(seed, base) : map === "safari_park" ? safariPark(seed, base) : map === "battle_spire" ? battleSpire() : map === "high_roller" ? casinoFloor() : map === "neon_bay" || map === "golden_coast" ? cityMap(map, seed) : map === "county" ? countyMap(seed) : sgArena(seed, base);
    l = { map, ...made };
    if (layouts.size > 16) layouts.clear();
    layouts.set(key, l);
  }
  return l;
}

/**
 * The generator for a world played on a map pack: the map's pieces, over
 * void or over the ordinary terrain.
 */
export class MapGenerator implements ChunkGenerator {
  readonly layout: MapLayout;
  private plainsTints: Tints | null = null;

  constructor(readonly map: MapId, readonly base: Generator) {
    this.layout = mapLayout(map, base.seed, base);
  }

  get seed(): number {
    return this.base.seed;
  }

  /** The ordinary generator, where the map keeps its terrain (and so its villages and strongholds). */
  get terrain(): Generator | null {
    return this.layout.terrain ? this.base : null;
  }

  generate(cx: number, cz: number): GeneratedChunk {
    let out: GeneratedChunk;
    if (this.layout.terrain) out = this.base.generate(cx, cz);
    else out = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256).fill(BiomeId.Plains) };
    this.layout.city?.fill(cx, cz, out);
    this.layout.county?.fill(cx, cz, out);
    const list = this.layout.blocks.get(`${cx},${cz}`) ?? [];
    for (let i = 0; i < list.length; i += 5) {
      const idx = blockIndex(list[i] - cx * 16, list[i + 1], list[i + 2] - cz * 16);
      out.blocks[idx] = list[i + 3];
      out.meta[idx] = list[i + 4];
    }
    return out;
  }

  biomeAt(x: number, z: number): number {
    return this.layout.terrain ? this.base.biomeAt(x, z) : BiomeId.Plains;
  }

  tints(cx: number, cz: number): Tints {
    if (this.layout.terrain) return this.base.tints(cx, cz);
    if (!this.plainsTints) {
      const b = biomeDef(BiomeId.Plains);
      const g = grassColor(b, 0.8, 0.4), f = foliageColor(b, 0.8, 0.4), w = waterColor(b);
      const t = new Uint8Array(256 * 9);
      for (let i = 0; i < 256; i++) t.set([...g, ...f, ...w], i * 9);
      this.plainsTints = t;
    }
    // A copy each time: the worker transfers what it returns, and a transferred buffer is gone —
    // handing out the same one twice stalled every void map after its first chunk per worker.
    return this.plainsTints.slice();
  }

  findSpawn(): { x: number; y: number; z: number } {
    const [x, y, z] = this.layout.spawn;
    return { x, y, z };
  }

  /** The map's chests in a chunk, for the game to fill as it appears. */
  chestsIn(cx: number, cz: number): [number, number, number, MapLoot][] {
    return this.layout.chests.filter(([x, , z]) => x >> 4 === cx && z >> 4 === cz);
  }
}

const TABLES: Record<MapLoot, LootTable> = {
  // The original's starting chest, near enough: lava and ice for cobblestone, seeds of every kind.
  skyblock_start: [["lava_bucket", 1, 1, 1], ["ice", 2, 2, 1], ["melon_slice", 1, 1, 1], ["sugar_cane", 1, 1, 1], ["red_mushroom", 1, 1, 1],
    ["brown_mushroom", 1, 1, 1], ["wheat_seeds", 2, 2, 1], ["bone_meal", 3, 3, 1], ["carrot", 1, 1, 1], ["potato", 1, 1, 1], ["pumpkin", 1, 1, 1]],
  skyblock_sand: [["obsidian", 10, 10, 1], ["ice", 1, 1, 1], ["cactus", 1, 1, 1], ["sand", 4, 4, 1]],
  sg_center: [["iron_sword", 1, 1, 0.45], ["stone_sword", 1, 1, 0.5], ["bow", 1, 1, 0.35], ["arrow", 4, 10, 0.5], ["iron_chestplate", 1, 1, 0.3],
    ["iron_helmet", 1, 1, 0.3], ["iron_leggings", 1, 1, 0.25], ["iron_boots", 1, 1, 0.3], ["golden_apple", 1, 1, 0.2], ["cooked_beef", 2, 5, 0.6],
    ["bread", 2, 4, 0.5], ["diamond", 1, 1, 0.1], ["iron_axe", 1, 1, 0.3]],
  sg_wild: [["wooden_sword", 1, 1, 0.35], ["stone_sword", 1, 1, 0.3], ["stone_axe", 1, 1, 0.3], ["leather_helmet", 1, 1, 0.3],
    ["leather_chestplate", 1, 1, 0.3], ["leather_boots", 1, 1, 0.3], ["golden_helmet", 1, 1, 0.15], ["apple", 1, 3, 0.5], ["bread", 1, 2, 0.4],
    ["arrow", 2, 6, 0.3], ["flint", 1, 3, 0.2], ["iron_ingot", 1, 2, 0.2], ["stick", 1, 3, 0.4], ["flint_and_steel", 1, 1, 0.1]],
  arena_gear: [["iron_sword", 1, 1, 1], ["bow", 1, 1, 1], ["arrow", 32, 32, 1], ["iron_chestplate", 1, 1, 1], ["iron_helmet", 1, 1, 1],
    ["cooked_beef", 16, 16, 1], ["golden_apple", 2, 2, 1]],
  // Dead Zone: what a house, a hospital cabinet and a military crate hold.
  dz_house: [["canned_beans", 1, 2, 0.45], ["soda_can", 1, 2, 0.4], ["bread", 1, 3, 0.35], ["bandage", 1, 2, 0.3], ["pistol_ammo", 4, 12, 0.25],
    ["pistol", 1, 1, 0.07], ["baseball_bat", 1, 1, 0.12], ["canteen", 1, 1, 0.15], ["leather_chestplate", 1, 1, 0.12], ["shotgun_shells", 2, 6, 0.12],
    ["torch", 2, 6, 0.3], ["string", 1, 3, 0.2]],
  dz_medical: [["bandage", 2, 5, 0.9], ["splint", 1, 2, 0.6], ["antibiotics", 1, 2, 0.55], ["golden_apple", 1, 1, 0.1], ["soda_can", 1, 2, 0.3]],
  dz_military: [["rifle_ammo", 8, 24, 0.8], ["assault_rifle", 1, 1, 0.25], ["hunting_rifle", 1, 1, 0.2], ["shotgun", 1, 1, 0.2], ["shotgun_shells", 4, 12, 0.5],
    ["pistol", 1, 1, 0.35], ["pistol_ammo", 8, 20, 0.6], ["iron_helmet", 1, 1, 0.35], ["iron_chestplate", 1, 1, 0.3], ["bandage", 1, 3, 0.5], ["canned_beans", 2, 4, 0.5]],
};

/** A loot table: item name, fewest, most, and the chance of it appearing at all. */
export type LootTable = readonly (readonly [string, number, number, number])[];

/**
 * Fills a chest from a table. Starting chests (`ordered`) fill slot by slot,
 * like a kit; loot is scattered, like loot. Names the game lacks are skipped
 * rather than failing the chest.
 */
export function fillLoot(items: (ItemStack | null)[], rng: Rng, table: LootTable, ordered: boolean): void {
  let slot = 0;
  for (const [name, lo, hi, chance] of table) {
    if (rng.next() >= chance) continue;
    let id: number;
    try { id = itemByName(name).id; } catch { continue; }
    const at = ordered ? slot++ : rng.int(items.length);
    if (at < items.length && !items[at]) items[at] = { id, count: lo + rng.int(hi - lo + 1) };
  }
}

/** Fills a map chest from its table. */
export function mapLoot(items: (ItemStack | null)[], seed: number, table: MapLoot): void {
  fillLoot(items, new Rng(seed), TABLES[table], table.startsWith("skyblock") || table === "arena_gear");
}

/** A map loot table by name, for a mode's own chests (a helicopter's wreck, a blood moon's reward). */
export function mapLootTable(table: MapLoot): LootTable {
  return TABLES[table];
}

/** Every item name the map tables use, for the test that keeps them real. */
export function mapLootNames(): string[] {
  return Object.values(TABLES).flatMap((t) => t.map(([n]) => n));
}
