/**
 * Orbits the way celestial mechanics writes them down: two bodies, conic
 * sections, and the handful of angles that pin one in space.
 *
 * Everything here is pure arithmetic on numbers, in one frame: the ecliptic
 * and equinox of J2000 (x toward the March equinox, z toward the ecliptic's
 * north pole), heliocentric unless a function says otherwise. Distances are
 * in astronomical units where the Sun is the centre and in kilometres around
 * a planet; angles go in and out in degrees at the edges and radians inside.
 * Times are Julian dates: Universal Time (UT1, which the world's clocks keep
 * to within a second) unless a name says TT, the uniform time the planetary
 * theories run on. tt() converts; deltaT() is the difference, a minute today
 * and hours in antiquity, because the Earth's turning slows.
 */

export type Vec3 = [number, number, number];

export const AU = 149_597_870.7;
export const J2000 = 2451545.0;
export const DAY = 86400;
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
/** The Sun's GM in the units the orbits use (AU³/day²): the square of Gauss's constant. */
export const GAUSS_K = 0.01720209895;
/** The obliquity of the ecliptic at J2000 (IAU 1976): the tilt between the ecliptic and the celestial equator. */
export const OBLIQUITY = 23.4392911 * DEG;

export const jdFromMs = (ms: number): number => ms / 86_400_000 + 2440587.5;
export const msFromJd = (jd: number): number => (jd - 2440587.5) * 86_400_000;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** An angle folded into -π..π. */
export function wrapPi(a: number): number {
  const m = ((a % TAU) + TAU) % TAU;
  return m > Math.PI ? m - TAU : m;
}

/**
 * The eccentric anomaly E for a mean anomaly M on an ellipse: E − e sin E = M.
 * Newton's method from a start that converges for every e below one (for a
 * comet at 0.9999 near perihelion the usual start overshoots and cycles), with
 * bisection as the net under it.
 */
export function eccentricAnomaly(M: number, e: number): number {
  const m = wrapPi(M);
  let E = e < 0.8 ? m : m + 0.85 * e * Math.sign(m || 1);
  let lo = -Math.PI, hi = Math.PI;
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - m;
    if (f > 0) hi = Math.min(hi, E); else lo = Math.max(lo, E);
    const step = f / (1 - e * Math.cos(E));
    let next = E - step;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - E) < 1e-15) return next;
    E = next;
  }
  return E;
}

/** The hyperbolic anomaly H for a mean anomaly M on a hyperbola: e sinh H − H = M. */
export function hyperbolicAnomaly(M: number, e: number): number {
  let H = Math.asinh(M / e);
  for (let i = 0; i < 80; i++) {
    const f = e * Math.sinh(H) - H - M;
    const step = f / (e * Math.cosh(H) - 1);
    H -= step;
    if (Math.abs(step) < 1e-14 * Math.max(1, Math.abs(H))) break;
  }
  return H;
}

/**
 * A point of an orbit's own plane (x toward perihelion) turned into the
 * reference frame by the three angles: the ascending node Ω, the inclination
 * i and the argument of perihelion ω (radians).
 */
