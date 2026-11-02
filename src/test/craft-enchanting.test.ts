import { describe, expect, it } from "vitest";
import { B, block } from "@/craft/engine/blocks";
import { BREW_TICKS, tickBrewing } from "@/craft/engine/brewing";
import { Chunk, newBrewing } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import {
  ANVIL_LIMIT, anvilResult, applyFortune, countBookshelves, enchantability, ENCHANTMENTS, enchantDef, levelOf, protectionFactor,
  rollEnchantments, tableLevels, canApply, compatible,
} from "@/craft/engine/enchanting";
import type { EntityContext } from "@/craft/engine/entities";
import { ItemEntity } from "@/craft/engine/entities";
import { sameItem, sanitizeStack } from "@/craft/engine/inventory";
import { itemByName, itemDef, itemId, type ItemStack } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { Mob } from "@/craft/engine/mobs";
import { Player } from "@/craft/engine/player";
import { brewResult, POTIONS } from "@/craft/engine/potions";
import { World } from "@/craft/engine/world";
import { breakTicks } from "@/craft/game/actions";

const stack = (name: string, extra: Partial<ItemStack> = {}): ItemStack => ({ id: itemId(name), count: 1, ...extra });

function floorWorld(): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

const ctxFor = (world: World): EntityContext => ({
  world, tick: 0, daylight: 1, difficulty: 2, random: Math.random, players: () => [],
  hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {}, dropItem: () => {},
  explode: () => {}, sound: () => {}, particles: () => {}, entitiesNear: () => [], placeBlock: () => true,
});

describe("the enchanting table", () => {
  it("offers thirty levels in the bottom slot with fifteen bookshelves around it", () => {
    const pick = itemByName("diamond_pickaxe");
    for (let seed = 1; seed < 40; seed++) expect(tableLevels(seed, 15, pick)[2]).toBe(30);
    // With no shelves nothing is offered above eight levels.
    for (let seed = 1; seed < 40; seed++) expect(Math.max(...tableLevels(seed, 0, pick))).toBeLessThanOrEqual(8);
  });

  it("gives the same roll for the same seed, so the hint shown is what the player pays for", () => {
    const sword = itemByName("iron_sword");
    expect(rollEnchantments(1234, 2, 30, sword)).toEqual(rollEnchantments(1234, 2, 30, sword));
  });

  it("only rolls enchantments that fit the item, never a treasure, and never two that clash", () => {
    for (const name of ["diamond_pickaxe", "iron_sword", "diamond_chestplate", "iron_boots", "bow", "book"]) {
      const def = itemByName(name);
      for (let seed = 0; seed < 150; seed++) {
        const r = rollEnchantments(seed * 7919, seed % 3, 5 + (seed % 26), def);
        const names = Object.keys(r);
        expect(names.length).toBeGreaterThan(0);
        for (const n of names) {
          const e = enchantDef(n)!;
          expect(e.treasure).toBeFalsy();
          expect(canApply(e, def)).toBe(true);
          expect(r[n]).toBeGreaterThanOrEqual(1);
          expect(r[n]).toBeLessThanOrEqual(e.maxLevel);
        }
        for (const a of names) for (const b of names) expect(compatible(a, b)).toBe(true);
      }
    }
  });

  it("keeps the first, strongest roll of an enchantment instead of letting a weaker extra replace it", () => {
    const sword = itemByName("diamond_sword");
    // At thirty levels the first pick lands at power 26 or more, where Sharpness is never below III.
    for (let seed = 0; seed < 2000; seed++) {
      const r = rollEnchantments(seed * 7907 + 13, 2, 30, sword);
      const first = Object.keys(r)[0];
      if (first === "sharpness") expect(r.sharpness).toBeGreaterThanOrEqual(3);
    }
  });

  it("puts Efficiency on most thirty-level pickaxes, the way players expect of a full table", () => {
    const pick = itemByName("diamond_pickaxe");
    let efficiency = 0;
    for (let seed = 0; seed < 300; seed++) if (rollEnchantments(seed * 104729, 2, 30, pick).efficiency) efficiency++;
    expect(efficiency).toBeGreaterThan(150);
  });

  it("counts only the shelves with air between them and the table", () => {
    const world = floorWorld();
    const get = (x: number, y: number, z: number) => world.blockAt(x, y, z);
    world.setBlock(0, 11, 0, B.ENCHANTING_TABLE, 0, "player");
    for (const [x, z] of [[2, 0], [2, 1], [-2, 0], [0, 2], [0, -2]]) world.setBlock(x, 11, z, B.BOOKSHELF, 0, "player");
    expect(countBookshelves(get, 0, 11, 0, B.BOOKSHELF)).toBe(5);
    // A torch in the gap cuts off the shelves behind it: the one straight out and the one beside it.
    world.setBlock(1, 11, 0, B.TORCH, 0, "player");
    expect(countBookshelves(get, 0, 11, 0, B.BOOKSHELF)).toBe(3);
  });

  it("knows which items take enchantments at all", () => {
    expect(enchantability(itemByName("golden_sword"))).toBeGreaterThan(enchantability(itemByName("diamond_sword")));
    expect(enchantability(itemByName("stick"))).toBe(0);
  });
});

