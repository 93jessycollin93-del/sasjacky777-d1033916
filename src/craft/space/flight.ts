/**
 * Flying the ship, the way EVE Online flies ships: you do not steer, you give
 * orders — approach that, orbit this at 20 km, align to that planet, warp to
 * it — and the ship carries them out with its own inertia.
 *
 * - Below warp, velocity closes on the velocity the order wants exponentially:
 *   v += (want − v)(1 − e^(−dt/τ)). τ is the ship's agility; its "align time",
 *   the time to reach three quarters of top speed in a new direction, is τ ln 4.
 * - Warp needs the ship aligned: pointed at the destination and moving at
 *   three quarters of its top speed. Then the speed grows exponentially with
 *   the distance covered, cruises at the ship's warp speed (in AU a second),
 *   and falls exponentially with the distance left, dropping the ship out of
 *   warp at the range asked for, on the side it came from.
 * - Positions are kept relative to the body whose neighbourhood the ship is in
 *   (its sphere of influence, or a small body's own patch of space), so that
 *   "stopped" means stopped beside the planet, not left behind while the planet
 *   sails on round the Sun at 30 km/s. Crossing into another's neighbourhood,
 *   the ship keeps its speed relative to the new body: space is a set of places,
 *   as EVE's grids are, rather than one big inertial frame.
 *
 * That is the arcade model, kept for anyone who wants EVE's grids. The real
 * one — gravity, a thrust-limited engine, orbits that are orbits — is in
 * newton.ts, and uses this file's orders, warp and frames.
 *
 * Pure state and a step function, so the rules are tested without a screen.
 */
import { add, AU, cross, dot, len, norm, scale, sub, type Vec3 } from "./kepler";

export interface ShipClass {
  name: string;
  /** Top speed below warp, km/s. */
  maxSpeed: number;
  /** Agility: the velocity's time constant, seconds. */
  tau: number;
  /** Warp speed, AU/s. */
  warpSpeed: number;
  /** Length, km: how close things may come. */
  length: number;
  /** The engine's acceleration, km/s², under real physics (newton.ts). */
  thrust: number;
}

/** The ship a launch puts you in: a light scout, frigate-sized and quick in and out of warp. */
export const SCOUT: ShipClass = { name: "Kestrel-class scout", maxSpeed: 0.42, tau: 2.4, warpSpeed: 5, length: 0.042, thrust: 0.05 };

/** The burns a pilot makes by hand, named the way flight dynamics names them: along, against or across the orbit. */
export type BurnDir = "prograde" | "retrograde" | "normal" | "antinormal" | "radial" | "antiradial";

export type Order =
  | { kind: "stop" }
  | { kind: "heading"; dir: Vec3 }
  | { kind: "approach"; target: string }
  | { kind: "orbit"; target: string; range: number; phase?: "circ1" | "burn" | "coast" | "circ2" }
  | { kind: "keep"; target: string; range: number }
  | { kind: "align"; target: string }
  | { kind: "warp"; target: string; range: number }
  /** Real physics only: the engine off, falling round whatever the ship is near. */
  | { kind: "coast" }
  | { kind: "burn"; dir: BurnDir }
  | { kind: "circularize" }
  /** Down to the Earth: a burn to bring the orbit into the air, and then the air does the rest. */
  | { kind: "land"; phase?: "deorbit" | "entry" };

export interface Warp {
  target: string;
  range: number;
  /** Covered so far (km) and left to go, and the speed now (km/s). */
  covered: number;
  left: number;
  speed: number;
  /** The unit direction of travel, in the target's frame. */
  dir: Vec3;
}

export interface Ship {
  cls: ShipClass;
  /** The body whose neighbourhood it is in; its position and velocity are relative to that body. */
  frame: string;
  pos: Vec3;
  vel: Vec3;
  /** Where its nose points (unit). */
  heading: Vec3;
  order: Order;
  warp: Warp | null;
  /** The microwarpdrive: five times the speed below warp, as EVE's MWD gives. */
  mwd: boolean;
  /** Arcade (EVE's grids, no gravity) or newton (gravity, a thrust-limited engine: newton.ts). */
  physics: "arcade" | "newton";
  /** Δv the engine has spent, km/s. */
  dv: number;
  /** How hard the engine is burning now, 0..1. */
  engine: number;
  /** Heating in the air, 0..1, and how far open the parachute is, 0 (stowed) to 1. */
  heat: number;
  chute: number;
  /** Seconds the warp drive has been spooling up, pointed at its target. */
  spool: number;
  /** On the ground. */
  landed: boolean;
}

