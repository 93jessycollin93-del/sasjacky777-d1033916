import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { B } from "@/craft/engine/blocks";
import { Chunk } from "@/craft/engine/chunk";
import { blockIndex, CHUNK_VOLUME } from "@/craft/engine/constants";
import { matchRecipe, recipeResult } from "@/craft/engine/crafting";
import { AreaCloud, FireworkRocket, Projectile, type Entity, type EntityContext, type PlayerRef } from "@/craft/engine/entities";
import {
  burstDamage, burstParticle, fadeFromGrid, parseBurstParticle, rocketFromGrid, rocketLife, starFromGrid, type Rocket,
} from "@/craft/engine/fireworks";
import { sanitizeStack, type Slot } from "@/craft/engine/inventory";
import { itemId, type ItemStack, type StatusEffect } from "@/craft/engine/items";
import { lightChunk } from "@/craft/engine/lighting";
import { Mob } from "@/craft/engine/mobs";
import { brewResult, potionOfItem } from "@/craft/engine/potions";
import { World } from "@/craft/engine/world";
import { tooltipLines } from "@/craft/ui/itemText";
import { EndPoem } from "@/craft/ui/EndPoem";

const st = (name: string, count = 1): ItemStack => ({ id: itemId(name), count });
const grid = (...names: (string | null)[]): Slot[] => {
  const g: Slot[] = names.map((n) => (n ? st(n) : null));
  while (g.length < 9) g.push(null);
  return g;
};

describe("firework stars", () => {
  it("are gunpowder and dyes, shaped and finished by what else goes in", () => {
    expect(starFromGrid(grid("gunpowder", "red_dye", "blue_dye"))!.burst).toEqual({ shape: "small", colors: [1, 3] });
    expect(starFromGrid(grid("gunpowder", "yellow_dye", "fire_charge"))!.burst!.shape).toBe("large");
    expect(starFromGrid(grid("gunpowder", "yellow_dye", "gold_nugget"))!.burst!.shape).toBe("star");
    expect(starFromGrid(grid("gunpowder", "yellow_dye", "feather"))!.burst!.shape).toBe("burst");
    expect(starFromGrid(grid("gunpowder", "white_dye", "diamond", "glowstone_dust"))!.burst).toEqual({ shape: "small", colors: [0], trail: true, twinkle: true });
  });

  it("refuse a grid that is not quite one", () => {
    expect(starFromGrid(grid("gunpowder"))).toBeNull();
    expect(starFromGrid(grid("gunpowder", "gunpowder", "red_dye"))).toBeNull();
    expect(starFromGrid(grid("gunpowder", "red_dye", "fire_charge", "feather"))).toBeNull();
    expect(starFromGrid(grid("gunpowder", "red_dye", "stick"))).toBeNull();
  });

  it("take colours to fade to from dyes crafted with them", () => {
    const star = starFromGrid(grid("gunpowder", "red_dye"))!;
    const faded = fadeFromGrid([star, st("yellow_dye"), st("black_dye"), null])!;
    expect(faded.burst).toEqual({ shape: "small", colors: [1], fades: [2, 7] });
  });
});

