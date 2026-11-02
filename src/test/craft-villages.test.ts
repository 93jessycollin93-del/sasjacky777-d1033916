import { beforeEach, describe, expect, it } from "vitest";
import { BiomeId } from "@/craft/engine/biomes";
import { B } from "@/craft/engine/blocks";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import type { Entity, EntityContext, PlayerRef } from "@/craft/engine/entities";
import { sanitizeStack } from "@/craft/engine/inventory";
import { itemByName, itemId, maxStack } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { createEntityFromSnapshot, Mob } from "@/craft/engine/mobs";
import { Rng } from "@/craft/engine/rng";
import { canAfford, LEVEL_XP, levelForXp, offersForLevel, sanitizeOffer, type Offer } from "@/craft/engine/trading";
import {
  buildVillage, COMPOST_CHANCE, crowdsVillage, golemParts, JOB_BLOCKS, PROFESSIONS, villageInRegion, villageLoot, villagesTouching,
  VILLAGE_REGION, type Terrain, type Village,
} from "@/craft/engine/villages";
import { World } from "@/craft/engine/world";

/** Flat plains at y=70: every village the plan wants fits. */
const plains: Terrain = { surfaceY: () => 70, biomeAt: () => BiomeId.Plains };

/** The first village the plan puts in regions 0..20 along x for a seed. */
function firstVillage(t: Terrain, seed: number): Village {
  for (let rx = 0; rx < 20; rx++) {
    const v = villageInRegion(t, seed, rx, 0);
    if (v) return v;
  }
  throw new Error(`no village for seed ${seed}`);
}

function built(v: Village, t: Terrain): Map<string, [number, number]> {
  const blocks = new Map<string, [number, number]>();
  buildVillage(v, t, (x, y, z, id, meta = 0) => { blocks.set(`${x},${y},${z}`, [id, meta]); });
  return blocks;
}

describe("village plans", () => {
  it("lays out the same village every time for the same seed and region", () => {
    const a = firstVillage(plains, 7);
    const b = villageInRegion(plains, 7, Number(a.key.split(",")[0]), 0);
    expect(b).toEqual(a);
  });

  it("builds villages only in the biomes that have them", () => {
    const forest: Terrain = { surfaceY: () => 70, biomeAt: () => BiomeId.Forest };
    for (let rx = 0; rx < 20; rx++) expect(villageInRegion(forest, 7, rx, 0)).toBeNull();
  });

  it("keeps villages off ground that is underwater", () => {
    const sea: Terrain = { surfaceY: () => 50, biomeAt: () => BiomeId.Plains };
    for (let rx = 0; rx < 20; rx++) expect(villageInRegion(sea, 7, rx, 0)).toBeNull();
  });

  it("puts most regions' village somewhere, but not every region's", () => {
    let found = 0;
    for (let rx = 0; rx < 40; rx++) if (villageInRegion(plains, 3, rx, 0)) found++;
    expect(found).toBeGreaterThan(20);
    expect(found).toBeLessThan(40);
  });

  it("never builds a house over another house, the well or a road", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const v = firstVillage(plains, seed);
      expect(v.houses.length).toBeGreaterThanOrEqual(2);
      const inside = (h: Village["houses"][number], x: number, z: number) => x >= h.x0 && x < h.x0 + h.w && z >= h.z0 && z < h.z0 + h.d;
      v.houses.forEach((h, i) => {
        for (const [x, z] of v.roads) expect(inside(h, x, z)).toBe(false);
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) expect(inside(h, v.x + dx, v.z + dz)).toBe(false);
        v.houses.forEach((o, j) => {
          if (i === j) return;
          const apart = h.x0 + h.w <= o.x0 || o.x0 + o.w <= h.x0 || h.z0 + h.d <= o.z0 || o.z0 + o.d <= h.z0;
          expect(apart).toBe(true);
        });
      });
    }
  });

  it("reports a village to every chunk its houses reach, and to no chunk far away", () => {
    const v = firstVillage(plains, 5);
    for (const h of v.houses) {
      const found = villagesTouching(plains, 5, h.x0 >> 4, h.z0 >> 4);
      expect(found.some((f) => f.key === v.key)).toBe(true);
    }
    const far = villagesTouching(plains, 5, (v.x >> 4) + VILLAGE_REGION / 2 + 5, (v.z >> 4) + 3);
    expect(far.some((f) => f.key === v.key)).toBe(false);
  });
});

