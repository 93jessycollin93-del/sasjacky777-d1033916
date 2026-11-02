import { describe, expect, it } from "vitest";
import { CHUNK_VOLUME } from "@/craft/engine/constants";
import { Chunk } from "@/craft/engine/chunk";
import { packChunk, unpackChunk } from "@/craft/game/save";

describe("sixteen-bit block ids", () => {
  it("saves and reads back a block id past 255 exactly, next to its meta", async () => {
    const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
    blocks[0] = 4100; blocks[1] = 65535; blocks[2] = 255; blocks[CHUNK_VOLUME - 1] = 4097;
    meta[0] = 3; meta[CHUNK_VOLUME - 1] = 200;
    const packed = await packChunk({ cx: 0, cz: 0, blocks, meta, entities: [] });
    const back = await unpackChunk(packed.data, packed.gz);
    expect(back.blocks).toBeInstanceOf(Uint16Array);
    expect([back.blocks[0], back.blocks[1], back.blocks[2], back.blocks[CHUNK_VOLUME - 1]]).toEqual([4100, 65535, 255, 4097]);
    expect([back.meta[0], back.meta[CHUNK_VOLUME - 1]]).toEqual([3, 200]);
  });

  it("still reads a chunk saved before ids were widened, one byte a block, without losing a block", async () => {
    const raw = new Uint8Array(CHUNK_VOLUME * 2);
    raw[0] = 85; raw[CHUNK_VOLUME - 1] = 255; raw[CHUNK_VOLUME] = 2;
    const back = await unpackChunk(raw, false);
    expect(back.blocks).toBeInstanceOf(Uint16Array);
    expect(back.blocks.length).toBe(CHUNK_VOLUME);
    expect(back.blocks[0]).toBe(85);
    expect(back.blocks[CHUNK_VOLUME - 1]).toBe(255);
    expect(back.meta[0]).toBe(2);
  });

  it("refuses a chunk of the wrong size with a reason, rather than reading it as blocks", async () => {
    await expect(unpackChunk(new Uint8Array(1000), false)).rejects.toThrow(/neither the old layout/);
  });

  it("will not build a chunk on a byte array, which would silently fold every id past 255", () => {
    const bytes = new Uint8Array(CHUNK_VOLUME) as unknown as Uint16Array;
    expect(() => new Chunk(0, 0, bytes, new Uint8Array(CHUNK_VOLUME), new Uint8Array(CHUNK_VOLUME), new Uint8Array(256), new Uint8Array(256 * 9)))
      .toThrow(/not a Uint16Array/);
  });
});
