import { describe, expect, it } from "vitest";
import { allBlocks, B, block, faceTexture, isCrop, CROP_MAX_AGE } from "@/craft/engine/blocks";
import { allItems, itemByName, resolveDrops } from "@/craft/engine/items";
import { paintTexture, itemTextureNames } from "@/craft/engine/textures";
import { Generator } from "@/craft/engine/worldgen";
import { blockIndex, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from "@/craft/engine/constants";
import { lightChunk, relightBlock, skyOf, blockOf } from "@/craft/engine/lighting";
import { Mesher, buildPadded } from "@/craft/engine/mesher";
import { World } from "@/craft/engine/world";
import { Chunk } from "@/craft/engine/chunk";
import { seedFromString } from "@/craft/engine/rng";
import { BIOMES } from "@/craft/engine/biomes";

function emptyChunk(cx: number, cz: number, fill?: (x: number, y: number, z: number) => number): Chunk {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  if (fill) for (let y = 0; y < WORLD_HEIGHT; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = fill(x, y, z);
  const light = lightChunk(blocks, cx, cz);
  return new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), light, new Uint8Array(256), new Uint8Array(256 * 9).fill(200));
}

describe("the art", () => {
  it("has a painted texture for every face of every block, in every state it can be in", () => {
    const missing = new Set<string>();
    for (const def of allBlocks()) {
      if (def.shape === "none") continue;
      const metas = isCrop(def.id) ? Array.from({ length: CROP_MAX_AGE[def.id] + 1 }, (_, i) => i) : [0, 1, 2, 3, 4, 8, 12];
      for (const meta of metas) {
        for (let face = 0; face < 6; face++) {
          const name = faceTexture(def, meta, face);
          if (!paintTexture(name)) missing.add(`${def.name}:${name}`);
        }
      }
      // Multi-part models (repeaters, pistons, observers) name a texture per part and state.
      if (def.boxTexture) {
        for (let meta = 0; meta < 128; meta++) {
          const parts = def.boxes ? def.boxes(meta).length : 1;
          for (let box = 0; box < parts; box++) for (let face = 0; face < 6; face++) {
            const name = def.boxTexture(meta, box, face);
            if (name && !paintTexture(name)) missing.add(`${def.name}:${name}`);
          }
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("has an icon for every item that is not drawn as a block", () => {
    const missing = allItems().filter((i) => i.icon && !paintTexture(i.icon)).map((i) => `${i.name}:${i.icon}`);
    expect(missing).toEqual([]);
    expect(itemTextureNames().length).toBeGreaterThan(80);
  });

  it("paints the dust that the mesher draws redstone with", () => {
    expect(paintTexture("redstone_dust_line")).not.toBeNull();
    expect(paintTexture("redstone_dust_dot")).not.toBeNull();
  });

  it("paints the same pixels every time, so every player sees the same world", () => {
    expect(paintTexture("cobblestone")!.data).toEqual(paintTexture("cobblestone")!.data);
  });

  it("resolves every drop table to real items", () => {
    const random = () => 0;
    for (const def of allBlocks()) {
      expect(() => resolveDrops(def.drops, def.id, random), def.name).not.toThrow();
    }
  });

  it("drops flint or gravel from gravel, never both and never nothing", () => {
    for (const roll of [0.01, 0.5, 0.99]) {
      const drops = resolveDrops(block(B.GRAVEL).drops, B.GRAVEL, () => roll);
      expect(drops).toHaveLength(1);
    }
  });
});

describe("world generation", () => {
  it("generates the same chunk twice from the same seed, whatever order chunks are visited in", () => {
    const a = new Generator({ seed: 1234, type: "default" });
    const b = new Generator({ seed: 1234, type: "default" });
    b.generate(5, 5); // visit a neighbour first: must not change the result
    b.generate(-3, 2);
    const ca = a.generate(4, 5);
    const cb = b.generate(4, 5);
    expect(Buffer.from(ca.blocks).equals(Buffer.from(cb.blocks))).toBe(true);
    expect(Buffer.from(ca.meta).equals(Buffer.from(cb.meta))).toBe(true);
  });

  it("gives different worlds for different seeds", () => {
    const a = new Generator({ seed: 1, type: "default" }).generate(0, 0);
    const b = new Generator({ seed: 2, type: "default" }).generate(0, 0);
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(false);
  });

  it("agrees across a chunk border about the trees that straddle it", () => {
    // Each chunk replays its neighbours' trees; a tree's leaves in the next
    // chunk must come out identical whether that chunk was generated alone.
    const gen = new Generator({ seed: seedFromString("forest"), type: "default" });
    let found = false;
    for (let cx = 0; cx < 12 && !found; cx++) {
      const c = gen.generate(cx, 0);
      for (let z = 0; z < 16 && !found; z++) {
        for (let y = 60; y < 110; y++) {
          const edge = c.blocks[blockIndex(15, y, z)];
          if (edge === B.OAK_LEAVES || edge === B.BIRCH_LEAVES || edge === B.SPRUCE_LEAVES) found = true;
        }
      }
      const again = new Generator({ seed: seedFromString("forest"), type: "default" }).generate(cx, 0);
      expect(Buffer.from(again.blocks).equals(Buffer.from(c.blocks))).toBe(true);
    }
  });

  it("puts bedrock at the floor and never above y=4", () => {
    const c = new Generator({ seed: 99, type: "default" }).generate(2, -7);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      expect(c.blocks[blockIndex(x, 0, z)]).toBe(B.BEDROCK);
      for (let y = 5; y < WORLD_HEIGHT; y++) expect(c.blocks[blockIndex(x, y, z)]).not.toBe(B.BEDROCK);
    }
  });

  it("fills the sea to sea level and not above", () => {
    const gen = new Generator({ seed: 7, type: "default" });
    for (let i = 0; i < 20; i++) {
      const c = gen.generate(i * 7, -i * 5);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        expect(c.blocks[blockIndex(x, SEA_LEVEL + 1, z)]).not.toBe(B.WATER);
      }
    }
  });

  it("finds diamonds deep, and never near the surface", () => {
    const gen = new Generator({ seed: 42, type: "default" });
    let diamonds = 0;
    for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) {
      const c = gen.generate(cx, cz);
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (c.blocks[i] === B.DIAMOND_ORE || c.blocks[i] === B.DS_DIAMOND) {
          diamonds++;
          expect(i >> 8).toBeLessThan(24);
        }
      }
    }
    expect(diamonds).toBeGreaterThan(0);
  });

  it("builds a superflat world four layers deep", () => {
    const c = new Generator({ seed: 1, type: "flat" }).generate(3, 3);
    expect([0, 1, 2, 3, 4].map((y) => c.blocks[blockIndex(5, y, 5)])).toEqual([B.BEDROCK, B.DIRT, B.DIRT, B.GRASS, B.AIR]);
  });

  it("offers a spawn point on dry land", () => {
    const gen = new Generator({ seed: 5, type: "default" });
    const s = gen.findSpawn();
    expect(s.y).toBeGreaterThan(SEA_LEVEL);
  });

  it("only lists biomes that exist", () => {
    BIOMES.forEach((b, i) => expect(b.id).toBe(i));
  });
});

describe("light", () => {
  it("lights open air at full sky light and a sealed room not at all", () => {
    const c = emptyChunk(0, 0, (x, y, z) => {
      if (y < 10) return B.STONE;
      // A closed stone box from y=10..14 in the middle.
      const shell = x >= 4 && x <= 10 && z >= 4 && z <= 10 && y >= 10 && y <= 14;
      const inside = x >= 5 && x <= 9 && z >= 5 && z <= 9 && y >= 11 && y <= 13;
      return shell && !inside ? B.STONE : B.AIR;
    });
    expect(skyOf(c.light[blockIndex(0, 20, 0)])).toBe(15);
    expect(skyOf(c.light[blockIndex(0, 10, 0)])).toBe(15);
    expect(skyOf(c.light[blockIndex(7, 12, 7)])).toBe(0);
  });

  it("fades a torch by one level per block and clears it again when the torch is broken", () => {
    const world = new World();
    world.addChunk(emptyChunk(0, 0, (x, y) => (y < 5 ? B.STONE : B.AIR)));
    world.setBlock(8, 5, 8, B.TORCH);
    expect(blockOf(world.getLight(8, 5, 8))).toBe(14);
    expect(blockOf(world.getLight(11, 5, 8))).toBe(11);
    expect(blockOf(world.getLight(8, 5, 2))).toBe(8);
    world.setBlock(8, 5, 8, B.AIR);
    for (const [x, z] of [[8, 8], [11, 8], [8, 2]]) expect(blockOf(world.getLight(x, 5, z))).toBe(0);
  });

  it("darkens the ground under a new roof and brightens it again when the roof comes off", () => {
    const world = new World();
    world.addChunk(emptyChunk(0, 0, (x, y) => (y < 5 ? B.STONE : B.AIR)));
    for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) world.setBlock(x, 9, z, B.STONE);
    expect(skyOf(world.getLight(7, 5, 7))).toBeLessThan(15);
    expect(skyOf(world.getLight(7, 5, 7))).toBeGreaterThan(0); // light still leaks in from the open sides
    for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) world.setBlock(x, 9, z, B.AIR);
    expect(skyOf(world.getLight(7, 5, 7))).toBe(15);
  });

  it("carries light across a chunk border once both chunks are loaded", () => {
    const world = new World();
    // A space roofed over at y=20, open to the sky only at x=14 of chunk 0 —
    // two blocks from the border, so its light has somewhere to go.
    const roofed = (open: boolean) => (x: number, y: number) => (y < 5 || (y === 20 && !(open && x === 14)) ? B.STONE : B.AIR);
    world.addChunk(emptyChunk(0, 0, roofed(true)));
    world.addChunk(emptyChunk(1, 0, roofed(false)));
    // Under the roof in chunk 1, just across the border, light arrives from chunk 0.
    expect(skyOf(world.getLight(16, 10, 5))).toBe(13);
  });
});

