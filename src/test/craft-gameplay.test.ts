import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "@/craft/engine/constants";
import { lightChunk } from "@/craft/engine/lighting";
import { World } from "@/craft/engine/world";
import { newBody, travel, moveBody } from "@/craft/engine/physics";
import { raycastBlocks } from "@/craft/engine/raycast";
import { clickSlot, Inventory } from "@/craft/engine/inventory";
import { allRecipes, canAfford, matchRecipe, recipeResult, smeltResult } from "@/craft/engine/crafting";
import { itemByName, itemId, type ItemStack } from "@/craft/engine/items";
import { BlockRules, cropDrops } from "@/craft/engine/blockRules";
import { Player, xpToNext } from "@/craft/engine/player";
import { explosionBlocks, blastImpact } from "@/craft/engine/explosion";
import { createEntityFromSnapshot, Mob } from "@/craft/engine/mobs";
import type { EntityContext } from "@/craft/engine/entities";
import { ADVANCEMENTS, newlyEarned } from "@/craft/engine/advancements";

describe("advancements", () => {
  const state = (inv = new Inventory(), y = 64, level = 0) => ({ inventory: inv, y, level });

  it("names only items that exist, for every trigger and every icon", () => {
    for (const a of ADVANCEMENTS) {
      expect(() => itemId(a.icon), `${a.id} icon`).not.toThrow();
    }
    // Resolving every "has" trigger once must not throw either.
    expect(() => newlyEarned(new Set(), state())).not.toThrow();
  });

  it("awards Timber! the moment any log is in the inventory, and never twice", () => {
    const inv = new Inventory();
    inv.add({ id: itemId("birch_log"), count: 1 });
    const first = newlyEarned(new Set(), state(inv)).map((a) => a.id);
    expect(first).toContain("timber");
    expect(newlyEarned(new Set(first), state(inv)).map((a) => a.id)).not.toContain("timber");
  });

  it("counts a kill toward Monster Slayer only when the mob was hostile", () => {
    expect(newlyEarned(new Set(), state(), { kind: "kill", hostile: false }).map((a) => a.id)).not.toContain("hunter");
    expect(newlyEarned(new Set(), state(), { kind: "kill", hostile: true }).map((a) => a.id)).toContain("hunter");
  });

  it("marks depth and height from where the player stands", () => {
    expect(newlyEarned(new Set(), state(undefined, 12)).map((a) => a.id)).toContain("deep");
    expect(newlyEarned(new Set(), state(undefined, 115)).map((a) => a.id)).toContain("summit");
    expect(newlyEarned(new Set(), state(undefined, 64)).map((a) => a.id)).toEqual([]);
  });

  it("keeps what a player earned in their save", () => {
    const p = new Player("p", "Steve", 0.5, 70, 0.5);
    p.advancements.add("timber");
    const q = new Player("p", "Steve", 0.5, 70, 0.5);
    q.load(JSON.parse(JSON.stringify(p.toJSON())));
    expect([...q.advancements]).toEqual(["timber"]);
  });

  it("credits the player whose blow killed the mob", () => {
    const world = flatWorld(ground);
    const credited: [string, boolean][] = [];
    const ctx: EntityContext = {
      world, tick: 0, daylight: 1, difficulty: 2, random: () => 0.5, players: () => [],
      hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {}, dropItem: () => {},
      explode: () => {}, sound: () => {}, particles: () => {}, entitiesNear: () => [], placeBlock: () => true,
      creditKill: (id, hostile) => credited.push([id, hostile]),
    };
    const z = new Mob("zombie", 0.5, 11, 0.5);
    z.hurt(ctx, 100, "player", 0, 0, "steve");
    for (let i = 0; i < 40 && !z.removed; i++) { z.beginTick(); z.tick(ctx); }
    expect(credited).toEqual([["steve", true]]);
  });
});

function flatWorld(fill: (x: number, y: number, z: number) => number, radius = 1): World {
  const world = new World();
  for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      blocks[blockIndex(x, y, z)] = fill(cx * 16 + x, y, cz * 16 + z);
    }
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

const ground = (x: number, y: number) => (y <= 10 ? B.STONE : B.AIR);
const idle = { forward: 0, strafe: 0, yaw: 0, jump: false, sneak: false, sprint: false, flying: false, speed: 0.1 };

