import { beforeEach, describe, expect, it } from "vitest";
import { B, block, BOX_COLORS, Face, FACE_DIRS } from "@/craft/engine/blocks";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME, WORLD_HEIGHT } from "@/craft/engine/constants";
import { matchRecipe, recipeResult } from "@/craft/engine/crafting";
import { cityInRegion, cityLoot, EndGenerator, type EndCity } from "@/craft/engine/end";
import { CITY_REACH } from "@/craft/engine/endCity";
import { ItemFrame, Projectile, type Entity, type EntityContext, type PlayerRef } from "@/craft/engine/entities";
import { fitsInBox, sanitizeStack } from "@/craft/engine/inventory";
import { DYES, itemId, type ItemStack, type StatusEffect } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { Mob } from "@/craft/engine/mobs";
import { newBody, travel } from "@/craft/engine/physics";
import { World } from "@/craft/engine/world";
import { tooltipLines } from "@/craft/ui/itemText";

const gen = new EndGenerator(4242);

/** Cities in the first few dozen regions — enough to find towers, loot rooms and ships. */
const cities: EndCity[] = [];
for (let rx = -6; rx <= 6; rx++) for (let rz = -6; rz <= 6; rz++) {
  const c = cityInRegion(gen, rx, rz);
  if (c) cities.push(c);
}

