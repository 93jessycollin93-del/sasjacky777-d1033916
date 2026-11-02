/**
 * A star system the ship can be in: the Solar System, or any other star's.
 *
 * The flight (newton.ts), the space view and the ship's screen ask one of
 * these where they used to read the Solar System's catalogue directly: which
 * bodies there are, where each is at a moment, how fast it moves, what air it
 * has and whether there is ground to land on. The Solar System answers from
 * the real ephemerides (ephemeris.ts); another star's system from the Kepler
 * orbits its generator gave it (systems.ts). Either way a system's star has
 * the id "sun" — the root of its frames.
 */
import { BODIES, BODY, kindLabel as solKind, moonsOf as solMoons, type BodyDef } from "./bodies";
import { ephemeris, frameOf as solFrame, orbitPath as solOrbitPath, velocityOf as solVelocity } from "./ephemeris";
import { makeBelt, BELTS, type Belt } from "./belts";
import { SOL, starById, type Star } from "./galaxy";
import { DEG, equatorFrame, fromOrbitPlane, scale, sub, type Vec3 } from "./kepler";
import { AIR } from "./newton";
import { keplerPosition, systemOf, type StarSystemDef } from "./systems";
import { flightAir, solWorld, WORLD_LABEL, type WorldInfo } from "./worlds";

/** Air as the flight model wants it: scale height (km), density at the ground (kg/m³), and where it stops mattering (km up). */
export interface FlightAir { H: number; rho0: number; top: number; table?: readonly [number, number][] }

export interface StarSystem {
  /** The star's id on the galaxy map. */
  readonly id: string;
  readonly star: Star;
  /** "the Solar System", "the Proxima Centauri system". */
  readonly name: string;
  readonly solar: boolean;
  readonly bodies: readonly BodyDef[];
  /** Its belts of rubble, as point clouds for the view. */
  readonly belts: readonly Belt[];
  body(id: string): BodyDef | undefined;
  /** Every body at a date, km from the star. */
  positions(jd: number): Map<string, Vec3>;
  /** A body's velocity from the star at a date, km/s. */
  velocity(id: string, jd: number): Vec3;
  air(id: string): FlightAir | null;
  /** What a body is like to stand on, for one with ground (the Earth is not one: it is the overworld). */
  world(id: string): WorldInfo | null;
  /** A body's orbit as points relative to what it goes round (km), to draw. */
  orbitPath(id: string, jd: number, count: number): { around: string; points: Vec3[] } | null;
  /** A body's equatorial frame in the system's reference frame. */
  frame(id: string): { x: Vec3; y: Vec3; z: Vec3 };
  moonsOf(id: string): BodyDef[];
  /** "Planet", "Ocean world", "Moon of Saturn"… for the overview. */
  kindLabel(b: BodyDef): string;
}

// ---- the Solar System ------------------------------------------------------------------------------------------------

class SolarSystem implements StarSystem {
  readonly id = SOL.id;
  readonly star = SOL;
  readonly name = "the Solar System";
  readonly solar = true;
  readonly bodies = BODIES;
  readonly belts = BELTS;
  private worlds = new Map<string, WorldInfo | null>();

  body(id: string) { return BODY[id]; }
  positions(jd: number) { return ephemeris(jd); }
  velocity(id: string, jd: number): Vec3 { return id === "sun" ? [0, 0, 0] : solVelocity(id, jd); }
  air(id: string): FlightAir | null { const a = AIR[id]; return a ? { H: a.H, rho0: a.rho0, top: a.top, table: a.table } : null; }
  world(id: string): WorldInfo | null {
    if (!this.worlds.has(id)) { const b = BODY[id]; this.worlds.set(id, b ? solWorld(id, b.gm, b.radius) : null); }
    return this.worlds.get(id)!;
  }
  orbitPath(id: string, jd: number, count: number) { return solOrbitPath(id, jd, count); }
  frame(id: string) { return solFrame(id); }
  moonsOf(id: string) { return solMoons(id); }
  kindLabel(b: BodyDef) { return solKind(b); }
}

export const SOLAR_SYSTEM: StarSystem = new SolarSystem();

// ---- another star's -------------------------------------------------------------------------------------------------

/** The ecliptic's north pole as right ascension and declination: every generated system's reference plane is its "ecliptic". */
const REFERENCE_POLE: [number, number] = [270, 66.560709];

