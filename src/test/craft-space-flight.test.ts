import { describe, expect, it } from "vitest";
import { add, AU, eclToEq, eqToEcl, len, sub, type Vec3 } from "@/craft/space/kepler";
import {
  aboveEarth, aligned, belowShip, newShip, order, placeOf, SCOUT, shipPosition, step, warpInDistance, warpRefusal, warpTime, type Surroundings,
} from "@/craft/space/flight";

/** A little solar system for the ship to fly in: the Earth at 1 AU, Jupiter at 5.2, maybe moving. */
function system(opts: { jupiterSpeed?: number } = {}): Surroundings & { t: number } {
  const w = {
    t: 0,
    pos(id: string): Vec3 | null {
      if (id === "sun") return [0, 0, 0];
      if (id === "earth") return [AU, 0, 0];
      if (id === "moon") return [AU + 384_400, 0, 0];
      if (id === "jupiter") return [5.2 * AU, (opts.jupiterSpeed ?? 0) * w.t, 0];
      return null;
    },
    radius: (id: string) => ({ sun: 695_700, earth: 6378, moon: 1737, jupiter: 71_492 } as Record<string, number>)[id] ?? 1,
    places: [{ id: "moon", reach: 66_100 }, { id: "earth", reach: 924_000 }, { id: "jupiter", reach: 48_200_000 }],
  };
  return w;
}

function fly(ship: ReturnType<typeof newShip>, w: ReturnType<typeof system>, seconds: number, dt = 1 / 30): string[] {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += dt) {
    w.t += dt;
    const e = step(ship, w, dt);
    if (e) events.push(e);
  }
  return events;
}

describe("flying below warp", () => {
  it("reaches three quarters of its top speed in its align time, τ ln 4", () => {
    const w = system();
    const s = newShip(SCOUT, "earth", [0, 20_000, 0]);
    order(s, { kind: "heading", dir: [0, 1, 0] });
    fly(s, w, SCOUT.tau * Math.log(4) - 0.05);
    expect(len(s.vel) / SCOUT.maxSpeed).toBeLessThan(0.75);
    fly(s, w, 0.2);
    expect(len(s.vel) / SCOUT.maxSpeed).toBeGreaterThan(0.75);
  });

  it("approaches and comes to rest just off the surface, without sailing through it", () => {
    const w = system();
    const s = newShip(SCOUT, "moon", [0, 1737 + 80, 0]);
    order(s, { kind: "approach", target: "moon" });
    fly(s, w, 400);
    const alt = len(s.pos) - 1737;
    expect(alt).toBeGreaterThan(0);
    expect(alt).toBeLessThan(12);
    expect(len(s.vel)).toBeLessThan(0.01);
  });

  it("orbits at the range asked for, at full speed", () => {
    const w = system();
    const s = newShip(SCOUT, "moon", [0, 1737 + 40, 0]);
    order(s, { kind: "orbit", target: "moon", range: 20 });
    fly(s, w, 900);
    const readings: number[] = [];
    for (let i = 0; i < 20; i++) { fly(s, w, 3); readings.push(len(s.pos) - 1737); }
    for (const r of readings) expect(Math.abs(r - 20)).toBeLessThan(2.5);
    expect(len(s.vel)).toBeCloseTo(SCOUT.maxSpeed, 2);
  });

  it("goes five times as fast with the microwarpdrive on", () => {
    const w = system();
    const s = newShip(SCOUT, "earth", [0, 50_000, 0]);
    s.mwd = true;
    order(s, { kind: "heading", dir: [0, 0, 1] });
    fly(s, w, 30);
    expect(len(s.vel)).toBeCloseTo(SCOUT.maxSpeed * 5, 1);
  });
});