export function fromOrbitPlane(xp: number, yp: number, node: number, incl: number, argp: number): Vec3 {
  const cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(incl), si = Math.sin(incl), cw = Math.cos(argp), sw = Math.sin(argp);
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/**
 * Conic elements: perihelion distance q, eccentricity e, inclination,
 * ascending node and argument of perihelion (degrees), and the time of
 * perihelion tp. Every orbit, closed or open, is one of these. `n`, when
 * given, is the mean motion in degrees a day: a comet whose period planets
 * have stretched is timed by its real returns, not by Kepler's third law.
 */
export interface Conic {
  q: number;
  e: number;
  i: number;
  node: number;
  peri: number;
  tp: number;
  n?: number;
  /**
   * Perihelion dates (Julian dates, TT), oldest first, when they are known
   * return by return. The planets stretch and shrink a comet's period by
   * years; one mean motion for every return put Halley 14 years off in 1066
   * and two AU from the Sun on its 1910 perihelion. Between two listed
   * returns the mean anomaly runs at that interval's own rate.
   */
  returns?: number[];
}

/** Elements given the usual way for an asteroid (semi-major axis and mean anomaly at an epoch), as a conic. */
export function conicFromMean(a: number, e: number, i: number, node: number, peri: number, M0: number, epoch: number, gm = GAUSS_K * GAUSS_K): Conic {
  const n = Math.sqrt(gm / (a * a * a)) / DEG;
  return { q: a * (1 - e), e, i, node, peri, tp: epoch - M0 / n, n };
}

/** The mean motion (radians a day) of a conic around a body of GM `gm` (in the conic's units cubed per day²). */
export function meanMotion(c: Conic, gm: number): number {
  if (c.n !== undefined) return c.n * DEG;
  const a = c.q / Math.abs(1 - c.e);
  return Math.sqrt(gm / (a * a * a));
}

/** Where a conic's body is at a Julian date: in its units, relative to what it orbits. */
export function conicPosition(c: Conic, jd: number, gm = GAUSS_K * GAUSS_K): Vec3 {
  const n = meanMotion(c, gm);
  let M = n * (jd - c.tp);
  const R = c.returns;
  if (R && R.length >= 2 && c.e < 1) {
    let k = 0;
    while (k < R.length - 2 && jd >= R[k + 1]) k++;
    M = (TAU * (jd - R[k])) / (R[k + 1] - R[k]);
  }
  let xp: number, yp: number;
  if (c.e < 1) {
    const a = c.q / (1 - c.e);
    const E = eccentricAnomaly(M, c.e);
    xp = a * (Math.cos(E) - c.e);
    yp = a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  } else if (c.e > 1) {
    const a = c.q / (c.e - 1);
    const H = hyperbolicAnomaly(M, c.e);
    xp = a * (c.e - Math.cosh(H));
    yp = a * Math.sqrt(c.e * c.e - 1) * Math.sinh(H);
  } else {
    // A parabola: Barker's equation, solved in closed form.
    const W = 3 * Math.sqrt(gm / (2 * c.q * c.q * c.q)) * (jd - c.tp);
    const Y = Math.cbrt(W / 2 + Math.sqrt((W * W) / 4 + 1));
    const s = Y - 1 / Y;
    xp = c.q * (1 - s * s);
    yp = 2 * c.q * s;
  }
  return fromOrbitPlane(xp, yp, c.node * DEG, c.i * DEG, c.peri * DEG);
}

/**
 * Points along a conic, for drawing it: a closed orbit all the way round;
 * an open one (or a comet's long ellipse) out to `reach` from its focus.
 */
export function conicPath(c: Conic, count: number, reach = Infinity): Vec3[] {
  const out: Vec3[] = [];
  const O = c.node * DEG, I = c.i * DEG, W = c.peri * DEG;
  if (c.e < 1 && c.q * (1 + c.e) / (1 - c.e) <= reach) {
    const a = c.q / (1 - c.e), b = a * Math.sqrt(1 - c.e * c.e);
    for (let k = 0; k <= count; k++) {
      const E = (k / count) * TAU;
      out.push(fromOrbitPlane(a * (Math.cos(E) - c.e), b * Math.sin(E), O, I, W));
    }
    return out;
  }
  // Open, or cut off: by true anomaly, as far as the reach allows.
  const p = c.q * (1 + c.e);
  const cosMax = Math.max(-1, Math.min(1, (p / reach - 1) / c.e));
  const vMax = Math.min(c.e >= 1 ? Math.acos(-1 / c.e) - 1e-3 : Math.PI, Math.acos(cosMax));
  for (let k = 0; k <= count; k++) {
    const v = -vMax + (2 * vMax * k) / count;
    const r = p / (1 + c.e * Math.cos(v));
    out.push(fromOrbitPlane(r * Math.cos(v), r * Math.sin(v), O, I, W));
  }
  return out;
}

// ---- frames -------------------------------------------------------------------------------------------------------

/** A vector in the J2000 equatorial frame, in the J2000 ecliptic one. */
export function eqToEcl(v: Vec3): Vec3 {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
}

export function eclToEq(v: Vec3): Vec3 {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/** A direction on the sky (right ascension and declination, degrees, J2000) as an ecliptic unit vector. */
export function raDecToEcl(ra: number, dec: number): Vec3 {
  const r = ra * DEG, d = dec * DEG;
  return eqToEcl([Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)]);
}

export type Mat3 = [Vec3, Vec3, Vec3];
const mul = (m: Mat3, v: Vec3): Vec3 => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
const mulT = (m: Mat3, v: Vec3): Vec3 => [m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2], m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2], m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]];
const matMul = (a: Mat3, b: Mat3): Mat3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as Mat3;
const R1 = (t: number): Mat3 => [[1, 0, 0], [0, Math.cos(t), Math.sin(t)], [0, -Math.sin(t), Math.cos(t)]];
const R2 = (t: number): Mat3 => [[Math.cos(t), 0, -Math.sin(t)], [0, 1, 0], [Math.sin(t), 0, Math.cos(t)]];
const R3 = (t: number): Mat3 => [[Math.cos(t), Math.sin(t), 0], [-Math.sin(t), Math.cos(t), 0], [0, 0, 1]];