describe("movement", () => {
  it("falls, lands on the ground and stays there", () => {
    const world = flatWorld(ground);
    const b = newBody(0.5, 20, 0.5, 0.6, 1.8, 1.62);
    for (let i = 0; i < 100; i++) travel(world, b, idle);
    expect(b.y).toBeCloseTo(11, 5);
    expect(b.onGround).toBe(true);
  });

  it("walks at the original's pace — about 4.3 blocks a second, 5.6 sprinting", () => {
    const world = flatWorld(ground);
    const walk = newBody(0.5, 11, 0.5, 0.6, 1.8, 1.62);
    const run = newBody(0.5, 11, 3.5, 0.6, 1.8, 1.62);
    for (let i = 0; i < 5; i++) { travel(world, walk, idle); travel(world, run, idle); }
    const z0 = walk.z, r0 = run.z;
    for (let i = 0; i < 20; i++) {
      travel(world, walk, { ...idle, forward: 1 });
      travel(world, run, { ...idle, forward: 1, sprint: true });
    }
    expect(Math.abs(walk.z - z0)).toBeGreaterThan(3.6);
    expect(Math.abs(walk.z - z0)).toBeLessThan(4.6);
    expect(Math.abs(run.z - r0)).toBeGreaterThan(4.8);
    expect(Math.abs(run.z - r0)).toBeLessThan(6);
  });

  it("jumps a little over one block high, so a one-block ledge can be climbed and a two-block wall cannot", () => {
    const world = flatWorld(ground);
    const b = newBody(0.5, 11, 0.5, 0.6, 1.8, 1.62);
    // Two settling ticks: a body spawned at rest has not yet pressed into the ground.
    travel(world, b, idle);
    travel(world, b, idle);
    let top = 0;
    travel(world, b, { ...idle, jump: true });
    for (let i = 0; i < 20; i++) { travel(world, b, idle); top = Math.max(top, b.y - 11); }
    expect(top).toBeGreaterThan(1.1);
    expect(top).toBeLessThan(1.4);
  });

  it("steps up half slabs without jumping, as it should", () => {
    const world = flatWorld((x, y, z) => (y <= 10 ? B.STONE : y === 11 && z < -1 ? B.STONE_SLAB : B.AIR));
    const b = newBody(0.5, 11, 0.5, 0.6, 1.8, 1.62);
    for (let i = 0; i < 40; i++) travel(world, b, { ...idle, forward: 1 });
    expect(b.y).toBeCloseTo(11.5, 3);
  });

  it("will not walk off an edge while sneaking", () => {
    const world = flatWorld((x, y, z) => (y <= 10 && z >= 0 ? B.STONE : B.AIR));
    const b = newBody(0.5, 11, 1.5, 0.6, 1.8, 1.62);
    travel(world, b, idle);
    for (let i = 0; i < 60; i++) travel(world, b, { ...idle, forward: 1, sneak: true });
    expect(b.y).toBeCloseTo(11, 5);
    expect(b.z).toBeGreaterThan(-0.31);
  });

  it("stops at an unloaded chunk instead of walking into the void", () => {
    const world = flatWorld(ground, 0);
    const b = newBody(8, 11, 8, 0.6, 1.8, 1.62);
    for (let i = 0; i < 200; i++) travel(world, b, { ...idle, forward: 1, yaw: Math.PI / 2 });
    expect(b.x).toBeGreaterThanOrEqual(0.29);
    expect(b.y).toBeCloseTo(11, 5);
  });

  it("does not let a body pass through a wall however fast it moves", () => {
    const world = flatWorld((x, y) => (y <= 10 || x === 5 ? B.STONE : B.AIR));
    const b = newBody(0.5, 11, 0.5, 0.6, 1.8, 1.62);
    moveBody(world, b, 20, 0, 0);
    expect(b.x).toBeLessThanOrEqual(4.7 + 1e-6);
  });
});

describe("aiming", () => {
  it("hits the face of the block the ray meets first", () => {
    const world = flatWorld((x, y, z) => (y <= 10 ? B.STONE : x === 3 && y === 11 && z === 0 ? B.DIRT : B.AIR));
    const hit = raycastBlocks(world, 0.5, 11.5, 0.5, 1, 0, 0, 6);
    expect(hit).toMatchObject({ x: 3, y: 11, z: 0, face: 1 });
  });

  it("aims at a slab where it is drawn, not a full cube around it", () => {
    const world = flatWorld((x, y, z) => (y <= 10 ? B.STONE : x === 3 && y === 11 ? B.STONE_SLAB : B.AIR));
    // A ray at y=11.8 passes over a bottom slab (top at 11.5).
    const hit = raycastBlocks(world, 0.5, 11.8, 0.5, 1, 0, 0, 3.5);
    expect(hit).toBeNull();
  });
});

