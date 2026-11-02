/**
 * A trip to space: the Solar System's clock, the ship, the camera, what is
 * selected, and the orders — everything between a launch and a landing.
 *
 * The clock is the real one (the planets are where they are today) until
 * the player speeds it up. Under real physics (newton.ts, the default) the
 * ship keeps the Solar System's time: coasting, it follows its orbit exactly
 * at any speed of the clock; with the engine on or in the air the clock is
 * held to fifty times real, because those are flown in quarter-second steps.
 * In the arcade model the ship keeps its own time whatever the clock does, as
 * a ship in EVE would, while the worlds sweep round their orbits.
 *
 * The Earth under the ship is this world: a launch goes up from where the
 * player stands, placed on the globe from the world's own anchor (a latitude
 * and longitude chosen from its seed) at one block to the metre, and a landing
 * comes down wherever on Earth the ship is — which is somewhere in this world,
 * however far from home.
 */
import type { BodyDef } from "./bodies";
import { planetConic } from "./ephemeris";
import { AU, eclToEq, eqToEcl, fromDate, gast, jdFromMs, len, norm, raDecToEcl, scale, sub, toDate, type Vec3 } from "./kepler";
import { SOLAR_SYSTEM, systemFor, type StarSystem } from "./starSystem";
import { distance, LY_PER_PC, type Star } from "./galaxy";
import {
  aboveEarth, belowShip, MIN_WARP, newShip, order, SCOUT, shipPosition, step, warpInDistance, warpRefusal, warpTime, type Order, type Ship, type Surroundings,
} from "./flight";
import {
  airAround, airOf, circularVelocity, needsSmallSteps, newtonStep, newtonWarp, orbitSummary, safeAltitude, type FlightEvent,
} from "./newton";
import { elementsOf, pathAhead, pointAt, timeToAnomaly, timeToRadius } from "./orbit";
import type { SpaceCameraState, SpaceFrame } from "./spaceView";
import { GalaxyMap } from "./galaxyMap";

/** How fast the clock may run: from real time to a month a second. */
export const TIME_SCALES = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000, 3_000_000];

/** The fastest the clock runs while the engine burns or the ship is in the air, which are flown in small steps. */
export const PHYSICS_WARP = 50;
/** The most small steps of physics in one frame; past it the clock is held back rather than the physics skimped. */
const MAX_STEPS = 24;

/** A body's GM: the catalogue's, or for a small body, its size at a rocky (or, for a comet, fluffy) density. */
function gmOf(b: BodyDef | undefined): number {
  if (!b) return 0;
  if (b.gm) return b.gm;
  const rho = b.kind === "comet" || b.kind === "interstellar" ? 500 : b.kind === "probe" ? 0 : 2000;
  return 6.6743e-20 * (4 / 3) * Math.PI * Math.pow(b.radius * 1000, 3) * rho;
}

/** A body's north pole in the ecliptic frame. */
function poleOf(b: BodyDef | undefined): Vec3 {
  return b?.pole ? raDecToEcl(b.pole[0], b.pole[1]) : [0, 0, 1];
}

/** Metres in a degree of latitude, and of longitude at the equator: the world is the Earth at one block to the metre. */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;
/** The farthest a landing can put anyone from the world's centre, in blocks: inside the world's border. */
const WORLD_REACH = 29_000_000;

export interface OverviewRow {
  id: string;
  name: string;
  kind: string;
  type: string;
  /** From the ship to its surface, km. */
  distance: number;
}

export type OverviewTab = "planets" | "moons" | "small" | "all";

export interface Place { lat: number; lon: number }

/**
 * Which latitude and longitude a world's origin sits at: somewhere people live, chosen from the seed — or wherever
 * the world has been moved to (/sky chase takes it under an eclipse's path).
 */
export function worldAnchor(seed: number, place?: Place | null): Place {
  if (place) return place;
  const a = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1, b = Math.abs(Math.sin(seed * 78.233) * 12543.123) % 1;
  return { lat: -40 + a * 95, lon: -180 + b * 360 };
}

/** A block position in the world as a place on Earth. */
export function blockToLatLon(seed: number, x: number, z: number, place?: Place | null): Place {
  const o = worldAnchor(seed, place);
  const lat = Math.max(-89, Math.min(89, o.lat - z / M_PER_DEG_LAT));
  const lon = ((o.lon + x / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180)) + 540) % 360) - 180;
  return { lat, lon };
}

