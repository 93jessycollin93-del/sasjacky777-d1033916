/**
 * The sky as seen from the ground: where the Sun, the Moon, the planets, the
 * comets and the stars are for someone standing at a latitude and longitude
 * at a moment, and what the sky is doing — the Moon's phase, an eclipse, a
 * meteor shower.
 *
 * Everything comes from the same ephemeris the space view flies through
 * (ephemeris.ts), seen from the observer's own place on the Earth's surface
 * rather than its centre: the Moon is close enough that the difference moves
 * it by up to a degree, which is what decides whether an eclipse is seen from
 * here or only from somewhere else.
 *
 * Directions come out in the voxel world's axes: x east, y up, z south.
 *
 * Time and frames are an astronomer's, because a player can ask for any date:
 * the ephemeris runs on Terrestrial Time (the clock plus ΔT), the Earth turns
 * on apparent sidereal time about the true equator of date (precession and
 * nutation from J2000), the observer stands on the WGS-84 ellipsoid, and the
 * Sun, Moon and planets are seen where their light left them, displaced by the
 * Earth's own motion (light-time and aberration). Leave any of these out and
 * the sky drifts — by a minute of noon today, by hours and by the pole star
 * itself in 3000 BC.
 *
 * The world's clock is a game's (a day in twenty minutes), so the sky keeps a
 * date of its own that advances a real day for every game day: the Moon runs
 * through its phases in twenty-nine and a half game days, the planets creep
 * along the zodiac, and the meteor showers come round on their real dates.
 */
import { BODIES, BODY } from "./bodies";
import { earthAndMoon, ephemeris } from "./ephemeris";
import { cometActivity, tailLength } from "./comets";
import { AU, DAY, DEG, dot, eclToEq, eqToEcl, gast, len, norm, scale, sub, add, trueOfDate, tt, type Mat3, type Vec3 } from "./kepler";

/** The speed of light, km a day, and the light-time across one astronomical unit (days). */
const C_KM_DAY = 299792.458 * DAY;
const LIGHT_AU = AU / C_KM_DAY;
/** WGS-84: the Earth's equatorial radius (km) and flattening. */
export const EARTH_A = 6378.137;
export const EARTH_F = 1 / 298.257223563;

/** A row-major 3×3 matrix (nine numbers) times a frame matrix. */
function withFrame(m: number[], F: Mat3): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(m[r * 3] * F[0][c] + m[r * 3 + 1] * F[1][c] + m[r * 3 + 2] * F[2][c]);
  return out;
}
const transposeTimes = (F: Mat3, v: Vec3): Vec3 => [
  F[0][0] * v[0] + F[1][0] * v[1] + F[2][0] * v[2], F[0][1] * v[0] + F[1][1] * v[1] + F[2][1] * v[2], F[0][2] * v[0] + F[1][2] * v[1] + F[2][2] * v[2],
];
const times = (F: Mat3, v: Vec3): Vec3 => [
  F[0][0] * v[0] + F[0][1] * v[1] + F[0][2] * v[2], F[1][0] * v[0] + F[1][1] * v[1] + F[1][2] * v[2], F[2][0] * v[0] + F[2][1] * v[1] + F[2][2] * v[2],
];

/**
 * A place on the WGS-84 ellipsoid, km from the Earth's centre, in the equator
 * of date, at a geodetic latitude and a local sidereal time (Meeus ch. 11).
 * Geodetic latitude — the one maps give — is not the angle from the centre:
 * they differ by up to 11.5 arcminutes, 21 km on the ground.
 */
export function surfacePoint(latDeg: number, lstDeg: number): Vec3 {
  const phi = latDeg * DEG, L = lstDeg * DEG;
  const u = Math.atan((1 - EARTH_F) * Math.tan(phi));
  const rc = EARTH_A * Math.cos(u), rs = EARTH_A * (1 - EARTH_F) * Math.sin(u);
  return [rc * Math.cos(L), rc * Math.sin(L), rs];
}

