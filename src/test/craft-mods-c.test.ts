import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { CHUNK_VOLUME, blockIndex } from "@/craft/engine/constants";
import { cookingRecipe, cookingResult, heatedBy, POT_BOWL } from "@/craft/engine/cooking";
import { DUNGEON_REGION, dungeonLoot, dungeonsInRegion, dungeonsTouching, stampDungeon, type Dungeon } from "@/craft/engine/dungeons";
import type { EntityContext, PlayerRef } from "@/craft/engine/entities";
import { itemId, itemDef } from "@/craft/engine/items";
import { Mob, WOLF_FOOD } from "@/craft/engine/mobs";
import { recipesFor } from "@/craft/engine/recipeIndex";
import { pickWildlife } from "@/craft/engine/wildlife";
import { World } from "@/craft/engine/world";
import { Chunk } from "@/craft/engine/chunk";
import { lightChunk } from "@/craft/engine/lighting";

/** Finds the first region, from the origin outward, whose dungeons include one of `kind`. */
function firstDungeon(seed: number, kind: Dungeon["kind"]): Dungeon {
  for (let r = 0; r < 20; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    const d = dungeonsInRegion(seed, rx, rz).find((x) => x.kind === kind);
    if (d) return d;
  }
  throw new Error(`no ${kind}`);
}

describe("dungeons", () => {
  it("places the same catacombs for the same seed, and different ones for another", () => {
    const a = firstDungeon(7, "catacombs"), b = firstDungeon(7, "catacombs");
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
    const c = firstDungeon(8, "catacombs");
    expect([c.x, c.z]).not.toEqual([a.x, a.z]);
  });

  it("keeps each dungeon inside its region, so a chunk only asks its own", () => {
    for (let rx = -3; rx <= 3; rx++) for (let rz = -3; rz <= 3; rz++) {
      for (const d of dungeonsInRegion(42, rx, rz)) {
        const [x0, z0, x1, z1] = d.bounds;
        expect(Math.floor(x0 / DUNGEON_REGION)).toBe(rx);
        expect(Math.floor(x1 / DUNGEON_REGION)).toBe(rx);
        expect(Math.floor(z0 / DUNGEON_REGION)).toBe(rz);
        expect(Math.floor(z1 / DUNGEON_REGION)).toBe(rz);
      }
    }
  });

  it("gives catacombs two spawners of the undead, chests, and rooms of air joined by doorways", () => {
    const d = firstDungeon(3, "catacombs");
    expect(d.spawners).toHaveLength(2);
    expect(d.chests.length).toBeGreaterThanOrEqual(2);
    const all = [...d.blocks.values()].flat();
    let air = 0, spawners = 0;
    for (let i = 0; i < all.length; i += 5) {
      if (all[i + 3] === B.AIR) air++;
      if (all[i + 3] === B.SPAWNER) { spawners++; expect([1, 2]).toContain(all[i + 4]); }
    }
    expect(spawners).toBe(2);
    expect(air).toBeGreaterThan(16 * 16 * 3);
  });

  it("strings a spider cave with cobweb round a spider spawner", () => {
    const d = firstDungeon(5, "spider_cave");
    const all = [...d.blocks.values()].flat();
    const ids = new Map<number, number>();
    for (let i = 0; i < all.length; i += 5) ids.set(all[i + 3], (ids.get(all[i + 3]) ?? 0) + 1);
    expect(ids.get(B.COBWEB) ?? 0).toBeGreaterThan(20);
    expect(d.spawners).toHaveLength(1);
    const [sx, sy, sz] = d.spawners[0];
    const k = `${sx >> 4},${sz >> 4}`;
    const list = d.blocks.get(k)!;
    let meta = -1;
    for (let i = 0; i < list.length; i += 5) if (list[i] === sx && list[i + 1] === sy && list[i + 2] === sz && list[i + 3] === B.SPAWNER) meta = list[i + 4];
    expect(meta).toBe(3);
  });

  it("digs a catacomb's ladder shaft up to the surface of its chunk", () => {
    const d = firstDungeon(3, "catacombs");
    const [sx, sz] = d.shaft!;
    const cx = sx >> 4, cz = sz >> 4;
    const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y <= 64; y++) blocks[blockIndex(x, y, z)] = B.STONE;
    for (const t of dungeonsTouching(3, cx, cz)) stampDungeon(t, blocks, meta, cx, cz);
    const lx = sx & 15, lz = sz & 15;
    for (let y = d.y + 6; y <= 64; y++) expect(blocks[blockIndex(lx, y, lz)]).toBe(B.LADDER);
    expect(blocks[blockIndex(lx, 66, lz)]).toBe(B.AIR);
    expect(blocks[blockIndex(lx + 1, 66, lz)]).toBe(B.MOSSY_COBBLE);
  });

  it("stocks catacomb chests with grave goods", () => {
    const items = new Array(27).fill(null);
    dungeonLoot(items, 99, "catacombs");
    expect(items.filter(Boolean).length).toBeGreaterThan(2);
  });
});

