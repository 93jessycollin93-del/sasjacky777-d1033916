import { beforeEach, describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { Chunk, newChest } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import type { EntityContext, PlayerRef } from "@/craft/engine/entities";
import { itemId, type ItemStack } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { neighboursToReshape, placedShape, railChainPowered, RailShape } from "@/craft/engine/rails";
import { Redstone, type Body } from "@/craft/engine/redstone";
import { Boat, Minecart } from "@/craft/engine/vehicles";
import { World } from "@/craft/engine/world";

/** Stone up to y=10, and a pool of water 8×8 two deep at y=9..10 in the corner. */
function testWorld(): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.STONE;
    if (cx === 1 && cz === 1) for (let y = 9; y <= 10; y++) for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) blocks[blockIndex(x, y, z)] = B.WATER;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

let world: World;
let dropped: ItemStack[];
let explosions: number;
let players: PlayerRef[];

const ctx = (): EntityContext => ({
  world, tick: 0, daylight: 1, difficulty: 2, random: Math.random, players: () => players,
  hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {},
  dropItem: (_x, _y, _z, s) => { dropped.push(s); },
  explode: () => { explosions++; }, sound: () => {}, particles: () => {}, entitiesNear: () => [], placeBlock: () => true,
});

const get = (x: number, y: number, z: number) => world.blockAt(x, y, z);
const meta = (x: number, y: number, z: number) => world.getMeta(x, y, z);
const set = (x: number, y: number, z: number, id: number, m = 0) => world.setBlock(x, y, z, id, m, "player");

/** Places a plain rail the way a player's click does: shaped, with its neighbours turned to meet it. */
function lay(x: number, y: number, z: number, id: number = B.RAIL): void {
  set(x, y, z, id, placedShape(get, meta, id, x, y, z));
  for (const [nx, ny, nz, nm] of neighboursToReshape(get, meta, x, y, z)) set(nx, ny, nz, get(nx, ny, nz), nm);
}

function run(v: Boat | Minecart, ticks: number): void {
  for (let i = 0; i < ticks; i++) { v.beginTick(); v.tick(ctx()); }
}

beforeEach(() => {
  world = testWorld();
  dropped = [];
  explosions = 0;
  players = [];
});

describe("laying track", () => {
  it("lines a new rail up with the track it touches", () => {
    lay(0, 11, 0);
    lay(1, 11, 0);
    expect(meta(0, 11, 0)).toBe(RailShape.EastWest);
    expect(meta(1, 11, 0)).toBe(RailShape.EastWest);
  });

  it("turns a corner into a curve", () => {
    lay(0, 11, 0);
    lay(1, 11, 0);
    lay(0, 11, 1);
    // (0,0) now joins east and south.
    expect(meta(0, 11, 0)).toBe(RailShape.SouthEast);
    expect(meta(0, 11, 1)).toBe(RailShape.NorthSouth);
  });

  it("climbs toward track a block higher", () => {
    set(1, 11, 0, B.STONE);
    lay(1, 12, 0);
    lay(0, 11, 0);
    expect(meta(0, 11, 0)).toBe(RailShape.AscendingEast);
  });

  it("never curves a powered rail", () => {
    lay(0, 11, 0, B.POWERED_RAIL);
    lay(1, 11, 0);
    lay(0, 11, 1);
    expect(meta(0, 11, 0) & 7).not.toBeGreaterThan(5);
  });
});

