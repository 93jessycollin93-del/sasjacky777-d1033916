/**
 * Box models for the critters (engine/critters.ts), built from a handful of
 * body plans — four legs, a bird, a fish, a grub, a golem, a wisp, a jelly, a
 * snail — each species choosing its proportions and features: ears, a flame
 * for a tail, antlers that are sprouts, gills, a mane, a shell. All original.
 *
 * Parts are named as Primal's creatures' are (legFR, head, tail, wingR…), so
 * the same pose animates them (models.ts), and packed onto the skin sheet by
 * the same packer, so the skin painter (skins.ts) and the model never
 * disagree about where a box's skin is.
 */
import { arms, legs2, legs4, P, pack, type DinoPart, type Role, type Spec } from "./dinoModels";

type V3 = [number, number, number];

interface QuadOpts {
  body: V3;
  legH: number;
  legW?: number;
  head: V3;
  snout?: V3;
  ears?: "pointy" | "tall" | "round" | "long" | "floppy";
  tail?: { size: V3; up: number; role?: Role; tip?: V3 };
  horns?: "antler" | "sprout" | "curl" | "spike" | "branch";
  mane?: boolean;
  spikes?: number;
  spikeRole?: Role;
  wings?: "small" | "large";
  gills?: boolean;
  shell?: boolean;
  teeth?: boolean;
}

