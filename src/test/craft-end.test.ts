import { beforeEach, describe, expect, it } from "vitest";
import { newlyEarned } from "@/craft/engine/advancements";
import { BiomeId } from "@/craft/engine/biomes";
import { B, chorusJoins, endRodBoxes, Face, FRAME_EYE, torchBoxes } from "@/craft/engine/blocks";
import { BlockRules, type RuleContext } from "@/craft/engine/blockRules";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "@/craft/engine/constants";
import { matchRecipe, recipeResult, smeltResult } from "@/craft/engine/crafting";
import { dragonHurt } from "@/craft/engine/dragon";
import {
  cityInRegion, cityLoot, EndGenerator, endSpikes, GATEWAY_COUNT, gatewayOrder, OUTER_ISLANDS,
} from "@/craft/engine/end";
import { EndCrystal, Projectile, type Entity, type EntityContext, type PlayerRef } from "@/craft/engine/entities";
import { createGenerator } from "@/craft/engine/generators";
import { Inventory } from "@/craft/engine/inventory";
import { itemByName, itemId, type ItemStack } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { isArthropod, Mob } from "@/craft/engine/mobs";
import { Player } from "@/craft/engine/player";
import {
  findEndPortal, FRAME_RING, inStronghold, nearestStronghold, planStronghold, SPAWNER_SILVERFISH, STRONGHOLD_RINGS,
  strongholdLoot, strongholdPositions,
} from "@/craft/engine/stronghold";
import { SPAWNER_MOBS } from "@/craft/engine/nether";
import { World } from "@/craft/engine/world";
import { Generator } from "@/craft/engine/worldgen";
import { chunkStoreKey } from "@/craft/game/save";

function flatWorld(fill: (x: number, y: number, z: number) => number, r = 1): World {
  const world = new World();
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = fill(cx * 16 + x, y, cz * 16 + z);
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}
const ground = (_x: number, y: number) => (y <= 10 ? B.END_STONE : B.AIR);
const ruleCtx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  dropItems: () => {}, spawnFalling: () => {}, sound: () => {}, isRaining: () => false, random: Math.random, ...extra,
});
const run = (world: World, rules: BlockRules, n: number) => {
  for (let i = 0; i < n; i++) {
    world.tick++;
    for (const [x, y, z] of world.takeDue()) rules.onTick(x, y, z);
  }
};

/** Blocks of a generated world, chunk by chunk as asked for. */
function blocksOf(gen: { generate(cx: number, cz: number): { blocks: Uint16Array; meta: Uint8Array } }) {
  const chunks = new Map<string, { blocks: Uint16Array; meta: Uint8Array }>();
  const chunk = (x: number, z: number) => {
    const key = `${x >> 4},${z >> 4}`;
    let c = chunks.get(key);
    if (!c) { c = gen.generate(x >> 4, z >> 4); chunks.set(key, c); }
    return c;
  };
  return {
    get: (x: number, y: number, z: number) => chunk(x, z).blocks[blockIndex(x & 15, y, z & 15)],
    meta: (x: number, y: number, z: number) => chunk(x, z).meta[blockIndex(x & 15, y, z & 15)],
  };
}

// ---- strongholds -------------------------------------------------------------------------------

