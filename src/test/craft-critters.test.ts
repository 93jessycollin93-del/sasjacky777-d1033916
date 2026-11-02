import { describe, expect, it } from "vitest";
import { BIOMES } from "@/craft/engine/biomes";
import { Rng } from "@/craft/engine/rng";
import {
  baseForm, catchOdds, effectiveness, evolve, gainXp, habitatBiomes, levelForXp, makeCritter, maxHp, MOVES, movesAt, pickWild, restore,
  sanitizeCritter, SPECIES, SPECIES_IDS, STARTERS, giveMedicine, statsOf, throwOrb, TYPES, xpForLevel, type Critter,
} from "@/craft/engine/critters";
import { CRITTER_COLORS, CRITTER_MODELS, critterBoxes } from "@/craft/render/critterModels";
import { CATEGORY_ORDER, MODES, modeDef } from "@/craft/modes/modes";
import { mapLayout } from "@/craft/engine/maps";
import { Generator } from "@/craft/engine/worldgen";
import { BADGES, regionTrainers, rivalStarter, towerTrainer, trainerById, trainerTeam } from "@/craft/engine/trainers";
import { parseCritterOp } from "@/craft/game/critterPlay";
import { safariPoints } from "@/craft/modes/critterModes";
import { activeOf, damageRoll, evolveAfter, foeChoice, newBattle, openingEvents, runTurn, stageMult } from "@/craft/engine/battle";

/** A random source that always says the same thing: the dice loaded one way. */
const always = (v: number) => () => v;

describe("critter data", () => {
  it("keeps every species, move and evolution pointing at something real", () => {
    for (const id of SPECIES_IDS) {
      const s = SPECIES[id];
      expect(s.types.length, id).toBeGreaterThan(0);
      for (const t of s.types) expect(TYPES).toContain(t);
      for (const [lvl, m] of s.learnset) { expect(MOVES[m], `${id} learns ${m}`).toBeDefined(); expect(lvl).toBeGreaterThanOrEqual(1); }
      if (s.evolves) { expect(SPECIES[s.evolves.to], `${id} evolves into ${s.evolves.to}`).toBeDefined(); expect(s.evolves.level).toBeGreaterThan(1); }
      // Every critter hatches knowing something to do.
      expect(movesAt(id, 1).length, id).toBeGreaterThan(0);
    }
  });

  it("lets critters live only in biomes this world has", () => {
    const names = new Set(BIOMES.map((b) => b.name));
    for (const b of habitatBiomes()) expect(names.has(b), b).toBe(true);
  });

  it("offers three starters, one of each of fire, water and grass", () => {
    expect(STARTERS.map((s) => SPECIES[s].types[0]).sort()).toEqual(["fire", "grass", "water"]);
    for (const s of STARTERS) expect(SPECIES[s].evolves, s).toBeDefined();
  });

  it("names no species or move after one that already exists", () => {
    const names = [...SPECIES_IDS.map((id) => SPECIES[id].name), ...Object.values(MOVES).map((m) => m.name)];
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every species a model that fits its skin sheet, and colours to paint it", () => {
    for (const id of SPECIES_IDS) {
      expect(CRITTER_MODELS[`critter_${id}`], id).toBeDefined();
      expect(CRITTER_COLORS[id], id).toBeDefined();
      // Something to look at: a head, or (a wisp, a jelly) a body.
      expect(critterBoxes(`critter_${id}`).some((b) => b.name === "head" || b.name === "body"), id).toBe(true);
      for (const b of critterBoxes(`critter_${id}`)) expect(b.uv[1] + b.size[2] + b.size[1], `${id} ${b.name}`).toBeLessThanOrEqual(64);
    }
  });

  it("reads types as elements do: water beats fire, lightning fizzles on the ground, a spirit passes through the ordinary", () => {
    expect(effectiveness("water", ["fire"])).toBe(2);
    expect(effectiveness("fire", ["water"])).toBe(0.5);
    expect(effectiveness("electric", ["earth"])).toBe(0);
    expect(effectiveness("normal", ["spirit"])).toBe(0);
    // Two types multiply: grass into a water and earth critter is four times as strong.
    expect(effectiveness("grass", ["earth", "water"])).toBe(4);
  });
});

