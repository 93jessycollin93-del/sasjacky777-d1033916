/**
 * The worlds' faces, painted by code: one equirectangular map a body
 * (longitude across, latitude down), made the first time the body comes close
 * enough to need one.
 *
 * Where the real world is known and small enough to carry, it is used: the
 * Earth's continents are Natural Earth's coastlines (skyData.ts), coloured by
 * climate. Elsewhere the famous features are placed where they really are —
 * the Moon's seas and Tycho's rays, Mars's dark Syrtis Major and bright Hellas
 * and its caps, Jupiter's belts and Great Red Spot, Saturn's hexagon, Pluto's
 * heart, Iapetus's two faces — and noise and craters fill in the rest. Nothing
 * is a photograph; the look is this game's own.
 */
import { Simplex } from "../engine/noise";
import { Rng } from "../engine/rng";
import { EARTH_LAND, MILKY_WAY } from "./skyData";
import { dot, raDecToEcl } from "./kepler";
import type { BodyDef, Look } from "./bodies";

type RGB = [number, number, number];

/** A map run-length coded as (value, length) varints: skyData.ts's format. */
export function decodeRuns(width: number, height: number, runs: string): Uint8Array {
  const bytes = typeof atob === "function" ? Uint8Array.from(atob(runs), (c) => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(runs, "base64"));
  const out = new Uint8Array(width * height);
  let i = 0, o = 0;
  const varint = () => { let n = 0, sh = 0; for (;;) { const c = bytes[i++]; n |= (c & 127) << sh; sh += 7; if (c < 128) return n >>> 0; } };
  while (i < bytes.length && o < out.length) {
    const v = varint(), n = varint();
    out.fill(v, o, Math.min(out.length, o + n));
    o += n;
  }
  return out;
}

let earthLand: Uint8Array | null = null;
/** Land (1) or sea (0) at a latitude and longitude, from Natural Earth. */
export function isLand(lat: number, lon: number): number {
  earthLand ??= decodeRuns(EARTH_LAND.width, EARTH_LAND.height, EARTH_LAND.runs);
  const x = Math.min(EARTH_LAND.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * EARTH_LAND.width)));
  const y = Math.min(EARTH_LAND.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * EARTH_LAND.height)));
  return earthLand[y * EARTH_LAND.width + x];
}

/** How much of the neighbourhood is land, read between the map's cells: coasts come out curved, not stepped. */
export function landShare(lat: number, lon: number): number {
  earthLand ??= decodeRuns(EARTH_LAND.width, EARTH_LAND.height, EARTH_LAND.runs);
  const W = EARTH_LAND.width, H = EARTH_LAND.height;
  const fx = ((lon + 180) / 360) * W - 0.5, fy = ((90 - lat) / 180) * H - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const at = (x: number, y: number) => earthLand![Math.max(0, Math.min(H - 1, y)) * W + (((x % W) + W) % W)];
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
}

const mix = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Great-circle distance in degrees between two latitude/longitude points. */
function arc(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const c = Math.sin(lat1 * r) * Math.sin(lat2 * r) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon1 - lon2) * r);
  return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

/** A named patch of a world: where it is, how big (degrees), and how dark or bright (negative darkens). */
type Patch = [lat: number, lon: number, radius: number, strength: number];

/** The patches' combined effect at a point, soft-edged and ragged with noise. */
function patches(list: Patch[], lat: number, lon: number, wobble: number): number {
  let v = 0;
  for (const [pl, pn, pr, ps] of list) {
    const d = arc(lat, lon, pl, pn);
    if (d > pr * 1.6) continue;
    v += ps * (1 - smooth(pr * 0.55, pr * (1.15 + wobble * 0.35), d));
  }
  return v;
}

interface Painter {
  size: [number, number];
  pixel(lat: number, lon: number, x: number, y: number, z: number, n: Simplex): RGB;
  craters?: { count: number; depth: number; seed: number; maxSize?: number };
}

const DESERTS: Patch[] = [
  [23, 0, 14, 1], [22, 18, 12, 1], [24, 30, 8, 0.9], [22, 47, 10, 1], [28, 60, 8, 0.8], [27, 71, 5, 0.8], [42, 62, 9, 0.7], [43, 103, 10, 0.8],
  [38, 85, 6, 0.8], [-25, 130, 13, 1], [-23, 20, 7, 0.8], [-22, -69, 5, 0.8], [33, -112, 7, 0.8], [-44, -68, 5, 0.5], [16, 43, 5, 0.6],
];

// The Moon's seas and its brightest young craters, at their real selenographic positions.
const MARIA: Patch[] = [
  [18, -57, 30, -1], [32.8, -15.6, 17, -1], [28, 17.5, 10, -1], [8.5, 31.4, 12, -1], [17, 59.1, 8, -1], [-7.8, 51.3, 11, -0.9],
  [-15.2, 35.5, 6, -0.9], [-21.3, -16.6, 11, -0.8], [-24.4, -38.6, 6, -0.9], [56, 1.4, 6, -0.7], [58, -30, 6, -0.6], [58, 30, 5, -0.6],
  [13.3, 3.6, 4, -0.8], [7.5, -30.9, 8, -0.8], [-10, -22, 6, -0.7], [-19.4, -92.8, 5, -0.6], [27.3, 147.9, 3, -0.6], [-2, -5, 4, -0.5],
];
const MARS_DARK: Patch[] = [
  [8.4, 69.5, 13, -1], [46.7, -22, 14, -0.8], [-25, -40, 20, -0.8], [-5, 0, 12, -0.9], [-20, 30, 16, -0.7], [-30, 100, 18, -0.6],
  [-15, 150, 14, -0.5], [20, 140, 10, -0.4], [-10, -80, 8, -0.5], [55, 90, 18, -0.45],
];
const MARS_BRIGHT: Patch[] = [[-42.4, 70.5, 19, 1], [-49.7, -43.4, 9, 0.7], [20, -110, 22, 0.35], [45, 120, 16, 0.3]];
const PLUTO: Patch[] = [[20, 180, 16, 1], [30, 162, 12, 1], [5, 172, 11, 1], [-10, 90, 25, -1], [-12, 40, 18, -1], [-8, 130, 18, -0.9]];