describe("building a village", () => {
  it("gives every house the work station of its villager's trade, a bed and a door", () => {
    for (const seed of [1, 2, 3]) {
      const v = firstVillage(plains, seed);
      const blocks = built(v, plains);
      for (const h of v.houses) {
        const [jx, jy, jz] = h.job;
        expect(blocks.get(`${jx},${jy},${jz}`)?.[0]).toBe(JOB_BLOCKS[h.profession]);
        if (h.kind === "farm") {
          expect(h.profession).toBe("farmer");
          continue;
        }
        const [bx, by, bz] = h.bed!;
        const head = blocks.get(`${bx},${by},${bz}`);
        expect(head?.[0]).toBe(B.RED_BED);
        expect(head![1] & 4).toBe(4);
        const doors = [...blocks.entries()].filter(([k, [id]]) => {
          const [x, y, z] = k.split(",").map(Number);
          return id === B.OAK_DOOR && y === h.y + 1 && x >= h.x0 && x < h.x0 + h.w && z >= h.z0 && z < h.z0 + h.d;
        });
        expect(doors).toHaveLength(1);
      }
    }
  });

  it("stocks the square with a bell, a well of water and a waystone clear of the roads", () => {
    const v = firstVillage(plains, 2);
    const blocks = built(v, plains);
    expect(blocks.get(`${v.x - 2},${v.y + 1},${v.z - 2}`)?.[0]).toBe(B.BELL);
    expect(blocks.get(`${v.x},${v.y},${v.z}`)?.[0]).toBe(B.WATER);
    expect(blocks.get(`${v.x + 3},${v.y + 1},${v.z + 3}`)?.[0]).toBe(B.WAYSTONE);
    expect(v.roads.some(([x, z]) => x === v.x + 3 && z === v.z + 3)).toBe(false);
  });

  it("gives a library its shelves", () => {
    for (let seed = 1; seed < 40; seed++) {
      const v = firstVillage(plains, seed);
      const library = v.houses.find((h) => h.kind === "library");
      if (!library) continue;
      expect(library.profession).toBe("librarian");
      const blocks = built(v, plains);
      const shelves = [...blocks.values()].filter(([id]) => id === B.BOOKSHELF).length;
      expect(shelves).toBeGreaterThan(4);
      return;
    }
    throw new Error("no library in 40 seeds");
  });

  it("fills chests with items that exist", () => {
    for (let seed = 0; seed < 50; seed++) {
      const items: ({ id: number; count: number } | null)[] = new Array(27).fill(null);
      villageLoot(items, seed);
      for (const s of items) if (s) expect(sanitizeStack(s)).toEqual(s);
    }
  });
});

