/**
 * 3D models for items: in the hand, on the ground, in a mob's grip.
 *
 * Blocks are meshed by the same mesher as the world, from a one-block volume,
 * so a slab in the hand is a slab and a stair is a stair without a second
 * model definition for either. Flat items are extruded from their sprite —
 * front and back faces plus a one-pixel rim along every edge between an
 * opaque and a clear pixel — which is what gives a sword in hand its
 * thickness.
 */
import * as THREE from "three";
import { block } from "../engine/blocks";
import { layerOf, layerPixels } from "../engine/atlas";
import { itemDef } from "../engine/items";
import { Mesher, padIndex, PADDED_VOLUME, type LayerMesh } from "../engine/mesher";
import { DEFAULT_TINTS } from "../engine/textures";

let mesher: Mesher | null = null;
const blockCache = new Map<string, THREE.BufferGeometry>();
const spriteCache = new Map<string, THREE.BufferGeometry>();

function defaultTints(): Uint8Array {
  const t = new Uint8Array(256 * 9);
  const g = DEFAULT_TINTS.grass, f = DEFAULT_TINTS.foliage, w = DEFAULT_TINTS.water;
  for (let i = 0; i < 256; i++) {
    t.set([g[0], g[1], g[2], f[0], f[1], f[2], w[0], w[1], w[2]], i * 9);
  }
  return t;
}

function merge(layers: LayerMesh[]): THREE.BufferGeometry {
  const quads = layers.reduce((n, l) => n + l.quads, 0);
  // Float, not the chunk's Int16: this geometry is scaled down to block units
  // below, and scaling an integer attribute would truncate every vertex to 0 or 1.
  const pos = new Float32Array(quads * 12), tex = new Uint8Array(quads * 16), light = new Uint8Array(quads * 16), color = new Uint8Array(quads * 16);
  let q = 0;
  for (const l of layers) {
    pos.set(l.positions, q * 12); tex.set(l.tex, q * 16); light.set(l.light, q * 16); color.set(l.color, q * 16);
    q += l.quads;
  }
  const idx = new Uint16Array(quads * 6);
  for (let i = 0; i < quads; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aTex", new THREE.BufferAttribute(tex, 4));
  g.setAttribute("aLight", new THREE.BufferAttribute(light, 4));
  g.setAttribute("aColor", new THREE.BufferAttribute(color, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // Positions are in sixteenths; centre the block on x/z, feet at 0.
  g.translate(-8, 0, -8);
  g.scale(1 / 16, 1 / 16, 1 / 16);
  g.computeBoundingSphere();
  return g;
}

/** A single block as geometry in chunk vertex format (for the lit block material). */
export function blockGeometry(id: number, meta = 0): THREE.BufferGeometry {
  const key = `${id}:${meta}`;
  const hit = blockCache.get(key);
  if (hit) return hit;
  mesher ??= new Mesher(layerOf);
  const blocks = new Uint16Array(PADDED_VOLUME);
  const metas = new Uint8Array(PADDED_VOLUME);
  const light = new Uint8Array(PADDED_VOLUME).fill(0xf0);
  blocks[padIndex(0, 0, 0)] = id;
  metas[padIndex(0, 0, 0)] = meta;
  const m = mesher.mesh({ blocks, meta: metas, light, tints: defaultTints(), fancyLeaves: true, smoothLighting: false });
  const g = merge([m.opaque, m.cutout, m.translucent]);
  blockCache.set(key, g);
  return g;
}

/** An extruded sprite: `name` is an atlas texture. Unit size, centred, facing +z. */
export function spriteGeometry(name: string): THREE.BufferGeometry {
  const hit = spriteCache.get(name);
  if (hit) return hit;
  const px = layerPixels(name);
  const layer = layerOf(name);
  const pos: number[] = [], uv: number[] = [], lay: number[] = [], shade: number[] = [], idx: number[] = [];
  const t = 1 / 16 / 2;
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && px[(y * 16 + x) * 4 + 3] >= 128;
  const quad = (a: number[], b: number[], c: number[], d: number[], u0: number, v0: number, u1: number, v1: number, s: number) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    // Atlas v runs top to bottom.
    uv.push(u0, v1, u1, v1, u1, v0, u0, v0);
    lay.push(layer, layer, layer, layer);
    shade.push(s, s, s, s);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const X = (x: number) => x / 16 - 0.5, Y = (y: number) => 0.5 - y / 16;
  // Front and back.
  quad([-0.5, -0.5, t], [0.5, -0.5, t], [0.5, 0.5, t], [-0.5, 0.5, t], 0, 0, 1, 1, 1);
  quad([0.5, -0.5, -t], [-0.5, -0.5, -t], [-0.5, 0.5, -t], [0.5, 0.5, -t], 1, 0, 0, 1, 0.8);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!opaque(x, y)) continue;
      const u0 = x / 16, u1 = (x + 1) / 16, v0 = y / 16, v1 = (y + 1) / 16;
      const x0 = X(x), x1 = X(x + 1), y0 = Y(y + 1), y1 = Y(y);
      if (!opaque(x - 1, y)) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], u0, v0, u1, v1, 0.7);
      if (!opaque(x + 1, y)) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], u0, v0, u1, v1, 0.7);
      if (!opaque(x, y - 1)) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], u0, v0, u1, v1, 0.95);
      if (!opaque(x, y + 1)) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], u0, v0, u1, v1, 0.55);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aLayer", new THREE.Float32BufferAttribute(lay, 1));
  g.setAttribute("aShade", new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  spriteCache.set(name, g);
  return g;
}

export type ItemModelKind = "block" | "sprite";

/** Which model an item uses, and the geometry for it. */
export function itemModel(itemId: number): { kind: ItemModelKind; geometry: THREE.BufferGeometry } {
  const def = itemDef(itemId);
  if (def && def.places !== undefined && !def.icon) {
    const b = block(def.places);
    if (b.shape === "cube" || b.shape === "boxes") return { kind: "block", geometry: blockGeometry(def.places, 0) };
  }
  const icon = def?.icon ?? block(itemId).textures.side;
  return { kind: "sprite", geometry: spriteGeometry(icon) };
}

