/**
 * Mob and player skins, painted onto 64×64 canvases in the classic box-unwrap
 * layout: each box is laid out as top and bottom over a strip of its four
 * sides. The same region maths maps the canvas back onto the model's boxes
 * (models.ts), so painting and mapping cannot disagree.
 *
 * All original art. Faces, snouts, spots and patches are drawn pixel by pixel
 * from a few colours and a seeded noise, so every copy of the game shows the
 * same pig.
 */
import { Rng } from "../engine/rng";
import { DINO_COLORS, dinoBoxes, type Role } from "./dinoModels";
import { CRITTER_COLORS, critterBoxes } from "./critterModels";

export type Face = "top" | "bottom" | "west" | "front" | "east" | "back";

export interface Region { x: number; y: number; w: number; h: number }

/** Where each face of a w×h×d box at (u, v) sits on the skin. */
export function boxRegions(u: number, v: number, w: number, h: number, d: number): Record<Face, Region> {
  return {
    top: { x: u + d, y: v, w, h: d },
    bottom: { x: u + d + w, y: v, w, h: d },
    west: { x: u, y: v + d, w: d, h },
    front: { x: u + d, y: v + d, w, h },
    east: { x: u + d + w, y: v + d, w: d, h },
    back: { x: u + d + w + d, y: v + d, w, h },
  };
}

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

class SkinPainter {
  readonly canvas: HTMLCanvasElement;
  private img: ImageData;
  private rng: Rng;
  constructor(seed: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 64; this.canvas.height = 64;
    this.img = new ImageData(64, 64);
    this.rng = new Rng(seed);
  }
  px(x: number, y: number, c: RGB, jitter = 0): void {
    if (x < 0 || y < 0 || x >= 64 || y >= 64) return;
    const f = 1 + (this.rng.next() - 0.5) * jitter;
    const i = (y * 64 + x) * 4;
    this.img.data[i] = Math.min(255, c[0] * f);
    this.img.data[i + 1] = Math.min(255, c[1] * f);
    this.img.data[i + 2] = Math.min(255, c[2] * f);
    this.img.data[i + 3] = 255;
  }
  fill(r: Region, c: RGB | ((x: number, y: number) => RGB), jitter = 0.08): void {
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) this.px(r.x + x, r.y + y, typeof c === "function" ? c(x, y) : c, jitter);
  }
  box(u: number, v: number, w: number, h: number, d: number, c: RGB | ((face: Face, x: number, y: number) => RGB), jitter = 0.08): Record<Face, Region> {
    const regions = boxRegions(u, v, w, h, d);
    for (const face of Object.keys(regions) as Face[]) {
      this.fill(regions[face], typeof c === "function" ? (x, y) => c(face, x, y) : c, jitter);
    }
    return regions;
  }
  random(): number {
    return this.rng.next();
  }
  done(): HTMLCanvasElement {
    this.canvas.getContext("2d")!.putImageData(this.img, 0, 0);
    return this.canvas;
  }
}

/** Two dark eyes with a light highlight, drawn on a face region at (ex, ey) from its top-left. */
function eyes(p: SkinPainter, face: Region, y: number, xs: number[], white: RGB | null, pupil: RGB): void {
  for (const x of xs) {
    if (white) p.px(face.x + x, face.y + y, white, 0);
    p.px(face.x + x + (white ? 1 : 0), face.y + y, pupil, 0);
  }
}

// ---- mobs -------------------------------------------------------------------------------

export const SKIN_LAYOUT = {
  humanoid: { head: [0, 0], body: [16, 16], arm: [40, 16], leg: [0, 16], thinArm: [40, 16], thinLeg: [0, 16] },
};

function humanoid(p: SkinPainter, skin: RGB, hair: RGB, shirt: RGB, pants: RGB, shoes: RGB, eye: RGB): void {
  const head = p.box(0, 0, 8, 8, 8, (face, x, y) => {
    if (face === "top") return hair;
    if (face === "bottom") return skin;
    if (y < 2 || (face === "back" && y < 7) || ((face === "west" || face === "east") && y < 4 && x > 2)) return hair;
    return skin;
  });
  eyes(p, head.front, 4, [1, 5], [240, 240, 240], eye);
  p.px(head.front.x + 3, head.front.y + 6, [skin[0] * 0.7, skin[1] * 0.6, skin[2] * 0.6], 0);
  p.px(head.front.x + 4, head.front.y + 6, [skin[0] * 0.7, skin[1] * 0.6, skin[2] * 0.6], 0);
  p.box(16, 16, 8, 12, 4, (face, _x, y) => (face === "bottom" ? pants : y > 10 ? pants : shirt));
  p.box(40, 16, 4, 12, 4, (face, _x, y) => (face === "bottom" ? skin : y < 5 ? shirt : skin));
  p.box(0, 16, 4, 12, 4, (face, _x, y) => (face === "bottom" || y > 9 ? shoes : pants));
}

/**
 * A creature's skin, box by box: hide on top and sides with its markings in
 * stripes across the back, a paler underside, eyes on the head, and each part
 * with a role of its own coloured to suit (a crest, a frill, horns, plates,
 * wing membrane, a leather saddle). Variants shift the hide a little, so a
 * herd is not a row of copies.
 */
function paintDino(p: SkinPainter, kind: string, variant: number): void {
  const c = DINO_COLORS[kind];
  if (!c) return;
  const tone = [1, 0.88, 1.1, 0.95][variant & 3];
  const shade = (h: string, f = 1): RGB => hex(h).map((v) => Math.max(0, Math.min(255, v * f * tone))) as RGB;
  const hide = shade(c.hide), belly = shade(c.belly), mark = shade(c.mark), accent = hex(c.accent);
  const bone: RGB = [232, 224, 200], leather: RGB = [122, 78, 44], strap: RGB = [70, 44, 24];
  const byRole: Partial<Record<Role, (face: Face, x: number, y: number) => RGB>> = {
    horn: () => bone, spike: () => bone, beak: () => hex("#d8b060"),
    crest: (_f, x, y) => ((x + y) % 3 === 0 ? mark : accent), frill: (_f, x, y) => ((x * 3 + y) % 5 === 0 ? mark : (x + y) % 7 === 0 ? bone : accent),
    plate: (_f, _x, y) => (y < 1 ? mark : accent),
    wing: (face, x, y) => (face === "top" || face === "bottom" ? ((x + y) % 4 === 0 ? mark : shade(c.hide, 1.15)) : mark),
    saddle: (face, x) => (face === "top" ? (x % 4 === 0 ? strap : leather) : strap),
  };
  for (const part of dinoBoxes(kind)) {
    const [w, h, d] = part.size;
    const paint = byRole[part.role] ?? ((face: Face, x: number, y: number): RGB => {
      if (face === "bottom") return belly;
      if (face === "top") return (x * 7 + y * 3) % 5 === 0 || y % 4 === 1 ? mark : hide;
      // Stripes down the flanks, a paler lower edge toward the belly.
      if (y >= h - Math.max(1, Math.floor(h / 4)) && part.role !== "leg") return belly;
      return (x + Math.floor(y / 2)) % 5 === 0 && y < h / 2 ? mark : hide;
    });
    const regions = p.box(part.uv[0], part.uv[1], w, h, d, paint, 0.1);
    if (part.role === "head") {
      // Eyes a third of the way back on each side, and nostrils at the snout.
      const eye: RGB = kind === "rex" || kind === "raptor" || kind === "dilo" ? [220, 170, 30] : [20, 16, 12];
      for (const side of ["west", "east"] as Face[]) {
        const r = regions[side];
        p.px(r.x + (side === "west" ? Math.floor(r.w / 3) : r.w - 1 - Math.floor(r.w / 3)), r.y + 1, eye, 0);
        p.px(r.x + (side === "west" ? Math.floor(r.w / 3) : r.w - 1 - Math.floor(r.w / 3)), r.y + 2, [12, 10, 8], 0);
      }
      const f = regions.front;
      p.px(f.x + 1, f.y + 1, [30, 20, 16], 0); p.px(f.x + f.w - 2, f.y + 1, [30, 20, 16], 0);
    }
    if (part.role === "jaw") {
      // Teeth along the jaw's top edge.
      const f = regions.front;
      for (let x = 0; x < f.w; x += 2) p.px(f.x + x, f.y, bone, 0);
    }
  }
}

