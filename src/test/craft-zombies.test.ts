import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from "@/craft/engine/constants";
import { Chunk } from "@/craft/engine/chunk";
import { lightChunk } from "@/craft/engine/lighting";
import { World } from "@/craft/engine/world";
import type { Entity, EntityContext, PlayerRef } from "@/craft/engine/entities";
import { itemByName } from "@/craft/engine/items";
import { Mob, MOB_SPECS } from "@/craft/engine/mobs";
import { INFECTED_KINDS, INFECTED_SPAWNS, isInfected, isInfectedMob, pickInfected } from "@/craft/engine/infected";
import { GUNS, stray, tracePellet } from "@/craft/engine/guns";
import type { BlockReader } from "@/craft/engine/physics";
import { Generator } from "@/craft/engine/worldgen";
import { mapLayout, mapLootNames } from "@/craft/engine/maps";
import { modeDef } from "@/craft/modes/modes";
import { bloodMoonAt, daysToBloodMoon, roundMobs } from "@/craft/modes/zombies";
import { bearing, FRESH_SPAWN } from "@/craft/modes/deadzone";
import { sicknessChance, waterFrom } from "@/craft/engine/vitals";

function flatWorld(fill: (x: number, y: number, z: number) => number, radius = 2): World {
  const world = new World();
  for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = fill(cx * 16 + x, y, cz * 16 + z);
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

const ground = (_x: number, y: number) => (y <= 10 ? B.STONE : B.AIR);

const player = (x: number, z: number, y = 11): PlayerRef => ({
  id: "steve", name: "Steve", x, y, z, width: 0.6, height: 1.8, targetable: true, sneaking: false, heldItem: null, invisible: false, goldArmor: false,
} as unknown as PlayerRef);

function context(world: World, players: PlayerRef[], extra: Partial<EntityContext> = {}, spawned: Entity[] = [], hurts: [string, number][] = [], effects: string[] = []): EntityContext {
  return {
    world, tick: 0, daylight: 1, difficulty: 2, random: () => 0.3, players: () => players,
    hurtPlayer: (id, amount) => { hurts.push([id, amount]); }, givePlayer: () => 0, giveXp: () => {}, spawn: (e) => { spawned.push(e); }, dropItem: () => {},
    explode: () => {}, sound: () => {}, particles: () => {}, entitiesNear: () => spawned, placeBlock: () => true,
    effectPlayer: (_id, effect) => { effects.push(effect); }, mobGriefing: true, ...extra,
  };
}

describe("the infected", () => {
  it("gives every kind stats, and counts the plain zombie's bite as infected too", () => {
    for (const k of INFECTED_KINDS) {
      expect(MOB_SPECS[k], k).toBeDefined();
      expect(MOB_SPECS[k].hostile).toBe(true);
      expect(MOB_SPECS[k].burnsInDay).toBe(false);
    }
    expect(isInfected("zombie")).toBe(true);
    expect(isInfectedMob("zombie")).toBe(false);
    expect(isInfected("skeleton")).toBe(false);
  });

  it("spawns mostly walkers, and every kind now and then", () => {
    let s = 11;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) { const k = pickInfected(rng); counts[k] = (counts[k] ?? 0) + 1; }
    // Dead Zone's own mix: Ashgrove County's shamblers and crawlers are infected too, but never spawn here.
    for (const [k] of INFECTED_SPAWNS) expect(counts[k], k).toBeGreaterThan(0);
    expect(counts.shambler ?? 0).toBe(0);
    expect(counts.infected).toBeGreaterThan(counts.brute * 5);
  });

  it("hears a noise it cannot see — and goes for whoever made it, through a wall", () => {
    const world = flatWorld((x, y) => (y <= 10 ? B.STONE : x === 5 && y < 20 ? B.STONE : B.AIR));
    const p = player(9.5, 0.5);
    const ctx = context(world, [p]);
    const deaf = new Mob("infected", 0.5, 11, 0.5), alerted = new Mob("infected", 0.5, 11, 3.5);
    alerted.alert = 300;
    for (let i = 0; i < 25; i++) for (const m of [deaf, alerted]) { m.beginTick(); m.tick(ctx); }
    expect(deaf.targetId).toBeNull();
    expect(alerted.targetId).toBe("steve");
  });

  it("runs once it has a target, faster than it wanders", () => {
    const world = flatWorld(ground);
    const walker = new Mob("infected", 0.5, 11, 0.5), runner = new Mob("runner", 0.5, 11, 4.5);
    const p = player(0.5, 30.5);
    const ctx = context(world, [p]);
    for (const m of [walker, runner]) { m.alert = 400; m.targetId = "steve"; }
    for (let i = 0; i < 40; i++) for (const m of [walker, runner]) { m.beginTick(); m.tick(ctx); }
    expect(walker.body.z - 0.5).toBeGreaterThan(40 * MOB_SPECS.infected.speed * 1.2);
    expect(runner.body.z - 4.5).toBeGreaterThan(walker.body.z - 0.5);
  });

  it("bursts a bloater beside you: bile that hurts, blinds and poisons", () => {
    const world = flatWorld(ground);
    const hurts: [string, number][] = [], effects: string[] = [];
    const p = player(1.8, 0.5);
    const ctx = context(world, [p], {}, [], hurts, effects);
    const m = new Mob("bloater", 0.5, 11, 0.5);
    m.targetId = "steve";
    for (let i = 0; i < 40 && !m.removed; i++) { m.beginTick(); m.tick(ctx); }
    expect(m.removed).toBe(true);
    expect(hurts.some(([id, n]) => id === "steve" && n >= 4)).toBe(true);
    expect(effects).toEqual(expect.arrayContaining(["blindness", "poison"]));
  });

  it("lets a screamer's cry bring more of them, already hunting", () => {
    const world = flatWorld(ground);
    const spawned: Entity[] = [];
    const p = player(6.5, 0.5);
    const ctx = context(world, [p], {}, spawned);
    const m = new Mob("screamer", 0.5, 11, 0.5);
    m.targetId = "steve";
    m.beginTick(); m.tick(ctx);
    const risen = spawned.filter((e): e is Mob => e instanceof Mob);
    expect(risen.length).toBeGreaterThanOrEqual(2);
    for (const r of risen) { expect(r.targetId).toBe("steve"); expect(r.alert).toBeGreaterThan(0); }
  });

  it("has a brute batter through a wall, where a walker only digs under a blood moon", () => {
    const wallAt = (x: number, y: number) => (y <= 10 ? B.STONE : x === 3 && y < 14 ? B.OAK_PLANKS : B.AIR);
    const run = (kind: "brute" | "infected", bloodMoon: boolean) => {
      const world = flatWorld(wallAt);
      const ctx = context(world, [player(8.5, 0.5)], { bloodMoon });
      const m = new Mob(kind, 0.5, 11, 0.5);
      m.alert = 2000; m.targetId = "steve";
      for (let i = 0; i < 20 * 30; i++) { m.beginTick(); m.tick(ctx); }
      return world.blockAt(3, 11, 0) === B.AIR || world.blockAt(3, 12, 0) === B.AIR;
    };
    expect(run("brute", false)).toBe(true);
    expect(run("infected", false)).toBe(false);
    expect(run("infected", true)).toBe(true);
  });

  it("keeps a zombie round's toughness through a save", () => {
    const m = new Mob("infected", 0, 11, 0);
    m.level = 8;
    const back = new Mob("infected", 0, 0, 0, m.id);
    back.applySnapshot(m.snapshot());
    expect(back.level).toBe(8);
    expect(back.maxHealth).toBeGreaterThan(MOB_SPECS.infected.health * 2);
  });
});

