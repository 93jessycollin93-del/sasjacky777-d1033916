/**
 * Flying for real: gravity, and an engine that can only push so hard.
 *
 * The arcade model (flight.ts) flies the way EVE does — a ship "stopped" 400
 * km over the Earth just hangs there. Here it falls. A launch puts it in a
 * true circular orbit, 7.7 km/s eastward, round the Earth every hour and a
 * half; with the engine off it follows its conic exactly (orbit.ts), at any
 * time warp; and the same orders the arcade gives are flown by an autopilot
 * that has to fight gravity with a 5 g engine to carry them out.
 *
 * - **Patched conics.** Only the body whose sphere of influence the ship is
 *   in pulls on it. Leaving that sphere, or entering a moon's, the ship's
 *   position and velocity are carried into the new body's frame — its velocity
 *   relative to the new body is the old one plus the difference of the two
 *   bodies' own velocities, which is what makes a flyby bend and a trip to the
 *   Moon arrive at the speed it really would.
 * - **Orbits as real ones are flown.** "Orbit" at a planet is a transfer, not
 *   a steering loop: round the orbit off, burn to put its far side at the
 *   height asked for, coast there, round it off again — a Hohmann transfer,
 *   the way every spacecraft changes height.
 * - **The air.** Earth, Venus, Mars, Titan and the giants have atmospheres
 *   (exponential, from NASA's planetary fact sheets); flying through one is
 *   drag against air that turns with the planet, and heat. Down through the
 *   Earth's, a parachute opens under 10 km and the ship lands where its path
 *   took it — into the world.
 * - **Nothing crashes.** Anywhere without a world to land in, the flight
 *   computer will not let the ship fall below a safe height: it pulls up into
 *   an orbit and says so.
 *
 * Units: km, km/s, km/s², seconds.
 */
import { add, cross, dot, len, norm, scale, sub, type Vec3 } from "./kepler";
import { elementsOf, propagate, timeToAnomaly, timeToRadius } from "./orbit";
import { engageWarp, shipPosition, topSpeed, wanted, warpStep, type BurnDir, type Order, type Ship, type Surroundings } from "./flight";

export type FlightEvent = "warp" | "arrived" | "orbit" | "entry" | "chute" | "landed" | "pullup" | "soi";

/**
 * The Earth's air, density (kg/m³) by geometric altitude (km): the U.S.
 * Standard Atmosphere, 1976. One exponential with a 7 km scale height was a
 * third too thin at 70 km and twice too thick at 120 — enough to move a
 * landing by a hundred kilometres. Between rows the logarithm of density is
 * interpolated, which follows each layer's own scale height to within 2%.
 */
export const US76: readonly [number, number][] = [
  [0, 1.225], [5, 0.73643], [10, 0.41351], [15, 0.19476], [20, 0.08891], [25, 0.040084], [30, 0.01841],
  [40, 3.9957e-3], [50, 1.0269e-3], [60, 3.0968e-4], [70, 8.2829e-5], [80, 1.8458e-5], [90, 3.416e-6],
  [100, 5.604e-7], [110, 9.708e-8], [120, 2.222e-8],
];

/** Density at an altitude from an atmosphere's table, or its exponential where it has none. */
export function densityAt(air: { H: number; rho0: number; table?: readonly [number, number][] }, alt: number): number {
  const h = Math.max(0, alt), t = air.table;
  if (!t) return air.rho0 * Math.exp(-h / air.H);
  if (h >= t[t.length - 1][0]) {
    const [h1, r1] = t[t.length - 1], [h0, r0] = t[t.length - 2];
    return r1 * Math.exp(((h - h1) * Math.log(r1 / r0)) / (h1 - h0));
  }
  let k = 0;
  while (t[k + 1][0] < h) k++;
  const [h0, r0] = t[k], [h1, r1] = t[k + 1];
  return r0 * Math.exp(((h - h0) * Math.log(r1 / r0)) / (h1 - h0));
}

/**
 * Atmospheres: scale height H (km), density at the surface or, for a giant, at
 * the one-bar level (kg/m³), and where the air stops mattering (km up). The
 * Earth's density comes from its table; its scale height is kept for anything
 * that asks for one, and fits the layer an entry slows in, 50–100 km up.
 */
export const AIR: Record<string, { H: number; rho0: number; top: number; lands?: boolean; table?: readonly [number, number][] }> = {
  earth: { H: 7.0, rho0: 1.225, top: 120, lands: true, table: US76 },
  venus: { H: 15.9, rho0: 65, top: 250 },
  mars: { H: 11.1, rho0: 0.02, top: 130 },
  titan: { H: 21, rho0: 5.3, top: 600 },
  jupiter: { H: 27, rho0: 0.16, top: 1000 },
  saturn: { H: 59.5, rho0: 0.19, top: 1500 },
  uranus: { H: 27.7, rho0: 0.42, top: 1000 },
  neptune: { H: 19.7, rho0: 0.45, top: 1000 },
};

