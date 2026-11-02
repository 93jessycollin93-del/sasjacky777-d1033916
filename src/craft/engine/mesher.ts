/**
 * Turns a chunk into vertex buffers.
 *
 * Input is the chunk plus a one-block border from its eight neighbours
 * ("padded"), so faces at the chunk edge can be culled against the block next
 * door and corner vertices can average light across the seam. Output is three
 * buffers — opaque, cutout (alpha-tested: leaves, plants, glass) and
 * translucent (water, ice) — because they must be drawn in that order with
 * different depth and blending state.
 *
 * Vertices are packed small: position as Int16 in sixteenths of a block,
 * texture coordinates and light as bytes. A chunk column with caves under it
 * can carry twenty thousand faces; at 18 bytes a vertex that is ~1.4 MB, where
 * plain floats would be four times that, across a few hundred chunks.
 */
import {
  block, BLOCK_ID_LIMIT, faceTexture, isBed, isDoor, isLeaves, isRedstoneTorch, modelBoxes, B, Face, FACING_DIRS, type BlockDef, type Box,
} from "./blocks";
import { dustColor, dustConnection } from "./redstone";
import { railShape, isSlope } from "./rails";
import { WORLD_HEIGHT } from "./constants";

export const PAD = 18;
export const PAD_H = WORLD_HEIGHT + 2;
export const PADDED_VOLUME = PAD * PAD * PAD_H;

/** Index into padded arrays; x, z in -1..16, y in -1..WORLD_HEIGHT. */
export function padIndex(x: number, y: number, z: number): number {
  return ((y + 1) * PAD + (z + 1)) * PAD + (x + 1);
}

export interface MeshInput {
  blocks: Uint16Array;
  meta: Uint8Array;
  light: Uint8Array;
  /** 9 bytes per column: grass rgb, foliage rgb, water rgb. */
  tints: Uint8Array;
  fancyLeaves: boolean;
  smoothLighting: boolean;
}

export interface LayerMesh {
  positions: Int16Array;
  tex: Uint8Array;
  light: Uint8Array;
  color: Uint8Array;
  quads: number;
}

export interface ChunkMesh {
  opaque: LayerMesh;
  cutout: LayerMesh;
  translucent: LayerMesh;
}

/** Vertex flags, read by the shader. */
export const FLAG_WAVE = 1;
export const FLAG_ANIMATED = 2;
export const FLAG_WAVE_TOP = 4;

class Builder {
  positions: Int16Array;
  tex: Uint8Array;
  light: Uint8Array;
  color: Uint8Array;
  quads = 0;
  constructor(capacityQuads = 1024) {
    this.positions = new Int16Array(capacityQuads * 12);
    this.tex = new Uint8Array(capacityQuads * 16);
    this.light = new Uint8Array(capacityQuads * 16);
    this.color = new Uint8Array(capacityQuads * 16);
  }
  private grow(): void {
    const cap = (this.positions.length / 12) * 2;
    const p = new Int16Array(cap * 12); p.set(this.positions); this.positions = p;
    const t = new Uint8Array(cap * 16); t.set(this.tex); this.tex = t;
    const l = new Uint8Array(cap * 16); l.set(this.light); this.light = l;
    const c = new Uint8Array(cap * 16); c.set(this.color); this.color = c;
  }
  /** Adds one quad. Arrays hold 4 vertices each; winding must already be counter-clockwise. */
  quad(
    px: number[], py: number[], pz: number[], u: number[], v: number[], layer: number,
    sky: number[], blk: number[], shade: number[], flags: number, r: number, g: number, b: number, tintMode: number,
  ): void {
    if ((this.quads + 1) * 12 > this.positions.length) this.grow();
    const q = this.quads++;
    for (let i = 0; i < 4; i++) {
      const pv = q * 12 + i * 3;
      this.positions[pv] = px[i];
      this.positions[pv + 1] = py[i];
      this.positions[pv + 2] = pz[i];
      const o = q * 16 + i * 4;
      this.tex[o] = u[i];
      this.tex[o + 1] = v[i];
      this.tex[o + 2] = layer & 255;
      this.tex[o + 3] = layer >> 8;
      this.light[o] = sky[i];
      this.light[o + 1] = blk[i];
      this.light[o + 2] = shade[i];
      this.light[o + 3] = flags;
      this.color[o] = r;
      this.color[o + 1] = g;
      this.color[o + 2] = b;
      this.color[o + 3] = tintMode;
    }
  }
  finish(): LayerMesh {
    return {
      positions: this.positions.slice(0, this.quads * 12),
      tex: this.tex.slice(0, this.quads * 16),
      light: this.light.slice(0, this.quads * 16),
      color: this.color.slice(0, this.quads * 16),
      quads: this.quads,
    };
  }
}