/** A reader over a set of blocks, air everywhere else. */
function blocksAt(list: [number, number, number, number][]): BlockReader {
  const m = new Map(list.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
  return { getBlock: (x, y, z) => m.get(`${x},${y},${z}`) ?? 0, getMeta: () => 0 };
}

describe("guns", () => {
  it("fires only real ammunition, from real items", () => {
    for (const g of Object.values(GUNS)) {
      expect(() => itemByName(g.item)).not.toThrow();
      expect(() => itemByName(g.ammo)).not.toThrow();
      expect(itemByName(g.item).use).toBe("gun");
    }
  });

  it("hits the nearest body before a wall, and the head in its top", () => {
    const world = blocksAt([[0, 64, 10, B.STONE]]);
    const box = (z: number) => ({ minX: -0.3, minY: 63, minZ: z - 0.3, maxX: 0.3, maxY: 64.95, maxZ: z + 0.3 });
    const bodies = [{ target: "far", box: box(8) }, { target: "near", box: box(4) }];
    const body = tracePellet(world, 0, 64, 0, 0, 0, 1, 50, bodies);
    expect(body.hit?.target).toBe("near");
    expect(body.hit?.headshot).toBe(false);
    const head = tracePellet(world, 0, 64.8, 0, 0, 0, 1, 50, bodies);
    expect(head.hit?.headshot).toBe(true);
    const wall = tracePellet(world, 0, 64, 0, 0, 0, 1, 50, [{ target: "behind", box: box(12) }]);
    expect(wall.hit).toBeNull();
    expect(wall.block?.z).toBe(10);
  });

  it("goes through grass and flowers, not through stone", () => {
    const world = blocksAt([[0, 64, 3, B.SHORT_GRASS], [0, 64, 5, B.POPPY]]);
    const bodies = [{ target: "t", box: { minX: -0.3, minY: 63.5, minZ: 7.7, maxX: 0.3, maxY: 65.5, maxZ: 8.3 } }];
    expect(tracePellet(world, 0.5, 64.3, 0.5, 0, 0, 1, 30, bodies.map((b) => ({ ...b, box: { ...b.box, minX: 0.2, maxX: 0.8 } }))).hit?.target).toBe("t");
  });

  it("strays pellets a little, and keeps each direction a unit", () => {
    let s = 5;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 100; i++) {
      const [x, y, z] = stray(0, 0, 1, GUNS.shotgun.spread, rng);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
      expect(z).toBeGreaterThan(0.98);
    }
  });

  it("gives a shotgun the most harm up close and a rifle the most per shot", () => {
    const perShot = (g: keyof typeof GUNS) => GUNS[g].damage * GUNS[g].pellets;
    expect(perShot("shotgun")).toBeGreaterThan(perShot("hunting_rifle"));
    expect(GUNS.hunting_rifle.damage).toBeGreaterThan(GUNS.pistol.damage * 2);
    expect(GUNS.hunting_rifle.range).toBeGreaterThan(GUNS.shotgun.range * 3);
    expect(GUNS.assault_rifle.auto).toBe(true);
  });
});