describe("strongholds", () => {
  const seed = 12345;

  it("puts the first ring's three between 640 and 1152 blocks out, spread around the centre", () => {
    const first = strongholdPositions(seed).slice(0, STRONGHOLD_RINGS[0].count);
    expect(first).toHaveLength(3);
    for (const p of first) {
      const d = Math.hypot(p.x, p.z);
      expect(d).toBeGreaterThan(620);
      expect(d).toBeLessThan(1170);
    }
    const angles = first.map((p) => Math.atan2(p.z, p.x)).sort((a, b) => a - b);
    for (let i = 0; i < 3; i++) {
      const gap = (angles[(i + 1) % 3] - angles[i] + Math.PI * 2) % (Math.PI * 2);
      expect(gap).toBeGreaterThan(Math.PI / 2);
    }
  });

  it("builds a portal room of twelve frames over lava, with a silverfish spawner on the dais", () => {
    const s = planStronghold(seed, 0);
    const w = blocksOf(new Generator({ seed, type: "default" }));
    let frames = 0;
    for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) if (w.get(s.x + dx, s.y + 3, s.z + dz) === B.END_PORTAL_FRAME) frames++;
    expect(frames).toBe(12);
    const [sx, sy, sz] = s.spawner;
    expect(w.get(sx, sy, sz)).toBe(B.SPAWNER);
    expect(SPAWNER_MOBS[w.meta(sx, sy, sz)]).toBe("silverfish");
    expect(SPAWNER_MOBS[SPAWNER_SILVERFISH]).toBe("silverfish");
    let lava = 0;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (w.get(s.x + dx, s.y + 2, s.z + dz) === B.LAVA) lava++;
    expect(lava).toBe(9);
  });

  it("stamps a stronghold the same whichever of its chunks generates first", () => {
    const s = planStronghold(seed, 0);
    const cx = s.x >> 4, cz = s.z >> 4;
    const a = new Generator({ seed, type: "default" });
    const first = a.generate(cx, cz);
    const b = new Generator({ seed, type: "default" });
    b.generate(cx + 1, cz);
    b.generate(cx, cz + 1);
    const second = b.generate(cx, cz);
    expect(Buffer.from(second.blocks).equals(Buffer.from(first.blocks))).toBe(true);
    expect(Buffer.from(second.meta).equals(Buffer.from(first.meta))).toBe(true);
  });

  it("knows when a player stands in a stronghold's halls, and when they do not", () => {
    const s = planStronghold(seed, 0);
    expect(inStronghold(seed, s.x + 0.5, s.y, s.z + 5.5)).toBe(true);
    expect(inStronghold(seed, s.x + 0.5, s.y + 40, s.z + 5.5)).toBe(false);
    expect(inStronghold(seed, 0, 64, 0)).toBe(false);
  });

  it("fills library chests with paper and books, and storerooms with food, iron and pearls", () => {
    const names = (room: "library" | "storeroom") => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const items: (ItemStack | null)[] = new Array(27).fill(null);
        strongholdLoot(items, i, room);
        for (const s of items) if (s) seen.add(itemByName(itemName(s.id)).name);
      }
      return seen;
    };
    expect(names("library")).toContain("enchanted_book");
    expect(names("library")).toContain("paper");
    expect(names("storeroom")).toContain("ender_pearl");
    expect(names("storeroom")).toContain("iron_ingot");
  });

  it("leads every eye to the nearest stronghold's portal room", () => {
    const s = planStronghold(seed, 0);
    const near = nearestStronghold(seed, s.x + 50, s.z - 30);
    expect([near.x, near.z]).toEqual([s.x, s.z]);
  });
});

function itemName(id: number): string {
  for (const n of ["enchanted_book", "paper", "book", "ender_pearl", "iron_ingot", "gold_ingot", "bread", "apple", "redstone", "diamond", "iron_pickaxe", "iron_sword", "iron_chestplate", "golden_apple"]) {
    if (itemId(n) === id) return n;
  }
  return "stone";
}

describe("the End portal", () => {
  /** A ring of twelve frames on y=11 around the 3×3 at x -1..1, z -1..1, `eyes` of them holding an eye. */
  const ring = (eyes: number) => {
    const world = flatWorld(ground);
    FRAME_RING.forEach(([x, z, facing], i) => world.setBlock(x, 11, z + 3, B.END_PORTAL_FRAME, facing | (i < eyes ? FRAME_EYE : 0)));
    return world;
  };
  const find = (world: World, x: number, z: number) =>
    findEndPortal((a, b, c) => world.blockAt(a, b, c), (a, b, c) => world.getMeta(a, b, c), x, 11, z);

  it("opens with the twelfth eye, filling the nine blocks inside the ring", () => {
    expect(find(ring(11), -2, -1)).toBeNull();
    const cells = find(ring(12), -2, -1);
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual([0, 11, 0]);
  });

  it("stays shut when a frame is missing from the ring", () => {
    const world = ring(12);
    world.setBlock(2, 11, 0, B.STONE);
    expect(find(world, -2, -1)).toBeNull();
  });
});