const PAINTERS: Partial<Record<Look, Painter>> = {
  sun: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) {
      // Granulation: cells of rising gas a thousand kilometres across, and a few darker spots near the equator.
      const g = n.noise3(x * 60, y * 60, z * 60) * 0.5 + n.fbm3(x * 14, y * 14, z * 14, 3) * 0.5;
      let c = mix([255, 196, 110], [255, 236, 190], 0.55 + g * 0.5);
      // Sunspots: a few, small, in the two belts either side of the equator where they appear.
      const region = n.noise3(x * 2.5 + 7, y * 2.5, z * 2.5);
      const spot = n.noise3(x * 16 + 3, y * 16, z * 16);
      if (Math.abs(lat) > 8 && Math.abs(lat) < 30 && region > 0.35 && spot > 0.7) c = mix(c, [70, 30, 8], Math.min(1, (spot - 0.7) * 7));
      return c;
    },
  },
  earth: {
    size: [1024, 512],
    pixel(lat, lon, x, y, z, n) {
      const land = landShare(lat, lon) + n.noise3(x * 40, y * 40, z * 40) * 0.18 > 0.5 ? 1 : 0;
      const a = Math.abs(lat);
      if (!land) {
        // Shallow seas near coasts are lighter; polar seas freeze.
        const shelf = isLand(lat + 1.2, lon) + isLand(lat - 1.2, lon) + isLand(lat, lon + 1.5) + isLand(lat, lon - 1.5);
        let c = mix([12, 34, 82], [26, 70, 128], shelf / 4 + n.noise3(x * 6, y * 6, z * 6) * 0.08);
        if (a > 72 + n.noise3(x * 4, y * 4, z * 4) * 6) c = mix(c, [226, 234, 242], 0.85);
        return c;
      }
      const detail = n.fbm3(x * 9, y * 9, z * 9, 4);
      // Ice sheets: Antarctica and Greenland, and the far north.
      if (lat < -62 || (lat > 60 && lon > -73 && lon < -12) || a > 78) return mix([232, 238, 244], [210, 220, 232], detail * 0.5 + 0.5);
      // The great deserts where they are — the Sahara, Arabia, the Thar, the Gobi, the Australian interior, the
      // Kalahari, the Atacama, the American south-west — the rainforest across the equator, taiga and tundra north.
      const dry = Math.min(1, patches(DESERTS, lat, lon, n.noise3(x * 6, y * 6, z * 6)) * (0.8 + detail * 0.4));
      const green = mix([46, 96, 38], [26, 70, 30], smooth(-8, 8, lat) * (1 - smooth(8, 16, a)) * 0.9);
      let c = mix(green, [196, 164, 110], Math.min(1, dry));
      if (lat > 50) c = mix(c, [44, 66, 46], smooth(50, 58, lat) * (1 - smooth(64, 70, lat)));
      if (lat > 64) c = mix(c, [120, 116, 96], smooth(64, 72, lat));
      if (lat < -40) c = mix(c, [110, 120, 90], 0.4);
      return mix(c, [150, 130, 100], Math.max(0, n.fbm3(x * 20, y * 20, z * 20, 3)) * 0.35);
    },
  },
  moon: {
    size: [1024, 512], craters: { count: 900, depth: 0.25, seed: 7, maxSize: 7 },
    pixel(lat, lon, x, y, z, n) {
      const wob = n.noise3(x * 5, y * 5, z * 5);
      const mare = Math.min(1, -patches(MARIA, lat, lon, wob));
      const base = 150 + n.fbm3(x * 8, y * 8, z * 8, 5) * 32;
      let v = base - mare * 70;
      // Tycho and Copernicus, bright and rayed.
      for (const [cl, cn, len] of [[-43.3, -11.2, 45], [9.6, -20.1, 18], [8.1, -38, 12]] as const) {
        const d = arc(lat, lon, cl, cn);
        if (d < 1.2) v += 60 * (1 - d / 1.2);
        if (d < len) {
          const ang = Math.atan2(lat - cl, lon - cn);
          const ray = Math.pow(Math.max(0, Math.sin(ang * 13 + cl) * Math.sin(ang * 7.3)), 6);
          v += ray * 45 * (1 - d / len);
        }
      }
      return [v * 1.0, v * 0.985, v * 0.955];
    },
  },
  mercury: {
    size: [512, 256], craters: { count: 700, depth: 0.3, seed: 3 },
    pixel(lat, lon, x, y, z, n) { const v = 120 + n.fbm3(x * 7, y * 7, z * 7, 5) * 40; return [v * 1.02, v * 0.97, v * 0.9]; },
  },
  venus: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) {
      // Clouds drawn out along the latitude lines by the super-rotating winds, in a sideways Y.
      const w = n.fbm3(x * 2, y * 2, z * 9, 5);
      const chevron = Math.sin((Math.abs(lat) * 0.06 + lon / 60) * Math.PI) * 0.15;
      return mix([216, 196, 140], [244, 230, 190], 0.55 + w * 0.5 + chevron);
    },
  },
  mars: {
    size: [1024, 512], craters: { count: 400, depth: 0.12, seed: 11 },
    pixel(lat, lon, x, y, z, n) {
      const wob = n.noise3(x * 4, y * 4, z * 4);
      const dark = -patches(MARS_DARK, lat, lon, wob), bright = patches(MARS_BRIGHT, lat, lon, wob);
      let c = mix([188, 92, 48], [206, 128, 80], 0.5 + n.fbm3(x * 6, y * 6, z * 6, 5) * 0.6);
      c = mix(c, [96, 56, 40], Math.min(1, dark) * 0.75);
      c = mix(c, [226, 170, 120], Math.min(1, bright) * 0.6);
      // Olympus Mons and the Valles Marineris.
      if (arc(lat, lon, 18.65, -133.8) < 4) c = mix(c, [150, 90, 60], 1 - arc(lat, lon, 18.65, -133.8) / 4);
      if (lat > -18 && lat < -6 && lon > -95 && lon < -40) c = mix(c, [90, 50, 38], (1 - Math.abs(lat + 12 + Math.sin(lon / 8) * 1.5) / 3) * 0.8);
      // The caps: the north's bigger than the south's, both ragged.
      if (lat > 76 + wob * 5 || lat < -82 + wob * 4) c = mix(c, [240, 238, 236], 0.92);
      return c;
    },
  },
  jupiter: {
    size: [1024, 512],
    pixel(lat, lon, x, y, z, n) {
      // Zones and belts in their real latitudes, with turbulence along their edges.
      const warp = n.fbm3(x * 3, y * 3, z * 14, 4) * 3.5;
      const b = lat + warp;
      const bands: [number, RGB][] = [[-90, [150, 140, 128]], [-45, [170, 150, 126]], [-32, [214, 200, 176]], [-26, [176, 132, 98]], [-19, [236, 222, 196]],
        [-8, [160, 108, 76]], [-5, [240, 230, 206]], [7, [236, 226, 204]], [10, [150, 100, 72]], [18, [230, 214, 186]], [24, [178, 136, 104]],
        [31, [220, 206, 182]], [40, [180, 160, 136]], [90, [150, 140, 128]]];
      let c: RGB = bands[0][1];
      for (let i = 0; i < bands.length - 1; i++) if (b >= bands[i][0] && b < bands[i + 1][0]) c = mix(bands[i][1], bands[i + 1][1], smooth(bands[i + 1][0] - 2.5, bands[i + 1][0], b));
      c = mix(c, [255, 250, 240], n.fbm3(x * 12, y * 12, z * 40, 3) * 0.15);
      // The Great Red Spot, 22° south; white ovals below it.
      const dl = (lat + 22.5) / 5.5, dn = (((lon - 60 + 540) % 360) - 180) / 11;
      const spot = dl * dl + dn * dn;
      if (spot < 1.4) c = mix(c, spot < 1 ? [196, 96, 64] : [236, 214, 190], spot < 1 ? 1 - spot * 0.4 : 0.6);
      for (const ol of [-60, 20, 140]) { const e = ((lat + 33) / 1.6) ** 2 + ((((lon - ol + 540) % 360) - 180) / 3) ** 2; if (e < 1) c = mix(c, [248, 244, 236], 1 - e); }
      return c;
    },
  },
  saturn: {
    size: [1024, 512],
    pixel(lat, lon, x, y, z, n) {
      const b = lat + n.fbm3(x * 3, y * 3, z * 16, 3) * 1.8;
      let c = mix([214, 190, 140], [236, 220, 176], 0.5 + Math.sin(b * 0.42) * 0.3 + Math.sin(b * 1.3) * 0.12);
      if (Math.abs(b) < 12) c = mix(c, [240, 226, 188], 0.5);
      if (lat > 60) c = mix(c, [150, 160, 170], smooth(60, 80, lat) * 0.6);
      // The north polar hexagon, a jet stream with six sides.
      const hexR = 78 + Math.cos((Math.atan2(y, x) * 6)) * 1.2;
      if (lat > 74) c = mix(c, [130, 150, 150], (1 - Math.abs(lat - hexR) / 1.5) > 0 ? 0.5 : 0);
      return c;
    },
  },
  uranus: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) { return mix([160, 214, 222], [196, 236, 238], 0.5 + Math.sin(lat * 0.2) * 0.12 + n.fbm3(x * 2, y * 2, z * 10, 3) * 0.06 + (lat < -60 ? 0.2 : 0)); },
  },
  neptune: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) {
      let c = mix([48, 86, 200], [80, 124, 230], 0.5 + Math.sin(lat * 0.25) * 0.2 + n.fbm3(x * 3, y * 3, z * 12, 4) * 0.2);
      const spot = ((lat + 20) / 6) ** 2 + ((((lon - 40 + 540) % 360) - 180) / 12) ** 2;
      if (spot < 1) c = mix(c, [24, 44, 120], 1 - spot);
      if (Math.abs(lat + 30) < 1.5 && n.noise3(x * 8, y * 8, z * 8) > 0.2) c = mix(c, [230, 240, 255], 0.8);
      return c;
    },
  },
  io: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) {
      const f = n.fbm3(x * 5, y * 5, z * 5, 5);
      let c = mix([224, 196, 72], [236, 224, 150], f + 0.5);
      if (f > 0.25) c = mix(c, [200, 110, 40], (f - 0.25) * 3);
      const spots = n.noise3(x * 22, y * 22, z * 22);
      if (spots > 0.62) c = mix(c, [40, 26, 20], (spots - 0.62) * 5);
      if (Math.abs(lat) > 60) c = mix(c, [170, 130, 90], 0.4);
      return c;
    },
  },
  europa: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) {
      let c = mix([226, 214, 196], [244, 238, 228], n.fbm3(x * 5, y * 5, z * 5, 4) + 0.5);
      // The long reddish cracks, as ridged noise.
      for (const k of [3, 7]) { const r = 1 - Math.abs(n.noise3(x * k + 9, y * k, z * k)); if (r > 0.93) c = mix(c, [150, 96, 70], (r - 0.93) * 12); }
      return c;
    },
  },
  ganymede: {
    size: [512, 256], craters: { count: 300, depth: 0.2, seed: 5 },
    pixel(lat, lon, x, y, z, n) {
      const t = n.fbm3(x * 3, y * 3, z * 3, 5);
      let c = t > 0.05 ? mix([120, 108, 94], [96, 86, 76], t * 2) : mix([196, 188, 176], [170, 160, 148], -t * 2);
      if (Math.abs(lat) > 55) c = mix(c, [230, 230, 232], 0.5);
      return c;
    },
  },
  callisto: {
    size: [512, 256], craters: { count: 1200, depth: -0.5, seed: 9 },
    pixel(lat, lon, x, y, z, n) { const v = 86 + n.fbm3(x * 6, y * 6, z * 6, 5) * 22; return [v * 1.05, v, v * 0.9]; },
  },
  titan: {
    size: [256, 128],
    pixel(lat, lon, x, y, z, n) { return mix([204, 146, 60], [226, 170, 84], 0.5 + n.fbm3(x * 2, y * 2, z * 6, 3) * 0.2 + (lat > 55 ? -0.3 : 0)); },
  },
  enceladus: {
    size: [256, 128],
    pixel(lat, lon, x, y, z, n) {
      let c = mix([236, 242, 246], [252, 252, 252], n.fbm3(x * 6, y * 6, z * 6, 3) + 0.5);
      if (lat < -60 && Math.abs(Math.sin((lon + lat * 2) * 0.1)) < 0.08) c = mix(c, [150, 196, 230], 0.8);
      return c;
    },
  },
  iapetus: {
    size: [256, 128], craters: { count: 250, depth: 0.2, seed: 13 },
    pixel(lat, lon, x, y, z, n) {
      // Dark on the leading hemisphere (centred on 90° W), bright on the trailing one.
      const lead = arc(lat, lon, 0, -90);
      const dark = 1 - smooth(55, 80, lead + n.noise3(x * 4, y * 4, z * 4) * 12);
      return mix([222, 214, 200], [44, 32, 24], dark);
    },
  },
  mimas: {
    size: [256, 128], craters: { count: 400, depth: 0.3, seed: 17 },
    pixel(lat, lon, x, y, z, n) {
      const d = arc(lat, lon, 0, -110);
      let v = 190 + n.fbm3(x * 6, y * 6, z * 6, 4) * 20;
      if (d < 20) v -= 55 * (1 - d / 20) - (d > 17 ? 40 : 0) - (d < 2.5 ? 50 : 0);
      return [v, v * 0.99, v * 0.97];
    },
  },
  triton: {
    size: [256, 128],
    pixel(lat, lon, x, y, z, n) {
      const cant = Math.abs(n.noise3(x * 18, y * 18, z * 18));
      let c = mix([214, 190, 176], [196, 168, 158], cant * 1.6);
      if (lat < -15 + n.noise3(x * 3, y * 3, z * 3) * 10) c = mix(c, [236, 226, 222], 0.75);
      return c;
    },
  },
  pluto: {
    size: [512, 256],
    pixel(lat, lon, x, y, z, n) {
      const wob = n.noise3(x * 5, y * 5, z * 5);
      const p = patches(PLUTO, lat, lon, wob);
      let c = mix([196, 164, 128], [214, 190, 160], n.fbm3(x * 5, y * 5, z * 5, 4) + 0.5);
      if (p > 0) c = mix(c, [246, 238, 226], Math.min(1, p));
      if (p < 0) c = mix(c, [96, 56, 40], Math.min(1, -p));
      return c;
    },
  },
  charon: {
    size: [256, 128], craters: { count: 200, depth: 0.2, seed: 19 },
    pixel(lat, lon, x, y, z, n) {
      let c = mix([150, 146, 142], [180, 176, 170], n.fbm3(x * 5, y * 5, z * 5, 4) + 0.5);
      if (lat > 60 + n.noise3(x * 4, y * 4, z * 4) * 6) c = mix(c, [120, 70, 50], 0.8);
      return c;
    },
  },
  ceres: {
    size: [256, 128], craters: { count: 300, depth: 0.25, seed: 23 },
    pixel(lat, lon, x, y, z, n) {
      const v = 100 + n.fbm3(x * 5, y * 5, z * 5, 4) * 20;
      const bright = arc(lat, lon, 19.8, -120.7) < 1.2 ? 120 : 0;
      return [v + bright, v + bright, v * 0.98 + bright];
    },
  },
  vesta: {
    size: [256, 128], craters: { count: 250, depth: 0.25, seed: 29 },
    pixel(lat, lon, x, y, z, n) { const v = 140 + n.fbm3(x * 5, y * 5, z * 5, 4) * 30 + (lat < -50 ? -20 : 0); return [v, v * 0.97, v * 0.9]; },
  },
};

