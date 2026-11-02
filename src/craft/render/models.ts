/**
 * Box models for mobs and players, and the views that pose them each frame.
 *
 * A model is a tree of pivots with boxes hung off them; legs swing about the
 * hip, arms about the shoulder, the head about the neck. Everything is in
 * sixteenths of a block — the unit the skins are painted in — and scaled once
 * at the root.
 */
import * as THREE from "three";
import { WOOL_COLORS } from "../engine/blocks";
import { boxRegions, skin, type Face } from "./skins";
import { col, createLitBlockMaterial, createSpriteMaterial, type SharedUniforms } from "./materials";
import { itemModel } from "./itemModels";
import { DINO_MODELS } from "./dinoModels";
import { CRITTER_MODELS } from "./critterModels";

const FACE_ORDER: Face[] = ["east", "west", "top", "bottom", "back", "front"];

function boxGeometry(w: number, h: number, d: number, u: number, v: number, inflate = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry((w + inflate * 2) / 16, (h + inflate * 2) / 16, (d + inflate * 2) / 16);
  const regions = boxRegions(u, v, w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  FACE_ORDER.forEach((face, f) => {
    const r = regions[face];
    const x0 = r.x / 64, x1 = (r.x + r.w) / 64, y0 = 1 - r.y / 64, y1 = 1 - (r.y + r.h) / 64;
    // BoxGeometry vertex order per face: top-left, top-right, bottom-left, bottom-right.
    uv.setXY(f * 4, x0, y0);
    uv.setXY(f * 4 + 1, x1, y0);
    uv.setXY(f * 4 + 2, x0, y1);
    uv.setXY(f * 4 + 3, x1, y1);
  });
  uv.needsUpdate = true;
  return g;
}

interface PartSpec {
  name: string;
  size: [number, number, number];
  uv: [number, number];
  pivot: [number, number, number];
  offset?: [number, number, number];
  rotation?: [number, number, number];
  inflate?: number;
  material?: "main" | "wool" | "gel";
  children?: PartSpec[];
}

const HUMANOID = (thin: boolean): PartSpec[] => {
  const limb = thin ? 2 : 4;
  const armX = thin ? 5 : 6;
  return [
    { name: "body", size: [8, 12, 4], uv: [16, 16], pivot: [0, 18, 0] },
    { name: "head", size: [8, 8, 8], uv: [0, 0], pivot: [0, 24, 0], offset: [0, 4, 0] },
    { name: "rightArm", size: [limb, 12, limb], uv: [40, 16], pivot: [-armX, 22, 0], offset: [0, -4, 0] },
    { name: "leftArm", size: [limb, 12, limb], uv: [40, 16], pivot: [armX, 22, 0], offset: [0, -4, 0] },
    { name: "rightLeg", size: [limb, 12, limb], uv: [0, 16], pivot: [-2, 12, 0], offset: [0, -6, 0] },
    { name: "leftLeg", size: [limb, 12, limb], uv: [0, 16], pivot: [2, 12, 0], offset: [0, -6, 0] },
  ];
};

const legs4 = (size: [number, number, number], uv: [number, number], x: number, y: number, z: number): PartSpec[] => [
  { name: "legFR", size, uv, pivot: [-x, y, -z], offset: [0, -size[1] / 2, 0] },
  { name: "legFL", size, uv, pivot: [x, y, -z], offset: [0, -size[1] / 2, 0] },
  { name: "legBR", size, uv, pivot: [-x, y, z], offset: [0, -size[1] / 2, 0] },
  { name: "legBL", size, uv, pivot: [x, y, z], offset: [0, -size[1] / 2, 0] },
];

/** Piglins and zombified piglins: a humanoid with a broad pig's head and a golden sword in hand. */
const PIGLIN: PartSpec[] = [
  { name: "body", size: [8, 12, 4], uv: [16, 16], pivot: [0, 18, 0] },
  { name: "head", size: [10, 8, 8], uv: [0, 0], pivot: [0, 24, 0], offset: [0, 4, 0],
    children: [
      { name: "snout", size: [4, 3, 1], uv: [36, 0], pivot: [0, -1, -4.5] },
      { name: "earR", size: [1, 5, 4], uv: [46, 0], pivot: [-5.5, 2, 0], offset: [0, -2, 0], rotation: [0, 0, 0.45] },
      { name: "earL", size: [1, 5, 4], uv: [46, 0], pivot: [5.5, 2, 0], offset: [0, -2, 0], rotation: [0, 0, -0.45] },
      { name: "tuskR", size: [1, 2, 1], uv: [56, 0], pivot: [-2.5, -2.5, -4.5] },
      { name: "tuskL", size: [1, 2, 1], uv: [56, 0], pivot: [2.5, -2.5, -4.5] },
    ] },
  { name: "rightArm", size: [4, 12, 4], uv: [40, 16], pivot: [-6, 22, 0], offset: [0, -4, 0],
    children: [{ name: "sword", size: [1, 10, 1], uv: [56, 16], pivot: [0, -5, -1], offset: [0, -4, 0], rotation: [Math.PI / 2, 0, 0] }] },
  { name: "leftArm", size: [4, 12, 4], uv: [40, 16], pivot: [6, 22, 0], offset: [0, -4, 0] },
  { name: "rightLeg", size: [4, 12, 4], uv: [0, 16], pivot: [-2, 12, 0], offset: [0, -6, 0] },
  { name: "leftLeg", size: [4, 12, 4], uv: [0, 16], pivot: [2, 12, 0], offset: [0, -6, 0] },
];

/** Elytra, folded flat against a player's back and spread while gliding (hidden otherwise). */
const WINGS: PartSpec[] = [
  { name: "wingR", size: [10, 20, 1], uv: [0, 32], pivot: [-1, 23, 2.5], offset: [-5, -10, 0] },
  { name: "wingL", size: [10, 20, 1], uv: [0, 32], pivot: [1, 23, 2.5], offset: [5, -10, 0] },
];

/**
 * The Ender Dragon, modelled at a quarter of its size and drawn four times
 * over (see modelScale): a long body, a three-part neck to a head with a jaw
 * that opens, wings in two joints, and a tail of six segments.
 */
const DRAGON: PartSpec[] = [
  { name: "body", size: [6, 6, 16], uv: [0, 0], pivot: [0, 6, 0] },
  { name: "neck0", size: [3, 3, 3], uv: [44, 16], pivot: [0, 6.5, -9.5] },
  { name: "neck1", size: [3, 3, 3], uv: [44, 16], pivot: [0, 7, -12.5] },
  { name: "neck2", size: [3, 3, 3], uv: [44, 16], pivot: [0, 7.5, -15.5] },
  { name: "head", size: [4, 4, 5], uv: [44, 0], pivot: [0, 8, -19.5],
    children: [{ name: "jaw", size: [4, 1, 5], uv: [44, 9], pivot: [0, -2.5, 2.5], offset: [0, 0, -2.5] }] },
  { name: "wingR", size: [14, 1, 10], uv: [0, 22], pivot: [-3, 8, -3], offset: [-7, 0, 0],
    children: [{ name: "tipR", size: [12, 1, 8], uv: [0, 34], pivot: [-7, 0, 0], offset: [-6, 0, 0] }] },
  { name: "wingL", size: [14, 1, 10], uv: [0, 22], pivot: [3, 8, -3], offset: [7, 0, 0],
    children: [{ name: "tipL", size: [12, 1, 8], uv: [0, 34], pivot: [7, 0, 0], offset: [6, 0, 0] }] },
  ...[0, 1, 2, 3, 4, 5].map((i): PartSpec => ({ name: `tail${i}`, size: [2, 2, 2], uv: [56, 16], pivot: [0, 6, 9 + i * 2] })),
  ...legs4([2, 4, 2], [48, 22], 2, 3.5, 5),
];

const MODELS: Record<string, PartSpec[]> = {
  // Modelled at half size and drawn at size 2: a shell in two halves, the lid rising and
  // turning to open, and the soft head that looks out from inside.
  shulker: [
    { name: "base", size: [8, 4, 8], uv: [0, 0], pivot: [0, 2, 0] },
    { name: "lid", size: [8, 6, 8], uv: [0, 12], pivot: [0, 5, 0] },
    { name: "head", size: [3, 3, 3], uv: [0, 28], pivot: [0, 4, 0] },
  ],
  // Long-limbed and black; its head tips back to scream (see pose), arms forward when carrying.
  enderman: [
    { name: "rightLeg", size: [2, 30, 2], uv: [56, 32], pivot: [-2, 30, 0], offset: [0, -15, 0] },
    { name: "leftLeg", size: [2, 30, 2], uv: [56, 32], pivot: [2, 30, 0], offset: [0, -15, 0] },
    { name: "body", size: [8, 12, 4], uv: [32, 16], pivot: [0, 36, 0] },
    { name: "head", size: [8, 8, 8], uv: [0, 0], pivot: [0, 42, 0], offset: [0, 4, 0] },
    { name: "rightArm", size: [2, 30, 2], uv: [56, 0], pivot: [-5, 41, 0], offset: [0, -14, 0] },
    { name: "leftArm", size: [2, 30, 2], uv: [56, 0], pivot: [5, 41, 0], offset: [0, -14, 0] },
  ],
  // Segments that narrow to a tail, wriggling side to side.
  silverfish: [
    { name: "seg0", size: [3, 2, 2], uv: [0, 0], pivot: [0, 1, -4.5] },
    { name: "seg1", size: [4, 3, 3], uv: [0, 5], pivot: [0, 1.5, -2] },
    { name: "seg2", size: [5, 4, 3], uv: [0, 12], pivot: [0, 2, 1] },
    { name: "seg3", size: [3, 3, 3], uv: [0, 20], pivot: [0, 1.5, 4] },
    { name: "seg4", size: [2, 2, 3], uv: [0, 27], pivot: [0, 1, 7] },
    { name: "seg5", size: [1, 1, 2], uv: [0, 33], pivot: [0, 0.5, 9.5] },
  ],
  ender_dragon: DRAGON,
  piglin: PIGLIN,
  zombified_piglin: PIGLIN,
  // A skeleton half again as tall (drawn scaled up in pose()), in soot-black bone.
  wither_skeleton: HUMANOID(true),
  // A sixteen-pixel cube drawn four times over, with nine tentacles hanging from it.
  ghast: [
    { name: "body", size: [16, 16, 16], uv: [0, 0], pivot: [0, 8, 0] },
    ...[-5, 0, 5].flatMap((x, i) => [-5, 0, 5].map((z, j): PartSpec => ({
      name: `tentacle${i * 3 + j}`, size: [2, 9, 2], uv: [0, 32], pivot: [x, 0.5, z], offset: [0, -4.5, 0],
    }))),
  ],
  // A head over three spinning rings of rods, narrowing downward.
  blaze: [
    { name: "head", size: [8, 8, 8], uv: [0, 0], pivot: [0, 24, 0] },
    ...[[17, 7], [11, 5], [5, 3]].flatMap(([y, r], ring) => [0, 1, 2, 3].map((i): PartSpec => ({
      name: `rod${ring}${i}`, size: [2, 8, 2], uv: [0, 16], pivot: [0, y, 0], offset: [r, 0, 0], rotation: [0, (i * Math.PI) / 2, 0],
    }))),
  ],
  magma_cube: [
    { name: "shell", size: [8, 8, 8], uv: [0, 0], pivot: [0, 4, 0] },
  ],
  // Modelled at half size and drawn at `size: 2`, like the vehicles, so the skin fits the sheet.
  hoglin: [
    { name: "body", size: [8, 7, 13], uv: [0, 0], pivot: [0, 8.5, 0] },
    { name: "mane", size: [1, 4, 9], uv: [44, 0], pivot: [0, 12.5, -1] },
    { name: "head", size: [7, 5, 8], uv: [0, 20], pivot: [0, 9, -6.5], offset: [0, -1.5, -4],
      children: [
        { name: "tuskR", size: [1, 3, 1], uv: [30, 20], pivot: [-3, 1.5, -3.5] },
        { name: "tuskL", size: [1, 3, 1], uv: [30, 20], pivot: [3, 1.5, -3.5] },
        { name: "earR", size: [3, 1, 2], uv: [34, 20], pivot: [-4.5, 2, 2.5] },
        { name: "earL", size: [3, 1, 2], uv: [34, 20], pivot: [4.5, 2, 2.5] },
      ] },
    ...legs4([3, 5, 3], [0, 34], 2.5, 5, 4.5),
  ],
  wolf: [
    { name: "body", size: [6, 6, 9], uv: [18, 14], pivot: [0, 10, 1.5] },
    { name: "mane", size: [8, 7, 6], uv: [21, 0], pivot: [0, 10.5, -3] },
    { name: "head", size: [6, 6, 4], uv: [0, 0], pivot: [0, 11, -6], offset: [0, 0, -2],
      children: [
        { name: "snout", size: [3, 3, 4], uv: [0, 10], pivot: [0, -1.5, -4] },
        { name: "earR", size: [2, 2, 1], uv: [16, 14], pivot: [-2, 4, 0.5] },
        { name: "earL", size: [2, 2, 1], uv: [16, 14], pivot: [2, 4, 0.5] },
      ] },
    { name: "tail", size: [2, 8, 2], uv: [9, 18], pivot: [0, 12, 6], offset: [0, -4, 0], rotation: [0.9, 0, 0] },
    ...legs4([2, 8, 2], [0, 18], 1.5, 8, 3.5),
  ],
  deer: [
    { name: "body", size: [8, 8, 14], uv: [0, 18], pivot: [0, 16, 0.5] },
    { name: "neck", size: [4, 7, 4], uv: [44, 18], pivot: [0, 18, -6], offset: [0, 3, 0], rotation: [0.35, 0, 0] },
    { name: "head", size: [5, 5, 7], uv: [0, 0], pivot: [0, 24, -8], offset: [0, 1, -2],
      children: [
        { name: "antlerR", size: [1, 7, 1], uv: [40, 0], pivot: [-2, 3, 1], offset: [0, 3, 0], rotation: [0, 0, 0.45] },
        { name: "antlerL", size: [1, 7, 1], uv: [40, 0], pivot: [2, 3, 1], offset: [0, 3, 0], rotation: [0, 0, -0.45] },
        { name: "earR", size: [3, 1, 1], uv: [46, 0], pivot: [-3.5, 2, 1.5] },
        { name: "earL", size: [3, 1, 1], uv: [46, 0], pivot: [3.5, 2, 1.5] },
      ] },
    { name: "tail", size: [2, 3, 1], uv: [54, 0], pivot: [0, 18, 8] },
    ...legs4([2, 12, 2], [0, 44], 2.5, 12, 5.5),
  ],
  // Modelled at half size and drawn at `size: 2`, like the hoglin.
  bear: [
    { name: "body", size: [7, 7, 11], uv: [0, 0], pivot: [0, 8.5, 0.5] },
    { name: "hump", size: [5, 2, 5], uv: [36, 0], pivot: [0, 12.5, -2] },
    { name: "head", size: [5, 4, 4], uv: [0, 20], pivot: [0, 9.5, -5], offset: [0, 0, -2],
      children: [
        { name: "snout", size: [3, 2, 2], uv: [20, 20], pivot: [0, -1, -3] },
        { name: "earR", size: [1, 1, 1], uv: [32, 20], pivot: [-2, 2.5, 1] },
        { name: "earL", size: [1, 1, 1], uv: [32, 20], pivot: [2, 2.5, 1] },
      ] },
    ...legs4([3, 5, 3], [0, 30], 2, 5, 3.5),
  ],
  // Vehicles are modelled at half size and drawn at `size: 2`, so their skins fit the 64×64 sheet.
  boat: [
    { name: "bottom", size: [10, 1, 14], uv: [0, 0], pivot: [0, 0.5, 0] },
    { name: "left", size: [1, 3, 14], uv: [0, 16], pivot: [-5.5, 2, 0] },
    { name: "right", size: [1, 3, 14], uv: [0, 16], pivot: [5.5, 2, 0] },
    { name: "front", size: [9, 3, 1], uv: [32, 16], pivot: [0, 2, -7.5] },
    { name: "back", size: [9, 3, 1], uv: [32, 16], pivot: [0, 2, 7.5] },
    { name: "paddleL", size: [1, 1, 7], uv: [0, 36], pivot: [-6, 3.5, -1], offset: [0, 0, 2.5] },
    { name: "paddleR", size: [1, 1, 7], uv: [0, 36], pivot: [6, 3.5, -1], offset: [0, 0, 2.5] },
  ],
  minecart: [
    { name: "bottom", size: [8, 1, 10], uv: [0, 0], pivot: [0, 1.5, 0] },
    { name: "left", size: [1, 4, 10], uv: [0, 12], pivot: [-4.5, 3, 0] },
    { name: "right", size: [1, 4, 10], uv: [0, 12], pivot: [4.5, 3, 0] },
    { name: "front", size: [6, 4, 1], uv: [24, 12], pivot: [0, 3, -4.5] },
    { name: "back", size: [6, 4, 1], uv: [24, 12], pivot: [0, 3, 4.5] },
  ],
  // A cube of jelly with a darker core; scaled by the slime's size in pose().
  slime: [
    { name: "core", size: [6, 6, 6], uv: [0, 16], pivot: [0, 4, 0] },
    { name: "gel", size: [8, 8, 8], uv: [0, 0], pivot: [0, 4, 0], material: "gel" },
  ],
  villager: [
    { name: "rightLeg", size: [4, 12, 4], uv: [0, 22], pivot: [-2, 12, 0], offset: [0, -6, 0] },
    { name: "leftLeg", size: [4, 12, 4], uv: [0, 22], pivot: [2, 12, 0], offset: [0, -6, 0] },
    { name: "body", size: [8, 12, 6], uv: [16, 20], pivot: [0, 18, 0] },
    { name: "robe", size: [8, 18, 6], uv: [0, 38], pivot: [0, 15, 0], inflate: 0.5 },
    { name: "head", size: [8, 10, 8], uv: [0, 0], pivot: [0, 24, 0], offset: [0, 5, 0],
      children: [{ name: "nose", size: [2, 4, 2], uv: [24, 0], pivot: [0, -2, -5] }] },
    // Arms folded across the chest, the villager's pose.
    { name: "armR", size: [4, 8, 4], uv: [44, 22], pivot: [-6, 22, -1], offset: [0, -3, 0], rotation: [-0.75, 0, 0] },
    { name: "armL", size: [4, 8, 4], uv: [44, 22], pivot: [6, 22, -1], offset: [0, -3, 0], rotation: [-0.75, 0, 0] },
    { name: "armsX", size: [8, 4, 4], uv: [40, 38], pivot: [0, 18.5, -3.5], rotation: [-0.75, 0, 0] },
  ],
  iron_golem: [
    { name: "legR", size: [6, 16, 5], uv: [0, 41], pivot: [-4, 16, 0], offset: [0, -8, 0] },
    { name: "legL", size: [6, 16, 5], uv: [0, 41], pivot: [4, 16, 0], offset: [0, -8, 0] },
    { name: "waist", size: [9, 9, 6], uv: [0, 0], pivot: [0, 20.5, 0] },
    { name: "body", size: [18, 12, 11], uv: [0, 0], pivot: [0, 31, 0] },
    { name: "head", size: [8, 10, 8], uv: [0, 23], pivot: [0, 35, -2], offset: [0, 5, 0],
      children: [{ name: "nose", size: [2, 4, 2], uv: [24, 23], pivot: [0, -2, -5] }] },
    { name: "armR", size: [4, 30, 6], uv: [32, 23], pivot: [-11, 36, 0], offset: [0, -13, 0] },
    { name: "armL", size: [4, 30, 6], uv: [32, 23], pivot: [11, 36, 0], offset: [0, -13, 0] },
  ],
  // Primal's creatures (render/dinoModels.ts), their skins packed to fit; and the critters, likewise.
  ...DINO_MODELS,
  ...CRITTER_MODELS,
  trainer: HUMANOID(false),
  citizen: HUMANOID(false),
  cop: HUMANOID(false),
  player: [...HUMANOID(false), ...WINGS],
  zombie: HUMANOID(false),
  tribute: HUMANOID(false),
  // Dead Zone's infected: people, still, in shape.
  infected: HUMANOID(false), runner: HUMANOID(false), brute: HUMANOID(false), spitter: HUMANOID(false), screamer: HUMANOID(false), bloater: HUMANOID(false),
  shambler: HUMANOID(false), crawler: HUMANOID(false),
  skeleton: HUMANOID(true),
  pig: [
    { name: "body", size: [10, 8, 16], uv: [0, 16], pivot: [0, 10, 0] },
    { name: "head", size: [8, 8, 8], uv: [0, 0], pivot: [0, 12, -7], offset: [0, 0, -4],
      children: [{ name: "snout", size: [4, 3, 1], uv: [32, 0], pivot: [0, -1, -4.5] }] },
    ...legs4([4, 6, 4], [0, 40], 3, 6, 5),
  ],
  cow: [
    { name: "body", size: [12, 10, 18], uv: [0, 14], pivot: [0, 17, 0] },
    { name: "head", size: [8, 8, 6], uv: [0, 0], pivot: [0, 20, -9], offset: [0, 0, -3],
      children: [
        { name: "hornR", size: [1, 3, 1], uv: [28, 0], pivot: [-4.5, 4.5, -1] },
        { name: "hornL", size: [1, 3, 1], uv: [28, 0], pivot: [4.5, 4.5, -1] },
      ] },
    ...legs4([4, 12, 4], [0, 42], 4, 12, 7),
  ],
  sheep: [
    { name: "body", size: [8, 6, 16], uv: [0, 14], pivot: [0, 15, 0] },
    { name: "wool", size: [10, 8, 18], uv: [0, 36], pivot: [0, 15, 0], material: "wool" },
    { name: "head", size: [6, 6, 8], uv: [0, 0], pivot: [0, 18, -8], offset: [0, 0, -3] },
    ...legs4([4, 12, 4], [48, 0], 3, 12, 5),
  ],
  chicken: [
    { name: "body", size: [6, 6, 8], uv: [0, 9], pivot: [0, 8, 0] },
    { name: "head", size: [4, 6, 3], uv: [0, 0], pivot: [0, 9, -4], offset: [0, 3, -1],
      children: [
        { name: "beak", size: [4, 2, 2], uv: [14, 0], pivot: [0, 1, -2.5] },
        { name: "wattle", size: [2, 2, 2], uv: [14, 4], pivot: [0, -1, -2] },
      ] },
    { name: "wingR", size: [1, 4, 6], uv: [24, 13], pivot: [-3.5, 10, 0], offset: [0, -2, 0] },
    { name: "wingL", size: [1, 4, 6], uv: [24, 13], pivot: [3.5, 10, 0], offset: [0, -2, 0] },
    { name: "legR", size: [3, 5, 3], uv: [26, 0], pivot: [-1.5, 5, 1], offset: [0, -2.5, 0] },
    { name: "legL", size: [3, 5, 3], uv: [26, 0], pivot: [1.5, 5, 1], offset: [0, -2.5, 0] },
  ],
  creeper: [
    { name: "body", size: [8, 12, 4], uv: [16, 16], pivot: [0, 12, 0] },
    { name: "head", size: [8, 8, 8], uv: [0, 0], pivot: [0, 18, 0], offset: [0, 4, 0] },
    ...legs4([4, 6, 4], [0, 16], 2, 6, 4),
  ],
  spider: [
    { name: "thorax", size: [6, 6, 6], uv: [0, 0], pivot: [0, 9, 0] },
    { name: "abdomen", size: [10, 8, 12], uv: [0, 12], pivot: [0, 10, 9] },
    { name: "head", size: [8, 8, 8], uv: [32, 4], pivot: [0, 9, -3], offset: [0, 0, -4] },
    ...[-1, 1].flatMap((side) =>
      [-1.5, -0.5, 0.5, 1.5].map((z, i): PartSpec => ({
        name: `leg${side}${i}`, size: [16, 2, 2], uv: [0, 32], pivot: [side * 3, 9, z * 2],
        offset: [side * 8, 0, 0], rotation: [0, side * (z * 0.35), side * -0.6],
      })),
    ),
  ],
};

export interface ModelInstance {
  root: THREE.Group;
  parts: Map<string, THREE.Object3D>;
  material: THREE.MeshBasicMaterial;
  wool?: THREE.MeshBasicMaterial;
  gel?: THREE.MeshBasicMaterial;
}

const textures = new Map<string, THREE.CanvasTexture>();
function skinTexture(kind: string, variant: number): THREE.CanvasTexture {
  const key = `${kind}:${variant}`;
  let t = textures.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(skin(kind, variant));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.NoColorSpace;
    textures.set(key, t);
  }
  return t;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();

export function buildModel(kind: string, variant = 0): ModelInstance {
  const material = new THREE.MeshBasicMaterial({ map: skinTexture(kind, variant) });
  const wool = kind === "sheep" ? new THREE.MeshBasicMaterial({ map: skinTexture(kind, variant) }) : undefined;
  // Depth writes off so the core shows through the jelly from every side.
  const gel = kind === "slime"
    ? new THREE.MeshBasicMaterial({ map: skinTexture(kind, variant), transparent: true, opacity: 0.6, depthWrite: false })
    : undefined;
  const root = new THREE.Group();
  const scaleGroup = new THREE.Group();
  scaleGroup.scale.setScalar(1);
  root.add(scaleGroup);
  const parts = new Map<string, THREE.Object3D>();
  const build = (spec: PartSpec, parent: THREE.Object3D) => {
    const pivot = new THREE.Group();
    pivot.position.set(spec.pivot[0] / 16, spec.pivot[1] / 16, spec.pivot[2] / 16);
    if (spec.rotation) pivot.rotation.set(...spec.rotation);
    // Kept so a pose can move a part from where the model holds it, not from zero (a creature's tilted neck).
    pivot.userData.base = spec.rotation ?? [0, 0, 0];
    const gkey = `${spec.size}:${spec.uv}:${spec.inflate ?? 0}`;
    let g = geometryCache.get(gkey);
    if (!g) { g = boxGeometry(spec.size[0], spec.size[1], spec.size[2], spec.uv[0], spec.uv[1], spec.inflate); geometryCache.set(gkey, g); }
    const mesh = new THREE.Mesh(g, spec.material === "wool" && wool ? wool : spec.material === "gel" && gel ? gel : material);
    if (spec.offset) mesh.position.set(spec.offset[0] / 16, spec.offset[1] / 16, spec.offset[2] / 16);
    pivot.add(mesh);
    parent.add(pivot);
    parts.set(spec.name, pivot);
    for (const c of spec.children ?? []) build(c, mesh);
  };
  for (const spec of MODELS[kind] ?? MODELS.pig) build(spec, scaleGroup);
  parts.set("__scale", scaleGroup);
  return { root, parts, material, wool, gel };
}

export interface PoseInput {
  x: number; y: number; z: number;
  yaw: number;
  pitch: number;
  /** Distance walked (interpolated) and recent speed, for the leg swing. */
  walk: number;
  speed: number;
  /** 0..1 light from world brightness. */
  light: number;
  hurt: boolean;
  /** Ticks into dying, or 0. */
  death: number;
  swing: number;
  time: number;
  baby?: boolean;
  sneaking?: boolean;
  /** Creeper swell 0..1. */
  swell?: number;
  flash?: boolean;
  woolColor?: number;
  sheared?: boolean;
  onGround?: boolean;
  armsForward?: boolean;
  /** A slime's size (1, 2 or 4) and its stretch or squash. */
  size?: number;
  squish?: number;
  /** Sideways tilt: a vehicle's shake when struck. */
  rock?: number;
  /** A rider: legs forward, as seated in a boat or a cart. */
  sitting?: boolean;
  /** On elytra: lying along the flight, wings spread. */
  gliding?: boolean;
  /** An enderman screaming (head back, jaw wide) or carrying a block (arms out). */
  screaming?: boolean;
  carrying?: boolean;
  /** The dragon: its climb or dive (radians), and whether it is perched. */
  bank?: number;
  /** A shulker: the Face that holds to its block, how open its lid is (0-1), and where its head looks. */
  attach?: number;
  peek?: number;
  headYaw?: number;
  /** Primal: wearing a saddle; knocked out (lying on its side). */
  saddled?: boolean;
  asleep?: boolean;
}

/** Turns a shulker so the side it holds by faces its block: [x, z] rotations by the Face (E W U D S N). */
const SHULKER_ORIENT: [number, number][] = [[0, Math.PI / 2], [0, -Math.PI / 2], [Math.PI, 0], [0, 0], [-Math.PI / 2, 0], [Math.PI / 2, 0]];

const WOOL_TINTS = WOOL_COLORS.map((c) => ({
  white: "#f0f0f0", orange: "#f9801d", magenta: "#c74ebd", light_blue: "#3ab3da", yellow: "#fed83d", lime: "#80c71f",
  pink: "#f38baa", gray: "#474f52", light_gray: "#9d9d97", cyan: "#169c9c", purple: "#8932b8", blue: "#3c44aa",
  brown: "#835432", green: "#5e7c16", red: "#b02e26", black: "#1d1d21",
}[c]!));

export function pose(m: ModelInstance, kind: string, p: PoseInput): void {
  const r = m.root;
  r.position.set(p.x, p.y, p.z);
  r.rotation.set(0, p.yaw, 0);
  const scale = m.parts.get("__scale")!;
  const s = (p.baby ? 0.5 : 1) * (1 + (p.swell ?? 0) * 0.25) * (p.size ?? 1);
  const stretch = 1 + (p.squish ?? 0) * 0.5;
  scale.scale.set(s * (1 + (p.swell ?? 0) * 0.1) / stretch, s * stretch, s * (1 + (p.swell ?? 0) * 0.1) / stretch);
  r.rotation.order = "YXZ";
  // The dragon rises in its death throes rather than keeling over.
  if (p.death > 0 && kind !== "ender_dragon") r.rotation.z = Math.min(1, p.death / 20) * (Math.PI / 2);
  else r.rotation.z = p.rock ?? 0;
  // A glider lies face down along its flight, tipped up as it climbs; the dragon noses into a dive.
  if (p.gliding) { r.rotation.x = -Math.PI / 2 + p.pitch * 0.8; r.position.y += 0.3; }
  if (kind === "ender_dragon") r.rotation.x = p.bank ?? 0;
  // A crawler lies face down along the way it is going, a little off the floor so its chest is not in it.
  if (kind === "crawler" && !(p.death > 0)) { r.rotation.x = -Math.PI / 2; r.position.y += 0.25; }

  const l = Math.max(0.12, p.light);
  const hurtTint = p.hurt || p.death > 0;
  m.material.color.setRGB(l, hurtTint ? l * 0.45 : l, hurtTint ? l * 0.45 : l);
  if (p.flash) m.material.color.setRGB(1.6, 1.6, 1.6);
  if (m.gel) m.gel.color.copy(m.material.color);
  if (m.wool) {
    const c = col(WOOL_TINTS[p.woolColor ?? 0] ?? "#f0f0f0");
    m.wool.color.setRGB(c.r * l, c.g * l * (hurtTint ? 0.45 : 1), c.b * l * (hurtTint ? 0.45 : 1));
    const wool = m.parts.get("wool");
    if (wool) wool.visible = !p.sheared;
  }

  const swing = Math.sin(p.walk * 4) * Math.min(1, p.speed * 8) * 1.1;
  const set = (name: string, x: number, y = 0, z = 0) => {
    const part = m.parts.get(name);
    if (part) part.rotation.set(x, y, z);
  };
  const head = m.parts.get("head");
  // Pitch is positive looking up; a positive x rotation tips the -z face upward.
  if (head) head.rotation.set(p.pitch, 0, 0);

  const wingR = m.parts.get("wingR"), wingL = m.parts.get("wingL");
  if (kind === "player" && wingR && wingL) {
    wingR.visible = wingL.visible = !!p.gliding;
    // Spread in a shallow V behind the shoulders.
    wingR.rotation.set(0.15, 0, 0.35); wingL.rotation.set(0.15, 0, -0.35);
  }

  if (DINO_MODELS[kind] || CRITTER_MODELS[kind]) { poseDino(m, p, swing, r); return; }

  switch (kind) {
    case "enderman": {
      if (head) head.rotation.set(p.screaming ? 0.35 : p.pitch, 0, 0);
      if (p.carrying) {
        set("rightArm", -0.9, 0, 0.05); set("leftArm", -0.9, 0, -0.05);
      } else {
        const attack = p.swing > 0 ? -Math.sin(p.swing * Math.PI) * 1.2 : 0;
        set("rightArm", -swing * 0.6 + attack, 0, 0.05); set("leftArm", swing * 0.6, 0, -0.05);
      }
      set("rightLeg", swing * 0.6); set("leftLeg", -swing * 0.6);
      break;
    }
    case "shulker": {
      // Turned about the middle of its block, so it can hold to a wall or a ceiling as well as a floor.
      const [ox, oz] = SHULKER_ORIENT[p.attach ?? 3] ?? [0, 0];
      r.rotation.set(ox, 0, oz);
      r.position.y += 0.5;
      scale.position.y = -0.5;
      const peek = p.peek ?? 0;
      const lid = m.parts.get("lid");
      if (lid) { lid.position.y = (5 + peek * 4) / 16; lid.rotation.set(0, peek * Math.PI * 0.4, 0); }
      set("head", 0, p.headYaw ?? 0, 0);
      break;
    }
    case "silverfish":
      for (let i = 0; i < 6; i++) set(`seg${i}`, 0, Math.sin(p.time * 9 + i * 0.9) * 0.18 * (0.3 + Math.min(1, p.speed * 10)), 0);
      break;
    case "ender_dragon": {
      // Wings beat slowly (held still perched); the jaw works; the tail swings.
      const beat = p.onGround ? 0.15 : Math.sin(p.time * 3) * 0.7;
      set("wingR", 0, 0, -beat); set("wingL", 0, 0, beat);
      set("tipR", 0, 0, -beat * 0.6 - 0.1); set("tipL", 0, 0, beat * 0.6 + 0.1);
      set("jaw", Math.max(0, Math.sin(p.time * 1.4)) * (p.onGround ? 0.6 : 0.25), 0, 0);
      if (head) head.rotation.set(0, 0, 0);
      for (let i = 0; i < 6; i++) set(`tail${i}`, 0, Math.sin(p.time * 1.5 + i * 0.6) * 0.12 * (i + 1), 0);
      for (let i = 0; i < 3; i++) set(`neck${i}`, Math.sin(p.time * 1.2 + i) * 0.05, 0, 0);
      break;
    }
    case "player": case "zombie": case "skeleton": case "piglin": case "zombified_piglin": case "wither_skeleton": case "tribute": case "trainer": case "citizen": case "cop":
    case "infected": case "runner": case "brute": case "spitter": case "screamer": case "bloater": case "shambler": case "crawler": {
      const sneak = p.sneaking ? 0.5 : 0;
      const body = m.parts.get("body");
      if (body) body.rotation.x = sneak;
      if (kind === "crawler") {
        // Hauling itself along by its hands, over its head as it lies; the legs trail behind.
        const claw = Math.sin(p.walk * 4) * 0.5;
        set("rightArm", Math.PI - 0.2 + claw, 0, 0.1); set("leftArm", Math.PI - 0.2 - claw, 0, -0.1);
        set("rightLeg", 0.05, 0, 0.05); set("leftLeg", 0.05, 0, -0.05);
        if (head) head.rotation.set(Math.PI / 2 * 0.8 + p.pitch, 0, 0);
        break;
      }
      if (p.armsForward) {
        set("rightArm", -Math.PI / 2 + Math.sin(p.time * 3) * 0.05, 0, 0);
        set("leftArm", -Math.PI / 2 - Math.sin(p.time * 3) * 0.05, 0, 0);
      } else {
        const attack = p.swing > 0 ? -Math.sin(p.swing * Math.PI) * 1.4 : 0;
        set("rightArm", -swing + attack - sneak * 0.4, 0, 0.05);
        set("leftArm", swing - sneak * 0.4, 0, -0.05);
      }
      if (p.sitting) { set("rightLeg", -1.4, 0.1); set("leftLeg", -1.4, -0.1); }
      else { set("rightLeg", swing); set("leftLeg", -swing); }
      break;
    }
    case "villager":
      set("rightLeg", swing * 0.8); set("leftLeg", -swing * 0.8);
      break;
    case "iron_golem": {
      // Slow, heavy strides; both arms come up to strike.
      set("legR", swing * 0.6); set("legL", -swing * 0.6);
      const raise = p.swing > 0 ? -2 * p.swing : 0;
      set("armR", raise - swing * 0.5); set("armL", raise + swing * 0.5);
      break;
    }
    case "boat": {
      // The paddles dip in turn while the boat is driven.
      // Angled out over the sides, blades dipping behind as they pull.
      const stroke = p.walk;
      set("paddleL", 0.4 + Math.sin(stroke) * 0.4, -0.7 + Math.cos(stroke) * 0.25, 0);
      set("paddleR", 0.4 + Math.sin(stroke) * 0.4, 0.7 - Math.cos(stroke) * 0.25, 0);
      break;
    }
    case "ghast":
      // Tentacles trail and sway.
      for (let i = 0; i < 9; i++) set(`tentacle${i}`, Math.sin(p.time * 2 + i * 1.3) * 0.25 + 0.1, 0, Math.cos(p.time * 1.7 + i) * 0.12);
      break;
    case "blaze":
      // The rings spin, alternate ones the other way, and bob.
      for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 4; i++) {
        const part = m.parts.get(`rod${ring}${i}`);
        if (!part) continue;
        part.rotation.set(0, (ring % 2 ? -1 : 1) * p.time * (1.6 - ring * 0.3) + (i * Math.PI) / 2, 0);
        part.position.y = ([17, 11, 5][ring] + Math.sin(p.time * 3 + i + ring) * 0.8) / 16;
      }
      break;
    case "pig": case "cow": case "sheep": case "creeper": case "hoglin": case "deer": case "bear":
      set("legFR", swing); set("legBL", swing);
      set("legFL", -swing); set("legBR", -swing);
      if (kind === "deer") set("tail", Math.sin(p.time * 5) * 0.2, 0, 0);
      break;
    case "wolf": {
      const body = m.parts.get("body"), mane = m.parts.get("mane"), tail = m.parts.get("tail");
      const hindR = m.parts.get("legBR"), hindL = m.parts.get("legBL");
      if (p.sitting) {
        // Haunches down, hind legs folded flat under them, front legs straight, tail on the ground.
        if (body) { body.rotation.set(-0.75, 0, 0); body.position.set(0, 7.5 / 16, 2.5 / 16); }
        if (mane) mane.rotation.set(-0.3, 0, 0);
        for (const leg of [hindR, hindL]) if (leg) { leg.position.y = 1 / 16; leg.position.z = 1.5 / 16; leg.rotation.set(-Math.PI / 2, 0, 0); }
        set("legFR", 0); set("legFL", 0);
        if (tail) { tail.rotation.set(1.5, 0, 0); tail.position.y = 3 / 16; }
      } else {
        if (body) { body.rotation.set(0, 0, 0); body.position.set(0, 10 / 16, 1.5 / 16); }
        if (mane) mane.rotation.set(0, 0, 0);
        for (const leg of [hindR, hindL]) if (leg) { leg.position.y = 8 / 16; leg.position.z = 3.5 / 16; }
        if (tail) tail.position.y = 12 / 16;
        set("legFR", swing); set("legBL", swing); set("legFL", -swing); set("legBR", -swing);
        // Tail up and wagging when tame and near, low when angry.
        if (tail) tail.rotation.set(p.screaming ? 1.4 : 0.9, Math.sin(p.time * 12) * (p.carrying ? 0.5 : 0.1), 0);
      }
      break;
    }
    case "chicken": {
      set("legR", swing); set("legL", -swing);
      const flap = p.onGround ? 0 : Math.sin(p.time * 30) * 0.8 + 0.8;
      set("wingR", 0, 0, flap); set("wingL", 0, 0, -flap);
      break;
    }
    case "spider": {
      for (const [name, part] of m.parts) {
        if (!name.startsWith("leg")) continue;
        const side = name.startsWith("leg-1") ? -1 : 1;
        const i = Number(name.slice(-1));
        const phase = Math.sin(p.walk * 6 + i * 1.6) * Math.min(1, p.speed * 8) * 0.4;
        const z = [-1.5, -0.5, 0.5, 1.5][i];
        part.rotation.set(0, side * (z * 0.35) + phase, side * -0.6 + Math.abs(phase) * 0.3 * side);
      }
      break;
    }
  }
}