/**
 * Where a body is seen from a point: the direction its light arrives from,
 * which left it a light-time ago and is tilted by the observer's own motion.
 * To first order that is the relative position less the relative velocity
 * times the light-time — 20 arcseconds for the Sun, which moves every eclipse
 * by most of a minute.
 */
function apparent(target: Vec3, targetVel: Vec3, from: Vec3, fromVel: Vec3): Vec3 {
  const rel = sub(target, from);
  return sub(rel, scale(sub(targetVel, fromVel), len(rel) / C_KM_DAY));
}

/** How much bigger than life the Sun and Moon are drawn: at their real half a degree they would be a few pixels. */
export const DISC_SCALE = 8;

export interface SkyPlanet { id: string; dir: Vec3; mag: number; color: string }
export interface SkyComet { id: string; dir: Vec3; tail: Vec3; tailDeg: number; mag: number }
export interface Shower { name: string; parent: string; zhr: number; radiant: Vec3; rate: number }

export interface SkyObjects {
  jd: number;
  /** J2000 equatorial to local: nine numbers, row by row. */
  toLocal: number[];
  sun: Vec3;
  moon: Vec3;
  /**
   * Where the Moon is drawn. The discs are drawn DISC_SCALE times their size, so near the Sun its distance from
   * the Sun is stretched by the same factor — drawn overlap is then the real overlap, and an eclipse looks as
   * deep as it is. Away from the Sun the stretch fades to a small, constant nudge.
   */
  moonDrawn: Vec3;
  /** The Moon's lit fraction (0 new, 1 full), and the direction of the Sun seen from it, for shading its disc. */
  moonLit: number;
  /**
   * The Earth's shadow on the Moon, for a lunar eclipse: where the shadow's centre is from the Moon's (in the local
   * frame, as a direction), how far (in Moon radii), and the umbra's and penumbra's radii in Moon radii. The shadow
   * is the same for everyone on the night side, so it is worked out from the Earth's centre.
   */
  shadow: { dir: Vec3; offset: number; umbra: number; penumbra: number };
  /** How much of the Moon's disc is in the umbra (0..1): the red of a total lunar eclipse. */
  umbra: number;
  /** The Moon's north pole (IAU) in the local frame, for turning its face the way it really leans. */
  moonPole: Vec3;
  /** The Sun's and Moon's radii as drawn (radians), and how much of the Sun's disc the Moon covers (0..1). */
  sunRadius: number;
  moonRadius: number;
  eclipse: number;
  planets: SkyPlanet[];
  comets: SkyComet[];
  /** Meteor showers active now, strongest first, with their rates per hour seen from here. */
  showers: Shower[];
}

/** An equatorial direction as seen from a latitude at a local sidereal time: x east, y up, z south. */
export function horizonMatrix(latDeg: number, lstDeg: number): number[] {
  const f = latDeg * DEG, L = lstDeg * DEG;
  const cf = Math.cos(f), sf = Math.sin(f), cL = Math.cos(L), sL = Math.sin(L);
  // p = Rz(−LST)·v gives (cos δ cos H, −cos δ sin H, sin δ); then east = p2, up = sin φ p3 + cos φ p1, north = cos φ p3 − sin φ p1.
  const p1: Vec3 = [cL, sL, 0], p2: Vec3 = [-sL, cL, 0], p3: Vec3 = [0, 0, 1];
  const east = p2;
  const up: Vec3 = [sf * p3[0] + cf * p1[0], sf * p3[1] + cf * p1[1], sf * p3[2] + cf * p1[2]];
  const north: Vec3 = [cf * p3[0] - sf * p1[0], cf * p3[1] - sf * p1[1], cf * p3[2] - sf * p1[2]];
  // Rows: x = east, y = up, z = −north (south).
  return [...east, ...up, -north[0], -north[1], -north[2]];
}

