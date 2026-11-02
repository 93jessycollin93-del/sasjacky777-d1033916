/**
 * Two-body orbital mechanics: the maths a ship coasting under one body's
 * gravity follows exactly, however far the clock is run ahead.
 *
 * A ship between burns is on a conic about whatever body's sphere of
 * influence it is in (the patched-conic model that Kerbal Space Program and
 * mission planners' first sketches both use). Stepping that with an
 * integrator would drift and, at a million times real speed, blow up; so the
 * coast is solved rather than stepped: the universal-variable form of
 * Kepler's problem (Vallado, *Fundamentals of Astrodynamics and
 * Applications*, algorithm 8) carries a position and velocity forward by any
 * time, on an ellipse, a parabola or a hyperbola alike.
 *
 * Units: km, km/s, seconds, and μ = GM in km³/s².
 */
import { add, cross, dot, len, norm, scale, sub, type Vec3 } from "./kepler";

const TAU = Math.PI * 2;

/** Stumpff's c2 and c3, the functions that let one formula cover every conic. */
function stumpff(psi: number): [number, number] {
  if (psi > 1e-6) {
    const s = Math.sqrt(psi);
    return [(1 - Math.cos(s)) / psi, (s - Math.sin(s)) / (s * psi)];
  }
  if (psi < -1e-6) {
    const s = Math.sqrt(-psi);
    return [(1 - Math.cosh(s)) / psi, (Math.sinh(s) - s) / (s * -psi)];
  }
  return [0.5 - psi / 24 + (psi * psi) / 720, 1 / 6 - psi / 120 + (psi * psi) / 5040];
}

/** Where a body in free fall about μ is `dt` seconds on (or back, for a negative `dt`), and how fast. */
export function propagate(r0v: Vec3, v0v: Vec3, mu: number, dt: number): { r: Vec3; v: Vec3 } {
  const r0 = len(r0v);
  if (dt === 0 || r0 === 0 || mu <= 0) return { r: add(r0v, scale(v0v, dt)), v: [...v0v] as Vec3 };
  const sqmu = Math.sqrt(mu), rv = dot(r0v, v0v), v0 = len(v0v);
  const alpha = 2 / r0 - (v0 * v0) / mu;
  // Whole turns of an ellipse change nothing: take them off, so a coast of years is as exact as one of seconds.
  if (alpha > 1e-12) {
    const period = TAU / Math.sqrt(mu * alpha * alpha * alpha);
    dt %= period;
  }
  // Kepler's equation in the universal anomaly χ: F(χ) is the time of flight
  // (times √μ) less the time asked for. Its slope is r > 0, so it rises
  // monotonically and has exactly one root. Plain Newton from Vallado's guess
  // wandered off on eccentric ellipses and hyperbolas and handed back its last
  // guess as if it had converged — a Jupiter flyby at full clock speed threw
  // the ship thousands of AU (rule 8). Newton is kept inside a bracket and
  // falls back to bisection when it steps out, so it cannot fail to converge.
  const F = (x: number): number => {
    const p = x * x * alpha, [k2, k3] = stumpff(p);
    const value = (rv / sqmu) * x * x * k2 + (1 - r0 * alpha) * x * x * x * k3 + r0 * x - sqmu * dt;
    // Far out on a hyperbola the terms overflow; out there the flight time has passed any finite target.
    return Number.isFinite(value) ? value : Math.sign(dt) || 1;
  };
  const sg = dt >= 0 ? 1 : -1;
  let lo: number, hi: number;
  if (alpha > 1e-12) {
    // An ellipse less whole turns: χ for one full turn is 2π/√α.
    lo = sg > 0 ? 0 : -TAU / Math.sqrt(alpha);
    hi = sg > 0 ? TAU / Math.sqrt(alpha) : 0;
  } else {
    let far = Math.max(Math.abs(sqmu * dt) / r0, 1e-9);
    for (let i = 0; i < 400 && F(sg * far) * sg < 0; i++) far *= 2;
    lo = sg > 0 ? 0 : -far;
    hi = sg > 0 ? far : 0;
  }
  let chi: number;
  if (alpha > 1e-9) chi = sqmu * dt * alpha;
  else if (alpha < -1e-9) {
    const a = 1 / alpha;
    const arg = (-2 * mu * alpha * dt) / (rv + sg * Math.sqrt(-mu * a) * (1 - r0 * alpha));
    chi = arg > 0 ? sg * Math.sqrt(-a) * Math.log(arg) : (sqmu * dt) / r0;
  } else chi = (sqmu * dt) / r0;
  if (!(chi > lo && chi < hi)) chi = (lo + hi) / 2;
  let psi = 0, c2 = 0.5, c3 = 1 / 6, r = r0;
  for (let i = 0; i < 200; i++) {
    psi = chi * chi * alpha;
    [c2, c3] = stumpff(psi);
    r = chi * chi * c2 + (rv / sqmu) * chi * (1 - psi * c3) + r0 * (1 - psi * c2);
    const f = F(chi);
    if (f === 0) break;
    if (f < 0) lo = chi; else hi = chi;
    let next = chi - f / r;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    const done = Math.abs(next - chi) < 1e-12 * Math.max(1, Math.abs(chi)) || hi - lo < 1e-14 * Math.max(1, Math.abs(chi));
    chi = next;
    if (done) break;
  }
  psi = chi * chi * alpha;
  [c2, c3] = stumpff(psi);
  r = chi * chi * c2 + (rv / sqmu) * chi * (1 - psi * c3) + r0 * (1 - psi * c2);
  const f = 1 - ((chi * chi) / r0) * c2, g = dt - ((chi * chi * chi) / sqmu) * c3;
  const fdot = (sqmu / (r * r0)) * chi * (psi * c3 - 1), gdot = 1 - ((chi * chi) / r) * c2;
  return { r: add(scale(r0v, f), scale(v0v, g)), v: add(scale(r0v, fdot), scale(v0v, gdot)) };
}

