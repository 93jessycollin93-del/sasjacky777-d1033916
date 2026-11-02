/**
 * The stars both skies draw — the one around the starship and the one over the
 * world — so a constellation seen from a field on Earth is the same pattern the
 * pilot sees out of the cockpit.
 *
 * The real stars come from skyData.ts (the Hipparcos catalogue via d3-celestial,
 * to magnitude 6.5). Beneath them sits a scatter of fainter made-up stars, drawn
 * thickest where the measured Milky Way is brightest, because the naked-eye sky
 * is not 9,000 points on black: it is a haze that the real stars stand out of.
 */
import { MILKY_WAY, STARS } from "./skyData";
import { decodeRuns } from "./textures";
import { Rng } from "../engine/rng";

export interface StarField {
  /** Real catalogue stars come first; the faint filler follows. */
  count: number;
  real: number;
  ra: Float32Array;
  dec: Float32Array;
  mag: Float32Array;
  bv: Float32Array;
}

const FILLER = 14000;
let cached: StarField | null = null;

export function starField(): StarField {
  if (cached) return cached;
  const raw = typeof atob === "function" ? Uint8Array.from(atob(STARS), (c) => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(STARS, "base64"));
  const real = raw.length / 6, count = real + FILLER;
  const ra = new Float32Array(count), dec = new Float32Array(count), mag = new Float32Array(count), bv = new Float32Array(count);
  const dv = new DataView(raw.buffer);
  for (let i = 0; i < real; i++) {
    ra[i] = (dv.getUint16(i * 6, true) / 65535) * 360;
    dec[i] = (dv.getUint16(i * 6 + 2, true) / 65535) * 180 - 90;
    mag[i] = raw[i * 6 + 4] / 30 - 1.5;
    bv[i] = raw[i * 6 + 5] / 100 - 0.4;
  }
  const lv = decodeRuns(MILKY_WAY.width, MILKY_WAY.height, MILKY_WAY.runs);
  const r = new Rng(2718);
  for (let k = real; k < count; k++) {
    let a = 0, d = 0;
    for (let tries = 0; tries < 8; tries++) {
      a = r.next() * 360; d = (Math.asin(r.next() * 2 - 1) * 180) / Math.PI;
      const x = Math.min(MILKY_WAY.width - 1, Math.floor((a / 360) * MILKY_WAY.width));
      const y = Math.min(MILKY_WAY.height - 1, Math.floor(((90 - d) / 180) * MILKY_WAY.height));
      if (r.next() < 0.18 + lv[y * MILKY_WAY.width + x] * 0.2) break;
    }
    ra[k] = a; dec[k] = d; mag[k] = 6 + r.next() * 2.2; bv[k] = r.next() * 1.6 - 0.2;
  }
  cached = { count, real, ra, dec, mag, bv };
  return cached;
}

/** A star's colour from its B−V index: blue-white hot stars through yellow to red. */
export function bvColor(bv: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [[-0.4, [0.62, 0.71, 1]], [0, [0.8, 0.86, 1]], [0.3, [0.95, 0.95, 1]], [0.6, [1, 0.95, 0.86]], [1.0, [1, 0.84, 0.66]], [1.5, [1, 0.72, 0.48]], [2.0, [1, 0.6, 0.38]]];
  if (bv <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (bv <= b) { const t = (bv - a) / (b - a); return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]; }
  }
  return stops[stops.length - 1][1];
}