/**
 * A critter's skin: its main colour over the top and sides with a soft
 * darker saddle along the back, a pale underside, and each feature in the
 * species' accent — a flame bright at the tip, leaves veined, fins striped,
 * a shell ringed, a glowing heart. Eyes are big and dark (critters are drawn
 * to be liked). Variant 1 is the rare colour: the same critter, its hues
 * turned round the wheel.
 */
function paintCritter(p: SkinPainter, key: string, variant: number): void {
  const species = key.slice("critter_".length);
  const c = CRITTER_COLORS[species];
  if (!c) return;
  const shiny = variant === 1;
  const tint = (h: string, f = 1): RGB => {
    let [r, g, b] = hex(h);
    // The rare colour: red to green to blue, a third of the way round.
    if (shiny) [r, g, b] = [b * 0.9 + r * 0.1, r * 0.9 + g * 0.1, g * 0.9 + b * 0.1];
    return [Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)];
  };
  const main = tint(c.main), dark = tint(c.main, 0.78), belly = tint(c.belly), accent = tint(c.accent), bright = tint(c.accent, 1.3);
  const eye: RGB = c.eye ? hex(c.eye) : [24, 20, 28];
  const leaf: RGB = shiny ? tint("#4aa83a") : hex("#4aa83a"), bark: RGB = hex("#5a4228"), bone: RGB = [236, 228, 208];
  const byRole: Partial<Record<Role, (face: Face, x: number, y: number, h: number) => RGB>> = {
    ear: (face) => (face === "front" ? accent : main),
    flame: (_f, x, y, h) => ((x + y) % 3 === 0 ? bright : y < h / 2 ? bright : accent),
    leaf: (_f, x, y) => (x === y || x + y === 3 ? tint("#2a7a2a") : c.accent.startsWith("#3") || c.accent.startsWith("#5") ? accent : leaf),
    fin: (_f, x) => (x % 2 === 0 ? accent : tint(c.accent, 0.8)),
    gill: () => accent,
    mane: (_f, x, y) => ((x * 3 + y) % 4 === 0 ? bright : accent),
    tooth: () => bone,
    horn: (_f, _x, y) => (species === "grovestag" || species === "fernfawn" ? bark : species === "cinderam" ? (y < 2 ? bright : accent) : bone),
    spike: (_f, _x, y) => (y === 0 ? bright : accent),
    shell: (_f, x, y) => ((x + y) % 4 === 0 ? tint(c.accent, 0.7) : species === "cocoonix" ? main : accent),
    moss: (_f, x, y) => ((x + y) % 3 === 0 ? tint("#7ac84a") : leaf),
    glow: () => bright,
    antenna: () => dark,
    tentacle: (_f, _x, y) => (y % 2 ? main : accent),
    lantern: (_f, x, y) => (x === 0 || y === 0 ? tint("#5a5a62") : tint("#2a2a32")),
    rock: (_f, x, y) => ((x + y) % 3 === 0 ? dark : tint(c.main, 1.12)),
    beak: () => accent,
    crest: () => accent,
    wing: (face, x, y) => (face === "top" ? ((x + y) % 5 === 0 ? accent : main) : face === "bottom" ? belly : dark),
    feather: (_f, x) => (x % 2 ? main : dark),
    jaw: () => belly,
  };
  for (const part of critterBoxes(key)) {
    const [w, h, d] = part.size;
    const role = part.role;
    const paint = byRole[role] ?? ((face: Face, x: number, y: number): RGB => {
      if (face === "bottom" || role === "belly") return belly;
      if (face === "top") return (x + y) % 6 === 0 ? dark : main;
      // A paler lower edge toward the belly; the odd darker fleck.
      if (y >= h - Math.max(1, Math.floor(h / 3)) && role !== "leg") return belly;
      return (x * 5 + y * 3) % 11 === 0 ? dark : main;
    });
    const regions = p.box(part.uv[0], part.uv[1], w, h, d, (f, x, y) => paint(f, x, y, h), 0.08);
    if (part.role === "head" && part.name === "head") {
      // Big eyes with a glint, on the front corners; a small mouth between.
      const f = regions.front;
      const ex = Math.max(0, Math.floor(f.w / 4));
      const ey = Math.max(0, Math.floor(f.h / 3));
      for (const x of [f.x + ex, f.x + f.w - 1 - ex]) {
        p.px(x, f.y + ey, eye, 0);
        if (f.h > 3) p.px(x, f.y + ey + 1, eye, 0);
        p.px(x, f.y + ey, [250, 250, 250], 0);
      }
      for (const x of [f.x + ex, f.x + f.w - 1 - ex]) p.px(x, f.y + ey + (f.h > 3 ? 1 : 0), eye, 0);
      if (f.w > 2 && f.h > 3) p.px(f.x + Math.floor(f.w / 2), f.y + f.h - 1, tint(c.main, 0.55), 0);
    }
  }
}