/** A four-legged critter: most of them. */
function quad(o: QuadOpts): Spec[] {
  const [bw, bh, bd] = o.body;
  const lh = o.legH, lw = o.legW ?? 2;
  const top = lh + bh;
  const [hw, hh, hd] = o.head;
  const head: Spec[] = [];
  const ear = (size: V3, rot: number, role: Role = "ear") => [
    P("earR", size, [-(hw / 2 - size[0] / 2), hh / 2 + size[1] / 2 - 0.5, 0.5], role, { rotation: [0, 0, rot], share: "ear" }),
    P("earL", size, [hw / 2 - size[0] / 2, hh / 2 + size[1] / 2 - 0.5, 0.5], role, { rotation: [0, 0, -rot], share: "ear" }),
  ];
  switch (o.ears) {
    case "pointy": head.push(...ear([1, 2, 1], 0.15)); break;
    case "tall": head.push(...ear([1, 3, 1], 0.1)); break;
    case "round": head.push(...ear([2, 2, 1], 0.3)); break;
    case "long": head.push(...ear([1, 3, 1], 0.6)); break;
    case "floppy":
      head.push(P("earR", [1, 3, 2], [-(hw / 2 + 0.5), 0.5, 0], "ear", { rotation: [0, 0, 0.3], share: "ear" }), P("earL", [1, 3, 2], [hw / 2 + 0.5, 0.5, 0], "ear", { rotation: [0, 0, -0.3], share: "ear" }));
      break;
  }
  if (o.snout) head.push(P("snout", o.snout, [0, -hh / 2 + o.snout[1] / 2, -hd / 2 - o.snout[2] / 2], "head", { children: o.teeth ? [P("tooth", [2, 1, 1], [0, -o.snout[1] / 2 - 0.5, -o.snout[2] / 2 + 0.5], "tooth")] : undefined }));
  switch (o.horns) {
    case "antler":
      for (const side of [-1, 1]) head.push(P(side < 0 ? "hornR" : "hornL", [1, 4, 1], [side * (hw / 2 - 1), hh / 2 + 2, 0], "horn", {
        rotation: [0, 0, side * -0.3], share: "horn",
        children: [P(side < 0 ? "tineR" : "tineL", [3, 1, 1], [side * 1, 1, 0], "horn", { share: "tine" })],
      }));
      break;
    case "branch":
      for (const side of [-1, 1]) head.push(P(side < 0 ? "hornR" : "hornL", [1, 6, 1], [side * (hw / 2 - 1), hh / 2 + 3, 0], "horn", {
        rotation: [0, 0, side * -0.35], share: "horn",
        children: [
          P(side < 0 ? "tineR" : "tineL", [4, 1, 1], [side * 1.5, 1, 0], "horn", { share: "tine" }),
          P(side < 0 ? "leafR" : "leafL", [3, 2, 2], [side * 1, 3, 0], "leaf", { share: "leaf" }),
        ],
      }));
      break;
    case "sprout":
      for (const side of [-1, 1]) head.push(P(side < 0 ? "hornR" : "hornL", [2, 2, 1], [side * (hw / 2 - 1), hh / 2 + 1, 0], "leaf", { rotation: [0, 0, side * -0.4], share: "leaf" }));
      break;
    case "curl":
      for (const side of [-1, 1]) head.push(P(side < 0 ? "hornR" : "hornL", [2, 3, 3], [side * (hw / 2 + 1), hh / 2 - 1, 1], "horn", { share: "horn" }));
      break;
    case "spike":
      for (const side of [-1, 1]) head.push(P(side < 0 ? "hornR" : "hornL", [1, 3, 1], [side * (hw / 2 - 1), hh / 2 + 1, 1], "horn", { rotation: [-0.5, 0, 0], share: "horn" }));
      break;
  }
  if (o.mane) head.push(P("mane", [hw + 2, hh + 2, 3], [0, 0, hd / 2 - 0.5], "mane"));
  if (o.gills) {
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      head.push(P(`gill${side < 0 ? "R" : "L"}${i}`, [1, 2, 1], [side * (hw / 2 + 0.5), hh / 2 - i * 1.2, hd / 2 - 1], "gill", { rotation: [0, 0, side * (0.6 + i * 0.3)], share: "gill" }));
    }
  }
  const bodyKids: Spec[] = [];
  const n = o.spikes ?? 0;
  for (let i = 0; i < n; i++) {
    const z = -bd / 2 + 1.5 + (i * (bd - 3)) / Math.max(1, n - 1);
    bodyKids.push(P(`spike${i}`, [1, 2, 2], [0, bh / 2 + 1, z], o.spikeRole ?? "spike", { rotation: [-0.3, 0, 0], share: "spike" }));
  }
  if (o.shell) bodyKids.push(P("shell", [bw + 1, 3, bd - 1], [0, bh / 2 + 1, 0], "shell", { children: [P("moss", [bw - 1, 1, bd - 3], [0, 2, 0], "moss")] }));
  const parts: Spec[] = [
    ...legs4([lw, lh, lw], bw / 2 - lw / 2, lh, bd / 2 - lw / 2 - 0.5),
    P("body", [bw, bh, bd], [0, lh + bh / 2, 0], "body", { children: bodyKids.length ? bodyKids : undefined }),
    P("head", [hw, hh, hd], [0, top - hh * 0.3, -bd / 2], "head", { offset: [0, hh * 0.2, -hd / 2 + 1], children: head.length ? head : undefined }),
  ];
  if (o.tail) {
    const [tw, th, tl] = o.tail.size;
    const tip = o.tail.tip;
    parts.push(P("tail", [tw, th, tl], [0, top - th / 2 - 0.5, bd / 2], o.tail.role ?? "tail", {
      offset: [0, 0, tl / 2], rotation: [-o.tail.up, 0, 0],
      children: tip ? [P("tailTip", tip, [0, 0, tl / 2 + tip[2] / 2 - 0.5], "flame")] : undefined,
    }));
  }
  if (o.wings === "large") {
    parts.push(P("wingR", [10, 1, 6], [-bw / 2, top - 1, -bd / 6], "wing", { offset: [-5, 0, 0], share: "wing" }));
    parts.push(P("wingL", [10, 1, 6], [bw / 2, top - 1, -bd / 6], "wing", { offset: [5, 0, 0], share: "wing" }));
  } else if (o.wings === "small") {
    parts.push(P("wingR", [1, 4, 5], [-(bw / 2 + 0.5), top - 1, -1], "wing", { offset: [0, -1.5, 0], share: "wing" }));
    parts.push(P("wingL", [1, 4, 5], [bw / 2 + 0.5, top - 1, -1], "wing", { offset: [0, -1.5, 0], share: "wing" }));
  }
  return parts;
}