export function applyMatrix(m: number[], v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/**
 * The sky's date for a world's clock: game day `day` is real day `epoch + day`,
 * and the time of day is local solar time — the game's noon (6000) is noon
 * at the world's longitude.
 */
export function skyJd(time: number, epoch: number, lon: number): number {
  const day = Math.floor(time / 24000);
  // Tick 0 is six in the morning; hours past 24 run on into the next date.
  const localHours = ((time % 24000) / 24000) * 24 + 6;
  return epoch + day + (localHours - lon / 15) / 24;
}

/**
 * The world's clock and epoch that put the sky at a moment (a Julian date) over a longitude, keeping the world's
 * count of days: the time of day becomes that local solar time, and the epoch moves so the day is that date.
 */
export function clockFor(jd: number, lon: number, time: number): { time: number; epoch: number } {
  const x = jd + lon / 360 - 0.25;
  const frac = (((x - 0.5) % 1) + 1) % 1;
  const day = Math.floor(time / 24000);
  return { time: day * 24000 + Math.round(frac * 24000), epoch: x - frac - day };
}

/** An epoch that makes today's game day today's real date. */
export function epochForToday(time: number, nowJd: number): number {
  const midnight = Math.floor(nowJd - 0.5) + 0.5;
  return midnight - Math.floor(time / 24000);
}

/** The meteor showers of the year (International Meteor Organization): their peak by the Sun's longitude, their rate, their radiant, their parent. */
export const SHOWERS: { name: string; parent: string; peak: number; zhr: number; ra: number; dec: number; days: number }[] = [
  { name: "Quadrantids", parent: "asteroid 2003 EH1", peak: 283.15, zhr: 110, ra: 230, dec: 49, days: 0.6 },
  { name: "Lyrids", parent: "comet Thatcher", peak: 32.32, zhr: 18, ra: 271, dec: 34, days: 1.3 },
  { name: "Eta Aquariids", parent: "Halley's Comet", peak: 45.5, zhr: 50, ra: 338, dec: -1, days: 5 },
  { name: "Southern Delta Aquariids", parent: "comet 96P/Machholz", peak: 125, zhr: 25, ra: 340, dec: -16, days: 5 },
  { name: "Perseids", parent: "comet Swift–Tuttle", peak: 140.0, zhr: 100, ra: 48, dec: 58, days: 2.5 },
  { name: "Draconids", parent: "comet Giacobini–Zinner", peak: 195.4, zhr: 10, ra: 262, dec: 54, days: 0.6 },
  { name: "Southern Taurids", parent: "Comet Encke", peak: 197, zhr: 5, ra: 32, dec: 9, days: 20 },
  { name: "Orionids", parent: "Halley's Comet", peak: 208, zhr: 20, ra: 95, dec: 16, days: 4 },
  { name: "Northern Taurids", parent: "Comet Encke", peak: 230, zhr: 5, ra: 58, dec: 22, days: 20 },
  { name: "Leonids", parent: "comet Tempel–Tuttle", peak: 235.27, zhr: 15, ra: 152, dec: 22, days: 1 },
  { name: "Geminids", parent: "asteroid Phaethon", peak: 262.2, zhr: 150, ra: 112, dec: 33, days: 1.5 },
  { name: "Ursids", parent: "comet 8P/Tuttle", peak: 270.7, zhr: 10, ra: 217, dec: 76, days: 0.6 },
];

/** The Sun's ecliptic longitude seen from the Earth (degrees): the date of the year as the sky counts it. */
export function solarLongitude(earthHelio: Vec3): number {
  return ((Math.atan2(-earthHelio[1], -earthHelio[0]) / DEG) % 360 + 360) % 360;
}

/** Each shower's zenithal hourly rate at a solar longitude, falling away either side of its peak. */
export function showerRates(lambda: number): { name: string; parent: string; zhr: number; ra: number; dec: number }[] {
  const out: { name: string; parent: string; zhr: number; ra: number; dec: number }[] = [];
  for (const s of SHOWERS) {
    const d = ((lambda - s.peak + 540) % 360) - 180;
    const width = s.days * 0.9856;
    const zhr = s.zhr * Math.exp(-((d / width) ** 2));
    if (zhr >= 1) out.push({ name: s.name, parent: s.parent, zhr, ra: s.ra, dec: s.dec });
  }
  return out.sort((a, b) => b.zhr - a.zhr);
}

/** Planets' absolute magnitudes, for how bright they look: V(1,0) from the Astronomical Almanac, rounded. */
const PLANET_MAG: Record<string, [number, string]> = {
  mercury: [-0.613, "#e8dcc8"], venus: [-4.384, "#fffbe8"], mars: [-1.5, "#ff9a6a"], jupiter: [-9.4, "#fff2d8"], saturn: [-8.9, "#ffe6b0"], uranus: [-7.2, "#c8f0f4"], neptune: [-6.9, "#a8c0ff"],
};
/**
 * How much fainter a planet is at a phase angle than full, in magnitudes: Mallama and Hilton's (2018) fits for
 * Mercury and Venus, whose crescents are the ones we see, and a straight line for the rest (which only show us
 * a nearly full face).
 */
function phaseLaw(id: string, a: number): number {
  if (id === "mercury") return 6.328e-2 * a - 1.6336e-3 * a ** 2 + 3.3644e-5 * a ** 3 - 3.4265e-7 * a ** 4 + 1.6893e-9 * a ** 5 - 3.0334e-12 * a ** 6;
  if (id === "venus") return a < 163.7 ? -1.044e-3 * a + 3.687e-4 * a ** 2 - 2.814e-6 * a ** 3 + 8.938e-9 * a ** 4 : 236.05828 - 2.81914 * a + 8.39034e-3 * a ** 2 + 4.384;
  return 0.015 * a;
}

/** Comets' absolute magnitudes (the brightness at 1 AU from both Sun and Earth), for the ones that get bright. */
const COMET_MAG: Record<string, number> = { halley: 5.5, encke: 11.5, swifttuttle: 4, tempeltuttle: 9, halebopp: -0.8, hyakutake: 7.3, mcnaught: 5.4, neowise: 6.8, cg67p: 11, borisov: 13 };

/** The area of the smaller of two overlapping discs covered by the larger, as a fraction of the first disc. */
export function discOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return (a + b - c) / (Math.PI * r1 * r1);
}

