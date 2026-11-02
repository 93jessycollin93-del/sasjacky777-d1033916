/**
 * The county's blocks: roads and sidewalks, siding and shingles, the
 * furniture of every room of an ordinary house, shop fittings, street
 * furniture, windows that open and break and take boards, and doors that do
 * the same — what a small American county in the 1990s is built of, drawn
 * here from nothing, in this game's own hand.
 *
 * Ids start at 4096. The first 256 ids were one byte, and every one is taken;
 * the ids between hold plain items, which count up from 256 and share the
 * number space with blocks (a block's item has the block's own id). Like the
 * rest of the registry, this list is APPEND-ONLY: a number here is stored in
 * every saved house.
 *
 * Furniture is drawn facing north — its front toward -z — and turned by
 * `hFacingBox` to face whoever places it, so each model is written once.
 * Textures are painted in block coordinates (engine/countyTextures.ts), so a
 * television's screen is simply where the screen box's front face samples.
 */
import type { BlockDef, Box, FaceTextures } from "./blocks";

/** The first sixteen-bit block id: clear of the one-byte blocks and of every plain item. */
export const FIRST_WIDE_BLOCK = 4096;

export const COUNTY_BLOCKS = {
  // ---- roads and ground ----
  ASPHALT: 4096, ASPHALT_YELLOW_LINE: 4097, ASPHALT_WHITE_LINE: 4098, CROSSWALK: 4099, SIDEWALK: 4100, CONCRETE: 4101,
  DIRT_ROAD: 4102, CRACKED_ASPHALT: 4103,
  // ---- walls ----
  SIDING_WHITE: 4104, SIDING_CREAM: 4105, SIDING_BLUE: 4106, SIDING_SAGE: 4107, SIDING_GREY: 4108, SIDING_YELLOW: 4109,
  SIDING_PINK: 4110, SIDING_BROWN: 4111, BARN_SIDING: 4112, TAN_BRICK: 4113, BROWN_BRICK: 4114, WHITE_BRICK: 4115,
  CINDER_BLOCK: 4116, STUCCO: 4117, DRYWALL: 4118, WALLPAPER_FLORAL: 4119, WALLPAPER_STRIPE: 4120, WALLPAPER_PLAID: 4121,
  WOOD_PANELING: 4122, WALL_TILE: 4123,
  // ---- floors ----
  HARDWOOD: 4124, DARK_HARDWOOD: 4125, CARPET_BEIGE: 4126, CARPET_BROWN: 4127, CARPET_BLUE: 4128, CARPET_GREEN: 4129,
  CARPET_RED: 4130, CARPET_GREY: 4131, LINOLEUM: 4132, BATH_TILE: 4133, TERRACOTTA_TILE: 4134, PAINTED_CONCRETE: 4135,
  VINYL_FLOOR: 4136,
  // ---- roofs ----
  SHINGLES_GREY: 4137, SHINGLES_BROWN: 4138, SHINGLES_BLACK: 4139, SHINGLES_RED: 4140, SHINGLES_GREEN: 4141,
  SHINGLE_STAIRS_GREY: 4142, SHINGLE_STAIRS_BROWN: 4143, SHINGLE_STAIRS_BLACK: 4144, SHINGLE_STAIRS_RED: 4145, SHINGLE_STAIRS_GREEN: 4146,
  SHINGLE_SLAB_GREY: 4147, SHINGLE_SLAB_BROWN: 4148, SHINGLE_SLAB_BLACK: 4149, SHINGLE_SLAB_RED: 4150, SHINGLE_SLAB_GREEN: 4151,
  TAR_ROOF: 4152, CORRUGATED_METAL: 4153, RUSTY_METAL: 4154,
  // ---- fences and barriers ----
  PICKET_FENCE: 4155, PRIVACY_FENCE: 4156, CHAIN_LINK: 4157, BARBED_WIRE: 4158, SANDBAGS: 4159, JERSEY_BARRIER: 4160,
  CORDON_FENCE: 4161, GUARD_RAIL: 4162,
  // ---- windows and doors ----
  HOUSE_WINDOW: 4163, PANEL_DOOR: 4164, FRONT_DOOR: 4165, METAL_DOOR: 4166, GLASS_DOOR: 4167, BARRICADE: 4168, GARAGE_DOOR: 4169,
  // ---- kitchen ----
  COUNTER: 4170, COUNTER_SINK: 4171, STOVE: 4172, FRIDGE: 4173, FREEZER: 4174, WALL_CABINET: 4175, MICROWAVE: 4176,
  DINING_TABLE: 4177, KITCHEN_CHAIR: 4178, TRASH_CAN: 4179,
  // ---- living room ----
  COUCH_BROWN: 4180, COUCH_BLUE: 4181, COUCH_GREEN: 4182, COUCH_FLORAL: 4183, ARMCHAIR: 4184, COFFEE_TABLE: 4185,
  TELEVISION: 4186, RADIO: 4187, BOOKCASE: 4188, FLOOR_LAMP: 4189, FLOOR_LAMP_OFF: 4190, CEILING_LIGHT: 4191,
  CEILING_LIGHT_OFF: 4192, POTTED_PLANT: 4193, END_TABLE: 4194,
  // ---- bedroom ----
  BLUE_BED: 4195, GREEN_BED: 4196, HOSPITAL_BED: 4197, WARDROBE: 4198, DRESSER: 4199, NIGHTSTAND: 4200, DESK: 4201,
  OFFICE_CHAIR: 4202,
  // ---- bathroom and laundry ----
  TOILET: 4203, BATHROOM_SINK: 4204, BATHTUB: 4205, MEDICINE_CABINET: 4206, WASHING_MACHINE: 4207, DRYER: 4208,
  // ---- workshop ----
  WORKBENCH: 4209, METAL_SHELF: 4210, TOOL_CHEST: 4211, GENERATOR: 4212, FUEL_DRUM: 4213, CRATE: 4214, WATER_HEATER: 4215,
  // ---- shops and public buildings ----
  STORE_SHELF: 4216, COOLER: 4217, CHECKOUT: 4218, CLOTHING_RACK: 4219, GUN_RACK: 4220, VENDING_MACHINE: 4221, GAS_PUMP: 4222,
  FILING_CABINET: 4223, LOCKER: 4224, SCHOOL_DESK: 4225, CHURCH_PEW: 4226, MILITARY_CRATE: 4227, SAFE: 4228,
  // ---- the street ----
  MAILBOX: 4229, DUMPSTER: 4230, LAMP_POST: 4231, STREET_LAMP: 4232, STREET_LAMP_OFF: 4233, STOP_SIGN: 4234, ROAD_SIGN: 4235,
  TRAFFIC_LIGHT: 4236, BENCH: 4237, PICNIC_TABLE: 4238, FIRE_HYDRANT: 4239, POWER_POLE: 4240, TRASH_BAG: 4241,
  // ---- the aftermath ----
  BLOOD_SPLATTER: 4242, LITTER: 4243, BROKEN_GLASS: 4244,
} as const;