describe("eyes of ender", () => {
  const ctx = (spawned: Entity[], drops: ItemStack[], random = () => 0.5): EntityContext => ({
    world: flatWorld(ground), tick: 0, daylight: 1, difficulty: 2, random, players: () => [],
    hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: (e) => { spawned.push(e); },
    dropItem: (_x, _y, _z, s) => { drops.push(s); }, explode: () => {}, sound: () => {}, particles: () => {},
    entitiesNear: () => [], placeBlock: () => true,
  });

  it("fly twelve blocks toward a far stronghold, rising eight, and mostly fall back to be picked up", () => {
    const eye = new Projectile("eye_of_ender", 0.5, 12, 0.5, 0, 0, 0, "p1");
    eye.item = itemId("eye_of_ender");
    eye.signalTo(900, 30, 0, () => 0.5);
    expect(eye.target!.x).toBeCloseTo(12.5, 1);
    expect(eye.target!.y).toBe(20);
    const drops: ItemStack[] = [];
    const c = ctx([], drops);
    for (let i = 0; i < 81; i++) { eye.beginTick(); eye.tick(c); }
    expect(eye.removed).toBe(true);
    expect(eye.x).toBeGreaterThan(4);
    expect(drops[0]?.id).toBe(itemId("eye_of_ender"));
  });

  it("shatter one time in five", () => {
    const eye = new Projectile("eye_of_ender", 0.5, 12, 0.5, 0, 0, 0, "p1");
    eye.signalTo(900, 30, 0, () => 0.1);
    const drops: ItemStack[] = [];
    const c = ctx([], drops);
    for (let i = 0; i < 81; i++) { eye.beginTick(); eye.tick(c); }
    expect(drops).toHaveLength(0);
  });

  it("head straight for a stronghold closer than twelve blocks", () => {
    const eye = new Projectile("eye_of_ender", 0.5, 12, 0.5, 0, 0, 0, "p1");
    eye.signalTo(6, 30, 2, () => 0.5);
    expect(eye.target).toEqual({ x: 6, y: 30, z: 2 });
  });
});

// ---- the End's terrain -----------------------------------------------------------------------