/**
 * Old comet catalogues (Marsden's, and the historical comets taken from it)
 * give elements referred to the equinox of B1950. They are turned to J2000 by
 * precessing the orbit's two in-plane directions: B1950 ecliptic to B1950
 * equator, the IAU 1976 precession from B1950 to J2000, and back down to the
 * J2000 ecliptic — then read the three angles off again.
 */
export function precessB1950(c: Conic): Conic {
  const T = (2433282.4235 - J2000) / 36525;
  const as = (x: number) => (x / 3600) * DEG;
  const zeta = as(2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3);
  const z = as(2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3);
  const theta = as(2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3);
  // P carries J2000 equatorial coordinates to B1950's; its transpose goes back.
  const P = matMul(matMul(R3(-z), R2(theta)), R3(-zeta));
  const eps1950 = 23.4457889 * DEG;
  const toEq1950 = (v: Vec3): Vec3 => [v[0], v[1] * Math.cos(eps1950) - v[2] * Math.sin(eps1950), v[1] * Math.sin(eps1950) + v[2] * Math.cos(eps1950)];
  const carry = (v: Vec3) => eqToEcl(mulT(P, toEq1950(v)));
  const O = c.node * DEG, I = c.i * DEG, W = c.peri * DEG;
  const Pv = carry(fromOrbitPlane(1, 0, O, I, W)), Qv = carry(fromOrbitPlane(0, 1, O, I, W));
  const h = cross(Pv, Qv);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2])));
  const node = Math.atan2(h[0], -h[1]);
  // The argument of perihelion: from the node line to the perihelion direction, in the orbit's own sense.
  const nodeDir: Vec3 = [Math.cos(node), Math.sin(node), 0];
  const peri = Math.atan2(dot(cross(nodeDir, Pv), h), dot(nodeDir, Pv));
  const deg = (a: number) => ((a / DEG) % 360 + 360) % 360;
  return { ...c, i: i / DEG, node: deg(node), peri: deg(peri) };
}

/**
 * A body's equatorial frame, from its north pole's right ascension and
 * declination (IAU): the pole as z, and as x the ascending node of its
 * equator on the Earth's — where the IAU starts counting a body's longitudes.
 */
export function equatorFrame(ra: number, dec: number): { x: Vec3; y: Vec3; z: Vec3 } {
  const r = ra * DEG;
  const z = raDecToEcl(ra, dec);
  const x = eqToEcl([-Math.sin(r), Math.cos(r), 0]);
  return { x, y: cross(z, x), z };
}

/** A point of a body's equatorial frame, in the ecliptic frame. */
export function fromFrame(f: { x: Vec3; y: Vec3; z: Vec3 }, v: Vec3): Vec3 {
  return [
    f.x[0] * v[0] + f.y[0] * v[1] + f.z[0] * v[2],
    f.x[1] * v[0] + f.y[1] * v[1] + f.z[1] * v[2],
    f.x[2] * v[0] + f.y[2] * v[1] + f.z[2] * v[2],
  ];
}

// ---- time, and the Earth's turning axis --------------------------------------------------------------------------

