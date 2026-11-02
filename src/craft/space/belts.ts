/**
 * The Solar System's crowds, drawn as points: the main asteroid belt, the
 * Hildas, Jupiter's Trojans and the Kuiper belt. There are over a million
 * known asteroids; these are a representative few thousand, placed the way
 * the real ones are rather than one by one:
 *
 * - The main belt fills 2.1–3.3 AU, with its Kirkwood gaps left empty where
 *   an orbit would go round three, five or seven times to Jupiter's one, two
 *   or three (3:1 at 2.50 AU, 5:2 at 2.82, 7:3 at 2.96, 2:1 at 3.28) — Jupiter
 *   clears those out.
 * - The Hildas sit at 4.0 AU, three orbits to Jupiter's two.
 * - The Trojans share Jupiter's orbit 60° ahead of it and behind it.
 * - The Kuiper belt runs from Neptune out to 50 AU, its plutinos at 39.4 AU
 *   (two orbits to Neptune's three, as Pluto's) and its cold classical core at
 *   42–47 AU, lying flat.
 *
 * Each is a set of orbital elements, turned into positions each frame.
 */
import { AU, DEG, eccentricAnomaly, fromOrbitPlane, GAUSS_K, J2000 } from "./kepler";
import { planetConic } from "./ephemeris";
import { Rng } from "../engine/rng";

export interface Belt {
  name: string;
  /** Seven numbers a body: a (AU), e, i, Ω, ω (radians), mean anomaly at J2000 (radians), mean motion (radians a day). */
  elements: Float64Array;
  count: number;
  color: [number, number, number];
}

const GAPS = [2.502, 2.825, 2.958, 3.279];

function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

function belt(name: string, count: number, color: [number, number, number], pick: (r: Rng) => [number, number, number, number, number, number]): Belt {
  const r = new Rng(name.length * 7919 + count);
  const el = new Float64Array(count * 7);
  for (let k = 0; k < count; k++) {
    const [a, e, i, node, peri, M] = pick(r);
    el.set([a, e, i, node, peri, M, GAUSS_K / Math.pow(a, 1.5)], k * 7);
  }
  return { name, elements: el, count, color };
}

/** Jupiter's mean longitude at J2000, for placing the Trojans around its leading and trailing points. */
function jupiterLongitude(): number {
  const c = planetConic(4, J2000);
  return (c.node + c.peri) * DEG;
}

export const BELTS: Belt[] = [
  belt("main belt", 5200, [0.62, 0.58, 0.54], (r) => {
    let a = 0;
    // Drawn from the belt's real spread, with the resonances left empty.
    do a = 2.1 + Math.pow(r.next(), 0.9) * 1.2 + gauss(r) * 0.05; while (a < 2.06 || a > 3.35 || GAPS.some((g) => Math.abs(a - g) < 0.022 + 0.02 * r.next()));
    return [a, Math.min(0.3, Math.abs(gauss(r)) * 0.085), Math.abs(gauss(r)) * 8.5 * DEG, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI];
  }),
  belt("Hildas", 350, [0.55, 0.52, 0.5], (r) => [3.97 + gauss(r) * 0.04, 0.08 + r.next() * 0.2, Math.abs(gauss(r)) * 8 * DEG, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI]),
  belt("Trojans", 900, [0.5, 0.47, 0.44], (r) => {
    // Spread about 25° around each Lagrange point, on near-circular orbits tilted up to 30°.
    const lead = r.next() < 0.6 ? 1 : -1;
    const lambda = jupiterLongitude() + lead * (Math.PI / 3) + gauss(r) * 0.22;
    const node = r.next() * 2 * Math.PI, peri = r.next() * 2 * Math.PI;
    return [5.2 + gauss(r) * 0.08, Math.abs(gauss(r)) * 0.05, Math.abs(gauss(r)) * 12 * DEG, node, peri, lambda - node - peri];
  }),
  belt("Kuiper belt", 2600, [0.72, 0.64, 0.6], (r) => {
    const kind = r.next();
    // A third plutinos, half the flat cold classicals, the rest scattered and stirred up.
    const a = kind < 0.3 ? 39.4 + gauss(r) * 0.25 : kind < 0.8 ? 42 + r.next() * 5 : 34 + r.next() * 22;
    const e = kind < 0.3 ? 0.1 + r.next() * 0.2 : kind < 0.8 ? Math.abs(gauss(r)) * 0.04 : 0.1 + r.next() * 0.3;
    const i = (kind < 0.8 && kind >= 0.3 ? Math.abs(gauss(r)) * 2.5 : Math.abs(gauss(r)) * 12) * DEG;
    return [a, e, i, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI];
  }),
];

/**
 * A belt of another star's (systems.ts): `count` bodies spread between two
 * distances (AU) on low, nearly round orbits round a star of `mass` Suns.
 */
export function makeBelt(name: string, count: number, color: [number, number, number], inner: number, outer: number, mass: number, seed: number): Belt {
  const r = new Rng(seed);
  const el = new Float64Array(count * 7);
  for (let k = 0; k < count; k++) {
    const a = inner + (outer - inner) * r.next();
    el.set([a, Math.abs(gauss(r)) * 0.06, Math.abs(gauss(r)) * 5 * DEG, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI, r.next() * 2 * Math.PI, (GAUSS_K * Math.sqrt(mass)) / Math.pow(a, 1.5)], k * 7);
  }
  return { name, elements: el, count, color };
}

/**
 * A belt's positions at a date (km from the Sun) into `out`, three numbers
 * a body. Thousands of Kepler solutions a frame: the solver converges in a
 * few steps for these nearly round orbits.
 */
export function beltPositions(b: Belt, jd: number, out: Float64Array): void {
  const el = b.elements, dt = jd - J2000;
  for (let k = 0; k < b.count; k++) {
    const o = k * 7;
    const a = el[o], e = el[o + 1];
    const E = eccentricAnomaly(el[o + 5] + el[o + 6] * dt, e);
    const p = fromOrbitPlane(a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), el[o + 3], el[o + 2], el[o + 4]);
    out[k * 3] = p[0] * AU; out[k * 3 + 1] = p[1] * AU; out[k * 3 + 2] = p[2] * AU;
  }
}
