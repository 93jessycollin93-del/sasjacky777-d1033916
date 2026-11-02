import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from "@/craft/engine/constants";
import { Chunk } from "@/craft/engine/chunk";
import { lightChunk } from "@/craft/engine/lighting";
import { World } from "@/craft/engine/world";
import type { EntityContext, PlayerRef } from "@/craft/engine/entities";
import { Mob, MOB_SPECS } from "@/craft/engine/mobs";
import { boardsOf, COUNTY_BLOCKS as C, WINDOW_BROKEN, WINDOW_OPEN, withBoards } from "@/craft/engine/countyBlocks";
import { countyGroup, countyInfectedCap, isInfected, pickCountyInfected } from "@/craft/engine/infected";
import { give, thumpTicks } from "@/craft/engine/infectedAi";
import {
  boardUp, broadcast, countyDay, countyHour, hasPower, hasWater, helicopter, nailsPerBoard, pryBoard, spoiled, toggleWindow, utilities,
} from "@/craft/engine/countyLife";
import { freshVitals, KNOX, knoxStage, knoxWound, sanitizeVitals, statusLine, vitalsSecond, type Surroundings } from "@/craft/engine/vitals";
import { itemByName } from "@/craft/engine/items";
import { MAIN_WORLD_SEED } from "@/craft/game/mainWorld";
import { modeDef } from "@/craft/modes/modes";