describe("the End's terrain", () => {
  const gen = new EndGenerator(4242);

  it("floats a main island about two hundred blocks across, with the exit portal's basin on top", () => {
    expect(gen.surfaceY(0, 0)).toBeGreaterThan(55);
    expect(gen.surfaceY(0, 0)).toBeLessThan(70);
    expect(gen.surfaceY(80, 0)).toBeGreaterThan(0);
    expect(gen.surfaceY(110, 0)).toBe(-1);
    const w = blocksOf(gen);
    const y = gen.podiumY();
    for (let dy = 0; dy <= 3; dy++) expect(w.get(0, y + dy, 0)).toBe(B.BEDROCK);
    // Unlit until the dragon dies: the basin holds air, not portal.
    expect(w.get(1, y, 0)).toBe(B.AIR);
    expect(w.get(0, y - 1, 2)).toBe(B.BEDROCK);
    expect(w.get(3, y, 0)).toBe(B.BEDROCK);
  });

  it("leaves the void empty between the main island and the outer islands", () => {
    // Islands seeded just past 1024 can reach a hundred blocks back in, as the original's do.
    for (let r = 110; r < OUTER_ISLANDS - 130; r += 37) for (let a = 0; a < Math.PI * 2; a += 0.4) {
      expect(gen.surfaceY(Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r))).toBe(-1);
    }
  });

  it("rings the island with ten obsidian spikes, two of them caged, each topped with bedrock", () => {
    const spikes = endSpikes(4242);
    expect(spikes).toHaveLength(10);
    expect(spikes.filter((s) => s.guarded)).toHaveLength(2);
    expect(new Set(spikes.map((s) => s.height)).size).toBe(10);
    const w = blocksOf(gen);
    for (const s of spikes) {
      expect(Math.round(Math.hypot(s.x, s.z))).toBeGreaterThanOrEqual(41);
      expect(w.get(s.x, s.height, s.z)).toBe(B.BEDROCK);
      expect(w.get(s.x, s.height - 1, s.z)).toBe(B.OBSIDIAN);
      expect(w.get(s.x + 2, s.height + 4, s.z)).toBe(s.guarded ? B.IRON_BARS : B.AIR);
    }
  });

  it("has the outer islands' four biomes past 1024 blocks, and only the End's own inside", () => {
    const counts = new Map<number, number>();
    for (let z = -2600; z <= 2600; z += 40) for (let x = -2600; x <= 2600; x += 40) {
      const r = Math.hypot(x, z);
      const b = gen.biomeAt(x, z);
      if (r < OUTER_ISLANDS) { expect(b).toBe(BiomeId.TheEnd); continue; }
      if (r > 1150) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (const b of [BiomeId.EndHighlands, BiomeId.EndMidlands, BiomeId.EndBarrens, BiomeId.SmallEndIslands]) {
      expect((counts.get(b) ?? 0) / total).toBeGreaterThan(0.05);
    }
  });

  it("grows chorus plants whose every arm meets a neighbour of the plant", () => {
    let plants = 0;
    for (let cz = 0; cz < 6; cz++) for (let cx = 70; cx < 76; cx++) {
      const c = gen.generate(cx, cz);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (c.blocks[i] !== B.CHORUS_PLANT) continue;
        const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
        if (x === 0 || x === 15 || z === 0 || z === 15) continue;
        plants++;
        const joins = chorusJoins((a, b, d) => c.blocks[blockIndex(a, b, d)], x, y, z);
        expect(c.meta[i]).toBe(joins);
        // Every plant stands on the stalk or the ground, or hangs from a branch beside it.
        expect(joins & ((1 << Face.Down) | 0b110011)).not.toBe(0);
      }
    }
    expect(plants).toBeGreaterThan(20);
  });

  it("builds End cities with their chests where the plan puts them (see craft-endcity for the rest)", () => {
    let city = null;
    for (let rx = -8; rx <= 8 && !city; rx++) for (let rz = -8; rz <= 8 && !city; rz++) {
      const c = cityInRegion(gen, rx, rz);
      if (c?.ship) city = c;
    }
    expect(city).not.toBeNull();
    const w = blocksOf(gen);
    for (const [x, y, z] of city!.chests) expect(w.get(x, y, z)).toBe(B.CHEST);
    const items: (ItemStack | null)[] = new Array(27).fill(null);
    cityLoot(items, 5, true);
    expect(items.some(Boolean)).toBe(true);
  });

  it("puts every gateway's far end on an island, caged top and bottom in bedrock", () => {
    const w = blocksOf(gen);
    for (const i of [0, 7, 13]) {
      const { gateway: [x, y, z], land } = gen.gatewayExit(i);
      expect(w.get(x, y, z)).toBe(B.END_GATEWAY);
      expect(w.get(x, y + 1, z)).toBe(B.BEDROCK);
      expect(w.get(x, y - 1, z)).toBe(B.BEDROCK);
      expect(gen.surfaceY(land[0], land[2])).toBeGreaterThan(0);
    }
    expect(new Set(gatewayOrder(4242)).size).toBe(GATEWAY_COUNT);
  });

  it("generates the same outer chunk in any order, and is what the workers build for the End", () => {
    const a = new EndGenerator(4242).generate(72, 3);
    const other = new EndGenerator(4242);
    other.generate(73, 3);
    other.generate(72, 4);
    expect(Buffer.from(other.generate(72, 3).blocks).equals(Buffer.from(a.blocks))).toBe(true);
    expect(createGenerator({ seed: 1, type: "default", dimension: "end" })).toBeInstanceOf(EndGenerator);
    expect(chunkStoreKey("w", 1, 2, "end")).toBe("w|e:1,2");
  });
});

// ---- blocks ---------------------------------------------------------------------------------------

