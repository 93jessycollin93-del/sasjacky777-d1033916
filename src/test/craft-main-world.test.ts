import { describe, expect, it } from "vitest";
import { CHUNK_VOLUME } from "@/craft/engine/constants";
import { ensureMainWorld, isMainWorld, MAIN_WORLD_ID, MAIN_WORLD_NAME, pristineMainWorld, resetMainWorld } from "@/craft/game/mainWorld";
import { SaveStore } from "@/craft/game/save";
import { modeDef } from "@/craft/modes";

describe("the main world", () => {
  it("is Ashgrove County, the same on every device: one seed, one start date, one place under the sky", () => {
    const a = pristineMainWorld(), b = pristineMainWorld();
    expect(a.id).toBe(MAIN_WORLD_ID);
    expect(a.name).toBe(MAIN_WORLD_NAME);
    expect(a.seed).toBe(b.seed);
    expect(a.map).toBe("county");
    expect(a.mode?.id).toBe("ashgrove");
    expect(modeDef(a.mode?.id)?.category).toBe("zombie");
    expect(a.skyEpoch).toBe(b.skyEpoch);
    expect(a.place).toEqual(b.place);
    expect(a.player).toBeNull();
  });

  it("appears in the world list by itself, made fresh the first time anyone looks", async () => {
    const saves = new SaveStore();
    expect(await saves.getWorld(MAIN_WORLD_ID)).toBeNull();
    const made = await ensureMainWorld(saves);
    expect(isMainWorld(made)).toBe(true);
    expect((await saves.listWorlds()).map((w) => w.id)).toContain(MAIN_WORLD_ID);
    // Asking again finds the one already there rather than making another.
    made.playTime = 1234;
    await saves.putWorld(made);
    expect((await ensureMainWorld(saves)).playTime).toBe(1234);
  });

  it("goes back to exactly how it began when it is deleted — nothing the player did survives the reset", async () => {
    const saves = new SaveStore();
    const world = await ensureMainWorld(saves);
    world.time = 99_000;
    world.playTime = 5_000;
    world.mode = { id: "ashgrove", started: true, data: { born: { Steve: 0 } } };
    await saves.putWorld(world);
    const blocks = new Uint16Array(CHUNK_VOLUME).fill(1);
    await saves.putChunks(MAIN_WORLD_ID, [{ cx: 0, cz: 0, blocks, meta: new Uint8Array(CHUNK_VOLUME), entities: [] }]);
    expect(await saves.getChunk(MAIN_WORLD_ID, 0, 0)).not.toBeNull();

    const fresh = await resetMainWorld(saves);
    const pristine = pristineMainWorld();
    expect(fresh.time).toBe(pristine.time);
    expect(fresh.playTime).toBe(0);
    expect(fresh.mode).toEqual(pristine.mode);
    expect(await saves.getChunk(MAIN_WORLD_ID, 0, 0)).toBeNull();
    expect((await saves.listWorlds()).filter((w) => w.id === MAIN_WORLD_ID)).toHaveLength(1);
  });

  it("is not confused with a world that merely shares its name", async () => {
    const saves = new SaveStore();
    const imported = await saves.importWorld(JSON.stringify({ format: "blockcraft-world", version: 1, meta: pristineMainWorld(), chunks: [] }));
    expect(isMainWorld(imported)).toBe(false);
    expect(imported.id).not.toBe(MAIN_WORLD_ID);
  });
});