/** Trainers dressed for their calling: a youngster's cap, a hiker's beard, a professor's coat, a champion's blue and gold. */
const TRAINER_OUTFITS: Record<string, { shirt: string; pants: string; hair?: string; shoes?: string }> = {
  youngster: { shirt: "#3a6ab8", pants: "#c8a878", hair: "#c83a2a" }, lass: { shirt: "#e87aa8", pants: "#f0f0f0" },
  hiker: { shirt: "#6a7a3a", pants: "#6a4a2a", shoes: "#3a2a1a" }, swimmer: { shirt: "#e8b890", pants: "#2a8ae8" },
  bug_catcher: { shirt: "#5a9a3a", pants: "#c8b878", hair: "#e8d070" }, ace: { shirt: "#2a2a30", pants: "#b8303a" },
  ranger: { shirt: "#a8986a", pants: "#5a6a3a" }, mystic: { shirt: "#6a3a9a", pants: "#4a2a6a" }, tamer: { shirt: "#8a2a2a", pants: "#2a2a2a" },
  gym_leader: { shirt: "#f0f0f0", pants: "#d8b040" }, champion: { shirt: "#2a4aa8", pants: "#e8c040" }, rival: { shirt: "#e8782a", pants: "#2a3a5a" },
  professor: { shirt: "#f4f4f4", pants: "#5a5a60" }, tower: { shirt: "#1a1a22", pants: "#3a3a44" }, tycoon: { shirt: "#1a1a22", pants: "#c8a030" },
  // Team Copium: purple hoodies for the grunts, a gold-trimmed blazer for the execs, and the CEO's black turtleneck.
  grunt: { shirt: "#6a2a9a", pants: "#2a2a32", shoes: "#e8e8e8" }, exec: { shirt: "#4a1a6a", pants: "#c8a030", shoes: "#1a1a1a" },
  ceo: { shirt: "#141418", pants: "#2a2a34", hair: "#8a8a90", shoes: "#e8e8e8" },
};
export const TRAINER_CLASS_ORDER = Object.keys(TRAINER_OUTFITS);

function paintTrainer(p: SkinPainter, variant: number): void {
  const cls = TRAINER_CLASS_ORDER[(variant >> 6) % TRAINER_CLASS_ORDER.length];
  const o = TRAINER_OUTFITS[cls];
  const r = new Rng((variant & 63) * 7919 + 101);
  const pick = <T,>(a: T[]): T => a[r.int(a.length)];
  const skin = hex(pick(["#e8c09a", "#c89a78", "#a8744e", "#7a5236", "#5a3a24", "#f0d0b0"]));
  const hair = hex(o.hair ?? pick(["#3a2412", "#1a1a1a", "#a8742a", "#5a3a1a", "#c8a050", "#8a2a1a", "#d8d8d8"]));
  humanoid(p, skin, hair, hex(o.shirt), hex(o.pants), hex(o.shoes ?? "#2a2016"), [30, 30, 30]);
  // A hiker's beard; a professor's coat hangs open over a shirt.
  if (cls === "hiker") for (let x = 9; x < 15; x++) for (let y = 13; y < 16; y++) p.px(x, y, hair, 0.1);
  if (cls === "professor") for (let y = 20; y < 32; y++) { p.px(23, y, hex("#6a8ab8"), 0); p.px(24, y, hex("#6a8ab8"), 0); }
  if (cls === "champion" || cls === "gym_leader") for (let x = 20; x < 28; x++) p.px(x, 21, hex("#e8c040"), 0);
  // Team Copium's mark on the chest: a gold "C", which the grunts are told stands for Conviction.
  if (cls === "grunt" || cls === "exec" || cls === "ceo") {
    const gold = hex("#f0c040");
    for (const [x, y] of [[23, 22], [24, 22], [25, 22], [22, 23], [22, 24], [22, 25], [23, 26], [24, 26], [25, 26]]) p.px(x, y, gold, 0);
    if (cls === "grunt") for (let x = 20; x < 28; x++) p.px(x, 20, hex("#4a1a70"), 0);
  }
}

/**
 * The city's people, eight ways of dressing for Neon Bay: a tourist in a
 * loud shirt and shorts, someone off the beach, a suit, a jogger in neon,
 * shades and pastels, a boomer in a polo, a hoodie with headphones, and an
 * influencer in pink. Their faces and hair vary with the rest of the number.
 */
function paintCitizen(p: SkinPainter, variant: number): void {
  const style = variant % 8;
  const r = new Rng(variant * 6151 + 29);
  const pick = <T,>(a: T[]): T => a[r.int(a.length)];
  const skin = hex(pick(["#e8c09a", "#c89a78", "#a8744e", "#7a5236", "#5a3a24", "#f0d0b0"]));
  const hair = hex(style === 5 ? pick(["#c8c8c8", "#e8e8e8", "#a8a8a8"]) : pick(["#3a2412", "#1a1a1a", "#a8742a", "#5a3a1a", "#e0c070", "#8a2a1a", "#d85a9a", "#3ac0d8"]));
  const bright = () => hex(pick(["#f05a8a", "#3ad0d8", "#f4c21a", "#9aff3a", "#ff7a2a", "#b85aff", "#2a8aff"]));
  const shirt = style === 0 ? bright() : style === 1 ? skin : style === 2 ? hex(pick(["#1c1c24", "#2a2a3a", "#3a3a44"])) : style === 3 ? bright()
    : style === 4 ? hex(pick(["#f8a8d8", "#8ae8e0", "#c8a8f8"])) : style === 5 ? hex(pick(["#e8e8f0", "#8ab8e8", "#e8c8a8"])) : style === 6 ? hex(pick(["#3a3a3a", "#5a2a6a", "#2a4a3a"])) : hex("#ff6ab8");
  const pants = style === 0 ? hex("#c8b080") : style === 1 ? bright() : style === 2 ? shirt : style === 3 ? hex("#2a2a3a") : style === 4 ? hex("#e8e8f0")
    : style === 5 ? hex("#b8a888") : style === 6 ? hex("#2a3a5a") : hex("#f8f8f8");
  const shoes = style === 1 ? skin : style === 2 ? hex("#141414") : style === 3 ? hex("#f4f4f4") : hex(pick(["#2a2016", "#f0f0f0", "#3a3a3a"]));
  humanoid(p, skin, hair, shirt, pants, shoes, [30, 30, 30]);
  const at = (x: number, y: number, c: RGB) => p.px(x, y, c, 0);
  switch (style) {
    case 0:
      // Flowers all over the shirt; the shorts end at the knee.
      for (let i = 0; i < 30; i++) at(16 + r.int(24), 20 + r.int(10), hex(pick(["#ffffff", "#f4e04a", "#f05a3a"])));
      for (let x = 0; x < 16; x++) for (let y = 26; y < 30; y++) at(x, y, skin);
      break;
    case 1:
      // Bare to the waist; bare legs below short trunks.
      for (let x = 0; x < 16; x++) for (let y = 24; y < 30; y++) at(x, y, skin);
      break;
    case 2:
      // A white shirt and a tie down the front of the jacket.
      for (let y = 20; y < 28; y++) { at(23, y, hex("#f0f0f0")); at(24, y, hex("#f0f0f0")); }
      for (let y = 20; y < 27; y++) at(y < 22 ? 23 : 24, y, hex("#b82a2a"));
      break;
    case 3:
      // Stripes down the sides of the tracksuit.
      for (let y = 20; y < 32; y++) { at(40, y, hex("#f4f4f4")); at(0, y, hex("#f4f4f4")); at(16, y, hex("#f4f4f4")); }
      break;
    case 4: case 7:
      // Shades.
      for (let x = 9; x < 15; x++) at(x, 12, hex("#141418"));
      break;
    case 6:
      // Headphones over the hood.
      for (let y = 9; y < 14; y++) { at(0, y, hex("#141414")); at(16, y, hex("#141414")); }
      for (let x = 8; x < 16; x++) at(x, 0, hex("#141414"));
      break;
  }
}