/** A bird: two thin legs, a round body, wings folded — or wide, for one that flies. */
function bird(o: { body: V3; legH: number; head: V3; beak: V3; wings: V3 | null; wide?: V3; crest?: V3; tail: V3 }): Spec[] {
  const [bw, bh, bd] = o.body;
  const top = o.legH + bh;
  const [hw, hh, hd] = o.head;
  const head: Spec[] = [P("beak", o.beak, [0, -0.5, -hd / 2 - o.beak[2] / 2], "beak")];
  if (o.crest) head.push(P("crest", o.crest, [0, hh / 2 + o.crest[1] / 2 - 0.5, 1], "crest", { rotation: [0.4, 0, 0] }));
  const parts: Spec[] = [
    ...legs2([1, o.legH, 1], bw / 4, o.legH, 0.5),
    P("body", [bw, bh, bd], [0, o.legH + bh / 2, 0], "body"),
    P("head", [hw, hh, hd], [0, top, -bd / 2 + 1], "head", { offset: [0, hh / 2 - 1, -hd / 2 + 1], children: head }),
    P("tail", o.tail, [0, top - 1.5, bd / 2], "feather", { offset: [0, 0, o.tail[2] / 2], rotation: [-0.25, 0, 0] }),
  ];
  if (o.wide) {
    parts.push(P("wingR", o.wide, [-bw / 2, top - 1, -1], "wing", { offset: [-o.wide[0] / 2, 0, 0], share: "wing" }));
    parts.push(P("wingL", o.wide, [bw / 2, top - 1, -1], "wing", { offset: [o.wide[0] / 2, 0, 0], share: "wing" }));
  } else if (o.wings) {
    const w = o.wings;
    parts.push(P("wingR", w, [-(bw / 2 + w[0] / 2), top - 1, 0], "wing", { offset: [0, -w[1] / 2 + 0.5, 0], share: "wing" }));
    parts.push(P("wingL", w, [bw / 2 + w[0] / 2, top - 1, 0], "wing", { offset: [0, -w[1] / 2 + 0.5, 0], share: "wing" }));
  }
  return parts;
}

/** A fish that has taken to land: fins for legs, a tail fin, a fin on its back, a jaw full of teeth if it bites. */
function fish(o: { body: V3; dorsal: V3; tailFin: V3; jaw?: boolean }): Spec[] {
  const [bw, bh, bd] = o.body;
  const cy = bh / 2 + 1;
  return [
    P("body", [bw, bh, bd], [0, cy, 0], "body", {
      children: [
        P("dorsal", o.dorsal, [0, bh / 2 + o.dorsal[1] / 2, 0], "fin"),
        P("finR", [3, 1, 2], [-(bw / 2 + 1), -bh / 2 + 1, -1], "fin", { rotation: [0, 0, 0.4], share: "finS" }),
        P("finL", [3, 1, 2], [bw / 2 + 1, -bh / 2 + 1, -1], "fin", { rotation: [0, 0, -0.4], share: "finS" }),
      ],
    }),
    P("head", [bw - 1, bh - 1, 3], [0, cy, -bd / 2], "head", {
      offset: [0, 0.5, -1.5],
      children: o.jaw ? [P("jaw", [bw - 2, 1, 3], [0, -bh / 2 + 0.5, -0.5], "jaw", { children: [P("tooth", [bw - 2, 1, 1], [0, 1, -1], "tooth")] })] : undefined,
    }),
    P("tail", o.tailFin, [0, cy, bd / 2], "fin", { offset: [0, 0, o.tailFin[2] / 2] }),
  ];
}

/** A grub: three segments, the front one its head. */
function grub(): Spec[] {
  return [
    P("head", [4, 4, 4], [0, 2, -3], "head"),
    P("body", [4, 3, 3], [0, 1.5, 0.5], "body"),
    P("tail", [3, 3, 3], [0, 1.5, 2], "body", { offset: [0, 0, 1.5], children: [P("tailTip", [2, 2, 2], [0, -0.5, 2], "belly")] }),
  ];
}

