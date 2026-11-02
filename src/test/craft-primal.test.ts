import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from "@/craft/engine/constants";
import { Chunk } from "@/craft/engine/chunk";
import { lightChunk } from "@/craft/engine/lighting";
import { World } from "@/craft/engine/world";
import type { EntityContext, PlayerRef } from "@/craft/engine/entities";
import { itemByName } from "@/craft/engine/items";
import { Mob, MOB_SPECS } from "@/craft/engine/mobs";
import {
  CREATURES, DINO_KINDS, diet, foodPoints, levelScale, maxTorpor, pickCreatures, spawnBiomes, tameCost, TORPOR, wildLevel,
} from "@/craft/engine/creatures";
import { canRide, dinoWouldTake } from "@/craft/engine/dinoAi";
import { canLearn, engramFor, ENGRAMS, pointsAt, pointsFree } from "@/craft/engine/engrams";
import { allRecipes } from "@/craft/engine/crafting";
import { ambient, bodyTarget, freshVitals, sanitizeVitals, vitalsSecond, waterFrom, type Surroundings } from "@/craft/engine/vitals";
import { BIOMES } from "@/craft/engine/biomes";
import { DINO_MODELS, DINO_COLORS } from "@/craft/render/dinoModels";
import { Generator } from "@/craft/engine/worldgen";
import { mapLayout } from "@/craft/engine/maps";
import { modeDef } from "@/craft/modes/modes";
import { SUPPLY_TIERS, supplyTier } from "@/craft/modes/primal";

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

function context(world: World, players: PlayerRef[] = [], primal: "evolved" | "ascended" = "evolved"): EntityContext {
  return {
    world, tick: 0, daylight: 1, difficulty: 2, random: () => 0.5, players: () => players,
    hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {}, dropItem: () => {},
    explode: () => {}, sound: () => {}, particles: () => {}, entitiesNear: () => [], placeBlock: () => true, primal,
  };
}

const steve = (x = 0.5, z = 0.5): PlayerRef => ({
  id: "steve", name: "Steve", x, y: 11, z, width: 0.6, height: 1.8, targetable: true, sneaking: false, heldItem: null, invisible: false, goldArmor: false,
} as unknown as PlayerRef);

/** Knocks a creature out the honest way: torpor, a dose at a time. */
function knockOut(m: Mob, ctx: EntityContext): number {
  let doses = 0;
  while (!m.unconscious && doses < 500) { m.addTorpor(ctx, TORPOR.tranq, "steve"); doses++; }
  return doses;
}