/** What the ship needs to know of the Solar System at this moment. */
export interface Surroundings {
  /** A body's position, km from the Sun; null if it is not there. */
  pos(id: string): Vec3 | null;
  radius(id: string): number;
  /** The bodies whose neighbourhoods a ship can be in, with their reach (km): smallest reach first. */
  places: { id: string; reach: number }[];
  /** For real physics: a body's GM (km³/s²), its velocity from the Sun (km/s), what it goes round, its north pole, and its spin (rad/s about the pole). */
  gm?(id: string): number;
  vel?(id: string): Vec3;
  parent?(id: string): string | null;
  pole?(id: string): Vec3;
  spin?(id: string): Vec3;
  /**
   * The air round a body (newton.ts), and whether the ship can come down on it:
   * the current star system's answer (starSystem.ts). Absent, the Solar
   * System's own table is used, with only the Earth to land on.
   */
  air?(id: string): { H: number; rho0: number; top: number; table?: readonly [number, number][] } | null;
  lands?(id: string): boolean;
}

/** How close an order to approach may bring the ship: above the surface (a little more for a big world). */
export function standoff(radius: number, cls: ShipClass): number {
  return radius + Math.max(cls.length * 20, Math.min(radius * 0.005, 100));
}

/** Where the ship drops out of warp: `range` km from the surface, and for a world never below a safe altitude. */
export function warpInDistance(radius: number, range: number): number {
  return radius + Math.max(range, radius > 1000 ? radius * 0.063 : Math.max(1, radius * 0.5));
}

export const MIN_WARP = 150;

export function newShip(cls: ShipClass, frame: string, pos: Vec3, heading: Vec3 = [1, 0, 0], physics: Ship["physics"] = "arcade"): Ship {
  return {
    cls, frame, pos, vel: [0, 0, 0], heading: norm(heading), order: { kind: physics === "newton" ? "coast" : "stop" }, warp: null, mwd: false,
    physics, dv: 0, engine: 0, heat: 0, chute: 0, spool: 0, landed: false,
  };
}

/** The ship's position, km from the Sun. */
export function shipPosition(s: Ship, w: Surroundings): Vec3 {
  return add(w.pos(s.frame) ?? [0, 0, 0], s.pos);
}

export const topSpeed = (s: Ship): number => s.cls.maxSpeed * (s.mwd ? 5 : 1);

/** A body's position relative to the ship (or to a point, heliocentric). */
function toward(s: Ship, w: Surroundings, id: string, from?: Vec3): Vec3 | null {
  const p = w.pos(id);
  return p ? sub(p, from ?? shipPosition(s, w)) : null;
}

/** Whether the ship is pointed at the target and fast enough to go to warp. */
export function aligned(s: Ship, w: Surroundings, target: string): boolean {
  const t = toward(s, w, target);
  if (!t) return false;
  const v = len(s.vel);
  return v >= 0.75 * topSpeed(s) - 1e-9 && dot(norm(s.vel), norm(t)) > Math.cos((5 * Math.PI) / 180);
}

/** Why an order to warp cannot be carried out, or null if it can. */
export function warpRefusal(s: Ship, w: Surroundings, target: string, range: number): string | null {
  const t = toward(s, w, target);
  if (!t) return "That is not out there right now.";
  if (s.warp) return "Already in warp.";
  if (len(t) - warpInDistance(w.radius(target), range) < MIN_WARP) return "Too close to warp: approach it instead.";
  return null;
}

/**
 * The velocity (km/s, relative to the frame) that the order wants now — or,
 * given a heliocentric point, would want there (newton.ts reads the field a
 * moment ahead to know how it curves).
 */