export interface Elements {
  /** Semi-major axis, km (negative for a hyperbola, infinite for a parabola). */
  a: number;
  e: number;
  /** Tilt to the reference plane (the body's equator, if its pole is given), degrees. */
  incl: number;
  /** True anomaly, radians: where along the conic the body is, measured from periapsis. */
  nu: number;
  /** Nearest and farthest distances from the centre, km (apoapsis infinite for an open orbit). */
  periapsis: number;
  apoapsis: number;
  /** Seconds for one turn; infinite for an open orbit. */
  period: number;
  /** Specific orbital energy (km²/s²) and angular momentum (km²/s). */
  energy: number;
  h: Vec3;
  /** The semi-latus rectum p = h²/μ, km. */
  p: number;
  /** Unit vectors: toward periapsis, and 90° on from it in the direction of travel. */
  P: Vec3;
  Q: Vec3;
}

/** The orbit a position and velocity describe about μ. `pole` is the reference plane's north (default: the frame's z). */
export function elementsOf(r: Vec3, v: Vec3, mu: number, pole: Vec3 = [0, 0, 1]): Elements {
  const rl = len(r), v2 = dot(v, v);
  const h = cross(r, v), hl = len(h);
  const evec = scale(sub(scale(r, v2 - mu / rl), scale(v, dot(r, v))), 1 / mu);
  const e = len(evec);
  const energy = v2 / 2 - mu / rl;
  const a = Math.abs(energy) < 1e-12 ? Infinity : -mu / (2 * energy);
  const p = (hl * hl) / mu;
  const W = hl > 0 ? scale(h, 1 / hl) : [0, 0, 1] as Vec3;
  // A near-circle has no periapsis to speak of: measure from where the body is now.
  const P = e > 1e-9 ? scale(evec, 1 / e) : norm(r);
  const Q = cross(W, P);
  const nu = Math.atan2(dot(r, Q), dot(r, P));
  const periapsis = p / (1 + e);
  const apoapsis = e < 1 ? p / (1 - e) : Infinity;
  const period = e < 1 && a > 0 ? TAU * Math.sqrt((a * a * a) / mu) : Infinity;
  const incl = (Math.acos(Math.max(-1, Math.min(1, dot(W, norm(pole))))) * 180) / Math.PI;
  return { a, e, incl, nu, periapsis, apoapsis, period, energy, h, p, P, Q };
}