describe("cooking pot", () => {
  const stack = (name: string, count = 1) => ({ id: itemId(name), count });

  it("makes beef stew from its ingredients in any order, served in a bowl", () => {
    const grid = [stack("potato"), null, stack("beef"), null, stack("carrot"), null, stack("bowl")];
    expect(cookingRecipe(grid)?.id).toBe("beef_stew");
    expect(cookingResult(grid)?.id).toBe(itemId("beef_stew"));
  });

  it("needs exactly the recipe: nothing extra, nothing missing, and a bowl", () => {
    expect(cookingRecipe([stack("beef"), stack("carrot"), null, null, null, null, null])).toBeNull();
    expect(cookingRecipe([stack("beef"), stack("carrot"), stack("potato"), stack("dirt"), null, null, null])).toBeNull();
    const noBowl = [stack("beef"), stack("carrot"), stack("potato"), null, null, null, null];
    expect(cookingResult(noBowl)).toBeNull();
    noBowl[POT_BOWL] = stack("stick");
    expect(cookingResult(noBowl)).toBeNull();
  });

  it("cooks only over heat", () => {
    expect(heatedBy(B.FIRE)).toBe(true);
    expect(heatedBy(B.LIT_FURNACE)).toBe(true);
    expect(heatedBy(B.MAGMA_BLOCK)).toBe(true);
    expect(heatedBy(B.FURNACE)).toBe(false);
    expect(heatedBy(B.STONE)).toBe(false);
  });

  it("feeds better than the parts, and gives the bowl back", () => {
    const stew = itemDef(itemId("beef_stew"))!.food!;
    expect(stew.hunger).toBeGreaterThan(3 + 3 + 1);
    expect(stew.remainder).toBe("bowl");
  });

  it("shows its meals in the recipe viewer", () => {
    expect(recipesFor(itemId("hearty_stew")).some((r) => r.kind === "cooking")).toBe(true);
  });
});