export function wanted(s: Ship, w: Surroundings, at?: Vec3): Vec3 {
  const o = s.order, vmax = topSpeed(s);
  const toward_ = (id: string) => toward(s, w, id, at);
  switch (o.kind) {
    case "stop": case "coast": case "burn": case "circularize": case "land": return [0, 0, 0];
    case "heading": return scale(norm(o.dir), vmax);
    case "align": case "warp": {
      const t = toward_(o.target);
      return t ? scale(norm(t), vmax) : [0, 0, 0];
    }
    case "approach": case "keep": {
      const t = toward_(o.target);
      if (!t) return [0, 0, 0];
      const d = len(t);
      const stop = o.kind === "keep" ? w.radius(o.target) + o.range : standoff(w.radius(o.target), s.cls);
      // Slow over the last stretch so the ship comes to rest at its distance instead of sailing through it.
      const gap = d - stop;
      const k = Math.max(-1, Math.min(1, gap / (vmax * s.cls.tau * 1.2)));
      return o.kind === "approach" && gap < 0 ? [0, 0, 0] : scale(norm(t), vmax * k);
    }
    case "orbit": {
      const t = toward_(o.target);
      if (!t) return [0, 0, 0];
      const d = len(t), R = w.radius(o.target) + o.range;
      const inward = norm(t);
      // Circle in the plane the ship is already moving in; from a standstill, in the ecliptic's.
      let n = cross(inward, s.vel);
      if (len(n) < 1e-9) n = cross(inward, [0, 0, 1]);
      if (len(n) < 1e-9) n = cross(inward, [1, 0, 0]);
      const tangent = norm(cross(norm(n), inward));
      const pull = Math.max(-1, Math.min(1, (d - R) / (0.05 * R + 4 * vmax * s.cls.tau)));
      return scale(norm(add(tangent, scale(inward, pull * 1.5))), vmax);
    }
  }
}

/** Gives an order. A warp order starts by aligning; everything else takes over at once. Orders mean nothing in warp. */
export function order(s: Ship, o: Order): void {
  if (s.warp) return;
  s.order = o;
}

/** The neighbourhood a point is in: the smallest one that holds it, with a little give for the one already held. */
export function placeOf(w: Surroundings, helio: Vec3, current: string): string {
  const cur = w.places.find((p) => p.id === current);
  if (cur) {
    const c = w.pos(cur.id);
    if (c && len(sub(helio, c)) < cur.reach * 1.1) {
      // Still inside the current one — unless inside a smaller one within it.
      for (const p of w.places) {
        if (p.reach >= cur.reach) break;
        const q = w.pos(p.id);
        if (q && len(sub(helio, q)) < p.reach) return p.id;
      }
      return current;
    }
  }
  for (const p of w.places) {
    const q = w.pos(p.id);
    if (q && len(sub(helio, q)) < p.reach) return p.id;
  }
  return "sun";
}

/** Moves the ship into another body's frame, keeping where it is and its speed relative to its surroundings. */
export function reframe(s: Ship, w: Surroundings, frame: string): void {
  if (frame === s.frame) return;
  const helio = shipPosition(s, w);
  const f = w.pos(frame);
  if (!f) return;
  s.pos = sub(helio, f);
  s.frame = frame;
}

/**
 * Into warp: the ship now keeps its place relative to where it is going, so a
 * moving target cannot slip away. False (and an approach instead) if it is
 * already too close to need it.
 */
export function engageWarp(s: Ship, w: Surroundings, o: { target: string; range: number }): boolean {
  reframe(s, w, o.target);
  const d = len(s.pos);
  const left = d - warpInDistance(w.radius(o.target), o.range);
  if (left > MIN_WARP) {
    s.warp = { target: o.target, range: o.range, covered: 0, left, speed: len(s.vel), dir: scale(norm(s.pos), -1) };
    return true;
  }
  s.order = { kind: "approach", target: o.target };
  return false;
}

/** Warp's shape: how fast speed builds with distance covered, and falls with distance left (per second). */
const WARP_RATE = 3;
/** The speed a warp ends at (km/s). */
const WARP_EXIT = 0.1;

/**
 * One step of `dt` seconds. Returns what happened worth saying: "warp" as
 * the drive engages, "arrived" as the ship drops out.
 */