class GeneratedSystem implements StarSystem {
  readonly id: string;
  readonly star: Star;
  readonly name: string;
  readonly solar = false;
  readonly bodies: readonly BodyDef[];
  readonly belts: readonly Belt[];
  private readonly map: Map<string, BodyDef>;
  private last: { jd: number; at: Map<string, Vec3> } | null = null;
  private frames = new Map<string, { x: Vec3; y: Vec3; z: Vec3 }>();

  constructor(readonly def: StarSystemDef) {
    this.id = def.id;
    this.star = def.star;
    this.name = `the ${def.star.name} system`;
    this.bodies = def.bodies;
    this.map = new Map(def.bodies.map((b) => [b.id, b]));
    this.belts = def.belts.map((b, i) => makeBelt(b.name, b.kind === "asteroid" ? 2600 : 2000, b.kind === "asteroid" ? [0.6, 0.56, 0.52] : [0.7, 0.66, 0.64], b.inner, b.outer, def.mass, def.star.id.length * 31 + i));
  }

  body(id: string) { return this.map.get(id); }

  positions(jd: number): Map<string, Vec3> {
    if (this.last && this.last.jd === jd) return this.last.at;
    const at = new Map<string, Vec3>();
    at.set("sun", [0, 0, 0]);
    for (const b of this.bodies) if (b.orbit.kind === "kepler") at.set(b.id, this.place(b, jd, at));
    this.last = { jd, at };
    return at;
  }

  private place(b: BodyDef, jd: number, known?: Map<string, Vec3>): Vec3 {
    if (b.orbit.kind !== "kepler") return [0, 0, 0];
    const rel = keplerPosition(b.orbit, jd);
    const parent = b.parent && b.parent !== "sun" ? (known?.get(b.parent) ?? this.place(this.map.get(b.parent)!, jd)) : [0, 0, 0];
    return [parent[0] + rel[0], parent[1] + rel[1], parent[2] + rel[2]];
  }

  velocity(id: string, jd: number): Vec3 {
    const b = this.map.get(id);
    if (!b || b.orbit.kind !== "kepler") return [0, 0, 0];
    // A step short beside the period, either side: a close moon's year is hours, a far giant's decades.
    const h = Math.min(1 / 1440, b.orbit.period / 4000);
    return scale(sub(this.place(b, jd + h), this.place(b, jd - h)), 1 / (2 * h * 86400));
  }

  air(id: string): FlightAir | null {
    const w = this.map.get(id)?.world;
    return w ? flightAir(w) : null;
  }

  world(id: string): WorldInfo | null { return this.map.get(id)?.world ?? null; }

  orbitPath(id: string, _jd: number, count: number) {
    const b = this.map.get(id);
    if (!b || b.orbit.kind !== "kepler") return null;
    const o = b.orbit, bb = o.a * Math.sqrt(1 - o.e * o.e);
    const points: Vec3[] = [];
    for (let k = 0; k <= count; k++) {
      const E = (k / count) * 2 * Math.PI;
      points.push(fromOrbitPlane(o.a * (Math.cos(E) - o.e), bb * Math.sin(E), o.node * DEG, o.i * DEG, o.peri * DEG));
    }
    return { around: b.parent ?? "sun", points };
  }

  frame(id: string) {
    let f = this.frames.get(id);
    if (!f) {
      const pole = this.map.get(id)?.pole ?? REFERENCE_POLE;
      f = equatorFrame(pole[0], pole[1]);
      this.frames.set(id, f);
    }
    return f;
  }

  moonsOf(id: string) { return this.bodies.filter((b) => b.parent === id && b.kind === "moon").sort((a, b) => b.radius - a.radius); }

  kindLabel(b: BodyDef): string {
    if (b.kind === "star") return `${this.star.spectral} star`;
    if (b.kind === "moon") return `Moon of ${this.map.get(b.parent!)?.name ?? "?"}`;
    return b.world ? WORLD_LABEL[b.world.type] : "Planet";
  }
}

const cache = new Map<string, StarSystem>();

/** A star's system: the real Solar System for the Sun, a generated one for every other star (kept for the next ask). */
export function systemFor(star: Star): StarSystem {
  if (star.id === SOL.id) return SOLAR_SYSTEM;
  let s = cache.get(star.id);
  if (!s) {
    s = new GeneratedSystem(systemOf(star)!);
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
    cache.set(star.id, s);
  }
  return s;
}

/** A system from its star's id (a save, a planet world's name), or null if no such star can be made. */
export function systemById(id: string): StarSystem | null {
  const star = starById(id);
  return star ? systemFor(star) : null;
}