describe("power along rails", () => {
  it("carries power eight rails from a lever, and no further", () => {
    for (let x = 0; x <= 10; x++) set(x, 11, 0, B.POWERED_RAIL, RailShape.EastWest);
    set(-1, 11, 0, B.STONE);
    const direct = (x: number, y: number, z: number) => x === 0 && y === 11 && z === 0;
    expect(railChainPowered(get, meta, direct, 8, 11, 0)).toBe(true);
    expect(railChainPowered(get, meta, direct, 9, 11, 0)).toBe(false);
  });

  it("switches a detector rail on under a cart and off when it leaves", () => {
    const bodies: Body[] = [];
    const rs = new Redstone(world, {
      sound: () => {}, particles: () => {}, dropItems: () => {}, primeTnt: () => {}, bodies: () => bodies,
      takeItemsIn: () => {}, dispense: () => undefined, dropOne: () => {}, sunlight: () => 1, containerChanged: () => {},
      ensureContainer: (x, y, z) => { const e = newChest(27); world.setEntity(x, y, z, e); return e; },
    });
    world.onChange((c) => rs.onChange(c));
    set(0, 11, 0, B.DETECTOR_RAIL, RailShape.EastWest);
    set(1, 11, 0, B.REDSTONE_LAMP);
    const tick = (n: number) => { for (let i = 0; i < n; i++) { world.tick++; rs.step(world.tick); } };
    bodies.push({ x: 0.5, y: 11.0625, z: 0.5, width: 0.98, height: 0.7, mob: false, cart: true, move: () => {} });
    tick(3);
    expect(meta(0, 11, 0) & 8).toBe(8);
    expect(get(1, 11, 0)).toBe(B.REDSTONE_LAMP_ON);
    bodies.length = 0;
    tick(40);
    expect(meta(0, 11, 0) & 8).toBe(0);
  });

  it("does not let a pressure-plate walker trip a detector rail", () => {
    const bodies: Body[] = [{ x: 0.5, y: 11, z: 0.5, width: 0.6, height: 1.8, mob: true, move: () => {} }];
    const rs = new Redstone(world, {
      sound: () => {}, particles: () => {}, dropItems: () => {}, primeTnt: () => {}, bodies: () => bodies,
      takeItemsIn: () => {}, dispense: () => undefined, dropOne: () => {}, sunlight: () => 1, containerChanged: () => {},
      ensureContainer: (x, y, z) => { const e = newChest(27); world.setEntity(x, y, z, e); return e; },
    });
    world.onChange((c) => rs.onChange(c));
    set(0, 11, 0, B.DETECTOR_RAIL, RailShape.EastWest);
    for (let i = 0; i < 5; i++) { world.tick++; rs.step(world.tick); }
    expect(meta(0, 11, 0) & 8).toBe(0);
  });
});

describe("minecarts", () => {
  it("rolls along straight track, slowing as it goes", () => {
    for (let x = 0; x < 30; x++) set(x, 11, 0, B.RAIL, RailShape.EastWest);
    const cart = new Minecart("minecart", 0.5, 11.0625, 0.5);
    cart.body.vx = 0.3;
    run(cart, 20);
    expect(cart.x).toBeGreaterThan(3);
    expect(cart.z).toBeCloseTo(0.5);
    expect(Math.abs(cart.body.vx)).toBeLessThan(0.3);
  });

  it("follows a curve round the corner", () => {
    for (let z = 1; z <= 6; z++) set(0, 11, z, B.RAIL, RailShape.NorthSouth);
    set(0, 11, 0, B.RAIL, RailShape.SouthEast);
    for (let x = 1; x <= 8; x++) set(x, 11, 0, B.RAIL, RailShape.EastWest);
    // An empty cart at this speed coasts about six blocks: five north, then round the bend.
    const cart = new Minecart("minecart", 0.5, 11.0625, 5.5);
    cart.body.vz = -0.3;
    run(cart, 40);
    expect(cart.x).toBeGreaterThan(1);
    expect(cart.z).toBeCloseTo(0.5, 1);
    expect(cart.body.vx).toBeGreaterThan(0);
  });

  it("is sped up by powered rails and brought to a stop by unpowered ones", () => {
    for (let x = 0; x < 40; x++) set(x, 11, 0, B.POWERED_RAIL, RailShape.EastWest | 8);
    const cart = new Minecart("minecart", 0.5, 11.0625, 0.5);
    cart.body.vx = 0.05;
    run(cart, 30);
    expect(cart.body.vx).toBeCloseTo(0.4, 1);

    for (let x = 0; x < 20; x++) set(x, 11, 2, B.POWERED_RAIL, RailShape.EastWest);
    const slow = new Minecart("minecart", 0.5, 11.0625, 2.5);
    slow.body.vx = 0.3;
    run(slow, 20);
    expect(slow.body.vx).toBe(0);
  });

  it("rolls down a slope from a standstill", () => {
    // A one-block hill to the east: flat track on top, a slope down to the west, flat track below.
    set(2, 11, 0, B.STONE);
    set(2, 12, 0, B.RAIL, RailShape.EastWest);
    set(1, 11, 0, B.RAIL, RailShape.AscendingEast);
    for (let x = 0; x >= -6; x--) set(x, 11, 0, B.RAIL, RailShape.EastWest);
    const cart = new Minecart("minecart", 1.8, 11.9, 0.5);
    run(cart, 60);
    expect(cart.x).toBeLessThan(0);
  });

  it("stops at a wall at the end of the line", () => {
    for (let x = 0; x < 4; x++) set(x, 11, 0, B.RAIL, RailShape.EastWest);
    set(4, 11, 0, B.STONE);
    const cart = new Minecart("minecart", 0.5, 11.0625, 0.5);
    cart.body.vx = 0.4;
    run(cart, 40);
    expect(cart.x).toBeLessThan(4);
  });

  it("lights a TNT cart that crosses a powered activator rail", () => {
    set(0, 11, 0, B.RAIL, RailShape.EastWest);
    set(1, 11, 0, B.ACTIVATOR_RAIL, RailShape.EastWest | 8);
    for (let x = 2; x < 8; x++) set(x, 11, 0, B.RAIL, RailShape.EastWest);
    const cart = new Minecart("tnt_minecart", 0.5, 11.0625, 0.5);
    cart.body.vx = 0.2;
    run(cart, 20);
    expect(cart.fuse).toBeGreaterThan(0);
    run(cart, 90);
    expect(explosions).toBe(1);
  });

  it("throws its rider out on a powered activator rail", () => {
    set(0, 11, 0, B.ACTIVATOR_RAIL, RailShape.EastWest | 8);
    const cart = new Minecart("minecart", 0.5, 11.0625, 0.5);
    cart.rider = "p";
    run(cart, 1);
    expect(cart.rider).toBeNull();
  });
});