/**
 * How much daylight is left while the Moon covers a share of the Sun. The eye
 * forgives a partial eclipse — at nine-tenths covered the day only looks
 * overcast — and then the last sliver goes and it is suddenly dusk all round:
 * the last one per cent of the Sun still outshines everything else in the sky
 * ten thousand times over.
 */
export function eclipseLight(coverage: number): number {
  const t = Math.max(0, Math.min(1, (coverage - 0.98) / 0.02));
  return 1 - 0.55 * coverage ** 4 - 0.33 * t * t * (3 - 2 * t);
}

/** The sky at a Julian date (UT) over a latitude and longitude. */
export function skyAt(jd: number, lat: number, lon: number): SkyObjects {
  const jdTT = tt(jd);
  const e = ephemeris(jdTT);
  // The same a light-time across an AU earlier: velocities for light-time and aberration, by difference.
  const lag = ephemeris(jdTT - LIGHT_AU);
  const vel = (id: string): Vec3 => {
    const a = e.get(id), b = lag.get(id);
    return a && b ? scale(sub(a, b), 1 / LIGHT_AU) : [0, 0, 0];
  };
  const earth = e.get("earth")!, vEarth = vel("earth");
  const NP = trueOfDate(jdTT);
  const lst = gast(jd) + lon;
  // J2000 equatorial straight to the horizon: precession and nutation, then the Earth's turn.
  const m = withFrame(horizonMatrix(lat, lst), NP);
  // The observer, on the ellipsoid, carried from the equator of date back to the J2000 ecliptic.
  const here = add(earth, eqToEcl(transposeTimes(NP, surfacePoint(lat, lst))));
  const see = (target: Vec3, id: string | null): Vec3 => apparent(target, id ? vel(id) : [0, 0, 0], here, vEarth);
  const toLocal = (rel: Vec3): Vec3 => applyMatrix(m, norm(eclToEq(rel)));

  const sunRel = see([0, 0, 0], null), moonRel = see(e.get("moon")!, "moon");
  const sun = toLocal(sunRel), moon = toLocal(moonRel);
  const sunRadius = Math.asin(BODY.sun.radius / len(sunRel)) * DISC_SCALE;
  const moonRadius = Math.asin(BODY.moon.radius / len(moonRel)) * DISC_SCALE;
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(norm(sunRel), norm(moonRel)))));
  // The Moon's lit fraction from the Sun–Moon angle seen from here (its elongation).
  const moonLit = (1 - Math.cos(sep)) / 2;
  const eclipse = discOverlap(sunRadius, moonRadius, sep * DISC_SCALE);
  // Stretched near the Sun, where it decides how an eclipse looks; faded back to the true place by ten degrees out,
  // so the Moon stands among the right stars. The fade is slow enough that the drawn distance still only grows.
  const theta0 = 0.8 * DEG, theta1 = 4 * DEG;
  const drawnSep = sep + (DISC_SCALE - 1) * theta0 * Math.tanh(sep / theta0) * Math.exp(-sep / theta1);
  // Turn the Sun's direction toward the Moon's, through the drawn separation.
  const toward = norm(sub(moon, scale(sun, dot(moon, sun))));
  const moonDrawn = sep < 1e-9 ? moon : norm(add(scale(sun, Math.cos(drawnSep)), scale(toward, Math.sin(drawnSep))));

  // The Earth's shadow where the Moon is, with the 2% its air adds (Danjon), seen from the Earth's centre.
  // The shadow points away from where the Sun is seen, not where it geometrically is.
  const RE = EARTH_A, geo = sub(e.get("moon")!, earth), dist = len(geo), toMoon = norm(geo);
  const axis = norm(scale(apparent([0, 0, 0], [0, 0, 0], earth, vEarth), -1));
  const pm = Math.asin(RE / dist), sunR = Math.asin(BODY.sun.radius / len(earth)), ps = Math.asin(RE / len(earth));
  const moonR = Math.asin(BODY.moon.radius / dist);
  const off = Math.acos(Math.max(-1, Math.min(1, dot(toMoon, axis))));
  const shadowLocal = applyMatrix(m, eclToEq(axis)), moonLocal = applyMatrix(m, eclToEq(toMoon));
  const shadow = {
    dir: norm(sub(shadowLocal, scale(moonLocal, dot(shadowLocal, moonLocal)))),
    offset: off / moonR, umbra: (1.02 * (pm - sunR + ps)) / moonR, penumbra: (1.02 * (pm + sunR + ps)) / moonR,
  };
  const umbra = discOverlap(1, shadow.umbra, shadow.offset);
  const [pra, pdec] = BODY.moon.pole!;
  const moonPole = applyMatrix(m, [Math.cos(pdec * DEG) * Math.cos(pra * DEG), Math.cos(pdec * DEG) * Math.sin(pra * DEG), Math.sin(pdec * DEG)]);

  const planets: SkyPlanet[] = [];
  for (const [id, [v0, color]] of Object.entries(PLANET_MAG)) {
    const p = e.get(id);
    if (!p) continue;
    const r = len(p) / AU, delta = len(sub(p, here)) / AU;
    const phase = Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(here, p)), norm(sub([0, 0, 0], p)))))) / DEG;
    planets.push({ id, dir: toLocal(see(p, id)), mag: v0 + 5 * Math.log10(r * delta) + phaseLaw(id, phase), color });
  }
  const comets: SkyComet[] = [];
  for (const b of BODIES) {
    if ((b.kind !== "comet" && b.kind !== "interstellar") || COMET_MAG[b.id] === undefined) continue;
    const p = e.get(b.id);
    if (!p) continue;
    const r = len(p) / AU, delta = len(sub(p, here)) / AU;
    const mag = COMET_MAG[b.id] + 5 * Math.log10(delta) + 10 * Math.log10(r);
    if (mag > 6.5 || cometActivity(b, p) <= 0) continue;
    const L = tailLength(b, p);
    const end = add(p, scale(norm(p), L));
    const a = toLocal(see(p, b.id)), z = toLocal(sub(end, here));
    const tailDeg = Math.acos(Math.max(-1, Math.min(1, dot(a, z)))) / DEG;
    comets.push({ id: b.id, dir: a, tail: norm(sub(z, a)), tailDeg, mag });
  }
  const showers: Shower[] = [];
  for (const sh of showerRates(solarLongitude(earth))) {
    const radiant = applyMatrix(m, [Math.cos(sh.dec * DEG) * Math.cos(sh.ra * DEG), Math.cos(sh.dec * DEG) * Math.sin(sh.ra * DEG), Math.sin(sh.dec * DEG)]);
    showers.push({ name: sh.name, parent: sh.parent, zhr: sh.zhr, radiant, rate: sh.zhr * Math.max(0, radiant[1]) });
  }
  return { jd, toLocal: m, sun, moon, moonDrawn, moonLit, shadow, umbra, moonPole, sunRadius, moonRadius, eclipse, planets, comets, showers };
}

