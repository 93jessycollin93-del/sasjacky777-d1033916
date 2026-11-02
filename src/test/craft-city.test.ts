import { beforeEach, describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { Car, CAR_MODEL_IDS, CAR_MODELS } from "@/craft/engine/cars";
import { Chunk } from "@/craft/engine/chunk";
import { City, GOLDEN_COAST, GROUND, isRoadBlock, LOT, NEON_BAY, PITCH, ROAD, STREET, cityOf } from "@/craft/engine/city";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import type { Entity, EntityContext, PlayerRef } from "@/craft/engine/entities";
import { itemByName } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { mapLayout } from "@/craft/engine/maps";
import { Mob } from "@/craft/engine/mobs";
import { choices, laneNear, newTraffic, nextJunction, trafficDrive } from "@/craft/engine/traffic";
import { vehicleFromSnapshot } from "@/craft/engine/vehicles";
import { World } from "@/craft/engine/world";
import { Generator } from "@/craft/engine/worldgen";

const SEED = 1234;
const city = new City(NEON_BAY, SEED);

/** A world of the city's own chunks, built on demand as a test reaches them. */
function cityWorld(): { world: World; load: (x0: number, z0: number, x1: number, z1: number) => void } {
  const world = new World();
  const load = (x0: number, z0: number, x1: number, z1: number) => {
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) {
      if (world.isLoaded(cx * 16, cz * 16)) continue;
      const out = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
      city.fill(cx, cz, out);
      world.addChunk(new Chunk(cx, cz, out.blocks, out.meta, lightChunk(out.blocks, cx, cz), out.biomes, new Uint8Array(256 * 9)));
    }
  };
  return { world, load };
}