/** A painter for a plain rock or ice world, from its colour. */
function plain(color: string, ice: boolean): Painter {
  const c = hex(color);
  return {
    size: [256, 128], craters: { count: ice ? 150 : 300, depth: ice ? 0.15 : 0.3, seed: c[0] * 7 + c[1] },
    pixel(lat, lon, x, y, z, n) { const k = 0.85 + n.fbm3(x * 6, y * 6, z * 6, 4) * 0.3; return [c[0] * k, c[1] * k, c[2] * k]; },
  };
}

/**
 * Another star's world, painted from what the generator says it is
 * (systems.ts): continents, seas, clouds and ice caps on an Earth-like one,
 * islands on an ocean world, dunes on a desert, cracks across ice, glowing
 * seams on a lava world, storm bands on a giant. The colours are its own
 * palette's, so no two look alike; the seed is its own, so each looks the same
 * every time.
 */
function generated(def: BodyDef): Painter {
  const w = def.world;
  const small = def.radius < 1500;
  const size: [number, number] = small ? [256, 128] : [512, 256];
  if (def.kind === "star" || !w) {
    const c = hex(def.color);
    return {
      size: [256, 128],
      pixel(lat, lon, x, y, z, n) {
        const g = n.noise3(x * 40, y * 40, z * 40) * 0.5 + n.fbm3(x * 10, y * 10, z * 10, 3) * 0.5;
        const k = 0.8 + g * 0.3;
        return [Math.min(255, c[0] * k + 30), Math.min(255, c[1] * k + 20), Math.min(255, c[2] * k + 10)];
      },
    };
  }
  const P = w.palette;
  const ground = hex(P.ground), rock = hex(P.rock), accent = hex(P.accent);
  const flora = P.flora ? hex(P.flora) : ground, sea = P.sea ? hex(P.sea) : [30, 70, 140] as RGB;
  const deep: RGB = [sea[0] * 0.55, sea[1] * 0.55, sea[2] * 0.7];
  const cloudy = (c: RGB, x: number, y: number, z: number, n: Simplex, amount: number): RGB => {
    const cl = n.fbm3(x * 5 + 11, y * 5, z * 5, 5);
    return mix(c, [245, 247, 250], smooth(0.12, 0.5, cl) * amount);
  };
  switch (w.type) {
    case "gasgiant": case "hotjupiter": case "icegiant": case "minineptune": {
      const banded = w.type === "gasgiant" || w.type === "hotjupiter" ? 1 : 0.35;
      return {
        size,
        pixel(lat, lon, x, y, z, n) {
          const warp = n.fbm3(x * 3, y * 3, z * 3, 4) * 0.35;
          const band = Math.sin((lat / 90) * (banded > 0.5 ? 14 : 7) + warp * 4);
          let c = mix(ground, band > 0 ? accent : rock, Math.abs(band) * 0.55 * banded + 0.1);
          c = mix(c, rock, Math.max(0, n.noise3(x * 12, y * 30, z * 12)) * 0.12 * banded);
          // A great storm, somewhere in the southern bands.
          const storm = arc(lat, lon, -22 + (w.seed % 9), ((w.seed >> 4) % 360) - 180);
          if (banded > 0.5 && storm < 9) c = mix(c, [Math.min(255, rock[0] * 1.3 + 40), rock[1] * 0.8, rock[2] * 0.7], 1 - storm / 9);
          // Polar hazes darker.
          return mix(c, rock, smooth(60, 88, Math.abs(lat)) * 0.4);
        },
      };
    }
    case "terran": case "ocean": case "tundra": {
      const level = w.type === "ocean" ? 0.28 : w.type === "tundra" ? 0.02 : 0.08;
      return {
        size,
        pixel(lat, lon, x, y, z, n) {
          const h = n.fbm3(x * 2.2, y * 2.2, z * 2.2, 6) + (n.noise3(x * 0.8 + 3, y * 0.8, z * 0.8) * 0.25);
          const cold = Math.abs(lat) > (w.type === "tundra" ? 45 : 68) + n.noise3(x * 4, y * 4, z * 4) * 8;
          let c: RGB;
          if (h < level) c = mix(sea, deep, smooth(level, level - 0.35, h));
          else {
            const up = h - level;
            // Green (in its star's green) where it is wet and warm, sand in the dry belts, rock high up.
            const dry = smooth(0.15, 0.5, n.noise3(x * 3 + 5, y * 3, z * 3) + (Math.abs(Math.abs(lat) - 25) < 12 ? 0.35 : 0));
            c = w.life === "plants" || w.life === "animals" ? mix(flora, ground, dry) : mix(ground, rock, 0.3);
            c = mix(c, rock, smooth(0.25, 0.5, up));
          }
          if (cold) c = mix(c, accent, 0.85);
          return cloudy(c, x, y, z, n, 0.75);
        },
      };
    }
    case "desert": {
      return {
        size,
        pixel(lat, lon, x, y, z, n) {
          const dunes = Math.sin((lon + n.noise3(x * 3, y * 3, z * 3) * 40) * 0.35) * 0.5 + 0.5;
          let c = mix(ground, accent, dunes * 0.3 + n.fbm3(x * 5, y * 5, z * 5, 4) * 0.3);
          c = mix(c, rock, smooth(0.25, 0.6, n.fbm3(x * 2.5 + 7, y * 2.5, z * 2.5, 5)));
          if (w.life === "plants") c = mix(c, flora, smooth(0.35, 0.6, n.noise3(x * 6 + 2, y * 6, z * 6)) * 0.5);
          return w.air ? cloudy(c, x, y, z, n, 0.25) : c;
        },
      };
    }
    case "hothouse": case "haze": {
      return {
        size,
        pixel(lat, lon, x, y, z, n) {
          const streak = n.fbm3(x * 2 + lat * 0.02, y * 6, z * 2, 5);
          return mix(mix(accent, ground, 0.35 + streak * 0.6), rock, smooth(55, 90, Math.abs(lat)) * 0.35);
        },
      };
    }
    case "lava": {
      return {
        size, craters: { count: 60, depth: 0.2, seed: w.seed & 0xffff },
        pixel(lat, lon, x, y, z, n) {
          const crust = mix(ground, rock, n.fbm3(x * 5, y * 5, z * 5, 4) * 0.5 + 0.3);
          const seam = 1 - Math.abs(n.noise3(x * 7, y * 7, z * 7));
          const hot = smooth(0.9, 0.99, seam) + smooth(0.45, 0.7, n.noise3(x * 1.5 + 9, y * 1.5, z * 1.5)) * 0.6;
          return mix(crust, accent, Math.min(1, hot));
        },
      };
    }
    case "volcanic": {
      return {
        size,
        pixel(lat, lon, x, y, z, n) {
          let c = mix(ground, accent, smooth(0.2, 0.6, n.fbm3(x * 4, y * 4, z * 4, 4)) * 0.5);
          const spot = n.noise3(x * 9 + 1, y * 9, z * 9);
          if (spot > 0.55) c = mix(c, rock, (spot - 0.55) * 3);
          if (spot > 0.72) c = mix(c, [255, 90, 30], (spot - 0.72) * 3);
          return c;
        },
      };
    }
    case "icy": case "nitrogen": {
      return {
        size, craters: { count: 120, depth: 0.12, seed: w.seed & 0xffff },
        pixel(lat, lon, x, y, z, n) {
          let c = mix(ground, rock, smooth(0.25, 0.6, n.fbm3(x * 2.5, y * 2.5, z * 2.5, 5)) * 0.6);
          const crack = 1 - Math.abs(n.noise3(x * 6 + 4, y * 6, z * 6));
          c = mix(c, accent, smooth(0.93, 0.99, crack) * 0.8);
          return w.type === "nitrogen" ? mix(c, accent, smooth(0.3, 0.6, n.noise3(x * 1.5, y * 1.5, z * 1.5)) * 0.4) : c;
        },
      };
    }
    case "martian": {
      return {
        size, craters: { count: 250, depth: 0.2, seed: w.seed & 0xffff },
        pixel(lat, lon, x, y, z, n) {
          let c = mix(ground, rock, smooth(0.15, 0.5, n.fbm3(x * 3, y * 3, z * 3, 5)) * 0.7);
          c = mix(c, accent, smooth(72, 82, Math.abs(lat) + n.noise3(x * 5, y * 5, z * 5) * 5));
          return c;
        },
      };
    }
    default: {
      // Barren and iron worlds: the Moon's look — dark lowland seas, bright highlands, craters everywhere.
      return {
        size, craters: { count: small ? 220 : 380, depth: 0.3, seed: w.seed & 0xffff },
        pixel(lat, lon, x, y, z, n) {
          const sea = smooth(0.1, 0.35, n.fbm3(x * 1.6 + 2, y * 1.6, z * 1.6, 4));
          return mix(mix(ground, accent, n.fbm3(x * 8, y * 8, z * 8, 3) * 0.3 + 0.15), rock, sea * 0.75);
        },
      };
    }
  }
}

