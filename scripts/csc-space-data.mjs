#!/usr/bin/env node
/**
 * Bakes the space view's real sky and real Earth into src/craft/space/skyData.ts:
 *
 * - the stars to magnitude 6 (5,044 of them, from the Hipparcos-based XHIP
 *   compilation as d3-celestial packages it) with their colours and the
 *   proper names of the bright ones;
 * - the Milky Way's outline at five levels of brightness (Jose R. Vieira's
 *   Milky Way Outline Catalog, from the same package), as a sky map;
 * - Earth's land and lakes (Natural Earth, public domain), as a map.
 *
 * The sources are large (a few megabytes of GeoJSON); what the game ships is
 * a few dozen kilobytes of run-length-coded maps and packed star records.
 *
 * Usage, from the repository root:
 *
 *   mkdir -p /tmp/space && cd /tmp/space
 *   curl -LO https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json
 *   curl -LO https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/starnames.json
 *   curl -LO https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/mw.json
 *   curl -L -o land.json https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson
 *   curl -L -o lakes.json https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_lakes.geojson
 *   cd - && node scripts/csc-space-data.mjs /tmp/space
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node scripts/csc-space-data.mjs <folder with the downloaded JSON>");
  process.exit(1);
}
const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

/** Even-odd scanline fill of polygon rings (in pixel coordinates) into a grid, adding `value` to covered pixels. */
function fill(grid, w, h, rings, value) {
  const edges = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
    }
  }
  for (let y = 0; y < h; y++) {
    const sy = y + 0.5;
    const xs = [];
    for (const [x0, y0, x1, y1] of edges) if (sy >= y0 && sy < y1) xs.push(x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) grid[y * w + x] += value;
    }
  }
}

/** A GeoJSON geometry's polygons, each a list of rings in [lon, lat]. */
function polygons(geom) {
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

/** Runs of equal values, row after row, as varints: value, then length. */
function rle(grid) {
  const out = [];
  const varint = (n) => { while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); };
  let i = 0;
  while (i < grid.length) {
    const v = grid[i];
    let j = i;
    while (j < grid.length && grid[j] === v) j++;
    varint(v);
    varint(j - i);
    i = j;
  }
  return Buffer.from(out).toString("base64");
}

// ---- Earth: land, less the great lakes and inland seas -----------------------------------------------------------
const EW = 1024, EH = 512;
const earth = new Int16Array(EW * EH);
const lonLat = ([lon, lat]) => [((lon + 180) / 360) * EW, ((90 - lat) / 180) * EH];
for (const f of read("land.json").features) for (const poly of polygons(f.geometry)) fill(earth, EW, EH, poly.map((r) => r.map(lonLat)), 1);
for (const f of read("lakes.json").features) for (const poly of polygons(f.geometry)) fill(earth, EW, EH, poly.map((r) => r.map(lonLat)), -1);
const land = Uint8Array.from(earth, (v) => (v > 0 ? 1 : 0));

// ---- the Milky Way, five outlines deep, on a map of right ascension and declination -------------------------------
const MW = 512, MH = 256;
const milky = new Int16Array(MW * MH);
for (const f of read("mw.json").features) {
  for (const poly of polygons(f.geometry)) {
    // d3-celestial stores right ascension as longitude in -180..180; the map runs 0..360.
    const rings = poly.map((r) => r.map(([lon, lat]) => [(((lon + 360) % 360) / 360) * MW, ((90 - lat) / 180) * MH]));
    // A ring that crosses 0h would sweep across the whole map: unwrap it, and draw it again a turn either side.
    const unwrapped = rings.map((r) => {
      const out = [r[0]];
      for (let i = 1; i < r.length; i++) {
        let [x] = r[i];
        const px = out[i - 1][0];
        while (x - px > MW / 2) x -= MW;
        while (px - x > MW / 2) x += MW;
        out.push([x, r[i][1]]);
      }
      return out;
    });
    // A ring that goes right round the sky (each edge of the band does) comes back a whole turn from where it
    // started. Laid out three turns long and closed over the north pole, it covers everything north of it; with
    // both edges done so, the even-odd fill leaves exactly the band between them.
    const all = [];
    for (const r of unwrapped) {
      const turn = r[r.length - 1][0] - r[0][0];
      if (Math.abs(turn) > MW / 2) {
        const long = [...r.map(([x, y]) => [x - turn, y]), ...r, ...r.map(([x, y]) => [x + turn, y])];
        long.push([long[long.length - 1][0], -1], [long[0][0], -1]);
        all.push(long);
      } else for (const shift of [0, MW, -MW]) all.push(r.map(([x, y]) => [x + shift, y]));
    }
    fill(milky, MW, MH, all, 1);
  }
}
const sky = Uint8Array.from(milky, (v) => Math.max(0, Math.min(5, v)));

