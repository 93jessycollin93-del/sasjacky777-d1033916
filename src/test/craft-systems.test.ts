import { describe, expect, it } from "vitest";
import { CLASS, classNear, REAL_STARS, SOL, SUN_POS, systemOutlook, type Star } from "@/craft/space/galaxy";
import { KNOWN_SYSTEMS } from "@/craft/space/exoplanets";
import {
  axisOf, EARTH_RADIUS, equilibrium, greenhouse, keplerPosition, makeupOfKnown, periodOf, radiusFor, SUN_GM, systemOf, systemPositions, systemSummary, type StarSystemDef,
} from "@/craft/space/systems";
import { AU, len, sub } from "@/craft/space/kepler";

const real = (name: string): Star => REAL_STARS.find((s) => s.name === name)!;
const sample = (cls: "G" | "K" | "M" | "F", n: number): Star[] => classNear([SUN_POS[0] + 400, SUN_POS[1] - 300, SUN_POS[2]], CLASS[cls]).stars.slice(0, n);
const planetsOf = (sys: StarSystemDef) => sys.bodies.filter((b) => b.kind === "planet");
const moonsOf = (sys: StarSystemDef) => sys.bodies.filter((b) => b.kind === "moon");
const orbit = (b: StarSystemDef["bodies"][number]) => b.orbit as Extract<typeof b.orbit, { kind: "kepler" }>;

