import { describe, expect, it } from "vitest";
import { AU, conicPosition, DEG, dot, eccentricAnomaly, hyperbolicAnomaly, jdFromMs, len, norm, precessB1950, sub, type Vec3 } from "@/craft/space/kepler";
import { conicOf, ephemeris, moonEcliptic, orbitPath, planetPosition, positionOf } from "@/craft/space/ephemeris";
import { BODIES, BODY } from "@/craft/space/bodies";

const jd = (iso: string) => jdFromMs(Date.parse(iso));
/** The angle between two directions, in degrees. */
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;
/** Where a body is as seen from the Earth's centre. */
const geo = (id: string, t: number) => {
  const e = ephemeris(t);
  return sub(e.get(id)!, e.get("earth")!);
};

describe("Kepler's equation", () => {
  it("is solved on every kind of ellipse, including a comet's at 0.9999 near perihelion", () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.967, 0.9999]) {
      for (const M of [-3, -1, -0.01, 0, 1e-4, 0.5, 2, 3.1]) {
        const E = eccentricAnomaly(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
      }
    }
  });

  it("is solved on a hyperbola, for the visitors from other stars", () => {
    for (const e of [1.2, 3.08]) for (const M of [-50, -1, 0, 0.3, 40]) {
      const H = hyperbolicAnomaly(M, e);
      expect(e * Math.sinh(H) - H).toBeCloseTo(M, 8);
    }
  });
});

describe("the planets, from JPL's elements", () => {
  it("puts the Earth where it was on the first day of 2000: at perihelion distance, opposite the Sun's longitude", () => {
    const e = ephemeris(2451545.0).get("earth")!;
    expect(len(e) / AU).toBeCloseTo(0.9833, 3);
    // The Sun appeared at ecliptic longitude 280.4° that noon, so the Earth sat at 100.4° seen from the Sun.
    expect(((Math.atan2(e[1], e[0]) / DEG) + 360) % 360).toBeCloseTo(100.4, 0);
  });

  it("brings Mars to opposition on 13 October 2020", () => {
    // Opposition is counted in ecliptic longitude: Mars was 180° from the Sun along the ecliptic (and 2° below it).
    const t = jd("2020-10-13T23:26:00Z");
    const lon = (v: Vec3) => Math.atan2(v[1], v[0]) / DEG;
    const gap = (((lon(geo("mars", t)) - lon(geo("sun", t))) % 360) + 360) % 360;
    expect(gap).toBeCloseTo(180, 0);
  });

  it("lines up Jupiter and Saturn for the great conjunction of 21 December 2020", () => {
    const t = jd("2020-12-21T18:20:00Z");
    expect(angle(geo("jupiter", t), geo("saturn", t))).toBeLessThan(0.4);
    // A year earlier they were far apart.
    const before = jd("2019-12-21T00:00:00Z");
    expect(angle(geo("jupiter", before), geo("saturn", before))).toBeGreaterThan(10);
  });

  it("keeps each planet at its real distance from the Sun, near and far", () => {
    const ranges: Record<string, [number, number]> = { mercury: [0.307, 0.467], venus: [0.718, 0.729], mars: [1.381, 1.666], jupiter: [4.95, 5.46], neptune: [29.8, 30.4] };
    for (const [id, [lo, hi]] of Object.entries(ranges)) {
      for (let y = 0; y < 12; y++) {
        const r = len(ephemeris(2451545 + y * 365.25 * 1.37).get(id)!) / AU;
        expect(r, id).toBeGreaterThan(lo - 0.01);
        expect(r, id).toBeLessThan(hi + 0.01);
      }
    }
  });

  it("goes on working far outside the table's 1800–2050 fit, from table 2", () => {
    const r = len(planetPosition(4, jd("2500-06-01T00:00:00Z")));
    expect(r).toBeGreaterThan(4.9);
    expect(r).toBeLessThan(5.5);
  });
});

