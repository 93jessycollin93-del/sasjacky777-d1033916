import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { BiomeId } from "@/craft/engine/biomes";
import { BlockRules, type RuleContext } from "@/craft/engine/blockRules";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME, DAY_TICKS, WORLD_HEIGHT } from "@/craft/engine/constants";
import { allRecipes } from "@/craft/engine/crafting";
import { itemId, itemLight } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { MODS, modEnabled } from "@/craft/engine/mods";
import { Player } from "@/craft/engine/player";
import { recipesFor, usesOf } from "@/craft/engine/recipeIndex";
import { cropGrowth, SEASON_DAYS, seasonAt, seasonLabel, seasonTint, snowsHere, type Season } from "@/craft/engine/seasons";
import { sanitizeWaypoints, withDeathPoint } from "@/craft/engine/waypoints";
import { sanitizeWaystones, travelCost, waystoneKey, waystoneName } from "@/craft/engine/waystones";
import { World } from "@/craft/engine/world";
import { REGION_PX, WorldMap, type PaintableChunk } from "@/craft/game/worldMap";

const SEASON = SEASON_DAYS * DAY_TICKS;

function flatWorld(fill: (x: number, y: number, z: number) => number): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      blocks[blockIndex(x, y, z)] = fill(cx * 16 + x, y, cz * 16 + z);
    }
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

function rulesIn(world: World, season: Season | null, opts: { raining?: boolean; random?: () => number } = {}): BlockRules {
  const ctx: RuleContext = {
    dropItems: () => {}, spawnFalling: () => {}, sound: () => {},
    isRaining: () => opts.raining ?? false, random: opts.random ?? (() => 0.01), season: () => season,
  };
  return new BlockRules(world, ctx);
}

/** One random tick of one block, as the rules would give it. */
const tickAt = (rules: BlockRules, world: World, x: number, y: number, z: number, biome: number = BiomeId.Plains) =>
  (rules as unknown as { randomTick(x: number, y: number, z: number, id: number, biome: number): void }).randomTick(x, y, z, world.blockAt(x, y, z), biome);

