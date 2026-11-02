/**
 * The cars, drawn: boxes in flat colours, like everything else in the game,
 * but built per model rather than painted onto a skin — a car's panels are
 * one colour each, and a 64×64 sheet would spend itself on a single body.
 *
 * Paint and trim take the world's light; the lamps do not, so at night a
 * car is a pair of headlights and a pair of red tail lights coming down the
 * street, which is most of what makes a city at night look like one. The
 * glass is see-through, so whoever is driving shows.
 */
import * as THREE from "three";
import { CAR_COLORS, CAR_MODELS, type CarModelId } from "../engine/cars";
import { col } from "./materials";

export interface CarView {
  root: THREE.Group;
  /** Tilts with the body: lean in the corners, the shake of a blow. */
  body: THREE.Group;
  wheels: THREE.Group[];
  /** Materials the light shades, with their colour in full light. */
  shaded: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[];
  glass: THREE.MeshBasicMaterial;
  lamps: THREE.MeshBasicMaterial[];
  siren: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] | null;
  /** Where the driver's hips go, in the car's own frame. */
  seat: THREE.Vector3;
  model: CarModelId;
  color: number;
  wrecked: boolean;
}

const geo = new Map<string, THREE.BoxGeometry>();
function box(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `${w}:${h}:${d}`;
  let g = geo.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geo.set(k, g); }
  return g;
}