// Corners of each face in [0,1], counter-clockwise seen from outside.
const FACE_CORNERS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // +x
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // -x
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // +y
  [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], // -y
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // +z
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // -z
];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Directional shading so faces read as solid even in flat light: top brightest, bottom darkest. */
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

function faceUV(face: number, px: number, py: number, pz: number): [number, number] {
  switch (face) {
    case 0: return [16 - pz, 16 - py];
    case 1: return [pz, 16 - py];
    case 2: return [px, pz];
    case 3: return [16 - px, pz];
    case 4: return [px, 16 - py];
    default: return [16 - px, 16 - py];
  }
}

/** Rotates a top-face UV so its "up" points along a facing (north, south, west, east). */
function rotateUV(u: number, v: number, facing: number): [number, number] {
  switch (facing) {
    case 1: return [16 - u, 16 - v];
    case 2: return [16 - v, u];
    case 3: return [v, 16 - u];
    default: return [u, v];
  }
}

const TINT_NONE = 0, TINT_FULL = 1, TINT_MASKED = 2;

// Reused scratch arrays — the mesher is hot and allocation shows up in profiles.
const sx = [0, 0, 0, 0], sy = [0, 0, 0, 0], sz = [0, 0, 0, 0];
const su = [0, 0, 0, 0], sv = [0, 0, 0, 0];
const sSky = [0, 0, 0, 0], sBlk = [0, 0, 0, 0], sShade = [0, 0, 0, 0];
const rx = [0, 0, 0, 0], ry = [0, 0, 0, 0], rz = [0, 0, 0, 0], ru = [0, 0, 0, 0], rv = [0, 0, 0, 0];
const rSky = [0, 0, 0, 0], rBlk = [0, 0, 0, 0], rShade = [0, 0, 0, 0];

export type LayerLookup = (name: string) => number;

export class Mesher {
  private cache = new Map<number, number>();
  private defs: BlockDef[] = [];
  private opaque = new Uint8Array(BLOCK_ID_LIMIT);

  constructor(private lookup: LayerLookup) {
    for (let id = 0; id < BLOCK_ID_LIMIT; id++) {
      this.defs[id] = block(id);
      this.opaque[id] = this.defs[id].opaque ? 1 : 0;
    }
  }

  private layer(def: BlockDef, meta: number, face: number, override?: string): number {
    if (override) return this.lookup(override);
    const key = (def.id << 16) | ((meta & 255) << 3) | face;
    let l = this.cache.get(key);
    if (l === undefined) {
      l = this.lookup(faceTexture(def, meta, face));
      this.cache.set(key, l);
    }
    return l;
  }

  mesh(input: MeshInput): ChunkMesh {
    const { blocks, meta, tints } = input;
    const out = { opaque: new Builder(2048), cutout: new Builder(512), translucent: new Builder(256) };
    const opaque = this.opaque;
    const defs = this.defs;

    let minY = WORLD_HEIGHT, maxY = -1;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const base = padIndex(0, y, 0);
      for (let z = 0; z < 16; z++) {
        const row = base + z * PAD;
        for (let x = 0; x < 16; x++) {
          if (blocks[row + x] !== 0) { if (y < minY) minY = y; maxY = y; break; }
        }
        if (maxY === y) break;
      }
    }