describe("trades", () => {
  it("offers only real items, in stacks that fit, at every level of every trade", () => {
    for (const p of PROFESSIONS) for (let level = 1; level <= 5; level++) for (let seed = 0; seed < 30; seed++) {
      const offers = offersForLevel(p, level, new Rng(seed));
      expect(offers.length).toBeGreaterThanOrEqual(1);
      expect(offers.length).toBeLessThanOrEqual(2);
      for (const o of offers) {
        for (const s of [o.buy, o.buyB, o.sell]) {
          if (!s) continue;
          expect(sanitizeStack(s)).toEqual(s);
          expect(s.count).toBeLessThanOrEqual(maxStack(s.id));
        }
        expect(o.maxUses).toBeGreaterThan(0);
        expect(o.xp).toBeGreaterThan(0);
      }
    }
  });

  it("never offers the same trade twice at one level", () => {
    for (const p of PROFESSIONS) for (let seed = 0; seed < 20; seed++) {
      const [a, b] = offersForLevel(p, 1, new Rng(seed));
      if (!b) continue;
      expect(a.buy.id === b.buy.id && a.sell.id === b.sell.id && a.buyB?.id === b.buyB?.id).toBe(false);
    }
  });

  it("sells librarians' books with an enchantment on them", () => {
    let books = 0;
    for (let seed = 0; seed < 40; seed++) {
      for (const o of offersForLevel("librarian", 1, new Rng(seed))) {
        if (o.sell.id !== itemId("enchanted_book")) continue;
        books++;
        expect(Object.keys(o.sell.ench ?? {})).toHaveLength(1);
        expect(o.buyB?.id).toBe(itemId("book"));
      }
    }
    expect(books).toBeGreaterThan(0);
  });

  it("counts both halves of a price paid in the same item", () => {
    const e = itemId("emerald");
    const offer: Offer = { buy: { id: e, count: 5 }, buyB: { id: e, count: 3 }, sell: { id: itemId("bread"), count: 1 }, uses: 0, maxUses: 4, xp: 1 };
    expect(canAfford(offer, () => 7)).toBe(false);
    expect(canAfford(offer, () => 8)).toBe(true);
  });

  it("refuses a trade that has sold out until it restocks", () => {
    const offer: Offer = { buy: { id: itemId("wheat"), count: 20 }, sell: { id: itemId("emerald"), count: 1 }, uses: 16, maxUses: 16, xp: 2 };
    expect(canAfford(offer, () => 64)).toBe(false);
  });

  it("reads each level's experience threshold as that level", () => {
    expect(levelForXp(0)).toBe(1);
    LEVEL_XP.forEach((xp, i) => {
      if (i === 0) return;
      expect(levelForXp(xp - 1)).toBe(i);
      expect(levelForXp(xp)).toBe(i + 1);
    });
  });

  it("drops an offer from a save that names an item that does not exist", () => {
    expect(sanitizeOffer({ buy: { id: 9999, count: 1 }, sell: { id: itemId("bread"), count: 1 }, uses: 0, maxUses: 4, xp: 1 })).toBeNull();
    expect(sanitizeOffer({ buy: { id: itemId("wheat"), count: 20 }, sell: { id: itemId("emerald"), count: 1 } })).toBeNull();
    expect(sanitizeOffer("nonsense")).toBeNull();
    const good = sanitizeOffer({ buy: { id: itemId("wheat"), count: 20 }, sell: { id: itemId("emerald"), count: 1 }, uses: 3, maxUses: 16, xp: 2 });
    expect(good?.uses).toBe(3);
  });
});

/** Stone to y=10 across nine chunks; mobs stand at y=11. */
function testWorld(): World {
  const world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let y = 0; y <= 10; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks[blockIndex(x, y, z)] = B.STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  return world;
}

let world: World;
let mobs: Mob[];
let players: PlayerRef[];
let hits: { id: string; amount: number }[];
let daylight: number;

const ctx = (): EntityContext => ({
  world, tick: 0, daylight, difficulty: 2, random: Math.random, players: () => players,
  hurtPlayer: (id, amount) => { hits.push({ id, amount }); }, givePlayer: () => 0, giveXp: () => {}, spawn: () => {},
  dropItem: () => {}, explode: () => {}, sound: () => {}, particles: () => {},
  entitiesNear: (x, y, z, r): Entity[] => mobs.filter((m) => !m.removed && Math.hypot(m.x - x, m.y - y, m.z - z) <= r),
  placeBlock: () => true,
});

function add(kind: Mob["kind"], x: number, z: number): Mob {
  const m = new Mob(kind, x + 0.5, 11, z + 0.5);
  mobs.push(m);
  return m;
}

function run(ticks: number): void {
  const c = ctx();
  for (let i = 0; i < ticks; i++) for (const m of mobs) if (!m.removed) { m.beginTick(); m.tick(c); }
}

beforeEach(() => {
  world = testWorld();
  mobs = [];
  players = [];
  hits = [];
  daylight = 1;
});