/** A place on Earth as a block position in the world — kept inside the world's border. */
export function latLonToBlock(seed: number, lat: number, lon: number, place?: Place | null): { x: number; z: number } {
  const o = worldAnchor(seed, place);
  const dLon = ((lon - o.lon + 540) % 360) - 180;
  const x = dLon * M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
  const z = (o.lat - lat) * M_PER_DEG_LAT;
  const clamp = (v: number) => Math.max(-WORLD_REACH, Math.min(WORLD_REACH, v));
  return { x: clamp(x), z: clamp(z) };
}

/** Where the world's origin must be for the block (x, z) to stand at a latitude and longitude. */
export function placeFor(x: number, z: number, lat: number, lon: number): Place {
  const originLat = Math.max(-89, Math.min(89, lat + z / M_PER_DEG_LAT));
  return { lat: originLat, lon: ((lon - x / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180)) + 540) % 360) - 180 };
}

/** How far each body's neighbourhood reaches (km): its sphere of influence, or a patch of space around a small one. */
function reachesOf(sys: StarSystem): { id: string; reach: number }[] {
  const out: { id: string; reach: number }[] = [];
  for (const b of sys.bodies) {
    if (b.kind === "star") continue;
    const parent = b.parent ? sys.body(b.parent) : null;
    let reach: number;
    if (b.gm && parent?.gm) {
      const o = b.orbit;
      const a = o.kind === "planet" ? planetConic(o.index, 2451545).q / (1 - planetConic(o.index, 2451545).e) * AU
        : o.kind === "equatorial" || o.kind === "kepler" ? o.a : o.kind === "moon" ? 384_400 : o.kind === "conic" ? (o.conic.q / (1 - Math.min(0.99, o.conic.e))) * AU : b.radius * 100;
      reach = a * Math.pow(b.gm / parent.gm, 0.4);
    } else if (b.kind === "comet" || b.kind === "interstellar") reach = 200_000;
    else reach = Math.max(b.radius * 100, 3000);
    out.push({ id: b.id, reach: Math.max(reach, b.radius * 3) });
  }
  return out.sort((a, b) => a.reach - b.reach);
}

/** Seconds the jump drive spools before it can open a way through. */
export const JUMP_SPOOL = 5;
/** Seconds in hyperspace: a few, a little more the farther the jump. */
export const jumpTunnel = (ly: number): number => 3 + Math.log10(1 + ly) * 1.2;

export interface Jump {
  target: Star;
  system: StarSystem;
  /** Light-years it spans. */
  ly: number;
  phase: "spool" | "tunnel";
  /** Seconds into the phase. */
  t: number;
}

export class SpaceSession {
  jd: number;
  /** The star system the ship is in: the Solar System until it jumps. */
  system: StarSystem = SOLAR_SYSTEM;
  /** A jump under way, if one is. */
  jump: Jump | null = null;
  timeScale = 1;
  ship: Ship;
  camera: SpaceCameraState;
  selected: string | null = null;
  hovered: string | null = null;
  tab: OverviewTab = "planets";
  orbits = new Set<string>(["planet", "dwarf"]);
  positions = new Map<string, Vec3>();
  shipHelio: Vec3 = [0, 0, 0];
  /** The last thing worth saying (a warp engaged, an order refused), and when. */
  note: { text: string; at: number } | null = null;
  /** Counting down to landing, seconds; null when not landing (the arcade model's landing). */
  landing: number | null = null;
  /** The clock speed an autopilot has chosen for a long coast in a manoeuvre, overriding the pilot's while it lasts. */
  autoScale: number | null = null;
  /** The galaxy map, while it is open (the ship flies on beneath it). */
  galaxy: GalaxyMap | null = null;
  private chart: GalaxyMap | null = null;
  /** The clock speed actually used last frame, and why it was held back if it was. */
  shownScale = 1;
  held: string | null = null;
  private places = reachesOf(SOLAR_SYSTEM);
  private clock = 0;
  private velCache = new Map<string, { jd: number; v: Vec3 }>();