/** Flat stone to y=63, a long way north (for a car to reach its top speed), and whatever a test builds on it. */
function flatWorld(): World {
  const world = new World();
  for (let cz = -24; cz <= 3; cz++) for (let cx = -2; cx <= 2; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= GROUND; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

let world: World;
let entities: Entity[];
let players: PlayerRef[];
let blasts: { power: number; blocks: boolean | undefined }[];
let hurtPlayers: { id: string; amount: number }[];

const ctx = (): EntityContext => ({
  world, tick: 0, daylight: 1, difficulty: 2, random: Math.random, players: () => players,
  hurtPlayer: (id, amount) => { hurtPlayers.push({ id, amount }); }, givePlayer: () => 0, giveXp: () => {}, spawn: (e) => { entities.push(e); },
  dropItem: () => {}, explode: (_x, _y, _z, power, _c, _f, blocks) => { blasts.push({ power, blocks }); }, sound: () => {}, particles: () => {},
  entitiesNear: (x, _y, z, r) => entities.filter((e) => !e.removed && Math.hypot(e.x - x, e.z - z) <= r), placeBlock: () => true,
});

/** Drives a car from its seat, as a player would: the pedals and the wheel only do anything with someone in it. */
function drive(car: Car, ticks: number, input: Partial<Car["input"]>): void {
  car.rider ??= "tester";
  for (let i = 0; i < ticks; i++) {
    car.beginTick();
    car.input = { forward: 0, strafe: 0, yaw: car.yaw, jump: false, ...input };
    car.tick(ctx());
  }
}

beforeEach(() => {
  world = flatWorld();
  entities = [];
  players = [];
  blasts = [];
  hurtPlayers = [];
});

describe("Neon Bay's streets", () => {
  it("keeps traffic to the right: north up an avenue's east half, east along a street's south half", () => {
    const start = city.roadStart("z", 3);
    expect(city.laneLine({ axis: "z", road: 3, dir: -1 })).toBe(start + 9);
    expect(city.laneLine({ axis: "z", road: 3, dir: 1 })).toBe(start + 4);
    const street = city.roadStart("x", 5);
    expect(city.laneLine({ axis: "x", road: 5, dir: 1 })).toBe(street + 9);
    expect(city.laneLine({ axis: "x", road: 5, dir: -1 })).toBe(street + 4);
  });

  it("paves every lane of an avenue and a street clear from one end of the city to the other", () => {
    const { world: w, load } = cityWorld();
    const x = city.laneLine({ axis: "z", road: 4, dir: 1 }), z = city.laneLine({ axis: "x", road: 7, dir: -1 });
    load(x, city.minZ, x, city.maxZ);
    load(city.minX, z, city.maxX, z);
    for (let zz = city.minZ + 2; zz <= city.maxZ - 2; zz++) {
      expect(isRoadBlock(w.blockAt(x, GROUND, zz)), `ground at ${x},${zz}`).toBe(true);
      for (let y = STREET; y < STREET + 4; y++) expect(w.blockAt(x, y, zz), `air at ${x},${y},${zz}`).toBe(B.AIR);
    }
    for (let xx = city.minX + 2; xx <= city.maxX - 2; xx++) {
      expect(isRoadBlock(w.blockAt(xx, GROUND, z))).toBe(true);
      for (let y = STREET; y < STREET + 4; y++) expect(w.blockAt(xx, y, z)).toBe(B.AIR);
    }
  });

  it("builds the same chunk the same way every time, whoever builds it", () => {
    const a = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
    const b = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
    new City(NEON_BAY, SEED).fill(3, -4, a);
    new City(NEON_BAY, SEED).fill(3, -4, b);
    expect(a.blocks).toEqual(b.blocks);
    expect([...a.blocks].some((id) => id !== B.AIR && id !== B.STONE && id !== B.DIRT && id !== B.BEDROCK)).toBe(true);
  });

  it("keeps every building inside its own lot, off the sidewalks and the roads", () => {
    for (let i = 0; i < NEON_BAY.cols; i++) for (let j = 0; j < NEON_BAY.rows; j++) {
      const lot = city.lot(i, j);
      for (const b of lot.buildings) {
        expect(b.x0, `${i},${j}`).toBeGreaterThanOrEqual(lot.x0);
        expect(b.z0).toBeGreaterThanOrEqual(lot.z0);
        expect(b.x1).toBeLessThanOrEqual(lot.x0 + LOT - 1);
        expect(b.z1).toBeLessThanOrEqual(lot.z0 + LOT - 1);
        expect(b.y0 + b.h).toBeLessThan(127);
      }
    }
  });

  it("runs a beach down into the sea past the east avenue", () => {
    const { world: w, load } = cityWorld();
    const z = city.laneLine({ axis: "x", road: 6, dir: 1 }) + 20;
    load(city.maxX, z, city.maxX + NEON_BAY.beach + 20, z);
    expect(w.blockAt(city.maxX + 6, GROUND, z)).toBe(B.SAND);
    expect(w.blockAt(city.maxX + NEON_BAY.beach + 10, GROUND - 1, z)).toBe(B.WATER);
  });

  it("names the district and the street under a point", () => {
    const lot = city.lot(11, 4);
    expect(city.districtAt(lot.x0 + 5, lot.z0 + 5).name).toBe("Neon Drive");
    expect(city.districtAt(city.maxX + 10, lot.z0).name).toBe("Glowstick Beach");
    expect(city.districtAt(city.maxX + 500, 0).name).toBe("The Salty Sea");
    const x = city.laneLine({ axis: "z", road: 2, dir: 1 });
    expect(city.streetAt(x, lot.z0 + 5)).toBe(NEON_BAY.avenues[2]);
    expect(city.streetAt(lot.x0 + 5, lot.z0 + 5)).toBeNull();
  });

  it("puts a real table under every casino seat it lists", () => {
    const layout = mapLayout("neon_bay", SEED, new Generator({ seed: SEED, type: "default", dimension: "overworld" }));
    expect(layout.city).toBeDefined();
    expect(layout.casino!.length).toBeGreaterThan(20);
    const { world: w, load } = cityWorld();
    for (const c of layout.casino!) {
      load(c.x, c.z, c.x, c.z);
      expect(w.blockAt(c.x, c.y, c.z), `${c.game} at ${c.x},${c.y},${c.z}`).not.toBe(B.AIR);
    }
    // The spawn is on the ground outside the crib, not inside a wall.
    const [sx, sy, sz] = layout.spawn;
    load(sx, sz, sx, sz);
    expect(w.blockAt(Math.floor(sx), sy, Math.floor(sz))).toBe(B.AIR);
    expect(w.blockAt(Math.floor(sx), sy - 1, Math.floor(sz))).not.toBe(B.AIR);
  });
});

describe("a car", () => {
  it("pulls away, tops out close to its top speed, stops within a second on the brakes, then backs up", () => {
    const car = new Car(0.5, STREET, 0.5, "sedan");
    drive(car, 200, { forward: 1 });
    expect(car.speed).toBeGreaterThan(CAR_MODELS.sedan.top * 0.85);
    expect(car.speed).toBeLessThanOrEqual(CAR_MODELS.sedan.top * 1.01);
    let stoppedAt = -1;
    for (let i = 0; i < 40 && stoppedAt < 0; i++) { drive(car, 1, { forward: -1 }); if (car.speed <= 0.03) stoppedAt = i; }
    expect(stoppedAt).toBeGreaterThan(0);
    expect(stoppedAt).toBeLessThan(21);
    drive(car, 30, { forward: -1 });
    expect(car.speed).toBeLessThan(-0.1);
  });

  it("goes where it points, and turns right when steered right", () => {
    const car = new Car(0.5, STREET, 20.5, "sedan");
    drive(car, 30, { forward: 1 });
    expect(car.z).toBeLessThan(20);
    expect(Math.abs(car.x - 0.5)).toBeLessThan(0.01);
    const yaw = car.yaw;
    drive(car, 15, { forward: 1, strafe: 1 });
    expect(car.yaw).toBeLessThan(yaw);
    expect(car.x).toBeGreaterThan(0.6);
  });

  it("holds its line on grip, and lets the tail slide out on the handbrake", () => {
    const slide = (handbrake: boolean) => {
      const car = new Car(0.5, STREET, 30.5, "sports");
      drive(car, 40, { forward: 1 });
      drive(car, 12, { forward: 1, strafe: 1, jump: handbrake });
      const f = [-Math.sin(car.yaw), -Math.cos(car.yaw)];
      return Math.abs(car.body.vx * -f[1] + car.body.vz * f[0]);
    };
    expect(slide(true)).toBeGreaterThan(slide(false) * 2);
  });

  it("crashes into a wall: it stops, bounces back, and is dented by how hard it hit", () => {
    for (let x = -3; x <= 3; x++) for (let y = STREET; y < STREET + 3; y++) world.setBlock(x, y, -10, B.STONE_BRICKS, 0, "player");
    const car = new Car(0.5, STREET, 10.5, "sedan");
    drive(car, 90, { forward: 1 });
    expect(car.z).toBeGreaterThan(-9 + car.spec.l / 2 - 0.2);
    expect(car.health).toBeLessThan(car.spec.health);
    const soft = new Car(0.5, STREET, -6.5, "sedan");
    drive(soft, 25, { forward: 0.3 });
    expect(soft.health).toBe(soft.spec.health);
  });

  it("catches fire below a quarter, and goes up without taking the city with it", () => {
    const car = new Car(0.5, STREET, 0.5, "compact");
    car.damageBy(ctx(), car.spec.health - 200);
    drive(car, 200, {});
    expect(car.wrecked).toBeGreaterThan(0);
    expect(blasts).toHaveLength(1);
    expect(blasts[0].blocks).toBe(false);
    expect(car.rideable).toBe(false);
  });

  it("drowns in deep water: the engine dies and it sinks, without a bang", () => {
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = GROUND - 3; y <= GROUND + 2; y++) world.setBlock(x, y, z, B.WATER, 0, "player");
    const car = new Car(0.5, GROUND - 2, 0.5, "sedan");
    drive(car, 400, { forward: 1 });
    expect(car.wrecked).toBeGreaterThan(0);
    expect(blasts).toHaveLength(0);
  });

  it("runs people down at speed, and only nudges them aside at a crawl", () => {
    const fast = new Car(0.5, STREET, 12.5, "muscle");
    fast.rider = "driver";
    const person = new Mob("citizen", 0.5, STREET, -2.5);
    entities.push(fast, person);
    const health = person.health;
    for (let i = 0; i < 40 && person.health === health; i++) {
      fast.beginTick();
      fast.input = { forward: 1, strafe: 0, yaw: 0 };
      fast.tick(ctx());
      fast.impacts(ctx(), ctx().entitiesNear(fast.x, fast.y, fast.z, 6), players);
    }
    expect(person.health).toBeLessThan(health);

    const slow = new Car(10.5, STREET, 3.5, "sedan");
    const other = new Mob("citizen", 10.5, STREET, 1.3);
    entities.push(slow, other);
    slow.body.vz = -0.05;
    slow.impacts(ctx(), [other], players);
    expect(other.health).toBe(other.spec.health);
  });

  it("hits a player standing in the road, but not the one driving it", () => {
    const car = new Car(0.5, STREET, 0.5, "sedan");
    car.rider = "me";
    car.body.vz = -0.8;
    players = [
      { id: "me", name: "me", x: 0.5, y: STREET, z: 0.5, width: 0.6, height: 1.8, targetable: true, heldItem: -1, sneaking: false, riding: true },
      { id: "you", name: "you", x: 0.5, y: STREET, z: -1.5, width: 0.6, height: 1.8, targetable: true, heldItem: -1, sneaking: false },
    ];
    car.impacts(ctx(), [], players);
    expect(hurtPlayers.map((h) => h.id)).toEqual(["you"]);
  });

  it("is struck along its whole length, not just its middle", () => {
    const car = new Car(0.5, STREET, 0.5, "van");
    const parts = car.hitParts();
    const zs = parts.flatMap((p) => [p.box.minZ, p.box.maxZ]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(car.spec.l, 5);
  });

  it("comes back from a save or a host's snapshot as the same car", () => {
    const car = new Car(3.5, STREET, 4.5, "super", 6);
    car.health = 420;
    car.npc = true;
    const back = vehicleFromSnapshot(car.snapshot());
    expect(back).toBeInstanceOf(Car);
    const c = back as Car;
    expect([c.model, c.color, Math.round(c.health), c.npc, c.body.width]).toEqual(["super", 6, 420, true, CAR_MODELS.super.w]);
  });

  it("has a name, a price and a line of patter for every model", () => {
    for (const id of CAR_MODEL_IDS) {
      const m = CAR_MODELS[id];
      expect(m.name.length).toBeGreaterThan(2);
      expect(m.blurb.length).toBeGreaterThan(10);
      expect(m.l).toBeGreaterThan(m.w);
    }
  });
});

describe("the traffic", () => {
  it("never turns off the edge of the city", () => {
    for (const axis of ["x", "z"] as const) {
      const roads = axis === "z" ? NEON_BAY.cols : NEON_BAY.rows, crossings = axis === "z" ? NEON_BAY.rows : NEON_BAY.cols;
      for (let road = 0; road <= roads; road++) for (const dir of [1, -1] as const) for (let m = 0; m <= crossings; m++) {
        const opts = choices(city, { axis, road, dir }, m);
        expect(opts.length, `${axis} ${road} ${dir} at ${m}`).toBeGreaterThan(0);
        for (const o of opts) {
          if (!o.lane) { expect(dir === 1 ? m < crossings : m > 0).toBe(true); continue; }
          expect(o.lane.road).toBe(m);
          const beyond = axis === "z" ? NEON_BAY.cols : NEON_BAY.rows;
          expect(o.lane.dir === 1 ? road < beyond : road > 0).toBe(true);
        }
      }
    }
  });

  it("finds the junction ahead in the direction it drives", () => {
    const lane = { axis: "z" as const, road: 3, dir: 1 as const };
    const x = city.laneLine(lane), z = city.roadStart("x", 4) + 20;
    expect(nextJunction(city, lane, x, z)?.road).toBe(5);
    expect(nextJunction(city, { ...lane, dir: -1 }, city.laneLine({ ...lane, dir: -1 }), z)?.road).toBe(4);
  });

  it("drives its lane through the city and round the corners it picks, without crashing", () => {
    const { world: w, load } = cityWorld();
    world = w;
    // Always turning, it works its way north-west: the city is built out that way.
    const lane = { axis: "z" as const, road: 8, dir: 1 as const };
    const x = city.laneLine(lane), z = city.roadStart("x", 8) + 20;
    load(x - 170, z - 170, x + 50, z + 50);
    const car = new Car(x, STREET, z, "sedan");
    car.yaw = car.prevYaw = Math.PI;
    car.npc = true;
    const st = newTraffic(lane, () => 0.5);
    let offLane = 0, travelled = 0, turns = 0;
    let axis = st.lane.axis;
    // Always the last choice at a junction, which is always a turn: right, then left, round and round the blocks.
    const c = { ...ctx(), random: () => 0.99 };
    for (let i = 0; i < 900; i++) {
      trafficDrive(city, car, st, c, [], []);
      car.beginTick();
      car.tick(ctx());
      travelled += Math.hypot(car.x - car.prevX, car.z - car.prevZ);
      if (st.lane.axis !== axis) { turns++; axis = st.lane.axis; }
      const onRoad = isRoadBlock(w.blockAt(Math.floor(car.x), GROUND, Math.floor(car.z)));
      if (!onRoad) offLane++;
      if (!w.isLoaded(Math.floor(car.x) + 40, Math.floor(car.z) + 40) || !w.isLoaded(Math.floor(car.x) - 40, Math.floor(car.z) - 40)) break;
    }
    expect(travelled).toBeGreaterThan(150);
    expect(turns).toBeGreaterThanOrEqual(3);
    expect(offLane).toBe(0);
    expect(car.health).toBe(car.spec.health);
    // Whatever it chose, it is squarely on a lane now.
    const now = laneNear(city, car.x, car.z, car.yaw);
    expect(Math.abs(city.laneLine(now) - (now.axis === "z" ? car.x : car.z))).toBeLessThan(1.2);
  // It builds 220 blocks square of city before the car turns a wheel: about three and a half seconds on a fast machine,
  // which a busy CI runner stretched past the default five. The work is the test, so it gets the time.
  }, 20_000);

  it("stops for somebody standing in its lane, and sounds the horn if they stay", () => {
    // A long straight avenue down x = 0, northbound.
    const test = new City({ ...NEON_BAY, x0: -9, z0: -2000, cols: 1, rows: 100 }, 1);
    expect(test.laneLine({ axis: "z", road: 0, dir: -1 })).toBe(0);
    const car = new Car(0, STREET, 30.5, "sedan");
    car.npc = true;
    let honks = 0;
    const c = ctx();
    c.sound = (name) => { if (name === "car_horn") honks++; };
    players = [{ id: "p", name: "p", x: 0, y: STREET, z: 16.5, width: 0.6, height: 1.8, targetable: true, heldItem: -1, sneaking: false }];
    const st = newTraffic({ axis: "z", road: 0, dir: -1 }, () => 0.5);
    for (let i = 0; i < 260; i++) {
      trafficDrive(test, car, st, c, [], players);
      car.beginTick();
      car.tick(c);
    }
    expect(car.z).toBeGreaterThan(16.5 + car.spec.l / 2);
    expect(Math.abs(car.speed)).toBeLessThan(0.03);
    expect(honks).toBeGreaterThan(0);
  });
});

describe("the city's people", () => {
  it("walk the sidewalks and keep out of the road", () => {
    const { world: w, load } = cityWorld();
    world = w;
    const x = city.roadStart("z", 6) + ROAD - 1, z = city.roadStart("x", 6) + ROAD + 10;
    load(x - 60, z - 60, x + 60, z + 60);
    const walkers = [0, 1, 2, 3].map((k) => new Mob("citizen", x + 0.5, STREET, z + 0.5 + k * 6));
    entities.push(...walkers);
    let onRoad = 0;
    const walked = walkers.map(() => 0);
    for (let i = 0; i < 1200; i++) walkers.forEach((m, k) => {
      m.beginTick();
      m.tick(ctx());
      walked[k] += Math.hypot(m.x - m.prevX, m.z - m.prevZ);
      const under = w.blockAt(Math.floor(m.x), GROUND, Math.floor(m.z));
      if (under === B.BLACKSTONE) onRoad++;
    });
    expect(onRoad).toBe(0);
    for (const d of walked) expect(d).toBeGreaterThan(30);
  });

  it("drop whatever was in their wallet, and one in five fights back", () => {
    const loot = (new Mob("citizen", 0, STREET, 0) as unknown as { loot(c: EntityContext): { id: number }[] }).loot(ctx());
    expect(loot[0].id).toBe(itemByName("cash").id);
    let tough = 0;
    for (let i = 0; i < 50; i++) {
      const m = new Mob("citizen", 0.5, STREET, 0.5);
      m.hurt(ctx(), 1, "player", 3, 0, "bully");
      if (m.targetId === "bully") tough++;
      expect(m.quip).toBeTruthy();
    }
    expect(tough).toBeGreaterThanOrEqual(8);
    expect(tough).toBeLessThanOrEqual(12);
  });
});

describe("the map pack", () => {
  it("is the same city whichever worker lays it out", () => {
    expect(cityOf("neon_bay", 77)).toBe(cityOf("neon_bay", 77));
    expect(PITCH - ROAD).toBe(LOT);
  });
});

describe("Golden Coast", () => {
  const gc = new City(GOLDEN_COAST, 77);

  it("keeps every building inside its lot, and every district it names", () => {
    const seen = new Set<string>();
    for (let i = 0; i < GOLDEN_COAST.cols; i++) for (let j = 0; j < GOLDEN_COAST.rows; j++) {
      const lot = gc.lot(i, j);
      seen.add(lot.district);
      for (const b of lot.buildings) {
        expect(b.x0).toBeGreaterThanOrEqual(lot.x0);
        expect(b.z1).toBeLessThanOrEqual(lot.z0 + LOT - 1);
        expect(b.y0 + b.h).toBeLessThan(127);
      }
    }
    for (const d of ["desert", "vegas", "suburb", "downtown", "beach", "strip", "docks", "park", "villas", "little", "midtown"]) expect(seen, d).toContain(d);
  });

  it("paves its lanes clear from one end to the other, desert and all", () => {
    const out = { blocks: new Uint16Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256) };
    const x = gc.laneLine({ axis: "z", road: 11, dir: -1 });
    for (let z = gc.minZ + 2; z <= gc.maxZ - 2; z += 3) {
      gc.fill(x >> 4, z >> 4, out);
      expect(isRoadBlock(out.blocks[blockIndex(x & 15, GROUND, z & 15)]), `${x},${z}`).toBe(true);
      for (let y = STREET; y < STREET + 4; y++) expect(out.blocks[blockIndex(x & 15, y, z & 15)]).toBe(B.AIR);
    }
  });

  it("names its own police and its own streets", () => {
    expect(GOLDEN_COAST.landmarks.find((l) => l.kind === "police")?.sign).toBe("SYPD");
    expect(GOLDEN_COAST.avenues).toHaveLength(GOLDEN_COAST.cols + 1);
    expect(GOLDEN_COAST.streets).toHaveLength(GOLDEN_COAST.rows + 1);
    const layout = mapLayout("golden_coast", 77, new Generator({ seed: 77, type: "default", dimension: "overworld" }));
    expect(layout.city?.spec.id).toBe("golden_coast");
    expect(layout.casino!.length).toBeGreaterThan(20);
    expect(layout.shops!.length).toBeGreaterThan(5);
  });
});
