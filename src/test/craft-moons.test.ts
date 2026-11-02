import { describe, expect, it } from "vitest";
import { ephemeris } from "@/craft/space/ephemeris";
import { cross, dot, eqToEcl, J2000, norm, raDecToEcl, sub, tt, type Vec3 } from "@/craft/space/kepler";

/**
 * The moons where the standard theories put them. Each row is a planet's view
 * of its moon — a unit vector in the J2000 ecliptic — at a moment, with the
 * light-time from the planet to the Earth, since the theories (ESAPHO/ESADE,
 * Lieske's E5, TASS 1.7 and GUST86, as PyEphem 4.2.1 computes them) give the
 * moon as seen from here, where its light left it that long before. Rows are
 * [Julian date UT, light-time (days), x, y, z].
 *
 * Before these were fitted, Io sat on the far side of Jupiter, Ganymede 163°
 * round its orbit, Saturn's moons up to 175° off and drifting, Uranus's five
 * up to 152° off, Phobos opposite where it is — and Charon went round Pluto
 * backwards.
 */
const REFERENCE: Record<string, { planet: string; at: [number, number, number, number, number][] }> = {
  phobos: { planet: "mars", at: [[2451545.0, 0.010682, -0.38025, -0.91422, 0.14005], [2461324.5, 0.009211, 0.82210, 0.43367, -0.36889], [2464479.5, 0.004884, 0.50360, 0.84662, -0.17212]] },
  deimos: { planet: "mars", at: [[2451545.0, 0.010682, 0.40686, -0.87517, -0.26182], [2461324.5, 0.009211, -0.43257, 0.86681, 0.24803], [2464479.5, 0.004884, -0.87959, 0.24791, 0.40603]] },
  io: { planet: "jupiter", at: [[2451545.0, 0.026689, 0.97568, 0.21814, 0.02159], [2461324.5, 0.033483, 0.66301, -0.74835, -0.01950], [2464479.5, 0.033393, 0.20342, 0.97811, 0.04383]] },
  europa: { planet: "jupiter", at: [[2451545.0, 0.026689, -0.86912, -0.49390, -0.02645], [2461324.5, 0.033483, -0.95200, 0.30577, -0.01423], [2464479.5, 0.033393, 0.76684, -0.64144, -0.02261]] },
  ganymede: { planet: "jupiter", at: [[2451545.0, 0.026689, -0.78382, -0.62015, -0.03237], [2461324.5, 0.033483, -0.99940, 0.02768, -0.02075], [2464479.5, 0.033393, -0.99063, 0.13647, -0.00474]] },
  callisto: { planet: "jupiter", at: [[2451545.0, 0.026689, 0.18685, 0.98166, 0.03793], [2461324.5, 0.033483, 0.27341, 0.96086, 0.04478], [2464479.5, 0.033393, 0.00473, 0.99928, 0.03771]] },
  mimas: { planet: "saturn", at: [[2451545.0, 0.049974, 0.51058, -0.78158, 0.35839], [2461324.5, 0.048749, -0.72595, -0.58460, 0.36227], [2464479.5, 0.055999, -0.82846, 0.52779, -0.18733]] },
  enceladus: { planet: "saturn", at: [[2451545.0, 0.049974, 0.49333, -0.78927, 0.36561], [2461324.5, 0.048749, 0.99018, 0.05817, -0.12710], [2464479.5, 0.055999, -0.91514, -0.30884, 0.25911]] },
  tethys: { planet: "saturn", at: [[2451545.0, 0.049974, 0.61509, -0.72899, 0.30042], [2461324.5, 0.048749, 0.13879, 0.87059, -0.47203], [2464479.5, 0.055999, -0.98104, 0.19381, 0.00038]] },
  dione: { planet: "saturn", at: [[2451545.0, 0.049974, 0.50776, -0.78224, 0.36094], [2461324.5, 0.048749, 0.98930, 0.06525, -0.13046], [2464479.5, 0.055999, 0.17283, -0.87874, 0.44491]] },
  rhea: { planet: "saturn", at: [[2451545.0, 0.049974, -0.99594, 0.04610, 0.07731], [2461324.5, 0.048749, -0.30827, 0.85226, -0.42264], [2464479.5, 0.055999, -0.32149, -0.82070, 0.47234]] },
  titan: { planet: "saturn", at: [[2451545.0, 0.049974, -0.74562, 0.61908, -0.24655], [2461324.5, 0.048749, -0.41446, -0.79163, 0.44894], [2464479.5, 0.055999, -0.95448, -0.20967, 0.21214]] },
  hyperion: { planet: "saturn", at: [[2451545.0, 0.049974, 0.16053, 0.87546, -0.45585], [2461324.5, 0.048749, 0.39739, -0.83424, 0.38227], [2464479.5, 0.055999, 0.90727, 0.33236, -0.25769]] },
  iapetus: { planet: "saturn", at: [[2451545.0, 0.049974, -0.78357, -0.55140, 0.28634], [2461324.5, 0.048749, 0.68885, -0.72435, 0.02822], [2464479.5, 0.055999, -0.58089, -0.75886, 0.29445]] },
  miranda: { planet: "uranus", at: [[2451545.0, 0.119710, -0.39660, -0.06250, -0.91586], [2461324.5, 0.108305, 0.85893, -0.30753, -0.40947], [2464479.5, 0.114051, 0.59722, -0.19922, -0.77694]] },
  ariel: { planet: "uranus", at: [[2451545.0, 0.119710, 0.97057, -0.24047, -0.01298], [2461324.5, 0.108305, 0.39050, -0.20470, -0.89756], [2464479.5, 0.114051, 0.95850, -0.21093, 0.19179]] },
  umbriel: { planet: "uranus", at: [[2451545.0, 0.119710, 0.51879, -0.24937, -0.81772], [2461324.5, 0.108305, 0.97643, -0.16319, 0.14128], [2464479.5, 0.114051, -0.20978, -0.08098, -0.97439]] },
  titania: { planet: "uranus", at: [[2451545.0, 0.119710, -0.06534, -0.13134, -0.98918], [2461324.5, 0.108305, -0.83263, 0.23961, 0.49932], [2464479.5, 0.114051, 0.95985, -0.22664, 0.16529]] },
  oberon: { planet: "uranus", at: [[2451545.0, 0.119710, -0.94446, 0.18182, -0.27376], [2461324.5, 0.108305, 0.53353, 0.00871, 0.84574], [2464479.5, 0.114051, 0.33669, -0.21786, -0.91606]] },
};

