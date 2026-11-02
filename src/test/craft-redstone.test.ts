import { beforeEach, describe, expect, it } from "vitest";
import { B, containerSize, Face } from "@/craft/engine/blocks";
import { Chunk, newChest, type ChestEntity } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import { itemId } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { Redstone, type RedstoneContext } from "@/craft/engine/redstone";
import { World } from "@/craft/engine/world";

/** A stone floor up to y=10 and nothing above it, three chunks by three. */
function floorWorld(): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

let world: World;
let rs: Redstone;
let primed: [number, number, number][];

function ctx(w: World): RedstoneContext {
  return {
    sound: () => {}, particles: () => {}, dropItems: () => {},
    primeTnt: (x, y, z) => primed.push([x, y, z]),
    bodies: () => [], takeItemsIn: () => {}, dispense: () => undefined, dropOne: () => {},
    sunlight: () => 1, containerChanged: () => {},
    ensureContainer: (x, y, z) => {
      const e = newChest(containerSize(w.blockAt(x, y, z)));
      w.setEntity(x, y, z, e);
      return e;
    },
  };
}

function run(ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    rs.step(world.tick);
  }
}

const set = (x: number, y: number, z: number, id: number, meta = 0) => world.setBlock(x, y, z, id, meta, "player");
const at = (x: number, y: number, z: number) => world.blockAt(x, y, z);
const level = (x: number, y: number, z: number) => world.getMeta(x, y, z) & 15;

beforeEach(() => {
  world = floorWorld();
  rs = new Redstone(world, ctx(world));
  world.onChange((c) => rs.onChange(c));
  primed = [];
});