    for (let y = minY; y <= maxY; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const pi = padIndex(x, y, z);
          const id = blocks[pi];
          if (id === 0) continue;
          const def = defs[id];
          const m = meta[pi];
          const target = def.layer === "translucent" ? out.translucent : def.layer === "cutout" ? out.cutout : out.opaque;
          const col = (z * 16 + x) * 9;
          let tr = 255, tg = 255, tb = 255;
          switch (def.tint) {
            case "grass": tr = tints[col]; tg = tints[col + 1]; tb = tints[col + 2]; break;
            case "foliage": tr = tints[col + 3]; tg = tints[col + 4]; tb = tints[col + 5]; break;
            case "water": tr = tints[col + 6]; tg = tints[col + 7]; tb = tints[col + 8]; break;
            case "birch": tr = 128; tg = 167; tb = 85; break;
            case "spruce": tr = 97; tg = 153; tb = 97; break;
          }
          // A gateway is a cube of moving starfield: the only animated cube.
          const flags = def.animated ? FLAG_ANIMATED : def.waves && def.shape === "cube" ? FLAG_WAVE : 0;

          if (def.shape === "cube") {
            const snowy = id === B.GRASS && (blocks[padIndex(x, y + 1, z)] === B.SNOW || blocks[padIndex(x, y + 1, z)] === B.SNOW_BLOCK);
            for (let f = 0; f < 6; f++) {
              const n = NORMALS[f];
              const nid = blocks[padIndex(x + n[0], y + n[1], z + n[2])];
              if (opaque[nid]) continue;
              if (nid === id && (def.layer !== "cutout" || !isLeaves(id) || !input.fancyLeaves)) continue;
              let tintMode = def.tint === "none" ? TINT_NONE : TINT_FULL;
              let override: string | undefined;
              if (id === B.GRASS) {
                if (f === Face.Down) tintMode = TINT_NONE;
                else if (f !== Face.Up) {
                  tintMode = snowy ? TINT_NONE : TINT_MASKED;
                  if (snowy) override = "grass_block_snow";
                }
              }
              this.cubeFace(target, input, x, y, z, f, this.layer(def, m, f, override), flags, tr, tg, tb, tintMode, def.uvRotation ? def.uvRotation(m, f) : 0);
            }
          } else if (def.shape === "cross") {
            this.cross(target, input, x, y, z, def, m, tr, tg, tb, def.tint === "none" ? TINT_NONE : TINT_FULL);
          } else if (def.shape === "crop") {
            this.crop(target, input, x, y, z, def, m);
          } else if (def.shape === "boxes") {
            this.boxes(target, input, x, y, z, def, m, tr, tg, tb, def.tint === "none" ? TINT_NONE : TINT_FULL);
          } else if (def.shape === "fluid") {
            this.fluid(target, input, x, y, z, def, m, tr, tg, tb);
          } else if (def.shape === "wire") {
            this.wire(target, input, x, y, z, m);
          } else if (def.shape === "rail") {
            this.rail(target, input, x, y, z, def, m);
          }
        }
      }
    }
    return { opaque: out.opaque.finish(), cutout: out.cutout.finish(), translucent: out.translucent.finish() };
  }

  private cubeFace(
    b: Builder, input: MeshInput, x: number, y: number, z: number, f: number, layer: number,
    flags: number, r: number, g: number, bl: number, tintMode: number, rotation = 0,
  ): void {
    const { blocks, light } = input;
    const n = NORMALS[f];
    const fx = x + n[0], fy = y + n[1], fz = z + n[2];
    const corners = FACE_CORNERS[f];
    const frontLight = light[padIndex(fx, fy, fz)];
    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      sx[i] = (x + c[0]) * 16; sy[i] = (y + c[1]) * 16; sz[i] = (z + c[2]) * 16;
      let uv = faceUV(f, c[0] * 16, c[1] * 16, c[2] * 16);
      if (rotation) uv = rotateUV(uv[0], uv[1], rotation);
      su[i] = uv[0]; sv[i] = uv[1];
      if (!input.smoothLighting) {
        sSky[i] = (frontLight >> 4) * 17; sBlk[i] = (frontLight & 15) * 17;
        sShade[i] = Math.round(FACE_SHADE[f] * 255);
        continue;
      }
      // The two tangent directions toward this corner, in the layer in front of the face.
      // a is x or y, b is y or z: never the face's own axis.
      let ax = 0, ay = 0, by = 0, bz = 0;
      const az = 0, bx = 0;
      if (n[0] !== 0) { ay = c[1] ? 1 : -1; bz = c[2] ? 1 : -1; }
      else if (n[1] !== 0) { ax = c[0] ? 1 : -1; bz = c[2] ? 1 : -1; }
      else { ax = c[0] ? 1 : -1; by = c[1] ? 1 : -1; }
      const i1 = padIndex(fx + ax, fy + ay, fz + az);
      const i2 = padIndex(fx + bx, fy + by, fz + bz);
      const i3 = padIndex(fx + ax + bx, fy + ay + by, fz + az + bz);
      const s1 = this.opaque[blocks[i1]], s2 = this.opaque[blocks[i2]], s3 = this.opaque[blocks[i3]];
      const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
      let sky = frontLight >> 4, blk = frontLight & 15, count = 1;
      if (!s1) { sky += light[i1] >> 4; blk += light[i1] & 15; count++; }
      if (!s2) { sky += light[i2] >> 4; blk += light[i2] & 15; count++; }
      if (!s3 && !(s1 && s2)) { sky += light[i3] >> 4; blk += light[i3] & 15; count++; }
      sSky[i] = Math.round((sky / count) * 17);
      sBlk[i] = Math.round((blk / count) * 17);
      sShade[i] = Math.round(AO_CURVE[ao] * FACE_SHADE[f] * 255);
    }
    // Flip the diagonal where ambient occlusion is uneven, or the dark corner
    // bleeds across the whole quad as a visible streak.
    if (sShade[0] + sShade[2] < sShade[1] + sShade[3]) this.emitRotated(b, layer, flags, r, g, bl, tintMode);
    else b.quad(sx, sy, sz, su, sv, layer, sSky, sBlk, sShade, flags, r, g, bl, tintMode);
  }

  private emitRotated(b: Builder, layer: number, flags: number, r: number, g: number, bl: number, tintMode: number): void {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      rx[i] = sx[j]; ry[i] = sy[j]; rz[i] = sz[j]; ru[i] = su[j]; rv[i] = sv[j];
      rSky[i] = sSky[j]; rBlk[i] = sBlk[j]; rShade[i] = sShade[j];
    }
    b.quad(rx, ry, rz, ru, rv, layer, rSky, rBlk, rShade, flags, r, g, bl, tintMode);
  }

  private flatLight(input: MeshInput, x: number, y: number, z: number, shade: number): void {
    const l = input.light[padIndex(x, y, z)];
    for (let i = 0; i < 4; i++) {
      sSky[i] = (l >> 4) * 17; sBlk[i] = (l & 15) * 17; sShade[i] = Math.round(shade * 255);
    }
  }

  /** Emits the current scratch quad on both sides — plants are seen from either. */
  private twoSided(b: Builder, layer: number, flags: number, r: number, g: number, bl: number, tintMode: number): void {
    b.quad(sx, sy, sz, su, sv, layer, sSky, sBlk, sShade, flags, r, g, bl, tintMode);
    for (let i = 0; i < 4; i++) {
      const j = 3 - i;
      rx[i] = sx[j]; ry[i] = sy[j]; rz[i] = sz[j]; ru[i] = su[j]; rv[i] = sv[j];
      rSky[i] = sSky[j]; rBlk[i] = sBlk[j]; rShade[i] = sShade[j];
    }
    b.quad(rx, ry, rz, ru, rv, layer, rSky, rBlk, rShade, flags, r, g, bl, tintMode);
  }

  private cross(b: Builder, input: MeshInput, x: number, y: number, z: number, def: BlockDef, m: number, r: number, g: number, bl: number, tintMode: number): void {
    const layer = this.layer(def, m, Face.South);
    // Small per-position jitter, so a meadow is not a grid of identical flowers.
    const h = ((x * 73856093) ^ (z * 19349663) ^ (y * 83492791)) >>> 0;
    // Fire stands square in its block, as the original's does; plants are scattered a little.
    const jitter = def.id === B.SUGAR_CANE || def.id === B.COBWEB || def.animated ? 0 : 1;
    const ox = jitter * (((h & 7) - 3.5) * 0.7), oz = jitter * ((((h >> 3) & 7) - 3.5) * 0.7);
    const bx = x * 16 + ox, bz = z * 16 + oz, by = y * 16;
    const flags = def.animated ? FLAG_ANIMATED : def.waves ? FLAG_WAVE_TOP : 0;
    this.flatLight(input, x, y, z, 0.9);
    const lo = 1.6, hi = 14.4;
    for (const diag of [0, 1]) {
      const x0 = bx + lo, x1 = bx + hi;
      const z0 = bz + (diag ? hi : lo), z1 = bz + (diag ? lo : hi);
      sx[0] = x0; sy[0] = by; sz[0] = z0; su[0] = 0; sv[0] = 16;
      sx[1] = x1; sy[1] = by; sz[1] = z1; su[1] = 16; sv[1] = 16;
      sx[2] = x1; sy[2] = by + 16; sz[2] = z1; su[2] = 16; sv[2] = 0;
      sx[3] = x0; sy[3] = by + 16; sz[3] = z0; su[3] = 0; sv[3] = 0;
      this.twoSided(b, layer, flags, r, g, bl, tintMode);
    }
  }

  private crop(b: Builder, input: MeshInput, x: number, y: number, z: number, def: BlockDef, m: number): void {
    const layer = this.layer(def, m, Face.South);
    this.flatLight(input, x, y, z, 0.9);
    const by = y * 16 - 1;
    for (const [axis, off] of [[0, 4], [0, 12], [1, 4], [1, 12]] as const) {
      for (let i = 0; i < 4; i++) {
        const along = i === 0 || i === 3 ? 0 : 16;
        const up = i >= 2 ? 16 : 0;
        if (axis === 0) { sx[i] = x * 16 + off; sz[i] = z * 16 + along; }
        else { sx[i] = x * 16 + along; sz[i] = z * 16 + off; }
        sy[i] = by + up;
        su[i] = along; sv[i] = 16 - up;
      }
      this.twoSided(b, layer, FLAG_WAVE_TOP, 255, 255, 255, TINT_NONE);
    }
  }

  private boxes(b: Builder, input: MeshInput, x: number, y: number, z: number, def: BlockDef, m: number, r: number, g: number, bl: number, tintMode: number): void {
    const { blocks, light } = input;
    const list = modelBoxes(def, m);
    const facing = m & 3;
    const bed = isBed(def.id);
    // A wall torch is the standing torch moved; its texture must not move with it.
    const torchUV: Box | null = (def.id === B.TORCH || isRedstoneTorch(def.id)) && m > 0 ? [7, 0, 7, 9, 10, 9] : null;
    for (let bi = 0; bi < list.length; bi++) {
      const box = list[bi];
      const uvFrom = def.boxUV ? def.boxUV(m, bi) : torchUV;
      const [x0, y0, z0, x1, y1, z1] = box;
      for (let f = 0; f < 6; f++) {
        const n = NORMALS[f];
        const onEdge =
          (f === 0 && x1 === 16) || (f === 1 && x0 === 0) || (f === 2 && y1 === 16) ||
          (f === 3 && y0 === 0) || (f === 4 && z1 === 16) || (f === 5 && z0 === 0);
        const ni = padIndex(x + n[0], y + n[1], z + n[2]);
        if (onEdge && this.opaque[blocks[ni]]) continue;
        // Faces flush against the same block (glass pane arms, double slabs) would z-fight.
        if (onEdge && blocks[ni] === def.id && !isDoor(def.id) && !isBed(def.id)) continue;
        const corners = FACE_CORNERS[f];
        const l = light[onEdge ? ni : padIndex(x, y, z)];
        const lookFrom = onEdge ? l : Math.max(l, light[ni]);
        for (let i = 0; i < 4; i++) {
          const c = corners[i];
          const px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
          sx[i] = x * 16 + px; sy[i] = y * 16 + py; sz[i] = z * 16 + pz;
          let uv = uvFrom
            ? faceUV(f, px - x0 + uvFrom[0], py - y0 + uvFrom[1], pz - z0 + uvFrom[2])
            : faceUV(f, px, py, pz);
          if (bed && f === Face.Up) uv = rotateUV(uv[0], uv[1], facing);
          else if (def.uvRotation) {
            const rot = def.uvRotation(m, f);
            if (rot) uv = rotateUV(uv[0], uv[1], rot);
          }
          su[i] = uv[0]; sv[i] = uv[1];
          sSky[i] = (lookFrom >> 4) * 17; sBlk[i] = (lookFrom & 15) * 17;
          sShade[i] = Math.round(FACE_SHADE[f] * 255);
        }
        const named = def.boxTexture ? def.boxTexture(m, bi, f) : undefined;
        const layer = named ? this.lookupCached(named) : this.layer(def, m, f);
        b.quad(sx, sy, sz, su, sv, layer, sSky, sBlk, sShade, def.animated ? FLAG_ANIMATED : 0, r, g, bl, tintMode);
      }
    }
  }

  private named = new Map<string, number>();
  private lookupCached(name: string): number {
    let l = this.named.get(name);
    if (l === undefined) { l = this.lookup(name); this.named.set(name, l); }
    return l;
  }

  /**
   * Redstone dust: a flat trail on the floor toward each connection (and up
   * the side of a block it climbs), tinted from dull to bright by its power.
   * Drawn from a centre blob plus half-lines so every one of the sixteen
   * shapes comes from two small textures.
   */
  private wire(b: Builder, input: MeshInput, x: number, y: number, z: number, m: number): void {
    const get = (px: number, py: number, pz: number) => input.blocks[padIndex(px, py, pz)];
    const meta = (px: number, py: number, pz: number) => input.meta[padIndex(px, py, pz)];
    const conn = [0, 1, 2, 3].map((d) => dustConnection(get, meta, x, y, z, d));
    const on = conn.map((c) => c !== 0);
    const count = on.filter(Boolean).length;
    if (count === 1) on[on.indexOf(true) ^ 1] = true;
    const straight = (on[0] && on[1] && !on[2] && !on[3]) || (on[2] && on[3] && !on[0] && !on[1]);
    const [r, g, bl] = dustColor(m & 15);
    const line = this.lookupCached("redstone_dust_line");
    const dot = this.lookupCached("redstone_dust_dot");
    this.flatLight(input, x, y, z, 1);
    const bx = x * 16, bz = z * 16, fy = y * 16 + 1;
    // Floor quads in +y corner order: (x0,z1) (x1,z1) (x1,z0) (x0,z0).
    const floor = (x0: number, z0: number, x1: number, z1: number, alongX: boolean, layer: number) => {
      const xs = [x0, x1, x1, x0], zs = [z1, z1, z0, z0];
      for (let i = 0; i < 4; i++) {
        sx[i] = bx + xs[i]; sy[i] = fy; sz[i] = bz + zs[i];
        // The line runs along v; for an east-west arm, turn it.
        if (alongX) { su[i] = zs[i]; sv[i] = xs[i]; } else { su[i] = xs[i]; sv[i] = zs[i]; }
      }
      b.quad(sx, sy, sz, su, sv, layer, sSky, sBlk, sShade, 0, r, g, bl, TINT_FULL);
    };
    if (count === 0 || !straight) floor(0, 0, 16, 16, false, dot);
    if (on[0]) floor(0, 0, 16, 8, false, line);   // north
    if (on[1]) floor(0, 8, 16, 16, false, line);  // south
    if (on[2]) floor(0, 0, 8, 16, true, line);    // west
    if (on[3]) floor(8, 0, 16, 16, true, line);   // east
    // Up the side of the next block.
    for (let d = 0; d < 4; d++) {
      if (conn[d] !== 2) continue;
      const [dx, dz] = FACING_DIRS[d];
      const face = dx > 0 ? 1 : dx < 0 ? 0 : dz > 0 ? 5 : 4; // the wall's face that looks back at the dust
      const corners = FACE_CORNERS[face];
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        let px = c[0] * 16, pz = c[2] * 16;
        if (dx > 0) px = 15; else if (dx < 0) px = 1;
        if (dz > 0) pz = 15; else if (dz < 0) pz = 1;
        const py = c[1] * 16;
        sx[i] = bx + px; sy[i] = y * 16 + py; sz[i] = bz + pz;
        su[i] = dx !== 0 ? c[2] * 16 : c[0] * 16; sv[i] = 16 - py;
      }
      b.quad(sx, sy, sz, su, sv, line, sSky, sBlk, sShade, 0, r, g, bl, TINT_FULL);
    }
  }

  /**
   * A rail: one quad a pixel above the floor, turned to its shape, or tilted
   * up a slope from the low edge to the next block's floor. The textures are
   * painted with the track running along v; curves join the south and east edges.
   */
  private rail(b: Builder, input: MeshInput, x: number, y: number, z: number, def: BlockDef, m: number): void {
    const shape = railShape(def.id, m);
    const layer = this.layer(def, m, Face.Up);
    // Slopes catch the light of the block above them, as they lie half inside it.
    this.flatLight(input, x, isSlope(shape) ? y + 1 : y, z, 1);
    const bx = x * 16, bz = z * 16, fy = y * 16 + 1;
    const xs = [0, 16, 16, 0], zs = [16, 16, 0, 0];
    for (let i = 0; i < 4; i++) {
      const lx = xs[i], lz = zs[i];
      let u = lx, v = lz, h = 0;
      switch (shape) {
        case 1: u = lz; v = lx; break;
        case 2: u = lz; v = 16 - lx; h = lx; break;
        case 3: u = lz; v = lx; h = 16 - lx; break;
        case 4: h = 16 - lz; break;
        case 5: h = lz; v = 16 - lz; break;
        case 7: u = 16 - lx; break;
        case 8: u = 16 - lx; v = 16 - lz; break;
        case 9: v = 16 - lz; break;
      }
      sx[i] = bx + lx; sy[i] = fy + h; sz[i] = bz + lz; su[i] = u; sv[i] = v;
    }
    b.quad(sx, sy, sz, su, sv, layer, sSky, sBlk, sShade, 0, 255, 255, 255, TINT_NONE);
  }

  private fluidHeight(input: MeshInput, id: number, x: number, y: number, z: number): number {
    const i = padIndex(x, y, z);
    if (input.blocks[i] !== id) return -1;
    if (input.blocks[padIndex(x, y + 1, z)] === id) return 16;
    const m = input.meta[i];
    if (m & 8) return 15;
    const level = m & 7;
    return level === 0 ? 14.2 : Math.max(2, ((8 - level) / 9) * 16);
  }

  private cornerHeight(input: MeshInput, id: number, x: number, y: number, z: number, cx: number, cz: number): number {
    // The four columns sharing this corner.
    let sum = 0, count = 0;
    for (let dz = cz - 1; dz <= cz; dz++) {
      for (let dx = cx - 1; dx <= cx; dx++) {
        const nx = x + dx, nz = z + dz;
        if (input.blocks[padIndex(nx, y + 1, nz)] === id) return 16;
        const h = this.fluidHeight(input, id, nx, y, nz);
        if (h >= 0) { sum += h; count++; }
        else if (!this.opaque[input.blocks[padIndex(nx, y, nz)]]) count += 0.25;
      }
    }
    return count > 0 ? sum / count : 14.2;
  }

  private fluid(b: Builder, input: MeshInput, x: number, y: number, z: number, def: BlockDef, m: number, r: number, g: number, bl: number): void {
    const id = def.id;
    const { blocks } = input;
    const layer = this.layer(def, m, Face.Up);
    const tintMode = id === B.WATER ? TINT_FULL : TINT_NONE;
    const flags = FLAG_ANIMATED;
    const h00 = this.cornerHeight(input, id, x, y, z, 0, 0);
    const h10 = this.cornerHeight(input, id, x, y, z, 1, 0);
    const h11 = this.cornerHeight(input, id, x, y, z, 1, 1);
    const h01 = this.cornerHeight(input, id, x, y, z, 0, 1);
    const bx = x * 16, by = y * 16, bz = z * 16;
    const above = blocks[padIndex(x, y + 1, z)];
    if (above !== id) {
      this.flatLight(input, x, y + 1, z, 1);
      sx[0] = bx; sy[0] = by + h01; sz[0] = bz + 16; su[0] = 0; sv[0] = 16;
      sx[1] = bx + 16; sy[1] = by + h11; sz[1] = bz + 16; su[1] = 16; sv[1] = 16;
      sx[2] = bx + 16; sy[2] = by + h10; sz[2] = bz; su[2] = 16; sv[2] = 0;
      sx[3] = bx; sy[3] = by + h00; sz[3] = bz; su[3] = 0; sv[3] = 0;
      // Both sides: from under water the surface must still be there.
      this.twoSided(b, layer, flags, r, g, bl, tintMode);
    }
    const sides: [number, number, number][] = [[0, 1, 0], [1, -1, 0], [4, 0, 1], [5, 0, -1]];
    for (const [f, dx, dz] of sides) {
      const nid = blocks[padIndex(x + dx, y, z + dz)];
      if (nid === id || this.opaque[nid]) continue;
      const corners = FACE_CORNERS[f];
      this.flatLight(input, x + dx, y, z + dz, FACE_SHADE[f]);
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        const top = c[1] === 1;
        const ch = c[0] === 0 ? (c[2] === 0 ? h00 : h01) : c[2] === 0 ? h10 : h11;
        const py = top ? ch : 0;
        sx[i] = bx + c[0] * 16; sy[i] = by + py; sz[i] = bz + c[2] * 16;
        const uv = faceUV(f, c[0] * 16, py, c[2] * 16);
        su[i] = uv[0]; sv[i] = uv[1];
      }
      this.twoSided(b, layer, flags, r, g, bl, tintMode);
    }
    const below = blocks[padIndex(x, y - 1, z)];
    if (below !== id && !this.opaque[below]) {
      this.flatLight(input, x, y - 1, z, 0.5);
      const corners = FACE_CORNERS[3];
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        sx[i] = bx + c[0] * 16; sy[i] = by; sz[i] = bz + c[2] * 16;
        const uv = faceUV(3, c[0] * 16, 0, c[2] * 16);
        su[i] = uv[0]; sv[i] = uv[1];
      }
      b.quad(sx, sy, sz, su, sv, layer, sSky, sBlk, sShade, flags, r, g, bl, tintMode);
    }
  }
}