describe("the anvil", () => {
  it("merges two equal enchantments into the next level", () => {
    const r = anvilResult(stack("iron_sword", { ench: { sharpness: 3 } }), stack("iron_sword", { ench: { sharpness: 3 } }), null)!;
    expect(r.stack.ench).toEqual({ sharpness: 4 });
    expect(r.cost).toBeGreaterThan(0);
  });

  it("puts a book's enchantment on a tool, but leaves out one that clashes with what the tool has", () => {
    const r = anvilResult(stack("diamond_pickaxe", { ench: { fortune: 3 } }), stack("enchanted_book", { ench: { silk_touch: 1, unbreaking: 3 } }), null)!;
    expect(r.stack.ench).toEqual({ fortune: 3, unbreaking: 3 });
    expect(r.stack.id).toBe(itemId("diamond_pickaxe"));
  });

  it("mends a quarter of the durability per unit of material, spending only what it needs", () => {
    const max = itemDef(itemId("iron_pickaxe"))!.durability!;
    const r = anvilResult(stack("iron_pickaxe", { damage: max - 10 }), stack("iron_ingot", { count: 5 }), null)!;
    expect(r.rightUsed).toBe(4);
    expect(r.stack.damage ?? 0).toBe(0);
  });

  it("charges a level to rename, and more each time the same item comes back", () => {
    const first = anvilResult(stack("iron_sword"), null, "Stabby")!;
    expect(first.stack.name).toBe("Stabby");
    expect(first.cost).toBe(1);
    const again = anvilResult(first.stack, null, "Stabbier")!;
    expect(again.cost).toBeGreaterThan(first.cost);
  });

  it("does nothing when the right-hand item is unrelated", () => {
    expect(anvilResult(stack("iron_sword"), stack("dirt"), null)).toBeNull();
  });

  it("reaches 'too expensive' for heavily worked gear", () => {
    const worked = stack("diamond_sword", { ench: { sharpness: 4 }, repair: 31 });
    const r = anvilResult(worked, stack("diamond_sword", { ench: { sharpness: 4 }, repair: 31 }), null)!;
    expect(r.cost).toBeGreaterThanOrEqual(ANVIL_LIMIT);
  });
});