describe("the Moon", () => {
  it("matches Meeus's worked example for 1992 April 12", () => {
    const m = moonEcliptic(2448724.5);
    // Meeus gives λ 133.1627° (of date), β −3.2291°, Δ 368 410 km. Ours is J2000, 0.1° of precession back.
    expect(m.lon + (5029.0966 * ((2448724.5 - 2451545) / 36525)) / 3600).toBeCloseTo(133.1627, 1);
    expect(m.lon).toBeGreaterThanOrEqual(0);
    expect(m.lat).toBeCloseTo(-3.2291, 1);
    expect(Math.abs(m.dist - 368409.7)).toBeLessThan(40);
  });

  it("covers the Sun for the total eclipse of 8 April 2024", () => {
    const t = jd("2024-04-08T18:17:00Z");
    expect(angle(geo("moon", t), geo("sun", t))).toBeLessThan(0.5);
    // A day before, nothing like it.
    expect(angle(geo("moon", t - 1), geo("sun", t - 1))).toBeGreaterThan(8);
  });

  it("sits in the Earth's shadow for the total lunar eclipse of 8 November 2022", () => {
    const t = jd("2022-11-08T10:59:00Z");
    expect(angle(geo("moon", t), sub([0, 0, 0], geo("sun", t)))).toBeLessThan(0.5);
  });

  it("stays 356 000 to 407 000 km from the Earth", () => {
    for (let d = 0; d < 400; d += 3.7) {
      const r = len(geo("moon", 2460000 + d));
      expect(r).toBeGreaterThan(356_000);
      expect(r).toBeLessThan(407_000);
    }
  });
});

describe("comets and small bodies", () => {
  it("turns B1950 elements to J2000 the way the catalogues do", () => {
    // Halley's 1986 elements, as Marsden's catalogue gives them (B1950), against the same orbit in J2000.
    const j = precessB1950({ q: 0.587104, e: 0.967277, i: 162.2392, node: 58.1434, peri: 111.8466, tp: 2446470.9589 });
    expect(j.node).toBeCloseTo(58.8601, 1);
    expect(j.i).toBeCloseTo(162.2422, 1);
    expect(j.peri).toBeCloseTo(111.8657, 1);
  });

  it("brings Halley to perihelion in February 1986 and July 2061, and to aphelion out past Neptune in between", () => {
    const at = (iso: string) => len(positionOf("halley", jd(iso))!) / AU;
    expect(at("1986-02-09T11:00:00Z")).toBeCloseTo(0.587, 2);
    expect(at("2061-07-28T03:00:00Z")).toBeCloseTo(0.587, 2);
    expect(at("2061-01-01T00:00:00Z")).toBeGreaterThan(2);
    expect(at("2023-12-09T00:00:00Z")).toBeGreaterThan(34.5);
  });

  it("crosses the Earth's path where the Perseids and the Orionids come from", () => {
    // Swift–Tuttle's orbit passes within a few hundredths of an AU of the Earth's in mid-August; Halley's within
    // about a tenth in late October — close enough for their dust to make meteor showers.
    const earthOrbit = orbitPath("earth", jd("2024-08-12T00:00:00Z"), 720)!.points;
    const near = (id: string) => Math.min(...orbitPath(id, jd("2024-01-01T00:00:00Z"), 4000, 3)!.points.map((p) => Math.min(...earthOrbit.map((q) => len(sub(p, q)))))) / AU;
    expect(near("swifttuttle")).toBeLessThan(0.02);
    expect(near("halley")).toBeLessThan(0.08);
  });

  it("sends ʻOumuamua and Borisov out of the Solar System, never to return", () => {
    for (const id of ["oumuamua", "borisov"]) {
      const c = conicOf(id)!;
      expect(c.e).toBeGreaterThan(1);
      const r1 = len(conicPosition(c, c.tp + 3650)), r2 = len(conicPosition(c, c.tp + 7300));
      expect(r2).toBeGreaterThan(r1);
      expect(len(conicPosition(c, c.tp))).toBeCloseTo(c.q, 6);
    }
  });

  it("keeps every moon near its planet, and every body somewhere in the Solar System", () => {
    const t = jd("2026-09-27T00:00:00Z");
    const e = ephemeris(t);
    for (const b of BODIES) {
      const p = e.get(b.id);
      if (b.kind === "probe" && b.orbit.kind === "escape" && t < b.orbit.from) continue;
      expect(p, b.id).toBeDefined();
      if (b.kind === "moon") {
        const d = len(sub(p!, e.get(b.parent!)!));
        expect(d, b.id).toBeGreaterThan(BODY[b.parent!].radius);
        expect(d, b.id).toBeLessThan(10_000_000);
      } else expect(len(p!) / AU, b.id).toBeLessThan(1200);
    }
  });

  it("parks the Webb telescope 1.5 million km from the Earth, away from the Sun", () => {
    const e = ephemeris(jd("2026-01-01T00:00:00Z"));
    const off = sub(e.get("jwst")!, e.get("earth")!);
    expect(len(off)).toBeCloseTo(1_500_000, -3);
    expect(angle(off, e.get("earth")!)).toBeLessThan(0.01);
  });
});
