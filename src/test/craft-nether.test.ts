import { beforeEach, describe, expect, it } from "vitest";
import { newlyEarned } from "@/craft/engine/advancements";
import { BiomeId } from "@/craft/engine/biomes";
import { B } from "@/craft/engine/blocks";
import { BlockRules, cropDrops, type RuleContext } from "@/craft/engine/blockRules";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "@/craft/engine/constants";
import { smeltResult } from "@/craft/engine/crafting";
import { ItemEntity, Projectile, type Entity, type EntityContext, type PlayerRef } from "@/craft/engine/entities";
import { createGenerator } from "@/craft/engine/generators";
import { Inventory, sanitizeStack } from "@/craft/engine/inventory";
import { itemByName, itemId, type ItemStack, type StatusEffect } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { BARTER, barter, Mob } from "@/craft/engine/mobs";
import { fortressInRegion, fortressLoot, FORTRESS_REGION, inFortress, NETHER_LAVA_LEVEL, NetherGenerator } from "@/craft/engine/nether";
import { findPortalFrame, planPortal, portalHolds } from "@/craft/engine/portal";
import { smithingResult } from "@/craft/engine/smithing";
import { World } from "@/craft/engine/world";
import { chunkStoreKey, newWorldMeta, SaveStore } from "@/craft/game/save";

// ---- generation ------------------------------------------------------------------------------