/**
 * Primal's creatures: legs stride, tails and necks sway, a jaw opens to bite,
 * wings beat aloft and fold on the ground; a creature knocked out lies on its
 * side; the saddle shows when one is on.
 */
function poseDino(m: ModelInstance, p: PoseInput, swing: number, r: THREE.Object3D): void {
  const turn = (name: string, x = 0, y = 0, z = 0) => {
    const part = m.parts.get(name);
    if (!part) return;
    const [bx, by, bz] = (part.userData.base as [number, number, number] | undefined) ?? [0, 0, 0];
    part.rotation.set(bx + x, by + y, bz + z);
  };
  const saddle = m.parts.get("saddle");
  if (saddle) saddle.visible = !!p.saddled;
  if (p.asleep) r.rotation.z = Math.PI / 2;
  const still = p.asleep ? 0 : 1;
  const s = swing * still;
  if (m.parts.has("legFR")) {
    turn("legFR", s); turn("legBL", s); turn("legFL", -s); turn("legBR", -s);
  } else {
    turn("legR", s); turn("legL", -s);
  }
  turn("armR", -s * 0.4); turn("armL", s * 0.4);
  const sway = Math.sin(p.time * 2) * 0.12 * still;
  turn("tail", 0, sway + s * 0.08, 0);
  turn("tailTip", 0, sway * 1.5, 0);
  const bite = p.swing > 0 ? Math.sin(Math.min(1, p.swing) * Math.PI) : 0;
  turn("jaw", bite * 0.6);
  turn("head", p.pitch * 0.5 - bite * 0.15 + Math.sin(p.time * 1.3) * 0.03 * still, 0, 0);
  turn("neck", Math.sin(p.time * 0.9) * 0.05 * still);
  // Aloft, wings beat; on the ground, they fold down along the body.
  const flap = p.onGround || p.asleep ? 0.9 : Math.sin(p.time * 6) * 0.6;
  if (m.parts.has("wingR")) {
    const wide = (m.parts.get("wingR") as THREE.Object3D).children.length > 0 && Math.abs(((m.parts.get("wingR")!.children[0] as THREE.Mesh).position.x)) > 0.2;
    if (wide) { turn("wingR", 0, 0, -flap); turn("wingL", 0, 0, flap); }
    else { turn("wingR", 0, 0, 0.1 + (p.onGround ? 0 : Math.abs(flap) * 0.4)); turn("wingL", 0, 0, -0.1 - (p.onGround ? 0 : Math.abs(flap) * 0.4)); }
  }
}

