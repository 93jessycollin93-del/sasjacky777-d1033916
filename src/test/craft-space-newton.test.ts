import { describe, expect, it } from "vitest";
import { add, AU, cross, len, scale, sub, type Vec3 } from "@/craft/space/kepler";
import { newShip, order, SCOUT, type Ship, type Surroundings } from "@/craft/space/flight";
import { circularSpeed, elementsOf, hohmann, propagate } from "@/craft/space/orbit";
import {
  AIR, circularVelocity, floorOf, needsSmallSteps, newtonStep, orbitSummary, settleAfterWarp, type FlightEvent,
} from "@/craft/space/newton";

const MU_E = 398600.435, R_E = 6378.137, MU_M = 4902.8, R_M = 1737.4;
const EARTH: Vec3 = [AU, 0, 0], MOON: Vec3 = [AU + 384_400, 0, 0];
const V_EARTH: Vec3 = [0, 29.78, 0], V_MOON: Vec3 = [0, 29.78 + 1.022, 0];

/** The Earth and the Moon, standing still where they are for the length of a test, with their gravity, speeds and spin. */
function earthMoon(): Surroundings {
  const pos: Record<string, Vec3> = { sun: [0, 0, 0], earth: EARTH, moon: MOON };
  const vel: Record<string, Vec3> = { sun: [0, 0, 0], earth: V_EARTH, moon: V_MOON };
  const gm: Record<string, number> = { sun: 1.32712440018e11, earth: MU_E, moon: MU_M };
  const radius: Record<string, number> = { sun: 695_700, earth: R_E, moon: R_M };
  const parent: Record<string, string | null> = { sun: null, earth: "sun", moon: "earth" };
  return {
    pos: (id) => pos[id] ?? null, radius: (id) => radius[id] ?? 1,
    places: [{ id: "moon", reach: 66_100 }, { id: "earth", reach: 924_000 }],
    gm: (id) => gm[id] ?? 0, vel: (id) => vel[id] ?? [0, 0, 0], parent: (id) => parent[id] ?? null,
    pole: () => [0, 0, 1], spin: (id) => (id === "earth" ? [0, 0, 7.2921159e-5] : [0, 0, 0]),
  };
}

/** A ship in a circular orbit `alt` km over the Earth's equator, going east. */
function inOrbit(alt: number): Ship {
  const r: Vec3 = [R_E + alt, 0, 0];
  const s = newShip(SCOUT, "earth", r, [0, 1, 0], "newton");
  s.vel = [0, circularSpeed(MU_E, R_E + alt), 0];
  return s;
}

/** Flies for a while, in small steps when the engine or the air needs them and big ones when coasting. */
function fly(s: Ship, w: Surroundings, seconds: number, until?: (e: FlightEvent) => boolean): FlightEvent[] {
  const events: FlightEvent[] = [];
  for (let t = 0; t < seconds;) {
    const dt = Math.min(needsSmallSteps(s, w) ? 0.25 : 20, seconds - t);
    const e = newtonStep(s, w, dt);
    t += dt;
    if (e) { events.push(e); if (until?.(e)) break; }
  }
  return events;
}