describe("the Nether's terrain", () => {
  const gen = new NetherGenerator(4242);

  it("closes the world with bedrock at the very bottom and the very top", () => {
    const c = gen.generate(0, 0);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      expect(c.blocks[blockIndex(x, 0, z)]).toBe(B.BEDROCK);
      expect(c.blocks[blockIndex(x, WORLD_HEIGHT - 1, z)]).toBe(B.BEDROCK);
    }
  });

  it("generates the same chunk every time, whatever was generated before it", () => {
    const a = new NetherGenerator(4242).generate(3, -2);
    new NetherGenerator(4242).generate(9, 9);
    const other = new NetherGenerator(4242);
    other.generate(4, -2);
    const b = other.generate(3, -2);
    expect(Buffer.from(b.blocks).equals(Buffer.from(a.blocks))).toBe(true);
  });

  it("fills its low caverns with a sea of lava, never above y=31", () => {
    let lava = 0;
    for (let cx = -3; cx <= 3; cx++) {
      const c = gen.generate(cx, 0);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (c.blocks[i] !== B.LAVA) continue;
        const y = i >> 8;
        // Lava pools in the basalt deltas sit on their floors; the sea is everything else.
        if (c.biomes[i & 255] !== BiomeId.BasaltDeltas) expect(y).toBeLessThanOrEqual(NETHER_LAVA_LEVEL);
        lava++;
      }
    }
    expect(lava).toBeGreaterThan(500);
  });

  it("has all five of its biomes, in shares none of which crowds out the rest", () => {
    const counts = new Map<number, number>();
    for (let z = -3000; z < 3000; z += 60) for (let x = -3000; x < 3000; x += 60) {
      const b = gen.biomeAt(x, z);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (const b of [BiomeId.NetherWastes, BiomeId.SoulSandValley, BiomeId.CrimsonForest, BiomeId.WarpedForest, BiomeId.BasaltDeltas]) {
      expect((counts.get(b) ?? 0) / total).toBeGreaterThan(0.08);
    }
  });

  it("hides ancient debris where no air or lava touches it", () => {
    let found = 0;
    for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) {
      const c = gen.generate(cx, cz);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (c.blocks[i] !== B.ANCIENT_DEBRIS) continue;
        found++;
        const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
          expect([B.AIR, B.LAVA]).not.toContain(c.blocks[blockIndex(nx, y + dy, nz)]);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("puts nylium on crimson and warped forest floors and grows huge fungi on it", () => {
    const seen = new Set<number>();
    for (let cz = -6; cz <= 6; cz++) for (let cx = -6; cx <= 6; cx++) {
      const c = gen.generate(cx * 3, cz * 3);
      for (const id of c.blocks) seen.add(id);
    }
    for (const id of [B.CRIMSON_NYLIUM, B.WARPED_NYLIUM, B.CRIMSON_STEM, B.WARPED_STEM, B.NETHER_WART_BLOCK, B.WARPED_WART_BLOCK, B.GLOWSTONE, B.NETHER_QUARTZ_ORE]) {
      expect(seen.has(id)).toBe(true);
    }
  });

  it("is the generator the workers build for the Nether", () => {
    expect(createGenerator({ seed: 1, type: "default", dimension: "nether" })).toBeInstanceOf(NetherGenerator);
  });
});

describe("fortresses", () => {
  const seed = 77;
  const first = () => {
    for (let rx = 0; rx < 30; rx++) {
      const f = fortressInRegion(seed, rx, 0);
      if (f) return f;
    }
    throw new Error("no fortress in 30 regions");
  };

  it("plans the same fortress every time, with a blaze spawner and a wart garden in each", () => {
    for (let rx = 0; rx < 30; rx++) {
      const f = fortressInRegion(seed, rx, 0);
      if (!f) continue;
      expect(fortressInRegion(seed, rx, 0)).toEqual(f);
      expect(f.pieces.some((p) => p.kind === "spawner")).toBe(true);
      expect(f.pieces.some((p) => p.kind === "wart")).toBe(true);
      expect(f.spawners.length).toBeGreaterThan(0);
    }
  });

  it("stands at the height the original's do, high over the lava", () => {
    const f = first();
    expect(f.y).toBeGreaterThanOrEqual(48);
    expect(f.y).toBeLessThan(70);
    expect(f.x1 - f.x0).toBeLessThan(FORTRESS_REGION * 16);
  });

  it("builds its spawner, bricks and nether wart into the chunks it covers", () => {
    const f = first();
    const [sx, sy, sz] = f.spawners[0];
    const gen = new NetherGenerator(seed);
    const c = gen.generate(sx >> 4, sz >> 4);
    expect(c.blocks[blockIndex(sx & 15, sy, sz & 15)]).toBe(B.SPAWNER);
    expect(c.blocks[blockIndex(sx & 15, f.y, sz & 15)]).toBe(B.NETHER_BRICKS);
    const wart = f.pieces.find((p) => p.kind === "wart")!;
    const wc = gen.generate((wart.x0 + 1) >> 4, (wart.z0 + 3) >> 4);
    let warts = 0;
    for (const id of wc.blocks) if (id === B.NETHER_WART) warts++;
    expect(warts).toBeGreaterThan(0);
  });

  it("knows where its own ground is, for blazes and wither skeletons to spawn on", () => {
    const f = first();
    const p = f.pieces[0];
    expect(inFortress(seed, (p.x0 + p.x1) / 2, f.y + 1, (p.z0 + p.z1) / 2)).toBe(true);
    expect(inFortress(seed, (p.x0 + p.x1) / 2, f.y + 40, (p.z0 + p.z1) / 2)).toBe(false);
  });

  it("stocks its chests with items that exist", () => {
    for (let s = 0; s < 40; s++) {
      const items: (ItemStack | null)[] = new Array(27).fill(null);
      fortressLoot(items, s);
      for (const it of items) if (it) expect(sanitizeStack(it)).toEqual(it);
    }
  });
});

// ---- portals ------------------------------------------------------------------------------

function flatWorld(fill: (x: number, y: number, z: number) => number): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = fill(cx * 16 + x, y, cz * 16 + z);
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}
const ground = (_x: number, y: number) => (y <= 10 ? B.STONE : B.AIR);

/** A 4-wide, 5-tall obsidian frame along x, standing on y=11, its inside x 1..2, y 12..14. */
function frame(world: World, corners = true): void {
  for (let x = 0; x <= 3; x++) for (let y = 11; y <= 15; y++) {
    const edge = x === 0 || x === 3 || y === 11 || y === 15;
    const corner = (x === 0 || x === 3) && (y === 11 || y === 15);
    if (edge && (corners || !corner)) world.setBlock(x, y, 0, B.OBSIDIAN);
  }
}
const getter = (world: World) => (x: number, y: number, z: number) => world.getBlock(x, y, z);

