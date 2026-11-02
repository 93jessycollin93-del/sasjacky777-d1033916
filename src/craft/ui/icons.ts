/**
 * Inventory icons, drawn once from the same painted textures as the world.
 *
 * Blocks become little isometric cubes (top, front and side, the side faces
 * shaded) so a slot full of stone looks like stone, not a flat grey square.
 * Items are their 16×16 sprite. Both are cached as data URLs and scaled up
 * pixel-sharp by CSS.
 */
import { block, faceTexture, Face, isSlab } from "../engine/blocks";
import { layerPixels } from "../engine/atlas";
import { itemDef } from "../engine/items";
import { DEFAULT_TINTS } from "../engine/textures";

const cache = new Map<number, string>();

function texCanvas(name: string, tint: readonly [number, number, number] | null, masked: boolean, shade = 1): HTMLCanvasElement {
  const px = layerPixels(name);
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    if (tint) {
      const amount = masked ? 1 - px[i + 3] / 255 : 1;
      r = r * (1 - amount + (amount * tint[0]) / 255);
      g = g * (1 - amount + (amount * tint[1]) / 255);
      b = b * (1 - amount + (amount * tint[2]) / 255);
      if (masked) px[i + 3] = 255;
    }
    px[i] = r * shade; px[i + 1] = g * shade; px[i + 2] = b * shade;
  }
  const c = document.createElement("canvas");
  c.width = 16; c.height = 16;
  c.getContext("2d")!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, 16, 16), 0, 0);
  return c;
}

function tintFor(tint: string): readonly [number, number, number] | null {
  switch (tint) {
    case "grass": return DEFAULT_TINTS.grass;
    case "foliage": return DEFAULT_TINTS.foliage;
    case "birch": return DEFAULT_TINTS.birch;
    case "spruce": return DEFAULT_TINTS.spruce;
    case "water": return DEFAULT_TINTS.water;
    default: return null;
  }
}