const C = COUNTY_BLOCKS;

// ---- meta layouts -------------------------------------------------------------------------------

/**
 * A window's meta: bits 0-1 facing (the side its outside is on), bit 2 open,
 * bit 3 broken, bit 4 curtains drawn, bits 5-7 the boards nailed across it
 * (0-4). A door keeps its boards in bits 5-7 the same way; its lower five
 * bits are the door's own.
 */
export const WINDOW_OPEN = 4, WINDOW_BROKEN = 8, WINDOW_CURTAIN = 16;
export const boardsOf = (meta: number): number => (meta >> 5) & 7;
export const withBoards = (meta: number, boards: number): number => (meta & 31) | (Math.max(0, Math.min(4, boards)) << 5);
export const MAX_BOARDS = 4;

/** A couch piece's meta: bits 0-1 facing, bit 2 an arm on its left, bit 3 an arm on its right (seen from the front). */
export const ARM_LEFT = 4, ARM_RIGHT = 8;

/** A garage door's meta: bits 0-1 facing, bit 2 rolled up. */
export const GARAGE_OPEN = 4;

/**
 * An outside wall's meta: bits 0-1 the way its outside faces, bits 2-4 the
 * finish on its inside face — so a brick house is brick outside and papered
 * inside, one block thick. 0 is no finish: the wall's own material all round,
 * as anything a player builds is.
 */
export const WALL_FINISHES = ["", "drywall", "floral_wallpaper", "striped_wallpaper", "plaid_wallpaper", "wood_paneling", "wall_tile", "cream_paint"] as const;
export const withFinish = (facing: number, finish: number): number => (facing & 3) | ((finish & 7) << 2);
/** The face opposite each facing's outward face (faces as the registry numbers them: +x, -x, +y, -y, +z, -z). */
const OPPOSITE = [4, 5, 0, 1];

// ---- what defining a block needs from the registry -------------------------------------------------

type Opts = { [K in keyof BlockDef]?: BlockDef[K] };

export interface BlockApi {
  add(id: number, name: string, displayName: string, opts?: Opts): BlockDef;
  tex(all: string): FaceTextures;
  tex(top: string, side: string, bottom?: string): FaceTextures;
  stairBoxes(meta: number): Box[];
  slabBoxes(meta: number): Box[];
  doorBoxes(meta: number): Box[];
  hFacingBox(b: Box, facing: number): Box;
}

/** Faces, as the registry numbers them: +x, -x, +y, -y, +z, -z. */
const UP = 2, DOWN = 3, SOUTH = 4, NORTH = 5, EAST = 0, WEST = 1;
const FACING_TO_FACE = [NORTH, SOUTH, WEST, EAST];

const P = "pickaxe", A = "axe", S = "shovel";