/** The mean anomaly at a true anomaly, for an ellipse (e < 1) or a hyperbola (e > 1). */
function meanAnomaly(nu: number, e: number): number {
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    return E - e * Math.sin(E);
  }
  const F = 2 * Math.atanh(Math.max(-1 + 1e-15, Math.min(1 - 1e-15, Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2))));
  return e * Math.sinh(F) - F;
}

/** Seconds from the body's place on its orbit until it reaches a true anomaly (the next time, for an ellipse). */
export function timeToAnomaly(el: Elements, mu: number, target: number): number | null {
  const e = el.e === 1 ? 1 + 1e-9 : el.e;
  if (e < 1) {
    const n = Math.sqrt(mu / (el.a * el.a * el.a));
    const dM = (((meanAnomaly(target, e) - meanAnomaly(el.nu, e)) % TAU) + TAU) % TAU;
    return dM / n;
  }
  // An open orbit passes each point once: only anomalies still ahead can be reached.
  const limit = Math.acos(-1 / e);
  if (Math.abs(target) >= limit || target <= el.nu) return null;
  const n = Math.sqrt(mu / Math.pow(-el.a, 3));
  return (meanAnomaly(target, e) - meanAnomaly(el.nu, e)) / n;
}

/**
 * Seconds until the orbit next comes down through a radius (a surface, the
 * top of an atmosphere), or null if it never will. Zero if already below it.
 */
export function timeToRadius(r: Vec3, v: Vec3, mu: number, R: number): number | null {
  if (len(r) <= R) return 0;
  const el = elementsOf(r, v, mu);
  if (el.periapsis >= R) return null;
  if (el.e < 1e-9) return null;
  const cosNu = Math.max(-1, Math.min(1, (el.p / R - 1) / el.e));
  // The inbound crossing is on the near side of periapsis.
  return timeToAnomaly(el, mu, -Math.acos(cosNu));
}

/** A point on the orbit at a true anomaly, relative to the body. */
export function pointAt(el: Elements, nu: number): Vec3 {
  const r = el.p / (1 + el.e * Math.cos(nu));
  return add(scale(el.P, r * Math.cos(nu)), scale(el.Q, r * Math.sin(nu)));
}

/**
 * The orbit ahead, as points relative to the body: the whole ellipse if it
 * closes inside `maxR`; otherwise from here until it leaves `maxR`. It stops
 * where it would come down below `floor` (the ground, or the air).
 */
export function pathAhead(r: Vec3, v: Vec3, mu: number, count: number, maxR: number, floor = 0):
  { points: Vec3[]; closed: boolean; hits: boolean; leaves: boolean } {
  const el = elementsOf(r, v, mu);
  const points: Vec3[] = [];
  const closed = el.e < 1 && el.apoapsis < maxR && el.periapsis > floor;
  if (closed) {
    // Evenly in eccentric anomaly, so the points bunch neither at periapsis nor apoapsis.
    for (let i = 0; i <= count; i++) {
      const E = (i / count) * TAU;
      const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
      points.push(pointAt(el, nu));
    }
    return { points, closed, hits: false, leaves: false };
  }
  // Open, or leaving, or coming down: walk forward from here.
  const end = el.e >= 1 ? Math.acos(-1 / el.e) - 1e-3 : el.nu + TAU;
  let hits = false, leaves = false;
  for (let i = 0; i <= count; i++) {
    const nu = el.nu + ((end - el.nu) * i) / count;
    const q = pointAt(el, nu), d = len(q);
    if (d < floor) { hits = true; points.push(scale(norm(q), floor)); break; }
    if (d > maxR) { leaves = true; points.push(scale(norm(q), maxR)); break; }
    points.push(q);
  }
  return { points, closed: false, hits, leaves };
}

export const circularSpeed = (mu: number, r: number): number => Math.sqrt(mu / r);
export const escapeSpeed = (mu: number, r: number): number => Math.sqrt((2 * mu) / r);

/** The two burns of a Hohmann transfer between circular orbits, and the time it takes (half the transfer ellipse). */
export function hohmann(mu: number, r1: number, r2: number): { dv1: number; dv2: number; time: number } {
  const at = (r1 + r2) / 2;
  const dv1 = Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const dv2 = Math.sqrt(mu / r2) * (1 - Math.sqrt((2 * r1) / (r1 + r2)));
  return { dv1, dv2, time: Math.PI * Math.sqrt((at * at * at) / mu) };
}