  constructor(readonly seed: number, launch: { lat: number; lon: number }, jd = jdFromMs(Date.now()), readonly place: Place | null = null, physics: Ship["physics"] = "newton") {
    this.jd = jd;
    // The Earth turns about its axis of date, not J2000's: apparent sidereal time on the true equator of date,
    // carried back to J2000 — otherwise the launch site sits 0.34° (38 km) off against the Sun and Moon in 2026.
    const up = aboveEarth(launch.lat, launch.lon, 400, gast(jd), (v) => eqToEcl(fromDate(v, jd)));
    this.ship = newShip(SCOUT, "earth", up.pos, up.heading, physics);
    // Under real physics a launch ends in a real orbit: 7.7 km/s eastward, the way rockets fly to use the Earth's spin.
    if (physics === "newton") this.ship.vel = scale(norm(up.heading), Math.sqrt((this.body("earth")?.gm ?? 398600.435) / len(up.pos)));
    // Behind and a little above the ship, looking along its path with the Earth's curve below.
    const back = sub([0, 0, 0], up.heading), radial = norm(up.pos);
    const off = norm([back[0] + radial[0] * 0.35, back[1] + radial[1] * 0.35, back[2] + radial[2] * 0.35]);
    this.camera = { target: "ship", yaw: Math.atan2(off[1], off[0]), pitch: Math.asin(off[2]), dist: 0.16 };
    this.refresh();
  }

  /** A body of the system the ship is in. */
  body(id: string): BodyDef | undefined {
    return this.system.body(id);
  }

  get surroundings(): Surroundings {
    const sys = this.system;
    return {
      pos: (id) => this.positions.get(id) ?? null, radius: (id) => sys.body(id)?.radius ?? 1, places: this.places,
      gm: (id) => gmOf(sys.body(id)),
      vel: (id) => this.velocity(id),
      parent: (id) => sys.body(id)?.parent ?? null,
      pole: (id) => poleOf(sys.body(id)),
      spin: (id) => {
        const b = sys.body(id);
        if (!b?.rotation || b.locked) return [0, 0, 0];
        return scale(poleOf(b), (2 * Math.PI) / (b.rotation * 3600));
      },
      air: (id) => sys.air(id),
      // Only the Earth has a world to come down into, so far.
      lands: (id) => sys.solar && id === "earth",
    };
  }

  /** A body's velocity from the Sun (km/s), worked out once per moment it is asked for. */
  private velocity(id: string): Vec3 {
    const c = this.velCache.get(id);
    if (c && c.jd === this.jd) return c.v;
    const v = this.system.velocity(id, this.jd);
    this.velCache.set(id, { jd: this.jd, v });
    return v;
  }

  private refresh(): void {
    this.positions = this.system.positions(this.jd);
    this.shipHelio = shipPosition(this.ship, this.surroundings);
  }

  /** One frame: the clock, then the ship in steps small enough for its orders to stay smooth. */
  update(dt: number): void {
    if (this.jump) { this.updateJump(dt); return; }
    if (this.ship.physics === "newton") { this.updateNewton(dt); return; }
    this.clock += dt;
    this.jd += (dt * this.timeScale) / 86400;
    this.refresh();
    const w = this.surroundings;
    const n = Math.max(1, Math.ceil(dt / (1 / 30)));
    for (let i = 0; i < n; i++) {
      const e = step(this.ship, w, dt / n);
      if (e === "warp") this.say(`Warp drive active — ${this.body(this.ship.warp!.target)?.name}`);
      if (e === "arrived") this.say(`Arrived: ${this.body(this.ship.frame)?.name ?? "deep space"}`);
    }
    this.shipHelio = shipPosition(this.ship, w);
    if (this.landing !== null) this.landing = Math.max(0, this.landing - dt);
  }