describe("portal frames", () => {
  it("finds the inside of a complete frame, two wide and three tall", () => {
    const world = flatWorld(ground);
    frame(world);
    const f = findPortalFrame(getter(world), 1, 12, 0);
    expect(f?.axis).toBe(0);
    expect(f?.cells).toHaveLength(6);
  });

  it("does without the corners, as the original does", () => {
    const world = flatWorld(ground);
    frame(world, false);
    expect(findPortalFrame(getter(world), 2, 13, 0)?.cells).toHaveLength(6);
  });

  it("finds a frame built the other way round", () => {
    const world = flatWorld(ground);
    for (let z = 0; z <= 3; z++) for (let y = 11; y <= 15; y++) if (z === 0 || z === 3 || y === 11 || y === 15) world.setBlock(5, y, z, B.OBSIDIAN);
    expect(findPortalFrame(getter(world), 5, 12, 1)?.axis).toBe(1);
  });

  it("refuses a frame with a gap in it, or one only a block wide", () => {
    const world = flatWorld(ground);
    frame(world);
    world.setBlock(3, 13, 0, B.STONE);
    expect(findPortalFrame(getter(world), 1, 12, 0)).toBeNull();
    const narrow = flatWorld(ground);
    for (let x = 0; x <= 2; x++) for (let y = 11; y <= 15; y++) if (x !== 1 || y === 11 || y === 15) narrow.setBlock(x, y, 0, B.OBSIDIAN);
    expect(findPortalFrame(getter(narrow), 1, 12, 0)).toBeNull();
  });

  it("lets a portal block stand only while portal or obsidian holds it on every side", () => {
    const world = flatWorld(ground);
    frame(world);
    for (const [x, y, z] of findPortalFrame(getter(world), 1, 12, 0)!.cells) world.setBlock(x, y, z, B.NETHER_PORTAL, 0);
    expect(portalHolds(getter(world), 1, 12, 0, 0)).toBe(true);
    world.setBlock(0, 12, 0, B.AIR);
    expect(portalHolds(getter(world), 1, 12, 0, 0)).toBe(false);
  });

  it("builds a new portal on open ground, or forces one on a ledge into solid rock", () => {
    const open = flatWorld(ground);
    const plan = planPortal(getter(open), 0, 11, 0, 0, 8, 2, 100);
    expect(plan.y).toBe(11);
    expect(plan.blocks.filter(([, , , id]) => id === B.NETHER_PORTAL)).toHaveLength(6);
    const rock = flatWorld(() => B.STONE);
    const forced = planPortal(getter(rock), 0, 40, 0, 1, 4, 30, 60);
    expect(forced.y).toBe(40);
    expect(forced.blocks.some(([, y, , id]) => y === 39 && id === B.OBSIDIAN)).toBe(true);
    expect(forced.blocks.some(([, , , id]) => id === B.AIR)).toBe(true);
  });
});

// ---- fire and the Nether's rules ---------------------------------------------------------------

const ruleCtx = (extra: Partial<RuleContext> = {}): RuleContext => ({
  dropItems: () => {}, spawnFalling: () => {}, sound: () => {}, isRaining: () => false, random: Math.random, ...extra,
});
const run = (world: World, rules: BlockRules, n: number) => {
  for (let i = 0; i < n; i++) {
    world.tick++;
    for (const [x, y, z] of world.takeDue()) rules.onTick(x, y, z);
  }
};

describe("fire", () => {
  it("lights a portal when it is set inside an obsidian frame, and records it", () => {
    const world = flatWorld(ground);
    world.simulates = true;
    const lit: number[][] = [];
    const rules = new BlockRules(world, ruleCtx({ portalLit: (x, y, z, axis) => lit.push([x, y, z, axis]) }), { portals: true });
    frame(world);
    world.setBlock(1, 12, 0, B.FIRE, 0);
    run(world, rules, 5);
    expect(world.blockAt(2, 14, 0)).toBe(B.NETHER_PORTAL);
    expect(lit).toEqual([[1, 12, 0, 0]]);
  });

  it("lets the whole portal go when a block of its frame is broken", () => {
    const world = flatWorld(ground);
    world.simulates = true;
    const rules = new BlockRules(world, ruleCtx(), { portals: true });
    frame(world);
    world.setBlock(1, 12, 0, B.FIRE, 0);
    run(world, rules, 5);
    world.setBlock(0, 13, 0, B.AIR);
    run(world, rules, 20);
    for (let x = 1; x <= 2; x++) for (let y = 12; y <= 14; y++) expect(world.blockAt(x, y, 0)).toBe(B.AIR);
  });

  it("never lights a portal in the End", () => {
    const world = flatWorld(ground);
    world.simulates = true;
    const rules = new BlockRules(world, ruleCtx(), { portals: false });
    frame(world);
    world.setBlock(1, 12, 0, B.FIRE, 0);
    run(world, rules, 5);
    expect(world.blockAt(2, 14, 0)).not.toBe(B.NETHER_PORTAL);
  });

  it("burns forever on netherrack, and out on stone", () => {
    const world = flatWorld((x, y) => (y <= 10 ? (x < 0 ? B.NETHERRACK : B.STONE) : B.AIR));
    world.simulates = true;
    const rules = new BlockRules(world, ruleCtx({ random: () => 0.9 }));
    world.setBlock(-3, 11, 0, B.FIRE, 1);
    world.setBlock(3, 11, 0, B.FIRE, 1);
    run(world, rules, 1500);
    expect(world.blockAt(-3, 11, 0)).toBe(B.FIRE);
    expect(world.blockAt(3, 11, 0)).toBe(B.AIR);
  });

  it("catches the planks beside it, and spreads no further when fire tick is off", () => {
    const world = flatWorld(ground);
    world.simulates = true;
    for (let x = 1; x <= 6; x++) world.setBlock(x, 11, 0, B.OAK_PLANKS);
    const rules = new BlockRules(world, ruleCtx({ random: () => 0.01 }));
    world.setBlock(0, 11, 0, B.FIRE, 1);
    run(world, rules, 200);
    expect(world.blockAt(1, 11, 0)).not.toBe(B.OAK_PLANKS);
    const calm = flatWorld(ground);
    calm.simulates = true;
    calm.setBlock(1, 11, 0, B.OAK_PLANKS);
    const still = new BlockRules(calm, ruleCtx({ random: () => 0.01, fireSpreads: () => false }));
    calm.setBlock(0, 11, 0, B.FIRE, 1);
    run(calm, still, 200);
    expect(calm.blockAt(1, 11, 0)).toBe(B.OAK_PLANKS);
  });
});

