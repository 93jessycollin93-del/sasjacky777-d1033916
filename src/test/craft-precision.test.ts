import { describe, expect, it } from "vitest";
import {
  AU, calendarFromJd, calendarString, deltaT, gast, gmst, jdFromCalendar, jdFromMs, nutation, precessionMatrix, tt, yearLabel,
} from "@/craft/space/kepler";
import { moonOfDate, positionOf } from "@/craft/space/ephemeris";
import { eclipseCentre, nextPhase, skyAt } from "@/craft/space/sky";
import { jdOfLocal, localClock } from "@/craft/space/skyReport";
import { propagate } from "@/craft/space/orbit";
import { densityAt, US76 } from "@/craft/space/newton";

/**
 * The universe measured against the books it claims to follow: Meeus's worked
 * examples (Astronomical Algorithms, 2nd ed.), NASA's eclipse predictions,
 * Vallado's flight dynamics and the U.S. Standard Atmosphere. Each test names
 * the source and the value it was given; the tolerances are what the method
 * here can honestly reach, not what makes the test pass.
 */

const jd = (iso: string) => jdFromMs(Date.parse(iso));
const D = Math.PI / 180;
const ARCSEC = D / 3600;

describe("time and the Earth's turning axis", () => {
  it("nutates the axis as Meeus's Example 22.a: Δψ −3.788″, Δε +9.443″, ε 23°26′36.850″", () => {
    const n = nutation(2446895.5);
    expect(n.dpsi / ARCSEC).toBeCloseTo(-3.788, 0); // the four-term series is good to half an arcsecond
    expect(Math.abs(n.dpsi / ARCSEC + 3.788)).toBeLessThan(0.5);
    expect(Math.abs(n.deps / ARCSEC - 9.443)).toBeLessThan(0.5);
    expect(Math.abs((n.eps0 + n.deps) / D - (23 + 26 / 60 + 36.85 / 3600))).toBeLessThan(0.5 / 3600);
  });

  it("keeps sidereal time as Meeus's Example 12.a: GMST 13h10m46.3668s, GAST 13h10m46.1351s", () => {
    expect(gmst(2446895.5)).toBeCloseTo((13 + 10 / 60 + 46.3668 / 3600) * 15, 6);
    expect(Math.abs(gast(2446895.5) - (13 + 10 / 60 + 46.1351 / 3600) * 15)).toBeLessThan(0.05 / 3600 * 15);
  });

  it("precesses θ Persei as Meeus's Example 21.b: to 2h46m11.331s +49°20′54.54″", () => {
    const yrs = (2462088.69 - 2451545) / 365.25;
    const ra = ((2 + 44 / 60 + 11.986 / 3600) * 15 + (0.03425 * yrs * 15) / 3600) * D;
    const dec = (49 + 13 / 60 + 42.48 / 3600 - (0.0895 * yrs) / 3600) * D;
    const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const P = precessionMatrix(2462088.69);
    const w = [0, 1, 2].map((i) => P[i][0] * v[0] + P[i][1] * v[1] + P[i][2] * v[2]);
    const gotRa = (Math.atan2(w[1], w[0]) / D + 360) % 360, gotDec = Math.asin(w[2]) / D;
    expect(Math.abs(gotRa - (2 + 46 / 60 + 11.331 / 3600) * 15) * 3600).toBeLessThan(0.15); // 0.01 s of time
    expect(Math.abs(gotDec - (49 + 20 / 60 + 54.54 / 3600)) * 3600).toBeLessThan(0.1);
  });

  it("moves the pole off Polaris: 11.75° away in 1 AD, as IAU 2006 and Vondrák's long-term model both give", () => {
    const pa = 37.95456 * D, pd = 89.26411 * D;
    const P = precessionMatrix(1721425.5);
    const z = P[2][0] * Math.cos(pd) * Math.cos(pa) + P[2][1] * Math.cos(pd) * Math.sin(pa) + P[2][2] * Math.sin(pd);
    expect(90 - Math.asin(z) / D).toBeCloseTo(11.754, 1);
  });

  it("knows ΔT: 63.8 s in 2000, 1574 s in 1000, 10584 s in 0 AD (Espenak & Meeus), 69.2 s in 2024 (IERS)", () => {
    expect(deltaT(jdFromCalendar(2000, 1, 1.5))).toBeCloseTo(63.83, 1);
    expect(deltaT(jdFromCalendar(1000, 1, 1))).toBeCloseTo(1574.2, -1);
    expect(deltaT(jdFromCalendar(0, 1, 1))).toBeCloseTo(10583.6, -1);
    expect(Math.abs(deltaT(jdFromCalendar(2024, 4, 8)) - 69.2)).toBeLessThan(0.3);
    expect(tt(2451545) - 2451545).toBeCloseTo(63.83 / 86400, 7);
  });
});