  /**
   * One frame under real physics. Warp runs on the frame's own time (it is
   * the ship's drive, not the Solar System's clock). Otherwise the ship lives
   * on the Solar System's time: coasting, in steps as long as keeps it from
   * skipping over a sphere of influence it should have entered; burning or in
   * the air, in quarter-second steps with the clock held to fifty times.
   */
  private updateNewton(dt: number): void {
    this.clock += dt;
    const s = this.ship;
    if (s.landed) return;
    if (s.warp) {
      this.jd += (dt * this.timeScale) / 86400;
      this.refresh();
      this.report(newtonWarp(s, this.surroundings, dt));
      this.shipHelio = shipPosition(s, this.surroundings);
      this.shownScale = this.timeScale;
      this.held = null;
      return;
    }
    this.autopilotClock();
    const wanted = this.autoScale ?? this.timeScale;
    let w = this.surroundings;
    const small = needsSmallSteps(s, w);
    const scaleNow = small ? Math.min(wanted, PHYSICS_WARP) : wanted;
    let sky = dt * scaleNow;
    const maxStep = small ? 0.25 : this.coastStep();
    let n = Math.max(1, Math.ceil(sky / maxStep));
    if (n > MAX_STEPS) { n = MAX_STEPS; sky = maxStep * n; }
    this.shownScale = sky / Math.max(dt, 1e-9);
    this.held = scaleNow < wanted ? (airAround(s, w) ? "in the air" : "while the engine burns")
      : this.shownScale < scaleNow * 0.95 ? `near ${this.body(this.nearestBoundary())?.name ?? "a moon"}` : null;
    for (let i = 0; i < n && !s.landed && !s.warp; i++) {
      this.jd += sky / n / 86400;
      this.refresh();
      w = this.surroundings;
      this.report(newtonStep(s, w, sky / n));
    }
    this.shipHelio = shipPosition(s, this.surroundings);
  }

  /** How long a coast can be stepped without skipping into a sphere of influence (or out of this one) unseen. */
  private coastStep(): number {
    const s = this.ship, w = this.surroundings;
    const speed = len(s.vel) + 1e-6;
    let step = Infinity;
    const mine = this.places.find((p) => p.id === s.frame);
    if (mine && s.frame !== "sun") step = Math.min(step, (0.4 * Math.max(0, mine.reach - len(s.pos))) / speed);
    const here = this.shipHelio;
    const mu = gmOf(this.body(s.frame));
    for (const p of this.places) {
      if ((this.body(p.id)?.parent ?? "sun") !== s.frame) continue;
      const q = this.positions.get(p.id);
      if (!q) continue;
      const gap = len(sub(here, q)) - p.reach;
      // How fast they could be closing: the ship's speed and the body's own round the frame.
      const theirs = mu > 0 ? Math.sqrt(mu / Math.max(1, len(sub(q, this.positions.get(s.frame) ?? [0, 0, 0])))) : 0;
      step = Math.min(step, (0.4 * Math.max(0, gap)) / (speed + theirs));
    }
    return Math.max(1, step);
  }

  private nearestBoundary(): string {
    let best = this.ship.frame, bestGap = Infinity;
    for (const p of this.places) {
      if ((this.body(p.id)?.parent ?? "sun") !== this.ship.frame) continue;
      const q = this.positions.get(p.id);
      if (!q) continue;
      const gap = len(sub(this.shipHelio, q)) - p.reach;
      if (gap < bestGap) { bestGap = gap; best = p.id; }
    }
    return best;
  }

  /**
   * The long waits in a manoeuvre — half an orbit to the far side, the fall
   * to the top of the air — the autopilot runs the clock through, so a landing
   * from orbit takes a minute rather than an hour; the air and the burns set
   * their own pace (held to fifty times).
   */
  private autopilotClock(): void {
    const s = this.ship, o = s.order, w = this.surroundings;
    const mu = gmOf(this.body(s.frame));
    // Fast enough to get there in `lead` seconds of play, but never slower than `floor`: aiming at a fixed time to
    // go would slow the clock without end as the moment came nearer.
    const pick = (seconds: number | null, lead: number, floor: number) => {
      if (seconds === null || !(seconds > 0)) return floor;
      const k = seconds / lead;
      return Math.max(floor, Math.min(100_000, [...TIME_SCALES].reverse().find((t) => t <= k) ?? 1));
    };
    if (o.kind === "land" && o.phase === "entry") {
      if (airAround(s, w)) { this.autoScale = s.chute > 0 ? PHYSICS_WARP : 20; return; }
      const top = airOf(w, s.frame)?.top ?? 0;
      this.autoScale = pick(timeToRadius(s.pos, s.vel, mu, w.radius(s.frame) + top), 10, PHYSICS_WARP);
      return;
    }
    if (o.kind === "orbit" && o.phase === "coast" && mu > 0) {
      const el = elementsOf(s.pos, s.vel, mu);
      const R = w.radius(s.frame) + Math.max(o.range, safeAltitude(w, s.frame));
      this.autoScale = pick(timeToAnomaly(el, mu, R > el.periapsis * 1.001 ? Math.PI : 0), 8, 10);
      return;
    }
    this.autoScale = null;
  }