describe("seasons", () => {
  it("turns spring to summer to autumn to winter, a week each, and back to spring", () => {
    expect(seasonAt(0).season).toBe("spring");
    expect(seasonAt(SEASON).season).toBe("summer");
    expect(seasonAt(SEASON * 2 + DAY_TICKS * 2).season).toBe("autumn");
    expect(seasonAt(SEASON * 2 + DAY_TICKS * 2).day).toBe(3);
    expect(seasonAt(SEASON * 3).season).toBe("winter");
    expect(seasonAt(SEASON * 4).season).toBe("spring");
    expect(seasonLabel(SEASON * 3 + DAY_TICKS)).toBe("Winter, day 2 of 7");
  });

  it("leaves summer's green alone and tints autumn orange, easing into it over the last days of summer", () => {
    expect(seasonTint(SEASON + DAY_TICKS)[3]).toBe(0);
    const autumn = seasonTint(SEASON * 2 + DAY_TICKS);
    expect(autumn[3]).toBeGreaterThan(0.4);
    expect(autumn[0]).toBeGreaterThan(autumn[2]);
    const lateSummer = seasonTint(SEASON * 2 - DAY_TICKS);
    expect(lateSummer[3]).toBeGreaterThan(0);
    expect(lateSummer[3]).toBeLessThan(autumn[3]);
    // Easing out of summer takes autumn's colour, not a pale mix of it and white.
    expect(lateSummer[0]).toBeCloseTo(autumn[0]);
  });

  it("keeps a jungle mostly green in autumn", () => {
    const t = SEASON * 2 + DAY_TICKS;
    expect(seasonTint(t, true)[3]).toBeLessThan(seasonTint(t)[3] / 2);
  });

  it("stops crops in winter under the open sky, but not in a greenhouse", () => {
    expect(cropGrowth("winter", false)).toBe(0);
    expect(cropGrowth("winter", true)).toBe(1);
    expect(cropGrowth("spring", false)).toBeGreaterThan(1);
    expect(cropGrowth("autumn", false)).toBeLessThan(1);
  });

  it("grows wheat in spring and leaves it be in winter, unless it is under glass", () => {
    const soil = (x: number, y: number) => (y < 10 ? B.STONE : y === 10 ? B.FARMLAND : y === 11 && x <= 1 ? B.WHEAT : B.AIR);
    const spring = flatWorld(soil);
    tickAt(rulesIn(spring, "spring"), spring, 0, 11, 0);
    expect(spring.getMeta(0, 11, 0)).toBe(1);

    const winter = flatWorld((x, y, z) => (x === 1 && z === 0 && y === 16 ? B.GLASS : soil(x, y)));
    const rules = rulesIn(winter, "winter");
    for (let i = 0; i < 20; i++) { tickAt(rules, winter, 0, 11, 0); tickAt(rules, winter, 1, 11, 0); }
    expect(winter.getMeta(0, 11, 0)).toBe(0);
    expect(winter.getMeta(1, 11, 0)).toBeGreaterThan(0);
  });

  it("snows on the plains in winter rain, and thaws it again in spring", () => {
    const world = flatWorld((_x, y) => (y <= 10 ? B.STONE : B.AIR));
    tickAt(rulesIn(world, "winter", { raining: true }), world, 0, 10, 0);
    expect(world.blockAt(0, 11, 0)).toBe(B.SNOW);
    tickAt(rulesIn(world, "spring"), world, 0, 11, 0);
    expect(world.blockAt(0, 11, 0)).toBe(B.AIR);
  });

  it("never snows in the desert, and always does in a snowy biome", () => {
    expect(snowsHere("winter", BiomeId.Desert, false)).toBe(false);
    expect(snowsHere("winter", BiomeId.Plains, false)).toBe(true);
    expect(snowsHere("summer", BiomeId.Plains, false)).toBe(false);
    expect(snowsHere(null, BiomeId.SnowyPlains, true)).toBe(true);
    expect(snowsHere(null, BiomeId.Plains, false)).toBe(false);
  });
});

describe("world map", () => {
  const chunk = (fill: (x: number, y: number, z: number) => number, cx = 0, cz = 0): PaintableChunk => {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = fill(x, y, z);
    const tints = new Uint8Array(256 * 9);
    for (let i = 0; i < 256; i++) tints.set([121, 192, 90, 89, 174, 48, 63, 118, 228], i * 9);
    return { cx, cz, blocks, meta: new Uint8Array(CHUNK_VOLUME), tints };
  };

  it("paints grass green and water blue, and leaves what nobody has seen blank", () => {
    const map = new WorldMap();
    map.paintChunk("overworld", chunk((x, y) => (y < 60 ? B.STONE : y === 60 ? (x < 8 ? B.GRASS : B.WATER) : B.AIR)));
    const [gr, gg, gb, ga] = map.pixel("overworld", 2, 5);
    expect(ga).toBe(255);
    expect(gg).toBeGreaterThan(gr);
    expect(gg).toBeGreaterThan(gb);
    const [wr, , wb] = map.pixel("overworld", 12, 5);
    expect(wb).toBeGreaterThan(wr);
    expect(map.pixel("overworld", 40, 40)[3]).toBe(0);
    expect(map.pixel("nether", 2, 5)[3]).toBe(0);
  });

  it("shades a slope: the column higher than its northern neighbour is brighter", () => {
    const map = new WorldMap();
    map.paintChunk("overworld", chunk((_x, y, z) => (y <= 60 + (z >= 8 ? 1 : 0) ? B.STONE : B.AIR)));
    const flat = map.pixel("overworld", 3, 4)[0], step = map.pixel("overworld", 3, 8)[0];
    expect(step).toBeGreaterThan(flat);
  });

  it("looks under the Nether's roof for the cavern floor", () => {
    const map = new WorldMap();
    const nether = chunk((_x, y) => (y >= WORLD_HEIGHT - 4 || y <= 40 ? B.NETHERRACK : y === 41 ? B.SOUL_SAND : B.AIR));
    map.paintChunk("nether", nether);
    const soul = new WorldMap();
    soul.paintChunk("overworld", chunk((_x, y) => (y <= 41 ? B.SOUL_SAND : B.AIR)));
    expect(map.pixel("nether", 1, 1)).toEqual(soul.pixel("overworld", 1, 1));
  });

  it("keeps what was painted this session over an older saved copy, and fills the rest from it", () => {
    const map = new WorldMap();
    map.paintChunk("overworld", chunk((_x, y) => (y <= 60 ? B.SAND : B.AIR)));
    const saved = new Uint8ClampedArray(REGION_PX * REGION_PX * 4).fill(200);
    map.merge([["overworld:0,0", saved]]);
    const sand = map.pixel("overworld", 1, 1);
    expect(sand[3]).toBe(255);
    expect(sand).not.toEqual([200, 200, 200, 200]);
    expect(map.pixel("overworld", 100, 100)).toEqual([200, 200, 200, 200]);
    // Merging counts as a change for the drawer, not for the save: it came from the save.
    const dirty = map.takeDirty();
    expect(dirty.map(([k]) => k)).toEqual(["overworld:0,0"]);
    expect(map.takeDirty()).toEqual([]);
  });
});

