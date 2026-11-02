import { describe, expect, it } from "vitest";
import { allBlocks, B, block, containerSize, isBed, isDoor, isSlab, isStairs } from "@/craft/engine/blocks";
import { allItems, itemByName, itemDef } from "@/craft/engine/items";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "@/craft/engine/constants";
import { Chunk } from "@/craft/engine/chunk";
import { lightChunk, blockOf } from "@/craft/engine/lighting";
import { Mesher, buildPadded } from "@/craft/engine/mesher";
import { COUNTY_BLOCKS, FIRST_WIDE_BLOCK, boardsOf, withBoards, WINDOW_BROKEN, WINDOW_OPEN } from "@/craft/engine/countyBlocks";
import { COUNTY_LOOT, countyLootNames, countyLootTable, type BuildingKind } from "@/craft/engine/countyLoot";
import { matchRecipe } from "@/craft/engine/crafting";
import { packChunk, unpackChunk } from "@/craft/game/save";
import { waterFrom } from "@/craft/engine/vitals";

const C = COUNTY_BLOCKS;

function chunkOf(fill: (x: number, y: number, z: number) => number): Chunk {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = fill(x, y, z);
  return new Chunk(0, 0, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, 0, 0), new Uint8Array(256), new Uint8Array(256 * 9).fill(200));
}

describe("the county's blocks", () => {
  it("numbers every county block past the one-byte ids, clear of every plain item", () => {
    const county = allBlocks().filter((b) => b.id >= FIRST_WIDE_BLOCK);
    expect(county.length).toBe(Object.keys(C).length);
    expect(Object.values(C).every((id) => id >= FIRST_WIDE_BLOCK)).toBe(true);
    const plain = allItems().filter((i) => i.places === undefined || i.id < FIRST_WIDE_BLOCK);
    expect(Math.max(...plain.filter((i) => i.id < FIRST_WIDE_BLOCK).map((i) => i.id))).toBeLessThan(FIRST_WIDE_BLOCK);
    // A county block is its own item, as the one-byte blocks are.
    expect(itemDef(C.FRIDGE)?.places).toBe(C.FRIDGE);
    expect(itemByName("kitchen_counter").id).toBe(C.COUNTER);
  });

  it("gives every cupboard, fridge and shelf its own number of slots and a kind of thing it holds", () => {
    expect(containerSize(C.FRIDGE)).toBe(12);
    expect(containerSize(C.MEDICINE_CABINET)).toBe(4);
    expect(containerSize(B.CHEST)).toBe(27);
    for (const def of allBlocks().filter((b) => b.id >= FIRST_WIDE_BLOCK && b.container)) {
      expect(def.loot, def.name).toBeDefined();
      expect(COUNTY_LOOT[countyLootTable(def.loot!, null)], def.name).toBeDefined();
    }
  });

  it("treats the county's doors, beds, roof stairs and slabs the way it treats the originals", () => {
    expect(isDoor(C.FRONT_DOOR) && isDoor(C.METAL_DOOR) && isDoor(B.OAK_DOOR)).toBe(true);
    expect(isBed(C.BLUE_BED) && isBed(B.RED_BED)).toBe(true);
    expect(isStairs(C.SHINGLE_STAIRS_RED) && isSlab(C.SHINGLE_SLAB_GREY)).toBe(true);
    expect(isDoor(C.HOUSE_WINDOW)).toBe(false);
  });

  it("keeps boards nailed over a window or door in the meta, alongside the door's own state", () => {
    const door = 3 | 8 | 16; // facing east, upper half, hinged right
    const boarded = withBoards(door, 3);
    expect(boardsOf(boarded)).toBe(3);
    expect(boarded & 31).toBe(door);
    expect(boardsOf(withBoards(boarded, 9))).toBe(4);
  });

  it("lets you through a window that is open or smashed, and not one that is shut or boarded", () => {
    const def = block(C.HOUSE_WINDOW);
    expect(def.collision!(0).length).toBe(1);
    expect(def.collision!(WINDOW_OPEN).length).toBe(0);
    expect(def.collision!(WINDOW_BROKEN).length).toBe(0);
    expect(def.collision!(withBoards(WINDOW_BROKEN, 2)).length).toBe(2);
  });

  it("lights, meshes and saves a room of county furniture, every id past 255 intact", async () => {
    const room = [C.COUNTER, C.STOVE, C.FRIDGE, C.TELEVISION, C.BLUE_BED, C.HOUSE_WINDOW, C.CEILING_LIGHT, C.ASPHALT];
    const c = chunkOf((x, y, z) => (y === 3 ? C.HARDWOOD : y === 4 && z === 5 && x < room.length ? room[x] : B.AIR));
    // The ceiling light shines: its emission is read by id, past the old 256-entry tables.
    expect(blockOf(c.light[blockIndex(6, 4, 5)])).toBe(15);
    const mesher = new Mesher(() => 1);
    const padded = buildPadded((cx, cz) => (cx === 0 && cz === 0 ? c : undefined), 0, 0);
    const m = mesher.mesh({ ...padded, tints: c.tints, fancyLeaves: false, smoothLighting: true });
    expect(m.opaque.quads + m.cutout.quads).toBeGreaterThan(50);
    const packed = await packChunk({ cx: 0, cz: 0, blocks: c.blocks, meta: c.meta, entities: [] });
    const back = await unpackChunk(packed.data, packed.gz);
    for (let x = 0; x < room.length; x++) expect(back.blocks[blockIndex(x, 4, 5)]).toBe(room[x]);
  });
});

describe("the county's items", () => {
  it("fills its loot tables only with things the game has", () => {
    for (const name of countyLootNames()) expect(() => itemByName(name), name).not.toThrow();
  });

  it("finds a table for every container in every kind of building", () => {
    const kinds: BuildingKind[] = ["house", "grocery", "pharmacy", "hardware", "gun_store", "police", "school", "military", "diner", "warehouse", "farmhouse", "clinic"];
    for (const def of allBlocks().filter((b) => b.loot)) {
      for (const k of kinds) expect(COUNTY_LOOT[countyLootTable(def.loot!, k)], `${def.name} in a ${k}`).toBeDefined();
    }
    expect(countyLootTable("grocery", "pharmacy")).toBe("pharmacy");
    expect(countyLootTable("locker", "police")).toBe("police_locker");
  });

  it("quenches thirst with the county's drinks, and leaves the right container behind", () => {
    expect(waterFrom("bottled_water")).toBe(10);
    expect(itemByName("bottled_water").empty).toBe("empty_water_bottle");
    expect(itemByName("orange_juice").empty).toBeNull();
    expect(itemByName("canned_chili").food?.hunger).toBe(7);
  });

  it("makes the weapons hit like weapons and the axes chop like axes", () => {
    expect(itemByName("fire_axe").tool?.type).toBe("axe");
    expect(itemByName("katana").damage).toBeGreaterThan(itemByName("kitchen_knife").damage);
    expect(itemByName("sledgehammer").attackSpeed).toBeLessThan(1);
  });

  it("nails a bat and tears a sheet into rags at the crafting grid", () => {
    const grid = (names: string[]) => Array.from({ length: 9 }, (_, i) => (names[i] ? { id: itemByName(names[i]).id, count: 1 } : null));
    expect(matchRecipe(grid(["baseball_bat", "nails", "nails"]), 3)?.result.item).toBe("spiked_bat");
    expect(matchRecipe(grid(["bed_sheet"]), 3)?.result).toEqual({ item: "rag", count: 4 });
  });
});
