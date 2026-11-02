import { beforeEach, describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { Car, CAR_MODEL_IDS } from "@/craft/engine/cars";
import { Chunk } from "@/craft/engine/chunk";
import { City, GROUND, NEON_BAY, ROAD, STREET } from "@/craft/engine/city";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import type { EntityContext, PlayerRef } from "@/craft/engine/entities";
import { itemByName } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { mapLayout } from "@/craft/engine/maps";
import { Mob } from "@/craft/engine/mobs";
import { addHeat, canSee, chaseWaypoint, COPS_ON_FOOT, CRUISERS, evadeSeconds, heatFor, STAR_HEAT, starsFor } from "@/craft/engine/police";
import { carCode, carFromCode, DEALER_MODELS, GUN_SHOP } from "@/craft/engine/shops";
import { World } from "@/craft/engine/world";
import { Generator } from "@/craft/engine/worldgen";
import { sanitizeModeTell } from "@/craft/net/session";

function flatWorld(): World {
  const world = new World();
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= GROUND; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

let world: World;
let players: PlayerRef[];
let hits: { id: string; amount: number; source: string }[];
let sounds: string[];
const ctx = (): EntityContext => ({
  world, tick: 0, daylight: 1, difficulty: 2, random: Math.random, players: () => players,
  hurtPlayer: (id, amount, source) => { hits.push({ id, amount, source }); }, givePlayer: () => 0, giveXp: () => {}, spawn: () => {},
  dropItem: () => {}, explode: () => {}, sound: (n) => { sounds.push(n); }, particles: () => {}, entitiesNear: () => [], placeBlock: () => true,
});
const suspect = (x: number, z: number): PlayerRef => ({ id: "perp", name: "perp", x, y: STREET, z, width: 0.6, height: 1.8, targetable: true, heldItem: -1, sneaking: false });

beforeEach(() => {
  world = flatWorld();
  players = [];
  hits = [];
  sounds = [];
});

describe("the wanted meter", () => {
  it("lights a star for a punch, two for a body, and three or more for a cop", () => {
    expect(starsFor(addHeat(0, "assault"))).toBe(1);
    expect(starsFor(addHeat(0, "murder"))).toBe(2);
    expect(starsFor(addHeat(0, "copKiller"))).toBeGreaterThanOrEqual(3);
    let heat = 0;
    for (let i = 0; i < 12; i++) heat = addHeat(heat, "copKiller");
    expect(starsFor(heat)).toBe(5);
  });

  it("drops a star to exactly the one below", () => {
    for (let s = 1; s <= 5; s++) expect(starsFor(heatFor(s - 1))).toBe(s - 1);
    expect(STAR_HEAT).toHaveLength(5);
  });

  it("takes longer to shake the more stars there are, and sends more police for them", () => {
    for (let s = 1; s < 5; s++) {
      expect(evadeSeconds(s + 1)).toBeGreaterThan(evadeSeconds(s));
      expect(COPS_ON_FOOT[s + 1] + CRUISERS[s + 1]).toBeGreaterThan(COPS_ON_FOOT[s] + CRUISERS[s]);
    }
  });

  it("travels to a guest as a whole number of stars, and nothing else", () => {
    expect(sanitizeModeTell({ wanted: 9 }).wanted).toBe(5);
    expect(sanitizeModeTell({ wanted: 2.7 }).wanted).toBe(2);
    expect(sanitizeModeTell({ confiscate: "yes" }).confiscate).toBeUndefined();
    expect(sanitizeModeTell({ confiscate: true }).confiscate).toBe(true);
  });
});

describe("a cop", () => {
  const run = (m: Mob, ticks: number) => { for (let i = 0; i < ticks; i++) { m.beginTick(); m.tick(ctx()); } };

  it("walks the beat when nobody is wanted", () => {
    const cop = new Mob("cop", 0.5, STREET, 0.5);
    run(cop, 200);
    expect(hits).toHaveLength(0);
  });

  it("closes in and clubs a one-star suspect", () => {
    players = [suspect(8.5, 0.5)];
    const cop = new Mob("cop", 0.5, STREET, 0.5);
    cop.targetId = "perp";
    cop.copStars = 1;
    run(cop, 160);
    expect(Math.hypot(cop.x - 8.5, cop.z - 0.5)).toBeLessThan(2);
    expect(hits.some((h) => h.source === "mob")).toBe(true);
    expect(sounds).not.toContain("gun_pistol");
  });

  it("from three stars, stands off and shoots", () => {
    players = [suspect(12.5, 0.5)];
    const cop = new Mob("cop", 0.5, STREET, 0.5);
    cop.targetId = "perp";
    cop.copStars = 3;
    run(cop, 200);
    expect(sounds).toContain("gun_pistol");
    expect(Math.hypot(cop.x - 12.5, cop.z - 0.5)).toBeGreaterThan(3);
  });

  it("cannot see through a wall, and holds fire", () => {
    for (let y = STREET; y < STREET + 4; y++) for (let z = -6; z <= 6; z++) world.setBlock(6, y, z, B.STONE_BRICKS, 0, "player");
    expect(canSee(ctx(), 0.5, STREET + 1.6, 0.5, 12.5, STREET + 1.4, 0.5)).toBe(false);
    expect(canSee(ctx(), 0.5, STREET + 1.6, 2.5, 3.5, STREET + 1.4, 2.5)).toBe(true);
  });

  it("turns on whoever strikes them", () => {
    const cop = new Mob("cop", 0.5, STREET, 0.5);
    cop.hurt(ctx(), 1, "player", 3, 0, "perp");
    expect(cop.targetId).toBe("perp");
  });

  it("drops a little cash and some rounds", () => {
    const loot = (new Mob("cop", 0, STREET, 0) as unknown as { loot(c: EntityContext): { id: number }[] }).loot(ctx()).map((s) => s.id);
    expect(loot).toContain(itemByName("cash").id);
    expect(loot).toContain(itemByName("pistol_ammo").id);
  });
});

describe("a cruiser", () => {
  const city = new City(NEON_BAY, 9);
  it("drives the grid: along its avenue to the street nearest its quarry, then down it", () => {
    const x = city.laneLine({ axis: "z", road: 3, dir: 1 });
    const car = new Car(x, STREET, city.roadStart("x", 2) + 20, "police");
    car.yaw = Math.PI;
    // The quarry is well east and a few streets south.
    const tx = city.roadStart("z", 7) + 20, tz = city.roadStart("x", 6) + 6;
    const [wx, wz] = chaseWaypoint(city, car, tx, tz);
    expect(wx).toBeCloseTo(city.roadStart("z", 3) + ROAD / 2, 5);
    expect(wz).toBeCloseTo(city.roadStart("x", 6) + ROAD / 2, 5);
    // At that junction, it turns down the street toward them.
    car.body.x = wx; car.body.z = wz;
    const [nx, nz] = chaseWaypoint(city, car, tx, tz);
    expect(nx).toBe(tx);
    expect(nz).toBeCloseTo(wz, 5);
  });

  it("goes straight for its quarry once it is close", () => {
    const car = new Car(0.5, STREET, 0.5, "police");
    expect(chaseWaypoint(city, car, 10.5, 12.5)).toEqual([10.5, 12.5]);
  });
});

describe("the shops", () => {
  it("sells only things the game has, for real money", () => {
    for (const s of GUN_SHOP) {
      expect(s.price).toBeGreaterThan(0);
      for (const [name] of s.items) expect(() => itemByName(name), name).not.toThrow();
    }
  });

  it("sells every car but the police's, and sends its model and paint in one number", () => {
    expect(DEALER_MODELS).not.toContain("police");
    expect(DEALER_MODELS.length).toBe(CAR_MODEL_IDS.length - 1);
    for (const m of CAR_MODEL_IDS) for (const c of [0, 7, 15]) expect(carFromCode(carCode(m, c))).toEqual({ model: m, color: c });
    expect(carFromCode(9999)).toBeNull();
  });

  it("puts a counter under every shop the map lists, in the shop's own building", () => {
    const layout = mapLayout("neon_bay", 42, new Generator({ seed: 42, type: "default", dimension: "overworld" }));
    const kinds = new Set(layout.shops!.map((s) => s.shop));
    expect([...kinds].sort()).toEqual(["cars", "guns"]);
    const c = layout.city!;
    for (const s of layout.shops!) {
      const out = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
      c.fill(s.x >> 4, s.z >> 4, out);
      expect(out.blocks[blockIndex(s.x & 15, s.y, s.z & 15)], `${s.shop} at ${s.x},${s.y},${s.z}`).not.toBe(B.AIR);
    }
  });
});