describe("wildlife", () => {
  function world(): World {
    const w = new World();
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
      const blocks = new Uint16Array(CHUNK_VOLUME);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y <= 10; y++) blocks[blockIndex(x, y, z)] = B.STONE;
      w.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
    }
    return w;
  }
  function ctxFor(w: World, players: PlayerRef[], entities: Mob[], random = () => 0.1): EntityContext {
    return {
      world: w, tick: 0, daylight: 1, difficulty: 2, random, players: () => players,
      hurtPlayer: () => {}, givePlayer: () => 0, giveXp: () => {}, spawn: () => {}, dropItem: () => {},
      explode: () => {}, sound: () => {}, particles: () => {}, placeBlock: () => true,
      entitiesNear: (x: number, _y: number, z: number, r: number) => entities.filter((e) => Math.hypot(e.x - x, e.z - z) <= r),
    } as unknown as EntityContext;
  }
  const player = (id: string, x: number, z: number, extra: Partial<PlayerRef> = {}): PlayerRef => ({
    id, name: id, x, y: 11, z, width: 0.6, height: 1.8, targetable: true, heldItem: -1, sneaking: false, ...extra,
  });

  it("tames a wolf with a bone, one time in three, and sits it at its owner's word", () => {
    const w = world();
    const wolf = new Mob("wolf", 0.5, 11, 0.5);
    const ctx = ctxFor(w, [player("alex", 2, 0)], [wolf], () => 0.9);
    expect(wolf.interact(ctx, "bone", "alex", "Alex")).toBe("fed");
    expect(wolf.owner).toBeNull();
    const lucky = ctxFor(w, [player("alex", 2, 0)], [wolf], () => 0.1);
    expect(wolf.interact(lucky, "bone", "alex", "Alex")).toBe("tamed");
    expect(wolf.owner).toBe("alex");
    expect(wolf.maxHealth).toBe(20);
    expect(wolf.sitting).toBe(true);
    expect(wolf.interact(lucky, null, "alex")).toBe("sat");
    expect(wolf.sitting).toBe(false);
    // Someone else cannot order it about.
    expect(wolf.interact(lucky, null, "sam")).toBeNull();
  });

  it("keeps a tame wolf's owner and sitting through a save", () => {
    const wolf = new Mob("wolf", 0, 11, 0);
    wolf.owner = "alex"; wolf.ownerName = "Alex"; wolf.sitting = true;
    const copy = new Mob("wolf", 0, 11, 0, wolf.id);
    copy.applySnapshot(JSON.parse(JSON.stringify(wolf.snapshot())));
    expect([copy.owner, copy.ownerName, copy.sitting]).toEqual(["alex", "Alex", true]);
  });

  it("follows its owner, and appears at their side when left far behind", () => {
    const w = world();
    const wolf = new Mob("wolf", 0.5, 11, 0.5);
    wolf.owner = "alex";
    const ctx = ctxFor(w, [player("alex", 40, 0)], [wolf]);
    for (let i = 0; i < 5; i++) { wolf.beginTick(); wolf.tick(ctx); }
    expect(Math.abs(wolf.x - 40)).toBeLessThan(2);
  });

  it("goes for whatever its owner strikes", () => {
    const w = world();
    const wolf = new Mob("wolf", 0.5, 11, 0.5);
    wolf.owner = "alex";
    const zombie = new Mob("zombie", 3.5, 11, 0.5);
    zombie.lastAttacker = "alex";
    const ctx = ctxFor(w, [player("alex", 0, 2, { targetable: false })], [wolf, zombie]);
    const before = zombie.health;
    for (let i = 0; i < 80 && zombie.health === before; i++) { wolf.beginTick(); wolf.tick(ctx); }
    expect(zombie.health).toBeLessThan(before);
  });

  it("turns a wild pack on whoever strikes one of them", () => {
    const w = world();
    const a = new Mob("wolf", 0.5, 11, 0.5), b = new Mob("wolf", 2.5, 11, 0.5);
    const ctx = ctxFor(w, [player("sam", 4, 0)], [a, b]);
    a.hurt(ctx, 1, "player", 4, 0, "sam");
    expect(b.targetId).toBe("sam");
    expect(b.anger).toBeGreaterThan(0);
  });

  it("sends a deer bounding away from someone walking up, but not from someone sneaking", () => {
    const w = world();
    const deer = new Mob("deer", 0.5, 11, 0.5);
    for (let i = 0; i < 3; i++) { deer.beginTick(); deer.tick(ctxFor(w, [player("sam", 0.5, 5, { sneaking: true })], [deer])); }
    expect(deer.panic).toBe(0);
    deer.beginTick(); deer.tick(ctxFor(w, [player("sam", 0.5, 5)], [deer]));
    expect(deer.panic).toBeGreaterThan(0);
  });

  it("leaves a bear alone until it is struck, then it charges", () => {
    const w = world();
    const bear = new Mob("bear", 0.5, 11, 0.5);
    const ctx = ctxFor(w, [player("sam", 3, 0)], [bear]);
    expect(bear.targetId).toBeNull();
    bear.hurt(ctx, 1, "player", 3, 0, "sam");
    expect(bear.targetId).toBe("sam");
  });

  it("eats any meat, venison included, and lives where the trees are", () => {
    expect(WOLF_FOOD.has("cooked_venison")).toBe(true);
    expect(pickWildlife("Taiga", () => 0)?.kind).toBe("wolf");
    expect(pickWildlife("Desert", () => 0)).toBeNull();
  });
});