describe("Primal's creatures", () => {
  it("gives every creature stats, a model, colours, and real items to eat and to be saddled with", () => {
    for (const k of DINO_KINDS) {
      expect(MOB_SPECS[k], k).toBeDefined();
      expect(DINO_MODELS[k], k).toBeDefined();
      expect(DINO_COLORS[k], k).toBeDefined();
      const saddle = CREATURES[k].saddle;
      if (saddle) expect(() => itemByName(saddle)).not.toThrow();
      for (const food of diet(k)) expect(() => itemByName(food), `${k} eats ${food}`).not.toThrow();
    }
  });

  it("lives only in biomes that exist, and keeps the gigantoraptor to Ascended", () => {
    const names = new Set(BIOMES.map((b) => b.name));
    for (const b of spawnBiomes()) expect(names.has(b), b).toBe(true);
    const seen = (ascended: boolean) => {
      const kinds = new Set<string>();
      let s = 7;
      const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < 3000; i++) for (const b of spawnBiomes()) { const p = pickCreatures(b, rng, ascended); if (p) kinds.add(p.kind); }
      return kinds;
    };
    expect(seen(false).has("gigantoraptor")).toBe(false);
    expect(seen(true).has("gigantoraptor")).toBe(true);
  });

  it("rolls wild levels from 5 to 150 in fives, and scales health with them", () => {
    let s = 3;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 2000; i++) {
      const l = wildLevel(rng);
      expect(l % 5).toBe(0);
      expect(l).toBeGreaterThanOrEqual(5);
      expect(l).toBeLessThanOrEqual(150);
    }
    const a = new Mob("raptor", 0, 11, 0), b = new Mob("raptor", 0, 11, 0);
    a.level = 5; b.level = 150;
    expect(b.maxHealth).toBeGreaterThan(a.maxHealth * 1.8);
    expect(levelScale(150)).toBeCloseTo(1 + 149 / 150, 5);
  });

  it("drops once its torpor passes its limit, and wakes when the torpor drains away", () => {
    const world = flatWorld(ground);
    const ctx = context(world);
    const m = new Mob("raptor", 0.5, 11, 0.5);
    m.level = 30;
    const doses = knockOut(m, ctx);
    expect(m.unconscious).toBe(true);
    expect(doses).toBe(Math.ceil(maxTorpor("raptor", 30) / TORPOR.tranq));
    expect(m.persistent).toBe(true);
    for (let i = 0; i < 20 * 200 && m.unconscious; i++) { m.beginTick(); m.tick(ctx); }
    expect(m.unconscious).toBe(false);
    expect(m.taming).toBe(0);
  });

  it("is tamed by feeding it while it sleeps — kibble fastest — and earns bonus levels for a clean tame", () => {
    const world = flatWorld(ground);
    const ctx = context(world);
    const m = new Mob("raptor", 0.5, 11, 0.5);
    m.level = 40;
    expect(m.interact(ctx, "kibble", "steve", "Steve")).toBeNull();
    knockOut(m, ctx);
    const need = tameCost("raptor", 40, false);
    let fed = 0, result: string | null = null;
    while (result !== "tamed" && fed < 100) { result = m.interact(ctx, "kibble", "steve", "Steve"); fed++; }
    expect(result).toBe("tamed");
    expect(fed).toBe(Math.ceil(need / foodPoints("raptor", "kibble")));
    expect(m.owner).toBe("steve");
    expect(m.level).toBe(40 + 20);
    expect(m.unconscious).toBe(false);
    expect(m.health).toBe(m.maxHealth);
  });

  it("tames with less food under Ascended's rules, and a raptor turns its nose up at berries", () => {
    expect(tameCost("rex", 100, true)).toBeLessThan(tameCost("rex", 100, false));
    expect(foodPoints("raptor", "mejoberry")).toBe(0);
    expect(foodPoints("trike", "mejoberry")).toBeGreaterThan(foodPoints("trike", "wheat"));
    expect(foodPoints("trike", "kibble")).toBeGreaterThan(foodPoints("trike", "mejoberry"));
  });

  it("loses tame effectiveness, and so bonus levels, to every blow taken while asleep", () => {
    const world = flatWorld(ground);
    const ctx = context(world);
    const m = new Mob("trike", 0.5, 11, 0.5);
    m.level = 50;
    knockOut(m, ctx);
    for (let i = 0; i < 6; i++) { m.invulnerable = 0; m.hurt(ctx, 1, "player", 0, 0, "steve"); }
    expect(m.tameEffect).toBeLessThan(0.8);
    let result: string | null = null;
    for (let i = 0; i < 200 && result !== "tamed"; i++) result = m.interact(ctx, "kibble", "steve", "Steve");
    expect(m.level).toBeLessThan(50 + 25);
    expect(m.level).toBeGreaterThan(50);
  });

  it("keeps a sleeping creature under with narcotics, and takes what the host would take", () => {
    const world = flatWorld(ground);
    const ctx = context(world);
    const m = new Mob("parasaur", 0.5, 11, 0.5);
    knockOut(m, ctx);
    const before = m.torpor;
    expect(dinoWouldTake(m, "narcotic", "steve")).toBe(true);
    expect(m.interact(ctx, "narcotic", "steve", "Steve")).toBe("fed");
    expect(m.torpor).toBeGreaterThan(before);
    expect(dinoWouldTake(m, "dirt", "steve")).toBe(false);
    expect(m.interact(ctx, "dirt", "steve", "Steve")).toBeNull();
  });

  it("carries only its owner, saddled, and only a creature that can wear a saddle", () => {
    const world = flatWorld(ground);
    const ctx = context(world);
    const m = new Mob("raptor", 0.5, 11, 0.5);
    m.owner = "steve"; m.ownerName = "Steve";
    expect(canRide(m, "steve", "Steve")).toBe(false);
    expect(dinoWouldTake(m, "saddle", "steve", "Steve")).toBe(true);
    expect(m.interact(ctx, "saddle", "steve", "Steve")).toBe("saddled");
    expect(canRide(m, "steve", "Steve")).toBe(true);
    expect(canRide(m, "alex", "Alex")).toBe(false);
    const dodo = new Mob("dodo", 0, 11, 0);
    dodo.owner = "steve"; dodo.saddled = true;
    expect(canRide(dodo, "steve")).toBe(false);
  });

  it("goes where its rider steers it, faster than it walks alone", () => {
    const world = flatWorld(ground);
    const ctx = context(world, [steve()]);
    const m = new Mob("raptor", 0.5, 11, 0.5);
    m.owner = "steve"; m.saddled = true; m.rider = "steve";
    m.input = { forward: 1, strafe: 0, yaw: Math.PI };
    for (let i = 0; i < 40; i++) { m.beginTick(); m.tick(ctx); }
    expect(m.body.z).toBeGreaterThan(8);
    expect(Math.abs(m.body.x - 0.5)).toBeLessThan(0.5);
  });

  it("keeps its level, torpor, tame, owner and saddle through a save", () => {
    const m = new Mob("stego", 1, 11, 1);
    m.level = 75; m.torpor = 12.5; m.owner = "steve"; m.ownerName = "Steve"; m.saddled = true; m.sitting = true;
    const back = new Mob("stego", 0, 0, 0, m.id);
    back.applySnapshot(m.snapshot());
    expect([back.level, back.torpor, back.owner, back.ownerName, back.saddled, back.sitting]).toEqual([75, 12.5, "steve", "Steve", true, true]);
  });

  it("leaves meat and hide behind", async () => {
    const world = flatWorld(ground);
    const drops: number[] = [];
    const ctx = { ...context(world), dropItem: (_x: number, _y: number, _z: number, s: { id: number }) => { drops.push(s.id); } };
    const m = new Mob("trike", 0.5, 11, 0.5);
    m.hurt(ctx, 10000, "player", 0, 0, "steve");
    for (let i = 0; i < 40 && !m.removed; i++) { m.beginTick(); m.tick(ctx); }
    expect(drops).toContain(itemByName("raw_meat").id);
    expect(drops).toContain(itemByName("leather").id);
  });
});

