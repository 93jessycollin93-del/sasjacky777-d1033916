/**
 * Box models for Primal's creatures, and what each box is (its "role") so
 * the skin painter knows to make a head look like a head. All original.
 *
 * Big creatures are modelled small and drawn larger (creatures.ts scale),
 * as the hoglin and the bear are, so every skin fits one 64×64 sheet. Rather
 * than lay each sheet out by hand, the boxes are packed onto it here — the
 * model maps and the skin paints from the same packing, so they cannot
 * disagree.
 */

export type Role = "body" | "belly" | "head" | "jaw" | "beak" | "neck" | "leg" | "arm" | "tail" | "crest" | "frill" | "horn" | "plate" | "spike" | "wing" | "feather" | "saddle"
  // Critters' parts (render/critterModels.ts).
  | "ear" | "flame" | "leaf" | "fin" | "shell" | "glow" | "gill" | "mane" | "tooth" | "antenna" | "tentacle" | "lantern" | "moss" | "rock";

export interface DinoPart {
  name: string;
  size: [number, number, number];
  uv: [number, number];
  pivot: [number, number, number];
  offset?: [number, number, number];
  rotation?: [number, number, number];
  role: Role;
  /** Parts sharing a key share one patch of skin (four legs, two arms, a row of plates). */
  share?: string;
  children?: DinoPart[];
}

export type Spec = Omit<DinoPart, "uv" | "children"> & { children?: Spec[] };

export const P = (name: string, size: [number, number, number], pivot: [number, number, number], role: Role, extra: Partial<Spec> = {}): Spec =>
  ({ name, size, pivot, role, ...extra });

export const legs2 = (size: [number, number, number], x: number, y: number, z: number): Spec[] => [
  P("legR", size, [-x, y, z], "leg", { offset: [0, -size[1] / 2, 0], share: "leg" }),
  P("legL", size, [x, y, z], "leg", { offset: [0, -size[1] / 2, 0], share: "leg" }),
];
export const legs4 = (size: [number, number, number], x: number, y: number, z: number): Spec[] => [
  P("legFR", size, [-x, y, -z], "leg", { offset: [0, -size[1] / 2, 0], share: "leg" }),
  P("legFL", size, [x, y, -z], "leg", { offset: [0, -size[1] / 2, 0], share: "leg" }),
  P("legBR", size, [-x, y, z], "leg", { offset: [0, -size[1] / 2, 0], share: "leg" }),
  P("legBL", size, [x, y, z], "leg", { offset: [0, -size[1] / 2, 0], share: "leg" }),
];
export const arms = (size: [number, number, number], x: number, y: number, z: number): Spec[] => [
  P("armR", size, [-x, y, z], "arm", { offset: [0, -size[1] / 2, 0], rotation: [-0.6, 0, 0], share: "arm" }),
  P("armL", size, [x, y, z], "arm", { offset: [0, -size[1] / 2, 0], rotation: [-0.6, 0, 0], share: "arm" }),
];
/** A saddle on the back, shown only when one is on (models.ts pose). */
const saddle = (w: number, top: number): Spec => P("saddle", [w, 2, 6], [0, top + 1, 0], "saddle");