// ---- the calendar ----------------------------------------------------------------------------------------------

/**
 * The Earth and Moon at a UT date, the Moon as seen from the Earth's centre
 * (light-time) and the Sun as seen from it (aberration): what decides the
 * moment of a new moon or an eclipse.
 */
function apparentEarthMoon(jd: number): { earth: Vec3; moon: Vec3; sunFromEarth: Vec3; moonFromEarth: Vec3; vMoon: Vec3 } {
  const t = tt(jd), h = 1 / 1440;
  const now = earthAndMoon(t), before = earthAndMoon(t - h);
  const vEarth = scale(sub(now.earth, before.earth), 1 / h), vMoon = scale(sub(now.moon, before.moon), 1 / h);
  return {
    earth: now.earth,
    moon: now.moon,
    vMoon,
    sunFromEarth: apparent([0, 0, 0], [0, 0, 0], now.earth, vEarth),
    moonFromEarth: apparent(now.moon, vMoon, now.earth, vEarth),
  };
}

/** The Moon's elongation from the Sun seen from the Earth's centre, signed: waxing positive, 0 at new moon, 180 at full. */
export function elongation(jd: number): number {
  const { sunFromEarth, moonFromEarth } = apparentEarthMoon(jd);
  const lon = (v: Vec3) => Math.atan2(v[1], v[0]) / DEG;
  return ((lon(moonFromEarth) - lon(sunFromEarth)) % 360 + 360) % 360;
}