export function buildCar(model: CarModelId, color: number, wrecked = false): CarView {
  const m = CAR_MODELS[model];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shaded: CarView["shaded"] = [];
  const mat = (hex: string) => {
    const base = wrecked ? col("#1e1c1a").lerp(col(hex), 0.08) : col(hex);
    const mm = new THREE.MeshBasicMaterial({ color: base.clone() });
    shaded.push({ mat: mm, base });
    return mm;
  };
  const paint = mat(CAR_COLORS[color % CAR_COLORS.length]);
  const trim = mat("#26262a");
  const chrome = mat("#b8b8c0");
  const tyre = mat("#141414");
  const glass = new THREE.MeshBasicMaterial({ color: col("#4a6a88"), transparent: true, opacity: wrecked ? 0 : 0.45, depthWrite: false });
  const head = new THREE.MeshBasicMaterial({ color: col(wrecked ? "#222222" : "#fff6c8") });
  const tail = new THREE.MeshBasicMaterial({ color: col(wrecked ? "#221111" : "#ff2a2a") });
  const lamps = [head, tail];
  const W = m.w, L = m.l, H = m.h;
  const add = (g: THREE.BoxGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // Proportions per model: the lower body's height, the cabin's size and where it sits.
  const shape: Record<CarModelId, { sill: number; low: number; cabW: number; cabH: number; cabL: number; cabZ: number }> = {
    compact: { sill: 0.25, low: 0.55, cabW: W - 0.2, cabH: H - 0.85, cabL: 1.6, cabZ: 0.2 },
    sedan: { sill: 0.25, low: 0.55, cabW: W - 0.2, cabH: H - 0.85, cabL: 2.0, cabZ: 0.25 },
    taxi: { sill: 0.25, low: 0.55, cabW: W - 0.2, cabH: H - 0.85, cabL: 2.0, cabZ: 0.25 },
    police: { sill: 0.25, low: 0.55, cabW: W - 0.2, cabH: H - 0.85, cabL: 2.0, cabZ: 0.25 },
    sports: { sill: 0.2, low: 0.5, cabW: W - 0.3, cabH: H - 0.75, cabL: 1.7, cabZ: 0.45 },
    super: { sill: 0.18, low: 0.45, cabW: W - 0.4, cabH: H - 0.68, cabL: 1.6, cabZ: 0.2 },
    muscle: { sill: 0.25, low: 0.55, cabW: W - 0.25, cabH: H - 0.85, cabL: 1.7, cabZ: 0.55 },
    van: { sill: 0.3, low: 0.7, cabW: W, cabH: H - 1.0, cabL: L - 0.9, cabZ: 0.45 },
    pickup: { sill: 0.3, low: 0.7, cabW: W - 0.05, cabH: H - 1.0, cabL: 1.6, cabZ: -0.3 },
  };
  const s = shape[model];
  const lowTop = s.sill + s.low;
  // Lower body and bumpers.
  add(box(W, s.low, L), paint, 0, s.sill + s.low / 2, 0);
  add(box(W + 0.04, 0.18, 0.14), trim, 0, s.sill + 0.08, -L / 2);
  add(box(W + 0.04, 0.18, 0.14), trim, 0, s.sill + 0.08, L / 2);
  add(box(W * 0.5, 0.16, 0.04), trim, 0, s.sill + s.low * 0.55, -L / 2 - 0.02);
  // Cabin: glass all round, a roof on top.
  if (model === "van") {
    add(box(W, s.cabH, s.cabL), paint, 0, lowTop + s.cabH / 2, s.cabZ);
    add(box(W - 0.1, s.cabH * 0.55, 0.06), glass, 0, lowTop + s.cabH * 0.55, s.cabZ - s.cabL / 2 - 0.03);
    // A crewmate on the side, as the van's owner insists it is not.
    for (const side of [-1, 1]) {
      add(box(0.04, 0.5, 0.36), mat("#c8202a"), side * (W / 2 + 0.02), lowTop + 0.45, s.cabZ + 0.5);
      add(box(0.05, 0.14, 0.2), mat("#9ad8ee"), side * (W / 2 + 0.03), lowTop + 0.58, s.cabZ + 0.42);
    }
  } else {
    add(box(s.cabW, s.cabH, s.cabL), glass, 0, lowTop + s.cabH / 2, s.cabZ);
    add(box(s.cabW + 0.02, 0.08, s.cabL - 0.3), paint, 0, lowTop + s.cabH, s.cabZ + 0.05);
    // Pillars at the corners of the glass.
    for (const [px, pz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) add(box(0.08, s.cabH, 0.08), paint, px * (s.cabW / 2 - 0.02), lowTop + s.cabH / 2, s.cabZ + pz * (s.cabL / 2 - 0.02));
  }
  // Lamps.
  for (const side of [-1, 1]) {
    add(box(0.36, 0.16, 0.05), head, side * (W / 2 - 0.3), s.sill + s.low * 0.7, -L / 2 - 0.02);
    add(box(0.34, 0.14, 0.05), tail, side * (W / 2 - 0.28), s.sill + s.low * 0.7, L / 2 + 0.02);
  }
  // Wheels, each a tyre with a hubcap, on a pivot the renderer turns and rolls.
  const wheels: THREE.Group[] = [];
  const r = model === "van" || model === "pickup" ? 0.34 : 0.3;
  for (const [wx, wz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx * (W / 2 - 0.1), r, wz * (L / 2 - (model === "compact" ? 0.55 : 0.75)));
    const spin = new THREE.Group();
    pivot.add(spin);
    add(box(0.26, r * 2, r * 2), tyre, 0, 0, 0, spin);
    add(box(0.28, r * 0.9, r * 0.9), chrome, wx * 0.01, 0, 0, spin);
    add(box(0.29, r * 0.3, r * 1.6), tyre, 0, 0, 0, spin);
    root.add(pivot);
    wheels.push(pivot);
  }

  let siren: CarView["siren"] = null;
  switch (model) {
    case "taxi":
      add(box(0.5, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: col(wrecked ? "#222" : "#ffe25a") }), 0, lowTop + s.cabH + 0.14, s.cabZ);
      add(box(W + 0.02, 0.12, 1.6), mat("#1c1c1c"), 0, s.sill + s.low * 0.45, 0.2);
      break;
    case "police": {
      add(box(W + 0.02, s.low * 0.55, 2.0), mat("#f4f4f4"), 0, s.sill + s.low * 0.5, 0.25);
      const red = new THREE.MeshBasicMaterial({ color: col("#ff1a1a") }), blue = new THREE.MeshBasicMaterial({ color: col("#1a4aff") });
      add(box(0.5, 0.14, 0.26), red, -0.3, lowTop + s.cabH + 0.1, s.cabZ);
      add(box(0.5, 0.14, 0.26), blue, 0.3, lowTop + s.cabH + 0.1, s.cabZ);
      siren = [red, blue];
      break;
    }
    case "sports": case "super": {
      // A wing at the back on two struts.
      add(box(W - 0.1, 0.06, 0.36), trim, 0, lowTop + 0.34, L / 2 - 0.25);
      for (const side of [-1, 1]) add(box(0.06, 0.3, 0.1), trim, side * (W / 2 - 0.3), lowTop + 0.17, L / 2 - 0.25);
      if (model === "super" && !wrecked) {
        // Underglow: the only extra a Wen Lambo owner ever skips paying for.
        const glow = new THREE.MeshBasicMaterial({ color: col("#ff3aff"), transparent: true, opacity: 0.7, depthWrite: false });
        add(box(W - 0.2, 0.02, L - 0.6), glow, 0, 0.04, 0);
        lamps.push(glow);
      }
      break;
    }
    case "muscle":
      // Racing stripes over the hood and roof, and a scoop.
      for (const side of [-0.18, 0.18]) add(box(0.16, 0.02, L - 0.2), mat("#f4f4f4"), side, lowTop + 0.01, 0);
      add(box(0.5, 0.14, 0.6), trim, 0, lowTop + 0.07, -L / 2 + 0.9);
      break;
    case "pickup":
      // The bed: low walls round an open back.
      for (const side of [-1, 1]) add(box(0.1, 0.4, L / 2 - 0.2), paint, side * (W / 2 - 0.05), lowTop + 0.2, L / 4 + 0.15);
      add(box(W, 0.4, 0.1), paint, 0, lowTop + 0.2, L / 2 - 0.05);
      break;
  }
  // Where a seated driver's feet go: their hips (0.64 up, drawn at 0.85 size) at the seat.
  const seat = new THREE.Vector3(-W / 4 + 0.05, m.seatY - 0.64, -m.seatZ);
  return { root, body, wheels, shaded, glass, lamps, siren, seat, model, color, wrecked };
}

/** Poses a car for this frame: where it is, which way it points, its wheels, its lean, its lamps. */
export function poseCar(v: CarView, p: { x: number; y: number; z: number; yaw: number; light: number; roll: number; steer: number; lean: number; rock: number; time: number; siren: boolean; night: boolean }): void {
  v.root.position.set(p.x, p.y, p.z);
  v.root.rotation.set(0, p.yaw, 0);
  v.body.rotation.set(0, 0, p.lean + p.rock);
  const l = Math.max(0.12, p.light);
  for (const s of v.shaded) s.mat.color.setRGB(s.base.r * l, s.base.g * l, s.base.b * l);
  v.wheels.forEach((w, i) => {
    w.rotation.set(0, i < 2 ? -p.steer * 0.5 : 0, 0);
    w.children[0].rotation.set(-p.roll, 0, 0);
  });
  if (v.siren) {
    const on = p.siren ? Math.floor(p.time * 6) % 2 : -1;
    v.siren[0].color.setRGB(on === 0 ? 1 : 0.25, 0.04, 0.04);
    v.siren[1].color.setRGB(0.04, 0.12, on === 1 ? 1 : 0.25);
  }
  // Lamps glow at night; by day they are only paint-bright.
  if (!v.wrecked) {
    const bright = p.night ? 1 : 0.8;
    v.lamps[0].color.setRGB(bright, bright * 0.96, bright * 0.78);
  }
}