export function step(s: Ship, w: Surroundings, dt: number): "warp" | "arrived" | null {
  if (dt <= 0) return null;
  if (s.warp) return warpStep(s, w, dt);
  const want = wanted(s, w);
  const k = 1 - Math.exp(-dt / s.cls.tau);
  s.vel = add(s.vel, scale(sub(want, s.vel), k));
  s.pos = add(s.pos, scale(s.vel, dt));
  // The nose turns toward where the ship is going (or wants to go, when it is barely moving).
  const aim = len(s.vel) > 0.05 * s.cls.maxSpeed ? s.vel : len(want) > 0 ? want : s.heading;
  s.heading = norm(add(s.heading, scale(sub(norm(aim), s.heading), Math.min(1, dt * 3))));
  let event: "warp" | null = null;
  const o = s.order;
  if (o.kind === "warp" && aligned(s, w, o.target) && engageWarp(s, w, o)) event = "warp";
  if (!s.warp) reframe(s, w, placeOf(w, shipPosition(s, w), s.frame));
  return event;
}

export function warpStep(s: Ship, w: Surroundings, dt: number): "arrived" | null {
  const wp = s.warp!;
  const vw = s.cls.warpSpeed * AU, v0 = s.cls.maxSpeed;
  // Each limit on the speed, integrated exactly over the step; the smallest advance is the one that binds.
  const accel = (wp.covered + v0 / WARP_RATE) * Math.exp(WARP_RATE * dt) - v0 / WARP_RATE - wp.covered;
  const decel = wp.left - ((wp.left + WARP_EXIT / WARP_RATE) * Math.exp(-WARP_RATE * dt) - WARP_EXIT / WARP_RATE);
  const advance = Math.max(0, Math.min(accel, decel, vw * dt, wp.left));
  wp.covered += advance;
  wp.left -= advance;
  wp.speed = advance / dt;
  s.pos = add(s.pos, scale(wp.dir, advance));
  s.vel = scale(wp.dir, Math.min(wp.speed, topSpeed(s)));
  s.heading = wp.dir;
  if (wp.left <= 0.01) {
    s.warp = null;
    s.vel = [0, 0, 0];
    s.order = { kind: "stop" };
    reframe(s, w, placeOf(w, shipPosition(s, w), s.frame));
    return "arrived";
  }
  return null;
}

/** How long, roughly, a warp over `distance` km takes (s): for the overview's estimate. */
export function warpTime(cls: ShipClass, distance: number): number {
  const vw = cls.warpSpeed * AU;
  const ramp = vw / WARP_RATE;
  if (distance < 2 * ramp) return (2 * Math.log((WARP_RATE * distance) / 2 / cls.maxSpeed + 1)) / WARP_RATE;
  return (2 * Math.log(vw / cls.maxSpeed)) / WARP_RATE + (distance - 2 * ramp) / vw;
}

// ---- getting up there and back ---------------------------------------------------------------------------------------

/**
 * Where the ship starts after a launch: `altitude` km above a latitude and
 * longitude of the turning Earth, in the Earth's frame, nose to the east.
 * `siderealDeg` is Greenwich apparent sidereal time, and `eqToEcl` carries the
 * equator of date to the ecliptic (session.ts passes precession and nutation).
 */
export function aboveEarth(lat: number, lon: number, altitude: number, siderealDeg: number, eqToEcl: (v: Vec3) => Vec3, radius = 6378.137): { pos: Vec3; heading: Vec3 } {
  const la = (lat * Math.PI) / 180, lo = ((lon + siderealDeg) * Math.PI) / 180;
  const up: Vec3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east: Vec3 = [-Math.sin(lo), Math.cos(lo), 0];
  return { pos: eqToEcl(scale(up, radius + altitude)), heading: eqToEcl(east) };
}

/** The latitude and longitude under a point of the Earth's frame, and the height above the surface (km). */
export function belowShip(pos: Vec3, siderealDeg: number, eclToEq: (v: Vec3) => Vec3, radius = 6378.137): { lat: number; lon: number; altitude: number } {
  const q = eclToEq(pos);
  const r = len(q);
  const lat = (Math.asin(q[2] / r) * 180) / Math.PI;
  let lon = (Math.atan2(q[1], q[0]) * 180) / Math.PI - siderealDeg;
  lon = ((lon % 360) + 540) % 360 - 180;
  return { lat, lon, altitude: r - radius };
}