  /** Says what the physics did worth saying. */
  private report(e: FlightEvent | null): void {
    if (!e) return;
    const s = this.ship, name = this.body(s.frame)?.name ?? "deep space";
    switch (e) {
      case "warp": this.say(`Warp drive active — ${this.body(s.warp?.target ?? "")?.name ?? ""}`); break;
      case "arrived": {
        const o = orbitSummary(s, this.surroundings);
        this.say(o && s.order.kind === "coast" ? `Arrived: in orbit round ${name}, ${Math.round(o.altitude).toLocaleString("en")} km up at ${o.speed.toFixed(2)} km/s` : `Arrived: ${name}`);
        break;
      }
      case "orbit": {
        const o = orbitSummary(s, this.surroundings);
        if (o) this.say(`In orbit round ${name}: ${Math.round(o.periapsis).toLocaleString("en")} × ${Math.round(o.apoapsis).toLocaleString("en")} km, once every ${periodText(o.period)}`);
        break;
      }
      case "entry":
        this.say(`Entering ${name}'s atmosphere — the heat shield takes it from here`);
        // Come in close for the fire.
        if (this.camera.target === "ship") this.camera.dist = Math.min(this.camera.dist, 0.25);
        break;
      case "chute": this.say("Parachute out"); break;
      case "landed": this.say("Touchdown"); break;
      case "pullup": this.say(`Too low over ${name}: the flight computer pulled up and is setting up an orbit`); break;
      case "soi": this.say(s.frame === "sun" ? `Out of the planets' pull: in orbit round ${this.system.solar ? "the Sun" : this.system.star.name}` : `Into ${name}'s sphere of influence`); break;
    }
  }

  /** The ship's speed through the air round it, if it is in some (the air turns with the planet), km/s. */
  airSpeed(): number | null {
    if (this.ship.physics !== "newton") return null;
    const a = airAround(this.ship, this.surroundings);
    return a ? len(a.vAir) : null;
  }

  /** The orbit the ship is on, for the panel. */
  orbitInfo(): ReturnType<typeof orbitSummary> {
    return this.ship.physics === "newton" && !this.ship.warp ? orbitSummary(this.ship, this.surroundings) : null;
  }

  /** The path ahead, for the overlay: points round the body the ship is near, where it is highest and lowest, and whether it comes down. */
  pathAhead(): SpaceFrame["path"] {
    const s = this.ship;
    if (s.physics !== "newton" || s.warp || s.landed) return undefined;
    const mu = gmOf(this.body(s.frame));
    if (!(mu > 0)) return undefined;
    const reach = this.places.find((p) => p.id === s.frame)?.reach ?? 50 * AU;
    const R = this.body(s.frame)?.radius ?? 0;
    const air = this.system.air(s.frame);
    const floor = R + (air?.top ?? 0);
    const p = pathAhead(s.pos, s.vel, mu, 160, reach, floor);
    const el = elementsOf(s.pos, s.vel, mu);
    const pe = el.periapsis > R ? pointAt(el, 0) : null;
    const ap = el.e < 1 && el.apoapsis < reach ? pointAt(el, Math.PI) : null;
    return { frame: s.frame, points: p.points, hits: p.hits, leaves: p.leaves, pe, ap, peAlt: el.periapsis - R, apAlt: el.apoapsis - R, air: !!air };
  }

  frame(dt: number): SpaceFrame {
    const listed = new Set(this.rows().map((r) => r.id));
    return {
      jd: this.jd, dt, positions: this.positions, ship: this.ship, shipHelio: this.shipHelio, camera: this.camera,
      selected: this.selected, hovered: this.hovered, orbits: this.orbits, listed, path: this.pathAhead(), system: this.system,
      jump: this.jump ? { phase: this.jump.phase, t: this.jump.t, total: this.jump.phase === "spool" ? JUMP_SPOOL : jumpTunnel(this.jump.ly), target: this.jump.target.name } : undefined,
    };
  }