describe("falling round the Earth", () => {
  it("goes round once every 92½ minutes with the engine off, in big steps or small, to the metre", () => {
    const w = earthMoon();
    const a = inOrbit(400), b = inOrbit(400);
    const period = elementsOf(a.pos, a.vel, MU_E).period;
    newtonStep(a, w, period);
    for (let i = 0; i < 200; i++) newtonStep(b, w, period / 200);
    expect(len(sub(a.pos, [R_E + 400, 0, 0]))).toBeLessThan(1e-3);
    expect(len(sub(b.pos, a.pos))).toBeLessThan(1e-3);
    expect(a.dv).toBe(0);
  });

  it("raises the far side of its orbit burning prograde, and counts what the burn cost", () => {
    const w = earthMoon(), s = inOrbit(400);
    order(s, { kind: "burn", dir: "prograde" });
    for (let i = 0; i < 40; i++) newtonStep(s, w, 0.25);
    expect(s.dv).toBeCloseTo(0.5, 3);
    const o = orbitSummary(s, w)!;
    expect(o.apoapsis).toBeGreaterThan(1500);
    expect(o.periapsis).toBeCloseTo(400, -1);
  });

  it("rounds off an eccentric orbit when told to circularize", () => {
    const w = earthMoon(), s = inOrbit(400);
    s.vel = scale(s.vel, 1.08);
    newtonStep(s, w, 1800);
    order(s, { kind: "circularize" });
    const events = fly(s, w, 600, (e) => e === "orbit");
    expect(events).toContain("orbit");
    expect(elementsOf(s.pos, s.vel, MU_E).e).toBeLessThan(0.001);
    expect(s.order.kind).toBe("coast");
  });

  it("changes height the way spacecraft do: a Hohmann transfer to 1,000 km for about what the formula says", () => {
    const w = earthMoon(), s = inOrbit(400);
    order(s, { kind: "orbit", target: "earth", range: 1000 });
    const events = fly(s, w, 6 * 3600, (e) => e === "orbit");
    expect(events).toContain("orbit");
    const el = elementsOf(s.pos, s.vel, MU_E);
    expect(Math.abs(el.a - (R_E + 1000)) / (R_E + 1000)).toBeLessThan(0.01);
    expect(el.e).toBeLessThan(0.006);
    const ideal = hohmann(MU_E, R_E + 400, R_E + 1000);
    expect(s.dv).toBeGreaterThan(ideal.dv1 + ideal.dv2);
    expect(s.dv).toBeLessThan((ideal.dv1 + ideal.dv2) * 1.3);
  });

  it("holds station 400 km up only by burning against gravity the whole time", () => {
    const w = earthMoon(), s = inOrbit(400);
    s.vel = [0, 0, 0];
    order(s, { kind: "stop" });
    fly(s, w, 60);
    expect(len(sub(s.pos, [R_E + 400, 0, 0]))).toBeLessThan(0.1);
    // g at 400 km is 8.7 m/s²: a minute of hovering costs half a kilometre a second.
    expect(s.dv).toBeCloseTo(0.52, 1);
  });
});

describe("coming home", () => {
  it("lands from orbit: a short burn, the fall into the air, the heat, the parachute and the ground", () => {
    const w = earthMoon(), s = inOrbit(400);
    order(s, { kind: "land" });
    let peak = 0, prev = s.vel, prevDt = 0, t = 0;
    const events: FlightEvent[] = [];
    while (t < 4 * 3600 && !s.landed) {
      const dt = needsSmallSteps(s, w) ? 0.25 : 20;
      const e = newtonStep(s, w, dt);
      if (e) events.push(e);
      // What the crew feels — the change in velocity less what gravity alone would have done — between two small
      // steps in the air, and not the stop at touchdown.
      if (dt === 0.25 && prevDt === 0.25 && !s.landed) {
        const d = len(s.pos), g = scale(s.pos, -MU_E / (d * d * d));
        peak = Math.max(peak, len(sub(scale(sub(s.vel, prev), 1 / dt), g)));
      }
      prev = s.vel; prevDt = dt;
      t += dt;
    }
    // From 400 km: half an orbit's coast, then some minutes in the air and under the canopy.
    expect(t / 60).toBeGreaterThan(40);
    expect(t / 60).toBeLessThan(120);
    expect(events).toEqual(expect.arrayContaining(["entry", "chute", "landed"]));
    expect(s.landed).toBe(true);
    // A deorbit burn of a hundred-odd metres a second, not a brute stop.
    expect(s.dv).toBeLessThan(0.2);
    // A ballistic entry peaks at several g, as a Soyuz capsule's does when it cannot fly a lifting one.
    expect(peak * 1000 / 9.81).toBeLessThan(9);
    expect(peak * 1000 / 9.81).toBeGreaterThan(3);
  });

  it("thickens the air exponentially: a thousand times thinner at 50 km than on the ground", () => {
    const H = AIR.earth.H;
    expect(Math.exp(-50 / H)).toBeLessThan(1e-3);
    expect(Math.exp(-50 / H)).toBeGreaterThan(1e-4);
  });
});

