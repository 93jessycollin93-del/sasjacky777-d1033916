/**
 * Where everything is, at any moment: the positions of the catalogue's
 * bodies (bodies.ts) at a Julian date, in kilometres from the Sun in the
 * J2000 ecliptic frame.
 *
 * - The planets and Pluto follow JPL's "Keplerian Elements for Approximate
 *   Positions of the Major Planets" (E. M. Standish): table 1 between 1800
 *   and 2050, where it is good to tens of arcseconds for the inner planets, a
 *   couple of arcminutes for Mars and up to ten or fifteen for Jupiter and
 *   Saturn (Standish's own table; VSOP87 would do better for the giants);
 *   table 2, with its extra terms for the giants, from 3000 BC to 3000 AD.
 * - Everything is evaluated at Terrestrial Time; sky.ts converts the clock.
 * - The table gives the Earth–Moon barycentre. The Earth sits 1/82.3 of the way
 *   from it toward the Moon's opposite, and the Moon comes from a lunar theory:
 *   the largest terms of the ELP-2000/82 series as Jean Meeus tabulates them
 *   (Astronomical Algorithms, chapter 47), good to a few hundredths of a
 *   degree — close enough that eclipses happen when they did.
 * - Everything else is a conic: asteroids, comets and dwarf planets around the
 *   Sun, moons around their planets in the planets' equatorial planes.
 */
import { BODIES, BODY, type BodyDef } from "./bodies";
import {
  AU, conicPath, conicPosition, DEG, eccentricAnomaly, eqToEcl, equatorFrame, fromFrame, fromOrbitPlane, J2000, len, nutation, precessB1950,
  precessionMatrix, raDecToEcl, scale, add, sub, type Conic, type Vec3,
} from "./kepler";

// ---- the planets --------------------------------------------------------------------------------------------------

/** a (AU), e, I, L, ϖ (longitude of perihelion), Ω (degrees), each with its rate per Julian century. */
type Row = [number, number, number, number, number, number, number, number, number, number, number, number];