/**
 * Stamps craters into a finished map: dark floors, bright rims, and a
 * power-law of sizes — many small, few large — as impacts make them.
 */
function craters(px: Float32Array, w: number, h: number, spec: NonNullable<Painter["craters"]>): void {
  const r = new Rng(spec.seed);
  for (let k = 0; k < spec.count; k++) {
    const lat = (Math.asin(r.next() * 2 - 1) * 180) / Math.PI, lon = r.next() * 360 - 180;
    const size = Math.min(spec.maxSize ?? 12, 0.4 / Math.pow(Math.max(0.002, r.next()), 0.55));
    const y0 = Math.max(0, Math.floor(((90 - lat - size * 1.3) / 180) * h)), y1 = Math.min(h - 1, Math.ceil(((90 - lat + size * 1.3) / 180) * h));
    const lonSpan = (size * 1.3) / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    for (let y = y0; y <= y1; y++) {
      const plat = 90 - ((y + 0.5) / h) * 180;
      for (let dx = -lonSpan; dx <= lonSpan; dx += 360 / w) {
        const plon = lon + dx;
        const x = ((Math.floor(((plon + 180) / 360) * w) % w) + w) % w;
        const d = arc(plat, plon, lat, lon) / size;
        if (d > 1.3) continue;
        const shade = d < 0.8 ? -spec.depth * (1 - (d / 0.8) ** 2) : spec.depth * 0.8 * (1 - Math.abs(d - 1) / 0.3);
        const i = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) px[i + c] *= 1 + shade;
      }
    }
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** A body's surface map, painted once and kept. Null outside a browser. */
export function surfaceCanvas(id: string, look: Look, color: string, def?: BodyDef): HTMLCanvasElement | null {
  const hit = cache.get(id);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const p = look === "gen" && def ? generated(def) : PAINTERS[look] ?? plain(color, look === "ice");
  const [w, h] = p.size;
  const noise = new Simplex(def?.world ? def.world.seed & 0x7fffffff : id.length * 131 + id.charCodeAt(0));
  const px = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180, cl = Math.cos((lat * Math.PI) / 180), sl = Math.sin((lat * Math.PI) / 180);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360 - 180, r = (lon * Math.PI) / 180;
      const c = p.pixel(lat, lon, cl * Math.cos(r), cl * Math.sin(r), sl, noise);
      px.set(c, (y * w + x) * 3);
    }
  }
  if (p.craters) craters(px, w, h, p.craters);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = Math.max(0, Math.min(255, px[i * 3]));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, px[i * 3 + 1]));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, px[i * 3 + 2]));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cache.set(id, canvas);
  return canvas;
}