describe("the Dead Zone and the bunker", () => {
  it("lays out towns with loot, a hospital with medicine and a base with guns", () => {
    const g = new Generator({ seed: 13, type: "default", dimension: "overworld", map: "dead_zone" });
    const l = mapLayout("dead_zone", 13, g);
    expect(l.terrain).toBe(true);
    const by = (t: string) => l.chests.filter((c) => c[3] === t).length;
    expect(by("dz_house")).toBeGreaterThan(20);
    expect(by("dz_medical")).toBe(3);
    expect(by("dz_military")).toBeGreaterThanOrEqual(5);
    expect(g.villagesAt(0, 0)).toEqual([]);
    // You wake on dry land, and the towns stand on it too.
    expect(g.surfaceY(Math.floor(l.spawn[0]), Math.floor(l.spawn[2]))).toBeGreaterThanOrEqual(63);
    const houses = l.chests.filter((c) => c[3] === "dz_house");
    expect(houses.filter((c) => c[1] >= 64).length / houses.length).toBeGreaterThan(0.9);
    for (const n of mapLootNames()) expect(() => itemByName(n), n).not.toThrow();
  });

  it("builds the bunker with its doors, windows and wall buys, all on pads inside", () => {
    const l = mapLayout("zombie_bunker", 1, new Generator({ seed: 1, type: "default", dimension: "overworld" }));
    const buys = l.buys ?? [];
    expect(buys.filter((b) => b.kind === "door")).toHaveLength(2);
    expect(buys.some((b) => b.kind === "box")).toBe(true);
    expect(buys.some((b) => b.kind === "perk")).toBe(true);
    for (const b of buys.filter((x) => x.kind === "gun")) expect(GUNS[b.item!], b.name).toBeDefined();
    expect((l.windows ?? []).length).toBeGreaterThanOrEqual(6);
    for (const w of l.windows ?? []) {
      expect(w.boards).toHaveLength(2);
      // The spawn is outside the wall, the pad inside.
      expect(Math.abs(w.spawn[2])).toBeGreaterThan(Math.abs(w.boards[0][2]));
      expect(Math.abs(w.pad[2])).toBeLessThan(Math.abs(w.boards[0][2]));
    }
  });

  it("sends bigger, harder rounds, with brutes every fifth", () => {
    expect(roundMobs(1)).toHaveLength(10);
    expect(roundMobs(10).length).toBeGreaterThan(roundMobs(2).length);
    expect(roundMobs(1)).not.toContain("runner");
    expect(roundMobs(3)).toContain("runner");
    expect(roundMobs(5)).toContain("brute");
    expect(roundMobs(4)).not.toContain("brute");
    expect(roundMobs(100).length).toBeLessThanOrEqual(60);
  });

  it("raises the blood moon on every seventh night, and counts down to it", () => {
    const DAY = 24000;
    expect(bloodMoonAt(6 * DAY + 13000)).toBe(true);
    expect(bloodMoonAt(6 * DAY + 6000)).toBe(false);
    expect(bloodMoonAt(5 * DAY + 13000)).toBe(false);
    expect(bloodMoonAt(13 * DAY + 20000)).toBe(true);
    expect(bloodMoonAt(7 * DAY + 1000)).toBe(false);
    expect(daysToBloodMoon(0)).toBe(6);
    expect(daysToBloodMoon(6 * DAY)).toBe(0);
    expect(daysToBloodMoon(7 * DAY)).toBe(6);
  });

  it("says where a crash came down in words, and gives a fresh spawn next to nothing", () => {
    expect(bearing(0, -10)).toBe("north");
    expect(bearing(10, 0)).toBe("east");
    expect(bearing(-10, 10)).toBe("south-west");
    for (const [n] of FRESH_SPAWN) expect(() => itemByName(n)).not.toThrow();
    expect(waterFrom("soda_can")).toBeGreaterThan(0);
    expect(sicknessChance("rotten_flesh")).toBeGreaterThan(sicknessChance("canned_beans"));
  });

  it("keeps thirst, cold and wounds in the Dead Zone, and the infected in its wilds", () => {
    const d = modeDef("dead_zone")!;
    expect(d.fauna).toBe("infected");
    expect(d.vitals).toEqual({ thirst: true, temperature: true, wounds: true });
    expect(modeDef("zombie_rounds")!.map).toBe("zombie_bunker");
    expect(modeDef("infection")!.map).toBe("colosseum");
    expect(modeDef("blood_moon")!.fauna).toBe("infected");
  });
});