describe("engrams", () => {
  it("teaches only items that have recipes, and earns four points a level with a bonus every fifth", () => {
    const outputs = new Set(allRecipes().map((r) => r.result.item));
    for (const e of ENGRAMS) for (const u of e.unlocks) expect(outputs.has(u), `${e.name}: ${u}`).toBe(true);
    expect(pointsAt(0)).toBe(0);
    expect(pointsAt(1)).toBe(4);
    expect(pointsAt(5)).toBe(24);
  });

  it("needs the level and the points, and never locks the stone age", () => {
    const club = ENGRAMS.find((e) => e.id === "club")!;
    const iron = ENGRAMS.find((e) => e.id === "iron_tools")!;
    expect(canLearn(club, 0, new Set())).not.toBe(true);
    expect(canLearn(club, 1, new Set())).toBe(true);
    expect(canLearn(iron, 5, new Set())).toMatch(/level/);
    const learned = new Set(["club"]);
    expect(pointsFree(1, learned)).toBe(2);
    expect(canLearn(club, 1, learned)).toBe("Already learned");
    for (const basic of ["wooden_pickaxe", "stone_pickaxe", "crafting_table", "torch", "oak_planks", "chest", "stick"]) expect(engramFor(basic), basic).toBeUndefined();
    expect(engramFor("iron_pickaxe")?.id).toBe("iron_tools");
    expect(engramFor("tranq_arrow")?.id).toBe("tranq");
  });
});