describe("the Nether's plants and lava", () => {
  it("grows nether wart only on soul sand, to a harvest of two to four", () => {
    const world = flatWorld((_x, y) => (y <= 10 ? B.SOUL_SAND : B.AIR));
    world.simulates = true;
    const rules = new BlockRules(world, ruleCtx());
    world.setBlock(0, 11, 0, B.NETHER_WART, 0);
    for (let i = 0; i < 400 && world.getMeta(0, 11, 0) < 3; i++) rules.randomTicks([{ x: 0, z: 0 }], 0, 3000);
    expect(world.getMeta(0, 11, 0)).toBe(3);
    const ripe = cropDrops(B.NETHER_WART, 3, () => 0.99);
    expect(ripe[0].id).toBe(itemId("nether_wart"));
    expect(ripe[0].count).toBe(4);
    expect(cropDrops(B.NETHER_WART, 1, () => 0.99)[0].count).toBe(1);
  });

  it("runs lava twice as far in the Nether", () => {
    const reach = (fast: boolean) => {
      const world = flatWorld(ground);
      world.simulates = true;
      const rules = new BlockRules(world, ruleCtx(), { lavaFast: fast });
      world.setBlock(0, 11, 0, B.LAVA, 0);
      run(world, rules, 1200);
      let x = 0;
      while (world.blockAt(x + 1, 11, 0) === B.LAVA) x++;
      return x;
    };
    expect(reach(false)).toBe(3);
    expect(reach(true)).toBe(7);
  });
});

// ---- mobs ---------------------------------------------------------------------------------------

let world: World;
let mobs: Entity[];
let players: PlayerRef[];
let hurt: { id: string; amount: number; source: string }[];
let effects: { id: string; effect: StatusEffect }[];
let dropped: ItemStack[];

const ctx = (): EntityContext => ({
  world, tick: 0, daylight: 0, difficulty: 2, random: Math.random, players: () => players,
  hurtPlayer: (id, amount, source) => { hurt.push({ id, amount, source }); }, givePlayer: () => 0, giveXp: () => {},
  spawn: (e) => { mobs.push(e); }, dropItem: (_x, _y, _z, s) => { dropped.push(s); }, explode: () => {}, sound: () => {}, particles: () => {},
  entitiesNear: (x, y, z, r) => mobs.filter((m) => !m.removed && Math.abs(m.x - x) <= r && Math.abs(m.y - y) <= r && Math.abs(m.z - z) <= r),
  placeBlock: () => true,
  effectPlayer: (id, effect) => { effects.push({ id, effect }); },
});

const player = (x: number, extra: Partial<PlayerRef> = {}): PlayerRef =>
  ({ id: "p1", name: "Alex", x, y: 11, z: 0.5, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false, ...extra });

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
  world = flatWorld(ground);
  mobs = [];
  players = [];
  hurt = [];
  effects = [];
  dropped = [];
});