describe("every star's planets", () => {
  it("builds the same system for a star every time — and none for the Sun, whose system is the real one", () => {
    const st = sample("G", 3)[2];
    const a = JSON.stringify(systemOf(st)), b = JSON.stringify(systemOf({ ...st }));
    expect(a).toBe(b);
    expect(systemOf(SOL)).toBeNull();
  });

  it("gives a charted star exactly the planets its card on the galaxy map expected", () => {
    for (const st of [...sample("G", 40), ...sample("M", 40)]) expect(planetsOf(systemOf(st)!).length, st.name).toBe(systemOutlook(st).planets);
  });

  it("uses the real planets where astronomers found them: TRAPPIST-1's seven at their measured periods and sizes", () => {
    const sys = systemOf(real("TRAPPIST-1"))!;
    const ps = planetsOf(sys);
    expect(ps.map((p) => p.name.split(" ").pop())).toEqual(["b", "c", "d", "e", "f", "g", "h"]);
    expect(orbit(ps[0]).period).toBeCloseTo(1.51088, 4);
    expect(ps[3].radius / EARTH_RADIUS).toBeCloseTo(0.92, 2);
    // The catalogue's axes agree with Kepler's third law for its star's mass.
    for (const p of KNOWN_SYSTEMS["TRAPPIST-1"].planets) expect(axisOf(p.period, KNOWN_SYSTEMS["TRAPPIST-1"].mass) / p.a!).toBeCloseTo(1, 1);
    // JWST found b and c bare; e is the one that could hold water.
    expect(ps[0].world!.air).toBeNull();
    expect(ps[3].world!.habitable).toBe(true);
    for (const p of ps) { expect(p.world!.status).toBe("known"); expect(p.world!.life).toBe("none"); expect(p.locked).toBe(true); }
    const prox = planetsOf(systemOf(real("Proxima Centauri"))!);
    expect(prox.map((p) => p.name)).toEqual(["Proxima Centauri d", "Proxima Centauri b"]);
  });

  it("says what is real, what is estimated and what is the game's invention", () => {
    const sirius = systemOf(real("Sirius A"))!;
    for (const p of planetsOf(sirius)) expect(p.world!.status).toBe("hypothetical");
    const struve = systemOf(real("Struve 2398"))!;
    expect(planetsOf(struve)).toHaveLength(2);
    for (const p of planetsOf(struve)) expect(p.world!.status).toBe("approx");
    for (const p of planetsOf(systemOf(sample("K", 5)[4])!)) expect(p.world!.status).toBe("generated");
    expect(planetsOf(systemOf(real("51 Pegasi"))!)[0].facts).toMatch(/Dimidium/);
  });

  it("puts every catalogued planet's star on the galaxy map, with the number of planets the catalogue gives", () => {
    for (const [name, known] of Object.entries(KNOWN_SYSTEMS)) {
      const st = REAL_STARS.find((s) => s.name === name);
      expect(st, name).toBeDefined();
      expect(st!.planets, name).toBe(known.planets.length);
    }
  });

  it("keeps Kepler's third law: every year matches its orbit and the masses it goes round", () => {
    for (const st of [...sample("K", 25), real("55 Cancri"), real("HR 8799")]) {
      const sys = systemOf(st)!;
      for (const p of planetsOf(sys)) expect(orbit(p).period / periodOf(orbit(p).a / AU, sys.mass), p.name).toBeCloseTo(1, 6);
      for (const m of moonsOf(sys)) {
        const parent = sys.bodies.find((b) => b.id === m.parent)!;
        const expected = (2 * Math.PI * Math.sqrt(orbit(m).a ** 3 / (parent.gm! + m.gm!))) / 86400;
        expect(orbit(m).period / expected, m.name).toBeCloseTo(1, 6);
      }
    }
  });

  it("spaces planets outward so their orbits never cross, and keeps moons close enough to be held", () => {
    for (const st of [...sample("G", 40), ...sample("M", 40)]) {
      const sys = systemOf(st)!;
      const ps = planetsOf(sys);
      for (let i = 1; i < ps.length; i++) {
        const inner = orbit(ps[i - 1]), outer = orbit(ps[i]);
        expect(outer.a * (1 - outer.e), `${ps[i].name}`).toBeGreaterThan(inner.a * (1 + inner.e));
      }
      for (const m of moonsOf(sys)) {
        const p = sys.bodies.find((b) => b.id === m.parent)!;
        const hill = orbit(p).a * Math.cbrt(p.gm! / (3 * SUN_GM * sys.mass));
        expect(orbit(m).a, m.name).toBeGreaterThan(p.radius * 2);
        expect(orbit(m).a, m.name).toBeLessThan(hill * 0.4);
      }
    }
  });

  it("makes worlds by where they are: molten close in, water only where it can stay liquid, ice out in the cold", () => {
    for (const st of [...sample("G", 60), ...sample("K", 60), ...sample("M", 60)]) {
      for (const b of systemOf(st)!.bodies) {
        const w = b.world;
        if (!w) continue;
        if (w.type === "lava") expect(w.temp, b.name).toBeGreaterThan(850);
        if (w.habitable) {
          expect(w.temp, b.name).toBeGreaterThanOrEqual(240);
          expect(w.temp, b.name).toBeLessThanOrEqual(330);
          expect(w.air!.pressure, b.name).toBeGreaterThanOrEqual(0.3);
        }
        if (w.type === "icy" || w.type === "nitrogen") expect(w.temp, b.name).toBeLessThan(273);
        // Oxygen comes from life: breathable air only where plants have made it, on a world with seas.
        if (w.air?.breathable) { expect(w.habitable).toBe(true); expect(["plants", "animals"]).toContain(w.life); }
        if (w.surface === null) expect(["minineptune", "icegiant", "gasgiant", "hotjupiter"].includes(w.type) || b.radius < 150, b.name).toBe(true);
      }
    }
  });

  it("finds seas round a fair share of Sun-like stars, and giants out past the snow line", () => {
    const g = sample("G", 400).map((s) => systemOf(s)!);
    const withSeas = g.filter((s) => systemSummary(s).habitable > 0).length / g.length;
    const withGiant = g.filter((s) => s.bodies.some((b) => b.world?.type === "gasgiant")).length / g.length;
    expect(withSeas).toBeGreaterThan(0.08);
    expect(withSeas).toBeLessThan(0.45);
    expect(withGiant).toBeGreaterThan(0.05);
    expect(withGiant).toBeLessThan(0.35);
    for (const s of g) for (const b of s.bodies) if (b.world?.type === "gasgiant" && (b.orbit as { a: number }).a / AU > 0.2) expect((b.orbit as { a: number }).a / AU).toBeGreaterThan(s.snowLine * 0.9);
  });

  it("sizes worlds by what they are made of, and knows a planet's makeup from its measured density", () => {
    expect(radiusFor(1, "rock")).toBeCloseTo(1, 5);
    expect(radiusFor(0.107, "rock") * EARTH_RADIUS).toBeGreaterThan(3200);
    expect(radiusFor(0.107, "rock") * EARTH_RADIUS).toBeLessThan(3600);
    expect(radiusFor(317.83, "gas") * EARTH_RADIUS).toBeGreaterThan(69000);
    expect(radiusFor(317.83, "gas") * EARTH_RADIUS).toBeLessThan(73000);
    expect(radiusFor(17.1, "envelope")).toBeGreaterThan(3.5);
    expect(radiusFor(17.1, "envelope")).toBeLessThan(4.4);
    expect(makeupOfKnown({ mass: 7.99, radius: 1.88 })).toBe("rock");
    expect(makeupOfKnown({ mass: 8.2, radius: 2.74 })).toBe("envelope");
    expect(makeupOfKnown({ radius: 11.3 })).toBe("gas");
  });

  it("warms the ground by its air: the Earth's 33 degrees, Venus's five hundred", () => {
    expect(equilibrium(1, 1)).toBeCloseTo(254.6, 0);
    expect(greenhouse(1, 255)).toBeCloseTo(33, 0);
    expect(equilibrium(1, 0.723) + greenhouse(92, 300)).toBeGreaterThan(650);
    expect(greenhouse(0, 255)).toBe(0);
  });

  it("puts every body where its orbit says: planets their distance from the star, moons beside their planets", () => {
    const sys = systemOf(sample("G", 30).find((s) => moonsOf(systemOf(s)!).length > 0)!)!;
    const at = systemPositions(sys, 2460000.5);
    for (const b of sys.bodies) {
      if (b.orbit.kind !== "kepler") continue;
      const rel = keplerPosition(b.orbit, 2460000.5);
      const d = len(rel);
      expect(d).toBeGreaterThanOrEqual(b.orbit.a * (1 - b.orbit.e) * 0.999999);
      expect(d).toBeLessThanOrEqual(b.orbit.a * (1 + b.orbit.e) * 1.000001);
      const parent = at.get(b.parent!)!;
      expect(len(sub(at.get(b.id)!, parent))).toBeCloseTo(d, 3);
    }
  });
});