/**
 * ΔT = TT − UT, in seconds: how far the Earth's turning has fallen behind a
 * uniform clock. The ephemeris runs on TT and the sky turns on UT, so without
 * it the Moon sits half an arcminute behind today, every eclipse comes a
 * minute late — and in antiquity, when ΔT was hours, the shadow lands on the
 * wrong continent.
 *
 * Measured values (IERS/USNO, start of each year) from 1955 to 2025; Espenak
 * and Meeus's polynomials (the NASA Five Millennium Canon of Solar Eclipses)
 * before; a straight line from the last measurement to their 2050 value after,
 * since their 2005–2050 fit overshoots what the Earth has since done by 5 s.
 */
const DELTA_T_OBSERVED: [number, number][] = [
  [1955, 31.1], [1960, 33.15], [1965, 35.73], [1970, 40.18], [1975, 45.48], [1980, 50.54], [1985, 54.34],
  [1990, 56.86], [1995, 60.78], [2000, 63.83], [2005, 64.69], [2010, 66.07], [2015, 67.64], [2016, 68.1],
  [2017, 68.59], [2018, 68.97], [2019, 69.22], [2020, 69.36], [2021, 69.36], [2022, 69.29], [2023, 69.2],
  [2024, 69.18], [2025, 69.1],
];