describe("the calendar", () => {
  it("reads dates as Meeus's Examples 7.a and 7.b: Julian before 1582, Gregorian after", () => {
    expect(jdFromCalendar(1957, 10, 4.81)).toBeCloseTo(2436116.31, 6);
    expect(jdFromCalendar(333, 1, 27.5)).toBe(1842713.0);
    expect(jdFromCalendar(-4712, 1, 1.5)).toBe(0);
    expect(jdFromCalendar(1582, 10, 15) - jdFromCalendar(1582, 10, 4)).toBe(1); // the reform's ten lost days
  });

  it("writes them back as Example 7.c, with years before 1 AD as BC", () => {
    expect(calendarFromJd(1507900.13)).toMatchObject({ year: -584, month: 5, day: 28 });
    expect(calendarString(1507900.13)).toBe("585 BC-05-28 15:07");
    expect(yearLabel(0)).toBe("1 BC");
    expect(yearLabel(79)).toBe("79 AD");
  });

  it("takes /sky dates the way history books write them, and round-trips them", () => {
    // Halley over the Bayeux Tapestry: 1066 March 20, Julian — six days later than the same digits read as Gregorian.
    expect(jdOfLocal("1066-03-20", 0, 0)).toBe(2110492.5);
    expect(jdOfLocal("585BC-05-28", 12, 0)).toBe(jdOfLocal("-584-05-28", 12, 0));
    expect(jdOfLocal("1582-10-10", 0, 0)).toBeNull();
    expect(localClock(jdOfLocal("1066-03-20", 13.5, -2)!, -2)).toBe("1066-03-20 13:30");
  });
});

describe("the sky, against the almanacs", () => {
  it("runs the Sun on the equation of time of Meeus's Example 28.a: +13m42.6s on 1992 October 13", () => {
    let t = 2448908.5;
    for (let i = 0; i < 3; i++) t = 2448908.5 - (tt(t) - t); // 0h TD, in UT
    const s = skyAt(t, 0, 0).sun;
    const H = Math.atan2(-s[0], s[1]) / D; // the Sun's hour angle at Greenwich
    const ut = ((t - 0.5) % 1) * 24;
    const minutes = (((H - (ut - 12) * 15 + 540) % 360) - 180) * 4;
    expect(Math.abs(minutes - (13 + 42.6 / 60)) * 60).toBeLessThan(2);
  });

  it("brings the Sun over Greenwich at 11:46:44 UT on 2026 October 11 (DE421 with IAU 2006/2000A)", () => {
    let best = 0, bestH = Infinity;
    for (let s = 0; s < 900; s++) {
      const t = jd("2026-10-11T11:40:00Z") + s / 86400;
      const d = skyAt(t, 0, 0).sun, h = Math.abs(Math.atan2(-d[0], d[1]));
      if (h < bestH) { bestH = h; best = t; }
    }
    expect(Math.abs(best - jd("2026-10-11T11:46:44Z")) * 86400).toBeLessThan(3);
  });

  it("finds the greatest eclipse of 2024 April 8 where NASA does: 18:17:20 UT, 25.29°N 104.14°W", () => {
    const c = eclipseCentre(jd("2024-04-08T18:17:00Z"))!;
    expect(Math.abs(c.jd - jd("2024-04-08T18:17:20Z")) * 86400).toBeLessThan(30);
    expect(Math.abs(c.lat - 25.29)).toBeLessThan(0.1);
    expect(Math.abs(c.lon + 104.143)).toBeLessThan(0.15);
  });

  it("finds the greatest eclipse of 2017 August 21 where NASA does: 18:25:32 UT, 36.96°N 87.66°W", () => {
    const c = eclipseCentre(jd("2017-08-21T18:25:00Z"))!;
    expect(Math.abs(c.jd - jd("2017-08-21T18:25:31Z")) * 86400).toBeLessThan(20);
    expect(Math.abs(c.lat - 36.964)).toBeLessThan(0.1);
    expect(Math.abs(c.lon + 87.664)).toBeLessThan(0.1);
  });

  it("times the new moon of Meeus's Example 49.a, JDE 2443192.65118, within 40 s", () => {
    expect(Math.abs(tt(nextPhase(2443190, 0)) - 2443192.65118) * 86400).toBeLessThan(40);
  });

  it("places the Moon as Meeus's Example 47.a, with all sixty latitude terms: λ 133.162655°, β −3.229126°", () => {
    const m = moonOfDate(2448724.5);
    expect(m.lon).toBeCloseTo(133.162655, 5);
    expect(m.lat).toBeCloseTo(-3.229126, 5);
    expect(m.dist).toBeCloseTo(368409.7, 0);
  });
});