describe("meshing", () => {
  const layers = new Proxy({} as Record<string, number>, { get: () => 1 });
  const mesher = new Mesher((name) => layers[name]);
  const mesh = (chunks: Chunk[]) => {
    const map = new Map(chunks.map((c) => [`${c.cx},${c.cz}`, c]));
    const padded = buildPadded((cx, cz) => map.get(`${cx},${cz}`), 0, 0);
    return mesher.mesh({ ...padded, tints: chunks[0].tints, fancyLeaves: false, smoothLighting: true });
  };

  it("draws only the outside of a solid lump — no hidden faces between blocks", () => {
    const c = emptyChunk(0, 0, (x, y, z) => (x >= 4 && x < 6 && y === 10 && z === 4 ? B.STONE : B.AIR));
    const m = mesh([c]);
    expect(m.opaque.quads).toBe(10); // two cubes side by side: 12 faces minus the 2 touching
  });

  it("puts water in the translucent pass and plants in the cutout pass", () => {
    const c = emptyChunk(0, 0, (x, y, z) => (y === 4 ? B.STONE : y === 5 && x === 1 && z === 1 ? B.WATER : y === 5 && x === 3 && z === 3 ? B.POPPY : B.AIR));
    const m = mesh([c]);
    expect(m.translucent.quads).toBeGreaterThan(0);
    expect(m.cutout.quads).toBe(4); // two crossed quads, both sides
  });

  it("darkens the corners of a north face under an overhang, as it does every other face", () => {
    // A block with another jutting out above its north face. The two top
    // corners of that face sit in the overhang's shadow; the bottom two do not.
    const c = emptyChunk(0, 0, (x, y, z) => ((x === 8 && y === 10 && z === 8) || (x === 8 && y === 11 && z === 7) ? B.STONE : B.AIR));
    const m = mesh([c]).opaque;
    const shades: { y: number; shade: number }[] = [];
    for (let q = 0; q < m.quads; q++) {
      const v = [0, 1, 2, 3].map((i) => ({ x: m.positions[(q * 4 + i) * 3], y: m.positions[(q * 4 + i) * 3 + 1], z: m.positions[(q * 4 + i) * 3 + 2], shade: m.light[(q * 4 + i) * 4 + 2] }));
      if (v.every((p) => p.z === 8 * 16 && p.y <= 11 * 16)) shades.push(...v);
    }
    expect(shades).toHaveLength(4);
    const top = shades.filter((s) => s.y === 11 * 16).map((s) => s.shade);
    const bottom = shades.filter((s) => s.y === 10 * 16).map((s) => s.shade);
    expect(Math.max(...top)).toBeLessThan(Math.min(...bottom));
  });

  it("walls off a missing neighbour rather than leaving the chunk edge open to the void", () => {
    const c = emptyChunk(0, 0, (x, y) => (y < 3 ? B.STONE : B.AIR));
    const m = mesh([c]);
    // Top surface only: 256 faces. No side faces at the edges facing unloaded chunks.
    expect(m.opaque.quads).toBe(256);
  });
});

describe("items", () => {
  it("knows its tools, food and armour by name", () => {
    expect(itemByName("diamond_pickaxe").tool?.tier).toBe(3);
    expect(itemByName("cooked_beef").food?.hunger).toBe(8);
    expect(itemByName("iron_chestplate").armor?.points).toBe(6);
  });
});