/** Copies a chunk and the border of its eight neighbours into padded arrays for the mesher. */
export function buildPadded(
  get: (cx: number, cz: number) => { blocks: Uint16Array; meta: Uint8Array; light: Uint8Array } | undefined,
  cx: number,
  cz: number,
): { blocks: Uint16Array; meta: Uint8Array; light: Uint8Array } {
  const blocks = new Uint16Array(PADDED_VOLUME);
  const meta = new Uint8Array(PADDED_VOLUME);
  const light = new Uint8Array(PADDED_VOLUME);
  // Below the world reads as solid (no faces rendered downward into the void);
  // above it is open air in full sky light.
  for (let z = -1; z <= 16; z++) {
    for (let x = -1; x <= 16; x++) {
      blocks[padIndex(x, -1, z)] = B.BEDROCK;
      light[padIndex(x, WORLD_HEIGHT, z)] = 0xf0;
    }
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = get(cx + dx, cz + dz);
      const xs = dx < 0 ? 15 : 0, xe = dx > 0 ? 0 : 15;
      const zs = dz < 0 ? 15 : 0, ze = dz > 0 ? 0 : 15;
      for (let lz = zs; lz <= ze; lz++) {
        for (let lx = xs; lx <= xe; lx++) {
          const px = lx + dx * 16, pz = lz + dz * 16;
          for (let y = 0; y < WORLD_HEIGHT; y++) {
            const pi = padIndex(px, y, pz);
            if (!c) {
              // A missing neighbour is drawn as if walled off and dark, never as a hole.
              blocks[pi] = B.STONE;
              continue;
            }
            const si = (y << 8) | (lz << 4) | lx;
            blocks[pi] = c.blocks[si];
            meta[pi] = c.meta[si];
            light[pi] = c.light[si];
          }
        }
      }
    }
  }
  return { blocks, meta, light };
}