export function defineCountyBlocks(api: BlockApi): void {
  const { add, tex } = api;
  /** A model drawn facing north, turned to the block's facing. */
  const turned = (boxes: Box[]) => (meta: number): Box[] => boxes.map((b) => api.hFacingBox(b, meta & 3));
  /** Which named texture a face shows: its front, its top, its bottom or a side, whatever way it is turned. */
  const faces = (t: { front: string; side: string; top: string; bottom?: string }) =>
    (meta: number, _box: number, face: number): string =>
      face === UP ? t.top : face === DOWN ? (t.bottom ?? t.side) : face === FACING_TO_FACE[meta & 3] ? t.front : t.side;
  const furniture = (opts: Opts & { model: Box[] }): Opts => {
    const { model, ...rest } = opts;
    return { shape: "boxes", layer: "cutout", opaque: false, facing: "player", boxes: turned(model), ...rest };
  };

  // ---- roads and ground ----------------------------------------------------------------------------
  // A painted line runs the way it was laid: meta 0-1 (north/south) along z, 2-3 along x.
  const lineUV = (meta: number, face: number) => (face === UP && (meta & 3) >= 2 ? 1 : 0);
  add(C.ASPHALT, "asphalt", "Asphalt", { hardness: 1.5, tool: P, harvestTier: 0 });
  add(C.ASPHALT_YELLOW_LINE, "asphalt_yellow_line", "Asphalt (Centre Line)", {
    textures: tex("asphalt_yellow_line", "asphalt", "asphalt"), facing: "player", uvRotation: lineUV, hardness: 1.5, tool: P, harvestTier: 0,
  });
  add(C.ASPHALT_WHITE_LINE, "asphalt_white_line", "Asphalt (Edge Line)", {
    textures: tex("asphalt_white_line", "asphalt", "asphalt"), facing: "player", uvRotation: lineUV, hardness: 1.5, tool: P, harvestTier: 0,
  });
  add(C.CROSSWALK, "crosswalk", "Crosswalk", {
    textures: tex("crosswalk", "asphalt", "asphalt"), facing: "player", uvRotation: lineUV, hardness: 1.5, tool: P, harvestTier: 0,
  });
  add(C.SIDEWALK, "sidewalk", "Sidewalk", { hardness: 1.5, tool: P, harvestTier: 0 });
  add(C.CONCRETE, "concrete", "Concrete", { hardness: 1.8, tool: P, harvestTier: 0 });
  add(C.DIRT_ROAD, "dirt_road", "Dirt Road", { hardness: 0.6, tool: S, material: "gravel" });
  add(C.CRACKED_ASPHALT, "cracked_asphalt", "Cracked Asphalt", { hardness: 1.5, tool: P, harvestTier: 0 });

  // ---- walls -------------------------------------------------------------------------------------------
  // An outside wall shows its finish on the face opposite the one it was set facing.
  const finished = (meta: number, _box: number, face: number): string | undefined => {
    const fin = (meta >> 2) & 7;
    return fin && face === OPPOSITE[meta & 3] ? WALL_FINISHES[fin] : undefined;
  };
  const wallOpts = { facing: "player" as const, boxTexture: finished };
  const siding = (id: number, name: string, display: string) => add(id, name, display, { hardness: 1, tool: A, material: "wood", flammable: true, ...wallOpts });
  siding(C.SIDING_WHITE, "white_siding", "White Siding");
  siding(C.SIDING_CREAM, "cream_siding", "Cream Siding");
  siding(C.SIDING_BLUE, "blue_siding", "Blue Siding");
  siding(C.SIDING_SAGE, "sage_siding", "Sage Siding");
  siding(C.SIDING_GREY, "grey_siding", "Grey Siding");
  siding(C.SIDING_YELLOW, "yellow_siding", "Yellow Siding");
  siding(C.SIDING_PINK, "pink_siding", "Pink Siding");
  siding(C.SIDING_BROWN, "brown_siding", "Brown Siding");
  siding(C.BARN_SIDING, "barn_siding", "Barn Siding");
  add(C.TAN_BRICK, "tan_bricks", "Tan Bricks", { hardness: 2, tool: P, harvestTier: 0, ...wallOpts });
  add(C.BROWN_BRICK, "brown_bricks", "Brown Bricks", { hardness: 2, tool: P, harvestTier: 0, ...wallOpts });
  add(C.WHITE_BRICK, "white_bricks", "Painted Bricks", { hardness: 2, tool: P, harvestTier: 0, ...wallOpts });
  add(C.CINDER_BLOCK, "cinder_block", "Cinder Block", { hardness: 2, tool: P, harvestTier: 0, ...wallOpts });
  add(C.STUCCO, "stucco", "Stucco", { hardness: 1.5, tool: P, harvestTier: 0, ...wallOpts });
  const wall = (id: number, name: string, display: string) => add(id, name, display, { hardness: 0.8, tool: A, material: "wood" });
  wall(C.DRYWALL, "drywall", "Drywall");
  wall(C.WALLPAPER_FLORAL, "floral_wallpaper", "Floral Wallpaper");
  wall(C.WALLPAPER_STRIPE, "striped_wallpaper", "Striped Wallpaper");
  wall(C.WALLPAPER_PLAID, "plaid_wallpaper", "Plaid Wallpaper");
  add(C.WOOD_PANELING, "wood_paneling", "Wood Paneling", { hardness: 1, tool: A, material: "wood", flammable: true });
  add(C.WALL_TILE, "wall_tile", "Wall Tile", { hardness: 1.2, tool: P, harvestTier: 0 });

  // ---- floors ------------------------------------------------------------------------------------------
  add(C.HARDWOOD, "hardwood_floor", "Hardwood Floor", { hardness: 1.5, tool: A, material: "wood", flammable: true });
  add(C.DARK_HARDWOOD, "dark_hardwood_floor", "Dark Hardwood Floor", { hardness: 1.5, tool: A, material: "wood", flammable: true });
  for (const [id, color] of [[C.CARPET_BEIGE, "beige"], [C.CARPET_BROWN, "brown"], [C.CARPET_BLUE, "blue"], [C.CARPET_GREEN, "green"], [C.CARPET_RED, "red"], [C.CARPET_GREY, "grey"]] as const) {
    add(id, `${color}_carpet_floor`, `${color[0].toUpperCase()}${color.slice(1)} Carpet Floor`, { hardness: 0.8, tool: A, material: "wool", flammable: true });
  }
  add(C.LINOLEUM, "linoleum", "Linoleum", { hardness: 1, tool: P, harvestTier: 0 });
  add(C.BATH_TILE, "bath_tile", "Bathroom Tile", { hardness: 1.2, tool: P, harvestTier: 0 });
  add(C.TERRACOTTA_TILE, "terracotta_tile", "Terracotta Tile", { hardness: 1.2, tool: P, harvestTier: 0 });
  add(C.PAINTED_CONCRETE, "painted_concrete", "Painted Concrete", { hardness: 1.8, tool: P, harvestTier: 0 });
  add(C.VINYL_FLOOR, "vinyl_floor", "Vinyl Floor", { hardness: 1, tool: P, harvestTier: 0 });

  // ---- roofs -------------------------------------------------------------------------------------------
  const ROOF = ["grey", "brown", "black", "red", "green"] as const;
  ROOF.forEach((color, i) => {
    const t = `${color}_shingles`, title = `${color[0].toUpperCase()}${color.slice(1)} Shingles`;
    add(C.SHINGLES_GREY + i, t, title, { hardness: 1, tool: A, material: "wood", flammable: true });
    add(C.SHINGLE_STAIRS_GREY + i, `${t}_stairs`, `${title} Stairs`, {
      shape: "boxes", layer: "opaque", opaque: false, boxes: api.stairBoxes, textures: tex(t), hardness: 1, tool: A, material: "wood", facing: "away", flammable: true,
    });
    add(C.SHINGLE_SLAB_GREY + i, `${t}_slab`, `${title} Slab`, {
      shape: "boxes", layer: "opaque", opaque: false, boxes: api.slabBoxes, textures: tex(t), hardness: 1, tool: A, material: "wood", flammable: true,
    });
  });
  add(C.TAR_ROOF, "tar_roof", "Tar Roof", { hardness: 1, tool: S, material: "gravel" });
  add(C.CORRUGATED_METAL, "corrugated_metal", "Corrugated Metal", { hardness: 3, tool: P, harvestTier: 0, material: "metal" });
  add(C.RUSTY_METAL, "rusty_metal", "Rusty Corrugated Metal", { hardness: 3, tool: P, harvestTier: 0, material: "metal" });

  // ---- fences and barriers -------------------------------------------------------------------------------
  // A fence panel stands across the middle of its block, along the way it was laid.
  const panel = (y1: number, thick = 2): Box[] => [[0, 0, 8 - thick / 2, 16, y1, 8 + thick / 2]];
  add(C.PICKET_FENCE, "picket_fence", "Picket Fence", {
    ...furniture({ model: panel(12), collision: (m) => panel(16).map((b) => api.hFacingBox(b, m & 3)) }),
    textures: tex("picket_fence"), hardness: 1.5, tool: A, material: "wood", flammable: true,
  });
  add(C.PRIVACY_FENCE, "privacy_fence", "Privacy Fence", {
    ...furniture({ model: panel(16, 2) }), textures: tex("privacy_fence"), hardness: 2, tool: A, material: "wood", flammable: true,
  });
  add(C.CHAIN_LINK, "chain_link_fence", "Chain-Link Fence", {
    ...furniture({ model: panel(16, 1) }), textures: tex("chain_link"), hardness: 4, tool: P, harvestTier: 0, material: "metal",
  });
  add(C.BARBED_WIRE, "barbed_wire", "Barbed Wire", {
    shape: "cross", layer: "cutout", solid: false, opaque: false, hardness: 2, tool: "shears", material: "metal", speedFactor: 0.3,
    textures: tex("barbed_wire"),
  });
  add(C.SANDBAGS, "sandbags", "Sandbags", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 14, 16]], textures: tex("sandbags_top", "sandbags"),
    hardness: 3, tool: S, material: "sand",
  });
  add(C.JERSEY_BARRIER, "jersey_barrier", "Concrete Barrier", {
    ...furniture({ model: [[1, 0, 2, 15, 4, 14], [1, 4, 5, 15, 12, 11]] }), layer: "opaque", textures: tex("concrete"),
    hardness: 6, tool: P, harvestTier: 1,
  });
  // The cordon round the county: the soldiers behind it do not let anyone cut through.
  add(C.CORDON_FENCE, "cordon_fence", "Quarantine Fence", {
    ...furniture({ model: panel(16, 2) }), textures: tex("cordon_fence"), hardness: -1, material: "metal", drops: [],
  });
  add(C.GUARD_RAIL, "guard_rail", "Guard Rail", {
    ...furniture({ model: [[0, 5, 6, 16, 10, 8], [7, 0, 7, 9, 10, 9]] }), layer: "opaque", textures: tex("guard_rail"),
    hardness: 3, tool: P, harvestTier: 0, material: "metal",
  });

  // ---- windows and doors ---------------------------------------------------------------------------------
  /** Boards nailed across the outside of a window or doorway, one to four. */
  const BOARDS: Box[] = [[0, 12, 5, 16, 15, 7], [0, 2, 5, 16, 5, 7], [0, 7, 5, 16, 10, 7], [0, 4, 4, 16, 6, 5]];
  const boards = (n: number): Box[] => BOARDS.slice(0, n);
  const windowBoxes = (meta: number): Box[] => [[0, 0, 7, 16, 16, 9] as Box, ...boards(boardsOf(meta))].map((b) => api.hFacingBox(b, meta & 3));
  add(C.HOUSE_WINDOW, "house_window", "Window", {
    shape: "boxes", layer: "cutout", opaque: false, facing: "player", boxes: windowBoxes,
    // Shut, it is a wall of glass; open or smashed, it is a way in (and out) — unless boards are across it.
    collision: (meta) => windowBoxes(meta).filter((_, i) => i > 0 || ((meta & (WINDOW_OPEN | WINDOW_BROKEN)) === 0)),
    boxTexture: (meta, box) => box > 0 ? "barricade_planks"
      : meta & WINDOW_BROKEN ? "window_broken" : meta & WINDOW_CURTAIN ? "window_curtain" : meta & WINDOW_OPEN ? "window_open" : "window",
    textures: tex("window"), hardness: 0.3, material: "glass", interact: "window", drops: [],
  });
  const door = (id: number, name: string, display: string, hardness: number, material: BlockDef["material"], tool: BlockDef["tool"]) => add(id, name, display, {
    shape: "boxes", layer: "cutout", opaque: false,
    // The door, and whatever boards are nailed across its outside.
    boxes: (meta) => [...api.doorBoxes(meta), ...boards(boardsOf(meta)).map((b) => api.hFacingBox(b, meta & 3))],
    textures: tex(`${name}_top`, `${name}_bottom`), hardness, tool, material, interact: "door",
    boxTexture: (meta, box) => (box > 0 ? "barricade_planks" : undefined),
  });
  door(C.PANEL_DOOR, "panel_door", "Panel Door", 3, "wood", A);
  door(C.FRONT_DOOR, "front_door", "Front Door", 4, "wood", A);
  door(C.METAL_DOOR, "metal_door", "Metal Door", 8, "metal", P);
  door(C.GLASS_DOOR, "glass_door", "Glass Door", 2, "glass", P);
  add(C.BARRICADE, "barricade", "Barricade", {
    shape: "boxes", layer: "cutout", opaque: false, facing: "player",
    boxes: (meta) => boards(Math.max(1, boardsOf(meta))).map((b) => api.hFacingBox(b, meta & 3)),
    collision: (meta) => [api.hFacingBox([0, 0, 4, 16, 16, 7], meta & 3)],
    textures: tex("barricade_planks"), hardness: 2, tool: A, material: "wood", flammable: true, drops: [{ item: "plank", min: 1, max: 2 }],
  });
  add(C.GARAGE_DOOR, "garage_door", "Garage Door", {
    shape: "boxes", layer: "opaque", opaque: false, facing: "player",
    boxes: (meta) => [api.hFacingBox(meta & GARAGE_OPEN ? [0, 13, 7, 16, 16, 9] : [0, 0, 7, 16, 16, 9], meta & 3)],
    collision: (meta) => (meta & GARAGE_OPEN ? [] : [api.hFacingBox([0, 0, 7, 16, 16, 9], meta & 3)]),
    textures: tex("garage_door"), hardness: 6, tool: P, material: "metal", interact: "garage",
  });

  // ---- kitchen --------------------------------------------------------------------------------------------
  const counterModel: Box[] = [[0, 0, 1, 16, 14, 16], [0, 14, 0, 16, 16, 16]];
  add(C.COUNTER, "kitchen_counter", "Kitchen Counter", {
    ...furniture({ model: counterModel }), layer: "opaque", textures: tex("countertop", "cabinet_side"),
    boxTexture: (meta, box, face) => (box === 1 ? "countertop" : faces({ front: "cabinet_front", side: "cabinet_side", top: "countertop" })(meta, box, face)),
    hardness: 2, tool: A, material: "wood", interact: "chest", container: 9, loot: "kitchen",
  });
  add(C.COUNTER_SINK, "kitchen_sink", "Kitchen Sink", {
    ...furniture({ model: counterModel }), layer: "opaque", textures: tex("countertop_sink", "cabinet_side"),
    boxTexture: (meta, box, face) => (box === 1 ? (face === UP ? "countertop_sink" : "countertop") : faces({ front: "cabinet_front", side: "cabinet_side", top: "countertop" })(meta, box, face)),
    hardness: 2, tool: A, material: "wood", interact: "water",
  });
  add(C.STOVE, "stove", "Stove", {
    ...furniture({ model: [[0, 0, 1, 16, 16, 16]] }), layer: "opaque", textures: tex("stove_top", "stove_side"),
    boxTexture: faces({ front: "stove_front", side: "stove_side", top: "stove_top" }), hardness: 3, tool: P, material: "metal", interact: "stove",
  });
  add(C.FRIDGE, "fridge", "Refrigerator", {
    ...furniture({ model: [[0, 0, 1, 16, 16, 16]] }), layer: "opaque", textures: tex("fridge_side"),
    boxTexture: faces({ front: "fridge_front", side: "fridge_side", top: "fridge_side" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 12, loot: "fridge",
  });
  add(C.FREEZER, "freezer", "Freezer", {
    ...furniture({ model: [[0, 0, 1, 16, 16, 16]] }), layer: "opaque", textures: tex("fridge_side"),
    boxTexture: faces({ front: "freezer_front", side: "fridge_side", top: "fridge_side" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 9, loot: "freezer",
  });
  add(C.WALL_CABINET, "wall_cabinet", "Wall Cabinet", {
    ...furniture({ model: [[0, 3, 8, 16, 16, 16]] }), textures: tex("cabinet_side"),
    boxTexture: faces({ front: "wall_cabinet_front", side: "cabinet_side", top: "cabinet_side" }), hardness: 1.5, tool: A, material: "wood",
    interact: "chest", container: 6, loot: "pantry",
  });
  add(C.MICROWAVE, "microwave", "Microwave", {
    ...furniture({ model: [[2, 0, 4, 14, 7, 13]] }), textures: tex("appliance_white"),
    boxTexture: faces({ front: "microwave_front", side: "appliance_white", top: "appliance_white" }), hardness: 1, tool: P, material: "metal", interact: "stove",
  });
  add(C.DINING_TABLE, "dining_table", "Dining Table", {
    shape: "boxes", layer: "opaque", opaque: false,
    boxes: () => [[0, 13, 0, 16, 15, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0, 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]],
    textures: tex("table_wood"), hardness: 2, tool: A, material: "wood", flammable: true,
  });
  add(C.KITCHEN_CHAIR, "kitchen_chair", "Chair", {
    ...furniture({ model: [[3, 7, 3, 13, 9, 13], [3, 9, 12, 13, 16, 13], [3, 0, 3, 5, 7, 5], [11, 0, 3, 13, 7, 5], [3, 0, 11, 5, 7, 13], [11, 0, 11, 13, 7, 13]] }),
    textures: tex("table_wood"), hardness: 1.5, tool: A, material: "wood", flammable: true,
  });
  add(C.TRASH_CAN, "trash_can", "Trash Can", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[4, 0, 4, 12, 12, 12]], textures: tex("trash_can_top", "trash_can_side"),
    hardness: 1, tool: P, material: "metal", interact: "chest", container: 6, loot: "trash",
  });

  // ---- living room -----------------------------------------------------------------------------------------
  const couchBoxes = (meta: number): Box[] => {
    const b: Box[] = [[0, 0, 1, 16, 7, 15], [0, 7, 11, 16, 14, 15]];
    // Left and right as seen from the front, which faces north: left is +x.
    if (meta & ARM_LEFT) b.push([13, 0, 1, 16, 11, 15]);
    if (meta & ARM_RIGHT) b.push([0, 0, 1, 3, 11, 15]);
    return b.map((x) => api.hFacingBox(x, meta & 3));
  };
  for (const [id, color, title] of [[C.COUCH_BROWN, "brown", "Brown"], [C.COUCH_BLUE, "blue", "Blue"], [C.COUCH_GREEN, "green", "Green"], [C.COUCH_FLORAL, "floral", "Floral"]] as const) {
    add(id, `${color}_couch`, `${title} Couch`, {
      shape: "boxes", layer: "opaque", opaque: false, facing: "player", boxes: couchBoxes, textures: tex(`${color}_upholstery`),
      hardness: 1.5, tool: A, material: "wool", flammable: true,
    });
  }
  add(C.ARMCHAIR, "armchair", "Armchair", {
    shape: "boxes", layer: "opaque", opaque: false, facing: "player", boxes: (m) => couchBoxes((m & 3) | ARM_LEFT | ARM_RIGHT),
    textures: tex("leather_upholstery"), hardness: 1.5, tool: A, material: "wool", flammable: true,
  });
  add(C.COFFEE_TABLE, "coffee_table", "Coffee Table", {
    shape: "boxes", layer: "opaque", opaque: false,
    boxes: () => [[1, 6, 3, 15, 8, 13], [2, 0, 4, 4, 6, 6], [12, 0, 4, 14, 6, 6], [2, 0, 10, 4, 6, 12], [12, 0, 10, 14, 6, 12]],
    textures: tex("table_wood"), hardness: 1.5, tool: A, material: "wood", flammable: true,
  });
  add(C.TELEVISION, "television", "Television", {
    ...furniture({ model: [[2, 0, 4, 14, 5, 12], [3, 5, 4, 13, 14, 13]] }), textures: tex("tv_side"),
    boxTexture: (meta, box, face) => (box === 0 ? "table_wood" : faces({ front: "tv_front", side: "tv_side", top: "tv_side" })(meta, box, face)),
    hardness: 1, tool: P, material: "metal", interact: "tv",
  });
  add(C.RADIO, "radio", "Radio", {
    ...furniture({ model: [[3, 0, 5, 13, 6, 11]] }), textures: tex("radio_side"),
    boxTexture: faces({ front: "radio_front", side: "radio_side", top: "radio_side" }), hardness: 0.5, material: "metal", interact: "radio",
  });
  add(C.BOOKCASE, "bookcase", "Bookcase", {
    ...furniture({ model: [[0, 0, 2, 16, 16, 16]] }), layer: "opaque", textures: tex("table_wood"),
    boxTexture: faces({ front: "bookcase_front", side: "table_wood", top: "table_wood" }), hardness: 1.5, tool: A, material: "wood",
    flammable: true, interact: "chest", container: 9, loot: "books",
  });
  const lampModel: Box[] = [[7, 0, 7, 9, 11, 9], [4, 11, 4, 12, 16, 12], [5, 0, 5, 11, 1, 11]];
  add(C.FLOOR_LAMP, "floor_lamp", "Floor Lamp", {
    shape: "boxes", layer: "cutout", opaque: false, boxes: () => lampModel, emission: 13, textures: tex("lamp_shade_lit"),
    boxTexture: (_m, box) => (box === 1 ? "lamp_shade_lit" : "lamp_metal"), hardness: 0.5, material: "metal",
  });
  add(C.FLOOR_LAMP_OFF, "floor_lamp_off", "Floor Lamp (Off)", {
    shape: "boxes", layer: "cutout", opaque: false, boxes: () => lampModel, textures: tex("lamp_shade"),
    boxTexture: (_m, box) => (box === 1 ? "lamp_shade" : "lamp_metal"), hardness: 0.5, material: "metal", hidden: true,
    drops: [{ item: "floor_lamp", min: 1, max: 1 }],
  });
  add(C.CEILING_LIGHT, "ceiling_light", "Ceiling Light", {
    shape: "boxes", layer: "cutout", opaque: false, solid: false, boxes: () => [[4, 14, 4, 12, 16, 12]], collision: () => [],
    emission: 15, textures: tex("ceiling_light_lit"), hardness: 0.3, material: "glass",
  });
  add(C.CEILING_LIGHT_OFF, "ceiling_light_off", "Ceiling Light (Off)", {
    shape: "boxes", layer: "cutout", opaque: false, solid: false, boxes: () => [[4, 14, 4, 12, 16, 12]], collision: () => [],
    textures: tex("ceiling_light"), hardness: 0.3, material: "glass", hidden: true, drops: [{ item: "ceiling_light", min: 1, max: 1 }],
  });
  add(C.POTTED_PLANT, "potted_plant", "Potted Plant", {
    shape: "boxes", layer: "cutout", opaque: false, boxes: () => [[5, 0, 5, 11, 5, 11], [3, 5, 3, 13, 14, 13]],
    boxTexture: (_m, box) => (box === 0 ? "plant_pot" : "houseplant"), textures: tex("houseplant"), hardness: 0.3, material: "plant",
  });
  add(C.END_TABLE, "end_table", "End Table", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[2, 0, 2, 14, 11, 14]], textures: tex("table_wood"),
    boxTexture: (_m, _b, face) => (face === UP ? "table_wood" : "end_table_side"), hardness: 1.5, tool: A, material: "wood",
    flammable: true, interact: "chest", container: 4, loot: "living",
  });

  // ---- bedroom ------------------------------------------------------------------------------------------------
  const bed = (id: number, name: string, display: string) => add(id, name, display, {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 9, 16]],
    textures: tex(`${name}_foot_top`, `${name}_side`, "oak_planks"), hardness: 0.2, material: "wool", interact: "bed",
    drops: [{ item: name, min: 1, max: 1 }],
  });
  bed(C.BLUE_BED, "blue_bed", "Blue Bed");
  bed(C.GREEN_BED, "green_bed", "Green Bed");
  bed(C.HOSPITAL_BED, "hospital_bed", "Hospital Bed");
  add(C.WARDROBE, "wardrobe", "Wardrobe", {
    ...furniture({ model: [[0, 0, 2, 16, 16, 16]] }), layer: "opaque", textures: tex("table_wood"),
    boxTexture: faces({ front: "wardrobe_front", side: "table_wood", top: "table_wood" }), hardness: 2, tool: A, material: "wood",
    flammable: true, interact: "chest", container: 12, loot: "wardrobe",
  });
  add(C.DRESSER, "dresser", "Dresser", {
    ...furniture({ model: [[0, 0, 3, 16, 12, 16]] }), layer: "opaque", textures: tex("table_wood"),
    boxTexture: faces({ front: "dresser_front", side: "table_wood", top: "table_wood" }), hardness: 2, tool: A, material: "wood",
    flammable: true, interact: "chest", container: 9, loot: "dresser",
  });
  add(C.NIGHTSTAND, "nightstand", "Nightstand", {
    ...furniture({ model: [[2, 0, 3, 14, 10, 15]] }), textures: tex("table_wood"),
    boxTexture: faces({ front: "nightstand_front", side: "table_wood", top: "table_wood" }), hardness: 1.5, tool: A, material: "wood",
    flammable: true, interact: "chest", container: 4, loot: "nightstand",
  });
  add(C.DESK, "desk", "Desk", {
    ...furniture({ model: [[0, 12, 2, 16, 14, 16], [9, 0, 3, 16, 12, 16], [0, 0, 3, 2, 12, 16]] }), textures: tex("table_wood"),
    boxTexture: (meta, box, face) => (box === 1 ? faces({ front: "desk_front", side: "table_wood", top: "table_wood" })(meta, box, face) : "table_wood"),
    hardness: 1.5, tool: A, material: "wood", flammable: true, interact: "chest", container: 6, loot: "office",
  });
  add(C.OFFICE_CHAIR, "office_chair", "Office Chair", {
    ...furniture({ model: [[3, 6, 3, 13, 8, 13], [3, 8, 12, 13, 16, 14], [7, 1, 7, 9, 6, 9], [3, 0, 3, 13, 1, 13]] }),
    textures: tex("black_upholstery"), boxTexture: (_m, box) => (box >= 2 ? "lamp_metal" : "black_upholstery"), hardness: 1, material: "metal",
  });

  // ---- bathroom and laundry --------------------------------------------------------------------------------------
  add(C.TOILET, "toilet", "Toilet", {
    ...furniture({ model: [[4, 0, 1, 12, 7, 11], [3, 4, 11, 13, 13, 15]] }), textures: tex("porcelain"),
    boxTexture: (meta, box, face) => (box === 0 && face === UP ? "toilet_top" : "porcelain"), hardness: 1, tool: P, material: "stone", interact: "water",
  });
  add(C.BATHROOM_SINK, "bathroom_sink", "Bathroom Sink", {
    ...furniture({ model: [[6, 0, 8, 10, 10, 12], [2, 10, 4, 14, 14, 16]] }), textures: tex("porcelain"),
    boxTexture: (meta, box, face) => (box === 1 && face === UP ? "sink_basin" : "porcelain"), hardness: 1, tool: P, material: "stone", interact: "water",
  });
  add(C.BATHTUB, "bathtub", "Bathtub", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[0, 0, 0, 16, 9, 16]], textures: tex("bathtub_top", "porcelain"),
    hardness: 1.5, tool: P, material: "stone", interact: "water",
  });
  add(C.MEDICINE_CABINET, "medicine_cabinet", "Medicine Cabinet", {
    ...furniture({ model: [[3, 5, 12, 13, 15, 16]] }), textures: tex("appliance_white"),
    boxTexture: faces({ front: "medicine_cabinet_front", side: "appliance_white", top: "appliance_white" }), hardness: 1, material: "glass",
    interact: "chest", container: 4, loot: "medicine",
  });
  add(C.WASHING_MACHINE, "washing_machine", "Washing Machine", {
    ...furniture({ model: [[1, 0, 1, 15, 15, 15]] }), layer: "opaque", textures: tex("appliance_white"),
    boxTexture: faces({ front: "washer_front", side: "appliance_white", top: "appliance_white" }), hardness: 2, tool: P, material: "metal",
    interact: "chest", container: 6, loot: "laundry",
  });
  add(C.DRYER, "dryer", "Clothes Dryer", {
    ...furniture({ model: [[1, 0, 1, 15, 15, 15]] }), layer: "opaque", textures: tex("appliance_white"),
    boxTexture: faces({ front: "dryer_front", side: "appliance_white", top: "appliance_white" }), hardness: 2, tool: P, material: "metal",
    interact: "chest", container: 6, loot: "laundry",
  });

  // ---- workshop ---------------------------------------------------------------------------------------------------
  add(C.WORKBENCH, "workbench", "Workbench", {
    ...furniture({ model: [[0, 12, 0, 16, 16, 16], [1, 0, 1, 3, 12, 3], [13, 0, 1, 15, 12, 3], [1, 0, 13, 3, 12, 15], [13, 0, 13, 15, 12, 15], [1, 3, 3, 15, 4, 13]] }),
    layer: "opaque", textures: tex("workbench_top", "table_wood"), boxTexture: (_m, box, face) => (box === 0 && face === UP ? "workbench_top" : "table_wood"),
    hardness: 2.5, tool: A, material: "wood", interact: "crafting",
  });
  add(C.METAL_SHELF, "metal_shelf", "Metal Shelving", {
    ...furniture({ model: [[0, 0, 3, 16, 16, 16]] }), textures: tex("lamp_metal"),
    boxTexture: faces({ front: "metal_shelf_front", side: "metal_shelf_side", top: "lamp_metal" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 12, loot: "garage",
  });
  add(C.TOOL_CHEST, "tool_chest", "Tool Chest", {
    ...furniture({ model: [[1, 0, 3, 15, 14, 15]] }), textures: tex("tool_chest_side"),
    boxTexture: faces({ front: "tool_chest_front", side: "tool_chest_side", top: "tool_chest_side" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 9, loot: "tools",
  });
  add(C.GENERATOR, "generator", "Generator", {
    ...furniture({ model: [[2, 0, 3, 14, 10, 13], [3, 10, 5, 13, 12, 11]] }), textures: tex("generator_side"),
    boxTexture: faces({ front: "generator_front", side: "generator_side", top: "generator_top" }), hardness: 3, tool: P, material: "metal",
    interact: "generator",
  });
  add(C.FUEL_DRUM, "fuel_drum", "Fuel Drum", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[2, 0, 2, 14, 15, 14]], textures: tex("fuel_drum_top", "fuel_drum_side"),
    hardness: 3, tool: P, material: "metal",
  });
  add(C.CRATE, "crate", "Crate", { textures: tex("crate"), hardness: 2, tool: A, material: "wood", flammable: true, interact: "chest", container: 12, loot: "crate" });
  add(C.WATER_HEATER, "water_heater", "Water Heater", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[3, 0, 3, 13, 15, 13]], textures: tex("appliance_white", "water_heater_side"),
    hardness: 2, tool: P, material: "metal", interact: "water",
  });

  // ---- shops and public buildings -------------------------------------------------------------------------------------
  add(C.STORE_SHELF, "store_shelf", "Store Shelf", {
    ...furniture({ model: [[0, 0, 2, 16, 16, 14]] }), textures: tex("lamp_metal"),
    boxTexture: faces({ front: "store_shelf_front", side: "store_shelf_side", top: "lamp_metal" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 12, loot: "grocery",
  });
  add(C.COOLER, "cooler", "Drinks Cooler", {
    ...furniture({ model: [[0, 0, 2, 16, 16, 16]] }), layer: "opaque", textures: tex("cooler_side"),
    boxTexture: faces({ front: "cooler_front", side: "cooler_side", top: "cooler_side" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 12, loot: "cooler",
  });
  add(C.CHECKOUT, "checkout", "Checkout Counter", {
    ...furniture({ model: [[0, 0, 1, 16, 14, 16], [4, 14, 6, 12, 16, 13]] }), layer: "opaque", textures: tex("checkout_top", "checkout_side"),
    boxTexture: (meta, box, face) => (box === 1 ? faces({ front: "register_front", side: "lamp_metal", top: "lamp_metal" })(meta, box, face)
      : faces({ front: "checkout_side", side: "checkout_side", top: "checkout_top" })(meta, box, face)),
    hardness: 2, tool: P, material: "metal", interact: "chest", container: 4, loot: "register",
  });
  add(C.CLOTHING_RACK, "clothing_rack", "Clothing Rack", {
    ...furniture({ model: [[1, 14, 7, 15, 15, 9], [2, 4, 5, 14, 14, 11], [1, 0, 7, 2, 15, 9], [14, 0, 7, 15, 15, 9]] }), textures: tex("clothes_hung"),
    boxTexture: (_m, box) => (box === 1 ? "clothes_hung" : "lamp_metal"), hardness: 1, material: "metal",
    interact: "chest", container: 9, loot: "clothing",
  });
  add(C.GUN_RACK, "gun_rack", "Gun Rack", {
    ...furniture({ model: [[0, 0, 10, 16, 16, 16]] }), textures: tex("table_wood"),
    boxTexture: faces({ front: "gun_rack_front", side: "table_wood", top: "table_wood" }), hardness: 3, tool: A, material: "wood",
    interact: "chest", container: 9, loot: "guns",
  });
  add(C.VENDING_MACHINE, "vending_machine", "Vending Machine", {
    ...furniture({ model: [[0, 0, 2, 16, 16, 16]] }), layer: "opaque", textures: tex("vending_side"),
    boxTexture: faces({ front: "vending_front", side: "vending_side", top: "vending_side" }), hardness: 4, tool: P, material: "metal",
    interact: "chest", container: 9, loot: "vending", emission: 4,
  });
  add(C.GAS_PUMP, "gas_pump", "Gas Pump", {
    ...furniture({ model: [[3, 0, 5, 13, 16, 11]] }), layer: "opaque", textures: tex("gas_pump_side"),
    boxTexture: faces({ front: "gas_pump_front", side: "gas_pump_side", top: "gas_pump_side" }), hardness: 4, tool: P, material: "metal",
    interact: "fuel",
  });
  add(C.FILING_CABINET, "filing_cabinet", "Filing Cabinet", {
    ...furniture({ model: [[3, 0, 3, 13, 16, 15]] }), layer: "opaque", textures: tex("filing_side"),
    boxTexture: faces({ front: "filing_front", side: "filing_side", top: "filing_side" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 9, loot: "office",
  });
  add(C.LOCKER, "locker", "Locker", {
    ...furniture({ model: [[2, 0, 3, 14, 16, 16]] }), layer: "opaque", textures: tex("locker_side"),
    boxTexture: faces({ front: "locker_front", side: "locker_side", top: "locker_side" }), hardness: 3, tool: P, material: "metal",
    interact: "chest", container: 9, loot: "locker",
  });
  add(C.SCHOOL_DESK, "school_desk", "School Desk", {
    ...furniture({ model: [[2, 10, 1, 14, 12, 11], [3, 0, 2, 5, 10, 4], [11, 0, 2, 13, 10, 4], [3, 0, 8, 5, 10, 10], [11, 0, 8, 13, 10, 10], [3, 5, 11, 13, 7, 15]] }),
    textures: tex("table_wood"), boxTexture: (_m, box) => (box === 0 || box === 5 ? "table_wood" : "lamp_metal"), hardness: 1.5, material: "metal",
  });
  add(C.CHURCH_PEW, "church_pew", "Pew", {
    ...furniture({ model: [[0, 6, 3, 16, 8, 11], [0, 8, 10, 16, 15, 12], [0, 0, 3, 1, 12, 12], [15, 0, 3, 16, 12, 12]] }),
    textures: tex("dark_table_wood"), hardness: 2, tool: A, material: "wood", flammable: true,
  });
  add(C.MILITARY_CRATE, "military_crate", "Military Crate", {
    ...furniture({ model: [[1, 0, 2, 15, 11, 14]] }), layer: "opaque", textures: tex("military_crate_top", "military_crate_side"),
    boxTexture: faces({ front: "military_crate_front", side: "military_crate_side", top: "military_crate_top" }), hardness: 3, tool: A, material: "wood",
    interact: "chest", container: 12, loot: "military",
  });
  add(C.SAFE, "safe", "Safe", {
    ...furniture({ model: [[2, 0, 2, 14, 14, 14]] }), layer: "opaque", textures: tex("safe_side"),
    boxTexture: faces({ front: "safe_front", side: "safe_side", top: "safe_side" }), hardness: 25, tool: P, harvestTier: 2, material: "metal",
    interact: "chest", container: 6, loot: "safe",
  });

  // ---- the street ----------------------------------------------------------------------------------------------------
  add(C.MAILBOX, "mailbox", "Mailbox", {
    ...furniture({ model: [[7, 0, 7, 9, 10, 9], [5, 10, 3, 11, 15, 13]] }), textures: tex("mailbox"),
    boxTexture: (_m, box) => (box === 0 ? "table_wood" : "mailbox"), hardness: 1, material: "metal", interact: "chest", container: 3, loot: "mail",
  });
  add(C.DUMPSTER, "dumpster", "Dumpster", {
    ...furniture({ model: [[0, 0, 1, 16, 14, 16]] }), layer: "opaque", textures: tex("dumpster_top", "dumpster_side"),
    hardness: 4, tool: P, material: "metal", interact: "chest", container: 12, loot: "dumpster",
  });
  add(C.LAMP_POST, "lamp_post", "Lamp Post", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[7, 0, 7, 9, 16, 9]], textures: tex("lamp_metal"), hardness: 3, tool: P, material: "metal",
  });
  const lampHead: Box[] = [[7, 0, 7, 9, 9, 9], [3, 9, 3, 13, 12, 13]];
  add(C.STREET_LAMP, "street_lamp", "Street Lamp", {
    shape: "boxes", layer: "cutout", opaque: false, boxes: () => lampHead, emission: 15, textures: tex("street_lamp_lit"),
    boxTexture: (_m, box, face) => (box === 0 ? "lamp_metal" : face === DOWN ? "street_lamp_lit" : "lamp_metal"), hardness: 3, tool: P, material: "metal",
  });
  add(C.STREET_LAMP_OFF, "street_lamp_off", "Street Lamp (Off)", {
    shape: "boxes", layer: "cutout", opaque: false, boxes: () => lampHead, textures: tex("street_lamp"),
    boxTexture: (_m, box, face) => (box === 0 ? "lamp_metal" : face === DOWN ? "street_lamp" : "lamp_metal"), hardness: 3, tool: P, material: "metal",
    hidden: true, drops: [{ item: "street_lamp", min: 1, max: 1 }],
  });
  const signModel: Box[] = [[7, 0, 7, 9, 16, 9], [2, 6, 6, 14, 16, 7]];
  add(C.STOP_SIGN, "stop_sign", "Stop Sign", {
    ...furniture({ model: signModel }), textures: tex("stop_sign"), boxTexture: (m, box, face) => (box === 1 && face === FACING_TO_FACE[m & 3] ? "stop_sign" : box === 1 ? "sign_back" : "lamp_metal"),
    hardness: 2, tool: P, material: "metal",
  });
  add(C.ROAD_SIGN, "road_sign", "Road Sign", {
    ...furniture({ model: signModel }), textures: tex("road_sign"), boxTexture: (m, box, face) => (box === 1 && face === FACING_TO_FACE[m & 3] ? "road_sign" : box === 1 ? "sign_back" : "lamp_metal"),
    hardness: 2, tool: P, material: "metal",
  });
  add(C.TRAFFIC_LIGHT, "traffic_light", "Traffic Light", {
    ...furniture({ model: [[5, 2, 6, 11, 16, 10], [7, 0, 7, 9, 2, 9]] }), textures: tex("traffic_light_side"), emission: 7,
    boxTexture: faces({ front: "traffic_light_front", side: "traffic_light_side", top: "traffic_light_side" }), hardness: 2, tool: P, material: "metal",
  });
  add(C.BENCH, "bench", "Park Bench", {
    ...furniture({ model: [[0, 5, 4, 16, 7, 12], [0, 7, 11, 16, 13, 13], [1, 0, 5, 3, 5, 11], [13, 0, 5, 15, 5, 11]] }),
    textures: tex("table_wood"), boxTexture: (_m, box) => (box >= 2 ? "lamp_metal" : "table_wood"), hardness: 2, tool: A, material: "wood",
  });
  add(C.PICNIC_TABLE, "picnic_table", "Picnic Table", {
    ...furniture({ model: [[0, 10, 3, 16, 12, 13], [0, 5, 0, 16, 7, 3], [0, 5, 13, 16, 7, 16], [2, 0, 7, 4, 10, 9], [12, 0, 7, 14, 10, 9]] }),
    textures: tex("table_wood"), hardness: 2, tool: A, material: "wood", flammable: true,
  });
  add(C.FIRE_HYDRANT, "fire_hydrant", "Fire Hydrant", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[5, 0, 5, 11, 10, 11], [6, 10, 6, 10, 12, 10], [3, 5, 7, 13, 7, 9]],
    textures: tex("fire_hydrant"), hardness: 4, tool: P, material: "metal", interact: "water",
  });
  add(C.POWER_POLE, "power_pole", "Utility Pole", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[6, 0, 6, 10, 16, 10]], textures: tex("power_pole_top", "power_pole"),
    hardness: 2, tool: A, material: "wood", flammable: true,
  });
  add(C.TRASH_BAG, "trash_bag", "Trash Bag", {
    shape: "boxes", layer: "opaque", opaque: false, boxes: () => [[3, 0, 3, 13, 8, 13]], textures: tex("trash_bag"),
    hardness: 0.2, material: "wool", interact: "chest", container: 3, loot: "trash",
  });

  // ---- the aftermath ---------------------------------------------------------------------------------------------------
  const decal = (id: number, name: string, display: string) => add(id, name, display, {
    shape: "boxes", layer: "cutout", opaque: false, solid: false, replaceable: true, boxes: () => [[0, 0, 0, 16, 1, 16]], collision: () => [],
    textures: tex(name), hardness: 0, material: "none", drops: [], needsSupport: true,
  });
  decal(C.BLOOD_SPLATTER, "blood_splatter", "Blood");
  decal(C.LITTER, "litter", "Litter");
  decal(C.BROKEN_GLASS, "broken_glass", "Broken Glass");
}