describe("the End's blocks", () => {
  it("joins a chorus plant's arms to its neighbours, and snaps what is left hanging", () => {
    const world = flatWorld(ground);
    world.simulates = true;
    const rules = new BlockRules(world, ruleCtx());
    world.setBlock(0, 11, 0, B.CHORUS_PLANT, 0);
    world.setBlock(0, 12, 0, B.CHORUS_PLANT, 0);
    world.setBlock(1, 12, 0, B.CHORUS_PLANT, 0);
    world.setBlock(1, 13, 0, B.CHORUS_FLOWER, 0);
    run(world, rules, 5);
    expect(world.getMeta(0, 11, 0)).toBe((1 << Face.Up) | (1 << Face.Down));
    expect(world.getMeta(0, 12, 0)).toBe((1 << Face.Down) | (1 << Face.East));
    world.setBlock(0, 11, 0, B.AIR, 0);
    run(world, rules, 20);
    expect(world.blockAt(0, 12, 0)).toBe(B.AIR);
    expect(world.blockAt(1, 12, 0)).toBe(B.AIR);
    expect(world.blockAt(1, 13, 0)).toBe(B.AIR);
  });

  it("grows a chorus flower up out of the end stone into a plant", () => {
    const world = flatWorld(ground);
    world.simulates = true;
    const rules = new BlockRules(world, ruleCtx());
    world.setBlock(0, 11, 0, B.CHORUS_FLOWER, 0);
    for (let i = 0; i < 3000 && world.blockAt(0, 11, 0) === B.CHORUS_FLOWER; i++) rules.randomTicks([{ x: 0, z: 0 }], 0, 3000);
    expect(world.blockAt(0, 11, 0)).toBe(B.CHORUS_PLANT);
  });

  it("draws a wall torch against the wall that holds it", () => {
    // Meta 4: set on the east face of the block to its west, so it leans on that (west) side.
    const [box] = torchBoxes(4);
    expect(box[0]).toBeLessThan(4);
  });

  it("points an end rod out of the face it was set against", () => {
    const up = endRodBoxes(Face.Up)[1];
    expect(up[4] - up[1]).toBe(15);
    const east = endRodBoxes(Face.East)[1];
    expect(east[3] - east[0]).toBe(15);
  });

  it("crafts eyes of ender, end crystals, purpur and end rods, and pops chorus fruit in a furnace", () => {
    const s = (n: string | null): ItemStack | null => (n ? { id: itemId(n), count: 1 } : null);
    const eye = matchRecipe([s("ender_pearl"), s("blaze_powder"), null, null], 2);
    expect(recipeResult(eye!).id).toBe(itemId("eye_of_ender"));
    const crystal = matchRecipe(["glass", "glass", "glass", "glass", "eye_of_ender", "glass", "glass", "ghast_tear", "glass"].map(s), 3);
    expect(recipeResult(crystal!).id).toBe(itemId("end_crystal"));
    const purpur = matchRecipe(["popped_chorus_fruit", "popped_chorus_fruit", "popped_chorus_fruit", "popped_chorus_fruit"].map(s), 2);
    expect(recipeResult(purpur!)).toEqual({ id: B.PURPUR_BLOCK, count: 4 });
    const rod = matchRecipe([s("blaze_rod"), null, s("popped_chorus_fruit"), null], 2);
    expect(recipeResult(rod!)).toEqual({ id: B.END_ROD, count: 4 });
    expect(smeltResult(itemId("chorus_fruit"))?.output).toBe("popped_chorus_fruit");
  });
});

// ---- mobs -------------------------------------------------------------------------------------------

let world: World;
let mobs: Entity[];
let players: PlayerRef[];
let hurt: { id: string; amount: number; source: string }[];
let dropped: ItemStack[];
let defeated = 0;
let rand: () => number = Math.random;

const ctx = (): EntityContext => ({
  world, tick: 0, daylight: 0.12, difficulty: 2, random: rand, players: () => players,
  hurtPlayer: (id, amount, source) => { hurt.push({ id, amount, source }); }, givePlayer: () => 0, giveXp: () => {},
  spawn: (e) => { mobs.push(e); }, dropItem: (_x, _y, _z, s) => { dropped.push(s); }, explode: () => {}, sound: () => {}, particles: () => {},
  entitiesNear: (x, y, z, r) => mobs.filter((m) => !m.removed && Math.abs(m.x - x) <= r && Math.abs(m.y - y) <= r && Math.abs(m.z - z) <= r),
  placeBlock: (x, y, z, id, meta) => world.setBlock(x, y, z, id, meta),
  dragonDefeated: () => { defeated++; }, mobGriefing: true,
});

/** A player at x on the floor, looking along `yaw` (0 is -z) and `pitch` (up positive). */
const player = (x: number, yaw: number, pitch: number, extra: Partial<PlayerRef> = {}): PlayerRef =>
  ({ id: "p1", name: "Alex", x, y: 11, z: 0.5, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false, yaw, pitch, ...extra });

function add(kind: Mob["kind"], x: number, y = 11): Mob {
  const m = new Mob(kind, x + 0.5, y, 0.5);
  mobs.push(m);
  return m;
}
function tick(n: number): void {
  const c = ctx();
  for (let i = 0; i < n; i++) for (const m of [...mobs]) if (!m.removed) { m.beginTick(); m.tick(c); }
}

beforeEach(() => {
  world = flatWorld(ground, 2);
  mobs = [];
  players = [];
  hurt = [];
  dropped = [];
  defeated = 0;
  rand = Math.random;
});