describe("zombified piglins", () => {
  it("leave a player alone until one of them is struck, then all come for them", () => {
    const a = add("zombified_piglin", 0), b = add("zombified_piglin", 4);
    players = [player(2.5)];
    tick(80);
    expect(hurt).toHaveLength(0);
    a.hurt(ctx(), 1, "player", 2.5, 0.5, "p1");
    expect(b.targetId).toBe("p1");
    tick(80);
    expect(hurt.some((h) => h.id === "p1")).toBe(true);
  });
});

describe("piglins", () => {
  it("attack a player in no gold, and spare one wearing some", () => {
    add("piglin", 0);
    players = [player(2.5, { goldArmor: true })];
    tick(100);
    expect(hurt).toHaveLength(0);
    players = [player(2.5)];
    tick(100);
    expect(hurt.length).toBeGreaterThan(0);
  });

  it("take a gold ingot, look it over, and toss back something from the barter list", () => {
    const pig = add("piglin", 0);
    players = [player(3, { goldArmor: true })];
    expect(pig.interact(ctx(), "gold_ingot", "p1")).toBe("barter");
    expect(pig.interact(ctx(), "gold_ingot", "p1")).toBeNull();
    tick(130);
    expect(dropped).toHaveLength(1);
  });

  it("pick up gold thrown on the ground", () => {
    const pig = add("piglin", 0);
    mobs.push(new ItemEntity(0.5, 11, 0.9, { id: itemId("gold_ingot"), count: 1 }, 0));
    tick(40);
    expect(pig.admiring).toBeGreaterThan(0);
  });

  it("barter only for things that exist", () => {
    for (const [name] of BARTER) expect(() => itemByName(name)).not.toThrow();
    for (let i = 0; i < 50; i++) expect(barter(Math.random).count).toBeGreaterThan(0);
  });
});

describe("the Nether's other mobs", () => {
  it("never burn: blazes, ghasts and magma cubes shrug off fire and lava", () => {
    for (const kind of ["blaze", "ghast", "magma_cube", "wither_skeleton", "zombified_piglin"] as const) {
      const m = add(kind, 0);
      const health = m.health;
      expect(m.hurt(ctx(), 5, "lava", 0, 0)).toBe(false);
      expect(m.hurt(ctx(), 5, "fire", 0, 0)).toBe(false);
      expect(m.health).toBe(health);
    }
  });

  it("sends a ghast's fireball at a player it can see", () => {
    const ghast = add("ghast", 0, 20);
    players = [player(12)];
    tick(120);
    expect(mobs.some((e) => e instanceof Projectile && e.kind === "fireball")).toBe(true);
    expect(ghast.health).toBe(10);
  });

  it("bats a fireball back the way it was struck, and makes it the striker's", () => {
    const ball = new Projectile("fireball", 5, 12, 0.5, -0.6, 0, 0, "mob:1");
    expect(ball.hurt(ctx(), 1, "player", 3, 0.5, "p1")).toBe(true);
    expect(ball.body.vx).toBeGreaterThan(0);
    expect(ball.owner).toBe("p1");
  });

  it("has a blaze throw its fire in bursts of three", () => {
    add("blaze", 0, 13);
    players = [player(8)];
    tick(200);
    const shots = mobs.filter((e) => e instanceof Projectile && e.kind === "small_fireball").length;
    expect(shots).toBeGreaterThanOrEqual(3);
  });

  it("withers whoever a wither skeleton strikes", () => {
    add("wither_skeleton", 0);
    players = [player(1.5)];
    tick(60);
    expect(effects.some((e) => e.effect === "wither")).toBe(true);
  });

  it("splits a big magma cube into smaller magma cubes", () => {
    const cube = add("magma_cube", 0);
    cube.setSize(4);
    cube.hurt(ctx(), 100, "player", 0, 0, "p1");
    tick(25);
    const children = mobs.filter((e) => e instanceof Mob && e.kind === "magma_cube" && e !== cube) as Mob[];
    expect(children.length).toBeGreaterThanOrEqual(2);
    expect(children.every((c) => c.size === 2)).toBe(true);
  });

  it("drops blaze rods only when a player made the kill", () => {
    const loot = (attacker: string) => {
      dropped = [];
      const b = add("blaze", 0);
      b.hurt(ctx(), 100, "mob", 0, 0, attacker);
      const c = { ...ctx(), random: () => 0.99 };
      for (let i = 0; i < 25 && !b.removed; i++) { b.beginTick(); b.tick(c); }
      return dropped.filter((s) => s.id === itemId("blaze_rod")).length;
    };
    expect(loot("p1")).toBe(1);
    expect(loot("mob:3")).toBe(0);
  });
});

