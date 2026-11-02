import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { ambientCue, type AmbientPlace } from "@/craft/engine/ambience";
import { oreVein, treeLogs } from "@/craft/engine/chains";
import { allRecipes } from "@/craft/engine/crafting";
import { XpOrb, type EntityContext, type Entity } from "@/craft/engine/entities";
import { GRAVE_ARMOR, GRAVE_OFFHAND, graveSpot, packGrave, unpackGrave } from "@/craft/engine/graves";
import { fitsInBox, Inventory, sanitizeStack, sortSlots, type Slot } from "@/craft/engine/inventory";
import { itemId } from "@/craft/engine/items";
import { MODS } from "@/craft/engine/mods";

/** A little world of blocks by coordinate; air elsewhere. */
function blocks(list: [number, number, number, number][]): (x: number, y: number, z: number) => number {
  const m = new Map(list.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
  return (x, y, z) => m.get(`${x},${y},${z}`) ?? B.AIR;
}

/** An oak: a five-tall trunk at 0,0 and a ball of leaves round its top. */
function oak(baseY = 10): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let y = baseY; y < baseY + 5; y++) out.push([0, y, 0, B.OAK_LOG]);
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = baseY + 3; y <= baseY + 5; y++) {
    if ((dx || dz || y > baseY + 4) && Math.abs(dx) + Math.abs(dz) < 4) out.push([dx, y, dz, B.OAK_LEAVES]);
  }
  return out;
}

describe("tree felling", () => {
  it("brings down the rest of a tree cut at its base, and nothing below the cut", () => {
    const world = oak().concat([[0, 9, 0, B.OAK_LOG]]).filter(([x, y, z]) => !(x === 0 && y === 10 && z === 0));
    const logs = treeLogs(blocks(world), 0, 10, 0, B.OAK_LOG);
    expect(logs.map(([, y]) => y).sort()).toEqual([11, 12, 13, 14]);
  });

  it("leaves a log cabin standing: wood with no crown is a building", () => {
    const wall: [number, number, number, number][] = [];
    for (let x = 0; x < 6; x++) for (let y = 10; y < 14; y++) wall.push([x, y, 0, B.OAK_LOG]);
    expect(treeLogs(blocks(wall), 0, 10, 0, B.OAK_LOG)).toEqual([]);
  });

  it("takes only the same wood, not a birch growing into the oak", () => {
    const world = oak().concat([[1, 12, 0, B.BIRCH_LOG]]);
    expect(treeLogs(blocks(world), 0, 9, 0, B.OAK_LOG).some(([x]) => x === 1)).toBe(false);
  });
});

describe("vein mining", () => {
  it("follows a vein through deepslate and stone alike, and no other ore", () => {
    const get = blocks([
      [1, 5, 0, B.IRON_ORE], [2, 5, 0, B.DS_IRON], [3, 6, 1, B.IRON_ORE],
      [0, 5, 1, B.COAL_ORE], [9, 5, 0, B.IRON_ORE],
    ]);
    const vein = oreVein(get, 0, 5, 0, B.IRON_ORE);
    expect(vein.map(([x, y, z]) => `${x},${y},${z}`).sort()).toEqual(["1,5,0", "2,5,0", "3,6,1"]);
  });

  it("stops at thirty-two blocks", () => {
    const list: [number, number, number, number][] = [];
    for (let x = 1; x < 100; x++) list.push([x, 5, 0, B.COAL_ORE]);
    expect(oreVein(blocks(list), 0, 5, 0, B.COAL_ORE)).toHaveLength(32);
  });
});

describe("gravestones", () => {
  const stack = (name: string, count = 1) => ({ id: itemId(name), count });

  it("keeps the inventory in its own layout: slots, armour, offhand, then the cursor", () => {
    const inv = new Inventory();
    inv.slots[3] = stack("iron_sword");
    inv.armor[1] = stack("iron_chestplate");
    inv.offhand = stack("torch", 12);
    const items = packGrave(inv, [stack("dirt", 5), null])!;
    expect(items[3]?.id).toBe(itemId("iron_sword"));
    expect(items[GRAVE_ARMOR + 1]?.id).toBe(itemId("iron_chestplate"));
    expect(items[GRAVE_OFFHAND]?.count).toBe(12);
    expect(items[GRAVE_OFFHAND + 1]?.id).toBe(itemId("dirt"));
    expect(packGrave(new Inventory())).toBeNull();
  });

  it("puts each thing back where it was carried — armour worn — and spills only what no longer fits", () => {
    const before = new Inventory();
    before.slots[0] = stack("diamond_pickaxe");
    before.armor[0] = stack("iron_helmet");
    const grave = packGrave(before, [stack("cobblestone", 64)])!;
    const after = new Inventory();
    for (let i = 1; i < 36; i++) after.slots[i] = stack("dirt", 64);
    const spill = unpackGrave(grave, after);
    expect(after.slots[0]?.id).toBe(itemId("diamond_pickaxe"));
    expect(after.armor[0]?.id).toBe(itemId("iron_helmet"));
    expect(spill).toEqual([stack("cobblestone", 64)]);
  });

  it("rests in the first open cell at or above the death, even in lava, and inside the world", () => {
    expect(graveSpot(blocks([[0, 10, 0, B.STONE]]), 0.4, 10.2, 0.7)).toEqual([0, 11, 0]);
    expect(graveSpot(blocks([[0, 10, 0, B.LAVA]]), 0, 10, 0)).toEqual([0, 10, 0]);
    expect(graveSpot(blocks([]), 5, -40, 5)).toEqual([5, 1, 5]);
    const solid: [number, number, number, number][] = [];
    for (let y = 0; y < 40; y++) solid.push([0, y, 0, B.STONE]);
    expect(graveSpot(blocks(solid), 0, 10, 0)).toBeNull();
  });
});

