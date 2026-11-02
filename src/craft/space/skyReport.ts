/**
 * The sky in words, for /sky: what is up, what the Moon is doing, what is
 * coming — and the searches behind the command's jumps (the next eclipse seen
 * from here, the next total one anywhere, a shower's next peak).
 *
 * Times are given in local mean time, the clock the world keeps, so what
 * /sky says matches what the player sees. Its noon is the mean Sun's: the real
 * Sun crosses the meridian up to a quarter of an hour either side of it (the
 * equation of time), as it does over any sundial.
 */
import { BODY } from "./bodies";
import { calendarString, dateString, DEG, jdFromCalendar, type Vec3 } from "./kepler";
import { ephemeris } from "./ephemeris";
import {
  DISC_SCALE, eclipseCentre, eclipsesFrom, elongation, localEclipse, nextPhase, SHOWERS, skyAt, solarLongitude, type Eclipse,
} from "./sky";

const POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Which way to face for a direction in the world's axes (x east, y up, z south). */
export function compassPoint(dir: Vec3): string {
  const az = ((Math.atan2(dir[0], -dir[2]) / DEG) % 360 + 360) % 360;
  return POINTS[Math.round(az / 45) % 8];
}

export function altitude(dir: Vec3): number {
  return Math.asin(Math.max(-1, Math.min(1, dir[1]))) / DEG;
}