describe("villagers", () => {
  it("takes up the trade of a free work station nearby", () => {
    const v = add("villager", 0, 0);
    v.home = { x: 0.5, z: 0.5 };
    world.setBlock(3, 11, 0, B.LECTERN, 0, "player");
    run(120);
    expect(v.profession).toBe("librarian");
    expect(v.job).toEqual([3, 11, 0]);
    expect(v.offers.length).toBeGreaterThan(0);
  });

  it("lets only one villager claim each station", () => {
    const a = add("villager", 0, 0), b = add("villager", 0, 2);
    a.home = b.home = { x: 0.5, z: 1.5 };
    world.setBlock(3, 11, 1, B.LECTERN, 0, "player");
    run(220);
    expect([a, b].filter((v) => v.profession === "librarian")).toHaveLength(1);
  });

  it("gives up an untraded trade when its station is broken, but keeps one it has traded in", () => {
    // Far enough apart that each can only reach its own station.
    const fresh = add("villager", 0, 0), seasoned = add("villager", 0, -14);
    fresh.home = { x: 0.5, z: 0.5 };
    seasoned.home = { x: 0.5, z: -13.5 };
    world.setBlock(3, 11, 0, B.SMOKER, 0, "player");
    world.setBlock(3, 11, -14, B.COMPOSTER, 0, "player");
    run(120);
    expect(fresh.profession).toBe("butcher");
    expect(seasoned.profession).toBe("farmer");
    seasoned.traded(0);
    world.setBlock(3, 11, 0, B.AIR, 0, "player");
    world.setBlock(3, 11, -14, B.AIR, 0, "player");
    run(120);
    expect(fresh.profession).toBe("none");
    expect(fresh.offers).toHaveLength(0);
    expect(seasoned.profession).toBe("farmer");
  });

  it("levels up with trades and gains two new offers when it does", () => {
    const v = add("villager", 0, 0);
    v.setProfession("farmer", () => 0.5);
    const first = v.offers.length;
    let levelled = false;
    let trades = 0;
    while (!levelled && trades < 20) { levelled = v.traded(0, () => 0.5); trades++; }
    expect(levelled).toBe(true);
    expect(v.villagerLevel).toBe(2);
    expect(v.offers.length).toBe(first + 2);
    expect(v.offers[0].uses).toBe(trades);
  });

  it("will not trade before it has a trade", () => {
    const v = add("villager", 0, 0);
    expect(v.interact(ctx(), null, "p1")).toBe("refuse");
    v.setProfession("mason");
    expect(v.interact(ctx(), null, "p1")).toBe("trade");
  });

  it("keeps its trade, experience and offers through a save", () => {
    const v = add("villager", 0, 0);
    v.setProfession("cleric");
    v.traded(0);
    v.job = [3, 11, 0];
    v.home = { x: 1, z: 2 };
    const copy = createEntityFromSnapshot(JSON.parse(JSON.stringify(v.snapshot()))) as Mob;
    expect(copy.profession).toBe("cleric");
    expect(copy.villagerXp).toBe(v.villagerXp);
    expect(copy.offers).toEqual(v.offers);
    expect(copy.job).toEqual([3, 11, 0]);
    expect(copy.home).toEqual({ x: 1, z: 2 });
  });

  it("runs from a zombie", () => {
    const v = add("villager", 0, 0);
    v.home = { x: 0.5, z: 0.5 };
    add("zombie", 4, 0);
    daylight = 0;
    const before = v.x;
    run(30);
    expect(v.x).toBeLessThan(before - 1);
  });
});