describe("warp", () => {
  it("aligns first, then warps out to Jupiter and drops out at a safe altitude, on the near side, stopped", () => {
    const w = system();
    const s = newShip(SCOUT, "earth", [0, 7000, 0], [0, 1, 0]);
    expect(warpRefusal(s, w, "jupiter", 0)).toBeNull();
    order(s, { kind: "warp", target: "jupiter", range: 0 });
    fly(s, w, 1);
    expect(s.warp).toBeNull();
    const events = fly(s, w, 60);
    expect(events).toEqual(["warp", "arrived"]);
    expect(s.frame).toBe("jupiter");
    expect(len(s.pos)).toBeCloseTo(warpInDistance(71_492, 0), -1);
    // On the side it came from: between Jupiter and the Earth, roughly.
    expect(s.pos[0]).toBeLessThan(0);
    expect(len(s.vel)).toBe(0);
  });

  it("takes about as long as EVE's warps do: seconds across the inner system, under a minute to Jupiter", () => {
    expect(warpTime(SCOUT, 384_400)).toBeLessThan(12);
    expect(warpTime(SCOUT, 4.2 * AU)).toBeGreaterThan(10);
    expect(warpTime(SCOUT, 4.2 * AU)).toBeLessThan(20);
  });

  it("still arrives at a target that moves, however fast time is running", () => {
    const w = system({ jupiterSpeed: 13 * 100_000 });
    const s = newShip(SCOUT, "earth", [0, 7000, 0]);
    order(s, { kind: "warp", target: "jupiter", range: 1000 });
    const events = fly(s, w, 90);
    expect(events).toContain("arrived");
    expect(len(s.pos) - 71_492).toBeCloseTo(Math.max(1000, 71_492 * 0.063), -2);
  });

  it("will not warp to something closer than 150 km beyond its warp-in point, and ignores orders once in warp", () => {
    const w = system();
    const near = newShip(SCOUT, "moon", [0, warpInDistance(1737, 0) + 100, 0]);
    expect(warpRefusal(near, w, "moon", 0)).toMatch(/Too close/);
    const s = newShip(SCOUT, "earth", [0, 7000, 0]);
    order(s, { kind: "warp", target: "jupiter", range: 0 });
    fly(s, w, 12);
    expect(s.warp).not.toBeNull();
    order(s, { kind: "stop" });
    expect(s.order.kind).toBe("warp");
  });

  it("counts itself aligned only when pointed within 5° of the target at three quarters of top speed", () => {
    const w = system();
    const s = newShip(SCOUT, "earth", [0, 7000, 0]);
    s.vel = [SCOUT.maxSpeed * 0.8, 0, 0];
    expect(aligned(s, w, "jupiter")).toBe(true);
    s.vel = [SCOUT.maxSpeed * 0.7, 0, 0];
    expect(aligned(s, w, "jupiter")).toBe(false);
    s.vel = [SCOUT.maxSpeed * 0.8, SCOUT.maxSpeed * 0.2, 0];
    expect(aligned(s, w, "jupiter")).toBe(false);
  });
});

describe("neighbourhoods", () => {
  it("keeps the ship beside the Moon inside the Moon's, and the Earth's outside it", () => {
    const w = system();
    expect(placeOf(w, [AU + 384_400 + 10_000, 0, 0], "sun")).toBe("moon");
    expect(placeOf(w, [AU + 200_000, 0, 0], "sun")).toBe("earth");
    expect(placeOf(w, [3 * AU, 0, 0], "earth")).toBe("sun");
  });

  it("changes frame without moving the ship", () => {
    const w = system();
    const s = newShip(SCOUT, "earth", [384_400 - 70_000, 0, 0]);
    const before = shipPosition(s, w);
    order(s, { kind: "heading", dir: [1, 0, 0] });
    s.mwd = true;
    s.vel = [2.1, 0, 0];
    // Flying on toward the Moon until it takes the ship in.
    for (let i = 0; i < 4000 && s.frame === "earth"; i++) step(s, w, 1);
    expect(s.frame).toBe("moon");
    const after = shipPosition(s, w);
    expect(len(sub(after, before))).toBeGreaterThan(3000);
    expect(len(sub(after, add(w.pos("moon")!, s.pos)))).toBeLessThan(1e-6);
  });
});

describe("launch and landing", () => {
  it("puts a launch 400 km above the right spot, and reads the spot back from the ship's position", () => {
    for (const [lat, lon, g] of [[51.5, -0.1, 12], [-33.9, 151.2, 200], [0, 179, 359]]) {
      const { pos } = aboveEarth(lat, lon, 400, g, eqToEcl);
      expect(len(pos)).toBeCloseTo(6778.137, 6);
      const back = belowShip(pos, g, eclToEq);
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.altitude).toBeCloseTo(400, 6);
    }
  });

  it("launches toward the east, the way rockets go to use the Earth's spin", () => {
    const { pos, heading } = aboveEarth(28.5, -80.6, 400, 0, eqToEcl);
    expect(Math.abs(pos[0] * heading[0] + pos[1] * heading[1] + pos[2] * heading[2])).toBeLessThan(1e-6);
    expect(len(heading)).toBeCloseTo(1, 9);
  });
});