describe("waypoints", () => {
  it("keeps one death point, the latest, at the top of the list", () => {
    let list = withDeathPoint([], 10.7, 64, -3.2, "overworld");
    list = [...list, { name: "Home", x: 0, y: 70, z: 0, dim: "overworld", color: 1 }];
    list = withDeathPoint(list, 99, 12, 5, "nether");
    expect(list.filter((w) => w.death)).toEqual([{ name: "Death", x: 99, y: 12, z: 5, dim: "nether", color: 0, death: true }]);
    expect(list.map((w) => w.name)).toEqual(["Death", "Home"]);
  });

  it("drops a damaged waypoint from a save rather than failing to load", () => {
    const list = sanitizeWaypoints([
      { name: "Base", x: 1, y: 2, z: 3, dim: "end", color: 3 },
      { name: "Bad", x: "far", y: 2, z: 3, dim: "overworld" },
      { name: "", x: 1, y: 2, z: 3, dim: "moon" },
      null,
    ]);
    expect(list).toEqual([{ name: "Base", x: 1, y: 2, z: 3, dim: "end", color: 3 }]);
  });

  it("travels with the player's save", () => {
    const p = new Player("a", "Alex");
    p.waypoints = [{ name: "Mine", x: 5, y: 20, z: 5, dim: "overworld", color: 2 }];
    p.waystones.add(waystoneKey("overworld", 1, 2, 3));
    const q = new Player("a", "Alex");
    q.load(JSON.parse(JSON.stringify(p.toJSON())));
    expect(q.waypoints).toEqual(p.waypoints);
    expect([...q.waystones]).toEqual(["overworld:1,2,3"]);
  });
});

