import { describe, expect, it } from "vitest";
import { add, AU, cross, dot, len, scale, sub, type Vec3 } from "@/craft/space/kepler";
import { circularSpeed, elementsOf, escapeSpeed, hohmann, pathAhead, propagate, timeToRadius } from "@/craft/space/orbit";

const MU_EARTH = 398600.435, MU_SUN = 1.32712440018e11, R_EARTH = 6378.137;
const close = (a: Vec3, b: Vec3) => len(sub(a, b));

/** A brute-force check: fourth-order Runge–Kutta in small steps, the slow way. */
function rk4(r: Vec3, v: Vec3, mu: number, t: number, h = 1): { r: Vec3; v: Vec3 } {
  const acc = (p: Vec3) => scale(p, -mu / Math.pow(len(p), 3));
  let x = r, u = v;
  for (let s = 0; s < t; s += h) {
    const k1v = acc(x), k1x = u;
    const k2v = acc(add(x, scale(k1x, h / 2))), k2x = add(u, scale(k1v, h / 2));
    const k3v = acc(add(x, scale(k2x, h / 2))), k3x = add(u, scale(k2v, h / 2));
    const k4v = acc(add(x, scale(k3x, h))), k4x = add(u, scale(k3v, h));
    x = add(x, scale(add(add(k1x, scale(k2x, 2)), add(scale(k3x, 2), k4x)), h / 6));
    u = add(u, scale(add(add(k1v, scale(k2v, 2)), add(scale(k3v, 2), k4v)), h / 6));
  }
  return { r: x, v: u };
}

describe("coasting on a conic", () => {
  it("brings the space station round once every 92½ minutes, back to where it started", () => {
    const r: Vec3 = [R_EARTH + 400, 0, 0], v: Vec3 = [0, circularSpeed(MU_EARTH, R_EARTH + 400), 0];
    const el = elementsOf(r, v, MU_EARTH);
    expect(el.period / 60).toBeCloseTo(92.56, 1);
    expect(len(v)).toBeCloseTo(7.67, 2);
    const back = propagate(r, v, MU_EARTH, el.period);
    expect(close(back.r, r)).toBeLessThan(1e-6);
    // And a year's worth of turns is as exact, because whole turns are taken off first.
    expect(close(propagate(r, v, MU_EARTH, el.period * 5683).r, r)).toBeLessThan(1e-3);
  });

  it("agrees with brute-force integration on an eccentric orbit and on a hyperbolic flyby", () => {
    const ecc = { r: [R_EARTH + 500, 0, 0] as Vec3, v: [0, 9.5, 1.2] as Vec3 };
    const fly = { r: [-80_000, 12_000, 0] as Vec3, v: [3.6, 0, 0.2] as Vec3 };
    for (const s of [ecc, fly]) {
      const exact = propagate(s.r, s.v, MU_EARTH, 3600), slow = rk4(s.r, s.v, MU_EARTH, 3600, 0.5);
      expect(close(exact.r, slow.r)).toBeLessThan(0.01);
      expect(close(exact.v, slow.v)).toBeLessThan(1e-5);
    }
    expect(elementsOf(fly.r, fly.v, MU_EARTH).e).toBeGreaterThan(1);
  });

  it("keeps energy and angular momentum over any coast, forward or back", () => {
    const r: Vec3 = [7000, -1200, 300], v: Vec3 = [1.1, 8.9, 0.7];
    const e0 = elementsOf(r, v, MU_EARTH);
    for (const t of [13, 777, 86_400, -5000, 3.1e7]) {
      const s = propagate(r, v, MU_EARTH, t);
      const e1 = elementsOf(s.r, s.v, MU_EARTH);
      expect(e1.energy).toBeCloseTo(e0.energy, 7);
      expect(len(sub(e1.h, e0.h))).toBeLessThan(1e-4);
      const there = propagate(s.r, s.v, MU_EARTH, -t);
      expect(close(there.r, r)).toBeLessThan(1e-4);
    }
  });

  it("reads a Molniya orbit's shape back from a position and velocity", () => {
    const a = 26_600, e = 0.74, rp = a * (1 - e);
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const el = elementsOf([rp, 0, 0], [0, vp * Math.cos(1.107), vp * Math.sin(1.107)], MU_EARTH);
    expect(el.a).toBeCloseTo(a, 3);
    expect(el.e).toBeCloseTo(e, 9);
    expect(el.apoapsis).toBeCloseTo(a * (1 + e), 3);
    expect(el.incl).toBeCloseTo(63.4, 1);
    expect(el.period / 3600).toBeCloseTo(11.97, 1);
  });
});

describe("transfers and escapes", () => {
  it("prices low orbit to geostationary at about 3.9 km/s, five and a quarter hours on the way", () => {
    const t = hohmann(MU_EARTH, R_EARTH + 300, 42_164);
    expect(t.dv1 + t.dv2).toBeCloseTo(3.89, 1);
    expect(t.time / 3600).toBeCloseTo(5.3, 1);
  });

  it("takes about 259 days from the Earth's orbit to Mars's on the cheapest path", () => {
    const t = hohmann(MU_SUN, AU, 1.5237 * AU);
    expect(t.time / 86400).toBeCloseTo(259, -1);
    expect(t.dv1).toBeCloseTo(2.94, 1);
  });

  it("knows the Earth's escape velocity at its surface", () => {
    expect(escapeSpeed(MU_EARTH, R_EARTH)).toBeCloseTo(11.18, 2);
  });
});

describe("where an orbit goes", () => {
  it("times a coming-down to the surface, and never for an orbit that clears it", () => {
    const r: Vec3 = [R_EARTH + 400, 0, 0];
    const slow: Vec3 = [0, circularSpeed(MU_EARTH, R_EARTH + 400) - 0.25, 0];
    const t = timeToRadius(r, slow, MU_EARTH, R_EARTH + 100)!;
    expect(t).toBeGreaterThan(600);
    expect(t).toBeLessThan(3000);
    expect(len(propagate(r, slow, MU_EARTH, t).r)).toBeCloseTo(R_EARTH + 100, 3);
    expect(timeToRadius(r, [0, circularSpeed(MU_EARTH, R_EARTH + 400), 0], MU_EARTH, R_EARTH + 100)).toBeNull();
  });

  it("draws a closed orbit whole, and an escape or a fall only as far as it goes", () => {
    const r: Vec3 = [R_EARTH + 400, 0, 0];
    const round = pathAhead(r, [0, circularSpeed(MU_EARTH, R_EARTH + 400), 0], MU_EARTH, 64, 900_000, R_EARTH);
    expect(round.closed).toBe(true);
    expect(round.points).toHaveLength(65);
    expect(close(round.points[0], round.points[64])).toBeLessThan(1e-6);
    const out = pathAhead(r, [0, escapeSpeed(MU_EARTH, R_EARTH + 400) * 1.05, 0], MU_EARTH, 64, 900_000, R_EARTH);
    expect(out.leaves).toBe(true);
    const down = pathAhead(r, [0, 7.0, 0], MU_EARTH, 64, 900_000, R_EARTH);
    expect(down.hits).toBe(true);
    // Angular momentum points the way it should: an eastward orbit turns counter-clockwise seen from the north.
    expect(dot(cross(r, [0, 7.67, 0]), [0, 0, 1])).toBeGreaterThan(0);
  });
});