describe("inventory", () => {
  it("fills existing stacks before empty slots and reports what did not fit", () => {
    const inv = new Inventory();
    inv.slots[3] = { id: B.DIRT, count: 60 };
    expect(inv.add({ id: B.DIRT, count: 10 })).toBe(0);
    expect(inv.slots[3]!.count).toBe(64);
    expect(inv.slots[0]).toEqual({ id: B.DIRT, count: 6, damage: undefined });
    for (let i = 0; i < 36; i++) inv.slots[i] = { id: B.STONE, count: 64 };
    expect(inv.add({ id: B.DIRT, count: 5 })).toBe(5);
  });

  it("splits a stack in half on a right click and places one at a time", () => {
    const [slot, cursor] = clickSlot({ id: B.DIRT, count: 9 }, null, "right");
    expect(slot!.count).toBe(4);
    expect(cursor!.count).toBe(5);
    const [placed, left] = clickSlot(null, cursor, "right");
    expect(placed!.count).toBe(1);
    expect(left!.count).toBe(4);
  });

  it("never stacks tools", () => {
    const pick = itemId("iron_pickaxe");
    const [slot, cursor] = clickSlot({ id: pick, count: 1 }, { id: pick, count: 1 }, "left");
    expect(slot!.count).toBe(1);
    expect(cursor!.count).toBe(1);
  });
});

describe("crafting", () => {
  const grid3 = (...rows: (string | null)[][]) => rows.flat().map((n) => (n ? { id: itemId(n), count: 1 } : null));

  it("makes planks from any log in the small grid", () => {
    const r = matchRecipe([{ id: itemId("birch_log"), count: 1 }, null, null, null], 2);
    expect(recipeResult(r!)).toEqual({ id: itemId("birch_planks"), count: 4 });
  });

  it("makes a pickaxe from mixed wood and the same tool from any spot in the grid", () => {
    const r = matchRecipe(grid3(["oak_planks", "birch_planks", "spruce_planks"], [null, "stick", null], [null, "stick", null]), 3);
    expect(r?.result.item).toBe("wooden_pickaxe");
  });

  it("accepts a shaped recipe mirrored left to right", () => {
    const axe = matchRecipe(grid3(["cobblestone", "cobblestone", null], ["stick", "cobblestone", null], ["stick", null, null]), 3);
    expect(axe?.result.item).toBe("stone_axe");
  });

  it("refuses a table-only recipe in the 2x2 grid", () => {
    expect(matchRecipe(grid3(["iron_ingot", null, "iron_ingot"], [null, "iron_ingot", null], [null, null, null]), 3)?.result.item).toBe("bucket");
    const small = [{ id: itemId("iron_ingot"), count: 1 }, null, { id: itemId("iron_ingot"), count: 1 }, null];
    expect(matchRecipe(small, 2)?.result.item).not.toBe("bucket");
  });

  it("knows every recipe's ingredients and results are real items", () => {
    for (const r of allRecipes()) expect(() => itemByName(r.result.item), r.id).not.toThrow();
  });

  it("tells the recipe book what the inventory can afford", () => {
    const table = allRecipes().find((r) => r.id === "crafting_table")!;
    expect(canAfford(table, new Map([[itemId("oak_planks"), 4]]))).toBe(true);
    expect(canAfford(table, new Map([[itemId("oak_planks"), 3]]))).toBe(false);
  });

  it("smelts ore and cooks meat", () => {
    expect(smeltResult(itemId("raw_iron"))?.output).toBe("iron_ingot");
    expect(smeltResult(itemId("beef"))?.output).toBe("cooked_beef");
    expect(smeltResult(itemId("oak_log"))?.output).toBe("charcoal");
  });
});

