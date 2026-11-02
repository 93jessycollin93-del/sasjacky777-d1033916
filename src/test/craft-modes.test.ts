import { blockIndex } from "@/craft/engine/constants";
import { describe, expect, it } from "vitest";
import { B } from "@/craft/engine/blocks";
import { itemByName, itemId, type ItemStack } from "@/craft/engine/items";
import { isMapId, MAP_IDS, mapLayout, mapLoot, mapLootNames, MapGenerator } from "@/craft/engine/maps";
import { parkourJumps } from "@/craft/engine/maps";
import { luckyOutcome, LUCKY_OUTCOME_COUNT } from "@/craft/engine/lucky";
import { newBody, travel, type BlockReader } from "@/craft/engine/physics";
import { Generator } from "@/craft/engine/worldgen";
import { applyMode, modeDef, MODES, randomMode } from "@/craft/modes/modes";
import { CHALLENGES, goal, progress } from "@/craft/modes/skyblock";
import { nextBlock, phaseAt, PHASES } from "@/craft/modes/oneblock";
import { waveMobs, waveReward } from "@/craft/modes/waves";
import { sgBorder } from "@/craft/modes/survivalGames";
import { randomDropTable, SPLITS, uhcBorder } from "@/craft/modes/challenges";
import { newWorldMeta } from "@/craft/game/save";
import { sanitizeModeTell } from "@/craft/net/session";
import { MOB_KINDS } from "@/craft/engine/mobs";

const base = (seed: number) => new Generator({ seed, type: "default", dimension: "overworld" });

describe("map packs", () => {
  it("lays every map out the same way for the same seed", () => {
    for (const id of MAP_IDS) {
      if (id === "sg_arena") continue; // built on terrain, checked below with its own generator
      const a = mapLayout(id, 11, base(11)), b = mapLayout(id, 11, base(11));
      expect(a.spawn).toEqual(b.spawn);
      expect([...a.blocks.keys()]).toEqual([...b.blocks.keys()]);
    }
  });

  it("stands every void map's spawn on something solid", () => {
    for (const id of MAP_IDS) {
      const l = mapLayout(id, 5, base(5));
      if (l.terrain) continue;
      // Built as the world would build it: from the map's pieces, or (a city) from its chunk-by-chunk plan.
      const [sx, sy, sz] = l.spawn.map(Math.floor);
      const chunk = new MapGenerator(id, base(5)).generate(sx >> 4, sz >> 4);
      expect(chunk.blocks[blockIndex(sx & 15, sy - 1, sz & 15)], id).not.toBe(B.AIR);
      expect(chunk.blocks[blockIndex(sx & 15, sy, sz & 15)], id).toBe(B.AIR);
    }
  });

  it("generates a void map as empty air round its pieces, with plains colours", () => {
    const g = new MapGenerator("skyblock", base(3));
    const far = g.generate(20, 20);
    expect(far.blocks.every((b) => b === 0)).toBe(true);
    const home = g.generate(0, 0);
    expect(home.blocks.some((b) => b === B.BEDROCK)).toBe(true);
    expect(g.findSpawn()).toEqual({ x: 1.5, y: 63, z: 1.5 });
  });

  it("hands out a fresh colour buffer for every chunk, since the worker gives each one away", () => {
    const g = new MapGenerator("oneblock", base(3));
    const a = g.tints(0, 0), b = g.tints(1, 0);
    expect(a).not.toBe(b);
    expect(a.buffer).not.toBe(b.buffer);
    expect([...a]).toEqual([...b]);
  });

  it("builds the Survival Games cornucopia on the real terrain, twelve pads round five chests", () => {
    const l = mapLayout("sg_arena", 21, base(21));
    expect(l.terrain).toBe(true);
    expect(l.pads).toHaveLength(12);
    expect(l.chests.filter((c) => c[3] === "sg_center")).toHaveLength(5);
    expect(l.chests.filter((c) => c[3] === "sg_wild").length).toBeGreaterThan(10);
  });

  it("stacks TNT Run's three floors above the out-of-bounds line", () => {
    const l = mapLayout("tnt_run", 1, base(1));
    expect(l.floors).toEqual([90, 84, 78]);
    expect(l.floorY).toBeLessThan(Math.min(...l.floors!));
  });

  it("fills map chests only with items the game has, starting chests in order", () => {
    for (const n of mapLootNames()) expect(() => itemByName(n), n).not.toThrow();
    const items: (ItemStack | null)[] = new Array(27).fill(null);
    mapLoot(items, 9, "skyblock_start");
    expect(items[0]?.id).toBe(itemId("lava_bucket"));
    expect(items[1]?.id).toBe(itemId("ice"));
  });

  it("recognises map ids and nothing else", () => {
    expect(isMapId("skyblock")).toBe(true);
    expect(isMapId("chernarus")).toBe(false);
    expect(isMapId(undefined)).toBe(false);
  });
});