describe("Halley's Comet, return by return (Yeomans & Kiang)", () => {
  it("reaches perihelion on the real dates of 1910 and of 1066, where one period missed by months and years", () => {
    expect(Math.hypot(...positionOf("halley", 2418781.68)!) / AU).toBeCloseTo(0.587, 2);
    expect(Math.hypot(...positionOf("halley", 2110493.43)!) / AU).toBeCloseTo(0.587, 2);
  });

  it("is in the sky the night the Earth passed through its tail, and over the Bayeux Tapestry's spring", () => {
    expect(skyAt(jdFromCalendar(1910, 5, 18.5), 40, -75).comets.some((c) => c.id === "halley" && c.mag < 2)).toBe(true);
    expect(skyAt(jdFromCalendar(1066, 4, 24.1), 50, 0).comets.some((c) => c.id === "halley")).toBe(true);
  });
});

describe("flight", () => {
  it("coasts Vallado's Example 2-4 to the metre", () => {
    const { r, v } = propagate([1131.34, -2282.343, 6672.423], [-5.64305, 4.30333, 2.42879], 398600.4418, 40 * 60);
    expect(r[0]).toBeCloseTo(-4219.7527, 3);
    expect(r[1]).toBeCloseTo(4363.0292, 3);
    expect(r[2]).toBeCloseTo(-3958.7666, 3);
    expect(v[0]).toBeCloseTo(3.689866, 5);
  });

  it("solves Kepler's equation on eccentric ellipses and hyperbolas, where plain Newton gave up and guessed", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const e = [0.98, 0.999, 1.5, 20][k % 4], hyper = e > 1, a = hyper ? -1 : 1, rp = Math.abs(a) * Math.abs(1 - e);
      const n = Math.sqrt(1 / Math.abs(a) ** 3), dt = (rnd() - 0.5) * (hyper ? 2000 : 3 * 2 * Math.PI);
      const { r } = propagate([rp, 0, 0], [0, Math.sqrt((1 + e) / rp), 0], 1, dt);
      // The same distance from an independent bisection on Kepler's equation.
      let lo = hyper ? -50 : 0, hi = hyper ? 50 : 2 * Math.PI;
      const M = hyper ? n * dt : (((n * dt) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      for (let i = 0; i < 200; i++) {
        const x = (lo + hi) / 2;
        if ((hyper ? e * Math.sinh(x) - x : x - e * Math.sin(x)) < M) lo = x; else hi = x;
      }
      const x = (lo + hi) / 2, want = hyper ? -a * (e * Math.cosh(x) - 1) : a * (1 - e * Math.cos(x));
      worst = Math.max(worst, Math.abs(Math.hypot(...r) - want) / want);
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it("breathes the U.S. Standard Atmosphere, 1976: within 2% at 10, 70 and 120 km", () => {
    const earth = { H: 7, rho0: 1.225, table: US76 };
    for (const [h, want] of [[10, 0.41351], [70, 8.2829e-5], [120, 2.222e-8], [65, Math.sqrt(3.0968e-4 * 8.2829e-5)]]) {
      expect(Math.abs(densityAt(earth, h) / want - 1)).toBeLessThan(0.02);
    }
  });
});