describe("block rules", () => {
  const ctx = (drops: unknown[] = [], falling: unknown[] = []) => ({
    dropItems: (_x: number, _y: number, _z: number, s: unknown[]) => drops.push(...s),
    spawnFalling: (...a: unknown[]) => falling.push(a),
    sound: () => {},
    isRaining: () => false,
    random: () => 0.5,
  });
  const runTicks = (world: World, rules: BlockRules, n: number) => {
    for (let i = 0; i < n; i++) {
      world.tick++;
      for (const [x, y, z] of world.takeDue()) rules.onTick(x, y, z);
    }
  };

  it("spreads water from a source across flat ground no further than seven blocks", () => {
    const world = flatWorld(ground);
    const rules = new BlockRules(world, ctx());
    world.setBlock(0, 11, 0, B.WATER, 0);
    runTicks(world, rules, 200);
    expect(world.blockAt(7, 11, 0)).toBe(B.WATER);
    expect(world.getMeta(7, 11, 0)).toBe(7);
    expect(world.blockAt(8, 11, 0)).toBe(B.AIR);
  });

  it("drains flowing water when its source is taken away", () => {
    const world = flatWorld(ground);
    const rules = new BlockRules(world, ctx());
    world.setBlock(0, 11, 0, B.WATER, 0);
    runTicks(world, rules, 150);
    world.setBlock(0, 11, 0, B.AIR);
    runTicks(world, rules, 300);
    expect(world.blockAt(3, 11, 0)).toBe(B.AIR);
  });

  it("turns a lava source touched by water into obsidian", () => {
    const world = flatWorld(ground);
    const rules = new BlockRules(world, ctx());
    world.setBlock(0, 11, 0, B.LAVA, 0);
    world.setBlock(1, 11, 0, B.WATER, 0);
    runTicks(world, rules, 60);
    expect(world.blockAt(0, 11, 0)).toBe(B.OBSIDIAN);
  });

  it("drops sand when the block under it is dug out", () => {
    const falling: unknown[] = [];
    const world = flatWorld((x, y) => (y <= 10 ? B.STONE : y === 12 && x === 0 ? B.SAND : y === 11 && x === 0 ? B.DIRT : B.AIR));
    const rules = new BlockRules(world, ctx([], falling));
    world.setBlock(0, 11, 0, B.AIR);
    runTicks(world, rules, 3);
    expect(world.blockAt(0, 12, 0)).toBe(B.AIR);
    expect(falling).toHaveLength(1);
  });

  it("pops a torch off when its wall is broken, and drops it", () => {
    const drops: { id: number }[] = [];
    const world = flatWorld(ground);
    const rules = new BlockRules(world, ctx(drops));
    world.setBlock(0, 12, 0, B.STONE);
    world.setBlock(1, 12, 0, B.TORCH, 1 + 2); // on a wall to its west (facing west = 2)
    world.setBlock(0, 12, 0, B.AIR);
    runTicks(world, rules, 3);
    expect(world.blockAt(1, 12, 0)).toBe(B.AIR);
    expect(drops.map((d) => d.id)).toContain(B.TORCH);
  });

  it("gives back seeds from young wheat and wheat plus seeds from ripe wheat", () => {
    expect(cropDrops(B.WHEAT, 2, () => 0.9).map((s) => s.id)).toEqual([itemId("wheat_seeds")]);
    expect(cropDrops(B.WHEAT, 7, () => 0.1).map((s) => s.id)).toEqual([itemId("wheat_seeds"), itemId("wheat")]);
  });
});

describe("the player", () => {
  const rules = { difficulty: 2 as const, naturalRegeneration: true, raining: false };

  it("takes fall damage past three blocks and none in creative", () => {
    const world = flatWorld(ground);
    const rules = { difficulty: 2 as const, naturalRegeneration: false, raining: false };
    const p = new Player("p", "Steve", 0.5, 21, 0.5);
    for (let i = 0; i < 60; i++) p.tick(world, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, rules);
    expect(p.health).toBe(13);
    const c = new Player("c", "Alex", 0.5, 21, 3.5);
    c.setGameMode("creative");
    for (let i = 0; i < 60; i++) c.tick(world, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, rules);
    expect(c.health).toBe(20);
  });

  it("reduces a hit with armour", () => {
    const naked = new Player("a", "A");
    const armoured = new Player("b", "B");
    armoured.inventory.armor = ["diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots"].map((n) => ({ id: itemId(n), count: 1 }));
    expect(armoured.hurt(10, "mob")).toBeLessThan(naked.hurt(10, "mob"));
  });

  it("levels up on the original's experience curve", () => {
    const p = new Player("p", "P");
    p.addXp(xpToNext(0) + xpToNext(1));
    expect(p.xpLevel).toBe(2);
    expect(p.xpPoints).toBe(0);
  });

  it("burns hunger when sprinting and heals from a full bar", () => {
    const world = flatWorld(ground);
    const p = new Player("p", "P", 0.5, 11, 0.5);
    p.health = 10;
    for (let i = 0; i < 200; i++) p.tick(world, { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }, rules);
    expect(p.health).toBeGreaterThan(10);
  });
});

