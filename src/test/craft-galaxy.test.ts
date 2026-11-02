import { describe, expect, it } from "vitest";
import {
  armAt, CLASS, CLASSES, densityOf, distance, galacticPosition, galaxyCloud, KNOWN_BUBBLE_PC, LY_PER_PC, REAL_STARS, regionAt,
  relativeDensity, sectorName, seenFromSun, starById, starPhysics, starsInCell, starsNear, SUN_POS, toGalactic, totalStars, rngFrom,
} from "@/craft/space/galaxy";

const real = (name: string) => REAL_STARS.find((s) => s.name === name)!;
const ly = (pc: number) => pc * LY_PER_PC;

describe("the galaxy's frame", () => {
  it("puts the black hole at the centre where Sagittarius A* is in our sky, and the pole at 90°", () => {
    const sgr = toGalactic(266.4168, -29.0078);
    expect(Math.min(sgr.l, 360 - sgr.l)).toBeLessThan(0.1);
    expect(Math.abs(sgr.b)).toBeLessThan(0.1);
    expect(toGalactic(192.8595, 27.1283).b).toBeCloseTo(90, 2);
    // 26,670 light-years to the centre.
    expect(ly(distance(SUN_POS, [0, 0, 0]))).toBeCloseTo(26673, -2);
  });

  it("places the real stars where they are: Sirius 8.6 light-years off, Proxima a fifth of a light-year from Alpha Centauri", () => {
    expect(ly(distance(real("Sirius A").pos, SUN_POS))).toBeCloseTo(8.6, 1);
    expect(ly(distance(real("Proxima Centauri").pos, real("Alpha Centauri A").pos))).toBeLessThan(0.3);
    const b = seenFromSun(real("Betelgeuse").pos);
    expect(b.l).toBeCloseTo(199.8, 0);
    expect(b.b).toBeCloseTo(-8.96, 0);
  });

  it("puts the Sun in the Orion Spur, between the Sagittarius Arm inside and the Perseus Arm outside", () => {
    expect(regionAt(SUN_POS)).toBe("the Orion Spur");
    let inner = { v: 0, R: 0 }, outer = { v: 0, R: 0 };
    for (let R = 6; R < 11; R += 0.05) {
      const a = armAt(R, Math.PI);
      if (a.arm === "Sagittarius–Carina Arm" && a.value > inner.v) inner = { v: a.value, R };
      if (a.arm === "Perseus Arm" && a.value > outer.v) outer = { v: a.value, R };
    }
    expect(inner.R).toBeLessThan(8.178);
    expect(outer.R).toBeGreaterThan(8.178);
    expect(outer.R - inner.R).toBeGreaterThan(2);
  });
});

describe("where the stars are", () => {
  it("has about a tenth of a star per cubic parsec here, three in four of them red dwarfs", () => {
    const all = CLASSES.reduce((a, c) => a + densityOf(c.cls, SUN_POS), 0);
    expect(all).toBeGreaterThan(0.08);
    expect(all).toBeLessThan(0.14);
    expect(densityOf("M", SUN_POS) / all).toBeGreaterThan(0.5);
    for (const c of CLASSES) if (c.cls !== "M") expect(densityOf(c.cls, SUN_POS)).toBeLessThan(densityOf("M", SUN_POS));
  });

  it("makes as many as the density says: counted in a sphere, the stars come out at the census's rate", () => {
    const center = galacticPosition(100, 30, 400);
    const field = starsNear(center);
    const r = 25;
    const counted = field.stars.filter((s) => !s.real && distance(s.pos, center) < r && ["G", "K", "M", "F"].includes(s.cls)).length;
    const expected = (["G", "K", "M", "F"] as const).reduce((a, c) => a + densityOf(c, center), 0) * (4 / 3) * Math.PI * r ** 3;
    expect(counted / expected).toBeGreaterThan(0.8);
    expect(counted / expected).toBeLessThan(1.2);
  });

  it("gathers young stars into the thin disk and the spiral arms, and old ones everywhere", () => {
    expect(relativeDensity("young", [-8178, 0, 1000])).toBeLessThan(1e-3);
    expect(relativeDensity("old", [-8178, 0, 1000])).toBeGreaterThan(0.02);
    // On the Perseus Arm and between it and the Sun: the young population cares, the old barely.
    const on: [number, number, number] = [-10100, 0, 0], off: [number, number, number] = [-9000, 0, 0];
    const youngRatio = relativeDensity("young", on) / relativeDensity("young", off);
    const oldRatio = relativeDensity("old", on) / relativeDensity("old", off);
    expect(youngRatio).toBeGreaterThan(3);
    expect(oldRatio).toBeLessThan(1.6);
  });

  it("packs the bar and bulge a hundred times as thick with old stars as the neighbourhood", () => {
    expect(relativeDensity("old", [0, 0, 0])).toBeGreaterThan(60);
    expect(regionAt([0, 0, 0])).toBe("the Galactic Centre");
    // The bar is long and thin, its near end toward positive longitude: a kiloparsec along it is still bar, a
    // kiloparsec across it is not.
    const along: [number, number, number] = [-1000 * Math.cos(27 * Math.PI / 180), 1000 * Math.sin(27 * Math.PI / 180), 0];
    const across: [number, number, number] = [1000 * Math.sin(27 * Math.PI / 180), 1000 * Math.cos(27 * Math.PI / 180), 0];
    expect(regionAt(along)).toMatch(/bar|bulge/);
    expect(relativeDensity("old", along) / relativeDensity("old", across)).toBeGreaterThan(1.5);
  });

  it("adds up to a couple of hundred billion stars", () => {
    const n = totalStars();
    expect(n).toBeGreaterThan(1e11);
    expect(n).toBeLessThan(4e11);
  });
});