/** A cocoon: silk wound round a sleeper, hanging from nothing. */
function cocoon(): Spec[] {
  return [
    P("body", [4, 7, 4], [0, 3.5, 0], "shell", { children: [P("head", [3, 2, 3], [0, 4.5, 0], "head")] }),
  ];
}

/** A moth: a small body and head, and great soft wings. */
function moth(): Spec[] {
  return [
    P("body", [3, 3, 6], [0, 4, 0], "body"),
    P("head", [3, 3, 3], [0, 4.5, -3], "head", {
      offset: [0, 0, -1.5],
      children: [P("antR", [1, 3, 1], [-1, 2.5, -0.5], "antenna", { rotation: [-0.4, 0, 0.3], share: "ant" }), P("antL", [1, 3, 1], [1, 2.5, -0.5], "antenna", { rotation: [-0.4, 0, -0.3], share: "ant" })],
    }),
    P("wingR", [9, 1, 7], [-1.5, 5, 0], "wing", { offset: [-4.5, 0, 0], share: "wing" }),
    P("wingL", [9, 1, 7], [1.5, 5, 0], "wing", { offset: [4.5, 0, 0], share: "wing" }),
  ];
}

/** A golem of stone: a boulder of a body, a head sunk into it, stubby arms and legs, and rocks on its back when big. */
function golem(o: { body: V3; head: V3; limb: V3; rocks: number }): Spec[] {
  const [bw, bh, bd] = o.body;
  const lh = o.limb[1] - 1;
  const top = lh + bh;
  const rocks: Spec[] = [];
  for (let i = 0; i < o.rocks; i++) rocks.push(P(`rock${i}`, [3, 2, 3], [(i % 2 ? 1 : -1) * (bw / 4), bh / 2 + 0.5, -bd / 4 + (i * bd) / (o.rocks + 1)], "rock", { share: "rock" }));
  return [
    ...legs2([o.limb[0], lh, o.limb[2]], bw / 4, lh, 0),
    P("body", [bw, bh, bd], [0, lh + bh / 2, 0], "body", { children: rocks.length ? rocks : undefined }),
    P("head", o.head, [0, top - 1, -bd / 2 + 1], "head", { offset: [0, 0, -o.head[2] / 2 + 1] }),
    ...arms(o.limb, bw / 2 + o.limb[0] / 2, top - 1, 0),
  ];
}

/** A wisp: a flame that floats, with a paler heart; or, the older one, a flame inside a lantern it carries. */
function wisp(lantern: boolean): Spec[] {
  if (lantern) {
    return [
      P("body", [6, 7, 6], [0, 6.5, 0], "lantern", {
        children: [
          P("head", [3, 4, 3], [0, 0, 0], "flame"),
          P("handle", [4, 1, 1], [0, 4.5, 0], "lantern"),
          P("cap", [7, 1, 7], [0, 3.5, 0], "lantern"),
        ],
      }),
      P("tail", [3, 3, 2], [0, 2, 1], "flame", { offset: [0, -1, 0], children: [P("tailTip", [2, 2, 2], [0, -2, 0], "flame")] }),
    ];
  }
  return [
    P("body", [5, 6, 5], [0, 5, 0], "flame", { children: [P("head", [3, 3, 3], [0, -0.5, -1.2], "glow"), P("wisp", [2, 3, 2], [0.8, 4, 0.5], "flame")] }),
    P("tail", [2, 3, 2], [0, 2, 0.5], "flame", { offset: [0, -1, 0] }),
  ];
}

/** A jelly: a dome that drifts, four tendrils trailing. */
function jelly(): Spec[] {
  const tendrils: Spec[] = [];
  for (const [x, z, i] of [[-2, -2, 0], [2, -2, 1], [-2, 2, 2], [2, 2, 3]] as const) {
    tendrils.push(P(i === 0 ? "tail" : `tendril${i}`, [1, 6, 1], [x, -2.5, z], "tentacle", { offset: [0, -3, 0], share: "tendril" }));
  }
  return [P("body", [7, 5, 7], [0, 9, 0], "body", { children: [P("head", [5, 2, 5], [0, -3, 0], "belly"), ...tendrils] })];
}