describe("waystones", () => {
  it("names a waystone the same way every time for the same spot", () => {
    expect(waystoneName(10, 64, -20)).toBe(waystoneName(10, 64, -20));
    expect(waystoneName(10, 64, -20)).toMatch(/^[A-Z][a-z]+$/);
    const names = new Set(Array.from({ length: 30 }, (_, i) => waystoneName(i * 100, 64, i * 37)));
    expect(names.size).toBeGreaterThan(10);
  });

  it("costs a level for every 500 blocks, one at least and five at most, and nothing in creative", () => {
    expect(travelCost({ x: 0, z: 0 }, { x: 10, z: 0 }, false)).toBe(1);
    expect(travelCost({ x: 0, z: 0 }, { x: 1200, z: 0 }, false)).toBe(3);
    expect(travelCost({ x: 0, z: 0 }, { x: 100000, z: 0 }, false)).toBe(5);
    expect(travelCost({ x: 0, z: 0 }, { x: 1200, z: 0 }, true)).toBe(0);
  });

  it("reads the world's list back, dropping entries it cannot trust", () => {
    const list = sanitizeWaystones({
      a: { name: "Home", x: 1, y: 64, z: 2, dim: "overworld" },
      b: { name: "Broken", x: 1.5, y: 64, z: 2, dim: "overworld" },
      c: { name: "  ", x: 5, y: 40, z: 5, dim: "nether" },
    });
    expect(Object.keys(list).sort()).toEqual(["nether:5,40,5", "overworld:1,64,2"]);
    expect(list["nether:5,40,5"].name).toBe("Waystone");
  });

  it("is crafted from stone bricks, an ender pearl and obsidian", () => {
    const r = allRecipes().find((x) => x.id === "waystone")!;
    expect(r.key).toEqual({ B: "stone_bricks", P: "ender_pearl", O: "obsidian" });
  });
});

describe("recipe viewer", () => {
  it("shows how an item is made at the table, the furnace and the smithing table", () => {
    expect(recipesFor(itemId("waystone")).some((r) => r.kind === "crafting")).toBe(true);
    expect(recipesFor(itemId("iron_ingot")).some((r) => r.kind === "smelting")).toBe(true);
    expect(recipesFor(itemId("netherite_sword")).some((r) => r.kind === "smithing")).toBe(true);
  });

  it("shows brewing both ways: what makes a potion, and what an ingredient brews", () => {
    const awkward = recipesFor(itemId("awkward_potion"));
    expect(awkward.some((r) => r.kind === "brewing" && r.ingredient === itemId("nether_wart"))).toBe(true);
    expect(usesOf(itemId("nether_wart")).some((r) => r.kind === "brewing")).toBe(true);
  });

  it("lists every recipe a tag ingredient takes part in, under each item the tag accepts", () => {
    const birch = usesOf(itemId("birch_planks"));
    expect(birch.some((r) => r.kind === "crafting" && r.id === "stick")).toBe(true);
    expect(birch.some((r) => r.kind === "fuel")).toBe(true);
  });

  it("lays a shaped recipe out as it goes in the grid", () => {
    const pick = recipesFor(itemId("iron_pickaxe")).find((r) => r.kind === "crafting");
    expect(pick?.kind === "crafting" && pick.width).toBe(3);
    const ingot = itemId("iron_ingot"), stick = itemId("stick");
    expect(pick?.kind === "crafting" && pick.cells.map((c) => c[0] ?? 0)).toEqual([ingot, ingot, ingot, 0, stick, 0, 0, stick, 0]);
  });
});

describe("dynamic lights and the mods list", () => {
  it("lights the way from a held torch, a lava bucket and glowstone, but not a stick", () => {
    expect(itemLight(itemId("torch"))).toBe(14);
    expect(itemLight(itemId("lava_bucket"))).toBe(15);
    expect(itemLight(itemId("glowstone"))).toBe(15);
    expect(itemLight(itemId("stick"))).toBe(0);
  });

  it("credits every borrowed idea with a link to the mod it came from, and switches each per world", () => {
    for (const m of MODS) {
      expect(m.inspiredBy.length).toBeGreaterThan(0);
      expect(m.url).toMatch(/^https:\/\//);
    }
    expect(new Set(MODS.map((m) => m.id)).size).toBe(MODS.length);
    expect(modEnabled(undefined, "seasons")).toBe(true);
    expect(modEnabled(["seasons"], "seasons")).toBe(false);
    expect(modEnabled(["seasons"], "minimap")).toBe(true);
  });
});