  /** Opens the galaxy map (the same one as last time, so its stars need not be charted again), or closes it. */
  toggleGalaxy(): void {
    if (this.galaxy) { this.galaxy = null; return; }
    this.chart ??= new GalaxyMap();
    // Opened somewhere new, the map starts where the ship is.
    if (this.chart.here.id !== this.system.star.id) {
      this.chart.here = this.system.star;
      this.chart.goTo(this.system.star.pos, 40);
      this.chart.select(this.system.star);
    }
    this.galaxy = this.chart;
  }

  /** Real physics or the arcade's, switched in flight: the ship keeps where it is; going to real, it keeps its speed too. */
  setPhysics(p: Ship["physics"]): void {
    const s = this.ship;
    if (s.physics === p || s.warp) return;
    s.physics = p;
    if (p === "newton") {
      // From the arcade's standstill, into an orbit where there is gravity to hold one.
      const mu = gmOf(this.body(s.frame));
      if (mu > 0 && len(s.vel) < 0.5 && Math.sqrt(mu / len(s.pos)) > 0.5) s.vel = circularVelocity(s.pos, s.vel, mu, poleOf(this.body(s.frame)));
      s.order = { kind: "coast" };
      this.say("Real physics: gravity and a 5 g engine");
    } else {
      s.vel = [0, 0, 0];
      s.order = { kind: "stop" };
      this.autoScale = null;
      this.say("Arcade flight: EVE's rules, no gravity");
    }
  }

  say(text: string): void {
    this.note = { text, at: this.clock };
  }

  noteText(): string | null {
    return this.note && this.clock - this.note.at < 5 ? this.note.text : null;
  }

  // ---- the overview ------------------------------------------------------------------------------------------------

  private inTab(b: BodyDef): boolean {
    switch (this.tab) {
      case "planets": return b.kind === "star" || b.kind === "planet" || b.kind === "dwarf";
      case "moons": {
        // The moons of wherever the ship is, or of the planet it is nearest.
        const home = this.homePlanet();
        return b.kind === "moon" && b.parent === home;
      }
      case "small": return b.kind === "asteroid" || b.kind === "comet" || b.kind === "interstellar" || b.kind === "probe";
      case "all": return true;
    }
  }

  /** The planet (or dwarf planet) the ship is at or nearest to. */
  homePlanet(): string {
    let id = this.ship.frame;
    while (id && this.body(id)?.kind === "moon") id = this.body(id)!.parent!;
    const here = this.body(id);
    if (here && (here.kind === "planet" || here.kind === "dwarf")) return id;
    let best = this.system.solar ? "earth" : "", bestD = Infinity;
    for (const b of this.system.bodies) {
      if (b.kind !== "planet") continue;
      const p = this.positions.get(b.id);
      if (p) { const d = len(sub(p, this.shipHelio)); if (d < bestD) { bestD = d; best = b.id; } }
    }
    return best;
  }