// ---- the stars ----------------------------------------------------------------------------------------------------
const names = read("starnames.json");
const stars = read("stars.6.json").features
  .map((f) => ({ id: String(f.id), mag: f.properties.mag, bv: Number.parseFloat(f.properties.bv), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
  .filter((s) => Number.isFinite(s.mag))
  .sort((a, b) => a.mag - b.mag);
const packed = Buffer.alloc(stars.length * 6);
const named = [];
stars.forEach((s, i) => {
  const ra = (s.lon + 360) % 360;
  packed.writeUInt16LE(Math.round((ra / 360) * 65535), i * 6);
  packed.writeUInt16LE(Math.round(((s.lat + 90) / 180) * 65535), i * 6 + 2);
  packed.writeUInt8(Math.max(0, Math.min(255, Math.round((s.mag + 1.5) * 30))), i * 6 + 4);
  const bv = Number.isFinite(s.bv) ? s.bv : 0.6;
  packed.writeUInt8(Math.max(0, Math.min(255, Math.round((Math.max(-0.4, Math.min(2.0, bv)) + 0.4) * 100))), i * 6 + 5);
  const n = names[s.id]?.name;
  if (n && s.mag < 3.2) named.push([i, n]);
});

const out = `/**
 * The real sky and the real Earth, baked by scripts/csc-space-data.mjs — do not edit by hand.
 *
 * Stars: ${stars.length} stars to magnitude 6 from XHIP (Anderson & Francis 2012, VizieR V/137D), with names from
 * the IAU and the cross-indices d3-celestial gathers. Milky Way: Jose R. Vieira's Milky Way Outline Catalog.
 * Both as packaged by d3-celestial, Copyright (c) 2015, Olaf Frohn, under the BSD 3-Clause licence:
 *
 *   Redistribution and use in source and binary forms, with or without modification, are permitted provided that
 *   the following conditions are met: 1. Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer. 2. Redistributions in binary form must reproduce the
 *   above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other
 *   materials provided with the distribution. 3. Neither the name of the copyright holder nor the names of its
 *   contributors may be used to endorse or promote products derived from this software without specific prior
 *   written permission.
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
 *   WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 *   PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY
 *   DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 *   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 *   CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 *   OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Earth: Natural Earth's 1:50m land and 1:110m lakes, public domain (naturalearthdata.com).
 */

/** Six bytes a star, brightest first: right ascension and declination (J2000) as 16-bit fractions of the circle
 *  and of the half-circle, magnitude as (m + 1.5) × 30, and B−V colour as (bv + 0.4) × 100. */
export const STARS = "${packed.toString("base64")}";

/** The named bright stars, by their place in STARS. */
export const STAR_NAMES: [number, string][] = ${JSON.stringify(named)};

/** The Milky Way on a ${MW}×${MH} map of right ascension (0h at the left) and declination (+90° at the top):
 *  how many of its five outlines cover each cell, as runs of (value, length) varints. */
export const MILKY_WAY = { width: ${MW}, height: ${MH}, runs: "${rle(sky)}" };

/** Earth on a ${EW}×${EH} map of longitude (-180° at the left) and latitude (+90° at the top): 1 on land. */
export const EARTH_LAND = { width: ${EW}, height: ${EH}, runs: "${rle(land)}" };
`;
writeFileSync("src/craft/space/skyData.ts", out);
console.log(`stars ${stars.length} (${named.length} named), milky way ${rle(sky).length} chars, earth ${rle(land).length} chars, file ${out.length} chars`);