describe("making the stars", () => {
  it("makes the same stars every time: a star can be made again from its id alone", () => {
    const a = starsNear(galacticPosition(40, 10, 300)), b = starsNear(galacticPosition(40, 10, 300));
    expect(a.stars.length).toBe(b.stars.length);
    expect(a.stars.map((s) => s.id)).toEqual(b.stars.map((s) => s.id));
    const some = a.stars.filter((s) => !s.real).slice(0, 50);
    for (const s of some) expect(starById(s.id)).toEqual(s);
  });

  it("keeps the Sun's neighbourhood real: nothing made up within 13 light-years, every real system there", () => {
    const f = starsNear(SUN_POS);
    expect(f.stars.filter((s) => !s.real && distance(s.pos, SUN_POS) < KNOWN_BUBBLE_PC)).toHaveLength(0);
    for (const name of ["Proxima Centauri", "Barnard's Star", "Wolf 359", "Sirius A", "Epsilon Eridani", "Tau Ceti"]) {
      expect(f.stars.some((s) => s.name === name)).toBe(true);
    }
  });

  it("keeps the crowded middle of the galaxy within budget by drawing each kind in closer", () => {
    const f = starsNear([0, 0, 0]);
    expect(f.stars.length).toBeLessThan(160_000);
    expect(f.reach.M).toBeLessThan(CLASS.M.reach);
  });

  it("gives each kind of star the physics of its kind", () => {
    const r = rngFrom(5);
    for (let i = 0; i < 200; i++) {
      const g = starPhysics("G", r);
      expect(g.temp).toBeGreaterThan(5000); expect(g.temp).toBeLessThan(6100);
      const wd = starPhysics("WD", r);
      expect(wd.radius).toBeLessThan(0.02);
      const rsg = starPhysics("RSG", r);
      expect(rsg.radius).toBeGreaterThan(100);
      const o = starPhysics("O", r);
      expect(o.lum).toBeGreaterThan(1e4);
    }
    expect(real("Sirius B").cls).toBe("WD");
    expect(real("Betelgeuse").cls).toBe("RSG");
    expect(real("Arcturus").cls).toBe("KIII");
  });

  it("names sectors the same way every time, and gives each star in a cube its own name", () => {
    expect(sectorName(3, -2, 0)).toBe(sectorName(3, -2, 0));
    expect(sectorName(3, -2, 0)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    const cell = starsInCell("B", -250, 10, 0);
    expect(new Set(cell.map((s) => s.name)).size).toBe(cell.length);
  });

  it("draws the whole galaxy as a cloud with a bar, arms, glowing nebulae and dust", () => {
    const c = galaxyCloud({ disk: 2000, bar: 1000, young: 2000, hii: 100, dust: 500, globular: 20 });
    expect(c.length).toBe(5620);
    expect(c.some((p) => p.dark)).toBe(true);
    // Most of the disk within 16 kpc of the centre.
    expect(c.filter((p) => Math.hypot(p.pos[0], p.pos[1]) < 16000).length / c.length).toBeGreaterThan(0.9);
  });
});