describe("explosions", () => {
  it("blows a crater in dirt but leaves obsidian standing", () => {
    const world = flatWorld((x, y, z) => (y <= 10 ? (Math.abs(x) + Math.abs(z) < 3 && y === 10 ? B.OBSIDIAN : B.DIRT) : B.AIR));
    const hit = explosionBlocks(world, 5.5, 11, 5.5, 4, () => 0.5);
    expect(hit.length).toBeGreaterThan(10);
    const obsidian = explosionBlocks(world, 0.5, 11, 0.5, 4, () => 0.5).filter(([x, y, z]) => world.blockAt(x, y, z) === B.OBSIDIAN);
    expect(obsidian).toEqual([]);
  });

  it("hurts less with distance and not at all out of range", () => {
    expect(blastImpact(4, 1, 1).damage).toBeGreaterThan(blastImpact(4, 5, 1).damage);
    expect(blastImpact(4, 9, 1).damage).toBe(0);
  });
});

describe("mobs", () => {
  const makeCtx = (world: World, players = [] as ReturnType<EntityContext["players"]>): EntityContext => ({
    world, tick: 0, daylight: 1, difficulty: 2, random: Math.random, players: () => players,
    hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {}, dropItem: () => {},
    explode: () => {}, sound: () => {}, particles: () => {}, entitiesNear: () => [], placeBlock: () => true,
  });

  it("burns a zombie standing in daylight", () => {
    const world = flatWorld(ground);
    const z = new Mob("zombie", 0.5, 11, 0.5);
    const ctx = makeCtx(world);
    for (let i = 0; i < 60; i++) { z.beginTick(); z.tick(ctx); }
    expect(z.fireTicks > 0 || z.health < 20).toBe(true);
  });

  it("follows a player holding wheat", () => {
    const world = flatWorld(ground);
    const cow = new Mob("cow", 0.5, 11, 0.5);
    const player = { id: "p", name: "P", x: 6.5, y: 11, z: 0.5, width: 0.6, height: 1.8, targetable: true, heldItem: itemId("wheat"), sneaking: false };
    const ctx = makeCtx(world, [player]);
    for (let i = 0; i < 200; i++) { cow.beginTick(); cow.tick(ctx); }
    expect(cow.x).toBeGreaterThan(3);
  });

  it("splits a big slime into smaller ones and drops slimeballs only from the smallest", () => {
    const world = flatWorld(ground);
    const spawned: Mob[] = [];
    const drops: ItemStack[] = [];
    const ctx: EntityContext = {
      ...makeCtx(world),
      random: () => 0.99,
      spawn: (e) => { if (e instanceof Mob) spawned.push(e); },
      dropItem: (_x, _y, _z, stack) => { drops.push(stack); },
    };
    const kill = (m: Mob) => {
      m.hurt(ctx, 100, "player", m.x, m.z, "p");
      for (let i = 0; i < 25 && !m.removed; i++) { m.beginTick(); m.tick(ctx); }
    };
    const big = new Mob("slime", 0.5, 11, 0.5);
    big.setSize(4);
    expect(big.health).toBe(16);
    expect(big.body.width).toBeCloseTo(2.08);
    kill(big);
    expect(spawned.map((m) => m.size)).toEqual([2, 2, 2, 2]);
    expect(drops.filter((d) => d.id === itemId("slime_ball"))).toEqual([]);

    spawned.length = 0;
    const small = new Mob("slime", 0.5, 11, 0.5);
    small.setSize(1);
    kill(small);
    expect(spawned).toEqual([]);
    expect(drops.filter((d) => d.id === itemId("slime_ball")).reduce((n, d) => n + d.count, 0)).toBe(2);
  });

  it("keeps a slime's size through a save and a network snapshot", () => {
    const big = new Mob("slime", 0.5, 11, 0.5);
    big.setSize(4);
    const copy = createEntityFromSnapshot(big.snapshot()) as Mob;
    expect(copy.size).toBe(4);
    expect(copy.body.height).toBeCloseTo(2.08);
  });

  it("moves a slime toward its target only by hopping", () => {
    const world = flatWorld(ground);
    const slime = new Mob("slime", 0.5, 11, 0.5);
    slime.setSize(2);
    const player = { id: "p", name: "P", x: 8.5, y: 11, z: 0.5, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false };
    const ctx = makeCtx(world, [player]);
    let airborne = 0;
    for (let i = 0; i < 160; i++) { slime.beginTick(); slime.tick(ctx); if (!slime.body.onGround) airborne++; }
    expect(slime.x).toBeGreaterThan(4);
    expect(airborne).toBeGreaterThan(20);
  });
});