function blocksOf() {
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

describe("End cities", () => {
  it("grows several towers joined by bridges from a house on the island", () => {
    expect(cities.length).toBeGreaterThan(3);
    const biggest = Math.max(...cities.map((c) => c.towers));
    expect(biggest).toBeGreaterThanOrEqual(4);
    // A big city spreads well beyond the old single house and tower.
    const wide = cities.find((c) => c.towers === biggest)!;
    expect(Math.max(wide.x1 - wide.x0, wide.z1 - wide.z0)).toBeGreaterThan(40);
  });

  it("stays within reach of its middle, so the chunk search finds every piece", () => {
    for (const c of cities) {
      expect(c.x - c.x0).toBeLessThanOrEqual(CITY_REACH);
      expect(c.x1 - c.x).toBeLessThanOrEqual(CITY_REACH);
      expect(c.z - c.z0).toBeLessThanOrEqual(CITY_REACH);
      expect(c.z1 - c.z).toBeLessThanOrEqual(CITY_REACH);
      for (const f of c.fills) expect(f[4]).toBeLessThan(WORLD_HEIGHT);
    }
  });

  it("stands its chests and brewing stands where the plan says, and gives each shulker a block to hold", () => {
    const w = blocksOf();
    let checked = 0;
    for (const c of cities.slice(0, 6)) {
      for (const [x, y, z] of c.chests) expect(w.get(x, y, z)).toBe(B.CHEST);
      for (const [x, y, z] of c.brewing) expect(w.get(x, y, z)).toBe(B.BREWING_STAND);
      for (const [x, y, z, face] of c.shulkers) {
        expect(block(w.get(x, y, z)).solid).toBe(false);
        const [dx, dy, dz] = FACE_DIRS[face];
        expect(block(w.get(x + dx, y + dy, z + dz)).solid).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("builds loot rooms in fat towers: two chests and a brewing stand under two shulkers", () => {
    const withRoom = cities.find((c) => c.brewing.length >= (c.ship ? 2 : 1) && c.chests.length >= 3);
    expect(withRoom).toBeDefined();
  });

  it("moors a ship with the elytra framed on its cabin wall and the dragon's head on its prow", () => {
    const withShip = cities.filter((c) => c.ship);
    expect(withShip.length).toBeGreaterThan(0);
    const w = blocksOf();
    for (const c of withShip.slice(0, 3)) {
      const f = c.frame!;
      expect(f).not.toBeNull();
      // The frame's cell is open and the wall behind it solid.
      expect(block(w.get(f.x, f.y, f.z)).solid).toBe(false);
      const [dx, dy, dz] = FACE_DIRS[f.face];
      expect(block(w.get(f.x - dx, f.y - dy, f.z - dz)).solid).toBe(true);
      let head = 0;
      for (let dz2 = -14; dz2 <= 14; dz2++) for (let dx2 = -14; dx2 <= 14; dx2++) if (w.get(c.ship!.x + dx2, c.ship!.y + 1, c.ship!.z + dz2) === B.DRAGON_HEAD) head++;
      expect(head).toBe(1);
      expect(c.chests.filter((ch) => ch[3] === "ship")).toHaveLength(2);
    }
  });

  it("stamps a city the same whichever of its chunks generates first", () => {
    const c = cities[0];
    const a = gen.generate(c.x >> 4, c.z >> 4);
    for (let dx = -2; dx <= 2; dx++) gen.generate((c.x >> 4) + dx, (c.z >> 4) + 3);
    const b = gen.generate(c.x >> 4, c.z >> 4);
    expect(Buffer.from(b.blocks).equals(Buffer.from(a.blocks))).toBe(true);
    expect(Buffer.from(b.meta).equals(Buffer.from(a.meta))).toBe(true);
  });

  it("fills city chests with treasure, and a ship's no poorer", () => {
    let city = 0, ship = 0;
    for (let seed = 0; seed < 40; seed++) {
      const a: (ItemStack | null)[] = new Array(27).fill(null), b: (ItemStack | null)[] = new Array(27).fill(null);
      cityLoot(a, seed, false); cityLoot(b, seed, true);
      city += a.filter(Boolean).length; ship += b.filter(Boolean).length;
    }
    expect(city).toBeGreaterThan(40);
    expect(ship).toBeGreaterThanOrEqual(city);
  });
});

// ---- shulkers, their bullets, levitation -------------------------------------------------------------

function flatWorld(r = 1): World {
  const world = new World();
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.END_STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

let world: World;
let spawned: Entity[];
let players: PlayerRef[];
let hurt: { id: string; amount: number }[];
let effects: { id: string; effect: StatusEffect; seconds: number }[];
let dropped: ItemStack[];
/** Where the mobs' chances come from: Math.random, unless a test pins it to a seed. */
let random: () => number = Math.random;

const ctx = (): EntityContext => ({
  world, tick: 0, daylight: 1, difficulty: 2, random: () => random(), players: () => players,
  hurtPlayer: (id, amount) => { hurt.push({ id, amount }); }, givePlayer: () => 0, giveXp: () => {},
  spawn: (e) => { spawned.push(e); }, dropItem: (_x, _y, _z, s) => { dropped.push(s); }, explode: () => {}, sound: () => {}, particles: () => {},
  entitiesNear: (x, y, z, r) => spawned.filter((m) => !m.removed && Math.abs(m.x - x) <= r && Math.abs(m.y - y) <= r && Math.abs(m.z - z) <= r),
  placeBlock: (x, y, z, id, meta) => world.setBlock(x, y, z, id, meta),
  effectPlayer: (id, effect, seconds) => { effects.push({ id, effect, seconds }); },
});

const alex = (x: number, z: number, y = 11): PlayerRef =>
  ({ id: "p1", name: "Alex", x, y, z, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false });

function tickAll(n: number): void {
  const c = ctx();
  for (let i = 0; i < n; i++) for (const e of [...spawned]) if (!e.removed) { e.beginTick(); e.tick(c); }
}

beforeEach(() => {
  random = Math.random;
  world = flatWorld(2);
  spawned = [];
  players = [];
  hurt = [];
  effects = [];
  dropped = [];
});

describe("shulkers", () => {
  it("opens up and fires a bullet at a player in sight, and stays shut and still with nobody about", () => {
    const s = new Mob("shulker", 0.5, 11, 0.5);
    spawned.push(s);
    tickAll(200);
    expect(spawned.filter((e) => e instanceof Projectile)).toHaveLength(0);
    expect(s.x).toBe(0.5);
    players = [alex(8.5, 0.5)];
    tickAll(160);
    expect(s.peek).toBeGreaterThan(0.9);
    expect(spawned.some((e) => e instanceof Projectile && e.kind === "shulker_bullet")).toBe(true);
    expect(s.x).toBe(0.5);
    expect(s.y).toBe(11);
  });

  it("turns arrows aside while shut, and takes a fifth of any other blow", () => {
    const s = new Mob("shulker", 0.5, 11, 0.5);
    expect(s.peek).toBe(0);
    expect(s.hurt(ctx(), 9, "arrow", 5, 0.5, "p1")).toBe(false);
    expect(s.health).toBe(30);
    s.hurt(ctx(), 10, "player", 5, 0.5, "p1");
    expect(s.health).toBeCloseTo(28);
  });

  it("teleports to another block when the one it holds to is broken", () => {
    const s = new Mob("shulker", 0.5, 11, 0.5);
    spawned.push(s);
    world.setBlock(0, 10, 0, B.AIR, 0);
    tickAll(11);
    const [dx, dy, dz] = FACE_DIRS[s.attach];
    expect(block(world.blockAt(Math.floor(s.x) + dx, Math.floor(s.y + 0.5) + dy, Math.floor(s.z) + dz)).solid).toBe(true);
    expect(Math.floor(s.x) !== 0 || Math.floor(s.z) !== 0 || s.y !== 11).toBe(true);
  });

  it("drops a shell about half the time", () => {
    // Seeded, so the count is the same on every machine: unseeded, a run out in the tail once failed the suite.
    let seed = 20260929;
    random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let shells = 0;
    for (let i = 0; i < 200; i++) {
      const s = new Mob("shulker", 0.5, 11, 0.5);
      spawned = [s];
      dropped = [];
      // A shut shell takes a fifth, so the blow has to be five times the health.
      s.hurt(ctx(), 200, "player", 5, 0.5, "p1");
      tickAll(25);
      if (dropped.some((d) => d.id === itemId("shulker_shell"))) shells++;
    }
    random = Math.random;
    expect(shells).toBeGreaterThan(70);
    expect(shells).toBeLessThan(130);
  });
});

describe("shulker bullets", () => {
  it("fly along one axis at a time, and lift the player they strike for ten seconds", () => {
    players = [alex(6.5, 5.5)];
    const b = new Projectile("shulker_bullet", 0.5, 11.5, 0.5, 0, 0, 0, "mob:999");
    b.homing = "p1";
    spawned.push(b);
    let hit = false;
    for (let i = 0; i < 400 && !hit; i++) {
      tickAll(1);
      if (!b.removed && i > 8) {
        const v = [Math.abs(b.body.vx), Math.abs(b.body.vy), Math.abs(b.body.vz)].filter((x) => x > 0.02);
        expect(v.length).toBeLessThanOrEqual(2);
      }
      hit = b.removed;
    }
    expect(hit).toBe(true);
    expect(hurt[0]).toEqual({ id: "p1", amount: 4 });
    expect(effects[0]).toEqual({ id: "p1", effect: "levitation", seconds: 10 });
  });

  it("always reaches a mark that stands still, however its turns fall — one leg at a time, never past it", () => {
    // Once one in forty flights overshot the mark's line on every pass and never struck.
    let seed = 1;
    random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let run = 0; run < 300; run++) {
      players = [alex(6.5, 5.5)];
      spawned = [];
      const b = new Projectile("shulker_bullet", 0.5, 11.5, 0.5, 0, 0, 0, "mob:999");
      b.homing = "p1";
      spawned.push(b);
      let ticks = 0;
      while (!b.removed && ticks < 400) {
        tickAll(1);
        ticks++;
        if (!b.removed && ticks > 9) {
          expect([b.body.vx, b.body.vy, b.body.vz].filter((x) => Math.abs(x) > 0.02).length).toBeLessThanOrEqual(2);
        }
      }
      expect(b.removed).toBe(true);
    }
    random = Math.random;
  });

  it("is knocked out of the air by a blow", () => {
    const b = new Projectile("shulker_bullet", 0.5, 12, 0.5, 0, 0, 0, "mob:1");
    expect(b.hurt(ctx(), 1, "player", 0, 0, "p1")).toBe(true);
    expect(b.removed).toBe(true);
  });
});

describe("levitation", () => {
  it("carries a body steadily upward and forgives the fall it would otherwise be building", () => {
    const body = newBody(0.5, 11, 0.5, 0.6, 1.8, 1.62);
    for (let i = 0; i < 60; i++) travel(world, body, { forward: 0, strafe: 0, yaw: 0, jump: false, sneak: false, sprint: false, flying: false, speed: 0.1, levitation: 1 });
    expect(body.y).toBeGreaterThan(13);
    expect(body.vy).toBeCloseTo(0.05, 2);
    expect(body.fallDistance).toBe(0);
    // A stronger dose climbs faster.
    const fast = newBody(0.5, 11, 0.5, 0.6, 1.8, 1.62);
    for (let i = 0; i < 60; i++) travel(world, fast, { forward: 0, strafe: 0, yaw: 0, jump: false, sneak: false, sprint: false, flying: false, speed: 0.1, levitation: 3 });
    expect(fast.y).toBeGreaterThan(body.y + 3);
  });
});

// ---- shulker boxes ----------------------------------------------------------------------------------

describe("shulker boxes", () => {
  const box = (contents: (ItemStack | null)[], color?: number): ItemStack => ({ id: B.SHULKER_BOX, count: 1, contents, ...(color ? { color } : {}) });

  it("are crafted from two shells and a chest, one to a slot", () => {
    const grid = [null, { id: itemId("shulker_shell"), count: 1 }, null, null, { id: B.CHEST, count: 1 }, null, null, { id: itemId("shulker_shell"), count: 1 }, null];
    const r = matchRecipe(grid, 3)!;
    expect(recipeResult(r).id).toBe(B.SHULKER_BOX);
    expect(sanitizeStack({ id: B.SHULKER_BOX, count: 1 })).toEqual({ id: B.SHULKER_BOX, count: 1 });
  });

  it("keep their contents through a dye, taking the dye's colour", () => {
    const inside = [{ id: itemId("diamond"), count: 12 }, null, { id: B.OBSIDIAN, count: 64 }];
    const grid = [box(inside), { id: itemId("red_dye"), count: 1 }, null, null];
    const r = matchRecipe(grid, 2)!;
    const out = recipeResult(r, grid);
    expect(out.contents).toEqual(inside);
    expect(BOX_COLORS[out.color!]).toBe("red");
    expect(BOX_COLORS.slice(1)).toEqual([...DYES]);
  });

  it("carry their contents through the network and saves, but never another box inside", () => {
    const nested = box([{ id: itemId("diamond"), count: 3 }, box([{ id: itemId("emerald"), count: 1 }])], 4);
    const clean = sanitizeStack(JSON.parse(JSON.stringify(nested)))!;
    expect(clean.color).toBe(4);
    expect(clean.contents![0]).toEqual({ id: itemId("diamond"), count: 3 });
    expect(clean.contents![1]).toBeNull();
    expect(fitsInBox({ id: B.SHULKER_BOX, count: 1 })).toBe(false);
    expect(fitsInBox({ id: B.CHEST, count: 1 })).toBe(true);
  });

  it("say what they hold on their tooltip", () => {
    const lines = tooltipLines(box([{ id: itemId("diamond"), count: 12 }, ...Array.from({ length: 6 }, () => ({ id: B.STONE, count: 1 }))], 2)).map((l) => l.text);
    expect(lines[0]).toBe("Red Shulker Box");
    expect(lines).toContain("Diamond x12");
    expect(lines.some((l) => /and 2 more/.test(l))).toBe(true);
  });
});

// ---- item frames --------------------------------------------------------------------------------------

describe("item frames", () => {
  it("take one of what is held, turn it in eighths, and give up the item before the frame", () => {
    world.setBlock(0, 11, 0, B.STONE, 0);
    const f = new ItemFrame(Face.East, 1, 11, 0);
    spawned.push(f);
    expect(f.use(ctx(), { id: itemId("elytra"), count: 1 })).toBe("placed");
    expect(f.item?.id).toBe(itemId("elytra"));
    for (let i = 0; i < 9; i++) expect(f.use(ctx(), null)).toBe("turned");
    expect(f.turn).toBe(1);
    f.hurt(ctx());
    expect(dropped.map((d) => d.id)).toEqual([itemId("elytra")]);
    expect(f.removed).toBe(false);
    f.hurt(ctx());
    expect(f.removed).toBe(true);
    expect(dropped.map((d) => d.id)).toEqual([itemId("elytra"), itemId("item_frame")]);
  });

  it("come down, item and all, when the block they hang on is broken", () => {
    world.setBlock(0, 11, 0, B.STONE, 0);
    const f = new ItemFrame(Face.East, 1, 11, 0, { id: itemId("diamond"), count: 1 });
    spawned.push(f);
    tickAll(10);
    expect(f.removed).toBe(false);
    world.setBlock(0, 11, 0, B.AIR, 0);
    tickAll(10);
    expect(f.removed).toBe(true);
    expect(dropped.map((d) => d.id).sort()).toEqual([itemId("diamond"), itemId("item_frame")].sort());
  });

  it("save and restore their item, facing and turn", () => {
    const f = new ItemFrame(Face.North, 4, 20, -3, { id: itemId("elytra"), count: 1 }, 5);
    const g = new ItemFrame(Face.Up, 0, 0, 0);
    g.applySnapshot(JSON.parse(JSON.stringify(f.snapshot())));
    expect([g.face, g.bx, g.by, g.bz, g.turn, g.item?.id]).toEqual([Face.North, 4, 20, -3, 5, itemId("elytra")]);
  });
});