describe("backpacks and sorting", () => {
  it("is crafted from leather, string and a chest", () => {
    expect(allRecipes().find((r) => r.id === "backpack")?.key).toEqual({ L: "leather", S: "string", C: "chest" });
  });

  it("will not take a backpack or a shulker box inside, and neither will a box", () => {
    expect(fitsInBox({ id: itemId("backpack"), count: 1 })).toBe(false);
    expect(fitsInBox({ id: B.SHULKER_BOX, count: 1 })).toBe(false);
    expect(fitsInBox({ id: itemId("dirt"), count: 1 })).toBe(true);
  });

  it("keeps a backpack's contents through a save, refusing anything nested", () => {
    const pack = sanitizeStack({ id: itemId("backpack"), count: 1, contents: [{ id: itemId("apple"), count: 3 }, { id: itemId("backpack"), count: 1 }] });
    expect(pack?.contents?.[0]).toEqual({ id: itemId("apple"), count: 3 });
    expect(pack?.contents?.[1]).toBeNull();
  });

  it("merges like stacks and groups kinds together, leaving the gaps at the end", () => {
    const slots: Slot[] = [{ id: itemId("stone"), count: 40 }, null, { id: itemId("apple"), count: 2 }, { id: itemId("stone"), count: 40 }, null];
    sortSlots(slots, [0, 1, 2, 3, 4]);
    expect(slots.filter(Boolean).map((s) => [s!.id, s!.count])).toEqual(
      [[itemId("stone"), 64], [itemId("stone"), 16], [itemId("apple"), 2]].sort((a, b) => a[0] - b[0] || b[1] - a[1]),
    );
    expect(slots.slice(3)).toEqual([null, null]);
  });
});

describe("experience clumps", () => {
  it("merges orbs that meet into one worth their sum", () => {
    const a = new XpOrb(0, 10, 0, 3, 10), b = new XpOrb(0.5, 10, 0, 7, 11);
    const ctx = {
      world: { blockAt: () => B.AIR, getBlock: () => B.AIR, isLoaded: () => true } as unknown,
      tick: 0, daylight: 1, difficulty: 2, random: () => 0.5, players: () => [],
      entitiesNear: () => [a, b] as Entity[], sound: () => {}, particles: () => {},
    } as unknown as EntityContext;
    for (let i = 0; i < 10 && !b.removed; i++) { a.beginTick(); a.tick(ctx); }
    expect(b.removed).toBe(true);
    expect(a.value).toBe(10);
  });
});

describe("ambient sounds", () => {
  const place: AmbientPlace = { dimension: "overworld", biome: "Forest", night: false, raining: false, underground: false, y: 70, nearWater: false };
  const always = () => 0.01;

  it("sings with birds in a forest by day and crickets there by night", () => {
    expect(ambientCue(place, always)).toBe("birds");
    expect(ambientCue({ ...place, night: true }, always)).toBe("crickets");
  });

  it("drips in caves, moans in the Nether, hums in the End and blows on the peaks", () => {
    expect(ambientCue({ ...place, underground: true, y: 20 }, always)).toBe("cave_drip");
    expect(ambientCue({ ...place, dimension: "nether" }, always)).toBe("nether_moan");
    expect(ambientCue({ ...place, dimension: "end" }, always)).toBe("end_hum");
    expect(ambientCue({ ...place, y: 115 }, always)).toBe("wind");
  });

  it("is mostly quiet", () => {
    expect(ambientCue(place, () => 0.9)).toBeNull();
  });
});

describe("mods list", () => {
  it("credits each of the second set of features", () => {
    const ids = MODS.map((m) => m.id);
    for (const id of ["gravestones", "backpacks", "tree_felling", "right_click_harvest", "double_doors", "inventory_sort", "appleskin", "clumps", "ambient_sounds"]) {
      expect(ids).toContain(id);
    }
  });
});