describe("vitals", () => {
  const air = (over: Partial<Surroundings> = {}): Surroundings => ({
    biome: "Plains", dimension: "overworld", night: false, raining: false, inWater: false, y: 70, heat: 0, insulation: 0, sprinting: false, ...over,
  });

  it("drains water about a point every forty seconds, faster at a run, and hurts once it is gone", () => {
    const v = freshVitals();
    for (let s = 1; s <= 40; s++) vitalsSecond(v, { thirst: true }, air(), s);
    expect(v.water).toBeCloseTo(19, 5);
    const run = freshVitals();
    for (let s = 1; s <= 40; s++) vitalsSecond(run, { thirst: true }, air({ sprinting: true }), s);
    expect(run.water).toBeLessThan(v.water);
    const dry = { ...freshVitals(), water: 0 };
    const hurts = [1, 2, 3, 4, 5].flatMap((s) => vitalsSecond(dry, { thirst: true }, air(), s)).filter((e) => e.kind === "hurt");
    expect(hurts).toEqual([{ kind: "hurt", amount: 1, cause: "thirst" }]);
  });

  it("chills the body on a snowy night and warms it by a fire; hide holds warmth in", () => {
    expect(ambient(air({ biome: "Snowy Plains", night: true }))).toBeLessThan(0);
    expect(ambient(air({ biome: "Snowy Plains", night: true, heat: 1 }))).toBeGreaterThan(ambient(air({ biome: "Snowy Plains", night: true })) + 20);
    expect(bodyTarget(-10, 0)).toBeLessThan(35);
    expect(bodyTarget(-10, 1)).toBeGreaterThan(bodyTarget(-10, 0));
    expect(bodyTarget(20, 0)).toBe(37);
    const v = freshVitals();
    for (let s = 1; s <= 600; s++) vitalsSecond(v, { temperature: true }, air({ biome: "Snowy Peaks", night: true }), s);
    expect(v.temp).toBeLessThan(35);
  });

  it("bleeds until bandaged, and a fever passes on its own", () => {
    const v = { ...freshVitals(), bleeding: 2, sick: 400 };
    const events = [1, 2, 3, 4, 5, 6].flatMap((s) => vitalsSecond(v, { wounds: true }, air(), s));
    expect(events.filter((e) => e.kind === "hurt" && e.cause === "bleeding").length).toBe(2);
    for (let s = 7; s < 40; s++) vitalsSecond(v, { wounds: true }, air(), s);
    expect(v.sick).toBe(0);
  });

  it("quenches with water, juicy food and drink, and restores a sane state from a save", () => {
    expect(waterFrom("water_bottle")).toBeGreaterThan(waterFrom("melon_slice"));
    expect(waterFrom("bread")).toBe(0);
    expect(sanitizeVitals({ water: 99, temp: -40, bleeding: 9, sick: -3, broken: "yes" })).toEqual({ water: 20, temp: 20, bleeding: 3, sick: 0, broken: false, infection: 0 });
  });
});

describe("the Island", () => {
  it("is land in the middle and open sea far out, with you waking on its southern beach", () => {
    const g = new Generator({ seed: 99, type: "default", dimension: "overworld", map: "primal_island" });
    // Mostly dry within a few hundred blocks (rivers still cut through), and sea all round beyond.
    let land = 0, n = 0;
    for (let x = -250; x <= 250; x += 25) for (let z = -250; z <= 250; z += 25) { n++; if (g.surfaceY(x, z) >= 63) land++; }
    expect(land / n).toBeGreaterThan(0.8);
    for (let a = 0; a < 16; a++) expect(g.surfaceY(Math.round(Math.cos(a) * 900), Math.round(Math.sin(a) * 900))).toBeLessThan(60);
    const l = mapLayout("primal_island", 99, g);
    expect(l.terrain).toBe(true);
    expect(l.spawn[2]).toBeGreaterThan(299);
    expect(l.spawn[1]).toBeGreaterThanOrEqual(63);
    // On dry land, with only sea between it and the southern horizon.
    expect(g.surfaceY(0, Math.floor(l.spawn[2]))).toBeGreaterThanOrEqual(63);
    for (let z = Math.floor(l.spawn[2]) + 8; z < 780; z += 4) expect(g.surfaceY(0, z), `z ${z}`).toBeLessThan(63);
    expect(g.villagesAt(0, 0)).toEqual([]);
  });

  it("grows berry bushes on a Primal world and nowhere else", () => {
    const count = (berries: boolean) => {
      const g = new Generator({ seed: 5, type: "default", dimension: "overworld", berries });
      let n = 0;
      for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) n += g.generate(cx, cz).blocks.filter((b) => b === B.MEJOBERRY_BUSH || b === B.NARCOBERRY_BUSH).length;
      return n;
    };
    expect(count(false)).toBe(0);
    expect(count(true)).toBeGreaterThan(0);
  });

  it("sets up both rulesets with creatures, thirst, heat and engrams", () => {
    for (const id of ["primal_evolved", "primal_ascended"]) {
      const d = modeDef(id)!;
      expect(d.fauna).toBe("primal");
      expect(d.map).toBe("primal_island");
      expect(d.vitals?.thirst && d.vitals?.temperature).toBe(true);
      expect(d.engrams).toBe(true);
    }
    expect(modeDef("primal_ascended")!.primal).toBe("ascended");
  });

  it("drops better supplies the longer you last, only of things that exist", () => {
    expect(supplyTier(0)).toBe(0);
    expect(supplyTier(4)).toBe(1);
    expect(supplyTier(20)).toBe(2);
    for (const t of SUPPLY_TIERS) for (const [n] of t) expect(() => itemByName(n), n).not.toThrow();
  });
});