/**
 * How far (degrees) each may be from its theory. A few degrees is what a mean
 * longitude and a fixed ellipse can do against a full theory; the larger
 * allowances are physics this model leaves out, named so they are not taken
 * for errors: Phobos's node turning every 2.3 years, Miranda's node regressing,
 * Iapetus's plane (fixed here at its 2013 place) turning four degrees a century,
 * and Hyperion, whose orbit Titan makes chaotic.
 */
const ALLOW: Record<string, number> = { phobos: 6, deimos: 5, mimas: 4.5, tethys: 4.5, iapetus: 4, hyperion: 35, miranda: 8 };

const angle = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;
const seen = (id: string, planet: string, jdUT: number, tau: number): Vec3 => {
  const e = ephemeris(tt(jdUT) - tau);
  return sub(e.get(id)!, e.get(planet)!);
};

describe("the moons, where their theories put them", () => {
  for (const [id, { planet, at }] of Object.entries(REFERENCE)) {
    it(`places ${id} within ${ALLOW[id] ?? 2.5}° of its theory, from 2000 to 2035`, () => {
      for (const [jdUT, tau, x, y, z] of at) expect(angle(seen(id, planet, jdUT, tau), [x, y, z])).toBeLessThan(ALLOW[id] ?? 2.5);
    });
  }

  const R = Math.PI / 180;
  /** A prime meridian's direction from an IAU pole (right ascension, declination) and rotation angle W. */
  const meridian = (ra: number, dec: number, W: number): Vec3 => {
    const z = raDecToEcl(ra, dec), x = eqToEcl([-Math.sin(ra * R), Math.cos(ra * R), 0]), y = cross(z, x);
    return [0, 1, 2].map((k) => Math.cos(W * R) * x[k] + Math.sin(W * R) * y[k]) as Vec3;
  };
  const years = [2000, 2015, 2026.78, 2035].map((y) => J2000 + (y - 2000) * 365.25);

  it("sends Charon round Pluto the right way, under Pluto's prime meridian, which faces it (IAU)", () => {
    for (const jd of years) {
      const e = ephemeris(jd);
      const want = meridian(132.993, -6.163, 302.695 + 56.3625225 * (jd - J2000));
      expect(angle(sub(e.get("charon")!, e.get("pluto")!), want)).toBeLessThan(0.5);
    }
  });

  it("keeps Triton facing Neptune as the IAU's model of its turning says, its node precessing half a degree a year", () => {
    for (const jd of years) {
      const T = (jd - J2000) / 36525, N = (177.85 + 52.316 * T) * R;
      const s = (k: number) => Math.sin(k * N), c = (k: number) => Math.cos(k * N);
      const ra = 299.36 - 32.35 * s(1) - 6.28 * s(2) - 2.08 * s(3) - 0.74 * s(4) - 0.28 * s(5) - 0.11 * s(6) - 0.07 * s(7) - 0.02 * s(8) - 0.01 * s(9);
      const dec = 41.17 + 22.55 * c(1) + 2.1 * c(2) + 0.55 * c(3) + 0.16 * c(4) + 0.05 * c(5) + 0.02 * c(6) + 0.01 * c(7);
      const W = 296.53 - 61.2572637 * (jd - J2000) + 22.25 * s(1) + 6.73 * s(2) + 2.05 * s(3) + 0.74 * s(4) + 0.28 * s(5) + 0.11 * s(6)
        + 0.05 * s(7) + 0.02 * s(8) + 0.01 * s(9);
      // Its prime meridian points at Neptune, so Neptune sees it along the opposite way.
      const want = meridian(ra, dec, W).map((v) => -v) as Vec3;
      const e = ephemeris(jd);
      expect(angle(sub(e.get("triton")!, e.get("neptune")!), want)).toBeLessThan(0.5);
    }
  });
});