/** The ship's ballistic coefficient (mass over drag area, kg/m²), and with the parachute out. */
export const BETA = 250;
export const CHUTE_BETA = 4;
/** Seconds for the parachute to open fully. */
export const CHUTE_OPENING = 8;

/** Where the entry burn aims the lowest point of the orbit: 50 km up, deep enough that the air takes it and shallow enough to spare the crew (a ballistic entry from there peaks near 6 g). */
export const ENTRY_PERIAPSIS = 50;

export const thrustOf = (s: Ship): number => s.cls.thrust * (s.mwd ? 5 : 1);

const gmOf = (w: Surroundings, id: string): number => w.gm?.(id) ?? 0;

/** The air round a body: the system's, or the Solar System's own table. */
export const airOf = (w: Surroundings, id: string): { H: number; rho0: number; top: number; table?: readonly [number, number][] } | null => (w.air ? w.air(id) : AIR[id] ?? null);
/** Whether the ship can come down on a body. */
export const landsOn = (w: Surroundings, id: string): boolean => (w.lands ? w.lands(id) : !!AIR[id]?.lands);

function gravity(mu: number, r: Vec3): Vec3 {
  const d = len(r);
  return d > 0 ? scale(r, -mu / (d * d * d)) : [0, 0, 0];
}

const clampLen = (v: Vec3, max: number): Vec3 => { const l = len(v); return l > max ? scale(v, max / l) : v; };

/** The lowest the flight computer lets the ship go over a body it cannot land on, km above the surface. */
export function floorOf(w: Surroundings, id: string): number {
  if (landsOn(w, id)) return -Infinity;
  const air = airOf(w, id);
  if (air) return air.top * 0.2;
  return Math.max(1, w.radius(id) * 0.0005);
}

/** The lowest safe circular orbit: above the air, or a little above the ground. */
export function safeAltitude(w: Surroundings, id: string): number {
  const air = airOf(w, id);
  return air ? air.top + 20 : Math.max(5, w.radius(id) * 0.02);
}

/** The air round the ship, if it is in some: its density, and the ship's velocity through it (the air turns with the planet). */
export function airAround(s: Ship, w: Surroundings, r: Vec3 = s.pos, v: Vec3 = s.vel): { rho: number; vAir: Vec3; alt: number } | null {
  const air = airOf(w, s.frame);
  if (!air) return null;
  const alt = len(r) - w.radius(s.frame);
  if (alt > air.top) return null;
  const spin = w.spin?.(s.frame) ?? [0, 0, 0];
  return { rho: densityAt(air, alt), vAir: sub(v, cross(spin, r)), alt };
}

/** Drag's deceleration, km/s²: half ρv² over the ballistic coefficient, against the velocity through the air. */
function drag(s: Ship, w: Surroundings, r: Vec3, v: Vec3): Vec3 {
  const a = airAround(s, w, r, v);
  if (!a) return [0, 0, 0];
  const u = len(a.vAir);
  if (u < 1e-9) return [0, 0, 0];
  // ρ (kg/m³) × (u km/s → m/s)² / β (kg/m²) is m/s²; a thousandth of that is km/s².
  // The canopy opens over a few seconds, the drag area growing as it fills: all at once would be a jolt of hundreds of g.
  const beta = BETA * Math.pow(CHUTE_BETA / BETA, s.chute);
  const k = (500 * a.rho * u * u) / beta;
  return scale(a.vAir, -k / u);
}

/** A burn's direction: along the velocity (prograde), across the orbit's plane (normal), or out from the body (radial). */
export function burnDirection(dir: BurnDir, r: Vec3, v: Vec3, fallback: Vec3): Vec3 {
  const pro = len(v) > 1e-9 ? norm(v) : fallback;
  const h = cross(r, v);
  const normal = len(h) > 1e-12 ? norm(h) : norm(cross(r, fallback));
  const radial = norm(r);
  switch (dir) {
    case "prograde": return pro;
    case "retrograde": return scale(pro, -1);
    case "normal": return normal;
    case "antinormal": return scale(normal, -1);
    case "radial": return radial;
    case "antiradial": return scale(radial, -1);
  }
}