describe("endermen", () => {
  /** The yaw and pitch that look from a player at px straight into the eyes of an enderman at ex. */
  const lookAt = (px: number, ex: number): [number, number] => {
    const dx = ex - px, dy = 11 + 2.55 - (11 + 1.62);
    return [Math.atan2(-dx, 0), Math.atan2(dy, Math.abs(dx))];
  };

  it("leave a player alone who does not look them in the eye", () => {
    const e = add("enderman", 8);
    e.yaw = 0;
    // Looking the other way.
    players = [player(0.5, Math.PI / 2, 0)];
    tick(60);
    expect(e.targetId).toBeNull();
    expect(hurt).toHaveLength(0);
  });

  it("scream and come for a player who stares at them", () => {
    const e = add("enderman", 8);
    const [yaw, pitch] = lookAt(0.5, 8.5);
    players = [player(0.5, yaw, pitch)];
    tick(1);
    expect(e.targetId).toBe("p1");
    expect(e.scream).toBeGreaterThan(0);
    // Look away: it keeps coming.
    players = [player(0.5, Math.PI / 2, 0)];
    tick(200);
    expect(hurt.some((h) => h.id === "p1")).toBe(true);
  });

  it("cannot tell they are being looked at through a carved pumpkin", () => {
    const e = add("enderman", 8);
    const [yaw, pitch] = lookAt(0.5, 8.5);
    players = [player(0.5, yaw, pitch, { pumpkin: true })];
    tick(20);
    expect(e.targetId).toBeNull();
  });

  it("vanish before an arrow lands, taking no harm", () => {
    const e = add("enderman", 0);
    const before = [e.x, e.z];
    expect(e.hurt(ctx(), 9, "arrow", 5, 0.5, "p1")).toBe(false);
    expect(e.health).toBe(40);
    expect([e.x, e.z]).not.toEqual(before);
  });

  it("drop the block they were carrying when they die", () => {
    const e = add("enderman", 0);
    e.carried = B.GRASS;
    e.hurt(ctx(), 100, "player", 5, 0.5, "p1");
    tick(25);
    expect(dropped.some((s) => s.id === B.GRASS)).toBe(true);
  });
});

describe("silverfish", () => {
  it("are arthropods that chase and bite", () => {
    expect(isArthropod("silverfish")).toBe(true);
    add("silverfish", 4);
    players = [player(0.5, 0, 0)];
    tick(200);
    expect(hurt.some((h) => h.id === "p1")).toBe(true);
  });
});