describe("what enchantments do", () => {
  it("stacks protection enchantments up to a cap of twenty points", () => {
    const prot4 = stack("diamond_chestplate", { ench: { protection: 4 } });
    const boots = stack("diamond_boots", { ench: { protection: 4, feather_falling: 4 } });
    expect(protectionFactor([prot4, null, null, null], "mob")).toBe(4);
    expect(protectionFactor([prot4, prot4, prot4, boots], "mob")).toBe(16);
    expect(protectionFactor([prot4, prot4, prot4, boots], "fall")).toBe(20);
    expect(protectionFactor([prot4, prot4, prot4, boots], "void")).toBe(0);
  });

  it("makes protected players take less from the same blow", () => {
    const bare = new Player("a", "A");
    const armored = new Player("b", "B");
    armored.inventory.armor = [null, stack("iron_chestplate", { ench: { protection: 4 } }), null, null];
    bare.inventory.armor = [null, stack("iron_chestplate"), null, null];
    const a = bare.hurt(10, "mob");
    const b = armored.hurt(10, "mob");
    expect(b).toBeLessThan(a);
  });

  it("mines faster with Efficiency and underwater with Aqua Affinity", () => {
    const pick = itemByName("diamond_pickaxe");
    const stone = block(B.STONE);
    const plain = breakTicks(stone, pick, false, true).ticks;
    const fast = breakTicks(stone, pick, false, true, stack("diamond_pickaxe", { ench: { efficiency: 5 } })).ticks;
    expect(fast).toBeLessThan(plain);
    const wet = breakTicks(stone, pick, true, true).ticks;
    const aqua = breakTicks(stone, pick, true, true, null, true).ticks;
    expect(aqua).toBe(plain);
    expect(wet).toBeGreaterThan(plain);
  });

  it("multiplies ore drops with Fortune but never a block's own drop", () => {
    const always = () => 0.99;
    const diamonds = applyFortune([{ id: itemId("diamond"), count: 1 }], 3, always, B.DIAMOND_ORE);
    expect(diamonds[0].count).toBe(4);
    expect(applyFortune([{ id: B.COBBLE, count: 1 }], 3, always, B.STONE)[0].count).toBe(1);
  });

  it("covers every enchantment in the list with a level label", () => {
    for (const e of ENCHANTMENTS) expect(e.maxLevel).toBeGreaterThanOrEqual(1);
  });
});

describe("enchanted stacks", () => {
  it("keeps enchanted and plain copies of an item apart", () => {
    expect(sameItem(stack("iron_sword"), stack("iron_sword", { ench: { sharpness: 1 } }))).toBe(false);
    expect(sameItem(stack("iron_sword", { ench: { sharpness: 1 } }), stack("iron_sword", { ench: { sharpness: 1 } }))).toBe(true);
    expect(sameItem(stack("iron_sword", { name: "A" }), stack("iron_sword"))).toBe(false);
  });

  it("keeps enchantments and names through a save, and drops what it does not recognise", () => {
    const s = sanitizeStack({ id: itemId("iron_sword"), count: 1, ench: { sharpness: 3, made_up: 2, looting: 99 }, name: "Edge", repair: 3 })!;
    expect(s.ench).toEqual({ sharpness: 3 });
    expect(s.name).toBe("Edge");
    expect(s.repair).toBe(3);
  });

  it("does not merge two dropped swords into one stack", () => {
    const world = floorWorld();
    const a = new ItemEntity(0.5, 11, 0.5, stack("iron_sword"), 0);
    const b = new ItemEntity(0.6, 11, 0.5, stack("iron_sword"), 0);
    const ctx = { ...ctxFor(world), entitiesNear: () => [a, b] };
    for (let i = 0; i < 12; i++) { a.beginTick(); a.tick(ctx); }
    expect(b.removed).toBe(false);
    expect(a.stack.count).toBe(1);
  });

  it("reads levels off a stack", () => {
    expect(levelOf(stack("bow", { ench: { power: 5 } }), "power")).toBe(5);
    expect(levelOf(stack("bow"), "power")).toBe(0);
  });
});