function world(fill: (x: number, y: number, z: number) => [number, number] | number, radius = 1): World {
  const w = new World();
  for (let cz = -radius; cz <= radius; cz++) for (let cx = -radius; cx <= radius; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
    for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const f = fill(cx * 16 + x, y, cz * 16 + z);
      const [id, m] = typeof f === "number" ? [f, 0] : f;
      blocks[blockIndex(x, y, z)] = id;
      meta[blockIndex(x, y, z)] = m;
    }
    w.addChunk(new Chunk(cx, cz, blocks, meta, lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return w;
}

const player = (x: number, z: number, y = 11): PlayerRef => ({
  id: "steve", name: "Steve", x, y, z, width: 0.6, height: 1.8, targetable: true, sneaking: false, heldItem: null, invisible: false, goldArmor: false,
} as unknown as PlayerRef);

function context(w: World, players: PlayerRef[]): EntityContext {
  return {
    world: w, tick: 0, daylight: 1, difficulty: 2, random: () => 0.3, players: () => players,
    hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {}, dropItem: () => {},
    explode: () => {}, sound: () => {}, particles: () => {}, entitiesNear: () => [], placeBlock: () => true, mobGriefing: true,
  };
}

const calm: Surroundings = { biome: "Plains", dimension: "overworld", night: false, raining: false, inWater: false, y: 64, heat: 0, insulation: 0, sprinting: false };

describe("Ashgrove County's dead", () => {
  it("are nearly all shamblers, some crawlers, and hardly ever one that runs", () => {
    let s = 7;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) { const k = pickCountyInfected(rng); counts[k] = (counts[k] ?? 0) + 1; }
    expect(counts.shambler).toBeGreaterThan(4000);
    expect(counts.crawler).toBeGreaterThan(400);
    expect(counts.runner ?? 0).toBeLessThan(250);
    for (const k of ["shambler", "crawler"]) expect(isInfected(k)).toBe(true);
    // Slower than the overworld's zombie; a crawler is barely a foot high.
    expect(MOB_SPECS.shambler.speed).toBeLessThan(MOB_SPECS.zombie.speed);
    expect(MOB_SPECS.crawler.height).toBeLessThan(1);
  });

  it("crowd the towns and thin out in the country, and more come at night", () => {
    expect(countyInfectedCap(true, false)).toBeGreaterThan(countyInfectedCap(false, false) * 2);
    expect(countyInfectedCap(true, true)).toBeGreaterThan(countyInfectedCap(true, false));
    expect(countyGroup(true, () => 0.99)).toBeGreaterThan(countyGroup(false, () => 0.99));
  });

  it("go through glass in seconds, boards in a quarter-minute each, a door in half a minute — and never a wall", () => {
    expect(thumpTicks(C.HOUSE_WINDOW, 0)).toBeLessThan(100);
    expect(thumpTicks(C.HOUSE_WINDOW, WINDOW_BROKEN)).toBe(0);
    expect(thumpTicks(C.HOUSE_WINDOW, withBoards(0, 2))).toBeGreaterThan(200);
    expect(thumpTicks(C.FRONT_DOOR, 0)).toBeGreaterThan(thumpTicks(C.PANEL_DOOR, 0));
    expect(thumpTicks(C.METAL_DOOR, 0)).toBeGreaterThan(thumpTicks(C.FRONT_DOOR, 0));
    expect(thumpTicks(C.SIDING_WHITE, 0)).toBe(0);
    expect(thumpTicks(B.STONE, 0)).toBe(0);
  });

  it("take a board off at a time, then the glass, and a door comes down in both halves", () => {
    const w = world((_x, y) => (y <= 10 ? B.STONE : B.AIR));
    const ctx = context(w, []);
    w.setBlock(2, 11, 0, C.HOUSE_WINDOW, withBoards(0, 1));
    w.setBlock(2, 12, 0, C.HOUSE_WINDOW, withBoards(0, 1));
    give(ctx, 2, 12, 0, C.HOUSE_WINDOW, w.getMeta(2, 12, 0));
    expect(boardsOf(w.getMeta(2, 11, 0))).toBe(0);
    expect(boardsOf(w.getMeta(2, 12, 0))).toBe(0);
    give(ctx, 2, 11, 0, C.HOUSE_WINDOW, w.getMeta(2, 11, 0));
    expect(w.getMeta(2, 11, 0) & WINDOW_BROKEN).toBeTruthy();
    expect(w.getMeta(2, 12, 0) & WINDOW_BROKEN).toBeTruthy();
    w.setBlock(4, 11, 0, C.FRONT_DOOR, 0);
    w.setBlock(4, 12, 0, C.FRONT_DOOR, 8);
    give(ctx, 4, 12, 0, C.FRONT_DOOR, 8);
    expect(w.blockAt(4, 11, 0)).toBe(B.AIR);
    expect(w.blockAt(4, 12, 0)).toBe(B.AIR);
  });

  it("batter a shut front door down to get at someone behind it, where a plain wall would stop them for good", () => {
    const run = (door: boolean) => {
      const w = world((x, y) => (y <= 10 ? B.STONE : x === 3 && y < 15 ? C.SIDING_WHITE : B.AIR));
      // Facing 2: the panel stands across the x axis, in the line of the wall.
      if (door) { w.setBlock(3, 11, 0, C.PANEL_DOOR, 2); w.setBlock(3, 12, 0, C.PANEL_DOOR, 10); }
      const ctx = context(w, [player(8.5, 0.5)]);
      const m = new Mob("shambler", 0.5, 11, 0.5);
      m.alert = 4000; m.targetId = "steve";
      for (let i = 0; i < 20 * 40; i++) { m.beginTick(); m.tick(ctx); }
      return w.blockAt(3, 11, 0) === B.AIR;
    };
    expect(run(true)).toBe(true);
    expect(run(false)).toBe(false);
  });
});

describe("windows and barricades", () => {
  it("slides a window up and down, but not through boards or broken glass", () => {
    expect(toggleWindow(0)).toBe(WINDOW_OPEN);
    expect(toggleWindow(WINDOW_OPEN)).toBe(0);
    expect(toggleWindow(withBoards(0, 1))).toBeNull();
    expect(toggleWindow(WINDOW_BROKEN)).toBeNull();
  });

  it("takes four boards, shuts the window behind the first, and gives them back one at a time", () => {
    let m = WINDOW_OPEN | 1;
    for (let i = 1; i <= 4; i++) {
      m = boardUp(m, true)!;
      expect(boardsOf(m)).toBe(i);
    }
    expect(m & WINDOW_OPEN).toBe(0);
    expect(m & 3).toBe(1);
    expect(boardUp(m, true)).toBeNull();
    for (let i = 3; i >= 0; i--) { m = pryBoard(m)!; expect(boardsOf(m)).toBe(i); }
    expect(pryBoard(m)).toBeNull();
    expect(nailsPerBoard(true)).toBeLessThan(nailsPerBoard(false));
  });
});

describe("the infection", () => {
  it("is carried by every bite, now and then by a tear, and seldom by a scratch", () => {
    let s = 3;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const got: Record<string, [number, number]> = {};
    for (let i = 0; i < 20000; i++) {
      const w = knoxWound(rng);
      const t = (got[w.wound] ??= [0, 0]);
      t[0]++; if (w.infects) t[1]++;
    }
    expect(got.bite[1]).toBe(got.bite[0]);
    expect(got.laceration[1] / got.laceration[0]).toBeGreaterThan(0.18);
    expect(got.laceration[1] / got.laceration[0]).toBeLessThan(0.32);
    expect(got.scratch[1] / got.scratch[0]).toBeLessThan(0.12);
    expect(got.scratch[0]).toBeGreaterThan(got.bite[0]);
  });

  it("hides for half a day, then runs queasy, nauseous, feverish, failing — and the body turns", () => {
    const rules = { wounds: true, knox: true, temperature: true };
    const v = { ...freshVitals(), infection: 1 };
    const messages: string[] = [];
    let turned = -1, hurt = 0;
    for (let second = 1; second <= KNOX.turn + 5 && turned < 0; second++) {
      for (const e of vitalsSecond(v, rules, calm, second)) {
        if (e.kind === "message") messages.push(e.text);
        if (e.kind === "hurt" && e.cause === "infection") hurt++;
        if (e.kind === "turn") turned = second;
      }
      if (second === KNOX.queasy - 10) expect(statusLine(v, rules).join()).not.toMatch(/Queasy/);
    }
    expect(messages.length).toBeGreaterThanOrEqual(4);
    expect(hurt).toBeGreaterThan(20);
    expect(turned).toBeGreaterThan(KNOX.failing);
    expect(knoxStage({ infection: KNOX.fever + 1 })).toBe(3);
  });

  it("leaves a clean player alone, and survives a save", () => {
    const v = freshVitals();
    for (let s = 1; s < 4000; s++) for (const e of vitalsSecond(v, { knox: true }, calm, s)) expect(e.kind).not.toBe("turn");
    expect(sanitizeVitals({ ...freshVitals(), infection: 1500 }).infection).toBe(1500);
    expect(sanitizeVitals({ water: 3 }).infection).toBe(0);
  });

  it("is the main world's rule, and no other mode's", () => {
    expect(modeDef("ashgrove")?.vitals?.knox).toBe(true);
    expect(modeDef("deadzone")?.vitals?.knox).toBeFalsy();
  });
});

describe("the county's clock", () => {
  it("turns the water off first, then the power, a week or two in, on the world's own days", () => {
    const u = utilities(MAIN_WORLD_SEED);
    expect(u.waterOffDay).toBeGreaterThanOrEqual(6);
    expect(u.powerOffDay).toBeGreaterThan(u.waterOffDay);
    expect(u.powerOffDay).toBeLessThan(20);
    expect(utilities(MAIN_WORLD_SEED)).toEqual(u);
    expect(hasWater(MAIN_WORLD_SEED, 3000)).toBe(true);
    expect(hasWater(MAIN_WORLD_SEED, u.waterOffDay * 24000)).toBe(false);
    expect(hasPower(MAIN_WORLD_SEED, u.waterOffDay * 24000)).toBe(true);
    expect(hasPower(MAIN_WORLD_SEED, u.powerOffDay * 24000 + 5)).toBe(false);
    expect(countyDay(3000)).toBe(0);
    expect(countyHour(3000)).toBe(9);
  });

  it("keeps food in a cold fridge, lets it go once the fridge is warm, and never spoils a tin", () => {
    expect(spoiled("milk_carton", 2, false, 10)).toBe(false);
    expect(spoiled("milk_carton", 4, false, 10)).toBe(true);
    expect(spoiled("milk_carton", 7, true, 10)).toBe(false);
    // Power off on day 3: a day and a bit cold, then warm — it goes on day 5.
    expect(spoiled("milk_carton", 5, true, 3)).toBe(true);
    expect(spoiled("canned_beans", 90, false, 3)).toBe(false);
    expect(itemByName("spoiled_food")).toBeDefined();
  });

  it("says something new on the television each day until the power goes, and the radio after", () => {
    const first = broadcast("tv", 0, 9, true), third = broadcast("tv", 2, 9, true);
    expect(first).not.toBe(third);
    expect(broadcast("tv", 12, 9, false)).toMatch(/no power/);
    expect(broadcast("radio", 12, 9, false)).not.toMatch(/no power/);
    expect(broadcast("radio", 40, 9, false)).toMatch(/Static/);
  });

  it("sends the helicopter over once, in the first week", () => {
    const h = helicopter(MAIN_WORLD_SEED);
    expect(h.day).toBeGreaterThanOrEqual(3);
    expect(h.day).toBeLessThan(8);
    expect(h.hour).toBeGreaterThanOrEqual(9);
    expect(helicopter(MAIN_WORLD_SEED)).toEqual(h);
  });
});