/** A reader over a handful of blocks, air everywhere else. */
function blocksAt(list: [number, number, number, number][]): BlockReader {
  const m = new Map(list.map(([x, y, z, id]) => [`${x},${y},${z}`, id]));
  return { getBlock: (x, y, z) => m.get(`${x},${y},${z}`) ?? 0, getMeta: () => 0 };
}

/**
 * Sprint-jumps from a runway onto a single block `gap` blocks away and `dy`
 * up, then — the course's real test — from that block onto another the same
 * distance on, carrying whatever momentum the first landing left. A runner
 * picks their moment and their pace, so each jump is tried from every takeoff
 * point along its block, sprinting and not; the jump is possible if some pair
 * of choices lands on the last block.
 */
function makesTheJump(gap: number, dy: number, surface: number): boolean {
  const y0 = 64;
  const blocks: [number, number, number, number][] = [];
  for (let z = -6; z <= 0; z++) blocks.push([0, y0, z, B.STONE]);
  const first = gap + 1, second = 2 * (gap + 1);
  blocks.push([0, y0 + dy, first, surface], [0, y0 + 2 * dy, second, surface]);
  const world = blocksAt(blocks);
  const pads = [0, first, second];
  const over = (z: number, bz: number) => z >= bz - 0.3 && z < bz + 1.3 && (bz !== 0 || z >= -6.3);
  /** Runs from `b` until it lands on block `pads[stage]` (true) or falls (false), jumping `early` blocks before the edge. */
  const leg = (from: ReturnType<typeof newBody>, stage: number, early: number, sprint: boolean): ReturnType<typeof newBody> | null => {
    const b = { ...from };
    const on = pads[stage - 1], target = pads[stage], ty = y0 + stage * dy + 1;
    let jumped = false;
    for (let t = 0; t < 120; t++) {
      const jump = !jumped && b.onGround && over(b.z, on) && b.z + b.vz > on + 1.25 - early;
      if (jump) jumped = true;
      travel(world, b, { forward: 1, strafe: 0, yaw: Math.PI, jump, sneak: false, sprint, flying: false, speed: 0.1 });
      if (jumped && b.onGround && over(b.z, target) && Math.abs(b.y - ty) < 0.01) return b;
      if (b.y < y0 - 8 || (jumped && b.onGround && !over(b.z, target))) return null;
    }
    return null;
  };
  const start = newBody(0.5, y0 + 1, -5.5, 0.6, 1.8, 1.62);
  // A runner also chooses whether to sprint: a short jump taken at a sprint overshoots.
  for (const s1 of [true, false]) for (let a = 0; a <= 1.2; a += 0.1) {
    const landed = leg(start, 1, a, s1);
    if (!landed) continue;
    for (const s2 of [true, false]) for (let c = 0; c <= 1.2; c += 0.1) if (leg(landed, 2, c, s2)) return true;
  }
  return false;
}

describe("parkour", () => {
  it("knows a jump too far when it sees one", () => {
    expect(makesTheJump(5, 0, B.STONE)).toBe(false);
    expect(makesTheJump(4, 1, B.STONE)).toBe(false);
    expect(makesTheJump(1, 0, B.STONE)).toBe(true);
  });

  it("builds every course only from jumps this game's physics can make", () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 40; seed++) for (const j of parkourJumps(seed)) kinds.add(`${j.gap},${j.dy},${j.block}`);
    for (const k of kinds) {
      const [gap, dy, surface] = k.split(",").map(Number);
      expect(makesTheJump(gap, dy, surface), `gap ${gap}, dy ${dy}, block ${surface}`).toBe(true);
    }
  });

  it("puts a checkpoint every twelve jumps and ends on diamond", () => {
    const l = mapLayout("parkour", 4, base(4));
    expect(l.checkpoints).toHaveLength(5);
    const last = l.checkpoints!.at(-1)!;
    const all = [...l.blocks.values()].flat();
    let diamond = false;
    for (let i = 0; i < all.length; i += 5) if (all[i + 3] === B.DIAMOND_BLOCK && all[i] === last[0] && all[i + 2] === last[2]) diamond = true;
    expect(diamond).toBe(true);
    expect(l.floorY).toBeLessThan(Math.min(...l.checkpoints!.map((c) => c[1])));
  });
});