const SPECS: Record<string, Spec[]> = {
  dodo: [
    ...legs2([1, 3, 1], 1.5, 3, 0),
    P("body", [6, 6, 7], [0, 6, 0], "body"),
    P("head", [3, 4, 3], [0, 9, -3], "head", { offset: [0, 1, -1], children: [P("beak", [2, 2, 3], [0, -0.5, -3], "beak")] }),
    P("wingR", [1, 3, 4], [-3.5, 7, 0], "wing", { share: "wing" }),
    P("wingL", [1, 3, 4], [3.5, 7, 0], "wing", { share: "wing" }),
    P("tail", [2, 2, 2], [0, 8, 4], "feather"),
  ],
  dilo: [
    ...legs2([2, 9, 2], 2, 9, 1),
    P("body", [5, 6, 10], [0, 11, 0], "body"),
    P("head", [4, 4, 6], [0, 14, -6], "head", {
      offset: [0, 0, -2],
      children: [P("crestR", [1, 3, 4], [-1, 2.5, 0], "crest", { share: "crest" }), P("crestL", [1, 3, 4], [1, 2.5, 0], "crest", { share: "crest" }), P("jaw", [3, 1, 5], [0, -2.5, -0.5], "jaw")],
    }),
    ...arms([1, 4, 1], 2, 11, -4),
    P("tail", [2, 2, 9], [0, 12, 5], "tail", { offset: [0, 0, 4.5] }),
  ],
  raptor: [
    ...legs2([3, 12, 3], 2.5, 12, 1),
    P("body", [6, 7, 12], [0, 15, 0], "body", { children: [saddle(5, 3.5)] }),
    P("head", [5, 5, 8], [0, 19, -7], "head", { offset: [0, 0, -3], children: [P("jaw", [4, 1, 6], [0, -3, -0.5], "jaw")] }),
    ...arms([1, 5, 1], 2.5, 14, -5),
    P("tail", [3, 3, 10], [0, 16, 6], "tail", { offset: [0, 0, 5], children: [P("tailTip", [2, 2, 8], [0, 0, 5], "tail", { offset: [0, 0, 4] })] }),
  ],
  parasaur: [
    ...legs2([3, 10, 4], 2.5, 10, 1),
    P("body", [7, 8, 13], [0, 14, 0], "body", { children: [saddle(6, 4)] }),
    ...arms([2, 6, 2], 3, 13, -5),
    P("neck", [3, 6, 3], [0, 17, -6], "neck", { offset: [0, 2, -1], rotation: [0.25, 0, 0] }),
    P("head", [4, 5, 7], [0, 21, -8], "head", { offset: [0, 0, -2], children: [P("crest", [1, 2, 8], [0, 3, 3], "crest", { rotation: [0.5, 0, 0] })] }),
    P("tail", [4, 4, 12], [0, 14, 7], "tail", { offset: [0, 0, 6] }),
  ],
  rex: [
    ...legs2([4, 10, 4], 3, 10, 1.5),
    P("body", [8, 9, 14], [0, 14, 0], "body", { children: [saddle(7, 4.5)] }),
    P("head", [7, 7, 10], [0, 18, -8], "head", { offset: [0, 0, -4], children: [P("jaw", [6, 2, 8], [0, -4, -1], "jaw")] }),
    ...arms([1, 3, 1], 3.5, 12, -5),
    P("tail", [5, 5, 10], [0, 15, 7], "tail", { offset: [0, 0, 5], children: [P("tailTip", [3, 3, 10], [0, 0, 5], "tail", { offset: [0, 0, 5] })] }),
  ],
  gigantoraptor: [
    ...legs2([3, 15, 3], 2.5, 15, 1),
    P("body", [7, 8, 11], [0, 19, 0], "feather", { children: [saddle(6, 4)] }),
    P("neck", [3, 9, 3], [0, 21, -5], "neck", { offset: [0, 4, -1], rotation: [0.2, 0, 0] }),
    P("head", [4, 4, 6], [0, 30, -7], "head", { offset: [0, 0, -2], children: [P("beak", [2, 2, 3], [0, -1, -4.5], "beak")] }),
    P("wingR", [1, 6, 5], [-4, 21, -1], "wing", { offset: [0, -3, 0], share: "wing" }),
    P("wingL", [1, 6, 5], [4, 21, -1], "wing", { offset: [0, -3, 0], share: "wing" }),
    P("tail", [5, 3, 6], [0, 20, 6], "feather", { offset: [0, 0, 3], rotation: [-0.3, 0, 0] }),
  ],
  trike: [
    ...legs4([3, 6, 3], 3.5, 6, 6),
    P("body", [10, 8, 16], [0, 10, 0], "body", { children: [saddle(8, 4)] }),
    P("head", [7, 6, 7], [0, 9, -9], "head", {
      offset: [0, 0, -3],
      children: [
        P("frill", [11, 8, 1], [0, 3, 3.5], "frill", { rotation: [-0.35, 0, 0] }),
        P("hornR", [1, 1, 6], [-2, 2, -3], "horn", { rotation: [0.35, 0, 0], share: "horn" }),
        P("hornL", [1, 1, 6], [2, 2, -3], "horn", { rotation: [0.35, 0, 0], share: "horn" }),
        P("nose", [1, 2, 1], [0, 0, -4], "horn"),
      ],
    }),
    P("tail", [4, 4, 8], [0, 10, 8], "tail", { offset: [0, 0, 4], rotation: [0.2, 0, 0] }),
  ],
  stego: [
    ...legs4([3, 7, 3], 3, 7, 6),
    P("body", [9, 8, 16], [0, 11, 0], "body", { children: [saddle(7, 4)] }),
    ...[-6, -3, 0, 3, 6].map((z, i) => P(`plate${i}`, [1, 5, 4], [0, 16, z], "plate", { share: "plate" })),
    P("head", [4, 4, 6], [0, 8, -9], "head", { offset: [0, 0, -3] }),
    P("tail", [3, 3, 10], [0, 11, 8], "tail", {
      offset: [0, 0, 5], rotation: [0.15, 0, 0],
      children: [P("spikeR", [1, 1, 5], [-1.5, 1, 4], "spike", { rotation: [-0.5, -0.6, 0], share: "spike" }), P("spikeL", [1, 1, 5], [1.5, 1, 4], "spike", { rotation: [-0.5, 0.6, 0], share: "spike" })],
    }),
  ],
  bronto: [
    ...legs4([4, 9, 4], 3.5, 9, 5),
    P("body", [10, 9, 14], [0, 13, 0], "body", { children: [saddle(8, 4.5)] }),
    P("neck", [4, 4, 14], [0, 15, -6], "neck", {
      offset: [0, 0, -7], rotation: [0.9, 0, 0],
      children: [P("head", [4, 3, 5], [0, 0, -7], "head", { offset: [0, 0, -2], rotation: [-0.9, 0, 0] })],
    }),
    P("tail", [3, 3, 16], [0, 13, 7], "tail", { offset: [0, 0, 8], rotation: [0.15, 0, 0] }),
  ],
  ptero: [
    P("body", [4, 4, 8], [0, 6, 0], "body", { children: [saddle(3, 2)] }),
    P("head", [3, 3, 4], [0, 8, -4], "head", {
      offset: [0, 0, -2],
      children: [P("beak", [1, 1, 6], [0, -0.5, -5], "beak"), P("crest", [1, 2, 5], [0, 2, 2], "crest", { rotation: [0.8, 0, 0] })],
    }),
    P("wingR", [14, 1, 6], [-2, 7, -1], "wing", { offset: [-7, 0, 0], share: "wing" }),
    P("wingL", [14, 1, 6], [2, 7, -1], "wing", { offset: [7, 0, 0], share: "wing" }),
    ...legs2([1, 4, 1], 1, 4, 3),
  ],
};