// ---- items, saves and progress -------------------------------------------------------------

describe("netherite", () => {
  it("smelts from ancient debris and is made of four scraps and four gold", () => {
    expect(smeltResult(itemId("ancient_debris"))?.output).toBe("netherite_scrap");
    expect(smeltResult(itemId("netherrack"))?.output).toBe("nether_brick");
  });

  it("upgrades diamond gear at the smithing table, keeping its enchantments and wear", () => {
    const sword = { id: itemId("diamond_sword"), count: 1, damage: 40, ench: { sharpness: 5 }, name: "Edge" };
    const out = smithingResult(sword, { id: itemId("netherite_ingot"), count: 3 });
    expect(out).toEqual({ ...sword, id: itemId("netherite_sword") });
    expect(smithingResult({ id: itemId("iron_sword"), count: 1 }, { id: itemId("netherite_ingot"), count: 1 })).toBeNull();
    expect(smithingResult(sword, { id: itemId("gold_ingot"), count: 1 })).toBeNull();
  });

  it("floats up out of lava rather than burning", () => {
    const lava = flatWorld((_x, y) => (y <= 10 ? B.STONE : y <= 13 ? B.LAVA : B.AIR));
    world = lava;
    const scrap = new ItemEntity(0.5, 11.2, 0.5, { id: itemId("netherite_scrap"), count: 1 }, 0);
    const cobble = new ItemEntity(0.5, 11.2, 0.5, { id: itemId("cobblestone"), count: 1 }, 0);
    for (let i = 0; i < 20; i++) { scrap.beginTick(); scrap.tick(ctx()); cobble.beginTick(); cobble.tick(ctx()); }
    expect(scrap.removed).toBe(false);
    expect(scrap.y).toBeGreaterThan(11.2);
    expect(cobble.removed).toBe(true);
  });
});

describe("dimensions in the save", () => {
  it("keeps each dimension's chunks apart, under the same world", async () => {
    const saves = new SaveStore();
    const meta = newWorldMeta({ name: "Two Worlds", seed: 5, seedText: "5", type: "default", gameMode: "survival", difficulty: 2, hardcore: false, cheats: false });
    await saves.putWorld(meta);
    const chunk = (fill: number) => ({ cx: 1, cz: 2, blocks: new Uint16Array(CHUNK_VOLUME).fill(fill), meta: new Uint8Array(CHUNK_VOLUME), entities: [] });
    await saves.putChunks(meta.id, [chunk(1)]);
    await saves.putChunks(meta.id, [chunk(198)], "nether");
    expect((await saves.getChunk(meta.id, 1, 2))?.blocks[0]).toBe(1);
    expect((await saves.getChunk(meta.id, 1, 2, "nether"))?.blocks[0]).toBe(198);
    expect(await saves.savedChunkKeys(meta.id)).toEqual(["1,2"]);
    expect(await saves.savedChunkKeys(meta.id, "nether")).toEqual(["1,2"]);
    expect(chunkStoreKey(meta.id, 1, 2)).not.toBe(chunkStoreKey(meta.id, 1, 2, "nether"));
    // An export carries both, and an import puts each back where it was.
    const copy = await saves.importWorld(await saves.exportText(meta.id));
    expect((await saves.getChunk(copy.id, 1, 2, "nether"))?.blocks[0]).toBe(198);
    expect((await saves.getChunk(copy.id, 1, 2))?.blocks[0]).toBe(1);
  });
});

describe("advancements", () => {
  it("counts the Overworld's heights only in the Overworld", () => {
    const inventory = new Inventory();
    const ids = (dimension: "overworld" | "nether", y: number) => newlyEarned(new Set(), { inventory, y, level: 0, dimension }).map((a) => a.id);
    expect(ids("overworld", 10)).toContain("deep");
    expect(ids("nether", 10)).not.toContain("deep");
    expect(ids("nether", 120)).not.toContain("summit");
    expect(newlyEarned(new Set(), { inventory, y: 64, level: 0 }, { kind: "dimension", dimension: "nether" }).map((a) => a.id)).toContain("nether");
  });
});