/** The NBPD: navy shirt and trousers, a peaked cap, a gold badge, a belt, shades on the odd one. */
function paintCop(p: SkinPainter, variant: number): void {
  const r = new Rng(variant * 3571 + 7);
  const skin = hex(["#e8c09a", "#c89a78", "#a8744e", "#7a5236", "#5a3a24", "#f0d0b0"][r.int(6)]);
  const navy = hex("#1c2a5a"), dark = hex("#141a30"), black: RGB = [20, 20, 22];
  humanoid(p, skin, navy, navy, dark, black, [30, 30, 30]);
  const at = (x: number, y: number, c: RGB) => p.px(x, y, c, 0);
  // The cap: navy crown, black peak across the brow.
  for (let x = 8; x < 16; x++) { at(x, 8, navy); at(x, 9, black); }
  for (let x = 0; x < 32; x++) at(x, 7, navy);
  // Badge, belt and buckle.
  at(22, 22, hex("#f4c21a")); at(22, 23, hex("#d8a010"));
  for (let x = 16; x < 40; x++) at(x, 30, black);
  at(23, 30, hex("#c8c8c8")); at(24, 30, hex("#c8c8c8"));
  if (variant % 3 === 0) for (let x = 9; x < 15; x++) at(x, 12, hex("#141418"));
}

/**
 * The infected: grey-green skin, clothes torn and darkened with old blood,
 * eyes gone pale — each kind with a tell: a runner lean and pale, a brute
 * blotched and bare-chested, a spitter's jaw green with acid, a screamer's
 * long hair, a bloater's swollen yellow skin.
 */
function paintInfected(p: SkinPainter, kind: string, variant: number): void {
  const r = new Rng(variant * 104729 + kind.length);
  const pick = <T,>(a: T[]): T => a[r.int(a.length)];
  const skinTone = kind === "bloater" ? "#8a9a4a" : kind === "runner" ? "#a8b0a0" : kind === "spitter" ? "#6a8a4a" : pick(["#7a8a6a", "#6a7a5e", "#8a8a72"]);
  const shirt = kind === "brute" ? skinTone : pick(["#4a5a6a", "#6a4a3a", "#3a4a3a", "#5a5a5a", "#6a2a2a", "#2a3a5a"]);
  const pants = pick(["#2a2a3a", "#3a3026", "#2a3a2a", "#4a4a4a"]);
  const hair = kind === "screamer" ? "#d8d8d0" : pick(["#2a2218", "#1a1a1a", "#4a3a2a", "#6a6a60"]);
  humanoid(p, hex(skinTone), hex(hair), hex(shirt), hex(pants), hex("#2a2420"), [230, 230, 200]);
  const blood: RGB = [110, 20, 16];
  // Old blood and tears: dark splashes over the shirt and trousers, a stain at the mouth.
  for (let i = 0; i < 26; i++) {
    const [u, v, w, h] = r.next() < 0.6 ? [16, 20, 24, 12] : [0, 20, 16, 12];
    p.px(u + r.int(w), v + r.int(h), r.next() < 0.7 ? blood : hex(skinTone), 0.1);
  }
  p.px(12, 14, blood, 0); p.px(11, 14, blood, 0);
  if (kind === "spitter") for (let x = 10; x < 14; x++) p.px(x, 14, [120, 200, 40], 0);
  if (kind === "screamer") for (let y = 8; y < 16; y++) { p.px(8, y, hex(hair), 0); p.px(15, y, hex(hair), 0); }
  if (kind === "bloater") for (let i = 0; i < 30; i++) p.px(16 + r.int(24), 20 + r.int(12), [200, 190, 90], 0.15);
}

const cache = new Map<string, HTMLCanvasElement>();