/** The next moment after `jd` the Moon reaches a phase (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function nextPhase(jd: number, phase: number): number {
  const synodic = 29.530589;
  const now = elongation(jd);
  let t = jd + (((phase - now + 360) % 360) / 360) * synodic;
  // Newton on the elongation, which runs at about 12.2° a day.
  for (let i = 0; i < 12; i++) {
    const d = ((elongation(t) - phase + 540) % 360) - 180;
    t -= d / 12.19;
    if (Math.abs(d) < 1e-4) break;
  }
  return t <= jd ? nextPhase(jd + 1, phase) : t;
}

export interface Eclipse { jd: number; kind: "solar" | "lunar"; type: "total" | "annular" | "partial" | "penumbral"; }

/**
 * Eclipses from a date on. At each new and full moon: γ, how far (in Earth
 * radii) the line from the Sun through the Earth passes from the Moon's
 * centre, against the sizes of the shadows where the Moon is — the Earth's
 * umbra and penumbra (enlarged by 2% for its air, as Danjon found) for a lunar
 * eclipse; the Earth itself for a solar one, total or annular by whether the
 * Moon looks bigger than the Sun.
 */
export function eclipsesFrom(jd: number, count: number): Eclipse[] {
  const out: Eclipse[] = [];
  const RE = 6378.137, k = BODY.moon.radius / RE;
  let t = jd;
  for (let guard = 0; out.length < count && guard < 200; guard++) {
    const nm = nextPhase(t, 0), fm = nextPhase(t, 180);
    const next = Math.min(nm, fm);
    const kind = next === nm ? "solar" : "lunar";
    const em = earthAndMoon(tt(next));
    const earth = em.earth, moon = sub(em.moon, earth);
    const dist = len(moon);
    const gamma = Math.abs(moon[2]) / RE;
    if (kind === "solar") {
      if (gamma < 1.0 + k * 2) {
        const bigger = Math.asin(BODY.moon.radius / (dist - RE)) > Math.asin(BODY.sun.radius / len(earth));
        out.push({ jd: next, kind, type: gamma < 0.997 ? (bigger ? "total" : "annular") : "partial" });
      }
    } else {
      const pm = Math.asin(RE / dist), sunR = Math.asin(BODY.sun.radius / len(earth)), ps = Math.asin(RE / len(earth));
      const umbra = (1.02 * (pm - sunR + ps)) / pm, penumbra = (1.02 * (pm + sunR + ps)) / pm;
      if (gamma < penumbra + k) out.push({ jd: next, kind, type: gamma < umbra - k ? "total" : gamma < umbra + k ? "partial" : "penumbral" });
    }
    t = next + 1;
  }
  return out;
}