// ---- what the rest of the game asks of these blocks ------------------------------------------------

const DOORS = new Set<number>([C.PANEL_DOOR, C.FRONT_DOOR, C.METAL_DOOR, C.GLASS_DOOR]);
const BEDS = new Set<number>([C.BLUE_BED, C.GREEN_BED, C.HOSPITAL_BED]);
const SHINGLE_STAIRS = new Set<number>([C.SHINGLE_STAIRS_GREY, C.SHINGLE_STAIRS_BROWN, C.SHINGLE_STAIRS_BLACK, C.SHINGLE_STAIRS_RED, C.SHINGLE_STAIRS_GREEN]);
const SHINGLE_SLABS = new Set<number>([C.SHINGLE_SLAB_GREY, C.SHINGLE_SLAB_BROWN, C.SHINGLE_SLAB_BLACK, C.SHINGLE_SLAB_RED, C.SHINGLE_SLAB_GREEN]);
const COUCHES = new Set<number>([C.COUCH_BROWN, C.COUCH_BLUE, C.COUCH_GREEN, C.COUCH_FLORAL]);

export const isCountyDoor = (id: number): boolean => DOORS.has(id);
export const isCountyBed = (id: number): boolean => BEDS.has(id);
export const isShingleStairs = (id: number): boolean => SHINGLE_STAIRS.has(id);
export const isShingleSlab = (id: number): boolean => SHINGLE_SLABS.has(id);
export const isCouch = (id: number): boolean => COUCHES.has(id);
/** Lights that go dark when the power does, and what each becomes. */
export const LIGHT_OFF: Readonly<Record<number, number>> = {
  [C.FLOOR_LAMP]: C.FLOOR_LAMP_OFF, [C.CEILING_LIGHT]: C.CEILING_LIGHT_OFF, [C.STREET_LAMP]: C.STREET_LAMP_OFF,
};
/** And back on, when a generator is running close enough. */
export const LIGHT_ON: Readonly<Record<number, number>> = Object.fromEntries(Object.entries(LIGHT_OFF).map(([on, off]) => [off, Number(on)]));