describe("the flight computer", () => {
  it("pulls up rather than fly into the Moon, and sets up an orbit instead", () => {
    const w = earthMoon();
    const s = newShip(SCOUT, "moon", [R_M + 50, 0, 0], [-1, 0, 0], "newton");
    s.vel = [-1, 0.1, 0];
    const events = fly(s, w, 120, (e) => e === "pullup");
    expect(events).toContain("pullup");
    expect(len(s.pos) - R_M).toBeGreaterThanOrEqual(floorOf(w, "moon") - 1e-6);
    expect(s.order.kind).toBe("orbit");
  });

  it("carries its velocity across into the Moon's sphere of influence, keeping its speed relative to the Sun", () => {
    const w = earthMoon();
    const s = newShip(SCOUT, "earth", [384_400 - 66_100 - 5, 0, 0], [1, 0, 0], "newton");
    s.vel = [1.2, 0.3, 0];
    const before = add(V_EARTH, s.vel);
    const e = newtonStep(s, w, 10);
    expect(e).toBe("soi");
    expect(s.frame).toBe("moon");
    const after = add(V_MOON, s.vel);
    // Ten seconds of the Earth's pull changes it by a few centimetres a second, no more.
    expect(len(sub(after, before))).toBeLessThan(0.001);
  });

  it("comes out of warp into a circular orbit where gravity can hold one", () => {
    const w = earthMoon();
    const s = newShip(SCOUT, "moon", [R_M + 110, 0, 0], [0, 1, 0], "newton");
    settleAfterWarp(s, w);
    expect(len(s.vel)).toBeCloseTo(circularSpeed(MU_M, R_M + 110), 6);
    expect(elementsOf(s.pos, s.vel, MU_M).e).toBeLessThan(1e-9);
    expect(s.order.kind).toBe("coast");
  });

  it("orbits eastward from a standstill, the way the planet turns", () => {
    const v = circularVelocity([R_E + 400, 0, 0], [0, 0, 0], MU_E, [0, 0, 1]);
    expect(cross([R_E + 400, 0, 0], v)[2]).toBeGreaterThan(0);
  });

  it("agrees with the exact coast when it has to integrate instead", () => {
    const w = earthMoon(), s = inOrbit(2000);
    const exact = propagate(s.pos, s.vel, MU_E, 600);
    // A zero-length burn forces the small-step path without changing the orbit.
    order(s, { kind: "burn", dir: "prograde" });
    s.cls = { ...s.cls, thrust: 0 };
    for (let i = 0; i < 2400; i++) newtonStep(s, w, 0.25);
    expect(len(sub(s.pos, exact.r))).toBeLessThan(0.01);
  });
});

describe("a trip under real physics", () => {
  const jd0 = 2461311.1;

  it("launches into a real orbit: 7.7 km/s eastward, 400 km up, round in about an hour and a half", () => {
    const { SpaceSession } = requireSession();
    const s = new SpaceSession(1, { lat: 28.5, lon: -80.6 }, jd0);
    const o = s.orbitInfo()!;
    expect(o.speed).toBeCloseTo(7.67, 1);
    expect(o.periapsis).toBeGreaterThan(380);
    expect(o.apoapsis).toBeLessThan(420);
    // Launched due east from Cape Canaveral's latitude, the orbit is tilted to the equator by about that much.
    expect(o.incl).toBeCloseTo(28.5, 0);
    expect(o.period / 60).toBeCloseTo(92.6, 0);
  });

  it("lands itself from orbit in a minute or two of play, running the clock through the long waits", () => {
    const { SpaceSession } = requireSession();
    const s = new SpaceSession(1, { lat: 40, lon: -100 }, jd0);
    expect(s.give({ kind: "land" })).toBe(true);
    let frames = 0;
    while (!s.ship.landed && frames < 60 * 240) { s.update(1 / 60); frames++; }
    expect(s.ship.landed).toBe(true);
    expect(frames / 60).toBeLessThan(180);
    expect(s.landingBlock()).not.toBeNull();
  });

  it("holds the clock to fifty times while the engine burns, and says why", () => {
    const { SpaceSession } = requireSession();
    const s = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    s.setTimeScale(1000);
    s.give({ kind: "burn", dir: "prograde" });
    s.update(1 / 60);
    expect(s.shownScale).toBeLessThanOrEqual(50.001);
    expect(s.held).toBe("while the engine burns");
    s.give({ kind: "coast" });
    s.update(1 / 60);
    expect(s.shownScale).toBeCloseTo(1000, -1);
  });

  it("warps to the Moon and comes out in orbit round it", () => {
    const { SpaceSession } = requireSession();
    const s = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    expect(s.warpTo("moon", 100)).toBe(true);
    let frames = 0;
    while (s.ship.frame !== "moon" || s.ship.warp || s.ship.order.kind === "warp") {
      s.update(1 / 30);
      if (++frames > 30 * 120) break;
    }
    expect(s.ship.frame).toBe("moon");
    const o = s.orbitInfo()!;
    expect(o.e).toBeLessThan(0.01);
    expect(o.altitude).toBeGreaterThan(90);
    expect(o.speed).toBeCloseTo(Math.sqrt(MU_M / (R_M + o.altitude)), 2);
  });

  it("switches to arcade flight and back without losing the ship", () => {
    const { SpaceSession } = requireSession();
    const s = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    s.setPhysics("arcade");
    expect(s.ship.physics).toBe("arcade");
    expect(len(s.ship.vel)).toBe(0);
    s.setPhysics("newton");
    expect(s.orbitInfo()!.e).toBeLessThan(0.001);
  });
});

import * as sessionModule from "@/craft/space/session";
function requireSession() { return sessionModule; }