describe("firework rockets", () => {
  const red = starFromGrid(grid("gunpowder", "red_dye"))!;
  const big = starFromGrid(grid("gunpowder", "blue_dye", "fire_charge"))!;

  it("are paper, one to three gunpowder and up to seven stars — three at a time", () => {
    const made = rocketFromGrid([st("paper"), st("gunpowder"), st("gunpowder"), red, big, null, null, null, null])!;
    expect(made.count).toBe(3);
    expect(made.fw!.flight).toBe(2);
    expect(made.fw!.bursts.map((b) => b.shape)).toEqual(["small", "large"]);
    expect(rocketFromGrid(grid("paper", "gunpowder", "gunpowder", "gunpowder", "gunpowder"))).toBeNull();
    expect(rocketFromGrid(grid("gunpowder"))).toBeNull();
  });

  it("are what the crafting grid makes, stars and all", () => {
    const g = [st("paper"), st("gunpowder"), red, null];
    const r = matchRecipe(g, 2)!;
    const out = recipeResult(r, g);
    expect(out.id).toBe(itemId("firework_rocket"));
    expect(out.fw).toEqual({ flight: 1, bursts: [red.burst] });
    const s = matchRecipe([st("gunpowder"), st("red_dye"), null, null], 2)!;
    expect(recipeResult(s, [st("gunpowder"), st("red_dye"), null, null]).burst).toEqual({ shape: "small", colors: [1] });
  });

  it("carry their stars through the network and a save, and say what they hold", () => {
    const made = rocketFromGrid([st("paper"), st("gunpowder"), big, null])!;
    expect(sanitizeStack(JSON.parse(JSON.stringify(made)))).toEqual(made);
    expect(sanitizeStack({ ...made, fw: { flight: 9, bursts: [{ shape: "nope", colors: [1] }] } })!.fw).toEqual({ flight: 3, bursts: [] });
    const lines = tooltipLines(made).map((l) => l.text);
    expect(lines).toContain("Flight Duration: 1");
    expect(lines.some((l) => /Large Ball/.test(l))).toBe(true);
    expect(lines.some((l) => /Blue/.test(l))).toBe(true);
  });

  it("pack a burst into a particle name every screen can draw from", () => {
    const b = { shape: "star" as const, colors: [1, 2], fades: [7], trail: true };
    expect(parseBurstParticle(burstParticle(b))).toEqual(b);
    expect(parseBurstParticle("smoke")).toBeNull();
  });

  it("climb longer the more gunpowder is in them", () => {
    const avg = (f: number) => { let t = 0; for (let i = 0; i < 200; i++) t += rocketLife(f, Math.random); return t / 200; };
    expect(avg(1)).toBeGreaterThan(20);
    expect(avg(3)).toBeGreaterThan(avg(1) + 15);
  });

  it("hurt what stands within five blocks of a burst, and only if they carry stars", () => {
    const loaded: Rocket = { flight: 1, bursts: [{ shape: "small", colors: [1] }, { shape: "large", colors: [2] }] };
    expect(burstDamage(loaded, 0)).toBeCloseTo(9);
    expect(burstDamage(loaded, 4)).toBeGreaterThan(0);
    expect(burstDamage(loaded, 5.5)).toBe(0);
    expect(burstDamage({ flight: 1, bursts: [] }, 0)).toBe(0);
  });
});

// ---- in the world --------------------------------------------------------------------------------------

let world: World;
let spawned: Entity[];
let players: PlayerRef[];
let hurt: { id: string; amount: number }[];
let effects: { id: string; effect: StatusEffect; seconds: number }[];
let particles: string[];

const ctx = (): EntityContext => ({
  world, tick: world.tick, daylight: 1, difficulty: 2, random: Math.random, players: () => players,
  hurtPlayer: (id, amount) => { hurt.push({ id, amount }); }, givePlayer: () => 0, giveXp: () => {},
  spawn: (e) => { spawned.push(e); }, dropItem: () => {}, explode: () => {}, sound: () => {},
  particles: (kind) => { particles.push(kind); },
  entitiesNear: (x, y, z, r) => spawned.filter((m) => !m.removed && Math.abs(m.x - x) <= r && Math.abs(m.y - y) <= r && Math.abs(m.z - z) <= r),
  placeBlock: () => false,
  effectPlayer: (id, effect, seconds) => { effects.push({ id, effect, seconds }); },
});
const alex = (x: number, y: number, z: number): PlayerRef =>
  ({ id: "p1", name: "Alex", x, y, z, width: 0.6, height: 1.8, targetable: true, heldItem: 0, sneaking: false });
function tickAll(n: number): void {
  for (let i = 0; i < n; i++) {
    world.tick++;
    const c = ctx();
    for (const e of [...spawned]) if (!e.removed) { e.beginTick(); e.tick(c); }
  }
}

beforeEach(() => {
  world = new World();
  for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 10; y++) blocks[blockIndex(x, y, z)] = B.STONE;
    world.addChunk(new Chunk(cx, cz, blocks, new Uint8Array(CHUNK_VOLUME), lightChunk(blocks, cx, cz), new Uint8Array(256), new Uint8Array(256 * 9)));
  }
  spawned = []; players = []; hurt = []; effects = []; particles = [];
});