describe("the Ender Dragon", () => {
  const dragonAt = (x: number, y: number) => {
    const d = add("ender_dragon", x, y);
    d.dragon!.podiumY = 11;
    return d;
  };

  it("draws on the nearest crystal to heal, a point every half second", () => {
    // Perched, so it stays within the crystal's reach.
    const d = dragonAt(0, 15);
    d.dragon!.phase = "perch";
    const crystal = new EndCrystal(10.5, 20, 0.5);
    mobs.push(crystal);
    d.health = 150;
    tick(150);
    expect(d.dragon!.crystal).toBe(crystal.id);
    expect(d.health).toBeGreaterThan(150);
    expect(crystal.beam).not.toBeNull();
  });

  it("goes up in a blast of its own when struck, telling whoever listens", () => {
    const blasts: number[] = [];
    let told = 0;
    const crystal = new EndCrystal(0.5, 12, 0.5);
    const c = { ...ctx(), explode: (_x: number, _y: number, _z: number, power: number) => { blasts.push(power); }, crystalDestroyed: () => { told++; } };
    expect(crystal.hurt(c, 1, "player", 0, 0, "p1")).toBe(true);
    expect(crystal.removed).toBe(true);
    expect(blasts).toEqual([6]);
    expect(told).toBe(1);
  });

  it("shrugs off arrows while perched, but not a sword", () => {
    const d = dragonAt(0, 15);
    d.dragon!.phase = "perch";
    expect(dragonHurt(d, 8, "arrow", "head")).toBe(0);
    expect(dragonHurt(d, 8, "player", "head")).toBe(8);
    d.dragon!.phase = "circle";
    expect(dragonHurt(d, 8, "arrow", "head")).toBe(8);
  });

  it("takes a blow in full only on its head: a quarter and a point anywhere else", () => {
    const d = dragonAt(0, 40);
    expect(dragonHurt(d, 8, "player", "head")).toBe(8);
    for (const part of ["neck", "body", "tail", "wing", undefined] as const) expect(dragonHurt(d, 8, "player", part)).toBe(3);
    // A crystal it drew on going up reaches it whole, wherever.
    expect(dragonHurt(d, 10, "magic", "wing")).toBe(10);
  });

  it("lays its head, neck, body, tail and wings out along its heading", () => {
    const d = dragonAt(0, 40);
    d.yaw = 0;
    const parts = d.hitParts()!;
    const head = parts.find((p) => p.name === "head")!.box;
    // Yaw 0 faces -z: the head is five blocks that way, the tail behind.
    expect((head.minZ + head.maxZ) / 2).toBeCloseTo(d.z - 5, 1);
    const tails = parts.filter((p) => p.name === "tail").map((p) => (p.box.minZ + p.box.maxZ) / 2);
    expect(Math.min(...tails)).toBeGreaterThan(d.z + 2);
    const wings = parts.filter((p) => p.name === "wing").map((p) => (p.box.minX + p.box.maxX) / 2);
    expect(Math.max(...wings)).toBeGreaterThan(d.x + 6);
    expect(Math.min(...wings)).toBeLessThan(d.x - 6);
    // Turned to face +x, the head follows.
    d.yaw = -Math.PI / 2;
    const turned = d.hitParts()!.find((p) => p.name === "head")!.box;
    expect((turned.minX + turned.maxX) / 2).toBeCloseTo(d.x + 5, 1);
  });

  it("an arrow that meets its wing does a quarter and a point; one in the eye does it all", () => {
    const d = dragonAt(0, 40);
    d.yaw = 0;
    // From the side of +z moving -z, or (dir -1) from in front moving +z.
    const shoot = (tx: number, ty: number, tz: number, dir = 1) => {
      const a = new Projectile("arrow", tx, ty, tz + 6 * dir, 0, 0, -2 * dir, "p1");
      mobs.push(a);
      const before = d.health;
      for (let i = 0; i < 6 && !a.removed && !a.inGround; i++) { a.beginTick(); a.tick(ctx()); }
      d.invulnerable = 0;
      return before - d.health;
    };
    const wing = d.hitParts()!.filter((p) => p.name === "wing")[2].box;
    expect(shoot((wing.minX + wing.maxX) / 2, (wing.minY + wing.maxY) / 2, wing.maxZ)).toBeCloseTo(4 / 4 + 1, 0);
    const head = d.hitParts()!.find((p) => p.name === "head")!.box;
    // Met head on, from in front, the arrow finds the head before anything else.
    expect(shoot((head.minX + head.maxX) / 2, (head.minY + head.maxY) / 2, head.minZ, -1)).toBeGreaterThanOrEqual(4);
  });

  it("comes down onto the portal's pillar once no crystal is left", () => {
    rand = () => 0;
    const d = dragonAt(60, 40);
    for (let i = 0; i < 1500 && d.dragon!.phase !== "perch"; i++) tick(1);
    expect(d.dragon!.phase).toBe("perch");
    expect(Math.hypot(d.x - 0.5, d.z - 0.5)).toBeLessThan(1);
    expect(d.y).toBe(15);
  });

  it("breaks through whatever it flies into, except end stone, obsidian and bedrock", () => {
    const d = dragonAt(0, 12);
    for (let x = -2; x <= 2; x++) {
      world.setBlock(x, 12, 1, B.STONE, 0);
      world.setBlock(x, 13, 1, B.OBSIDIAN, 0);
    }
    tick(4);
    expect(world.blockAt(0, 12, 1)).toBe(B.AIR);
    expect(world.blockAt(0, 13, 1)).toBe(B.OBSIDIAN);
    expect(world.blockAt(0, 10, 0)).toBe(B.END_STONE);
    void d;
  });

  it("rises for ten seconds when slain, then is gone and its reward is called for", () => {
    const d = dragonAt(0, 40);
    d.hurtPart = "head";
    d.hurt(ctx(), 500, "player", 0, 0, "p1");
    tick(100);
    expect(d.removed).toBe(false);
    expect(d.y).toBeGreaterThan(45);
    tick(120);
    expect(d.removed).toBe(true);
    expect(defeated).toBe(1);
  });
});

// ---- elytra ------------------------------------------------------------------------------------------

