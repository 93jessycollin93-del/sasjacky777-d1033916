/**
 * The county's art: every face of every county block, painted in code at
 * 16×16 like the rest of the game — siding and shingles, carpet and
 * linoleum, kitchen cabinets, a CRT television, a gas pump — and the county's
 * items after it (engine/countyItems.ts names them).
 *
 * Painters are handed the shared helpers by textures.ts rather than
 * importing them, so this file depends on it for types only and the module
 * graph stays one-way. Furniture faces are painted in block coordinates: row
 * 0 is the top of the block, so a television box that stands from y=5 to
 * y=14 shows rows 2 to 11 of its front texture, and that is where its screen
 * is drawn.
 */
import type { Pixels } from "./textures";
import type { Rng } from "./rng";

type C = readonly [number, number, number];
type Painter = (p: Pixels, r: Rng) => void;
export type ItemPalette = Record<string, C>;

export interface PaintApi {
  def(name: string, painter: Painter): void;
  art(name: string, template: string, palette: ItemPalette): void;
  template(name: string, rows: string[]): void;
  hex(h: string): C;
  shade(c: C, f: number): C;
  mix(a: C, b: C, t: number): C;
  noisy(p: Pixels, r: Rng, base: C, amount: number, cell?: number): void;
  speckle(p: Pixels, r: Rng, colors: C[], density: number): void;
  bevel(p: Pixels, light?: number, dark?: number): void;
  rect(p: Pixels, x0: number, y0: number, x1: number, y1: number, c: C | ((x: number, y: number) => C), a?: number): void;
  frame(p: Pixels, c: C, inset?: number): void;
  outline(p: Pixels, x0: number, y0: number, x1: number, y1: number, c: C): void;
  planks(p: Pixels, r: Rng, base: C): void;
  bricks(p: Pixels, r: Rng, brick: C, mortar: C, rowH: number, brickW: number): void;
  wool(p: Pixels, r: Rng, c: C): void;
  valueNoise(r: Rng, g: number, gy?: number): number[];
  paletteOf(main: string, extra?: ItemPalette): ItemPalette;
}