describe("boats", () => {
  it("floats up to the surface of the water", () => {
    const boat = new Boat(20.5, 9.2, 20.5);
    run(boat, 60);
    expect(boat.y).toBeGreaterThan(10.4);
    expect(boat.y).toBeLessThan(11.1);
  });

  it("goes where its rider steers on water, and hardly at all on land", () => {
    // Heading north across the pool, with room to spare before its far edge.
    const boat = new Boat(20.5, 10.8, 22.5);
    boat.rider = "p";
    boat.input = { forward: 1, strafe: 0, yaw: 0 };
    run(boat, 20);
    const onWater = 22.5 - boat.z;
    expect(onWater).toBeGreaterThan(2);

    const landed = new Boat(-5.5, 11, -5.5);
    landed.rider = "p";
    landed.input = { forward: 1, strafe: 0, yaw: 0 };
    run(landed, 20);
    expect(-5.5 - landed.z).toBeLessThan(onWater / 3);
  });

  it("turns with A and D", () => {
    const boat = new Boat(20.5, 10.9, 20.5);
    boat.rider = "p";
    boat.input = { forward: 0, strafe: 1, yaw: 0 };
    run(boat, 10);
    expect(boat.yaw).toBeLessThan(0);
  });

  it("breaks after a few blows and drops itself, but breaks at once for a creative player", () => {
    const boat = new Boat(0.5, 11, 0.5, 2);
    players = [{ id: "s", name: "S", x: 0, y: 11, z: 0, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false }];
    for (let i = 0; i < 5 && !boat.removed; i++) boat.hurt(ctx(), 1, "player", 0, 0, "s");
    expect(boat.removed).toBe(true);
    expect(dropped).toEqual([{ id: itemId("birch_boat"), count: 1 }]);

    dropped = [];
    const cart = new Minecart("minecart", 0.5, 11, 3.5);
    players = [{ id: "c", name: "C", x: 0, y: 11, z: 3, width: 0.6, height: 1.8, targetable: false, heldItem: 0, sneaking: false }];
    cart.hurt(ctx(), 1, "player", 0, 0, "c");
    expect(cart.removed).toBe(true);
    expect(dropped).toEqual([]);
  });

  it("keeps its wood and rider through a snapshot", () => {
    const boat = new Boat(0.5, 11, 0.5, 3);
    boat.rider = "p";
    const s = boat.snapshot();
    const copy = new Boat(0, 0, 0);
    copy.applySnapshot(s);
    expect(copy.wood).toBe(3);
    expect(copy.rider).toBe("p");
  });
});