describe("growing up", () => {
  it("counts experience in cubes, and reads a level back out of it", () => {
    for (const l of [1, 2, 5, 16, 50, 100]) expect(levelForXp(xpForLevel(l))).toBe(l);
    expect(xpForLevel(10)).toBeLessThan(xpForLevel(11));
  });

  it("raises stats with level, and health most of all", () => {
    const iv = { hp: 8, atk: 8, def: 8, sp: 8, spd: 8 };
    const low = statsOf("emberkit", 5, iv), high = statsOf("emberkit", 50, iv);
    expect(high.hp).toBeGreaterThan(low.hp * 5);
    expect(high.atk).toBeGreaterThan(low.atk);
  });

  it("learns its line's moves as it levels, and asks before forgetting one", () => {
    const c = makeCritter("emberkit", 6, new Rng(1));
    expect(c.moves.map((m) => m.id)).toEqual(["scratch", "growl"]);
    const r = gainXp(c, xpForLevel(7) - c.xp);
    expect(r.levels).toEqual([7]);
    expect(r.learned).toEqual(["cinders"]);
    const full = makeCritter("emberkit", 21, new Rng(2));
    expect(full.moves).toHaveLength(4);
    const r2 = gainXp(full, xpForLevel(22) - full.xp);
    // A fifth move waits for its trainer to choose what to forget.
    expect(r2.offered).toEqual(["brace"]);
    expect(full.moves).toHaveLength(4);
  });

  it("evolves at its level into the next of its line, keeping its share of health", () => {
    const c = makeCritter("emberkit", 16, new Rng(3));
    c.hp = Math.floor(maxHp(c) / 2);
    expect(evolve(c)).toBe("cinderlynx");
    expect(c.species).toBe("cinderlynx");
    expect(c.hp / maxHp(c)).toBeCloseTo(0.5, 1);
    expect(baseForm("pyrolion")).toBe("emberkit");
    // Far enough past both stages, a critter skips straight through them after a battle.
    const late = makeCritter("wrigglet", 12, new Rng(4));
    expect(evolveAfter([late]).map((e) => e.to)).toEqual(["cocoonix", "lumoth"]);
  });

  it("heals to full at a station, uses restored and status gone", () => {
    const c = makeCritter("sparkhog", 20, new Rng(5));
    c.hp = 1; c.status = "burn"; c.moves[0].pp = 0;
    restore(c);
    expect(c.hp).toBe(maxHp(c));
    expect(c.status).toBeNull();
    expect(c.moves[0].pp).toBe(MOVES[c.moves[0].id].pp);
  });
});

describe("medicine", () => {
  it("heals, cures and revives only what needs it, and says so when it would do nothing", () => {
    const c = makeCritter("bogpup", 10, new Rng(8));
    expect(giveMedicine(c, "herbal_tonic").ok).toBe(false);
    c.hp = 1;
    expect(giveMedicine(c, "herbal_tonic")).toEqual({ ok: true, text: "Bogpup recovered 20 health." });
    c.hp = 0;
    expect(giveMedicine(c, "strong_tonic").text).toMatch(/Revival Herb/);
    expect(giveMedicine(c, "revival_herb").ok).toBe(true);
    expect(c.hp).toBe(Math.floor(maxHp(c) / 2));
    expect(giveMedicine(c, "honey_cake").ok).toBe(true);
    expect(c.level).toBe(11);
  });
});