describe("lucky blocks", () => {
  it("can come out every way, good and bad, and never fails to make an outcome", () => {
    const seen = new Set<string>();
    let s = 1;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 4000; i++) {
      const o = luckyOutcome(rng);
      seen.add(o.id);
      expect(o.actions.length).toBeGreaterThan(0);
      expect(o.message.length).toBeGreaterThan(0);
      for (const a of o.actions) {
        if (a.kind === "spawn") expect(MOB_KINDS).toContain(a.mob);
        if (a.kind === "drop") for (const st of a.stacks) expect(st.count).toBeGreaterThan(0);
      }
    }
    expect(seen.size).toBe(LUCKY_OUTCOME_COUNT);
    const moods = new Set([...seen].map((id) => luckyOutcome(() => 0).id && id));
    expect(moods.size).toBeGreaterThan(10);
  });

  it("scatters lucky blocks only in worlds made for them", () => {
    const count = (lucky: boolean) => {
      const g = new Generator({ seed: 77, type: "default", dimension: "overworld", lucky });
      let n = 0;
      for (let cx = 0; cx < 6; cx++) for (let cz = 0; cz < 6; cz++) n += g.generate(cx, cz).blocks.filter((b) => b === B.LUCKY_BLOCK).length;
      return n;
    };
    expect(count(false)).toBe(0);
    expect(count(true)).toBeGreaterThan(0);
  });
});

describe("modes", () => {
  it("gives every mode a real icon, a map that exists and a unique id", () => {
    const ids = new Set<string>();
    for (const m of MODES) {
      expect(ids.has(m.id), m.id).toBe(false);
      ids.add(m.id);
      expect(() => itemByName(m.icon), m.icon).not.toThrow();
      if (m.map) expect(isMapId(m.map)).toBe(true);
      expect(m.description.length).toBeGreaterThan(10);
    }
  });

  it("sets a new world up for its mode: map, rules, and the mode itself", () => {
    const meta = newWorldMeta({ name: "t", seed: 1, seedText: "1", type: "amplified", gameMode: "adventure", difficulty: 0, hardcore: false, cheats: false });
    applyMode(meta, modeDef("parkour")!);
    expect(meta.map).toBe("parkour");
    expect(meta.type).toBe("default");
    expect(meta.rules.doMobSpawning).toBe(false);
    expect(meta.rules.doFallDamage).toBe(false);
    expect(meta.mode).toEqual({ id: "parkour", data: {} });
    const hc = newWorldMeta({ name: "h", seed: 1, seedText: "1", type: "default", gameMode: "survival", difficulty: 1, hardcore: false, cheats: true });
    applyMode(hc, modeDef("hardcore")!);
    expect([hc.hardcore, hc.difficulty, hc.cheats]).toEqual([true, 3, false]);
  });

  it("never picks a classic for the Random button", () => {
    for (let i = 0; i < 50; i++) expect(randomMode(() => i / 50).category).not.toBe("classic");
  });
});

describe("SkyBlock challenges", () => {
  it("pays out only items the game has", () => {
    for (const c of CHALLENGES) for (const [n] of c.reward.items) expect(() => itemByName(n), n).not.toThrow();
  });

  it("counts the island's work toward each challenge from its tallies", () => {
    const stone = CHALLENGES.find((c) => c.id === "cobble")!;
    expect(progress(stone, { [`b${B.COBBLE}`]: 40, [`b${B.STONE}`]: 30 })).toBe(70);
    expect(progress(stone, {})).toBe(0);
    const timber = CHALLENGES.find((c) => c.id === "timber")!;
    expect(progress(timber, { [`b${B.OAK_LOG}`]: 3, [`b${B.BIRCH_LOG}`]: 4, [`b${B.DIRT}`]: 9 })).toBe(7);
    const builder = CHALLENGES.find((c) => c.id === "builder")!;
    expect(progress(builder, { placed: 12 })).toBe(12);
    const hunter = CHALLENGES.find((c) => c.id === "hunter")!;
    expect(progress(hunter, { kzombie: 10 })).toBeGreaterThanOrEqual(goal(hunter));
  });
});