/** A snail: a long foot, eyes on stalks, and a shell with a garden on it. */
function snail(): Spec[] {
  return [
    P("body", [4, 3, 10], [0, 1.5, 0], "body"),
    P("head", [4, 3, 3], [0, 2.5, -5], "head", {
      offset: [0, 0, -1],
      children: [P("antR", [1, 3, 1], [-1, 3, 0], "antenna", { share: "ant" }), P("antL", [1, 3, 1], [1, 3, 0], "antenna", { share: "ant" })],
    }),
    P("shell", [7, 7, 7], [0, 6, 1.5], "shell", { children: [P("moss", [5, 1, 5], [0, 4, 0], "moss")] }),
  ];
}

const SPECS: Record<string, Spec[]> = {
  emberkit: quad({ body: [5, 4, 7], legH: 3, head: [5, 5, 4], snout: [3, 2, 1], ears: "pointy", tail: { size: [1, 1, 5], up: 0.8, tip: [2, 2, 2] } }),
  cinderlynx: quad({ body: [6, 5, 9], legH: 5, head: [5, 5, 5], snout: [3, 2, 2], ears: "tall", tail: { size: [1, 1, 6], up: 0.5, tip: [2, 3, 2] } }),
  pyrolion: quad({ body: [8, 7, 12], legH: 6, legW: 3, head: [6, 6, 6], snout: [4, 3, 2], mane: true, tail: { size: [1, 1, 9], up: 0.3, tip: [3, 3, 3] } }),
  axolittle: quad({ body: [5, 3, 8], legH: 2, legW: 1, head: [6, 4, 4], gills: true, tail: { size: [1, 3, 7], up: 0, role: "fin" } }),
  axoloch: quad({ body: [6, 4, 10], legH: 3, head: [7, 4, 5], gills: true, tail: { size: [1, 4, 8], up: 0, role: "fin" } }),
  tidalotl: quad({ body: [8, 6, 13], legH: 4, legW: 3, head: [8, 5, 6], gills: true, horns: "spike", spikes: 3, spikeRole: "fin", tail: { size: [1, 5, 10], up: 0.1, role: "fin" } }),
  sproutling: quad({ body: [4, 4, 6], legH: 5, legW: 1, head: [4, 4, 4], ears: "long", horns: "sprout", tail: { size: [2, 2, 1], up: 0.4 } }),
  fernfawn: quad({ body: [5, 5, 8], legH: 7, legW: 1, head: [4, 4, 5], ears: "long", horns: "antler", tail: { size: [2, 2, 1], up: 0.4 } }),
  grovestag: quad({ body: [7, 7, 12], legH: 9, legW: 2, head: [5, 5, 6], ears: "pointy", horns: "branch", tail: { size: [2, 2, 2], up: 0.4 } }),
  chirplet: bird({ body: [4, 4, 5], legH: 2, head: [3, 3, 3], beak: [1, 1, 2], wings: [1, 3, 4], tail: [3, 1, 3] }),
  galewing: bird({ body: [5, 5, 7], legH: 3, head: [4, 4, 4], beak: [1, 1, 2], wings: null, wide: [9, 1, 5], crest: [1, 2, 3], tail: [4, 1, 4] }),
  stormhawk: bird({ body: [6, 6, 9], legH: 4, head: [4, 4, 5], beak: [2, 2, 3], wings: null, wide: [12, 1, 7], crest: [1, 3, 4], tail: [5, 1, 6] }),
  nibbit: quad({ body: [4, 3, 6], legH: 2, legW: 1, head: [4, 4, 4], ears: "round", snout: [2, 2, 1], teeth: true, tail: { size: [1, 1, 6], up: 0.2 } }),
  gnawbit: quad({ body: [5, 4, 8], legH: 3, head: [5, 4, 5], ears: "pointy", snout: [3, 2, 1], teeth: true, tail: { size: [1, 1, 7], up: 0.2 } }),
  wrigglet: grub(),
  cocoonix: cocoon(),
  lumoth: moth(),
  sparkhog: quad({ body: [5, 4, 6], legH: 2, legW: 1, head: [4, 3, 4], snout: [2, 2, 1], spikes: 4, tail: { size: [1, 1, 1], up: 0 } }),
  stormhog: quad({ body: [7, 6, 9], legH: 3, head: [5, 4, 5], snout: [3, 2, 2], spikes: 6, ears: "round" }),
  pebbling: golem({ body: [8, 7, 7], head: [5, 3, 3], limb: [2, 4, 2], rocks: 0 }),
  bouldron: golem({ body: [12, 10, 10], head: [6, 4, 4], limb: [4, 7, 4], rocks: 4 }),
  frostpaw: quad({ body: [5, 4, 7], legH: 3, head: [4, 4, 4], snout: [2, 2, 2], ears: "pointy", tail: { size: [3, 3, 6], up: 0.5 } }),
  blizzfang: quad({ body: [7, 6, 11], legH: 6, legW: 2, head: [5, 5, 6], snout: [3, 3, 3], ears: "pointy", spikes: 4, teeth: true, tail: { size: [3, 3, 8], up: 0.4 } }),
  wisplet: wisp(false),
  lanternwisp: wisp(true),
  finnip: fish({ body: [4, 5, 8], dorsal: [1, 3, 4], tailFin: [1, 5, 4] }),
  rippajaw: fish({ body: [7, 6, 13], dorsal: [1, 5, 5], tailFin: [1, 7, 5], jaw: true }),
  scalekin: quad({ body: [4, 4, 6], legH: 3, head: [4, 4, 4], snout: [2, 2, 2], horns: "spike", spikes: 3, tail: { size: [2, 2, 6], up: 0.1 } }),
  drakeling: quad({ body: [6, 5, 9], legH: 4, head: [4, 4, 5], snout: [3, 2, 3], horns: "spike", spikes: 3, wings: "small", tail: { size: [2, 2, 9], up: 0.1 } }),
  wyrmlord: quad({ body: [8, 7, 13], legH: 6, legW: 3, head: [5, 5, 7], snout: [3, 3, 3], horns: "curl", spikes: 5, wings: "large", teeth: true, tail: { size: [3, 3, 12], up: 0.1 } }),
  bogpup: quad({ body: [5, 4, 7], legH: 3, head: [5, 4, 4], snout: [3, 2, 2], ears: "floppy", tail: { size: [1, 1, 3], up: 0.6 } }),
  mireback: quad({ body: [9, 6, 12], legH: 4, legW: 3, head: [6, 5, 6], snout: [5, 3, 2], shell: true, tail: { size: [2, 2, 3], up: 0 } }),
  jellispark: jelly(),
  mossnail: snail(),
  cinderam: quad({ body: [7, 6, 10], legH: 5, legW: 2, head: [4, 5, 5], horns: "curl", mane: true, tail: { size: [2, 2, 2], up: 0.3 } }),
  dogeling: quad({ body: [4, 4, 6], legH: 3, head: [5, 4, 4], snout: [3, 2, 2], ears: "pointy", tail: { size: [2, 2, 3], up: 1.2 } }),
  wowdoge: quad({ body: [6, 5, 9], legH: 5, head: [6, 5, 5], snout: [4, 2, 3], ears: "pointy", mane: true, tail: { size: [3, 3, 4], up: 1.2 } }),
  chonklet: quad({ body: [7, 6, 7], legH: 1, legW: 2, head: [5, 4, 4], ears: "pointy", tail: { size: [1, 1, 5], up: 0.6 } }),
  megachonk: quad({ body: [12, 10, 12], legH: 2, legW: 3, head: [7, 6, 6], ears: "pointy", tail: { size: [2, 2, 7], up: 0.5 } }),
  froggo: quad({ body: [6, 4, 6], legH: 2, legW: 2, head: [6, 3, 4] }),
  vibefrog: quad({ body: [8, 6, 8], legH: 3, legW: 3, head: [8, 4, 6], horns: "sprout" }),
  stonkfish: fish({ body: [3, 4, 7], dorsal: [1, 3, 3], tailFin: [1, 4, 3] }),
  moonfin: fish({ body: [5, 5, 10], dorsal: [1, 4, 5], tailFin: [1, 6, 5] }),
  sussling: golem({ body: [5, 7, 5], head: [4, 2, 2], limb: [2, 2, 2], rocks: 0 }),
  susquatch: golem({ body: [8, 10, 7], head: [6, 3, 3], limb: [3, 5, 3], rocks: 0 }),
  bonkbat: bird({ body: [3, 3, 4], legH: 1, head: [3, 3, 3], beak: [1, 1, 1], wings: [1, 3, 5], tail: [2, 1, 2] }),
  bonkarang: bird({ body: [5, 4, 6], legH: 2, head: [4, 4, 4], beak: [1, 1, 2], wings: null, wide: [12, 1, 5], crest: [1, 2, 3], tail: [3, 1, 3] }),
  rickrock: golem({ body: [7, 6, 7], head: [4, 3, 3], limb: [2, 3, 2], rocks: 2 }),
  neverroll: golem({ body: [11, 9, 10], head: [5, 4, 4], limb: [3, 6, 3], rocks: 4 }),
  copiumite: wisp(false),
  hopium: wisp(true),
  glaciarch: bird({ body: [7, 7, 11], legH: 5, head: [5, 5, 5], beak: [2, 2, 3], wings: null, wide: [14, 1, 8], crest: [1, 4, 5], tail: [5, 1, 10] }),
};