/** Lays every box's skin out on a 64×64 sheet, tallest first, row by row. */
export function pack(specs: Spec[]): DinoPart[] {
  const flat: Spec[] = [];
  const walk = (s: Spec) => { flat.push(s); s.children?.forEach(walk); };
  specs.forEach(walk);
  const keyOf = (s: Spec) => s.share ?? s.name;
  const unique = new Map<string, Spec>();
  for (const s of flat) if (!unique.has(keyOf(s))) unique.set(keyOf(s), s);
  const footprint = (s: Spec): [number, number] => [2 * (s.size[0] + s.size[2]), s.size[2] + s.size[1]];
  const order = [...unique.entries()].sort((a, b) => footprint(b[1])[1] - footprint(a[1])[1]);
  const uvs = new Map<string, [number, number]>();
  // First fit: each box goes on the first row with room (rows are opened tallest first, so it fits their height).
  const rows: { y: number; h: number; x: number }[] = [];
  for (const [key, s] of order) {
    const [w, h] = footprint(s);
    let row = rows.find((r) => r.x + w <= 64);
    if (!row) {
      const y = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : 0;
      row = { y, h, x: 0 };
      rows.push(row);
    }
    uvs.set(key, [row.x, row.y]);
    row.x += w;
  }
  const bottom = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : 0;
  if (bottom > 64) throw new Error(`creature skin overflows its sheet (${specs[0]?.name}: ${bottom} rows)`);
  const place = (s: Spec): DinoPart => ({ ...s, uv: uvs.get(keyOf(s))!, children: s.children?.map(place) });
  return specs.map(place);
}

export const DINO_MODELS: Record<string, DinoPart[]> = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, pack(v)]));

/** Every box of a creature's model, children included, for the skin painter. */
export function dinoBoxes(kind: string): DinoPart[] {
  const out: DinoPart[] = [];
  const walk = (p: DinoPart) => { out.push(p); p.children?.forEach(walk); };
  (DINO_MODELS[kind] ?? []).forEach(walk);
  return out;
}

/** Each creature's colours: hide, underside, markings, and one accent (crest, frill, beak, plates). */
export const DINO_COLORS: Record<string, { hide: string; belly: string; mark: string; accent: string }> = {
  dodo: { hide: "#7a6a5a", belly: "#a89a88", mark: "#5a4a3c", accent: "#d8c060" },
  dilo: { hide: "#5a8a3a", belly: "#c8d890", mark: "#3a5a26", accent: "#c03020" },
  raptor: { hide: "#8a6a3a", belly: "#d8c8a0", mark: "#4a3620", accent: "#b04a2a" },
  parasaur: { hide: "#b8703a", belly: "#e8d0a0", mark: "#7a4a20", accent: "#c04020" },
  rex: { hide: "#5a4a38", belly: "#a89878", mark: "#3a2e22", accent: "#8a2a1a" },
  gigantoraptor: { hide: "#b8a078", belly: "#e8dcc0", mark: "#6a5038", accent: "#d8b060" },
  trike: { hide: "#7a6a4a", belly: "#a89a78", mark: "#5a4a32", accent: "#a84a2a" },
  stego: { hide: "#6a7a4a", belly: "#b8b890", mark: "#4a5a32", accent: "#b85a2a" },
  bronto: { hide: "#6a6a60", belly: "#9a9a88", mark: "#4e4e46", accent: "#8a8a7a" },
  ptero: { hide: "#8a5a3a", belly: "#c8a080", mark: "#5a3a22", accent: "#c04020" },
};