function cubeIcon(blockId: number): string {
  const def = block(blockId);
  const c = document.createElement("canvas");
  c.width = 32; c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const tint = tintFor(def.tint);
  const grass = def.name === "grass_block";
  const top = texCanvas(faceTexture(def, 1, Face.Up), tint, false);
  // The front (furnace mouth, pumpkin face) shows on the left face, as in the original.
  const left = texCanvas(faceTexture(def, 1, Face.South), grass ? tint : tint, grass, 0.82);
  const right = texCanvas(faceTexture(def, 1, Face.East), grass ? tint : tint, grass, 0.62);
  const half = isSlab(blockId);
  const h = half ? 8 : 16;
  const drop = half ? 8 : 0;
  // Top face.
  ctx.setTransform(14 / 16, -7 / 16, 14 / 16, 7 / 16, 2, 8 + drop);
  ctx.drawImage(top, 0, 0);
  // Left and right faces (only their lower half for a slab).
  ctx.setTransform(14 / 16, 7 / 16, 0, 1, 2, 8 + drop);
  ctx.drawImage(left, 0, 16 - h, 16, h, 0, 0, 16, h);
  ctx.setTransform(14 / 16, -7 / 16, 0, 1, 16, 15 + drop);
  ctx.drawImage(right, 0, 16 - h, 16, h, 0, 0, 16, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL();
}

function flatIcon(name: string, tint: readonly [number, number, number] | null): string {
  return texCanvas(name, tint, false).toDataURL();
}

export function iconFor(itemId: number): string {
  const hit = cache.get(itemId);
  if (hit) return hit;
  const def = itemDef(itemId);
  let url: string;
  if (!def) url = "";
  else if (def.icon) {
    const b = def.places !== undefined ? block(def.places) : null;
    url = flatIcon(def.icon, b && b.shape === "cross" ? tintFor(b.tint) : b?.name === "lily_pad" ? tintFor("foliage") : null);
  } else if (def.places !== undefined) url = cubeIcon(def.places);
  else url = flatIcon(def.name, null);
  cache.set(itemId, url);
  return url;
}

// ---- HUD glyphs ------------------------------------------------------------------------------

const GLYPHS: Record<string, { rows: string[]; colors: Record<string, string> }> = {
  heart: {
    rows: [".kk.kk..", "krrkrrk.", "kwrrrrk.", "krrrrrk.", ".krrrk..", "..krk...", "...k....", "........"],
    colors: { k: "#1a0000", r: "#e01e1e", w: "#ffa0a0" },
  },
  heartHalf: {
    rows: [".kk.kk..", "krrkddk.", "kwrrddk.", "krrrddk.", ".krrdk..", "..krk...", "...k....", "........"],
    colors: { k: "#1a0000", r: "#e01e1e", w: "#ffa0a0", d: "#3a0a0a" },
  },
  heartEmpty: {
    rows: [".kk.kk..", "kddkddk.", "kdddddk.", "kdddddk.", ".kdddk..", "..kdk...", "...k....", "........"],
    colors: { k: "#1a0000", d: "#3a0a0a" },
  },
  heartGold: {
    rows: [".kk.kk..", "kyykyyk.", "kwyyyyk.", "kyyyyyk.", ".kyyyk..", "..kyk...", "...k....", "........"],
    colors: { k: "#2a1a00", y: "#f5c518", w: "#fff0a0" },
  },
  food: {
    rows: ["....kk..", "...kbbk.", "..kbbbk.", ".kbbbk..", "kwkbk...", "kwwk....", ".kk.....", "........"],
    colors: { k: "#1a0e00", b: "#b8641c", w: "#f0e0c8" },
  },
  foodHalf: {
    rows: ["....kk..", "...kddk.", "..kddbk.", ".kbbbk..", "kwkbk...", "kwwk....", ".kk.....", "........"],
    colors: { k: "#1a0e00", b: "#b8641c", w: "#f0e0c8", d: "#3a2210" },
  },
  foodEmpty: {
    rows: ["....kk..", "...kddk.", "..kdddk.", ".kdddk..", "kdkdk...", "kddk....", ".kk.....", "........"],
    colors: { k: "#1a0e00", d: "#3a2210" },
  },
  armor: {
    rows: ["kkk.kkk.", "kwwkwwk.", "kwwwwwk.", "kwwwwwk.", ".kwwwk..", ".kwwwk..", "..kkk...", "........"],
    colors: { k: "#1a1a1a", w: "#d8d8d8" },
  },
  armorHalf: {
    rows: ["kkk.kkk.", "kwwkddk.", "kwwwddk.", "kwwwddk.", ".kwwdk..", ".kwwdk..", "..kkk...", "........"],
    colors: { k: "#1a1a1a", w: "#d8d8d8", d: "#3a3a3a" },
  },
  // Thirst (engine/vitals.ts): a drop of water, half, and empty.
  water: {
    rows: ["...k....", "..kbk...", ".kbbbk..", "kbwbbbk.", "kbwbbbk.", "kbbbbbk.", ".kbbbk..", "..kkk..."],
    colors: { k: "#0a1a3a", b: "#3a8af0", w: "#bfe0ff" },
  },
  waterHalf: {
    rows: ["...k....", "..kdk...", ".kddbk..", "kddbbbk.", "kddbbbk.", "kddbbbk.", ".kdbbk..", "..kkk..."],
    colors: { k: "#0a1a3a", b: "#3a8af0", d: "#14284a" },
  },
  waterEmpty: {
    rows: ["...k....", "..kdk...", ".kdddk..", "kdddddk.", "kdddddk.", "kdddddk.", ".kdddk..", "..kkk..."],
    colors: { k: "#0a1a3a", d: "#14284a" },
  },
  bubble: {
    rows: ["..kkk...", ".kbbbk..", "kbwbbbk.", "kbbbbbk.", "kbbbbbk.", ".kbbbk..", "..kkk...", "........"],
    colors: { k: "#1a3a6a", b: "#5ab4f0", w: "#ffffff" },
  },
};

const glyphCache = new Map<string, string>();

export function glyph(name: keyof typeof GLYPHS | string): string {
  const hit = glyphCache.get(name);
  if (hit) return hit;
  const g = GLYPHS[name];
  if (!g) return "";
  const c = document.createElement("canvas");
  c.width = 8; c.height = 8;
  const ctx = c.getContext("2d")!;
  g.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const color = g.colors[ch];
    if (color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
  }));
  const url = c.toDataURL();
  glyphCache.set(name, url);
  return url;
}

/** A tiled background from a block texture (menu panels, the loading screen). */
export function textureBackground(name: string, darken = 0.25): string {
  const key = `bg:${name}:${darken}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const url = texCanvas(name, null, false, 1 - darken).toDataURL();
  glyphCache.set(key, url);
  return url;
}