describe("redstone", () => {
  it("carries a lever's power down a line of dust, one level lost per block, and lights a lamp at the end", () => {
    set(0, 11, 0, B.LEVER, Face.Down | 8);
    for (let x = 1; x <= 5; x++) set(x, 11, 0, B.REDSTONE_WIRE);
    set(6, 11, 0, B.REDSTONE_LAMP);
    run(2);
    expect([1, 2, 3, 4, 5].map((x) => level(x, 11, 0))).toEqual([15, 14, 13, 12, 11]);
    expect(at(6, 11, 0)).toBe(B.REDSTONE_LAMP_ON);
  });

  it("turns the lamp off a moment after the lever is flicked off, not instantly", () => {
    set(0, 11, 0, B.LEVER, Face.Down | 8);
    set(1, 11, 0, B.REDSTONE_WIRE);
    set(2, 11, 0, B.REDSTONE_LAMP);
    run(2);
    set(0, 11, 0, B.LEVER, Face.Down);
    run(1);
    expect(level(1, 11, 0)).toBe(0);
    expect(at(2, 11, 0)).toBe(B.REDSTONE_LAMP_ON);
    run(5);
    expect(at(2, 11, 0)).toBe(B.REDSTONE_LAMP);
  });

  it("switches off a torch whose block is powered, a redstone tick later", () => {
    set(0, 11, 0, B.STONE);
    set(1, 11, 0, B.REDSTONE_TORCH, 1 + 3); // on the east face of the block
    set(0, 12, 0, B.LEVER, Face.Down); // on top of the block, off
    run(3);
    expect(at(1, 11, 0)).toBe(B.REDSTONE_TORCH);
    set(0, 12, 0, B.LEVER, Face.Down | 8);
    run(1);
    expect(at(1, 11, 0)).toBe(B.REDSTONE_TORCH);
    run(2);
    expect(at(1, 11, 0)).toBe(B.REDSTONE_TORCH_OFF);
  });

  it("does not let dust power more dust through the block it points into", () => {
    // Dust at level 15 points east into a stone block; dust on the far side must stay dark.
    set(0, 11, 0, B.REDSTONE_BLOCK);
    set(1, 11, 0, B.REDSTONE_WIRE);
    set(2, 11, 0, B.STONE);
    set(3, 11, 0, B.REDSTONE_WIRE);
    run(2);
    expect(level(1, 11, 0)).toBe(15);
    expect(level(3, 11, 0)).toBe(0);
  });

  it("restores a weak signal to full strength after the repeater's delay", () => {
    set(0, 11, 0, B.LEVER, Face.Down);
    for (let x = 1; x <= 14; x++) set(x, 11, 0, B.REDSTONE_WIRE);
    set(15, 11, 0, B.REPEATER, 3); // facing east, delay 1
    set(16, 11, 0, B.REDSTONE_WIRE);
    run(2);
    set(0, 11, 0, B.LEVER, Face.Down | 8);
    run(1);
    expect(level(14, 11, 0)).toBe(2);
    expect(level(16, 11, 0)).toBe(0);
    run(2);
    expect(level(16, 11, 0)).toBe(15);
  });

  it("pushes a row of blocks with a piston and pulls one back with a sticky piston", () => {
    set(0, 11, 0, B.PISTON, Face.East);
    set(1, 11, 0, B.DIRT);
    set(2, 11, 0, B.COBBLE);
    set(0, 12, 0, B.LEVER, Face.Down | 8); // on top of the piston
    run(3);
    expect(at(1, 11, 0)).toBe(B.PISTON_HEAD);
    expect([at(2, 11, 0), at(3, 11, 0)]).toEqual([B.DIRT, B.COBBLE]);

    set(0, 11, 4, B.STICKY_PISTON, Face.East);
    set(1, 11, 4, B.DIRT);
    set(0, 12, 4, B.LEVER, Face.Down | 8);
    run(3);
    expect(at(2, 11, 4)).toBe(B.DIRT);
    set(0, 12, 4, B.LEVER, Face.Down);
    run(3);
    expect(at(1, 11, 4)).toBe(B.DIRT);
    expect(at(2, 11, 4)).toBe(B.AIR);
  });

  it("carries the blocks stuck to a slime block, but cannot shove one glued to the ground", () => {
    // Glued: the slime drags the floor under it, and the floor is a row far longer than twelve.
    set(0, 11, 0, B.STICKY_PISTON, Face.East);
    set(1, 11, 0, B.SLIME_BLOCK);
    set(-1, 11, 0, B.REDSTONE_BLOCK);
    run(3);
    expect(world.getMeta(0, 11, 0) & 8).toBe(0);
    expect(at(1, 11, 0)).toBe(B.SLIME_BLOCK);

    // Held up off the floor, it moves and takes the planks resting on it along.
    set(0, 13, 4, B.STICKY_PISTON, Face.East);
    set(1, 13, 4, B.SLIME_BLOCK);
    set(1, 14, 4, B.OAK_PLANKS);
    set(-1, 13, 4, B.REDSTONE_BLOCK);
    run(3);
    expect(world.getMeta(0, 13, 4) & 8).toBe(8);
    expect([at(2, 13, 4), at(2, 14, 4), at(1, 14, 4)]).toEqual([B.SLIME_BLOCK, B.OAK_PLANKS, B.AIR]);
  });

  it("refuses to push obsidian, or more than twelve blocks", () => {
    set(0, 11, 0, B.PISTON, Face.East);
    set(1, 11, 0, B.OBSIDIAN);
    set(0, 12, 0, B.LEVER, Face.Down | 8);
    run(3);
    expect(at(1, 11, 0)).toBe(B.OBSIDIAN);
    expect(world.getMeta(0, 11, 0) & 8).toBe(0);

    set(0, 11, 5, B.PISTON, Face.East);
    for (let x = 1; x <= 13; x++) set(x, 11, 5, B.DIRT);
    set(0, 12, 5, B.LEVER, Face.Down | 8);
    run(3);
    expect(at(1, 11, 5)).toBe(B.DIRT);
  });

  it("breaks plants and dust in a piston's way instead of refusing to move", () => {
    set(0, 11, 0, B.PISTON, Face.East);
    set(1, 11, 0, B.DIRT);
    set(2, 11, 0, B.POPPY);
    set(0, 12, 0, B.LEVER, Face.Down | 8);
    run(3);
    expect(at(2, 11, 0)).toBe(B.DIRT);
  });

  it("sends a short pulse out of an observer's back when the block it watches changes", () => {
    set(0, 11, 0, B.OBSERVER, Face.East); // watches x=1
    set(-1, 11, 0, B.REDSTONE_WIRE);
    run(2);
    set(1, 11, 0, B.DIRT);
    let lit = 0;
    for (let i = 0; i < 8; i++) { run(1); if (level(-1, 11, 0) > 0) lit++; }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(5);
    expect(level(-1, 11, 0)).toBe(0);
  });

  it("primes TNT when it is powered", () => {
    set(0, 11, 0, B.TNT);
    set(1, 11, 0, B.LEVER, Face.Down | 8);
    run(1);
    expect(at(0, 11, 0)).toBe(B.AIR);
    expect(primed).toEqual([[0, 11, 0]]);
  });

  it("opens an iron door only with power", () => {
    set(0, 11, 0, B.IRON_DOOR, 0);
    set(0, 12, 0, B.IRON_DOOR, 8);
    set(1, 11, 0, B.STONE_BUTTON, Face.Down);
    run(2);
    expect(world.getMeta(0, 11, 0) & 4).toBe(0);
    set(1, 11, 0, B.STONE_BUTTON, Face.Down | 8);
    run(1);
    expect(world.getMeta(0, 11, 0) & 4).toBe(4);
    // The stone button pops back out after a second, and the door closes.
    run(22);
    expect(world.getMeta(1, 11, 0) & 8).toBe(0);
    expect(world.getMeta(0, 11, 0) & 4).toBe(0);
  });

  it("moves items from a chest above a hopper into a chest below it", () => {
    set(0, 13, 0, B.CHEST);
    set(0, 12, 0, B.HOPPER, Face.Down);
    set(0, 11, 0, B.CHEST);
    const top = newChest(27);
    top.items[0] = { id: itemId("cobblestone"), count: 3 };
    world.setEntity(0, 13, 0, top);
    world.setEntity(0, 11, 0, newChest(27));
    run(80);
    const bottom = world.getEntity(0, 11, 0) as ChestEntity;
    expect(bottom.items[0]).toEqual({ id: itemId("cobblestone"), count: 3 });
    expect(top.items[0]).toBeNull();
  });

  it("reads how full a chest is with a comparator", () => {
    set(0, 11, 0, B.CHEST);
    const chest = newChest(27);
    for (let i = 0; i < 14; i++) chest.items[i] = { id: itemId("cobblestone"), count: 64 };
    world.setEntity(0, 11, 0, chest);
    set(1, 11, 0, B.COMPARATOR, 3); // facing east, the chest behind it
    set(2, 11, 0, B.REDSTONE_WIRE);
    run(4);
    expect((world.getMeta(1, 11, 0) >> 3) & 15).toBe(Math.floor(1 + (14 / 27) * 14));
    expect(level(2, 11, 0)).toBe(Math.floor(1 + (14 / 27) * 14));
  });

  it("burns out a torch that is flicked on and off too fast, then relights once it has rested", () => {
    set(0, 11, 0, B.STONE);
    set(1, 11, 0, B.REDSTONE_TORCH, 1 + 3);
    run(3);
    for (let i = 0; i < 10; i++) {
      set(0, 12, 0, B.LEVER, Face.Down | 8);
      run(3);
      set(0, 12, 0, B.LEVER, Face.Down);
      run(3);
    }
    // Unpowered now, but burnt out: it stays dark for a while.
    run(20);
    expect(at(1, 11, 0)).toBe(B.REDSTONE_TORCH_OFF);
    run(200);
    expect(at(1, 11, 0)).toBe(B.REDSTONE_TORCH);
  });
});