/** Table 1: 1800 AD – 2050 AD. */
const TABLE1: Row[] = [
  [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.2503235, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  [0.72333566, 0.0000039, 0.00677672, -0.00004107, 3.39467605, -0.0007889, 181.9790995, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  [5.202887, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  [9.53667594, -0.0012506, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.9542763, 0.40805281, 74.01692503, 0.04240589],
  [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
  [39.48211675, -0.00031596, 0.2488273, 0.0000517, 17.14001206, 0.00004818, 238.92903833, 145.20780515, 224.06891629, -0.04062942, 110.30393684, -0.01183482],
];

/** Table 2: 3000 BC – 3000 AD. */
const TABLE2: Row[] = [
  [0.38709843, 0, 0.20563661, 0.00002123, 7.00559432, -0.00590158, 252.25166724, 149472.67486623, 77.45771895, 0.15940013, 48.33961819, -0.12214182],
  [0.72332102, -0.00000026, 0.00676399, -0.00005107, 3.39777545, 0.00043494, 181.9797085, 58517.8156026, 131.76755713, 0.05679648, 76.67261496, -0.27274174],
  [1.00000018, -0.00000003, 0.01673163, -0.00003661, -0.00054346, -0.01337178, 100.46691572, 35999.37306329, 102.93005885, 0.3179526, -5.11260389, -0.24123856],
  [1.52371243, 0.00000097, 0.09336511, 0.00009149, 1.85181869, -0.00724757, -4.56813164, 19140.29934243, -23.91744784, 0.45223625, 49.71320984, -0.26852431],
  [5.20248019, -0.00002864, 0.0485359, 0.00018026, 1.29861416, -0.00322699, 34.33479152, 3034.90371757, 14.27495244, 0.18199196, 100.29282654, 0.13024619],
  [9.54149883, -0.00003065, 0.05550825, -0.00032044, 2.49424102, 0.00451969, 50.07571329, 1222.11494724, 92.86136063, 0.54179478, 113.63998702, -0.25015002],
  [19.18797948, -0.00020455, 0.0468574, -0.0000155, 0.77298127, -0.00180155, 314.20276625, 428.49512595, 172.43404441, 0.09266985, 73.96250215, 0.05739699],
  [30.06952752, 0.00006447, 0.00895439, 0.00000818, 1.7700552, 0.000224, 304.22289287, 218.46515314, 46.68158724, 0.01009938, 131.78635853, -0.00606302],
  [39.48686035, 0.00449751, 0.24885238, 0.00006016, 17.1410426, 0.00000501, 238.96535011, 145.18042903, 224.09702598, -0.00968827, 110.30167986, -0.00809981],
];

/** Table 2's extra terms for the mean anomaly of Jupiter to Pluto: b, c, s, f. */
const TABLE2_BCSF: Record<number, [number, number, number, number]> = {
  4: [-0.00012452, 0.0606406, -0.35635438, 38.35125],
  5: [0.00025899, -0.13434469, 0.87320147, 38.35125],
  6: [0.00058331, -0.97731848, 0.17689245, 7.67025],
  7: [-0.00041348, 0.68346318, -0.10162547, 7.67025],
  8: [-0.01262724, 0, 0, 0],
};

const T1_FROM = 2378496.5, T1_TO = 2469807.5;

/** A planet's elements at a date: the conic it is on now, and its mean anomaly (degrees) with table 2's corrections. */
export function planetConic(index: number, jd: number): Conic {
  const inTable1 = jd >= T1_FROM && jd <= T1_TO;
  const r = (inTable1 ? TABLE1 : TABLE2)[index];
  const T = (jd - J2000) / 36525;
  const a = r[0] + r[1] * T, e = r[2] + r[3] * T, i = r[4] + r[5] * T, L = r[6] + r[7] * T, varpi = r[8] + r[9] * T, node = r[10] + r[11] * T;
  let M = L - varpi;
  const extra = !inTable1 ? TABLE2_BCSF[index] : undefined;
  if (extra) {
    const [b, c, s, f] = extra;
    M += b * T * T + c * Math.cos(f * T * DEG) + s * Math.sin(f * T * DEG);
  }
  // The mean motion from the rate of the mean longitude: what the table was fitted to, rather than Kepler's third law.
  const n = r[7] / 36525;
  const Mw = ((M % 360) + 540) % 360 - 180;
  return { q: a * (1 - e), e, i, node, peri: varpi - node, tp: jd - Mw / n, n };
}

export function planetPosition(index: number, jd: number): Vec3 {
  return conicPosition(planetConic(index, jd), jd);
}

// ---- the Moon -------------------------------------------------------------------------------------------------------

/** Meeus table 47.A: multiples of D, M, M′, F, and the terms of longitude (1e-6°) and distance (1e-3 km). */
const MOON_LR: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149], [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210], [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056], [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897], [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0], [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

/** Meeus table 47.B: multiples of D, M, M′, F, and the terms of latitude (1e-6°). */
const MOON_B: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324], [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475], [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  // Rows 31–60. Each is under a thousandth of a degree, but together they were
  // half the latitude error: up to 34 arcseconds, the width of an eclipse path's edge.
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607], [2, 0, 2, -1, 596], [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451], [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421], [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351], [4, 0, 0, 1, 331], [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223], [0, 1, -2, -1, -220], [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185], [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176], [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164], [4, 0, 1, -1, 132], [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

/**
 * The Moon's place from the Earth's centre as Meeus's series gives it: on the
 * mean ecliptic and equinox of the date (degrees), and its distance (km). TT.
 */
export function moonOfDate(jd: number): { lon: number; lat: number; dist: number } {
  const T = (jd - J2000) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + (T * T * T) / 538841;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + (T * T * T) / 545868;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + (T * T * T) / 69699;
  const F = 93.272095 + 483202.0175233 * T - 0.0036539 * T * T;
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  // The Earth's orbit is slowly rounding out: terms that go with the Sun's anomaly shrink with it.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, l, r] of MOON_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * DEG;
    const k = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sl += l * k * Math.sin(arg);
    sr += r * k * Math.cos(arg);
  }
  for (const [d, m, mp, f, b] of MOON_B) {
    const k = m === 0 ? 1 : Math.abs(m) === 1 ? E : E * E;
    sb += b * k * Math.sin((d * D + m * M + mp * Mp + f * F) * DEG);
  }
  sl += 3958 * Math.sin(A1 * DEG) + 1962 * Math.sin((Lp - F) * DEG) + 318 * Math.sin(A2 * DEG);
  sb += -2235 * Math.sin(Lp * DEG) + 382 * Math.sin(A3 * DEG) + 175 * Math.sin((A1 - F) * DEG) + 175 * Math.sin((A1 + F) * DEG)
    + 127 * Math.sin((Lp - Mp) * DEG) - 115 * Math.sin((Lp + Mp) * DEG);
  const lon = Lp + sl / 1e6;
  return { lon: ((lon % 360) + 360) % 360, lat: sb / 1e6, dist: 385000.56 + sr / 1000 };
}

/**
 * The Moon's place from the Earth's centre: ecliptic longitude and latitude
 * (degrees, J2000) and distance (km).
 *
 * The series is referred to the ecliptic of the date, which tilts against
 * J2000's by 47 arcseconds a century; subtracting the precession from the
 * longitude alone left the latitude on the wrong plane. The whole vector is
 * carried instead: ecliptic of date → equator of date → J2000 equator (the
 * transposed precession matrix) → J2000 ecliptic.
 */
export function moonEcliptic(jd: number): { lon: number; lat: number; dist: number } {
  const m = moonOfDate(jd);
  const l = m.lon * DEG, b = m.lat * DEG;
  const v: Vec3 = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  const eps = nutation(jd).eps0, c = Math.cos(eps), s = Math.sin(eps);
  const eqDate: Vec3 = [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  const P = precessionMatrix(jd);
  const eq2000: Vec3 = [
    P[0][0] * eqDate[0] + P[1][0] * eqDate[1] + P[2][0] * eqDate[2],
    P[0][1] * eqDate[0] + P[1][1] * eqDate[1] + P[2][1] * eqDate[2],
    P[0][2] * eqDate[0] + P[1][2] * eqDate[1] + P[2][2] * eqDate[2],
  ];
  const w = eqToEcl(eq2000);
  const lon = Math.atan2(w[1], w[0]) / DEG;
  return { lon: ((lon % 360) + 360) % 360, lat: Math.asin(Math.max(-1, Math.min(1, w[2]))) / DEG, dist: m.dist };
}

export function moonGeocentric(jd: number): Vec3 {
  const { lon, lat, dist } = moonEcliptic(jd);
  const l = lon * DEG, b = lat * DEG;
  return [dist * Math.cos(b) * Math.cos(l), dist * Math.cos(b) * Math.sin(l), dist * Math.sin(b)];
}

/** The Moon's share of the Earth–Moon pair's mass: how far the Earth sits from their barycentre, as a fraction of the Moon's distance. */
const MOON_SHARE = 1 / (1 + 81.30056907);

/**
 * Just the Earth and the Moon (km from the Sun) at a date (TT): the same
 * numbers ephemeris() gives them, without the hundred other bodies. Eclipse
 * and phase searches ask for these hundreds of times.
 */
export function earthAndMoon(jd: number): { earth: Vec3; moon: Vec3 } {
  const geo = moonGeocentric(jd);
  const earth = sub(scale(planetPosition(2, jd), AU), scale(geo, MOON_SHARE));
  return { earth, moon: add(earth, geo) };
}

// ---- everything ------------------------------------------------------------------------------------------------------

/** Comet elements from B1950 catalogues, turned to J2000 once. */
const CONICS = new Map<string, Conic>();
for (const b of BODIES) if (b.orbit.kind === "conic") CONICS.set(b.id, b.orbit.frame === "B1950" ? precessB1950(b.orbit.conic) : b.orbit.conic);

export function conicOf(id: string): Conic | undefined {
  return CONICS.get(id);
}

const FRAMES = new Map<string, ReturnType<typeof equatorFrame>>();
/** A body's equatorial frame (its pole, and the node its longitudes start from). */
export function frameOf(id: string): ReturnType<typeof equatorFrame> {
  let f = FRAMES.get(id);
  if (!f) {
    const p = BODY[id]?.pole ?? [0, 90];
    f = equatorFrame(p[0], p[1]);
    FRAMES.set(id, f);
  }
  return f;
}

/** A moon's place around its planet (km, ecliptic axes). */
function equatorialOffset(b: BodyDef, jd: number): Vec3 {
  const o = b.orbit as Extract<BodyDef["orbit"], { kind: "equatorial" }>;
  const swing = o.libration ? o.libration[0] * Math.sin(o.libration[1] * (2000 + (jd - J2000) / 365.25 - o.libration[2]) * DEG) : 0;
  const node = o.node + (o.nodeRate ?? 0) * (jd - J2000);
  const M = (o.L0 + (360 * (jd - J2000)) / o.period + swing - node - o.peri) * DEG;
  const E = eccentricAnomaly(M, o.e);
  const xp = o.a * (Math.cos(E) - o.e), yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  return fromFrame(frameOf(b.parent!), fromOrbitPlane(xp, yp, node * DEG, o.i * DEG, o.peri * DEG));
}

/**
 * Every body's position at a Julian date, in km from the Sun. A body that is
 * not there at that date (a craft before its launch) is left out.
 */
export function ephemeris(jd: number): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  const moon = moonGeocentric(jd);
  const order: BodyDef[] = [];
  // Parents before children.
  const place = (b: BodyDef) => { if (!order.includes(b)) { if (b.parent && BODY[b.parent]) place(BODY[b.parent]); order.push(b); } };
  for (const b of BODIES) place(b);
  for (const b of order) {
    const o = b.orbit;
    switch (o.kind) {
      case "fixed": out.set(b.id, [0, 0, 0]); break;
      case "planet": {
        const p = scale(planetPosition(o.index, jd), AU);
        out.set(b.id, o.index === 2 ? sub(p, scale(moon, MOON_SHARE)) : p);
        break;
      }
      case "moon": {
        const earth = out.get(b.parent!);
        if (earth) out.set(b.id, add(earth, moon));
        break;
      }
      case "conic": out.set(b.id, scale(conicPosition(CONICS.get(b.id)!, jd), AU)); break;
      case "equatorial": {
        const parent = out.get(b.parent!);
        if (parent) out.set(b.id, add(parent, equatorialOffset(b, jd)));
        break;
      }
      case "escape":
        if (jd >= o.from) out.set(b.id, scale(raDecToEcl(o.ra, o.dec), (o.r0 + (o.rate * (jd - o.t0)) / 365.25) * AU));
        break;
      case "l2": {
        const earth = out.get("earth");
        if (earth) out.set(b.id, add(earth, scale(earth, o.distance / len(earth))));
        break;
      }
    }
  }
  return out;
}

/** One body's position (km from the Sun). */
export function positionOf(id: string, jd: number): Vec3 | null {
  return ephemeris(jd).get(id) ?? null;
}

/**
 * Its orbit, as points to draw: relative to what it goes round (km), and
 * that body's id. Long comet orbits are drawn out to `reach` AU.
 */
export function orbitPath(id: string, jd: number, count = 256, reach = 120): { around: string; points: Vec3[] } | null {
  const b = BODY[id];
  if (!b) return null;
  const o = b.orbit;
  switch (o.kind) {
    case "planet": return { around: "sun", points: conicPath(planetConic(o.index, jd), count).map((p) => scale(p, AU)) };
    case "conic": return { around: "sun", points: conicPath(CONICS.get(id)!, count, reach).map((p) => scale(p, AU)) };
    case "moon": {
      const month = 27.321582;
      const pts: Vec3[] = [];
      for (let k = 0; k <= count; k++) pts.push(moonGeocentric(jd - month / 2 + (month * k) / count));
      return { around: "earth", points: pts };
    }
    case "equatorial": {
      const f = frameOf(b.parent!);
      const bb = o.a * Math.sqrt(1 - o.e * o.e);
      const pts: Vec3[] = [];
      for (let k = 0; k <= count; k++) {
        const E = (k / count) * Math.PI * 2;
        pts.push(fromFrame(f, fromOrbitPlane(o.a * (Math.cos(E) - o.e), bb * Math.sin(E), o.node * DEG, o.i * DEG, o.peri * DEG)));
      }
      return { around: b.parent!, points: pts };
    }
    default: return null;
  }
}

/** Its velocity (km/s) at a date, from a short step either side: for a comet's tail and the overview's speeds. */
export function velocityOf(id: string, jd: number): Vec3 {
  const h = 1 / 1440;
  const a = positionOf(id, jd - h), b = positionOf(id, jd + h);
  if (!a || !b) return [0, 0, 0];
  return scale(sub(b, a), 1 / (2 * h * 86400));
}