describe("saves and messages", () => {
  it("trusts nothing from a save: unknown species refused, stats clamped, moves checked", () => {
    expect(sanitizeCritter({ species: "not_a_thing", level: 5 })).toBeNull();
    const c = sanitizeCritter({ species: "chirplet", level: 9999, hp: 1e9, iv: { hp: 99 }, moves: [{ id: "peck", pp: 999 }, { id: "fake", pp: 1 }], nick: "x".repeat(40) })!;
    expect(c.level).toBe(100);
    expect(c.hp).toBe(maxHp(c));
    expect(c.iv.hp).toBe(15);
    expect(c.moves).toEqual([{ id: "peck", pp: MOVES.peck.pp }]);
    expect(c.nick).toHaveLength(16);
  });

  it("round-trips a critter through JSON unchanged", () => {
    const c = makeCritter("glaciarch", 60, new Rng(6), { ot: "Ash", met: "the summit" });
    expect(sanitizeCritter(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
});

describe("the wild", () => {
  it("finds the region's commons on its plains, grown to the level it meets them at", () => {
    const rng = new Rng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(pickWild("Plains", 3, () => rng.next())!);
    expect(seen.has("chirplet")).toBe(true);
    expect(seen.has("nibbit")).toBe(true);
    expect(seen.has("stormhawk")).toBe(false);
    const grown = new Set<string>();
    for (let i = 0; i < 500; i++) grown.add(pickWild("Plains", 40, () => rng.next())!);
    expect(grown.has("stormhawk")).toBe(true);
    expect(pickWild("The End", 10, Math.random)).toBeNull();
  });

  it("never meets a stage in the wild younger than its line reaches it", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 400; i++) {
      const s = pickWild("Windswept Hills", 3, () => rng.next())!;
      expect(["galewing", "stormhawk", "bouldron", "stormhog"], s).not.toContain(s);
    }
  });

  it("never lets the legend wander the wilds", () => {
    expect(SPECIES.glaciarch.habitat).toEqual([]);
  });
});

describe("capture", () => {
  it("holds a worn-down, sleeping critter far more often than a fresh one", () => {
    const fresh = catchOdds("chirplet", 20, 20, null, 1).chance;
    const worn = catchOdds("chirplet", 1, 20, "sleep", 1).chance;
    expect(worn).toBeGreaterThan(fresh);
    expect(catchOdds("glaciarch", 200, 200, null, 1).chance).toBeLessThan(0.02);
    // The star orb holds anything.
    expect(catchOdds("glaciarch", 200, 200, null, 255).chance).toBe(1);
  });

  it("shakes up to three times, and holds only if it passes all four checks", () => {
    expect(throwOrb({ shake: 1 }, always(0.99))).toEqual({ shakes: 3, caught: true });
    expect(throwOrb({ shake: 0.5 }, always(0.9))).toEqual({ shakes: 0, caught: false });
  });
});

describe("battle", () => {
  const party = (species: string, level: number, seed: number): Critter[] => [makeCritter(species, level, new Rng(seed))];

  it("works the harm out in the classic shape: level, power, and attack over defence", () => {
    expect(damageRoll(50, 80, 100, 100, 1)).toBe(37);
    expect(damageRoll(50, 80, 200, 100, 1)).toBeGreaterThan(damageRoll(50, 80, 100, 100, 1) * 1.8);
    expect(stageMult(2)).toBe(2);
    expect(stageMult(-2)).toBe(0.5);
  });

  it("opens with the foe announced and the player's first standing critter sent out", () => {
    const mine = [makeCritter("nibbit", 5, new Rng(1)), makeCritter("chirplet", 5, new Rng(2))];
    mine[0].hp = 0;
    const b = newBattle("wild", "Red", mine, "", party("wrigglet", 3, 3));
    expect(activeOf(b, "player").species).toBe("chirplet");
    expect(openingEvents(b).map((e) => e.text)).toEqual(["A wild Wrigglet appeared!", "Go, Chirplet!"]);
  });

  it("lets a strong critter win a wild battle, with experience for the winner", () => {
    const mine = party("pyrolion", 50, 10);
    const b = newBattle("wild", "Red", mine, "", party("wrigglet", 3, 11));
    const xp = mine[0].xp;
    const rng = new Rng(12);
    for (let i = 0; i < 5 && !b.over; i++) runTurn(b, { kind: "move", index: mine[0].moves.findIndex((m) => MOVES[m.id].power > 0) }, () => rng.next());
    expect(b.over).toBe("win");
    expect(mine[0].xp).toBeGreaterThan(xp);
  });

  it("spends a move's uses, and turns a critter with none left to struggling", () => {
    const mine = party("chirplet", 10, 20);
    const b = newBattle("wild", "Red", mine, "", party("pebbling", 60, 21));
    const pp = mine[0].moves[0].pp;
    runTurn(b, { kind: "move", index: 0 }, () => 0.5);
    expect(mine[0].moves[0].pp).toBe(pp - 1);
    for (const m of mine[0].moves) m.pp = 0;
    const { events } = runTurn(b, { kind: "move", index: 0 }, () => 0.5);
    expect(events.some((e) => /struggles/.test(e.text))).toBe(true);
  });

  it("refuses a turn that would do nothing — healing a healthy critter, switching to a fainted one — and keeps the item", () => {
    const mine = [makeCritter("nibbit", 5, new Rng(1)), makeCritter("chirplet", 5, new Rng(2))];
    mine[1].hp = 0;
    const b = newBattle("wild", "Red", mine, "", party("wrigglet", 3, 3));
    expect(runTurn(b, { kind: "item", item: "herbal_tonic", target: 0 }, Math.random).spent).toBe(false);
    expect(runTurn(b, { kind: "switch", to: 1 }, Math.random).spent).toBe(false);
    expect(b.turn).toBe(0);
  });

  it("forbids running from a trainer and catching their critters", () => {
    const b = newBattle("trainer", "Red", party("nibbit", 5, 1), "Youngster Joe", party("chirplet", 4, 2));
    expect(runTurn(b, { kind: "run" }, Math.random).spent).toBe(false);
    expect(runTurn(b, { kind: "item", item: "capture_orb" }, Math.random).spent).toBe(false);
  });

  it("catches a wild critter with an orb that holds, and hands it over", () => {
    const b = newBattle("wild", "Red", party("nibbit", 5, 1), "", party("chirplet", 3, 2));
    const { events } = runTurn(b, { kind: "item", item: "star_orb" }, () => 0.5);
    expect(b.over).toBe("caught");
    expect(b.caught?.species).toBe("chirplet");
    expect(events.map((e) => e.t)).toContain("caught");
  });

  it("makes the player send out another when their critter faints, and ends the battle when none are left", () => {
    const mine = [makeCritter("wrigglet", 2, new Rng(1)), makeCritter("wrigglet", 2, new Rng(2))];
    const b = newBattle("trainer", "Red", mine, "Ace Mira", party("pyrolion", 60, 3));
    runTurn(b, { kind: "move", index: 0 }, () => 0.5);
    expect(mine[0].hp).toBe(0);
    expect(b.mustSwitch).toBe(true);
    // Nothing but a switch is taken while one must be made.
    expect(runTurn(b, { kind: "move", index: 0 }, () => 0.5).spent).toBe(false);
    expect(runTurn(b, { kind: "switch", to: 1 }, () => 0.5).spent).toBe(true);
    runTurn(b, { kind: "move", index: 0 }, () => 0.5);
    expect(b.over).toBe("lose");
  });

  it("has a trainer pick the move that hurts most, where a wild critter picks at random", () => {
    const foe = makeCritter("tidalotl", 40, new Rng(4));
    foe.moves = [{ id: "tackle", pp: 10 }, { id: "tidal_wave", pp: 10 }, { id: "growl", pp: 10 }];
    const b = newBattle("trainer", "Red", party("cinderam", 40, 5), "Swimmer Kai", [foe]);
    const picks = new Set<number>();
    const rng = new Rng(6);
    for (let i = 0; i < 40; i++) { const a = foeChoice(b, () => rng.next()); if (a.kind === "move") picks.add(a.index); }
    expect(picks).toEqual(new Set([1]));
  });

  it("puts sleep and paralysis on critters and lets fire shrug off a burn", () => {
    const mine = party("sproutling", 12, 1);
    mine[0].moves = [{ id: "drowsy_pollen", pp: 10 }];
    const b = newBattle("wild", "Red", mine, "", party("nibbit", 12, 2));
    runTurn(b, { kind: "move", index: 0 }, () => 0.1);
    expect(activeOf(b, "foe").status).toBe("sleep");
    const burnt = party("wisplet", 20, 3);
    burnt[0].moves = [{ id: "scorch", pp: 10 }];
    const b2 = newBattle("wild", "Red", burnt, "", party("emberkit", 20, 4));
    runTurn(b2, { kind: "move", index: 0 }, () => 0.1);
    expect(activeOf(b2, "foe").status).toBeNull();
  });

  it("runs a safari on orbs, bait and mud, with no critter of the player's sent out", () => {
    const b = newBattle("safari", "Red", [], "", party("chirplet", 5, 1), { orbs: 2 });
    expect(openingEvents(b)).toHaveLength(1);
    runTurn(b, { kind: "bait" }, () => 0.99);
    expect(b.safari!.bait).toBeGreaterThan(0);
    runTurn(b, { kind: "item", item: "park_orb" }, () => 0.99);
    expect(b.safari!.orbs).toBe(1);
    runTurn(b, { kind: "item", item: "park_orb" }, () => 0.99);
    expect(b.over).toBe("ran");
  });
});

describe("the critter modes", () => {
  it("lists every mode's category on the create screen, so none can go missing from it", () => {
    for (const m of MODES) expect(CATEGORY_ORDER, m.id).toContain(m.category);
  });

  it("offers five critter modes, each with critters in its world", () => {
    const ids = MODES.filter((m) => m.category === "critter").map((m) => m.id);
    expect(ids).toEqual(["critter_quest", "critter_craft", "critter_nuzlocke", "critter_safari", "battle_spire"]);
    for (const id of ids) expect(modeDef(id)?.fauna).toBe("critters");
  });
});

describe("trainers", () => {
  it("gives the rival the starter that beats the player's", () => {
    expect(rivalStarter("emberkit")).toBe("axolittle");
    expect(rivalStarter("axolittle")).toBe("sproutling");
    expect(rivalStarter("sproutling")).toBe("emberkit");
    expect(trainerById("rival3", "sproutling")!.team.at(-1)![0]).toBe("pyrolion");
  });

  it("builds every trainer's team from critters that exist, and four gym leaders with the four badges", () => {
    for (const t of regionTrainers()) for (const [s, l] of t.team) { expect(SPECIES[s], `${t.id} ${s}`).toBeDefined(); expect(l).toBeGreaterThan(0); }
    expect(regionTrainers().filter((t) => t.badge).map((t) => t.badge)).toEqual([...BADGES]);
  });

  it("reads a wanderer's id back into the same trainer every time, so host and guests agree", () => {
    const a = trainerById("w:12345:14:Forest")!, b = trainerById("w:12345:14:Forest")!;
    expect(a).toEqual(b);
    expect(trainerTeam(a).map((c) => c.species)).toEqual(trainerTeam(b).map((c) => c.species));
    expect(trainerById("nobody")).toBeNull();
  });

  it("sends the Spire Master every seventh challenger, stronger than the rest", () => {
    expect(towerTrainer(7, 1).cls).toBe("tycoon");
    expect(towerTrainer(6, 1).cls).toBe("tower");
    expect(towerTrainer(7, 1).team[0][1]).toBeGreaterThan(towerTrainer(6, 1).team[0][1]);
  });
});

describe("the critter maps", () => {
  const gen = (map: "critter_region" | "safari_park" | "battle_spire", seed: number) => new Generator({ seed, type: "default", dimension: "overworld", map });

  it("stands every one of the region's trainers somewhere on the road, with the Champion at the League and a legend on the summit", () => {
    for (const seed of [3, 42]) {
      const l = mapLayout("critter_region", seed, gen("critter_region", seed));
      const ids = new Set((l.npcs ?? []).map((n) => n.id));
      for (const t of regionTrainers()) expect(ids.has(t.id), `${t.id} (seed ${seed})`).toBe(true);
      expect(ids.has("professor")).toBe(true);
      expect(l.legend).toBeDefined();
      const names = (l.areas ?? []).map((a) => a.name);
      for (const n of ["Home Town", "Route 1", "Granite Town", "Victory Road", "the League"]) expect(names).toContain(n);
      // Towns are quiet: no wild critter comes into them.
      expect(l.areas!.find((a) => a.name === "Home Town")!.quiet).toBe(true);
    }
  });

  it("lays the safari's corners over lands this world has critters for, and gives the spire its pad", () => {
    const biomes = new Set(BIOMES.map((b) => b.name));
    const safari = mapLayout("safari_park", 5, gen("safari_park", 5));
    for (const a of safari.areas ?? []) { expect(biomes.has(a.biome!), a.name).toBe(true); expect(pickWild(a.biome!, 10, Math.random), a.name).not.toBeNull(); }
    const spire = mapLayout("battle_spire", 1, gen("battle_spire", 1));
    expect(spire.pads).toHaveLength(2);
  });
});

describe("a guest's critter messages", () => {
  it("are taken only in the shape expected, with every number finite and every name short", () => {
    expect(parseCritterOp(["claim", 7, 1.5, -2])).toEqual(["claim", 7, 1.5, -2]);
    expect(parseCritterOp(["claim", "7", 1, 2])).toBeNull();
    expect(parseCritterOp(["end", 3, "exploded"])).toBeNull();
    expect(parseCritterOp(["out", "mine", "u1", "emberkit", 500, 1, 0, 64, 0, null, null, 1])).toEqual(["out", "mine", "u1", "emberkit", 100, 1, 0, 64, 0, NaN, NaN, 1]);
    expect(parseCritterOp(["out", "boss", "u1", "emberkit", 5, 0, 0, 64, 0, 0, 0, 0])).toBeNull();
    expect(parseCritterOp(["out", "mine", "u1", "x".repeat(200), 5, 0, 0, 64, 0, 0, 0, 0])).toBeNull();
    expect(parseCritterOp(["score", "chirplet"])).toEqual(["score", "chirplet"]);
    expect(parseCritterOp("claim")).toBeNull();
  });
});

describe("the park's score", () => {
  it("counts a rare critter for more than a common one, and a legend most", () => {
    expect(safariPoints("nibbit")).toBe(1);
    expect(safariPoints("frostpaw")).toBe(3);
    expect(safariPoints("scalekin")).toBe(8);
    expect(safariPoints("glaciarch")).toBeGreaterThan(safariPoints("scalekin"));
  });
});