  rows(): OverviewRow[] {
    const out: OverviewRow[] = [];
    for (const b of this.system.bodies) {
      const p = this.positions.get(b.id);
      if (!p || !this.inTab(b)) continue;
      out.push({ id: b.id, name: b.name, kind: b.kind, type: this.system.kindLabel(b), distance: Math.max(0, len(sub(p, this.shipHelio)) - b.radius) });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  distanceTo(id: string): number {
    const p = this.positions.get(id);
    return p ? Math.max(0, len(sub(p, this.shipHelio)) - (this.body(id)?.radius ?? 0)) : Infinity;
  }

  // ---- orders ----------------------------------------------------------------------------------------------------------

  select(id: string | null): void {
    this.selected = id && this.body(id) ? id : null;
  }

  give(o: Order): boolean {
    if (this.landing !== null || this.ship.landed) return false;
    if (this.jump) { this.say("The jump drive has the ship: orders wait until it arrives."); return false; }
    if (this.ship.physics === "newton" && o.kind === "land" && !this.surroundings.lands!(this.ship.frame)) { this.say(this.system.solar ? "Only the Earth has a world to land in: warp to it, then land." : "Jump home to the Solar System to land: only the Earth has a world to land in yet."); return false; }
    if (this.ship.warp) { this.say("The ship is in warp: orders wait until it drops out."); return false; }
    if (o.kind === "warp") {
      const why = warpRefusal(this.ship, this.surroundings, o.target, o.range);
      if (why) { this.say(why); return false; }
      const d = this.distanceTo(o.target);
      this.say(`Aligning to ${this.body(o.target)?.name} — warp in about ${Math.round(warpTime(this.ship.cls, d) + this.ship.cls.tau * 1.4)} s`);
    }
    order(this.ship, o);
    return true;
  }

  warpTo(id: string, range: number): boolean {
    return this.give({ kind: "warp", target: id, range });
  }

  /** Whether the target is far enough away to warp to. */
  canWarp(id: string): boolean {
    const p = this.positions.get(id);
    if (!p) return false;
    return len(sub(p, this.shipHelio)) - warpInDistance(this.body(id)?.radius ?? 0, 0) > MIN_WARP;
  }

  setTimeScale(k: number): void {
    this.timeScale = Math.max(1, Math.min(TIME_SCALES[TIME_SCALES.length - 1], k));
  }

  faster(): void {
    const i = TIME_SCALES.findIndex((k) => k > this.timeScale);
    this.setTimeScale(i < 0 ? this.timeScale : TIME_SCALES[i]);
  }

  slower(): void {
    const lower = TIME_SCALES.filter((k) => k < this.timeScale);
    this.setTimeScale(lower.length ? lower[lower.length - 1] : 1);
  }

  /** Back to the real date and time, at real speed. */
  now(): void {
    this.jd = jdFromMs(Date.now());
    this.timeScale = 1;
  }

  /** The camera circles the ship, or looks at a body from a sensible distance. */
  lookAt(id: string | null): void {
    // Back on the ship: close enough to see it (it is 42 metres long), however far out the camera had gone.
    if (!id || id === "ship") { this.camera = { ...this.camera, target: "ship", dist: Math.min(this.camera.dist, 0.3) }; return; }
    const b = this.body(id);
    if (!b) return;
    const extent = b.rings ? b.rings.outer : b.radius;
    this.camera = { ...this.camera, target: id, dist: Math.max(extent * 3.2, 1) };
  }

  zoom(factor: number): void {
    const min = this.camera.target === "ship" ? 0.06 : (this.body(this.camera.target)?.radius ?? 1) * 1.05;
    this.camera.dist = Math.max(min, Math.min(80 * AU, this.camera.dist * factor));
  }

  turn(dyaw: number, dpitch: number): void {
    this.camera.yaw += dyaw;
    this.camera.pitch = Math.max(-1.52, Math.min(1.52, this.camera.pitch + dpitch));
  }

  // ---- the jump drive ---------------------------------------------------------------------------------------------------

  /**
   * Starts a jump to another star (the galaxy map's "Jump"): the drive spools
   * up, opens a way through hyperspace, and the ship comes out in orbit round
   * the new star, outside its outermost planet — or, coming home, a short warp
   * from the Earth.
   */
  startJump(star: Star): boolean {
    const s = this.ship;
    if (this.jump) { this.say("The jump drive is already running."); return false; }
    if (s.landed || this.landing !== null) return false;
    if (s.warp) { this.say("Drop out of warp first: the jump drive and the warp drive cannot run together."); return false; }
    if (s.physics === "newton" && airAround(s, this.surroundings)) { this.say("Climb out of the air first: the jump drive needs open space."); return false; }
    if (star.id === this.system.id) { this.say(`The ship is already at ${star.name}.`); return false; }
    const ly = distance(this.system.star.pos, star.pos) * LY_PER_PC;
    this.jump = { target: star, system: systemFor(star), ly, phase: "spool", t: 0 };
    this.galaxy = null;
    s.order = s.physics === "newton" ? { kind: "coast" } : { kind: "stop" };
    this.autoScale = null;
    this.say(`Jump drive spooling up — ${star.name}, ${ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString("en")} light-years away`);
    return true;
  }

  /** The jump under way: the spool, then hyperspace, then out at the other end. The Solar System's clock runs on regardless. */
  private updateJump(dt: number): void {
    const j = this.jump!;
    this.clock += dt;
    this.jd += dt / 86400;
    j.t += dt;
    if (j.phase === "spool") {
      if (j.t >= JUMP_SPOOL) { j.phase = "tunnel"; j.t = 0; this.say(`In hyperspace — ${j.target.name}`); }
      this.refresh();
      return;
    }
    if (j.t < jumpTunnel(j.ly)) return;
    this.arrive(j.system);
  }

  /** Out of hyperspace into a system: somewhere sensible to start from, in a real orbit round its star. */
  private arrive(sys: StarSystem): void {
    const s = this.ship;
    this.jump = null;
    this.system = sys;
    this.places = reachesOf(sys);
    this.velCache.clear();
    this.selected = null;
    this.hovered = null;
    this.refresh();
    const star = sys.body("sun")!;
    let pos: Vec3;
    if (sys.solar) {
      // Home: a short warp sunward of the Earth, where the trip began.
      const e = this.positions.get("earth") ?? [AU, 0, 0];
      pos = scale(e, 1 - 0.02);
    } else {
      // Outside the outermost planet, a little above the plane of their orbits: the whole system in view.
      let out = 0;
      for (const b of sys.bodies) if (b.kind === "planet" && b.orbit.kind === "kepler") out = Math.max(out, b.orbit.a * (1 + b.orbit.e));
      const r = Math.max(out * 1.25, star.radius * 20, 0.05 * AU, Math.sqrt(Math.max(0, sys.star.lum)) * 0.5 * AU);
      const a = (sys.id.length * 2.399963) % (2 * Math.PI);
      pos = [r * Math.cos(a), r * Math.sin(a), r * 0.06];
    }
    s.frame = "sun";
    s.pos = pos;
    s.warp = null;
    s.spool = 0;
    s.heat = 0;
    s.chute = 0;
    const mu = gmOf(star);
    s.vel = s.physics === "newton" && mu > 0 ? circularVelocity(pos, [0, 0, 0], mu, [0, 0, 1]) : [0, 0, 0];
    s.order = s.physics === "newton" ? { kind: "coast" } : { kind: "stop" };
    this.shipHelio = shipPosition(s, this.surroundings);
    this.camera = { ...this.camera, target: "ship", dist: Math.min(this.camera.dist, 0.3) };
    const planets = sys.bodies.filter((b) => b.kind === "planet").length;
    this.say(sys.solar ? "Home: the Solar System. The Earth is a short warp away." : `Arrived at ${sys.star.name}: ${planets ? `${planets} planet${planets === 1 ? "" : "s"}` : "no planets"} — pick one in the overview and warp to it`);
  }

  /** Whether the ship is at home, in the Solar System. */
  get home(): boolean {
    return this.system.solar;
  }

  // ---- landing ---------------------------------------------------------------------------------------------------------

  /** Where below the ship, if it is low enough over the Earth to come down (under real physics, anywhere near it: the landing flies itself down). */
  landingSite(): { lat: number; lon: number; altitude: number } | null {
    if (!this.system.solar || this.ship.frame !== "earth" || this.ship.warp) return null;
    const under = belowShip(this.ship.pos, gast(this.jd), (v) => toDate(eclToEq(v), this.jd));
    return under.altitude < 2000 || (this.ship.physics === "newton" && !this.ship.landed) ? under : null;
  }

  /** Where in the world the landing site is. */
  landingBlock(): { x: number; z: number; lat: number; lon: number } | null {
    const s = this.landingSite();
    if (!s) return null;
    return { ...latLonToBlock(this.seed, s.lat, s.lon, this.place), lat: s.lat, lon: s.lon };
  }

  /** Local solar time at a longitude, in hours: for setting the day to match where the ship came down. */
  solarHours(lon: number): number {
    const utc = ((this.jd + 0.5) % 1) * 24;
    return (((utc + lon / 15) % 24) + 24) % 24;
  }
}

/** "92 minutes", "27.3 days": how long an orbit takes. */
export function periodText(seconds: number): string {
  if (!Number.isFinite(seconds)) return "never (an escape)";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)} hours`;
  if (seconds < 3 * 365.25 * 86400) return `${(seconds / 86400).toFixed(1)} days`;
  return `${(seconds / (365.25 * 86400)).toFixed(1)} years`;
}