/** Each critter's model, keyed as the renderer asks for it: "critter_<species>". */
export const CRITTER_MODELS: Record<string, DinoPart[]> = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [`critter_${k}`, pack(v)]));

/** Every box of a critter's model, children included, for the skin painter. */
export function critterBoxes(key: string): DinoPart[] {
  const out: DinoPart[] = [];
  const walk = (p: DinoPart) => { out.push(p); p.children?.forEach(walk); };
  (CRITTER_MODELS[key] ?? []).forEach(walk);
  return out;
}

/** Each species' colours: its main colour, underside, the accent its features take (flame, leaf, fin, spark) and its eyes. */
export const CRITTER_COLORS: Record<string, { main: string; belly: string; accent: string; eye?: string }> = {
  emberkit: { main: "#e8743a", belly: "#f8d8a0", accent: "#ffcf40" },
  cinderlynx: { main: "#d8562a", belly: "#f0c890", accent: "#ffb030" },
  pyrolion: { main: "#c8642a", belly: "#e8c080", accent: "#ff7020" },
  axolittle: { main: "#f0a8c8", belly: "#f8d8e8", accent: "#e0487a" },
  axoloch: { main: "#7ab8e8", belly: "#d8ecf8", accent: "#e86a9a" },
  tidalotl: { main: "#3a78c8", belly: "#c8e0f0", accent: "#e8508a" },
  sproutling: { main: "#b89060", belly: "#f0e0c0", accent: "#5ab03a" },
  fernfawn: { main: "#9a7a4a", belly: "#e8d8b0", accent: "#3a9a2a" },
  grovestag: { main: "#6a5236", belly: "#c8b890", accent: "#3a9a3a" },
  chirplet: { main: "#8a6a4a", belly: "#e8d8b0", accent: "#f0a830" },
  galewing: { main: "#6a8ab0", belly: "#e0e8f0", accent: "#f0c040" },
  stormhawk: { main: "#3a4a6a", belly: "#d8dce8", accent: "#f8d040" },
  nibbit: { main: "#b89a78", belly: "#f0e0c8", accent: "#f0f0f0" },
  gnawbit: { main: "#8a6a4a", belly: "#e0cca8", accent: "#f8f0d0" },
  wrigglet: { main: "#a8c858", belly: "#e8f0a8", accent: "#5a7a2a" },
  cocoonix: { main: "#d8ccaa", belly: "#e8e0c8", accent: "#8a7a58" },
  lumoth: { main: "#e8e0a8", belly: "#f8f0d0", accent: "#80d8f8" },
  sparkhog: { main: "#e8c030", belly: "#f8e8a8", accent: "#3a3a4a" },
  stormhog: { main: "#3a4a7a", belly: "#c8d0e8", accent: "#f8e040" },
  pebbling: { main: "#8a8a88", belly: "#a8a8a0", accent: "#5a5a58", eye: "#f0d060" },
  bouldron: { main: "#6a6258", belly: "#8a8278", accent: "#c86a3a", eye: "#f0a040" },
  frostpaw: { main: "#eef4f8", belly: "#ffffff", accent: "#88c8e8", eye: "#2a4a6a" },
  blizzfang: { main: "#d0e0ec", belly: "#f8fcff", accent: "#6ab8e8", eye: "#2a5a8a" },
  wisplet: { main: "#9a7ae8", belly: "#c8b8f8", accent: "#e8e0ff", eye: "#1a0a3a" },
  lanternwisp: { main: "#3a3a42", belly: "#e8e0ff", accent: "#b070ff", eye: "#1a0a3a" },
  finnip: { main: "#4aa8a8", belly: "#d8f0e8", accent: "#f07a3a" },
  rippajaw: { main: "#4a6a8a", belly: "#e0e8f0", accent: "#6a8aa8" },
  scalekin: { main: "#6a8a9a", belly: "#d8d0b0", accent: "#e8b040" },
  drakeling: { main: "#4a6ab0", belly: "#d8d0a8", accent: "#e8a030" },
  wyrmlord: { main: "#3a4a9a", belly: "#e0d0a0", accent: "#f0b030", eye: "#f8e040" },
  bogpup: { main: "#7a6a4a", belly: "#b8a888", accent: "#5a8a4a" },
  mireback: { main: "#5a6a4a", belly: "#a8a888", accent: "#3a7a3a" },
  jellispark: { main: "#a8d8f8", belly: "#e0f4ff", accent: "#f8e040" },
  mossnail: { main: "#c8b8a0", belly: "#e0d8c8", accent: "#8a6a4a" },
  cinderam: { main: "#4a3a3a", belly: "#8a7a6a", accent: "#ff7a2a" },
  glaciarch: { main: "#c8e8f8", belly: "#f8ffff", accent: "#6ad0f0", eye: "#2a6aa8" },
  dogeling: { main: "#e0a860", belly: "#f8ecd8", accent: "#c88040", eye: "#2a1a0a" },
  wowdoge: { main: "#d89848", belly: "#f8ecd8", accent: "#f8e8c0", eye: "#2a1a0a" },
  chonklet: { main: "#e89848", belly: "#f8e0c0", accent: "#c86a2a" },
  megachonk: { main: "#8a8a92", belly: "#e8e8ec", accent: "#5a5a62" },
  froggo: { main: "#6ab04a", belly: "#e8f0c8", accent: "#3a8a3a", eye: "#1a1a1a" },
  vibefrog: { main: "#4a9a5a", belly: "#e0f0c8", accent: "#f06ad8", eye: "#1a1a1a" },
  stonkfish: { main: "#3ac06a", belly: "#e0fff0", accent: "#f8e040" },
  moonfin: { main: "#3a6ad8", belly: "#e8f0ff", accent: "#f8e8a0", eye: "#f8f040" },
  sussling: { main: "#d8342a", belly: "#b82a22", accent: "#9ad8ee", eye: "#1a3a4a" },
  susquatch: { main: "#8a2ad8", belly: "#6a1ab0", accent: "#9ad8ee", eye: "#1a3a4a" },
  bonkbat: { main: "#5a4a6a", belly: "#8a7a9a", accent: "#f0c040" },
  bonkarang: { main: "#3a3a5a", belly: "#7a7a9a", accent: "#f8a040", eye: "#f8e040" },
  rickrock: { main: "#8a7a6a", belly: "#b0a090", accent: "#f0c040" },
  neverroll: { main: "#6a5a4a", belly: "#9a8a7a", accent: "#e8b030", eye: "#40a8f0" },
  copiumite: { main: "#b88ae8", belly: "#e0d0f8", accent: "#8af0e0", eye: "#2a1a4a" },
  hopium: { main: "#f0d070", belly: "#fff8d8", accent: "#ffffff", eye: "#4a3a1a" },
};