/** The velocity of a circular orbit through where the ship is, going the way it already goes round. */
export function circularVelocity(r: Vec3, v: Vec3, mu: number, pole: Vec3 = [0, 0, 1]): Vec3 {
  const up = norm(r);
  let across = sub(v, scale(up, dot(v, up)));
  // From a standstill, go round the way the body turns.
  if (len(across) < 1e-6) across = cross(pole, up);
  if (len(across) < 1e-6) across = cross([1, 0, 0], up);
  return scale(norm(across), Math.sqrt(mu / len(r)));
}

interface Command {
  /** The engine's acceleration, km/s². */
  a: Vec3;
  /** Where the nose should point, if anywhere in particular. */
  aim: Vec3 | null;
  event?: FlightEvent;
}

const IDLE: Command = { a: [0, 0, 0], aim: null };

/** Throttle kept up until close to a goal, then eased off, so a burn does not overshoot what it was aiming at. */
const ease = (gap: number, span: number): number => Math.max(0.03, Math.min(1, gap / span));

/** What the engine does this step, to carry out the order. */
function command(s: Ship, w: Surroundings, dt: number): Command {
  const o = s.order, mu = gmOf(w, s.frame), amax = thrustOf(s);
  const r = s.pos, v = s.vel;
  switch (o.kind) {
    case "coast": return IDLE;
    case "burn": {
      const d = burnDirection(o.dir, r, v, s.heading);
      return { a: scale(d, amax), aim: d };
    }
    case "circularize": {
      const want = circularVelocity(r, v, mu, w.pole?.(s.frame));
      const gap = sub(want, v);
      if (len(gap) < 5e-4) { s.order = { kind: "coast" }; return { ...IDLE, event: "orbit" }; }
      const a = clampLen(scale(gap, 1 / Math.max(dt, 0.5)), amax);
      return { a, aim: norm(gap) };
    }
    case "land": return landing(s, w, o, mu, amax);
    case "warp": {
      // The warp drive needs the nose on the target and a few seconds to spool up; the engine stays off.
      const t = w.pos(o.target);
      if (!t) return IDLE;
      const dir = norm(sub(t, shipPosition(s, w)));
      if (dot(s.heading, dir) > Math.cos((5 * Math.PI) / 180)) s.spool += dt;
      else s.spool = 0;
      if (s.spool >= s.cls.tau * Math.log(4) && engageWarp(s, w, o)) { s.spool = 0; return { ...IDLE, aim: dir, event: "warp" }; }
      return { ...IDLE, aim: dir };
    }
    case "orbit":
      if (o.target === s.frame && mu > 0 && Math.sqrt(mu / (w.radius(o.target) + o.range)) > topSpeed(s)) return transfer(s, w, o, mu, amax, dt);
      return follow(s, w, mu, amax);
    default: return follow(s, w, mu, amax);
  }
}

/**
 * The arcade's orders flown against gravity: the velocity field the order
 * wants (flight.ts), what it takes to follow it as it curves, and the engine
 * holding the ship up against the pull of whatever it is near.
 */
function follow(s: Ship, w: Surroundings, mu: number, amax: number): Command {
  const here = shipPosition(s, w);
  const want = wanted(s, w, here);
  const h = 0.5;
  const ahead = wanted(s, w, add(here, scale(s.vel, h)));
  const curve = scale(sub(ahead, want), 1 / h);
  const a = clampLen(add(add(scale(sub(want, s.vel), 1 / s.cls.tau), curve), scale(gravity(mu, s.pos), -1)), amax);
  return { a, aim: len(want) > 1e-6 ? norm(want) : null };
}

/** An orbit at a height round the body the ship is at: round off, burn, coast half an orbit, round off again. */
function transfer(s: Ship, w: Surroundings, o: Extract<Order, { kind: "orbit" }>, mu: number, amax: number, dt: number): Command {
  const R = w.radius(s.frame) + Math.max(o.range, safeAltitude(w, s.frame));
  const el = elementsOf(s.pos, s.vel, mu);
  const d = len(s.pos);
  const phase = o.phase ?? "circ1";
  const round = (next: Order): Command => {
    const want = circularVelocity(s.pos, s.vel, mu, w.pole?.(s.frame));
    const gap = sub(want, s.vel);
    if (len(gap) < 5e-4) { s.order = next; return { ...IDLE, event: next.kind === "coast" ? "orbit" : undefined }; }
    return { a: clampLen(scale(gap, 1 / Math.max(dt, 0.5)), amax), aim: norm(gap) };
  };
  switch (phase) {
    case "circ1":
      if (el.e < 0.005 && el.a > 0) {
        if (Math.abs(d - R) / R < 0.005) { s.order = { kind: "coast" }; return { ...IDLE, event: "orbit" }; }
        o.phase = "burn";
        return IDLE;
      }
      return round({ ...o, phase: "burn" });
    case "burn": {
      const raising = R > d;
      const apsis = raising ? el.apoapsis : el.periapsis;
      if (raising ? apsis >= R : apsis <= R) { o.phase = "coast"; return IDLE; }
      const d0 = burnDirection(raising ? "prograde" : "retrograde", s.pos, s.vel, s.heading);
      return { a: scale(d0, amax * ease(Math.abs(apsis - R), 0.05 * R)), aim: d0 };
    }
    case "coast": {
      const t = timeToAnomaly(el, mu, R > el.periapsis * 1.001 ? Math.PI : 0);
      if (t === null || t <= dt * 1.5 || Math.abs(d - R) / R < 0.001) o.phase = "circ2";
      return IDLE;
    }
    case "circ2": return round({ kind: "coast" });
  }
}

