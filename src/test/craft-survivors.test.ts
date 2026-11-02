import { describe, expect, it } from "vitest";
import { itemByName } from "@/craft/engine/items";
import { Player } from "@/craft/engine/player";
import { invalid, NO_PERKS, OCCUPATIONS, perksOf, pointsLeft, sanitizeSurvivor, TRAITS } from "@/craft/engine/survivors";
import { knoxWound } from "@/craft/engine/vitals";

describe("who you were", () => {
  it("leaves the ordinary player exactly as they were until a choice is made", () => {
    const p = perksOf(null);
    expect({ ...p, knows: [], kit: [] }).toEqual({ ...NO_PERKS, knows: [], kit: [] });
  });

  it("gives every occupation a kit the game really has", () => {
    for (const o of OCCUPATIONS) for (const [name, n] of perksOf({ occupation: o.id, traits: [] }).kit) {
      expect(() => itemByName(name), `${o.id}: ${name}`).not.toThrow();
      expect(n).toBeGreaterThan(0);
    }
  });

  it("lets the jobless spend more on who they are, and a well-kitted job less", () => {
    expect(pointsLeft({ occupation: "unemployed", traits: [] })).toBeGreaterThan(pointsLeft({ occupation: "police_officer", traits: [] }));
    // Strong costs six: the unemployed can afford it; a police officer must take something bad to pay for it.
    expect(invalid({ occupation: "unemployed", traits: ["strong"] })).toBeNull();
    expect(invalid({ occupation: "police_officer", traits: ["strong"] })).toMatch(/points/);
    expect(invalid({ occupation: "police_officer", traits: ["strong", "unfit", "clumsy", "weak_stomach"] })).toBeNull();
  });

  it("will not let opposites both be true, a trait be taken twice, or a job be made up", () => {
    expect(invalid({ occupation: "unemployed", traits: ["strong", "weak"] })).toMatch(/cannot both/);
    expect(invalid({ occupation: "unemployed", traits: ["handy", "handy"] })).toMatch(/twice/);
    expect(invalid({ occupation: "astronaut", traits: [] })).toMatch(/living/);
    for (const t of TRAITS) for (const x of t.excludes ?? []) expect(TRAITS.find((o) => o.id === x)?.excludes, `${t.id}↔${x}`).toContain(t.id);
  });

  it("folds a whole character into numbers the game multiplies by", () => {
    const p = perksOf({ occupation: "carpenter", traits: ["strong", "thin_skinned", "outdoorsman", "hearty_appetite"] });
    expect(p.melee).toBeCloseTo(1.3);
    expect(p.infection).toBeCloseTo(1.6);
    expect(p.warmth).toBeCloseTo(0.35);
    expect(p.hunger).toBeCloseTo(1.35);
    expect(p.knows).toContain("carpentry");
    expect(p.kit.map(([n]) => n)).toEqual(expect.arrayContaining(["hammer", "plank", "nails"]));
  });

  it("makes thick skin halve a scratch's odds — and leaves a bite certain", () => {
    let s = 5;
    const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const rate = (skin: number) => {
      let n = 0, hit = 0, bites = 0, bitten = 0;
      for (let i = 0; i < 40000; i++) {
        const w = knoxWound(rng, skin);
        if (w.wound === "bite") { bites++; if (w.infects) bitten++; } else { n++; if (w.infects) hit++; }
      }
      expect(bitten).toBe(bites);
      return hit / n;
    };
    expect(rate(0.5)).toBeLessThan(rate(1) * 0.7);
    expect(rate(1.6)).toBeGreaterThan(rate(1) * 1.3);
  });

  it("keeps the choice through a save, and throws out one that was tampered with", () => {
    const p = new Player("p", "Pat");
    p.setSurvivor({ occupation: "nurse", traits: ["fast_healer", "clumsy"] });
    const back = new Player("p", "Pat");
    back.load(JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.survivor).toEqual({ occupation: "nurse", traits: ["fast_healer", "clumsy"] });
    expect(back.perks.heal).toBeGreaterThan(1.5);
    expect(sanitizeSurvivor({ occupation: "police_officer", traits: ["strong", "athletic", "thick_skinned"] })).toBeNull();
    expect(sanitizeSurvivor("nurse")).toBeNull();
    expect(new Player("p", "Pat").toJSON().survivor).toBeUndefined();
  });

  it("makes a hungry survivor hungrier and a fast one faster", () => {
    const a = new Player("p", "Pat"), b = new Player("p", "Pat");
    b.setSurvivor({ occupation: "unemployed", traits: ["hearty_appetite", "athletic"] });
    a.addExhaustion(4); b.addExhaustion(4);
    expect(b.exhaustion).toBeGreaterThan(a.exhaustion);
    expect(b.perks.speed).toBeGreaterThan(1.1);
  });
});