describe("a rocket in flight", () => {
  it("climbs for its whole life and bursts at the top, every star at once", () => {
    const rocket: Rocket = { flight: 1, bursts: [{ shape: "small", colors: [1] }, { shape: "star", colors: [3] }] };
    const r = FireworkRocket.launch(0.5, 11, 0.5, rocket, () => 0.5, null);
    spawned.push(r);
    tickAll(r.life - 1);
    expect(r.removed).toBe(false);
    const top = r.y;
    tickAll(2);
    expect(r.removed).toBe(true);
    expect(top).toBeGreaterThan(18);
    expect(particles.filter((p) => p.startsWith("fw|"))).toHaveLength(2);
  });

  it("bursts early on a ceiling, and hurts the player standing under it", () => {
    world.setBlock(0, 16, 0, B.STONE, 0);
    players = [alex(0.5, 11, 1.5)];
    const r = FireworkRocket.launch(0.5, 11, 0.5, { flight: 3, bursts: [{ shape: "small", colors: [1] }] }, () => 0.5, null);
    spawned.push(r);
    tickAll(30);
    expect(r.removed).toBe(true);
    expect(r.y).toBeLessThan(16.5);
    expect(hurt[0]?.amount).toBeGreaterThan(1);
  });
});

describe("dragon's breath and lingering potions", () => {
  it("brews a splash potion into a lingering one, and nothing else", () => {
    expect(brewResult("splash_potion_healing", "dragon_breath")).toBe("lingering_potion_healing");
    expect(brewResult("potion_healing", "dragon_breath")).toBeUndefined();
    expect(brewResult("lingering_potion_swiftness", "redstone")).toBe("lingering_long_potion_swiftness");
    expect(potionOfItem("lingering_potion_poison")).toMatchObject({ form: "lingering", splash: true });
  });

  it("bottles the dragon's breath, a little of the cloud at a time", () => {
    const breath = new AreaCloud(0.5, 11, 0.5, 1.2, 600, "mob:1");
    expect(breath.bottled()).toBe(true);
    expect(breath.radius).toBeCloseTo(0.7);
    const potion = new AreaCloud(0.5, 11, 0.5, 3, 600, null);
    potion.potion = "potion_poison";
    expect(potion.bottled()).toBe(false);
  });

  it("leaves a cloud that gives what stands in it a quarter of the potion, and shrinks as it does", () => {
    players = [alex(0.5, 11, 0.5)];
    const cloud = new AreaCloud(0.5, 11, 0.5, 3, 600, null);
    cloud.potion = "potion_poison";
    spawned.push(cloud);
    tickAll(6);
    expect(effects[0]).toEqual({ id: "p1", effect: "poison", seconds: Math.floor(45 / 4) });
    expect(cloud.radius).toBeLessThan(2.6);
    tickAll(600);
    expect(cloud.removed).toBe(true);
  });
});

describe("tipped arrows", () => {
  it("come eight from eight arrows round a lingering potion", () => {
    const g: Slot[] = Array.from({ length: 9 }, (_, i) => (i === 4 ? st("lingering_potion_poison") : st("arrow")));
    const out = recipeResult(matchRecipe(g, 3)!, g);
    expect(out).toEqual({ id: itemId("tipped_arrow_potion_poison"), count: 8 });
  });

  it("carry an eighth of their potion into what they hit", () => {
    const zombie = new Mob("zombie", 0.5, 11, -3.5);
    const pig = new Mob("pig", 0.5, 11, -3.5);
    spawned.push(pig);
    const a = new Projectile("arrow", 0.5, 11.5, 0.5, 0, 0, -1.5, "p1");
    a.item = itemId("tipped_arrow_potion_slowness");
    spawned.push(a);
    tickAll(4);
    expect(pig.hasEffect("slowness")).toBe(true);
    expect(pig.effects.find((e) => e.kind === "slowness")!.ticks).toBeLessThanOrEqual(Math.floor(90 / 8) * 20);
    void zombie;
  });
});

describe("the poem after the dragon", () => {
  it("speaks to the player by name and ends in thanks", () => {
    const { container } = render(<EndPoem name="Collin" onDone={() => {}} />);
    expect(container.textContent).toContain("Collin. You walked through the end, and found a beginning.");
    expect(container.textContent).toContain("Thank you for playing.");
    expect(container.textContent).toContain("not affiliated with Mojang or Microsoft");
  });
});