/** Down to the Earth: burn retrograde until the orbit dips into the air, then let it. */
function landing(s: Ship, w: Surroundings, o: Extract<Order, { kind: "land" }>, mu: number, amax: number): Command {
  const R = w.radius(s.frame);
  if (o.phase === "entry" || airAround(s, w)) { o.phase = "entry"; return IDLE; }
  const el = elementsOf(s.pos, s.vel, mu);
  const low = el.periapsis - R;
  if (low <= ENTRY_PERIAPSIS) { o.phase = "entry"; return IDLE; }
  o.phase = "deorbit";
  const d = burnDirection("retrograde", s.pos, s.vel, s.heading);
  return { a: scale(d, amax * ease(low - ENTRY_PERIAPSIS, 60)), aim: d };
}

/** Moves the ship into another body's frame, carrying its velocity across: the old frame's motion is added, the new one's taken off. */
export function transferFrame(s: Ship, w: Surroundings, to: string): void {
  if (to === s.frame) return;
  const from = w.pos(s.frame), into = w.pos(to);
  if (!from || !into) return;
  const vf = w.vel?.(s.frame) ?? [0, 0, 0], vt = w.vel?.(to) ?? [0, 0, 0];
  s.pos = sub(add(from, s.pos), into);
  s.vel = sub(add(vf, s.vel), vt);
  s.frame = to;
}

/** Out of the sphere it was in, or into a smaller one inside it. Returns whether the frame changed. */
export function crossSpheres(s: Ship, w: Surroundings): boolean {
  if (s.frame !== "sun") {
    const mine = w.places.find((p) => p.id === s.frame);
    if (mine && len(s.pos) > mine.reach) {
      transferFrame(s, w, w.parent?.(s.frame) ?? "sun");
      return true;
    }
  }
  const here = shipPosition(s, w);
  for (const p of w.places) {
    if (p.id === s.frame || (w.parent?.(p.id) ?? "sun") !== s.frame) continue;
    const q = w.pos(p.id);
    if (q && len(sub(here, q)) < p.reach) { transferFrame(s, w, p.id); return true; }
  }
  return false;
}

/** The ship arriving out of warp: in a circular orbit where there is gravity enough to hold one, holding station where there is not. */
export function settleAfterWarp(s: Ship, w: Surroundings): FlightEvent {
  const mu = gmOf(w, s.frame), d = len(s.pos);
  if (mu > 0 && Math.sqrt(mu / d) > 0.01) {
    s.vel = circularVelocity(s.pos, [0, 0, 0], mu, w.pole?.(s.frame));
    s.order = { kind: "coast" };
    return "orbit";
  }
  s.vel = [0, 0, 0];
  s.order = { kind: "stop" };
  return "arrived";
}

/** One step of warp under real physics: the drive is the same; what changes is the orbit the ship comes out into. */
export function newtonWarp(s: Ship, w: Surroundings, dt: number): FlightEvent | null {
  if (!s.warp) return null;
  if (warpStep(s, w, dt) !== "arrived") return null;
  settleAfterWarp(s, w);
  return "arrived";
}

/**
 * One step of `dt` seconds of the Solar System's own time. Coasting in empty
 * space is solved exactly, so `dt` can be as long as the caller likes; with
 * the engine on or in the air, it integrates (velocity Verlet), and the caller
 * keeps `dt` small — a quarter of a second does.
 */