function espenakMeeus(y: number): number {
  if (y < -500 || y >= 2150) { const u = (y - 1820) / 100; return -20 + 32 * u * u; }
  if (y < 500) { const u = y / 100; return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6; }
  if (y < 1600) { const u = (y - 1000) / 100; return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6; }
  if (y < 1700) { const t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129; }
  if (y < 1800) { const t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (y < 1860) { const t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7; }
  if (y < 1900) { const t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (y < 1920) { const t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { const t = y - 1920; return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3; }
  if (y < 1961) { const t = y - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (y < 1986) { const t = y - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
}

/** ΔT (seconds) at a Julian date. */
export function deltaT(jd: number): number {
  const y = 2000 + (jd - J2000) / 365.25;
  const first = DELTA_T_OBSERVED[0], last = DELTA_T_OBSERVED[DELTA_T_OBSERVED.length - 1];
  if (y < first[0]) return espenakMeeus(y);
  if (y <= last[0]) {
    let k = 0;
    while (DELTA_T_OBSERVED[k + 1][0] < y) k++;
    const [y0, v0] = DELTA_T_OBSERVED[k], [y1, v1] = DELTA_T_OBSERVED[k + 1];
    return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
  }
  if (y < 2050) return last[1] + ((espenakMeeus(2050) - last[1]) * (y - last[0])) / (2050 - last[0]);
  return espenakMeeus(y);
}

/** Terrestrial Time for a Universal Time (both Julian dates). */
export const tt = (jdUT: number): number => jdUT + deltaT(jdUT) / DAY;

const ARCSEC = DEG / 3600;

/**
 * IAU 1976 precession (Lieske; Meeus 21.2): the matrix that carries J2000
 * equatorial coordinates to the mean equator and equinox of a date (TT). The
 * pole wanders 50 arcseconds a year — enough to put Thuban, not Polaris, over
 * the pole when the pyramids were built.
 */
export function precessionMatrix(jdTT: number): Mat3 {
  const T = (jdTT - J2000) / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * ARCSEC;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * ARCSEC;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * ARCSEC;
  return matMul(matMul(R3(-z), R2(theta)), R3(-zeta));
}

/**
 * Nutation, the axis's 18.6-year nod (Meeus ch. 22, the four-term series good
 * to half an arcsecond), and the mean obliquity of the date (22.2). Radians.
 */
export function nutation(jdTT: number): { dpsi: number; deps: number; eps0: number } {
  const T = (jdTT - J2000) / 36525;
  const O = (125.04452 - 1934.136261 * T + 0.0020708 * T * T + T ** 3 / 450000) * DEG;
  const L = (280.4665 + 36000.7698 * T) * DEG, Lm = (218.3165 + 481267.8813 * T) * DEG;
  const dpsi = (-17.2 * Math.sin(O) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * O)) * ARCSEC;
  const deps = (9.2 * Math.cos(O) + 0.57 * Math.cos(2 * L) + 0.1 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * O)) * ARCSEC;
  const eps0 = (23 + 26 / 60 + 21.448 / 3600) * DEG + (-46.815 * T - 0.00059 * T * T + 0.001813 * T ** 3) * ARCSEC;
  return { dpsi, deps, eps0 };
}

/**
 * J2000 equatorial to the true equator and equinox of date: nutation after
 * precession. Everything Earth-fixed — the sky over a place, a launch site,
 * the ground under a ship — turns on this frame, not on J2000's: GAST counts
 * from the true equinox of date, and applying it to J2000 coordinates turned
 * the whole sky 20 arcminutes in 2026 and by degrees in antiquity.
 */
export function trueOfDate(jdTT: number): Mat3 {
  const { dpsi, deps, eps0 } = nutation(jdTT);
  const N = matMul(matMul(R1(-(eps0 + deps)), R3(-dpsi)), R1(eps0));
  return matMul(N, precessionMatrix(jdTT));
}

/** A J2000 equatorial vector in the true-of-date frame at a UT date, and back. */
export const toDate = (v: Vec3, jdUT: number): Vec3 => mul(trueOfDate(tt(jdUT)), v);
export const fromDate = (v: Vec3, jdUT: number): Vec3 => mulT(trueOfDate(tt(jdUT)), v);

/**
 * Greenwich mean sidereal time at a Julian date (UT), in degrees: how far
 * round the Earth has turned against the mean equinox of date (Meeus 12.4,
 * with the T² and T³ terms that reach a degree by 3000 BC).
 */
export function gmst(jd: number): number {
  const d = jd - J2000, T = d / 36525;
  return ((280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T ** 3 / 38710000) % 360 + 360) % 360;
}

/**
 * Greenwich apparent sidereal time (degrees): GMST plus the equation of the
 * equinoxes, measured from the true equinox of date — the angle that, with
 * trueOfDate, takes the sky from J2000 to the ground.
 */
export function gast(jd: number): number {
  const { dpsi, deps, eps0 } = nutation(tt(jd));
  return ((gmst(jd) + (dpsi * Math.cos(eps0 + deps)) / DEG) % 360 + 360) % 360;
}

// ---- the calendar --------------------------------------------------------------------------------------------------

/**
 * The Julian date of a calendar date (Meeus ch. 7): the Julian calendar up to
 * 1582 October 4, the Gregorian from October 15. History books and eclipse
 * canons date everything before the reform in the Julian calendar; reading
 * "1066 March 20" as Gregorian put the Bayeux Tapestry's comet six days early.
 * Years are astronomical: 0 is 1 BC, −584 is 585 BC. `day` may carry a fraction.
 */
export function jdFromCalendar(year: number, month: number, day: number): number {
  const gregorian = year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = gregorian ? 2 - A + Math.floor(A / 4) : 0;
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + B - 1524.5;
}

/** The calendar date of a Julian date (Meeus ch. 7), the inverse of jdFromCalendar. */
export function calendarFromJd(jd: number): { year: number; month: number; day: number; hours: number } {
  const z0 = jd + 0.5;
  const Z = Math.floor(z0), F = z0 - Z;
  let A = Z;
  if (Z >= 2299161) {
    const alpha = Math.floor((Z - 1867216.25) / 36524.25);
    A = Z + 1 + alpha - Math.floor(alpha / 4);
  }
  const B = A + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
  const day = B - D - Math.floor(30.6001 * E);
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;
  return { year, month, day, hours: F * 24 };
}

/** A year as people write it: 2061, 79 AD, 585 BC (astronomical year −584). */
export function yearLabel(y: number): string {
  return y <= 0 ? `${1 - y} BC` : y < 1000 ? `${y} AD` : String(y);
}

/** "2061-07-28 03:10", for a Julian date, in the calendar of its day. */
export function calendarString(jd: number): string {
  if (!Number.isFinite(jd) || jd < 0) return "?";
  // Rounded to the minute first, so 23:59.6 becomes the next day's 00:00 rather than "24:00".
  const c = calendarFromJd(Math.round(jd * 1440) / 1440);
  const minutes = Math.round(c.hours * 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${yearLabel(c.year)}-${pad(c.month)}-${pad(c.day)} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "2061-07-28 03:10 UTC", for a Julian date. */
export function dateString(jd: number): string {
  const s = calendarString(jd);
  return s === "?" ? s : `${s} UTC`;
}