// Each of these flies a player for hundreds of ticks over generated terrain: three and a half seconds
// alone, and past vitest's five-second default when the machine is busy. A timeout is not a result.
describe("elytra", { timeout: 20000 }, () => {
  const glider = (damage = 0) => {
    const p = new Player("p1", "Alex", 0.5, 100, 0.5);
    p.inventory.armor[1] = { id: itemId("elytra"), count: 1, damage };
    return p;
  };
  const rules = { difficulty: 2 as const, naturalRegeneration: true, raining: false };
  const input = (jump: boolean) => ({ forward: 0, strafe: 0, jump, sneak: false, sprint: false });

  it("open with a jump in mid-fall and carry the player far further than they drop", () => {
    const w = flatWorld((_x, y) => (y === 0 ? B.BEDROCK : B.AIR), 8);
    const p = glider();
    p.pitch = -0.2;
    for (let i = 0; i < 10; i++) p.tick(w, input(false), rules);
    p.tick(w, input(true), rules);
    expect(p.gliding).toBe(true);
    expect(p.body.height).toBeCloseTo(0.6);
    const y0 = p.body.y, z0 = p.body.z;
    for (let i = 0; i < 100; i++) p.tick(w, input(false), rules);
    const drop = y0 - p.body.y, across = Math.abs(p.body.z - z0);
    expect(across).toBeGreaterThan(drop * 3);
    expect(p.health).toBe(20);
  });

  it("fold on landing, having worn a point for each second aloft", () => {
    const w = flatWorld((_x, y) => (y <= 80 ? B.END_STONE : B.AIR), 8);
    const p = glider();
    p.pitch = -0.6;
    p.tick(w, input(false), rules);
    p.tick(w, input(true), rules);
    let ticks = 0;
    while (p.gliding && ticks < 600) { p.tick(w, input(false), rules); ticks++; }
    expect(p.gliding).toBe(false);
    // Folded, the player stands back up to full height on the ground.
    p.tick(w, input(false), rules);
    expect(p.body.onGround).toBe(true);
    expect(p.body.height).toBeCloseTo(1.8);
    const worn = p.inventory.armor[1]?.damage ?? 0;
    expect(worn).toBeGreaterThanOrEqual(Math.floor(ticks / 20) - 1);
    expect(worn).toBeLessThanOrEqual(Math.floor(ticks / 20) + 1);
  });

  it("will not open once worn to their last point", () => {
    const w = flatWorld((_x, y) => (y === 0 ? B.BEDROCK : B.AIR), 2);
    const p = glider(itemByName("elytra").durability! - 1);
    p.tick(w, input(false), rules);
    p.tick(w, input(true), rules);
    expect(p.gliding).toBe(false);
  });

  it("go faster with a firework rocket pushing", () => {
    const w = flatWorld((_x, y) => (y === 0 ? B.BEDROCK : B.AIR), 8);
    const speed = (boost: boolean) => {
      const p = glider();
      p.pitch = 0;
      p.tick(w, input(false), rules);
      p.tick(w, input(true), rules);
      for (let i = 0; i < 30; i++) { if (boost) p.boostTicks = 5; p.tick(w, input(false), rules); }
      return Math.hypot(p.body.vx, p.body.vz);
    };
    expect(speed(true)).toBeGreaterThan(speed(false) * 1.5);
  });

  it("are not worn by blows, as armour is", () => {
    const p = glider();
    p.inventory.armor[2] = { id: itemId("iron_leggings"), count: 1 };
    p.rng = () => 0;
    p.hurt(8, "mob");
    expect(p.inventory.armor[1]?.damage).toBe(0);
    expect(p.inventory.armor[2]?.damage).toBeGreaterThan(0);
  });
});

describe("the End's advancements", () => {
  it("awards Free the End for the dragon, and The Next Generation for holding its egg", () => {
    const inv = new Inventory();
    expect(newlyEarned(new Set(), { inventory: inv, y: 64, level: 0, dimension: "end" }, { kind: "dragon" }).map((a) => a.id)).toContain("dragon");
    inv.add({ id: B.DRAGON_EGG, count: 1 });
    expect(newlyEarned(new Set(), { inventory: inv, y: 64, level: 0, dimension: "end" }).map((a) => a.id)).toContain("egg");
    expect(newlyEarned(new Set(), { inventory: inv, y: 64, level: 0 }, { kind: "dimension", dimension: "end" }).map((a) => a.id)).toContain("end");
  });
});