/** The Earth's clouds: storm tracks at mid-latitudes, towers along the equator, clear skies over the subtropics. */
export function cloudCanvas(): HTMLCanvasElement | null {
  const hit = cache.get("#clouds");
  if (hit || typeof document === "undefined") return hit ?? null;
  const w = 1024, h = 512, n = new Simplex(4242);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180, cl = Math.cos((lat * Math.PI) / 180), sl = Math.sin((lat * Math.PI) / 180);
    const a = Math.abs(lat);
    const cover = 0.45 * (1 - smooth(0, 10, a)) + 0.15 + 0.45 * smooth(38, 55, a) * (1 - smooth(70, 85, a)) - 0.25 * smooth(12, 22, a) * (1 - smooth(30, 38, a));
    for (let x = 0; x < w; x++) {
      const r = (((x + 0.5) / w) * 360 - 180) * (Math.PI / 180);
      const px = cl * Math.cos(r), py = cl * Math.sin(r), pz = sl;
      // Swirled: the lookup is pushed round by a second noise, as weather is by the spin of the planet.
      const sw = n.noise3(px * 2, py * 2, pz * 2) * 0.6;
      const v = n.fbm3(px * 5 + sw, py * 5 - sw, pz * 7, 6) * 0.9 + cover - 0.3;
      const alpha = Math.max(0, Math.min(1, v * 2.2));
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = alpha * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set("#clouds", canvas);
  return canvas;
}

/**
 * The Earth at night: its cities, where people live — thickest in Europe, the
 * eastern United States, India, eastern China and Japan, strung along the Nile
 * and the coasts — and never at sea or on the ice.
 */
const CITIES: Patch[] = [
  [50, 10, 12, 1], [53, -2, 4, 1], [45, 12, 6, 0.9], [40, -4, 5, 0.7], [38, -80, 10, 1], [42, -85, 6, 1], [36, -119, 5, 0.8], [30, -95, 6, 0.7],
  [20, -100, 6, 0.7], [-23, -46, 6, 0.9], [-34, -60, 3, 0.6], [4, -74, 4, 0.4], [22, 79, 11, 1], [30, 72, 5, 0.9], [32, 115, 10, 1], [23, 113, 4, 1],
  [36, 138, 4, 1], [37, 127, 2.5, 1], [30, 31, 2, 1], [26, 32, 3, 0.8], [8, 6, 4, 0.55], [-26, 28, 3, 0.6], [-7, 110, 3, 0.9], [14, 101, 3, 0.7],
  [55.7, 37.6, 6, 0.8], [25, 50, 6, 0.6], [33, 44, 4, 0.5], [41, 29, 3, 0.8], [-34, 150, 3, 0.6], [-38, 145, 2, 0.5], [49, 2, 2, 1], [52, 5, 2, 1],
];

export function cityLightsCanvas(): HTMLCanvasElement | null {
  const hit = cache.get("#lights");
  if (hit || typeof document === "undefined") return hit ?? null;
  const w = 1024, h = 512, n = new Simplex(777);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180, cl = Math.cos((lat * Math.PI) / 180), sl = Math.sin((lat * Math.PI) / 180);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360 - 180, r = (lon * Math.PI) / 180;
      const i = (y * w + x) * 4;
      img.data[i + 3] = 255;
      if (!isLand(lat, lon) || lat < -58 || lat > 72) continue;
      const px = cl * Math.cos(r), py = cl * Math.sin(r), pz = sl;
      const people = Math.min(1, patches(CITIES, lat, lon, n.noise3(px * 7, py * 7, pz * 7)) + 0.08);
      // Speckled: towns are points, not a wash.
      const speck = Math.pow(Math.max(0, n.noise3(px * 90, py * 90, pz * 90) - 0.45), 2) * 9 + Math.pow(Math.max(0, n.noise3(px * 300, py * 300, pz * 300) - 0.6), 2) * 14;
      const v = Math.min(1, people * speck);
      img.data[i] = v * 255; img.data[i + 1] = v * 196; img.data[i + 2] = v * 110;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set("#lights", canvas);
  return canvas;
}

/**
 * Close-up detail for a rocky world: a tile of bumps and small craters that
 * repeats across the surface, faded in as the ship comes low — the painted
 * map is a few kilometres a pixel, which from 100 km up is a blur.
 */
export function detailCanvas(): HTMLCanvasElement | null {
  const hit = cache.get("#detail");
  if (hit || typeof document === "undefined") return hit ?? null;
  const W = 256;
  const r = new Rng(4099);
  const v = new Float32Array(W * W);
  // Tileable value noise: random lattices that wrap, smoothly interpolated, four octaves.
  for (const [cells, amp] of [[4, 0.5], [8, 0.3], [16, 0.18], [32, 0.1], [64, 0.06]] as const) {
    const lat = Array.from({ length: cells * cells }, () => r.next() * 2 - 1);
    const at = (i: number, j: number) => lat[((j + cells) % cells) * cells + ((i + cells) % cells)];
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const fx = (x / W) * cells, fy = (y / W) * cells, i = Math.floor(fx), j = Math.floor(fy);
      const tx = fx - i, ty = fy - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
      v[y * W + x] += (a + (b - a) * sy) * amp;
    }
  }
  // Craters, wrapped at the edges so the tile joins itself.
  for (let k = 0; k < 140; k++) {
    const cx = r.next() * W, cy = r.next() * W, rad = 2 + 30 * Math.pow(r.next(), 3);
    for (let dy = -rad * 1.3; dy <= rad * 1.3; dy++) for (let dx = -rad * 1.3; dx <= rad * 1.3; dx++) {
      const d = Math.hypot(dx, dy) / rad;
      if (d > 1.3) continue;
      const x = ((Math.floor(cx + dx) % W) + W) % W, y = ((Math.floor(cy + dy) % W) + W) % W;
      v[y * W + x] += d < 0.85 ? -0.35 * (1 - (d / 0.85) ** 2) : 0.3 * (1 - Math.abs(d - 1.05) / 0.25);
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = W;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, W);
  for (let i = 0; i < W * W; i++) {
    const g = Math.max(0, Math.min(255, 128 + v[i] * 150));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cache.set("#detail", canvas);
  return canvas;
}

/**
 * The Milky Way as a map of right ascension (0h at the left) and declination
 * (+90° at the top): its measured outline (skyData.ts), softened, given the
 * grain of star clouds and the dark lanes of dust, and warm toward the
 * galaxy's centre in Sagittarius. Shared by the space view and the sky seen
 * from the ground.
 */
export function milkyWayCanvas(): HTMLCanvasElement | null {
  const hit = cache.get("#milkyway");
  if (hit || typeof document === "undefined") return hit ?? null;
  const lv = decodeRuns(MILKY_WAY.width, MILKY_WAY.height, MILKY_WAY.runs);
  const W = 1024, H = 512, n = new Simplex(99);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const gc = raDecToEcl(266.4, -28.94);
  // Softened once at the map's own size, then read with bilinear filtering at the texture's.
  const MW = MILKY_WAY.width, MH = MILKY_WAY.height;
  const blur = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    let v = 0, wsum = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const w = Math.exp(-(dx * dx + dy * dy) / 3);
      v += lv[Math.max(0, Math.min(MH - 1, y + dy)) * MW + (((x + dx) % MW) + MW) % MW] * w; wsum += w;
    }
    blur[y * MW + x] = v / (wsum * 5);
  }
  const sample = (fx: number, fy: number) => {
    const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(MH - 1, Math.floor(fy))), y1 = Math.min(MH - 1, y0 + 1), tx = fx - x0, ty = fy - Math.floor(fy);
    const at = (x: number, y: number) => blur[y * MW + ((x % MW) + MW) % MW];
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x0 + 1, y1) * tx) * ty;
  };
  for (let y = 0; y < H; y++) {
    const dec = 90 - ((y + 0.5) / H) * 180;
    for (let x = 0; x < W; x++) {
      const ra = ((x + 0.5) / W) * 360;
      const v = sample((x / W) * MW, (y / H) * MH);
      const dir = raDecToEcl(ra, dec);
      const nx = dir[0] * 6, ny = dir[1] * 6, nz = dir[2] * 6;
      const dust = v > 0.02 ? Math.max(0, n.fbm3(nx * 2, ny * 2, nz * 2, 3)) : 0;
      const grain = v > 0.02 ? 0.75 + n.noise3(nx * 5, ny * 5, nz * 5) * 0.3 : 1;
      const core = Math.pow(Math.max(0, dot(dir, gc)), 6);
      const b = Math.max(0, v * grain - dust * v * 0.9) * 0.55 + core * 0.08;
      const warm = Math.min(1, core * 1.4 + v * 0.2);
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, b * (190 + warm * 60) + 3);
      img.data[i + 1] = Math.min(255, b * (190 + warm * 20) + 4);
      img.data[i + 2] = Math.min(255, b * (220 - warm * 40) + 8);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cache.set("#milkyway", canvas);
  return canvas;
}