export function skin(kind: string, variant = 0): HTMLCanvasElement {
  const key = `${kind}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new SkinPainter(kind.length * 977 + variant);
  if (kind.startsWith("critter_")) paintCritter(p, kind, variant);
  else switch (kind) {
    case "pig": {
      const pink = hex("#f0a8a4"), dark = hex("#d88c88");
      const head = p.box(0, 0, 8, 8, 8, (_f, x, y) => ((x * 7 + y * 3) % 11 === 0 ? dark : pink));
      eyes(p, head.front, 3, [1, 5], [245, 245, 245], [20, 20, 20]);
      const snout = p.box(32, 0, 4, 3, 1, hex("#e98f8c"));
      p.px(snout.front.x + 1, snout.front.y + 1, hex("#8a3a3a"), 0);
      p.px(snout.front.x + 2, snout.front.y + 1, hex("#8a3a3a"), 0);
      p.box(0, 16, 10, 8, 16, (_f, x, y) => ((x * 5 + y * 7) % 13 === 0 ? dark : pink));
      p.box(0, 40, 4, 6, 4, (_f, _x, y) => (y > 4 ? hex("#8a5a50") : pink));
      break;
    }
    case "cow": {
      const black = hex("#2b2522"), white = hex("#ececec");
      const patch = (x: number, y: number) => (Math.sin(x * 0.7 + y * 0.3) + Math.cos(y * 0.5 - x * 0.2) > 0.4 ? white : black);
      const head = p.box(0, 0, 8, 8, 6, (face, x, y) => (face === "front" ? (x > 1 && x < 6 && y > 1 ? white : black) : patch(x, y)));
      eyes(p, head.front, 3, [1, 5], null, [10, 10, 10]);
      p.fill({ x: head.front.x + 2, y: head.front.y + 5, w: 4, h: 3 }, hex("#c9a09a"), 0.05);
      p.px(head.front.x + 2, head.front.y + 6, hex("#5a3030"), 0);
      p.px(head.front.x + 5, head.front.y + 6, hex("#5a3030"), 0);
      p.box(28, 0, 1, 3, 1, hex("#d8d0b8"));
      p.box(0, 14, 12, 10, 18, (_f, x, y) => patch(x + 3, y + 2));
      p.box(0, 42, 4, 12, 4, (_f, x, y) => (y > 10 ? hex("#5a4a3a") : patch(x, y + 5)));
      break;
    }
    case "sheep": {
      const face = hex("#d8c6b0"), wool = hex("#f2f2f2");
      const head = p.box(0, 0, 6, 6, 8, (f) => (f === "front" ? face : wool));
      eyes(p, head.front, 2, [0, 4], [245, 245, 245], [20, 20, 20]);
      p.px(head.front.x + 2, head.front.y + 4, hex("#e8a0a0"), 0);
      p.px(head.front.x + 3, head.front.y + 4, hex("#e8a0a0"), 0);
      p.box(0, 14, 8, 6, 16, hex("#d8c6b0"));
      p.box(48, 0, 4, 12, 4, (_f, _x, y) => (y < 6 ? wool : face));
      // Wool coat: grey-white, tinted per sheep at draw time.
      p.box(0, 36, 10, 8, 18, (_f, x, y) => [228 + ((x * 13 + y * 7) % 5) * 5, 228 + ((x * 13 + y * 7) % 5) * 5, 228 + ((x * 13 + y * 7) % 5) * 5], 0.06);
      break;
    }
    case "chicken": {
      const white = hex("#f6f6f6");
      const head = p.box(0, 0, 4, 6, 3, white);
      eyes(p, head.front, 2, [0, 3], null, [20, 20, 20]);
      p.box(14, 0, 4, 2, 2, hex("#f0b020"));
      p.box(14, 4, 2, 2, 2, hex("#d82020"));
      p.box(0, 9, 6, 6, 8, white);
      p.box(24, 13, 1, 4, 6, hex("#e8e8e8"));
      p.box(26, 0, 3, 5, 3, hex("#f0a020"));
      break;
    }
    case "zombie":
      humanoid(p, hex("#5e8f3e"), hex("#3f6b28"), hex("#32a0a8"), hex("#3a3c9a"), hex("#4a4a4a"), [10, 10, 10]);
      break;
    case "skeleton": {
      const bone = hex("#c9c9c9"), dark = hex("#8a8a8a");
      const head = p.box(0, 0, 8, 8, 8, bone);
      p.fill({ x: head.front.x + 1, y: head.front.y + 3, w: 2, h: 2 }, hex("#2a2a2a"), 0);
      p.fill({ x: head.front.x + 5, y: head.front.y + 3, w: 2, h: 2 }, hex("#2a2a2a"), 0);
      p.fill({ x: head.front.x + 2, y: head.front.y + 6, w: 4, h: 1 }, dark, 0);
      p.box(16, 16, 8, 12, 4, (_f, x, y) => (y % 3 === 0 || x === 3 || x === 4 ? bone : hex("#3a3a3a")));
      p.box(40, 16, 2, 12, 2, bone);
      p.box(0, 16, 2, 12, 2, bone);
      break;
    }
    case "creeper": {
      const greens = [hex("#4e9c2d"), hex("#63bd3b"), hex("#3a7a22"), hex("#79cf55")];
      const g = () => greens[Math.floor(p.random() * greens.length)];
      const head = p.box(0, 0, 8, 8, 8, () => g(), 0);
      const face = [
        "........", "........", ".XX..XX.", ".XX..XX.", "...XX...", "..XXXX..", "..XXXX..", "..X..X..",
      ];
      face.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "X") p.px(head.front.x + x, head.front.y + y, hex("#101010"), 0.1); }));
      p.box(16, 16, 8, 12, 4, () => g(), 0);
      p.box(0, 16, 4, 6, 4, () => g(), 0);
      break;
    }
    case "spider": {
      const body = hex("#35291f"), hair = hex("#4a3a2c");
      p.box(0, 0, 6, 6, 6, (_f, x, y) => ((x + y) % 3 === 0 ? hair : body));
      const head = p.box(32, 4, 8, 8, 8, (_f, x, y) => ((x * y) % 4 === 1 ? hair : body));
      for (const [x, y] of [[1, 3], [2, 3], [5, 3], [6, 3], [2, 2], [5, 2], [3, 4], [4, 4]]) p.px(head.front.x + x, head.front.y + y, hex("#d4201c"), 0);
      p.box(0, 12, 10, 8, 12, (_f, x, y) => ((x * 3 + y) % 5 === 0 ? hair : body));
      p.box(0, 32, 16, 2, 2, hex("#2a2018"));
      break;
    }
    case "slime": {
      // The outer gel is drawn see-through (models.ts); the core inside it carries the face.
      const gel = hex("#86cc70"), rim = hex("#6fb35c");
      p.box(0, 0, 8, 8, 8, (_f, x, y) => (x === 0 || y === 0 || x === 7 || y === 7 ? rim : gel), 0.06);
      const core = p.box(0, 16, 6, 6, 6, hex("#5c9f4a"), 0.12);
      const dark = hex("#1d3818");
      p.fill({ x: core.front.x, y: core.front.y + 1, w: 2, h: 2 }, dark, 0);
      p.fill({ x: core.front.x + 4, y: core.front.y + 1, w: 2, h: 2 }, dark, 0);
      p.px(core.front.x + 3, core.front.y + 4, dark, 0);
      break;
    }
    case "villager": {
      // Robe colours by profession, in the order of PROFESSIONS (0 is the unemployed).
      const robes = ["#6a4a30", "#8a6a3a", "#e8e0d0", "#e6e6e6", "#3a7a8a", "#5a8a3a", "#8a6a4a", "#8a8a8a", "#2a2a2a", "#6a3a8a", "#7a4a2a"];
      const trims = ["#4a3220", "#c8a040", "#b02e26", "#c83a3a", "#2a5a6a", "#3a6a2a", "#f0f0f0", "#5a5a5a", "#8a8a8a", "#e8c040", "#4a2a18"];
      const robe = hex(robes[variant % robes.length]), trim = hex(trims[variant % trims.length]);
      const skinC = hex("#b98d6a"), hair = hex("#4a3020");
      const farmer = variant === 1;
      const head = p.box(0, 0, 8, 10, 8, (face, _x, y) => {
        if (face === "top") return farmer ? hex("#e0c050") : hair;
        if (farmer && y < 2) return hex("#e0c050");
        if (face === "back" && y < 4) return hair;
        return skinC;
      });
      // A heavy brow and green eyes.
      for (let x = 1; x <= 6; x++) p.px(head.front.x + x, head.front.y + 3, hair, 0);
      p.px(head.front.x + 1, head.front.y + 4, [240, 240, 240], 0); p.px(head.front.x + 2, head.front.y + 4, [40, 140, 50], 0);
      p.px(head.front.x + 5, head.front.y + 4, [40, 140, 50], 0); p.px(head.front.x + 6, head.front.y + 4, [240, 240, 240], 0);
      p.box(24, 0, 2, 4, 2, [skinC[0] * 0.85, skinC[1] * 0.8, skinC[2] * 0.8] as RGB);
      p.box(16, 20, 8, 12, 6, robe);
      p.box(0, 22, 4, 12, 4, [robe[0] * 0.8, robe[1] * 0.8, robe[2] * 0.8] as RGB);
      p.box(44, 22, 4, 8, 4, robe);
      p.box(40, 38, 8, 4, 4, (_f, x) => (x >= 2 && x <= 5 ? skinC : robe));
      p.box(0, 38, 8, 18, 6, (_f, x, y) => (y > 14 || x === 3 || x === 4 ? trim : robe));
      break;
    }
    case "iron_golem": {
      const iron = hex("#bab2a6"), dark = hex("#8e867c"), vine = hex("#4a7a2a");
      // Rust-dark blotches a few pixels across, and here and there a strand of vine.
      const metal = (_f: Face, x: number, y: number): RGB =>
        ((x >> 1) * 7 + (y >> 1) * 3) % 13 === 0 ? dark : (x * 3 + y * 5) % 29 === 0 ? vine : iron;
      // The waist shares the body's corner of the sheet, part of which no face of the body
      // covers; left bare it samples as a black hole in the golem's middle.
      p.fill({ x: 0, y: 0, w: 64, h: 64 }, (x, y) => metal("front", x, y));
      p.box(0, 0, 18, 12, 11, metal);
      const head = p.box(0, 23, 8, 10, 8, metal);
      for (let x = 1; x <= 6; x++) p.px(head.front.x + x, head.front.y + 3, dark, 0);
      p.px(head.front.x + 2, head.front.y + 4, hex("#8a2020"), 0); p.px(head.front.x + 5, head.front.y + 4, hex("#8a2020"), 0);
      p.box(24, 23, 2, 4, 2, dark);
      p.box(32, 23, 4, 30, 6, metal);
      p.box(0, 41, 6, 16, 5, (_f, x, y) => (y > 13 ? dark : metal(_f, x, y)));
      break;
    }
    case "piglin": case "zombified_piglin": {
      const zombie = kind === "zombified_piglin";
      const flesh = hex(zombie ? "#d98f86" : "#e8a39a"), dark = hex(zombie ? "#b26c66" : "#c9837a");
      const rot = hex("#6f8f4a"), bone = hex("#e6e0cc");
      // Rotting: green patches and bare bone here and there on the zombified.
      const skinAt = (x: number, y: number): RGB =>
        zombie && (x * 7 + y * 5) % 17 === 0 ? rot : zombie && (x * 3 + y * 11) % 23 === 0 ? bone : (x * 5 + y * 3) % 13 === 0 ? dark : flesh;
      const head = p.box(0, 0, 10, 8, 8, (_f, x, y) => skinAt(x, y));
      // Eyes: a piglin's are small and dark; one of a zombified piglin's is a bare socket.
      p.px(head.front.x + 2, head.front.y + 3, hex("#f4f4f4"), 0); p.px(head.front.x + 3, head.front.y + 3, hex("#202020"), 0);
      p.px(head.front.x + 6, head.front.y + 3, zombie ? bone : hex("#202020"), 0); p.px(head.front.x + 7, head.front.y + 3, zombie ? hex("#101010") : hex("#f4f4f4"), 0);
      const snout = p.box(36, 0, 4, 3, 1, hex(zombie ? "#e8a8a0" : "#f2b8ae"));
      p.px(snout.front.x + 1, snout.front.y + 1, hex("#5a2a2a"), 0); p.px(snout.front.x + 2, snout.front.y + 1, hex("#5a2a2a"), 0);
      p.box(46, 0, 1, 5, 4, dark);
      p.box(56, 0, 1, 2, 1, hex("#f0e8d0"));
      const leather = hex("#6b4a2a"), gold = hex("#f5d84a");
      p.box(16, 16, 8, 12, 4, (face, x, y) => {
        if (zombie) return y % 3 === 1 && x > 1 && x < 6 && face === "front" ? bone : skinAt(x, y);
        if (y >= 8) return y === 8 ? (x === 3 || x === 4 ? gold : leather) : leather;
        return skinAt(x, y);
      });
      p.box(40, 16, 4, 12, 4, (_f, x, y) => (!zombie && y >= 6 && y <= 7 ? leather : skinAt(x, y)));
      p.box(0, 16, 4, 12, 4, (_f, x, y) => (zombie ? (y > 9 ? dark : skinAt(x, y)) : y > 9 ? hex("#3a2a1a") : leather));
      // The golden sword: a brown grip at the hand, a gold blade.
      p.box(56, 16, 1, 10, 1, (_f, _x, y) => (y >= 8 ? hex("#6b4a26") : y === 7 ? hex("#c8a030") : gold));
      break;
    }
    case "wither_skeleton": {
      const bone = hex("#2e2e2e"), dark = hex("#161616");
      const head = p.box(0, 0, 8, 8, 8, (_f, x, y) => ((x * 3 + y * 5) % 11 === 0 ? hex("#3a3a3a") : bone));
      p.fill({ x: head.front.x + 1, y: head.front.y + 3, w: 2, h: 2 }, hex("#050505"), 0);
      p.fill({ x: head.front.x + 5, y: head.front.y + 3, w: 2, h: 2 }, hex("#050505"), 0);
      p.fill({ x: head.front.x + 2, y: head.front.y + 6, w: 4, h: 1 }, dark, 0);
      p.box(16, 16, 8, 12, 4, (_f, x, y) => (y % 3 === 0 || x === 3 || x === 4 ? bone : hex("#0e0e0e")));
      p.box(40, 16, 2, 12, 2, bone);
      p.box(0, 16, 2, 12, 2, bone);
      break;
    }
    case "ghast": {
      // Variant 1 is the moment before it spits: eyes and mouth open, rimmed red.
      const white = hex("#f2f2f0"), shade = hex("#d8d8d4");
      const body = p.box(0, 0, 16, 16, 16, (_f, x, y) => ((x * 5 + y * 3) % 9 === 0 ? shade : white), 0.04);
      const f = body.front;
      const ink = hex("#303030"), red = hex("#b01818");
      if (variant === 1) {
        for (const ex of [3, 10]) { p.fill({ x: f.x + ex, y: f.y + 4, w: 3, h: 3 }, ink, 0); p.px(f.x + ex + 1, f.y + 7, red, 0); }
        p.fill({ x: f.x + 5, y: f.y + 9, w: 6, h: 4 }, ink, 0);
        p.fill({ x: f.x + 6, y: f.y + 10, w: 4, h: 2 }, red, 0);
      } else {
        for (const ex of [3, 10]) p.fill({ x: f.x + ex, y: f.y + 6, w: 3, h: 1 }, ink, 0);
        for (const ex of [4, 11]) p.px(f.x + ex, f.y + 7, hex("#8a8a8a"), 0);
        p.fill({ x: f.x + 6, y: f.y + 11, w: 4, h: 1 }, ink, 0);
      }
      p.box(0, 32, 2, 9, 2, (_f, _x, y) => (y > 6 ? shade : white));
      break;
    }
    case "blaze": {
      const gold = hex("#f2b030"), deep = hex("#c06a10"), bright = hex("#ffe070");
      const head = p.box(0, 0, 8, 8, 8, (_f, x, y) => ((x + y) % 4 === 0 ? deep : (x * 3 + y) % 5 === 0 ? bright : gold));
      p.fill({ x: head.front.x + 1, y: head.front.y + 3, w: 2, h: 1 }, hex("#2a1a00"), 0);
      p.fill({ x: head.front.x + 5, y: head.front.y + 3, w: 2, h: 1 }, hex("#2a1a00"), 0);
      p.fill({ x: head.front.x + 2, y: head.front.y + 6, w: 4, h: 1 }, hex("#6a3a00"), 0);
      p.box(0, 16, 2, 8, 2, (_f, _x, y) => (y % 3 === 0 ? deep : bright));
      break;
    }
    case "magma_cube": {
      // A dark crust split by glowing seams, and two burning eyes.
      const crust = hex("#3a1206"), glow = hex("#ff8a1a"), hot = hex("#ffd35a");
      const shell = p.box(0, 0, 8, 8, 8, (_f, x, y) => (y === 2 || y === 5 ? (x % 3 === 0 ? hot : glow) : (x * 5 + y * 3) % 7 === 0 ? hex("#5a2008") : crust), 0.08);
      p.fill({ x: shell.front.x + 1, y: shell.front.y + 3, w: 2, h: 1 }, hot, 0);
      p.fill({ x: shell.front.x + 5, y: shell.front.y + 3, w: 2, h: 1 }, hot, 0);
      p.px(shell.front.x + 2, shell.front.y + 3, hex("#c01010"), 0); p.px(shell.front.x + 5, shell.front.y + 3, hex("#c01010"), 0);
      break;
    }
    case "hoglin": {
      // Drawn at half size (the model doubles it).
      const hide = hex("#c27a5c"), dark = hex("#8e4c38"), bristle = hex("#dcc27a");
      p.box(0, 0, 8, 7, 13, (_f, x, y) => ((x * 3 + y * 5) % 7 === 0 ? dark : hide));
      p.box(44, 0, 1, 4, 9, (_f, x, y) => ((x + y) % 2 ? bristle : hex("#b89a58")));
      const head = p.box(0, 20, 7, 5, 8, (face, x, y) => (face === "front" && y >= 3 ? hex("#d89a82") : (x + y) % 5 === 0 ? dark : hide));
      p.px(head.front.x + 1, head.front.y + 1, hex("#1a1a1a"), 0); p.px(head.front.x + 5, head.front.y + 1, hex("#1a1a1a"), 0);
      p.px(head.front.x + 2, head.front.y + 4, hex("#5a2a20"), 0); p.px(head.front.x + 4, head.front.y + 4, hex("#5a2a20"), 0);
      p.box(30, 20, 1, 3, 1, hex("#f2ead6"));
      p.box(34, 20, 3, 1, 2, dark);
      p.box(0, 34, 3, 5, 3, (_f, _x, y) => (y >= 4 ? hex("#3a2a20") : hide));
      break;
    }
    case "wolf": {
      // Grey fur, darker along the back; a paler muzzle; a red collar when tame (variant bit 0), red eyes when angry (bit 1).
      const fur = hex("#d4cfc8"), back = hex("#a8a198"), light = hex("#ebe6de"), dark = hex("#3a3632");
      const coat = (face: Face, x: number, y: number): RGB => (face === "top" ? back : (x * 5 + y * 3) % 9 === 0 ? back : fur);
      const head = p.box(0, 0, 6, 6, 4, coat);
      const eye: RGB = variant & 2 ? hex("#e02020") : hex("#1e1a18");
      p.px(head.front.x + 1, head.front.y + 2, eye, 0); p.px(head.front.x + 4, head.front.y + 2, eye, 0);
      const snout = p.box(0, 10, 3, 3, 4, (face) => (face === "top" ? fur : light));
      p.px(snout.front.x + 1, snout.front.y, dark, 0);
      p.box(16, 14, 2, 2, 1, back);
      const mane = p.box(21, 0, 8, 7, 6, coat);
      if (variant & 1) for (const face of ["front", "west", "east", "back", "top"] as Face[]) {
        const r = mane[face];
        p.fill({ x: r.x, y: r.y + (face === "top" ? r.h - 2 : r.h - 2), w: r.w, h: 2 }, hex("#c02828"), 0.04);
      }
      p.box(18, 14, 6, 6, 9, coat);
      p.box(9, 18, 2, 8, 2, (_f, _x, y) => (y > 5 ? light : back));
      p.box(0, 18, 2, 8, 2, (_f, _x, y) => (y > 6 ? back : fur));
      break;
    }
    case "deer": {
      // Warm brown with a pale belly and tail, dark nose and hooves, bone-pale antlers.
      const hide = hex("#9a6a3e"), dark = hex("#7a5230"), pale = hex("#e8dcc4");
      const head = p.box(0, 0, 5, 5, 7, (face, x, y) => (face === "front" && y >= 3 ? hex("#b88a5e") : (x + y) % 6 === 0 ? dark : hide));
      p.px(head.front.x + 1, head.front.y + 1, hex("#1a1410"), 0); p.px(head.front.x + 3, head.front.y + 1, hex("#1a1410"), 0);
      p.px(head.front.x + 2, head.front.y + 4, hex("#2a1e18"), 0);
      p.box(40, 0, 1, 7, 1, hex("#e6dcc0"));
      p.box(46, 0, 3, 1, 1, dark);
      p.box(54, 0, 2, 3, 1, pale);
      p.box(0, 18, 8, 8, 14, (face, x, y) => (face === "bottom" ? pale : (x * 3 + y * 7) % 13 === 0 ? dark : hide));
      p.box(44, 18, 4, 7, 4, (face) => (face === "front" ? pale : hide));
      p.box(0, 44, 2, 12, 2, (_f, _x, y) => (y > 10 ? hex("#2a2018") : y > 6 ? pale : hide));
      break;
    }
    case "bear": {
      // Drawn at half size (the model doubles it): dark brown fur, a tan muzzle.
      const fur = hex("#5a3a22"), deep = hex("#43291a"), tan = hex("#a8845e");
      const coat = (_f: Face, x: number, y: number): RGB => ((x * 3 + y * 5) % 7 === 0 ? deep : fur);
      p.box(0, 0, 7, 7, 11, coat);
      p.box(36, 0, 5, 2, 5, deep);
      const head = p.box(0, 20, 5, 4, 4, coat);
      p.px(head.front.x + 1, head.front.y + 1, hex("#101010"), 0); p.px(head.front.x + 3, head.front.y + 1, hex("#101010"), 0);
      const snout = p.box(20, 20, 3, 2, 2, tan);
      p.px(snout.front.x + 1, snout.front.y, hex("#1a1210"), 0);
      p.box(32, 20, 1, 1, 1, deep);
      p.box(0, 30, 3, 5, 3, (_f, _x, y) => (y >= 4 ? hex("#2a1a10") : fur));
      break;
    }
    case "enderman": {
      // Near-black, faintly speckled; purple eyes (a wider, brighter stare while it screams).
      const black = hex("#161616"), speck = hex("#232323");
      const skinOf = (_f: Face, x: number, y: number): RGB => ((x * 7 + y * 5) % 11 === 0 ? speck : black);
      const head = p.box(0, 0, 8, 8, 8, skinOf, 0.04);
      const eye = hex("#e070ff"), glow = hex("#ff9cff");
      for (const ex of [0, 5]) p.fill({ x: head.front.x + ex, y: head.front.y + 4, w: 3, h: 1 }, variant & 1 ? glow : eye, 0);
      if (variant & 1) p.fill({ x: head.front.x + 2, y: head.front.y + 6, w: 4, h: 2 }, hex("#050505"), 0);
      p.box(32, 16, 8, 12, 4, skinOf, 0.04);
      p.box(56, 0, 2, 30, 2, skinOf, 0.04);
      p.box(56, 32, 2, 30, 2, skinOf, 0.04);
      break;
    }
    case "shulker": {
      // A purple shell (or a dyed one: variant is the box colour) of overlapping plates, and a pale head.
      const SHELLS = ["#8e5b8e", "#d8d8d8", "#a8342e", "#e0c040", "#3c4ab0", "#4e7a22", "#e0782a", "#7a3aa8", "#2a2a2e"];
      const shell = hex(SHELLS[variant] ?? SHELLS[0]);
      const dark: RGB = [shell[0] * 0.72, shell[1] * 0.72, shell[2] * 0.72], lite: RGB = [Math.min(255, shell[0] * 1.2), Math.min(255, shell[1] * 1.2), Math.min(255, shell[2] * 1.2)];
      const plates = (f: Face, x: number, y: number): RGB => (f === "top" ? ((x + y) % 4 === 0 ? dark : lite) : y === 0 ? lite : (x % 4 === 0 || y % 3 === 0) ? dark : shell);
      p.box(0, 0, 8, 4, 8, plates, 0.06);
      p.box(0, 12, 8, 6, 8, (f, x, y) => (f === "bottom" ? dark : plates(f, x, y)), 0.06);
      const head = p.box(0, 28, 3, 3, 3, hex("#e8e4b0"), 0.04);
      p.px(head.front.x, head.front.y + 1, hex("#1a1a1a"), 0); p.px(head.front.x + 2, head.front.y + 1, hex("#1a1a1a"), 0);
      break;
    }
    case "silverfish": {
      const grey = hex("#8c8f93"), dark = hex("#63666a");
      const seg = (_f: Face, x: number, y: number): RGB => ((x + y) % 3 === 0 ? dark : grey);
      p.box(0, 0, 3, 2, 2, seg); p.box(0, 5, 4, 3, 3, seg); p.box(0, 12, 5, 4, 3, seg);
      p.box(0, 20, 3, 3, 3, seg); p.box(0, 27, 2, 2, 3, seg); p.box(0, 33, 1, 1, 2, seg);
      break;
    }
    case "ender_dragon": {
      // Drawn at a quarter of its size: black scales, grey belly, violet eyes, dark wing membranes on paler bones.
      const scale = hex("#161618"), ridge = hex("#2a2a30"), belly = hex("#3a3a40");
      const scales = (f: Face, x: number, y: number): RGB => (f === "bottom" ? belly : (x * 3 + y * 5) % 7 === 0 ? ridge : scale);
      p.box(0, 0, 6, 6, 16, scales, 0.05);
      const head = p.box(44, 0, 4, 4, 5, scales, 0.05);
      p.px(head.front.x, head.front.y + 1, hex("#e070ff"), 0); p.px(head.front.x + 3, head.front.y + 1, hex("#e070ff"), 0);
      p.box(44, 9, 4, 1, 5, (f) => (f === "top" ? hex("#5a1a1a") : scale), 0.05);
      p.box(44, 16, 3, 3, 3, scales, 0.05);
      p.box(56, 16, 2, 2, 2, scales, 0.05);
      const membrane = hex("#26262c"), bone = hex("#4a4a52");
      p.box(0, 22, 14, 1, 10, (_f, x, y) => (y === 0 || x % 5 === 0 ? bone : membrane), 0.05);
      p.box(0, 34, 12, 1, 8, (_f, x, y) => (y === 0 || x % 4 === 0 ? bone : membrane), 0.05);
      p.box(48, 22, 2, 4, 2, scales, 0.05);
      break;
    }
    case "boat": {
      // Drawn at half size (the model doubles it): planks with dark seams, per wood.
      const woods = ["#9c7a45", "#6b5030", "#c8b77a", "#a0724a", "#b0603a"];
      const plank = hex(woods[variant % woods.length]);
      const seam = [plank[0] * 0.7, plank[1] * 0.7, plank[2] * 0.7] as RGB;
      const wood = (_f: Face, _x: number, y: number): RGB => (y % 3 === 2 ? seam : plank);
      p.box(0, 0, 10, 1, 14, wood);
      p.box(0, 16, 1, 3, 14, wood);
      p.box(32, 16, 9, 3, 1, wood);
      p.box(0, 36, 1, 1, 7, hex("#6b4a26"));
      break;
    }
    case "minecart": {
      const iron = hex("#8a8a8e"), dark = hex("#4a4a4e");
      const rim = (_f: Face, x: number, y: number): RGB => (y === 0 || x === 0 ? dark : iron);
      p.box(0, 0, 8, 1, 10, (_f, x, y) => ((x + y) % 4 === 0 ? dark : iron));
      p.box(0, 12, 1, 4, 10, rim);
      p.box(24, 12, 6, 4, 1, rim);
      break;
    }
    case "dodo": case "dilo": case "raptor": case "parasaur": case "rex": case "gigantoraptor":
    case "trike": case "stego": case "bronto": case "ptero":
      paintDino(p, kind, variant);
      break;
    case "infected": case "runner": case "brute": case "spitter": case "screamer": case "bloater": case "shambler": case "crawler": {
      paintInfected(p, kind, variant);
      break;
    }
    case "trainer":
      paintTrainer(p, variant);
      break;
    case "citizen":
      paintCitizen(p, variant);
      break;
    case "cop":
      paintCop(p, variant);
      break;
    case "tribute": {
      // Every tribute dressed differently: their district's colours, their own skin and hair.
      const r = new Rng(variant * 7919 + 13);
      const pick = <T,>(a: T[]): T => a[r.int(a.length)];
      const shirt = pick(["#6a4a2a", "#2a5a3a", "#5a2a2a", "#2a3a6a", "#6a6a6a", "#3a3a3a", "#7a5a1a", "#4a2a5a"]);
      const pants = pick(["#2a2a2a", "#3a2a1a", "#2a3a2a", "#1a2a3a", "#4a4a4a"]);
      humanoid(p, hex(pick(["#c89a78", "#a8744e", "#e8c09a", "#7a5236", "#5a3a24"])), hex(pick(["#3a2412", "#1a1a1a", "#a8742a", "#5a3a1a", "#c8a050", "#8a2a1a"])), hex(shirt), hex(pants), hex("#2a2016"), [30, 30, 30]);
      break;
    }
    case "player": {
      const hues = [
        ["#3aa8a8", "#2e3a8c"], ["#a83a3a", "#3a3a3a"], ["#3a8a3a", "#5a4a2a"], ["#8a3aa8", "#2a2a5a"],
        ["#c8a030", "#3a3a8a"], ["#e06a2a", "#2a4a2a"], ["#2a6ad8", "#4a4a4a"], ["#d84a8a", "#3a2a4a"],
      ];
      const [shirt, pants] = hues[variant % hues.length];
      const skins = ["#c89a78", "#a8744e", "#e8c09a", "#7a5236"];
      const hairs = ["#3a2412", "#1a1a1a", "#a8742a", "#5a3a1a"];
      humanoid(p, hex(skins[(variant >> 3) % skins.length]), hex(hairs[(variant >> 2) % hairs.length]), hex(shirt), hex(pants), hex("#3a3a3a"), [40, 60, 160]);
      // Elytra, shown only in flight: grey membrane ribbed with pale veins.
      p.box(0, 32, 10, 20, 1, (_f, x, y) => ((x + y) % 5 === 0 ? hex("#b8b8c8") : hex("#8a8aa0")), 0.06);
      break;
    }
  }
  const canvas = p.done();
  cache.set(key, canvas);
  return canvas;
}
