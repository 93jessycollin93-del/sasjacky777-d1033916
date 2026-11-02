import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configureEdition } from "@/craft/edition";
import { cloudAvailable, deleteCloudWorld, downloadWorld, explainCloudError, listCloudWorlds, NO_CLOUD, uploadWorld } from "@/craft/game/cloud";
import { newWorldMeta, SaveStore } from "@/craft/game/save";
import { CHUNK_VOLUME } from "@/craft/engine/constants";

// A stand-in for the Supabase client: a signed-in (or not) session, and a
// craft_worlds table that is one in-memory map of rows.
const state = {
  user: "user-1" as string | null,
  rows: new Map<string, Record<string, unknown>>(),
  fail: null as { message: string; code?: string } | null,
};

const result = <T>(data: T) => Promise.resolve(state.fail ? { data: null, error: state.fail } : { data, error: null });
const fakeClient = {
  auth: { getSession: async () => ({ data: { session: state.user ? { user: { id: state.user } } : null } }) },
  from: () => ({
    select: () => ({
      order: () => result([...state.rows.values()]),
      eq: (_c: string, id: string) => ({ maybeSingle: () => result(state.rows.get(id) ?? null) }),
    }),
    upsert: (row: Record<string, unknown>) => {
      if (!state.fail) state.rows.set(row.id as string, { ...row, updated_at: new Date().toISOString() });
      return result(null);
    },
    delete: () => ({ eq: (_c: string, id: string) => { if (!state.fail) state.rows.delete(id); return result(null); } }),
  }),
};

function world(name = "Home") {
  return newWorldMeta({ name, seed: 42, seedText: "42", type: "default", gameMode: "survival", difficulty: 2, hardcore: false, cheats: false });
}

describe("cloud worlds", () => {
  beforeEach(() => {
    // As the SAS-JACKY page sets it up: the app's client, signed in, with cloud saves.
    configureEdition({ kind: "sas-jacky", online: fakeClient as unknown as SupabaseClient, cloud: true });
    state.user = "user-1";
    state.rows.clear();
    state.fail = null;
  });

  it("round-trips a world through the cloud onto a device that has never seen it", async () => {
    const here = new SaveStore();
    const meta = world();
    await here.putWorld(meta);
    const blocks = new Uint16Array(CHUNK_VOLUME).fill(1);
    await here.putChunks(meta.id, [{ cx: 3, cz: -2, blocks, meta: new Uint8Array(CHUNK_VOLUME), entities: [] }]);

    const up = await uploadWorld(here, meta);
    expect(up.error).toBeUndefined();

    const there = new SaveStore();
    const listed = await listCloudWorlds();
    expect(listed.value?.map((w) => w.name)).toEqual(["Home"]);

    const down = await downloadWorld(there, meta.id);
    expect(down.error).toBeUndefined();
    expect(down.value?.id).toBe(meta.id);
    const chunk = await there.getChunk(meta.id, 3, -2);
    expect(chunk?.blocks[100]).toBe(1);
  });

  it("replaces this device's copy of the same world instead of adding a second", async () => {
    const saves = new SaveStore();
    const meta = world();
    await saves.putWorld(meta);
    await uploadWorld(saves, meta);
    await downloadWorld(saves, meta.id);
    const worlds = await saves.listWorlds();
    expect(worlds.map((w) => w.name)).toEqual(["Home"]);
    expect(worlds[0].id).toBe(meta.id);
  });

  it("answers a signed-out player with a sentence, not an exception", async () => {
    state.user = null;
    const v = await listCloudWorlds();
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/Sign in/);
  });

  it("says the server has no cloud saves yet when the table was never deployed", async () => {
    state.fail = { message: 'relation "public.craft_worlds" does not exist', code: "42P01" };
    const v = await listCloudWorlds();
    expect(v.error).toMatch(/supabase db push/);
    expect(v.error).toMatch(/unaffected/);
  });

  it("keeps the local world when the upload is refused", async () => {
    const saves = new SaveStore();
    const meta = world();
    await saves.putWorld(meta);
    state.fail = { message: "Failed to fetch" };
    const v = await uploadWorld(saves, meta);
    expect(v.error).toMatch(/Could not reach the cloud/);
    expect((await saves.listWorlds()).map((w) => w.id)).toEqual([meta.id]);
  });

  it("removes only the cloud copy", async () => {
    const saves = new SaveStore();
    const meta = world();
    await saves.putWorld(meta);
    await uploadWorld(saves, meta);
    expect((await deleteCloudWorld(meta.id)).ok).toBe(true);
    expect((await listCloudWorlds()).value).toEqual([]);
    expect((await saves.listWorlds()).length).toBe(1);
  });

  it("names a network failure as the network, and an unknown one in the server's words", () => {
    expect(explainCloudError("TypeError: Failed to fetch")).toMatch(/connection/);
    expect(explainCloudError("something odd")).toBe("The cloud refused: something odd");
  });

  it("tells the solo copy's player where cloud saves live instead of asking them to sign in", async () => {
    configureEdition({ kind: "standalone", online: null, cloud: false });
    expect(cloudAvailable()).toBe(false);
    const saves = new SaveStore();
    const meta = world();
    await saves.putWorld(meta);
    for (const v of [await listCloudWorlds(), await uploadWorld(saves, meta), await downloadWorld(saves, meta.id), await deleteCloudWorld(meta.id)]) {
      expect(v.ok).toBe(false);
      expect(v.error).toBe(NO_CLOUD);
    }
    expect(NO_CLOUD).toMatch(/Export/);
    expect(state.rows.size).toBe(0);
  });
});