/**
 * How much of the Sun an eclipse covers at its deepest from a place: the sky
 * worked out every few minutes either side of the new moon.
 */
export function localEclipse(jd: number, lat: number, lon: number): { coverage: number; at: number } {
  let best = { coverage: 0, at: jd };
  for (let m = -240; m <= 240; m += 6) {
    const t = jd + m / 1440;
    const c = skyAt(t, lat, lon).eclipse;
    if (c > best.coverage) best = { coverage: c, at: t };
  }
  return best;
}
/**
 * Where on the Earth a solar eclipse is greatest: the moment near a new moon
 * when the shadow's axis — from the Sun through the Moon as it was a
 * light-time ago — passes closest to the Earth's centre, and the point where
 * that axis meets the WGS-84 ellipsoid, as a geodetic latitude and a longitude
 * reckoned from apparent sidereal time. Null if the axis misses the Earth (a
 * partial eclipse has no centre on the ground).
 */
export function eclipseCentre(jd: number): { jd: number; lat: number; lon: number } | null {
  const miss = (t: number) => {
    const { earth, moon, vMoon } = apparentEarthMoon(t);
    // The shadow that reaches the ground left the Moon about 1.3 s earlier.
    const moonThen = sub(moon, scale(vMoon, len(sub(moon, earth)) / C_KM_DAY));
    const u = norm(moonThen);
    const along = dot(sub(earth, moonThen), u);
    return { d: len(sub(sub(earth, moonThen), scale(u, along))), earth, moonThen, u };
  };
  let best = jd, bestD = Infinity;
  for (let m = -360; m <= 360; m += 4) {
    const d = miss(jd + m / 1440).d;
    if (d < bestD) { bestD = d; best = jd + m / 1440; }
  }
  // The miss distance has one minimum near there: close in on it by thirds.
  let lo = best - 4 / 1440, hi = best + 4 / 1440;
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (miss(a).d < miss(b).d) hi = b; else lo = a;
  }
  best = (lo + hi) / 2;
  const { earth, moonThen, u } = miss(best);
  // In the equator of date, with the polar axis stretched so the ellipsoid becomes a sphere of radius a.
  const NP = trueOfDate(tt(best));
  const k = 1 / (1 - EARTH_F);
  const p0 = times(NP, eclToEq(sub(moonThen, earth))), dir = times(NP, eclToEq(u));
  const P: Vec3 = [p0[0], p0[1], p0[2] * k], D: Vec3 = [dir[0], dir[1], dir[2] * k];
  const A = dot(D, D), B = 2 * dot(P, D), C = dot(P, P) - EARTH_A * EARTH_A;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  const g = add(p0, scale(dir, s));
  const e2 = EARTH_F * (2 - EARTH_F);
  const lat = Math.atan2(g[2], (1 - e2) * Math.hypot(g[0], g[1])) / DEG;
  const lon = ((((Math.atan2(g[1], g[0]) / DEG - gast(best)) % 360) + 540) % 360) - 180;
  return { jd: best, lat, lon };
}