describe("zombies and iron golems", () => {
  it("sends a zombie with no player to chase after a villager", () => {
    daylight = 0;
    const v = add("villager", 0, 0);
    // Pinned in place so the chase ends in a bite rather than a race across the test world.
    v.body.width = 0.6;
    add("zombie", 3, 0);
    let hurt = false;
    for (let i = 0; i < 200 && !hurt; i++) {
      v.body.x = 0.5; v.body.z = 0.5; v.body.vx = 0; v.body.vz = 0;
      run(1);
      hurt = v.health < 20;
    }
    expect(hurt).toBe(true);
  });

  it("sends a golem after a monster in the village", () => {
    daylight = 0;
    const golem = add("iron_golem", 0, 0);
    const zombie = add("zombie", 5, 0);
    let hurt = false;
    for (let i = 0; i < 200 && !hurt; i++) { run(1); hurt = zombie.health < 20; }
    expect(hurt).toBe(true);
    // Its blow is at least seven.
    expect(zombie.health).toBeLessThanOrEqual(13);
    expect(golem.health).toBe(100);
  });

  it("lets a creeper pass: a golem never picks that fight", () => {
    daylight = 0;
    add("iron_golem", 0, 0);
    const creeper = add("creeper", 5, 0);
    run(200);
    expect(creeper.health).toBe(20);
  });

  it("turns a golem on the player who strikes it", () => {
    const golem = add("iron_golem", 0, 0);
    players = [{ id: "p1", name: "Steve", x: 2.5, y: 11, z: 0.5, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false }];
    golem.hurt(ctx(), 1, "player", 2.5, 0.5, "p1");
    run(60);
    expect(hits.some((h) => h.id === "p1" && h.amount >= 7)).toBe(true);
  });

  it("does not hurt a golem that falls", () => {
    const golem = new Mob("iron_golem", 0.5, 30, 0.5);
    mobs.push(golem);
    run(60);
    expect(golem.body.onGround).toBe(true);
    expect(golem.health).toBe(100);
  });
});

describe("building an iron golem", () => {
  const build = (arms: "x" | "z", head: number = B.CARVED_PUMPKIN) => {
    world.setBlock(0, 11, 0, B.IRON_BLOCK, 0, "player");
    world.setBlock(0, 12, 0, B.IRON_BLOCK, 0, "player");
    if (arms === "x") { world.setBlock(-1, 12, 0, B.IRON_BLOCK, 0, "player"); world.setBlock(1, 12, 0, B.IRON_BLOCK, 0, "player"); }
    else { world.setBlock(0, 12, -1, B.IRON_BLOCK, 0, "player"); world.setBlock(0, 12, 1, B.IRON_BLOCK, 0, "player"); }
    world.setBlock(0, 13, 0, head, 0, "player");
  };
  const get = (x: number, y: number, z: number) => world.blockAt(x, y, z);

  it("recognises the T of iron under a pumpkin, either way round", () => {
    build("x");
    expect(golemParts(get, 0, 13, 0)).toHaveLength(5);
    world = testWorld();
    build("z", B.JACK_O_LANTERN);
    expect(golemParts(get, 0, 13, 0)).toContainEqual([0, 12, -1]);
  });

  it("does not make a golem from a T missing an arm, or a pumpkin on a pillar", () => {
    build("x");
    world.setBlock(1, 12, 0, B.AIR, 0, "player");
    expect(golemParts(get, 0, 13, 0)).toBeNull();
    world.setBlock(-1, 12, 0, B.AIR, 0, "player");
    expect(golemParts(get, 0, 13, 0)).toBeNull();
  });
});

describe("the composter", () => {
  it("takes only things that exist, at chances between none and certain", () => {
    for (const [name, chance] of Object.entries(COMPOST_CHANCE)) {
      expect(() => itemByName(name)).not.toThrow();
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
  });
});

describe("the land around a village", () => {
  it("keeps trees off houses, roads and the square, but not the countryside", () => {
    const v = firstVillage(plains, 4);
    const h = v.houses[0];
    expect(crowdsVillage(v, h.x0 + 1, h.z0 + 1)).toBe(true);
    // A canopy reaches four blocks: a trunk that close to a wall would grow through the roof.
    expect(crowdsVillage(v, h.x0 - 3, h.z0)).toBe(true);
    expect(crowdsVillage(v, v.x, v.z)).toBe(true);
    const [rx, rz] = v.roads[v.roads.length - 1];
    expect(crowdsVillage(v, rx, rz)).toBe(true);
    expect(crowdsVillage(v, v.x1 + 20, v.z1 + 20)).toBe(false);
  });
});