export function paintCounty(api: PaintApi): void {
  const { def, hex, shade, mix, noisy, speckle, bevel, rect, frame, outline } = api;

  // ---- shared pieces ------------------------------------------------------------------------------
  const woodGrain = (p: Pixels, r: Rng, base: C, vertical = false) => {
    const n = api.valueNoise(r, vertical ? 8 : 2, vertical ? 2 : 8);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const along = vertical ? x : y;
      p.set(x, y, shade(base, 0.9 + n[y * 16 + x] * 0.16 + (r.next() - 0.5) * 0.05 + (along % 5 === 0 ? -0.04 : 0)));
    }
  };
  const knob = (p: Pixels, x: number, y: number, c: C = hex("#d8c078")) => { p.set(x, y, c); p.set(x + 1, y, shade(c, 0.75)); };
  const enamel = (p: Pixels, r: Rng, c: C = hex("#eeeeea")) => { noisy(p, r, c, 0.03, 4); };
  const metal = (p: Pixels, r: Rng, c: C) => {
    noisy(p, r, c, 0.05, 2);
    for (let x = 0; x < 16; x++) if (r.next() < 0.3) p.set(x, r.int(16), shade(c, 1.12));
  };
  const cabinetDoors = (p: Pixels, r: Rng, wood: C, y0: number, y1: number, drawer: boolean) => {
    woodGrain(p, r, wood, true);
    const edge = shade(wood, 0.72);
    let top = y0;
    if (drawer) {
      outline(p, 1, y0, 14, y0 + 3, edge);
      rect(p, 6, y0 + 1, 9, y0 + 1, hex("#c8b070"));
      top = y0 + 4;
    }
    outline(p, 1, top, 7, y1, edge);
    outline(p, 8, top, 14, y1, edge);
    knob(p, 5, top + 2); knob(p, 9, top + 2);
  };

  // ---- roads and ground ----------------------------------------------------------------------------
  const ASPHALT = hex("#3b3b3e");
  const asphalt = (p: Pixels, r: Rng, c = ASPHALT) => {
    noisy(p, r, c, 0.16, 4);
    speckle(p, r, [shade(c, 1.45), shade(c, 0.7), shade(c, 1.25)], 0.12);
  };
  def("asphalt", (p, r) => asphalt(p, r));
  def("asphalt_yellow_line", (p, r) => {
    asphalt(p, r);
    for (let y = 0; y < 10; y++) for (const x of [7, 8]) p.set(x, y, shade(hex("#e8b830"), 0.9 + r.next() * 0.15));
  });
  def("asphalt_white_line", (p, r) => {
    asphalt(p, r);
    for (let y = 0; y < 16; y++) for (const x of [7, 8]) p.set(x, y, shade(hex("#ececec"), 0.85 + r.next() * 0.15));
  });
  def("crosswalk", (p, r) => {
    asphalt(p, r);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (x % 8 < 5) p.set(x, y, shade(hex("#e6e6e2"), 0.85 + r.next() * 0.15));
  });
  def("sidewalk", (p, r) => {
    noisy(p, r, hex("#b4b2ac"), 0.07, 4);
    speckle(p, r, [hex("#9c9a94"), hex("#c6c4be")], 0.08);
    for (let i = 0; i < 16; i++) { p.set(i, 0, hex("#8e8c86")); p.set(0, i, hex("#8e8c86")); }
  });
  def("concrete", (p, r) => { noisy(p, r, hex("#a3a39f"), 0.06, 4); speckle(p, r, [hex("#8a8a86"), hex("#b4b4b0")], 0.05); });
  def("painted_concrete", (p, r) => { noisy(p, r, hex("#7e8e80"), 0.05, 4); speckle(p, r, [hex("#6e7e70")], 0.05); });
  def("dirt_road", (p, r) => {
    noisy(p, r, hex("#8a6e4c"), 0.14, 4);
    speckle(p, r, [hex("#a09080"), hex("#6a5a4a"), hex("#b8a890")], 0.14);
    for (let y = 0; y < 16; y++) for (const x of [3, 4, 11, 12]) p.set(x, y, shade(p.get(x, y), 0.82));
  });
  def("cracked_asphalt", (p, r) => {
    asphalt(p, r, hex("#4a4a4c"));
    let x = r.int(16), y = 0;
    while (y < 16) { p.set(x, y, hex("#232324")); x = (x + r.int(3) - 1 + 16) % 16; y++; }
    for (let i = 0; i < 6; i++) p.set((x + i) % 16, 8 + (i % 2), hex("#232324"));
  });

  // ---- walls ----------------------------------------------------------------------------------------
  const siding = (color: string) => (p: Pixels, r: Rng) => {
    const c = hex(color);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y % 4;
      const f = band === 0 ? 1.1 : band === 3 ? 0.74 : 1 - band * 0.03;
      p.set(x, y, shade(c, f + (r.next() - 0.5) * 0.04));
    }
  };
  for (const [name, color] of [["white", "#e6e6e0"], ["cream", "#e4d6b0"], ["blue", "#8ca6c2"], ["sage", "#9aae8a"], ["grey", "#9a9ea2"],
    ["yellow", "#e2cc74"], ["pink", "#d6a6a2"], ["brown", "#8a6a4c"]] as const) def(`${name}_siding`, siding(color));
  def("barn_siding", (p, r) => {
    woodGrain(p, r, hex("#8c2c24"), true);
    for (let y = 0; y < 16; y++) for (const x of [0, 4, 8, 12]) p.set(x, y, hex("#5a1a14"));
    speckle(p, r, [hex("#a86a5a")], 0.05);
  });
  def("tan_bricks", (p, r) => api.bricks(p, r, hex("#c6a476"), hex("#9e9076"), 4, 8));
  def("brown_bricks", (p, r) => api.bricks(p, r, hex("#7a4a30"), hex("#8e867a"), 4, 8));
  def("white_bricks", (p, r) => api.bricks(p, r, hex("#e2e0da"), hex("#bebcb6"), 4, 8));
  def("cinder_block", (p, r) => api.bricks(p, r, hex("#9c9c98"), hex("#76766f"), 8, 16));
  def("stucco", (p, r) => { noisy(p, r, hex("#d6c6a4"), 0.1, 8); speckle(p, r, [hex("#c2b290"), hex("#e4d6b8")], 0.25); });
  def("drywall", (p, r) => noisy(p, r, hex("#e3e1da"), 0.025, 4));
  def("cream_paint", (p, r) => noisy(p, r, hex("#e8dcc0"), 0.02, 4));
  def("floral_wallpaper", (p, r) => {
    noisy(p, r, hex("#e8dcbe"), 0.03, 4);
    for (const [x, y] of [[3, 3], [11, 3], [7, 11], [15, 11]]) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) p.set((x + dx + 16) % 16, (y + dy + 16) % 16, hex("#c85a6a"));
      p.set(x % 16, y, hex("#f0c040")); p.set((x + 1) % 16, (y + 2) % 16, hex("#5a8a4a"));
    }
  });
  def("striped_wallpaper", (p, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, shade(x % 4 < 2 ? hex("#6a8a5c") : hex("#dcd6ba"), 0.97 + r.next() * 0.05));
  });
  def("plaid_wallpaper", (p, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = hex("#56668a");
      if (x % 8 === 2 || y % 8 === 2) c = hex("#8a96b0");
      if (x % 8 === 2 && y % 8 === 2) c = hex("#b8c0d0");
      if (x % 8 === 6 || y % 8 === 6) c = mix(c, hex("#8a3a3a"), 0.5);
      p.set(x, y, shade(c, 0.97 + r.next() * 0.05));
    }
  });
  def("wood_paneling", (p, r) => {
    woodGrain(p, r, hex("#6c4a2c"), true);
    for (let y = 0; y < 16; y++) for (const x of [0, 5, 10]) p.set(x, y, hex("#3e2a18"));
  });
  const tiles = (p: Pixels, r: Rng, tile: C, grout: C, size: number) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const g = x % size === size - 1 || y % size === size - 1;
      p.set(x, y, g ? grout : shade(tile, 0.95 + r.next() * 0.08 + (x % size === 0 || y % size === 0 ? 0.05 : 0)));
    }
  };
  def("wall_tile", (p, r) => { tiles(p, r, hex("#f0f0ee"), hex("#c4c6c8"), 4); for (let x = 0; x < 16; x++) p.set(x, 9, hex("#5a7ab0")); });

  // ---- floors ----------------------------------------------------------------------------------------
  const boards = (p: Pixels, r: Rng, c: C) => {
    for (let y = 0; y < 16; y++) {
      const row = Math.floor(y / 3), joint = (row * 5 + 2) % 16;
      for (let x = 0; x < 16; x++) {
        let f = 0.92 + r.next() * 0.12 + Math.sin((x + row * 3) * 0.9) * 0.03;
        if (y % 3 === 2) f = 0.7;
        if (x === joint) f = 0.75;
        p.set(x, y, shade(c, f));
      }
    }
  };
  def("hardwood_floor", (p, r) => boards(p, r, hex("#b88a56")));
  def("dark_hardwood_floor", (p, r) => boards(p, r, hex("#6a4426")));
  for (const [name, color] of [["beige", "#c6b692"], ["brown", "#7a5a3e"], ["blue", "#4a5a88"], ["green", "#4c6c48"], ["red", "#8a3834"], ["grey", "#7a7a7c"]] as const) {
    def(`${name}_carpet_floor`, (p, r) => { api.wool(p, r, hex(color)); speckle(p, r, [shade(hex(color), 1.12), shade(hex(color), 0.86)], 0.2); });
  }
  def("linoleum", (p, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, shade(((x >> 2) + (y >> 2)) % 2 ? hex("#3c3c3c") : hex("#e6e0d0"), 0.96 + r.next() * 0.06));
  });
  def("bath_tile", (p, r) => tiles(p, r, hex("#eef2f4"), hex("#b8c0c6"), 4));
  def("terracotta_tile", (p, r) => tiles(p, r, hex("#b8683e"), hex("#7e6a5a"), 8));
  def("vinyl_floor", (p, r) => { noisy(p, r, hex("#d6d2c4"), 0.03, 4); speckle(p, r, [hex("#8a8a86"), hex("#b0a898"), hex("#6a7a8a")], 0.12); });

  // ---- roofs -------------------------------------------------------------------------------------------
  for (const [name, color] of [["grey", "#5c5c60"], ["brown", "#6a4a34"], ["black", "#2e2e32"], ["red", "#8a3a2e"], ["green", "#3e5a3e"]] as const) {
    def(`${name}_shingles`, (p, r) => {
      const c = hex(color);
      for (let y = 0; y < 16; y++) {
        const row = y >> 2, off = row % 2 ? 2 : 0;
        for (let x = 0; x < 16; x++) {
          let f = 0.9 + r.next() * 0.2;
          if (y % 4 === 3) f = 0.55;
          else if ((x + off) % 4 === 0) f = 0.7;
          p.set(x, y, shade(c, f));
        }
      }
    });
  }
  def("tar_roof", (p, r) => { noisy(p, r, hex("#3a3a3a"), 0.12, 4); speckle(p, r, [hex("#5a5a58"), hex("#6a6660"), hex("#2a2a2a")], 0.3); });
  const corrugated = (p: Pixels, r: Rng, c: C) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, shade(c, [1.15, 1, 0.8, 0.95][x % 4] + (r.next() - 0.5) * 0.05));
  };
  def("corrugated_metal", (p, r) => corrugated(p, r, hex("#9aa0a4")));
  def("rusty_metal", (p, r) => {
    corrugated(p, r, hex("#8e9296"));
    const n = api.valueNoise(r, 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (n[y * 16 + x] > 0.55) p.set(x, y, shade(hex("#8a4a26"), [1.15, 1, 0.8, 0.95][x % 4]));
  });

  // ---- fences and barriers ---------------------------------------------------------------------------
  def("picket_fence", (p, r) => {
    p.clear();
    const white = hex("#eeeeea");
    for (let x = 0; x < 16; x++) {
      if (x % 4 === 3) continue;
      const tip = x % 4 === 1 ? 4 : 5;
      for (let y = tip; y < 16; y++) p.set(x, y, shade(white, 0.92 + r.next() * 0.08 - (x % 4 === 2 ? 0.08 : 0)));
    }
    for (const y of [7, 13]) for (let x = 0; x < 16; x++) p.set(x, y, shade(white, 0.82));
  });
  def("privacy_fence", (p, r) => {
    woodGrain(p, r, hex("#a07c50"), true);
    for (let y = 0; y < 16; y++) for (const x of [0, 4, 8, 12]) p.set(x, y, hex("#5a4228"));
    for (const x of [2, 6, 10, 14]) { p.set(x, 2, hex("#3a3a3a")); p.set(x, 13, hex("#3a3a3a")); }
  });
  const chainLink = (p: Pixels) => {
    p.clear();
    const wire = hex("#a8aeb2");
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % 4 === 0 || (x - y + 16) % 4 === 0) p.set(x, y, shade(wire, (x + y) % 8 === 0 ? 1.1 : 0.9));
    for (let x = 0; x < 16; x++) { p.set(x, 0, hex("#8a9094")); p.set(x, 1, hex("#6a7074")); }
  };
  def("chain_link", (p) => chainLink(p));
  def("cordon_fence", (p) => {
    chainLink(p);
    rect(p, 4, 5, 11, 10, hex("#e8c020"));
    outline(p, 4, 5, 11, 10, hex("#1a1a1a"));
    for (const [x, y] of [[7, 6], [8, 6], [6, 8], [9, 8], [7, 9], [8, 9]]) p.set(x, y, hex("#1a1a1a"));
    for (let x = 0; x < 16; x += 2) p.set(x, 0, hex("#c8c8c8"));
  });
  def("barbed_wire", (p, r) => {
    p.clear();
    const wire = hex("#8a8e90");
    for (const y0 of [3, 8, 13]) {
      for (let x = 0; x < 16; x++) p.set(x, y0 + (x % 4 === 0 ? 1 : 0), shade(wire, 0.9 + r.next() * 0.2));
      for (let x = 2; x < 16; x += 5) { p.set(x, y0 - 1, wire); p.set(x + 1, y0 + 1, wire); }
    }
  });
  def("sandbags", (p, r) => {
    const bag = hex("#b8a276");
    for (let y = 0; y < 16; y++) {
      const row = y >> 2, off = row % 2 ? 4 : 0;
      for (let x = 0; x < 16; x++) {
        const bx = (x + off) % 8, by = y % 4;
        let f = 0.94 + r.next() * 0.1;
        if (by === 3 || bx === 7) f = 0.62;
        else if (by === 0) f = 1.08;
        else if (bx === 0 || bx === 6) f = 0.86;
        p.set(x, y, shade(bag, f));
      }
    }
  });
  def("sandbags_top", (p, r) => { noisy(p, r, hex("#b09a70"), 0.08, 4); for (let x = 0; x < 16; x++) p.set(x, 7, hex("#8a7a5a")); });
  def("guard_rail", (p, r) => {
    metal(p, r, hex("#a8aeb2"));
    for (let x = 0; x < 16; x++) { p.set(x, 7, hex("#d0d6da")); p.set(x, 9, hex("#7a8084")); }
  });

  // ---- windows and doors ------------------------------------------------------------------------------
  const TRIM = hex("#f0f0ea"), GLASS = hex("#cfe6ee");
  const windowFrame = (p: Pixels, lower: "glass" | "open" | "broken" | "curtain") => {
    p.clear();
    frame(p, TRIM);
    for (let i = 0; i < 16; i++) p.set(i, 7, TRIM);
    for (let y = 1; y < 7; y++) p.set(7, y, TRIM);
    const glassPane = (y0: number, y1: number) => {
      for (let y = y0; y <= y1; y++) for (let x = 1; x < 15; x++) if (x !== 7) p.set(x, y, GLASS, 90);
      for (let j = 0; j < 3; j++) { p.set(2 + j, y0 + 3 - j, hex("#ffffff"), 200); p.set(10 + j, y0 + 4 - j, hex("#ffffff"), 170); }
    };
    if (lower !== "broken") glassPane(1, 6);
    if (lower === "glass") { for (let y = 8; y < 15; y++) p.set(7, y, TRIM); glassPane(8, 14); }
    if (lower === "curtain") {
      for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
        if (y === 7 || x === 7 && y < 7) continue;
        p.set(x, y, shade(hex("#b0584a"), x % 3 === 0 ? 0.8 : 1));
      }
    }
    if (lower === "broken") {
      for (const [x0, y0, len, dx] of [[1, 1, 4, 1], [14, 1, 3, -1], [1, 14, 3, 1], [14, 12, 4, -1], [1, 8, 2, 1]] as const) {
        for (let i = 0; i < len; i++) p.set(x0 + dx * i, y0 + (y0 > 7 ? -i : i), GLASS, 200);
      }
    }
  };
  def("window", (p) => windowFrame(p, "glass"));
  def("window_open", (p) => windowFrame(p, "open"));
  def("window_broken", (p) => windowFrame(p, "broken"));
  def("window_curtain", (p) => windowFrame(p, "curtain"));
  def("barricade_planks", (p, r) => {
    api.planks(p, r, hex("#a4804e"));
    for (let y = 1; y < 16; y += 4) { p.set(2, y, hex("#3a3a3a")); p.set(13, y, hex("#3a3a3a")); }
  });
  const doorPanels = (p: Pixels, r: Rng, c: C, grain: boolean) => {
    if (grain) woodGrain(p, r, c, true); else noisy(p, r, c, 0.03, 4);
    const edge = shade(c, 0.78);
    outline(p, 2, 1, 7, 14, edge); outline(p, 8, 1, 13, 14, edge);
    frame(p, shade(c, 0.85));
  };
  def("panel_door_top", (p, r) => doorPanels(p, r, hex("#ecebe4"), false));
  def("panel_door_bottom", (p, r) => { doorPanels(p, r, hex("#ecebe4"), false); knob(p, 12, 1); });
  def("front_door_top", (p, r) => {
    doorPanels(p, r, hex("#7a4a2c"), true);
    for (let y = 2; y <= 6; y++) for (let x = 3; x <= 12; x++) if (x !== 7 && x !== 8) p.set(x, y, GLASS, 80);
    rect(p, 3, 2, 12, 2, hex("#5a3a22"));
  });
  def("front_door_bottom", (p, r) => { doorPanels(p, r, hex("#7a4a2c"), true); knob(p, 12, 1, hex("#e8c860")); });
  def("metal_door_top", (p, r) => {
    metal(p, r, hex("#8a9096"));
    frame(p, hex("#5e6468"));
    rect(p, 5, 3, 10, 8, hex("#9ab8c4"));
    for (let y = 3; y <= 8; y++) for (let x = 5; x <= 10; x++) if ((x + y) % 3 === 0) p.set(x, y, hex("#6a7a80"));
  });
  def("metal_door_bottom", (p, r) => {
    metal(p, r, hex("#8a9096"));
    frame(p, hex("#5e6468"));
    rect(p, 2, 3, 13, 3, hex("#c8ccd0"));
    rect(p, 12, 0, 13, 1, hex("#c8ccd0"));
  });
  const glassDoor = (p: Pixels, bottom: boolean) => {
    p.clear();
    const al = hex("#b6bcc0");
    frame(p, al);
    for (let i = 0; i < 16; i++) p.set(i, bottom ? 14 : 1, al);
    for (let y = bottom ? 1 : 2; y < (bottom ? 14 : 15); y++) for (let x = 1; x < 15; x++) p.set(x, y, GLASS, 70);
    if (bottom) rect(p, 2, 2, 13, 2, shade(al, 0.8));
    else for (let j = 0; j < 4; j++) p.set(3 + j, 8 - j, hex("#ffffff"), 180);
  };
  def("glass_door_top", (p) => glassDoor(p, false));
  def("glass_door_bottom", (p) => glassDoor(p, true));
  def("garage_door", (p, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y % 4;
      p.set(x, y, shade(hex("#e2e2dc"), band === 3 ? 0.72 : band === 0 ? 1.06 : 0.97 + r.next() * 0.03));
    }
  });

  // ---- kitchen ------------------------------------------------------------------------------------------
  const CAB = hex("#a87a4c");
  def("cabinet_front", (p, r) => { cabinetDoors(p, r, CAB, 2, 13, true); rect(p, 0, 14, 15, 15, hex("#3a2a1c")); });
  def("cabinet_side", (p, r) => woodGrain(p, r, CAB, true));
  def("wall_cabinet_front", (p, r) => cabinetDoors(p, r, CAB, 0, 12, false));
  def("countertop", (p, r) => { noisy(p, r, hex("#d4c8aa"), 0.04, 4); speckle(p, r, [hex("#b8ac90"), hex("#e4dac2"), hex("#9a8e76")], 0.2); });
  def("countertop_sink", (p, r) => {
    noisy(p, r, hex("#d4c8aa"), 0.04, 4);
    speckle(p, r, [hex("#b8ac90"), hex("#e4dac2")], 0.2);
    rect(p, 3, 4, 12, 13, (x, y) => shade(hex("#b8c0c6"), 0.8 + (y - 4) * 0.03));
    outline(p, 3, 4, 12, 13, hex("#8e969c"));
    p.set(7, 9, hex("#3a3a3a")); p.set(8, 9, hex("#3a3a3a"));
    rect(p, 7, 1, 8, 3, hex("#c8cccf"));
  });
  def("stove_top", (p, r) => {
    enamel(p, r);
    for (const [cx, cy] of [[4, 4], [11, 4], [4, 11], [11, 11]]) {
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
        const d = Math.hypot(x, y);
        if (d <= 3.2) p.set(cx + x, cy + y, d > 2.2 ? hex("#2a2a2a") : Math.round(d) % 2 ? hex("#4a4a4a") : hex("#1e1e1e"));
      }
    }
  });
  def("stove_front", (p, r) => {
    enamel(p, r);
    rect(p, 0, 0, 15, 2, hex("#d8d8d2"));
    for (const x of [2, 5, 10, 13]) p.set(x, 1, hex("#2a2a2a"));
    rect(p, 3, 4, 12, 4, hex("#b8bcc0"));
    rect(p, 3, 6, 12, 13, hex("#2a2e34"));
    outline(p, 2, 5, 13, 14, hex("#9a9a96"));
    p.set(5, 8, hex("#5a6a7a")); p.set(6, 7, hex("#5a6a7a"));
  });
  def("stove_side", (p, r) => enamel(p, r));
  def("appliance_white", (p, r) => enamel(p, r));
  const fridgeDoor = (p: Pixels, r: Rng, handleY0: number, handleY1: number, seam: boolean) => {
    enamel(p, r, hex("#ece8dc"));
    rect(p, 12, handleY0, 13, handleY1, hex("#b8b4a8"));
    p.set(12, handleY0, hex("#8a867a")); p.set(12, handleY1, hex("#8a867a"));
    if (seam) for (let x = 0; x < 16; x++) p.set(x, 15, hex("#8a867a"));
    frame(p, hex("#d6d2c4"));
  };
  def("fridge_front", (p, r) => fridgeDoor(p, r, 1, 8, false));
  def("freezer_front", (p, r) => fridgeDoor(p, r, 8, 14, true));
  def("fridge_side", (p, r) => enamel(p, r, hex("#ece8dc")));
  def("microwave_front", (p, r) => {
    enamel(p, r);
    rect(p, 2, 10, 10, 14, hex("#2a2e34"));
    outline(p, 1, 9, 11, 15, hex("#9a9a96"));
    for (let y = 10; y <= 14; y += 2) for (const x of [12, 13]) p.set(x, y, hex("#5a5a5a"));
    p.set(12, 9, hex("#40d060"));
  });
  const TABLE = hex("#9a6c42");
  def("table_wood", (p, r) => woodGrain(p, r, TABLE));
  def("dark_table_wood", (p, r) => woodGrain(p, r, hex("#5e3e24")));
  def("trash_can_side", (p, r) => { metal(p, r, hex("#8c9296")); for (let y = 0; y < 16; y++) for (const x of [1, 5, 9, 13]) p.set(x, y, hex("#6a7074")); });
  def("trash_can_top", (p, r) => { metal(p, r, hex("#9aa0a4")); rect(p, 6, 7, 9, 8, hex("#5a6064")); });

  // ---- living room --------------------------------------------------------------------------------------
  const fabric = (color: string, pattern?: "floral") => (p: Pixels, r: Rng) => {
    const c = hex(color);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, shade(c, ((x + y) % 2 ? 0.95 : 1.02) + (r.next() - 0.5) * 0.06));
    if (pattern === "floral") for (const [x, y] of [[2, 2], [10, 5], [5, 10], [13, 13]]) {
      p.set(x, y, hex("#b83a4a")); p.set(x + 1, y, hex("#b83a4a")); p.set(x, y + 1, hex("#d85a6a")); p.set(x + 1, y + 1, hex("#5a7a4a"));
    }
  };
  def("brown_upholstery", fabric("#7a5a40"));
  def("blue_upholstery", fabric("#4a5e84"));
  def("green_upholstery", fabric("#56704a"));
  def("floral_upholstery", fabric("#dccfae", "floral"));
  def("black_upholstery", fabric("#2c2c2e"));
  def("leather_upholstery", (p, r) => { noisy(p, r, hex("#5a3624"), 0.12, 4); speckle(p, r, [hex("#7a4e36")], 0.08); });
  def("tv_side", (p, r) => noisy(p, r, hex("#3a332c"), 0.05, 4));
  def("tv_front", (p, r) => {
    noisy(p, r, hex("#3a332c"), 0.04, 4);
    rect(p, 4, 3, 11, 10, (x, y) => shade(hex("#1e2a2e"), 1 + ((x + y) % 5 === 0 ? 0.15 : 0)));
    for (const [x, y] of [[4, 3], [11, 3], [4, 10], [11, 10]]) p.set(x, y, hex("#3a332c"));
    p.set(5, 4, hex("#6a8a96")); p.set(6, 4, hex("#4a6a76")); p.set(5, 5, hex("#4a6a76"));
    p.set(12, 4, hex("#c8c8c8")); p.set(12, 6, hex("#c8c8c8")); p.set(12, 9, hex("#d04030"));
  });
  def("radio_side", (p, r) => noisy(p, r, hex("#6a4a30"), 0.06, 4));
  def("radio_front", (p, r) => {
    noisy(p, r, hex("#6a4a30"), 0.06, 4);
    for (let y = 11; y <= 14; y++) for (let x = 4; x <= 8; x++) if ((x + y) % 2 === 0) p.set(x, y, hex("#2a2016"));
    rect(p, 10, 11, 12, 12, hex("#e8dcaa"));
    p.set(11, 14, hex("#c8c8c8"));
  });
  def("bookcase_front", (p, r) => {
    woodGrain(p, r, TABLE, true);
    const spines = [hex("#8a2a2a"), hex("#2a4a7a"), hex("#3a6a3a"), hex("#c8a040"), hex("#5a3a6a"), hex("#e0dcd0"), hex("#2a2a2a")];
    for (const [y0, y1] of [[1, 4], [6, 9], [11, 14]]) {
      for (let x = 1; x < 15; x++) {
        if (r.next() < 0.1) continue;
        const c = spines[r.int(spines.length)], top = y0 + (r.next() < 0.3 ? 1 : 0);
        for (let y = top; y <= y1; y++) p.set(x, y, shade(c, 0.9 + r.next() * 0.1));
      }
    }
  });
  def("lamp_metal", (p, r) => metal(p, r, hex("#4e5256")));
  def("lamp_shade", (p, r) => noisy(p, r, hex("#d8ceb0"), 0.05, 4));
  def("lamp_shade_lit", (p, r) => noisy(p, r, hex("#fff2c8"), 0.04, 4));
  def("ceiling_light", (p, r) => { noisy(p, r, hex("#d6d6d0"), 0.04, 4); outline(p, 4, 4, 11, 11, hex("#b8b8b0")); });
  def("ceiling_light_lit", (p, r) => { noisy(p, r, hex("#fffae0"), 0.03, 4); outline(p, 4, 4, 11, 11, hex("#f0e0a0")); });
  def("houseplant", (p, r) => {
    p.clear();
    const leaf = [hex("#3a7a36"), hex("#4e9a44"), hex("#2e6028"), hex("#6ab058")];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, (y - 8) * 1.2);
      if (d < 7.5 && r.next() < 0.78) p.set(x, y, leaf[r.int(leaf.length)]);
    }
  });
  def("plant_pot", (p, r) => { noisy(p, r, hex("#b0603a"), 0.06, 4); for (let x = 0; x < 16; x++) p.set(x, 11, hex("#8a4a2a")); });
  def("end_table_side", (p, r) => { woodGrain(p, r, TABLE, true); outline(p, 2, 6, 13, 9, shade(TABLE, 0.72)); knob(p, 7, 7); });

  // ---- bedroom --------------------------------------------------------------------------------------------
  for (const [name, color, rail] of [["blue_bed", "#3c5a96", "#9a7a4a"], ["green_bed", "#4a7a44", "#9a7a4a"], ["hospital_bed", "#c8dce6", "#b8bcc0"]] as const) {
    const c = hex(color), frameColor = hex(rail);
    def(`${name}_foot_top`, (p, r) => { api.wool(p, r, c); frame(p, shade(c, 0.8)); });
    def(`${name}_head_top`, (p, r) => {
      api.wool(p, r, c);
      rect(p, 2, 1, 13, 6, () => shade(hex("#f0f0f0"), 0.92 + r.next() * 0.08));
      frame(p, shade(c, 0.8));
    });
    def(`${name}_side`, (p, r) => {
      if (name === "hospital_bed") metal(p, r, frameColor); else api.planks(p, r, frameColor);
      rect(p, 0, 7, 15, 11, (x) => shade(c, 0.9 + (x % 3) * 0.05));
      rect(p, 0, 14, 15, 15, shade(frameColor, 0.6));
    });
    def(`${name}_head_side`, (p, r) => {
      if (name === "hospital_bed") metal(p, r, frameColor); else api.planks(p, r, frameColor);
      rect(p, 0, 7, 15, 11, (x) => shade(c, 0.9 + (x % 3) * 0.05));
      rect(p, 0, 14, 15, 15, shade(frameColor, 0.6));
      rect(p, 0, 7, 3, 9, hex("#e8e8e8"));
    });
  }
  def("wardrobe_front", (p, r) => {
    woodGrain(p, r, TABLE, true);
    outline(p, 1, 1, 7, 14, shade(TABLE, 0.7)); outline(p, 8, 1, 14, 14, shade(TABLE, 0.7));
    knob(p, 6, 8); knob(p, 9, 8);
  });
  def("dresser_front", (p, r) => {
    woodGrain(p, r, TABLE);
    for (const y0 of [4, 8, 12]) { outline(p, 1, y0, 14, y0 + 3, shade(TABLE, 0.7)); rect(p, 6, y0 + 1, 9, y0 + 1, hex("#c8b070")); }
  });
  def("nightstand_front", (p, r) => {
    woodGrain(p, r, TABLE);
    outline(p, 3, 6, 12, 9, shade(TABLE, 0.7)); knob(p, 7, 7);
    rect(p, 3, 11, 12, 14, shade(TABLE, 0.55));
  });
  def("desk_front", (p, r) => {
    woodGrain(p, r, TABLE);
    for (const y0 of [4, 8, 12]) { outline(p, 9, y0, 15, y0 + 3, shade(TABLE, 0.7)); p.set(12, y0 + 1, hex("#c8b070")); }
  });

  // ---- bathroom and laundry ---------------------------------------------------------------------------------
  const PORCELAIN = hex("#f2f2f0");
  def("porcelain", (p, r) => { noisy(p, r, PORCELAIN, 0.025, 4); for (let i = 0; i < 16; i++) p.set(i, 15, shade(PORCELAIN, 0.88)); });
  def("toilet_top", (p, r) => {
    noisy(p, r, PORCELAIN, 0.025, 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot((x - 7.5) / 5.5, (y - 6) / 6.5);
      if (d < 0.7) p.set(x, y, hex("#b8cad4")); else if (d < 1) p.set(x, y, hex("#e0e0dc"));
    }
  });
  def("sink_basin", (p, r) => {
    noisy(p, r, PORCELAIN, 0.025, 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot((x - 7.5) / 5.5, (y - 9) / 4.5);
      if (d < 1) p.set(x, y, shade(PORCELAIN, 0.84 + d * 0.12));
    }
    p.set(7, 9, hex("#5a5a5a")); p.set(8, 9, hex("#5a5a5a"));
    rect(p, 7, 2, 8, 4, hex("#c8cccf"));
  });
  def("bathtub_top", (p, r) => {
    noisy(p, r, PORCELAIN, 0.025, 4);
    rect(p, 2, 2, 13, 13, (x, y) => shade(hex("#e2e6e8"), 0.9 + (y - 2) * 0.008));
    rect(p, 7, 0, 8, 1, hex("#c8cccf"));
    p.set(7, 11, hex("#6a6a6a"));
  });
  def("medicine_cabinet_front", (p, r) => {
    enamel(p, r);
    rect(p, 4, 2, 11, 10, (x, y) => mix(hex("#b8c8d2"), hex("#e8f0f4"), ((x + y) % 7) / 7));
    for (let j = 0; j < 3; j++) p.set(5 + j, 7 - j, hex("#ffffff"));
    p.set(11, 6, hex("#9a9a9a"));
  });
  const laundry = (p: Pixels, r: Rng, water: boolean) => {
    enamel(p, r);
    rect(p, 1, 1, 14, 3, hex("#d6d6d0"));
    p.set(3, 2, hex("#3a3a3a")); p.set(12, 2, hex("#3a3a3a")); p.set(7, 2, hex("#40a0d0"));
    for (let y = 5; y < 15; y++) for (let x = 2; x < 14; x++) {
      const d = Math.hypot(x - 7.5, y - 9.5);
      if (d < 5) p.set(x, y, d > 4 ? hex("#9a9a96") : water ? hex("#6a8aa0") : hex("#3a3e44"));
    }
  };
  def("washer_front", (p, r) => laundry(p, r, true));
  def("dryer_front", (p, r) => laundry(p, r, false));
  def("water_heater_side", (p, r) => { enamel(p, r); rect(p, 5, 6, 10, 9, hex("#e8c030")); outline(p, 5, 6, 10, 9, hex("#6a6a6a")); });

  // ---- workshop ------------------------------------------------------------------------------------------------
  def("workbench_top", (p, r) => {
    woodGrain(p, r, hex("#b08a5a"));
    rect(p, 2, 3, 7, 3, hex("#6a6a6a")); rect(p, 2, 2, 3, 4, hex("#8a4a2a"));
    for (let x = 9; x <= 14; x++) p.set(x, 11 - (x - 9) % 2, hex("#b8bcc0"));
    rect(p, 9, 12, 10, 13, hex("#6a3a1a"));
  });
  def("metal_shelf_side", (p, r) => {
    p.clear();
    const m = hex("#7a8084");
    for (let y = 0; y < 16; y++) { p.set(0, y, m); p.set(15, y, m); }
    for (const y of [0, 5, 10, 15]) for (let x = 0; x < 16; x++) p.set(x, y, shade(m, 1.1));
    for (let i = 0; i < 5; i++) p.set(1 + i * 3, 4 - (i % 4), shade(m, 0.8));
  });
  def("metal_shelf_front", (p, r) => {
    p.clear();
    const m = hex("#7a8084");
    for (let y = 0; y < 16; y++) { p.set(0, y, m); p.set(1, y, shade(m, 0.8)); p.set(14, y, shade(m, 0.8)); p.set(15, y, m); }
    for (const y of [0, 5, 10, 15]) for (let x = 0; x < 16; x++) p.set(x, y, shade(m, 1.12));
    const goods = [hex("#b88a4a"), hex("#c83a2a"), hex("#3a5a8a"), hex("#e8c030"), hex("#5a8a4a"), hex("#8a8a8a")];
    for (const y1 of [4, 9, 14]) {
      let x = 2;
      while (x < 13) {
        const w = 2 + r.int(3), h = 2 + r.int(3), c = goods[r.int(goods.length)];
        if (r.next() > 0.25) rect(p, x, y1 - h + 1, Math.min(13, x + w - 1), y1, (xx, yy) => shade(c, yy === y1 - h + 1 ? 1.15 : 0.95));
        x += w + 1;
      }
    }
  });
  const RED_TOOL = hex("#b82a22");
  def("tool_chest_side", (p, r) => metal(p, r, RED_TOOL));
  def("tool_chest_front", (p, r) => {
    metal(p, r, RED_TOOL);
    for (const y0 of [1, 5, 9, 12]) { for (let x = 1; x < 15; x++) p.set(x, y0 + (y0 === 12 ? 2 : 3), shade(RED_TOOL, 0.6)); rect(p, 5, y0 + 1, 10, y0 + 1, hex("#d0d4d8")); }
  });
  const GEN = hex("#e0b020");
  def("generator_side", (p, r) => { metal(p, r, hex("#3a3a3c")); frame(p, GEN); for (let x = 0; x < 16; x++) p.set(x, 6, GEN); });
  def("generator_top", (p, r) => { metal(p, r, hex("#c02a22")); outline(p, 3, 3, 12, 12, hex("#7a1a14")); rect(p, 7, 7, 8, 8, hex("#1a1a1a")); });
  def("generator_front", (p, r) => {
    metal(p, r, hex("#3a3a3c")); frame(p, GEN);
    rect(p, 3, 8, 6, 11, hex("#d8d8d2")); p.set(4, 9, hex("#1a1a1a")); p.set(5, 10, hex("#1a1a1a"));
    rect(p, 9, 8, 12, 11, hex("#d8d8d2")); p.set(10, 9, hex("#1a1a1a")); p.set(11, 10, hex("#1a1a1a"));
    p.set(7, 13, hex("#40d060")); p.set(8, 13, hex("#d04030"));
  });
  def("fuel_drum_side", (p, r) => { metal(p, r, hex("#b02a22")); for (let x = 0; x < 16; x++) { p.set(x, 3, hex("#7a1a14")); p.set(x, 12, hex("#7a1a14")); } });
  def("fuel_drum_top", (p, r) => { metal(p, r, hex("#b02a22")); p.set(4, 4, hex("#3a3a3a")); p.set(11, 11, hex("#3a3a3a")); outline(p, 0, 0, 15, 15, hex("#7a1a14")); });
  def("crate", (p, r) => {
    woodGrain(p, r, hex("#b8925e"));
    frame(p, hex("#7a5a34"));
    for (let i = 1; i < 15; i++) { p.set(i, i, hex("#8a6a3e")); p.set(15 - i, i, hex("#8a6a3e")); }
  });

  // ---- shops and public buildings ---------------------------------------------------------------------------------
  const productRows = (p: Pixels, r: Rng, rows: [number, number][], goods: C[]) => {
    for (const [y0, y1] of rows) {
      let x = 1;
      while (x < 15) {
        const w = 1 + r.int(3), c = goods[r.int(goods.length)];
        rect(p, x, y0 + r.int(2), Math.min(14, x + w - 1), y1, (_x, yy) => shade(c, yy === y0 ? 1.15 : 0.9 + r.next() * 0.1));
        x += w;
      }
    }
  };
  def("store_shelf_side", (p, r) => { metal(p, r, hex("#c8ccd0")); for (const y of [5, 10, 15]) for (let x = 0; x < 16; x++) p.set(x, y, hex("#e8e8e8")); });
  def("store_shelf_front", (p, r) => {
    metal(p, r, hex("#9aa0a4"));
    productRows(p, r, [[1, 4], [6, 9], [11, 14]], [hex("#c83a2a"), hex("#e8c030"), hex("#3a5a8a"), hex("#5a9a4a"), hex("#e8e8e0"), hex("#e07a2a"), hex("#8a3a8a")]);
    for (const y of [5, 10, 15]) for (let x = 0; x < 16; x++) p.set(x, y, hex("#e8e8e8"));
  });
  def("cooler_side", (p, r) => metal(p, r, hex("#d8dadc")));
  def("cooler_front", (p, r) => {
    metal(p, r, hex("#d8dadc"));
    rect(p, 1, 1, 14, 14, hex("#34424a"));
    for (const y0 of [2, 7, 12]) for (let x = 2; x < 14; x += 2) {
      const c = [hex("#c83a2a"), hex("#3a8a4a"), hex("#e8c030"), hex("#3a5aa0"), hex("#e0e0e0")][r.int(5)];
      p.set(x, y0, shade(c, 1.2)); p.set(x, y0 + 1, c); p.set(x, y0 + 2, c);
    }
    rect(p, 13, 5, 13, 10, hex("#b8bcc0"));
  });
  def("checkout_top", (p, r) => { metal(p, r, hex("#8a8e92")); rect(p, 2, 0, 13, 15, (x, y) => (y % 3 === 0 ? hex("#2a2a2a") : hex("#1a1a1a"))); });
  def("checkout_side", (p, r) => { noisy(p, r, hex("#c8c2b0"), 0.04, 4); for (let x = 0; x < 16; x++) p.set(x, 13, hex("#5a5a5a")); });
  def("register_front", (p, r) => { noisy(p, r, hex("#d8d0b8"), 0.04, 4); rect(p, 5, 0, 10, 1, hex("#3a6a3a")); });
  def("clothes_hung", (p, r) => {
    const cloth = [hex("#3a5a8a"), hex("#b83a3a"), hex("#e8e8e0"), hex("#3a3a3a"), hex("#6a8a4a"), hex("#c8a060")];
    for (let x = 0; x < 16; x += 2) {
      const c = cloth[r.int(cloth.length)];
      for (let y = 0; y < 16; y++) { p.set(x, y, shade(c, 1.05)); p.set(x + 1, y, shade(c, 0.85)); }
    }
  });
  def("gun_rack_front", (p, r) => {
    woodGrain(p, r, hex("#6a4a2e"), true);
    for (const x0 of [3, 7, 11]) {
      for (let y = 1; y < 15; y++) { p.set(x0, y, hex("#1e1e20")); if (y > 9) p.set(x0 + 1, y, hex("#7a4a26")); }
      p.set(x0 + 1, 12, hex("#1e1e20"));
    }
  });
  def("vending_side", (p, r) => metal(p, r, hex("#b8282a")));
  def("vending_front", (p, r) => {
    metal(p, r, hex("#b8282a"));
    rect(p, 1, 1, 10, 13, hex("#2a3440"));
    productRows(p, r, [[2, 3], [5, 6], [8, 9], [11, 12]], [hex("#e8c030"), hex("#c83a2a"), hex("#3a8a4a"), hex("#e07a2a"), hex("#6a3a8a")]);
    rect(p, 12, 3, 14, 5, hex("#1a1a1a")); p.set(13, 7, hex("#c8c8c8")); rect(p, 11, 13, 14, 14, hex("#1a1a1a"));
  });
  def("gas_pump_side", (p, r) => { enamel(p, r); rect(p, 0, 10, 15, 11, hex("#c82a22")); });
  def("gas_pump_front", (p, r) => {
    enamel(p, r);
    rect(p, 2, 1, 13, 4, hex("#1a1a1a"));
    for (const x of [3, 5, 7, 9]) p.set(x, 2, hex("#e8a020"));
    rect(p, 0, 10, 15, 11, hex("#c82a22"));
    rect(p, 5, 6, 10, 8, hex("#d8d8d2")); p.set(7, 7, hex("#3a3a3a"));
    rect(p, 11, 12, 12, 15, hex("#2a2a2a"));
  });
  def("filing_side", (p, r) => metal(p, r, hex("#8e9498")));
  def("filing_front", (p, r) => {
    metal(p, r, hex("#8e9498"));
    for (const y0 of [0, 4, 8, 12]) { for (let x = 0; x < 16; x++) p.set(x, y0 + 3, hex("#5a6064")); rect(p, 6, y0 + 1, 9, y0 + 1, hex("#c8ccd0")); rect(p, 6, y0 + 2, 9, y0 + 2, hex("#e8e6d8")); }
  });
  def("locker_side", (p, r) => metal(p, r, hex("#5a7288")));
  def("locker_front", (p, r) => {
    metal(p, r, hex("#5a7288"));
    frame(p, hex("#3e5264"));
    for (const y of [2, 4, 12, 14]) for (let x = 4; x < 12; x++) p.set(x, y, hex("#2a3a48"));
    rect(p, 11, 7, 12, 9, hex("#c8ccd0"));
  });
  const OLIVE = hex("#5a6238");
  def("military_crate_side", (p, r) => { woodGrain(p, r, OLIVE); frame(p, shade(OLIVE, 0.7)); });
  def("military_crate_top", (p, r) => { woodGrain(p, r, OLIVE); frame(p, shade(OLIVE, 0.7)); rect(p, 6, 2, 9, 13, shade(OLIVE, 0.85)); });
  def("military_crate_front", (p, r) => {
    woodGrain(p, r, OLIVE); frame(p, shade(OLIVE, 0.7));
    for (let x = 3; x < 13; x++) { p.set(x, 8, hex("#e0d070")); if (x % 3 === 0) p.set(x, 10, hex("#e0d070")); }
    rect(p, 1, 6, 2, 7, hex("#3a3a3a")); rect(p, 13, 6, 14, 7, hex("#3a3a3a"));
  });
  def("safe_side", (p, r) => metal(p, r, hex("#3a3e42")));
  def("safe_front", (p, r) => {
    metal(p, r, hex("#3a3e42"));
    outline(p, 1, 1, 14, 14, hex("#26282a"));
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot(x - 7.5, y - 7.5) < 2.5) p.set(x, y, hex("#b8bcc0"));
    p.set(7, 6, hex("#1a1a1a")); rect(p, 11, 7, 13, 8, hex("#b8bcc0"));
  });

  // ---- the street --------------------------------------------------------------------------------------------------
  def("mailbox", (p, r) => { metal(p, r, hex("#2a3a6a")); p.set(13, 2, hex("#c83a2a")); p.set(13, 3, hex("#c83a2a")); });
  def("dumpster_side", (p, r) => {
    metal(p, r, hex("#3a6a3e"));
    for (let y = 0; y < 16; y++) for (const x of [0, 5, 10, 15]) p.set(x, y, hex("#2a4a2c"));
    speckle(p, r, [hex("#6a4a2a")], 0.04);
  });
  def("dumpster_top", (p, r) => { noisy(p, r, hex("#1e1e20"), 0.08, 4); for (let x = 0; x < 16; x++) p.set(x, 7, hex("#3a3a3a")); });
  def("street_lamp", (p, r) => noisy(p, r, hex("#8a8e90"), 0.05, 4));
  def("street_lamp_lit", (p, r) => noisy(p, r, hex("#fff0b8"), 0.04, 4));
  def("sign_back", (p, r) => metal(p, r, hex("#9a9ea2")));
  def("stop_sign", (p) => {
    p.clear();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const cut = Math.min(x, 15 - x) + Math.min(y, 15 - y);
      if (cut < 4) continue;
      const border = cut < 5 || x === 0 || y === 0 || x === 15 || y === 15;
      p.set(x, y, border ? hex("#f0f0f0") : hex("#c8201a"));
    }
    rect(p, 3, 7, 12, 8, hex("#f0f0f0"));
  });
  def("road_sign", (p, r) => {
    noisy(p, r, hex("#1e6a3a"), 0.03, 4);
    frame(p, hex("#f0f0f0"));
    for (const y of [4, 8, 11]) for (let x = 3; x < 13; x++) if (r.next() < 0.8) p.set(x, y, hex("#f0f0f0"));
  });
  def("traffic_light_side", (p, r) => metal(p, r, hex("#c8a020")));
  def("traffic_light_front", (p, r) => {
    metal(p, r, hex("#2a2a2a"));
    for (const [y, c] of [[3, "#ff3020"], [7, "#5a4a10"], [11, "#1a4a20"]] as const) {
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) if (Math.abs(xx) + Math.abs(yy) < 2) p.set(7 + xx + (xx > 0 ? 0 : 0), y + yy, hex(c));
      p.set(8, y, hex(c));
    }
  });
  def("fire_hydrant", (p, r) => { metal(p, r, hex("#c82a1e")); for (let x = 0; x < 16; x++) p.set(x, 5, hex("#e8e8e0")); });
  def("power_pole", (p, r) => woodGrain(p, r, hex("#4a3a2a"), true));
  def("power_pole_top", (p, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      p.set(x, y, shade(hex("#6a543a"), Math.floor(d) % 2 ? 0.85 : 1.05));
    }
  });
  def("trash_bag", (p, r) => {
    noisy(p, r, hex("#1e1e22"), 0.2, 4);
    for (let i = 0; i < 6; i++) p.set(r.int(16), r.int(16), hex("#5a5a60"));
    rect(p, 7, 0, 8, 1, hex("#e0c040"));
  });

  // ---- the aftermath ----------------------------------------------------------------------------------------------
  def("blood_splatter", (p, r) => {
    p.clear();
    const red = [hex("#5a0a0a"), hex("#7a1010"), hex("#4a0606")];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 8) + (r.next() - 0.5) * 3;
      if (d < 4.5) p.set(x, y, red[r.int(red.length)]);
    }
    for (let i = 0; i < 9; i++) p.set(r.int(16), r.int(16), red[0]);
  });
  def("litter", (p, r) => {
    p.clear();
    for (let i = 0; i < 5; i++) {
      const x = r.int(14), y = r.int(14), c = [hex("#e8e4d8"), hex("#d8c890"), hex("#c83a2a")][r.int(3)];
      rect(p, x, y, x + 1, y + (r.next() < 0.5 ? 1 : 0), c);
    }
  });
  def("broken_glass", (p, r) => {
    p.clear();
    for (let i = 0; i < 14; i++) { const x = r.int(16), y = r.int(16); p.set(x, y, hex("#d8eef4"), 220); if (r.next() < 0.5) p.set((x + 1) % 16, y, hex("#a8c8d0"), 200); }
  });
}