describe("brewing", () => {
  const name = (s: ItemStack | null) => (s ? itemDef(s.id)!.name : null);

  it("follows the chain from water to a long splash potion of swiftness", () => {
    expect(brewResult("water_bottle", "nether_wart")).toBe("awkward_potion");
    expect(brewResult("awkward_potion", "sugar")).toBe("potion_swiftness");
    expect(brewResult("potion_swiftness", "redstone")).toBe("long_potion_swiftness");
    expect(brewResult("long_potion_swiftness", "gunpowder")).toBe("splash_long_potion_swiftness");
    expect(brewResult("splash_long_potion_swiftness", "glowstone_dust")).toBe("splash_strong_potion_swiftness");
  });

  it("corrupts potions into their opposites with a fermented spider eye", () => {
    expect(brewResult("potion_healing", "fermented_spider_eye")).toBe("potion_harming");
    expect(brewResult("strong_potion_healing", "fermented_spider_eye")).toBe("strong_potion_harming");
    expect(brewResult("long_potion_night_vision", "fermented_spider_eye")).toBe("long_potion_invisibility");
    expect(brewResult("water_bottle", "fermented_spider_eye")).toBe("potion_weakness");
  });

  it("registers an item for every potion and its splash twin", () => {
    for (const p of POTIONS) {
      expect(itemDef(itemId(p.key))?.use).toBe("drink");
      expect(itemDef(itemId(`splash_${p.key}`))?.use).toBe("splash");
    }
  });

  it("brews in twenty seconds on one blaze powder, and uses up the ingredient", () => {
    const e = newBrewing();
    e.bottles = [stack("water_bottle"), stack("water_bottle"), null];
    e.ingredient = stack("nether_wart", { count: 2 });
    e.fuel = stack("blaze_powder");
    let ticks = 0, finished = false;
    while (!finished && ticks < 1000) { finished = tickBrewing(e).finished; ticks++; }
    expect(ticks).toBe(BREW_TICKS + 1);
    expect(e.bottles.map(name)).toEqual(["awkward_potion", "awkward_potion", null]);
    expect(e.ingredient?.count).toBe(1);
    expect(e.fuel).toBeNull();
    expect(e.fuelLeft).toBe(19);
  });

  it("stops a brew when the ingredient is taken away, without spending it", () => {
    const e = newBrewing();
    e.bottles = [stack("water_bottle"), null, null];
    e.ingredient = stack("nether_wart");
    e.fuelLeft = 5;
    tickBrewing(e);
    expect(e.brew).toBeGreaterThan(0);
    e.ingredient = null;
    tickBrewing(e);
    expect(e.brew).toBe(0);
    expect(name(e.bottles[0])).toBe("water_bottle");
  });

  it("does not start when the ingredient changes nothing", () => {
    const e = newBrewing();
    e.bottles = [stack("potion_healing"), null, null];
    e.ingredient = stack("sugar");
    e.fuel = stack("blaze_powder");
    tickBrewing(e);
    expect(e.brew).toBe(0);
    expect(e.fuel).not.toBeNull();
  });
});

describe("potion effects", () => {
  it("heals with healing and hurts with harming, instantly", () => {
    const p = new Player("a", "A");
    p.health = 10;
    p.applyEffect("instant_health", 0, 1);
    expect(p.health).toBe(18);
    p.invulnerable = 0;
    p.applyEffect("instant_damage", 0, 0);
    expect(p.health).toBe(12);
    expect(p.effects).toEqual([]);
  });

  it("adds strength to a punch and takes it away with weakness", () => {
    const p = new Player("a", "A");
    p.applyEffect("strength", 30, 1);
    expect(p.meleeBonus).toBe(6);
    p.effects = [];
    p.applyEffect("weakness", 30, 0);
    expect(p.meleeBonus).toBe(-4);
  });

  it("keeps a player with fire resistance from burning", () => {
    const p = new Player("a", "A");
    p.applyEffect("fire_resistance", 60, 0);
    expect(p.hurt(4, "lava")).toBe(0);
    expect(p.health).toBe(20);
  });

  it("turns healing into harm for the undead, and harming into healing", () => {
    const world = floorWorld();
    const ctx = ctxFor(world);
    const zombie = new Mob("zombie", 0.5, 11, 0.5);
    zombie.applyEffect(ctx, "instant_health", 0, 0);
    expect(zombie.health).toBe(14);
    zombie.applyEffect(ctx, "instant_damage", 0, 0);
    expect(zombie.health).toBe(18);
    const pig = new Mob("pig", 0.5, 11, 3.5);
    pig.applyEffect(ctx, "instant_damage", 0, 0);
    expect(pig.health).toBe(4);
  });

  it("poisons the living but not the undead, and never below one heart", () => {
    const world = floorWorld();
    const ctx = ctxFor(world);
    const cow = new Mob("cow", 0.5, 11, 0.5);
    const skeleton = new Mob("skeleton", 3.5, 11, 0.5);
    cow.applyEffect(ctx, "poison", 30, 1);
    skeleton.applyEffect(ctx, "poison", 30, 1);
    for (let i = 0; i < 600; i++) { cow.beginTick(); cow.tick(ctx); skeleton.beginTick(); skeleton.tick(ctx); }
    expect(cow.health).toBe(1);
    expect(skeleton.effects).toEqual([]);
  });
});
