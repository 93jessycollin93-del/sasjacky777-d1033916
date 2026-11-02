/**
 * Paints the app icon — a grass block, like every texture in the game painted
 * by code — and writes build/icon.png (512×512), which electron-builder turns
 * into the Windows .ico and the macOS .icns. Committed, so building the app
 * does not depend on running this; run it again only to change the icon.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 512;
const TEX = 16;

/** A stable per-texel wobble, so the icon comes out the same every run. */
function noise(face, x, y) {
  let h = (x * 374761393 + y * 668265263 + face * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xff) / 255;
}

const GRASS = [89, 163, 58];
const DIRT = [134, 96, 67];
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

function texel(face, tx, ty) {
  const n = noise(face, tx, ty);
  if (face === 0) return shade(GRASS, 0.82 + n * 0.3);
  // The sides: dirt, with grass hanging a ragged 3–5 texels over the top edge.
  const fringe = 3 + Math.floor(noise(face + 7, tx, 0) * 2.5);
  const base = ty < fringe ? shade(GRASS, 0.8 + n * 0.25) : shade(DIRT, 0.78 + n * 0.35);
  return shade(base, face === 1 ? 0.82 : 0.62);
}

// The three visible faces as origin + two edge vectors (an isometric cube centred in the canvas).
const faces = [
  { o: [256, 40], a: [216, 108], b: [-216, 108] },
  { o: [40, 148], a: [216, 108], b: [0, 216] },
  { o: [256, 256], a: [216, -108], b: [0, 216] },
];

const px = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    for (let f = 0; f < 3; f++) {
      const { o, a, b } = faces[f];
      const det = a[0] * b[1] - a[1] * b[0];
      const dx = x + 0.5 - o[0];
      const dy = y + 0.5 - o[1];
      const u = (dx * b[1] - dy * b[0]) / det;
      const v = (a[0] * dy - a[1] * dx) / det;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const tx = Math.floor(u * TEX);
      const ty = Math.floor(v * TEX);
      // A dark rim where faces meet reads as an edge at small sizes.
      const edge = u < 0.012 || u > 0.988 || v < 0.012 || v > 0.988;
      const c = edge ? [24, 24, 24] : texel(f, tx, ty);
      const i = (y * SIZE + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      break;
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../build/icon.png");
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes).`);