export function placeText(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

/**
 * A moment as the date and time on a clock keeping local mean time at a
 * longitude, in the calendar of its day: Julian before 1582 October 15,
 * Gregorian after, and years before 1 AD as BC.
 */
export function localClock(jd: number, lon: number): string {
  return calendarString(jd + lon / 360);
}

/** A moment's date at a longitude, without the time. */
export function localDay(jd: number, lon: number): string {
  return localClock(jd, lon).replace(/ \d{2}:\d{2}$/, "");
}

/**
 * The Julian date of a local mean time on a date at a longitude: "2024-04-08",
 * 13.5 hours, −96.8°. Dates before 1582 October 15 are read in the Julian
 * calendar, as history books and eclipse canons write them; years may be
 * astronomical (−584) or written "585 BC".
 */
export function jdOfLocal(date: string, hours: number, lon: number): number | null {
  const m = /^(-?\d{1,6})(\s*BC)?-(\d{1,2})-(\d{1,2})$/i.exec(date.trim());
  if (!m) return null;
  const y = m[2] ? 1 - Number(m[1]) : Number(m[1]), mo = Number(m[3]), d = Number(m[4]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || (m[2] && Number(m[1]) < 1)) return null;
  // October 5–14, 1582 never happened: the reform skipped them.
  if (y === 1582 && mo === 10 && d > 4 && d < 15) return null;
  const jd = jdFromCalendar(y, mo, d);
  // Before the oldest date the calendar arithmetic is defined for (4713 BC), nothing is answered.
  if (!Number.isFinite(jd) || jd < 0) return null;
  return jd + hours / 24 - lon / 360;
}

export function phaseName(elong: number): string {
  const e = ((elong % 360) + 360) % 360;
  if (e < 6 || e >= 354) return "new";
  if (e < 84) return "a waxing crescent";
  if (e < 96) return "at first quarter";
  if (e < 174) return "waxing gibbous";
  if (e < 186) return "full";
  if (e < 264) return "waning gibbous";
  if (e < 276) return "at last quarter";
  return "a waning crescent";
}

function twilight(sunAlt: number): string {
  if (sunAlt > -0.83) return "day";
  if (sunAlt > -6) return "civil twilight";
  if (sunAlt > -12) return "nautical twilight";
  if (sunAlt > -18) return "astronomical twilight";
  return "full dark";
}

const kindText = (e: Eclipse) => `${e.type} ${e.kind}`;

/** The sky over a place at a moment, a line at a time. */
export function describeSky(jd: number, lat: number, lon: number): string[] {
  const sky = skyAt(jd, lat, lon);
  const lines: string[] = [];
  const sunAlt = altitude(sky.sun);
  lines.push(`${localClock(jd, lon)} local mean time at ${placeText(lat, lon)} (${dateString(jd)}) — ${twilight(sunAlt)}.`);
  lines.push(sunAlt > -0.83
    ? `The Sun is ${Math.round(sunAlt)}° up in the ${compassPoint(sky.sun)}${sky.eclipse > 0.01 ? `, ${Math.round(sky.eclipse * 100)}% covered by the Moon` : ""}.`
    : `The Sun is ${Math.round(-sunAlt)}° below the horizon, under the ${compassPoint(sky.sun)}.`);
  const elong = elongation(jd);
  const moonAlt = altitude(sky.moon);
  const full = nextPhase(jd, 180), fresh = nextPhase(jd, 0);
  lines.push(`The Moon is ${phaseName(elong)}, ${Math.round(sky.moonLit * 100)}% lit, ${moonAlt >= 0 ? `${Math.round(moonAlt)}° up in the ${compassPoint(sky.moon)}` : "below the horizon"}${sky.umbra > 0.01 ? `, ${Math.round(sky.umbra * 100)}% in the Earth's shadow` : ""}. Full moon ${localDay(full, lon)}, new moon ${localDay(fresh, lon)}.`);
  const up = sky.planets.filter((p) => altitude(p.dir) > 0 && p.mag < 6).sort((a, b) => a.mag - b.mag);
  lines.push(up.length
    ? `Planets up: ${up.map((p) => `${BODY[p.id]?.name ?? p.id} (magnitude ${p.mag.toFixed(1)}, ${compassPoint(p.dir)})`).join(", ")}.`
    : "No planets are above the horizon.");
  const comets = sky.comets.filter((c) => altitude(c.dir) > 0);
  if (comets.length) lines.push(`Comets: ${comets.map((c) => `${BODY[c.id]?.name ?? c.id} (magnitude ${c.mag.toFixed(1)}, ${compassPoint(c.dir)}, a ${c.tailDeg.toFixed(0)}° tail)`).join(", ")}.`);
  if (sky.showers.length) {
    lines.push(`Meteor showers: ${sky.showers.map((s) => `the ${s.name} (${Math.round(s.zhr)} an hour at best, ${altitude(s.radiant) > 0 ? `${Math.round(s.rate)} now, out of the ${compassPoint(s.radiant)}` : "radiant not yet up"}; ${s.parent})`).join("; ")}.`);
  }
  lines.push(`Next eclipses: ${eclipsesFrom(jd, 3).map((e) => `${localDay(e.jd, lon)} ${kindText(e)}`).join(", ")}.`);
  return lines;
}

export interface SeenEclipse { eclipse: Eclipse; at: number; coverage: number; kind: string }

/**
 * The next eclipse that can be seen from a place: a solar one only where the
 * Moon's shadow falls while the Sun is up, a lunar one wherever the Moon is up
 * while it is in the Earth's shadow. Looks `limit` eclipses ahead.
 */
export function nextSeenEclipse(jd: number, lat: number, lon: number, which: "solar" | "lunar" | null, limit = 40): SeenEclipse | null {
  let t = jd;
  for (let i = 0; i < limit; i++) {
    const [e] = eclipsesFrom(t, 1);
    if (!e) return null;
    t = e.jd + 1;
    if (which && e.kind !== which) continue;
    if (e.kind === "solar") {
      const local = localEclipse(e.jd, lat, lon);
      if (local.coverage < 0.05) continue;
      const sky = skyAt(local.at, lat, lon);
      if (sky.sun[1] <= 0.02) continue;
      const sep = Math.acos(Math.max(-1, Math.min(1, sky.sun[0] * sky.moon[0] + sky.sun[1] * sky.moon[1] + sky.sun[2] * sky.moon[2]))) * DISC_SCALE;
      const kind = local.coverage > 0.999 ? "total solar" : sep <= sky.sunRadius - sky.moonRadius ? "annular solar" : "partial solar";
      return { eclipse: e, at: local.at, coverage: local.coverage, kind };
    }
    // A penumbral eclipse only dulls the Moon a shade — hardly one to go looking for.
    if (e.type === "penumbral") continue;
    // A lunar eclipse's middle is within an hour or so of the full moon; seen if the Moon is up then.
    let best = e.jd, deepest = -1;
    for (let m = -120; m <= 120; m += 10) {
      const s = skyAt(e.jd + m / 1440, lat, lon);
      const depth = s.umbra + (s.shadow.penumbra - s.shadow.offset) * 1e-3;
      if (depth > deepest) { deepest = depth; best = e.jd + m / 1440; }
    }
    const sky = skyAt(best, lat, lon);
    if (sky.moon[1] <= 0.02) continue;
    return { eclipse: e, at: best, coverage: sky.umbra, kind: `${e.type} lunar` };
  }
  return null;
}

/** The next total (or annular) eclipse of the Sun anywhere, and where on the Earth it is greatest. */
export function nextCentralEclipse(jd: number, type: "total" | "annular"): { eclipse: Eclipse; jd: number; lat: number; lon: number } | null {
  let t = jd;
  for (let i = 0; i < 40; i++) {
    const [e] = eclipsesFrom(t, 1);
    if (!e) return null;
    t = e.jd + 1;
    if (e.kind !== "solar" || e.type !== type) continue;
    const c = eclipseCentre(e.jd);
    if (c) return { eclipse: e, ...c };
  }
  return null;
}

/** When a shower next peaks: the first day from `jd` the Sun's longitude passes its peak. */
export function nextShowerPeak(jd: number, name: string): { name: string; jd: number } | null {
  const want = name.trim().toLowerCase();
  const s = SHOWERS.find((x) => x.name.toLowerCase() === want || x.name.toLowerCase().startsWith(want));
  if (!s) return null;
  const lambda = (t: number) => solarLongitude(ephemeris(t).get("earth")!);
  const ahead = (t: number) => ((lambda(t) - s.peak + 540) % 360) - 180;
  let t = jd;
  // Find the day it crosses from before the peak to after it, then close in.
  for (let i = 0; i < 400 && !(ahead(t) < 0 && ahead(t + 1) >= 0); i++) t += 1;
  let lo = t, hi = t + 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ahead(mid) < 0) lo = mid; else hi = mid;
  }
  return { name: s.name, jd: (lo + hi) / 2 };
}

export const SHOWER_NAMES = SHOWERS.map((s) => s.name);