describe("OneBlock", () => {
  it("works through every phase in order and stays in the End", () => {
    let n = 0;
    for (let i = 0; i < PHASES.length - 1; i++) {
      expect(phaseAt(n).index).toBe(i);
      n += PHASES[i].length;
    }
    expect(phaseAt(n).index).toBe(PHASES.length - 1);
    expect(phaseAt(n + 100000).index).toBe(PHASES.length - 1);
  });

  it("opens each new phase with a chest, the End's holding a portal's frame and eyes", () => {
    let n = 0;
    for (let i = 0; i < PHASES.length - 1; i++) n += PHASES[i].length;
    const end = nextBlock(n, 3);
    expect(end.kind).toBe("chest");
    if (end.kind === "chest") expect(end.table.map(([name]) => name)).toEqual(expect.arrayContaining(["end_portal_frame", "eye_of_ender"]));
    expect(nextBlock(PHASES[0].length, 3).kind).toBe("chest");
  });

  it("comes back the same way in the same world, and as blocks of its phase", () => {
    for (let n = 1; n < 300; n++) {
      const a = nextBlock(n, 42), b = nextBlock(n, 42);
      expect(a).toEqual(b);
      if (a.kind !== "chest") expect(PHASES[phaseAt(n).index].blocks.map(([id]) => id)).toContain(a.id);
    }
  });

  it("fills its chests only with things the game has", () => {
    for (const p of PHASES) for (const [n] of p.chest) expect(() => itemByName(n), `${p.name}: ${n}`).not.toThrow();
  });
});

describe("Wave Defense", () => {
  it("sends more monsters, and worse ones, as the waves go on", () => {
    expect(waveMobs(1)).toEqual(["zombie", "zombie", "zombie"]);
    expect(waveMobs(10).length).toBeGreaterThan(waveMobs(3).length);
    expect(waveMobs(5)).toContain("hoglin");
    expect(waveMobs(9)).toContain("blaze");
    expect(waveMobs(200).length).toBeLessThanOrEqual(32);
  });

  it("rewards each wave only with items the game has", () => {
    for (let n = 1; n <= 20; n++) for (const [name] of waveReward(n)) expect(() => itemByName(name), name).not.toThrow();
  });
});

describe("borders", () => {
  it("holds the Survival Games border for two minutes, then closes it to twenty by ten", () => {
    expect(sgBorder(0, 150)).toBe(150);
    expect(sgBorder(120, 150)).toBe(150);
    expect(sgBorder(360, 150)).toBeLessThan(150);
    expect(sgBorder(600, 150)).toBe(20);
    expect(sgBorder(9999, 150)).toBe(20);
  });

  it("gives UHC five minutes' grace and then an hour's closing, to fifty", () => {
    expect(uhcBorder(0)).toBe(400);
    expect(uhcBorder(300)).toBe(400);
    expect(uhcBorder(1950)).toBeLessThan(400);
    expect(uhcBorder(3600)).toBe(50);
  });
});

describe("Random Drops", () => {
  it("maps every item to another, one to one, the same all through a world and different in the next", () => {
    const a = randomDropTable(1234), b = randomDropTable(1234), c = randomDropTable(99);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(new Set(a.values()).size).toBe(a.size);
    expect([...a.keys()].sort()).toEqual([...a.values()].sort());
    let same = 0;
    for (const [k, v] of a) if (c.get(k) === v) same++;
    expect(same).toBeLessThan(a.size / 4);
    expect([...a.values()]).not.toContain(itemId("bedrock"));
  });
});

describe("speedrun", () => {
  it("splits only on advancements that exist", async () => {
    const { ADVANCEMENTS } = await import("@/craft/engine/advancements");
    for (const [id] of SPLITS) expect(ADVANCEMENTS.some((a) => a.id === id), id).toBe(true);
  });
});

describe("a mode's word to a guest", () => {
  it("keeps what is well formed and drops the rest", () => {
    const t = sanitizeModeTell({
      msg: "hello", color: "#ff0000", title: "Wave 3", sub: "go", gm: "spectator", frozen: true, maxHealth: 99, reset: true,
      obj: { title: "Waves", lines: [["Wave", "3"], ["x".repeat(100), 5]] }, border: { x: 1, z: 2, radius: -4 },
    });
    expect(t.msg).toBe("hello");
    expect(t.gm).toBe("spectator");
    expect(t.maxHealth).toBe(20);
    expect(t.reset).toBe(true);
    expect(t.border).toEqual({ x: 1, z: 2, radius: 1 });
    expect(t.obj?.lines[1]).toEqual(["x".repeat(40), "5"]);
    const bad = sanitizeModeTell({ gm: "god", color: "red; background:url(x)", msg: 5, border: { x: "a" }, obj: "nope", reset: "yes" });
    expect(bad).toEqual({});
  });
});