export function newtonStep(s: Ship, w: Surroundings, dt: number): FlightEvent | null {
  if (dt <= 0 || s.landed) return null;
  if (s.warp) return null;
  const mu = gmOf(w, s.frame);
  const cmd = command(s, w, dt);
  let event: FlightEvent | null = cmd.event ?? null;
  if (s.warp) return event;
  const wasInAir = !!airAround(s, w);
  const burning = len(cmd.a) > 1e-9;
  if (!burning && !wasInAir) {
    // The exact coast — unless it would carry the ship into the air or under the floor before the step is out,
    // in which case it coasts to there, and the rest of the step is flown in small steps.
    const R = w.radius(s.frame), air = airOf(w, s.frame);
    const edge = R + (air ? air.top : floorOf(w, s.frame)) - 1e-3;
    const tEdge = mu > 0 ? timeToRadius(s.pos, s.vel, mu, edge) : null;
    const t = tEdge !== null && tEdge < dt ? tEdge : dt;
    const p = propagate(s.pos, s.vel, mu, t);
    s.pos = p.r; s.vel = p.v;
    if (air && t < dt) for (let left = dt - t, i = 0; left > 1e-9 && i < 4000; i++) {
      const h = Math.min(0.25, left);
      integrate(s, w, mu, [0, 0, 0], h);
      left -= h;
    }
  } else integrate(s, w, mu, cmd.a, dt);
  s.engine = burning ? len(cmd.a) / thrustOf(s) : 0;
  if (cmd.aim) s.heading = norm(add(s.heading, scale(sub(cmd.aim, s.heading), Math.min(1, dt * 3))));

  // The air: heat, the parachute, and the ground.
  const air = airAround(s, w);
  if (air) {
    const u = len(air.vAir);
    s.heat = Math.min(1, 0.2 * Math.sqrt(air.rho) * u * u * u);
    if (!wasInAir && u > 1) event ??= "entry";
    if (s.chute === 0 && landsOn(w, s.frame) && air.alt < 10 && u < 0.3) { s.chute = 1e-3; event ??= "chute"; }
    if (s.chute > 0) s.chute = Math.min(1, s.chute + dt / CHUTE_OPENING);
  } else s.heat = 0;
  const alt = len(s.pos) - w.radius(s.frame);
  const falling = dot(s.pos, s.vel) < 0;
  if (landsOn(w, s.frame) && alt <= 0.2) {
    s.landed = true;
    s.vel = [0, 0, 0];
    s.engine = 0;
    return "landed";
  }
  if (alt < floorOf(w, s.frame) && falling) {
    // The flight computer will not fly into the ground: back up to the floor, the fall taken out, and into an orbit.
    const up = norm(s.pos);
    s.pos = scale(up, w.radius(s.frame) + floorOf(w, s.frame));
    s.vel = sub(s.vel, scale(up, dot(s.vel, up)));
    s.order = mu > 0 && Math.sqrt(mu / len(s.pos)) > topSpeed(s)
      ? { kind: "orbit", target: s.frame, range: safeAltitude(w, s.frame) }
      : { kind: "stop" };
    return "pullup";
  }
  if (crossSpheres(s, w)) event ??= "soi";
  return event;
}

/** A small step of velocity Verlet under gravity, the engine and the air. */
function integrate(s: Ship, w: Surroundings, mu: number, thrust: Vec3, dt: number): void {
  const acc = (r: Vec3, v: Vec3) => add(add(gravity(mu, r), thrust), drag(s, w, r, v));
  const a1 = acc(s.pos, s.vel);
  const vh = add(s.vel, scale(a1, dt / 2));
  const r2 = add(s.pos, scale(vh, dt));
  const a2 = acc(r2, vh);
  s.pos = r2;
  s.vel = add(vh, scale(a2, dt / 2));
  s.dv += len(thrust) * dt;
}

/** Whether a step would need the small-step integrator rather than the exact coast: the engine on, or in the air. */
export function needsSmallSteps(s: Ship, w: Surroundings): boolean {
  if (s.warp || s.landed) return false;
  const o = s.order;
  if (o.kind !== "coast" && !(o.kind === "orbit" && o.phase === "coast") && !(o.kind === "land" && o.phase === "entry" && !airAround(s, w))) return true;
  return !!airAround(s, w);
}

/** A summary of the orbit the ship is on round the body it is near, for the ship's panel. */
export function orbitSummary(s: Ship, w: Surroundings): { periapsis: number; apoapsis: number; period: number; incl: number; e: number; speed: number; altitude: number } | null {
  const mu = gmOf(w, s.frame);
  if (!(mu > 0)) return null;
  const el = elementsOf(s.pos, s.vel, mu, w.pole?.(s.frame));
  const R = w.radius(s.frame);
  return { periapsis: el.periapsis - R, apoapsis: el.apoapsis - R, period: el.period, incl: el.incl, e: el.e, speed: len(s.vel), altitude: len(s.pos) - R };
}