// ---- items in the world ---------------------------------------------------------------

export class ItemView {
  readonly root = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.RawShaderMaterial;
  readonly kind: "block" | "sprite";

  constructor(shared: SharedUniforms, itemId: number, private count: number, size = 1) {
    const model = itemModel(itemId);
    this.kind = model.kind;
    this.material = model.kind === "block" ? createLitBlockMaterial(shared) : createSpriteMaterial(shared);
    this.mesh = new THREE.Mesh(model.geometry, this.material);
    const s = (model.kind === "block" ? 0.25 : 0.4) * size;
    this.mesh.scale.setScalar(s);
    this.root.add(this.mesh);
    // A stack shows as two or three copies, like a little pile.
    const extra = count > 32 ? 2 : count > 1 ? 1 : 0;
    for (let i = 0; i < extra; i++) {
      const c = new THREE.Mesh(model.geometry, this.material);
      c.scale.setScalar(s);
      c.position.set((i + 1) * 0.05, (i + 1) * 0.03, (i + 1) * -0.05);
      this.root.add(c);
    }
  }

  setLight(sky: number, blockLight: number): void {
    this.material.uniforms.uSky.value = sky;
    this.material.uniforms.uBlock.value = blockLight;
  }

  setFlash(v: number): void {
    this.material.uniforms.uFlash.value = v;
  }

  dispose(): void {
    this.material.dispose();
  }

  get stackCount(): number {
    return this.count;
  }
}

/** A name floating above another player. */
export function nameTag(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 28px monospace";
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = 40;
  ctx.font = "bold 28px monospace";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(w / 80, 0.5, 1);
  sprite.renderOrder = 10;
  return sprite;
}
