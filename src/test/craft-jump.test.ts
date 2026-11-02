import { describe, expect, it } from "vitest";
import { apparentMagnitude, distance, REAL_STARS, SOL, SUN_POS } from "@/craft/space/galaxy";
import { AU, len, sub } from "@/craft/space/kepler";
import { JUMP_SPOOL, jumpTunnel, SpaceSession } from "@/craft/space/session";
import { SOLAR_SYSTEM, systemFor } from "@/craft/space/starSystem";
import { orbitSummary } from "@/craft/space/newton";
import { ephemeris } from "@/craft/space/ephemeris";

const star = (name: string) => REAL_STARS.find((s) => s.name === name)!;
const jd0 = 2460600.5;

/** Runs the session on for `seconds` of play, in frames of a tenth of a second. */
function fly(s: SpaceSession, seconds: number, until?: () => boolean): void {
  for (let t = 0; t < seconds; t += 0.1) { s.update(0.1); if (until?.()) return; }
}

describe("other stars' systems", () => {
  it("are flown like the Solar System: every body where its orbit puts it, moving at the speed its orbit needs", () => {
    const sys = systemFor(star("Proxima Centauri"));
    expect(sys.solar).toBe(false);
    const at = sys.positions(jd0);
    const b = sys.body("b")!;
    const r = len(at.get("b")!);
    expect(r / AU).toBeGreaterThan(0.045);
    expect(r / AU).toBeLessThan(0.052);
    // Nearly round: its speed is the circular speed, √(GM/r).
    const v = len(sys.velocity("b", jd0));
    expect(v / Math.sqrt(sys.body("sun")!.gm! / r)).toBeCloseTo(1, 1);
    expect(sys.air("b")?.rho0 ?? 0).toBeGreaterThan(0);
    expect(sys.world("b")?.type).toBe(b.world!.type);
    const path = sys.orbitPath("b", jd0, 64)!;
    expect(len(sub(path.points[0], path.points[64]))).toBeLessThan(1);
  });

  it("keeps the Solar System the real one", () => {
    expect(SOLAR_SYSTEM.solar).toBe(true);
    expect(SOLAR_SYSTEM.positions(jd0).get("mars")).toEqual(ephemeris(jd0).get("mars"));
    expect(systemFor(SOL)).toBe(SOLAR_SYSTEM);
    expect(SOLAR_SYSTEM.world("moon")?.type).toBe("barren");
    expect(SOLAR_SYSTEM.world("earth")).toBeNull();
  });
});

describe("the jump drive", () => {
  it("spools up, crosses hyperspace and comes out in a real orbit round the new star, outside its planets", () => {
    const s = new SpaceSession(1, { lat: 28.5, lon: -80.6 }, jd0);
    const proxima = star("Proxima Centauri");
    expect(s.startJump(proxima)).toBe(true);
    expect(s.jump?.phase).toBe("spool");
    fly(s, JUMP_SPOOL + 0.2);
    expect(s.jump?.phase).toBe("tunnel");
    fly(s, jumpTunnel(4.25) + 0.5);
    expect(s.jump).toBeNull();
    expect(s.system.star.name).toBe("Proxima Centauri");
    expect(s.ship.frame).toBe("sun");
    const r = len(s.ship.pos);
    for (const b of s.system.bodies) if (b.orbit.kind === "kepler" && b.kind === "planet") expect(r).toBeGreaterThan(b.orbit.a);
    const o = orbitSummary(s.ship, s.surroundings)!;
    expect(o.e).toBeLessThan(0.01);
    expect(s.rows().map((row) => row.name)).toEqual(expect.arrayContaining(["Proxima Centauri b", "Proxima Centauri d"]));
    // No world to land in yet out here: the landing is refused, and says why.
    expect(s.give({ kind: "land" })).toBe(false);
    expect(s.noteText()).toMatch(/home/);
  });

  it("refuses a jump to where the ship already is, a second jump at once, and one in the middle of a warp", () => {
    const s = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    expect(s.startJump(SOL)).toBe(false);
    expect(s.startJump(star("Barnard's Star"))).toBe(true);
    expect(s.startJump(star("Wolf 359"))).toBe(false);
    const t = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    t.warpTo("mars", 0);
    fly(t, 30, () => !!t.ship.warp);
    expect(t.ship.warp).not.toBeNull();
    expect(t.startJump(star("Barnard's Star"))).toBe(false);
  });

  it("warps to another star's planet and settles into orbit round it", () => {
    const s = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    s.startJump(star("Proxima Centauri"));
    fly(s, JUMP_SPOOL + jumpTunnel(4.25) + 1);
    expect(s.warpTo("b", 0)).toBe(true);
    fly(s, 240, () => s.ship.frame === "b" && !s.ship.warp);
    expect(s.ship.frame).toBe("b");
    const o = orbitSummary(s.ship, s.surroundings)!;
    expect(o.periapsis).toBeGreaterThan(0);
    expect(o.e).toBeLessThan(0.2);
  });

  it("comes home a short warp from the Earth", () => {
    const s = new SpaceSession(1, { lat: 0, lon: 0 }, jd0);
    s.startJump(star("Tau Ceti"));
    fly(s, JUMP_SPOOL + jumpTunnel(12) + 1);
    expect(s.system.solar).toBe(false);
    expect(s.startJump(SOL)).toBe(true);
    fly(s, JUMP_SPOOL + jumpTunnel(12) + 1);
    expect(s.system.solar).toBe(true);
    expect(s.distanceTo("earth") / AU).toBeLessThan(0.05);
    expect(s.canWarp("earth")).toBe(true);
  });

  it("takes longer through hyperspace the farther the jump, but only seconds even across the galaxy", () => {
    expect(jumpTunnel(4.2)).toBeLessThan(jumpTunnel(1000));
    expect(jumpTunnel(80_000)).toBeLessThan(10);
  });
});

describe("the view from another star", () => {
  it("sees the Sun as one of the brightest stars from Alpha Centauri, and loses it by a hundred light-years", () => {
    const pc = distance(star("Alpha Centauri A").pos, SUN_POS);
    expect(apparentMagnitude(1, pc)).toBeGreaterThan(0.2);
    expect(apparentMagnitude(1, pc)).toBeLessThan(0.7);
    expect(apparentMagnitude(1, 100 / 3.2616)).toBeGreaterThan(6.5);
    expect(apparentMagnitude(1, 10)).toBeCloseTo(4.83, 5);
  });
});
