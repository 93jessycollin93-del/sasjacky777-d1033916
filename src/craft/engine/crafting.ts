/**
 * Crafting and smelting recipes.
 *
 * Shaped recipes match anywhere in the grid and in mirror image, as they do in
 * the original — an axe laid out facing left is still an axe. Ingredients can
 * be a tag ("#planks") so one recipe covers every wood type instead of five
 * copies that drift apart the first time one is edited.
 *
 * The recipe book reads from the same list, so what it offers is exactly what
 * the grid accepts — mobile players craft almost entirely from the book, and a
 * book that lists a recipe the grid refuses is a broken promise.
 */
import { B, WOOL_COLORS } from "./blocks";
import { DYES, itemByName, itemDef, TIERS, type ItemStack } from "./items";
import { fadeFromGrid, rocketFromGrid, starFromGrid } from "./fireworks";
import { POTIONS } from "./potions";
import type { Slot } from "./inventory";

type Ingredient = string;

export interface Recipe {
  id: string;
  /** Rows of single-character keys; absent for shapeless. */
  pattern?: string[];
  key?: Record<string, Ingredient>;
  ingredients?: Ingredient[];
  result: { item: string; count: number };
  /** Fits in the 2×2 player grid. */
  small: boolean;
  /**
   * Makes the result from what is actually in the grid, for results that carry
   * something over from an ingredient (a dyed shulker box keeps its contents).
   */
  special?: (grid: Slot[]) => ItemStack | null;
  /** For recipes no fixed list can describe (a star of any dyes, a rocket of any stars): whether the grid makes it. */
  matches?: (grid: Slot[]) => boolean;
}

const TAGS: Record<string, string[]> = {
  planks: ["oak_planks", "birch_planks", "spruce_planks", "jungle_planks", "acacia_planks", "crimson_planks", "warped_planks"],
  logs: ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log"],
  stone_crafting: ["cobblestone", "cobbled_deepslate", "blackstone"],
  coals: ["coal", "charcoal"],
  wool: WOOL_COLORS.map((c) => `${c}_wool`),
  dye: DYES.map((d) => `${d}_dye`),
  lingering_effect: POTIONS.filter((p) => p.effects.length).map((p) => `lingering_${p.key}`),
};

/** The item ids an ingredient accepts. */
export function ingredientIds(ing: Ingredient): number[] {
  if (ing.startsWith("#")) return (TAGS[ing.slice(1)] ?? []).map((n) => itemByName(n).id);
  return [itemByName(ing).id];
}

const RECIPES: Recipe[] = [];

function shaped(id: string, pattern: string[], key: Record<string, Ingredient>, item: string, count = 1): void {
  const small = pattern.length <= 2 && pattern.every((r) => r.length <= 2);
  RECIPES.push({ id, pattern, key, result: { item, count }, small });
}
function shapeless(id: string, ingredients: Ingredient[], item: string, count = 1): void {
  RECIPES.push({ id, ingredients, result: { item, count }, small: ingredients.length <= 4 });
}

// Wood
for (const wood of ["oak", "birch", "spruce", "jungle", "acacia"]) shapeless(`${wood}_planks`, [`${wood}_log`], `${wood}_planks`, 4);
for (const wood of ["crimson", "warped"]) shapeless(`${wood}_planks`, [`${wood}_stem`], `${wood}_planks`, 4);
shaped("stick", ["#", "#"], { "#": "#planks" }, "stick", 4);
shaped("crafting_table", ["##", "##"], { "#": "#planks" }, "crafting_table");
shaped("chest", ["###", "# #", "###"], { "#": "#planks" }, "chest");
shaped("furnace", ["###", "# #", "###"], { "#": "#stone_crafting" }, "furnace");
shaped("torch", ["C", "S"], { C: "#coals", S: "stick" }, "torch", 4);
shaped("ladder", ["S S", "SSS", "S S"], { S: "stick" }, "ladder", 3);
shaped("oak_door", ["##", "##", "##"], { "#": "#planks" }, "oak_door", 3);
shaped("oak_fence", ["#S#", "#S#"], { "#": "#planks", S: "stick" }, "oak_fence", 3);
shaped("bowl", ["# #", " # "], { "#": "#planks" }, "bowl", 4);
shaped("red_bed", ["WWW", "###"], { W: "#wool", "#": "#planks" }, "red_bed");
shaped("bookshelf", ["###", "BBB", "###"], { "#": "#planks", B: "book" }, "bookshelf");
shaped("note_block", ["###", "#R#", "###"], { "#": "#planks", R: "redstone" }, "note_block");
shaped("oak_slab", ["###"], { "#": "#planks" }, "oak_slab", 6);
shaped("oak_stairs", ["#  ", "## ", "###"], { "#": "#planks" }, "oak_stairs", 4);

// Tools and weapons
const TOOL_MATERIAL: Record<string, Ingredient> = {
  wooden: "#planks", stone: "#stone_crafting", iron: "iron_ingot", golden: "gold_ingot", diamond: "diamond",
};
for (const t of TIERS) {
  const m = TOOL_MATERIAL[t.key];
  shaped(`${t.key}_pickaxe`, ["MMM", " S ", " S "], { M: m, S: "stick" }, `${t.key}_pickaxe`);
  shaped(`${t.key}_axe`, ["MM", "MS", " S"], { M: m, S: "stick" }, `${t.key}_axe`);
  shaped(`${t.key}_shovel`, ["M", "S", "S"], { M: m, S: "stick" }, `${t.key}_shovel`);
  shaped(`${t.key}_hoe`, ["MM", " S", " S"], { M: m, S: "stick" }, `${t.key}_hoe`);
  shaped(`${t.key}_sword`, ["M", "M", "S"], { M: m, S: "stick" }, `${t.key}_sword`);
}
const ARMOR_MATERIAL: Record<string, Ingredient> = { leather: "leather", iron: "iron_ingot", golden: "gold_ingot", diamond: "diamond" };
for (const [mat, m] of Object.entries(ARMOR_MATERIAL)) {
  shaped(`${mat}_helmet`, ["MMM", "M M"], { M: m }, `${mat}_helmet`);
  shaped(`${mat}_chestplate`, ["M M", "MMM", "MMM"], { M: m }, `${mat}_chestplate`);
  shaped(`${mat}_leggings`, ["MMM", "M M", "M M"], { M: m }, `${mat}_leggings`);
  shaped(`${mat}_boots`, ["M M", "M M"], { M: m }, `${mat}_boots`);
}
shaped("bow", [" TS", "T S", " TS"], { T: "stick", S: "string" }, "bow");
shaped("arrow", ["F", "S", "E"], { F: "flint", S: "stick", E: "feather" }, "arrow", 4);
shaped("bucket", ["I I", " I "], { I: "iron_ingot" }, "bucket");
shaped("shears", [" I", "I "], { I: "iron_ingot" }, "shears");
shapeless("flint_and_steel", ["iron_ingot", "flint"], "flint_and_steel");
shaped("tnt", ["GSG", "SGS", "GSG"], { G: "gunpowder", S: "sand" }, "tnt");

// Food
shaped("bread", ["WWW"], { W: "wheat" }, "bread");
shapeless("mushroom_stew", ["bowl", "brown_mushroom", "red_mushroom"], "mushroom_stew");
shapeless("pumpkin_pie", ["pumpkin", "sugar", "egg"], "pumpkin_pie");
shaped("golden_apple", ["GGG", "GAG", "GGG"], { G: "gold_ingot", A: "apple" }, "golden_apple");
shapeless("sugar", ["sugar_cane"], "sugar");

// Materials and blocks
shaped("paper", ["CCC"], { C: "sugar_cane" }, "paper", 3);
shapeless("book", ["paper", "paper", "paper", "leather"], "book");
shaped("lantern", ["NNN", "NTN", "NNN"], { N: "iron_nugget", T: "torch" }, "lantern");
shapeless("jack_o_lantern", ["carved_pumpkin", "torch"], "jack_o_lantern");
shaped("glass_pane", ["GGG", "GGG"], { G: "glass" }, "glass_pane", 16);
shaped("stone_bricks", ["SS", "SS"], { S: "stone" }, "stone_bricks", 4);
shaped("chiseled_stone_bricks", ["S", "S"], { S: "stone_brick_slab" }, "chiseled_stone_bricks");
shapeless("mossy_cobblestone", ["cobblestone", "moss_block"], "mossy_cobblestone");
shapeless("mossy_stone_bricks", ["stone_bricks", "moss_block"], "mossy_stone_bricks");
shaped("bricks", ["BB", "BB"], { B: "brick" }, "bricks");
shaped("sandstone", ["SS", "SS"], { S: "sand" }, "sandstone");
shaped("snow_block", ["SS", "SS"], { S: "snowball" }, "snow_block");
shaped("snow", ["SSS"], { S: "snow_block" }, "snow", 6);
shaped("clay", ["CC", "CC"], { C: "clay_ball" }, "clay");
shaped("glowstone", ["DD", "DD"], { D: "glowstone_dust" }, "glowstone");
shaped("white_wool", ["SS", "SS"], { S: "string" }, "white_wool");
shaped("coarse_dirt", ["DG", "GD"], { D: "dirt", G: "gravel" }, "coarse_dirt", 4);
shaped("polished_granite", ["SS", "SS"], { S: "granite" }, "polished_granite", 4);
shaped("polished_diorite", ["SS", "SS"], { S: "diorite" }, "polished_diorite", 4);
shaped("polished_andesite", ["SS", "SS"], { S: "andesite" }, "polished_andesite", 4);
shaped("cobblestone_slab", ["###"], { "#": "cobblestone" }, "cobblestone_slab", 6);
shaped("stone_slab", ["###"], { "#": "stone" }, "stone_slab", 6);
shaped("stone_brick_slab", ["###"], { "#": "stone_bricks" }, "stone_brick_slab", 6);
shaped("cobblestone_stairs", ["#  ", "## ", "###"], { "#": "cobblestone" }, "cobblestone_stairs", 4);
shaped("stone_brick_stairs", ["#  ", "## ", "###"], { "#": "stone_bricks" }, "stone_brick_stairs", 4);
shaped("packed_ice", ["III", "III", "III"], { I: "ice" }, "packed_ice");
shaped("melon", ["MMM", "MMM", "MMM"], { M: "melon_slice" }, "melon");
shaped("hay_block", ["WWW", "WWW", "WWW"], { W: "wheat" }, "hay_block");
shapeless("wheat_from_hay", ["hay_block"], "wheat", 9);
shapeless("bone_meal", ["bone"], "bone_meal", 3);
shaped("iron_ingot_from_nuggets", ["NNN", "NNN", "NNN"], { N: "iron_nugget" }, "iron_ingot");
shaped("gold_ingot_from_nuggets", ["NNN", "NNN", "NNN"], { N: "gold_nugget" }, "gold_ingot");
shapeless("iron_nugget", ["iron_ingot"], "iron_nugget", 9);
shapeless("gold_nugget", ["gold_ingot"], "gold_nugget", 9);

const STORAGE: [string, string][] = [
  ["iron_ingot", "iron_block"], ["gold_ingot", "gold_block"], ["diamond", "diamond_block"],
  ["emerald", "emerald_block"], ["coal", "coal_block"], ["lapis_lazuli", "lapis_block"],
  ["redstone", "redstone_block"], ["copper_ingot", "copper_block"],
];
for (const [ingot, blockName] of STORAGE) {
  shaped(blockName, ["III", "III", "III"], { I: ingot }, blockName);
  shapeless(`${ingot}_from_block`, [blockName], ingot, 9);
}

// Redstone
shaped("redstone_torch", ["R", "S"], { R: "redstone", S: "stick" }, "redstone_torch");
shaped("lever", ["S", "C"], { S: "stick", C: "cobblestone" }, "lever");
shapeless("stone_button", ["stone"], "stone_button");
shapeless("oak_button", ["#planks"], "oak_button");
shaped("stone_pressure_plate", ["SS"], { S: "stone" }, "stone_pressure_plate");
shaped("oak_pressure_plate", ["##"], { "#": "#planks" }, "oak_pressure_plate");
shaped("redstone_lamp", [" R ", "RGR", " R "], { R: "redstone", G: "glowstone" }, "redstone_lamp");
shaped("repeater", ["TRT", "SSS"], { T: "redstone_torch", R: "redstone", S: "stone" }, "repeater");
shaped("comparator", [" T ", "TQT", "SSS"], { T: "redstone_torch", Q: "quartz", S: "stone" }, "comparator");
shaped("piston", ["PPP", "CIC", "CRC"], { P: "#planks", C: "cobblestone", I: "iron_ingot", R: "redstone" }, "piston");
shaped("sticky_piston", ["S", "P"], { S: "slime_ball", P: "piston" }, "sticky_piston");
shaped("observer", ["CCC", "RRQ", "CCC"], { C: "cobblestone", R: "redstone", Q: "quartz" }, "observer");
shaped("daylight_detector", ["GGG", "QQQ", "SSS"], { G: "glass", Q: "quartz", S: "oak_slab" }, "daylight_detector");
shaped("hopper", ["I I", "ICI", " I "], { I: "iron_ingot", C: "chest" }, "hopper");
shaped("dispenser", ["CCC", "CBC", "CRC"], { C: "cobblestone", B: "bow", R: "redstone" }, "dispenser");
shaped("dropper", ["CCC", "C C", "CRC"], { C: "cobblestone", R: "redstone" }, "dropper");
shaped("iron_door", ["II", "II", "II"], { I: "iron_ingot" }, "iron_door", 3);
shaped("oak_trapdoor", ["###", "###"], { "#": "#planks" }, "oak_trapdoor", 2);
shaped("iron_trapdoor", ["II", "II"], { I: "iron_ingot" }, "iron_trapdoor");
shaped("slime_block", ["SSS", "SSS", "SSS"], { S: "slime_ball" }, "slime_block");
shapeless("slime_ball_from_block", ["slime_block"], "slime_ball", 9);

// Enchanting and brewing
shaped("enchanting_table", [" B ", "D#D", "###"], { B: "book", D: "diamond", "#": "obsidian" }, "enchanting_table");
shaped("anvil", ["BBB", " I ", "III"], { B: "iron_block", I: "iron_ingot" }, "anvil");
shaped("brewing_stand", [" R ", "CCC"], { R: "blaze_rod", C: "cobblestone" }, "brewing_stand");
shaped("cauldron", ["I I", "I I", "III"], { I: "iron_ingot" }, "cauldron");
shaped("glass_bottle", ["G G", " G "], { G: "glass" }, "glass_bottle", 3);
shapeless("blaze_powder", ["blaze_rod"], "blaze_powder", 2);
shapeless("magma_cream", ["blaze_powder", "slime_ball"], "magma_cream");
shapeless("fermented_spider_eye", ["spider_eye", "brown_mushroom", "sugar"], "fermented_spider_eye");
shaped("glistering_melon_slice", ["NNN", "NMN", "NNN"], { N: "gold_nugget", M: "melon_slice" }, "glistering_melon_slice");
shaped("golden_carrot", ["NNN", "NCN", "NNN"], { N: "gold_nugget", C: "carrot" }, "golden_carrot");

// The End
shapeless("eye_of_ender", ["ender_pearl", "blaze_powder"], "eye_of_ender");
shaped("end_crystal", ["GGG", "GEG", "GTG"], { G: "glass", E: "eye_of_ender", T: "ghast_tear" }, "end_crystal");
shaped("end_stone_bricks", ["##", "##"], { "#": "end_stone" }, "end_stone_bricks", 4);
shaped("purpur_block", ["##", "##"], { "#": "popped_chorus_fruit" }, "purpur_block", 4);
shaped("purpur_pillar", ["#", "#"], { "#": "purpur_block" }, "purpur_pillar", 2);
shaped("purpur_stairs", ["#  ", "## ", "###"], { "#": "purpur_block" }, "purpur_stairs", 4);
shaped("end_rod", ["B", "P"], { B: "blaze_rod", P: "popped_chorus_fruit" }, "end_rod", 4);
shaped("iron_bars", ["III", "III"], { I: "iron_ingot" }, "iron_bars", 16);
// Fireworks: what goes in decides what comes out, so each is matched by the grid itself (fireworks.ts).
RECIPES.push({
  id: "firework_rocket", ingredients: ["paper", "gunpowder"], result: { item: "firework_rocket", count: 3 }, small: true,
  matches: (grid) => rocketFromGrid(grid) !== null, special: rocketFromGrid,
});
RECIPES.push({
  id: "firework_star", ingredients: ["gunpowder", "#dye"], result: { item: "firework_star", count: 1 }, small: true,
  matches: (grid) => starFromGrid(grid) !== null, special: starFromGrid,
});
RECIPES.push({
  id: "firework_star_fade", ingredients: ["firework_star", "#dye"], result: { item: "firework_star", count: 1 }, small: true,
  matches: (grid) => fadeFromGrid(grid) !== null, special: fadeFromGrid,
});
// Eight arrows round a lingering potion: eight arrows of it.
RECIPES.push({
  id: "tipped_arrow", pattern: ["AAA", "APA", "AAA"], key: { A: "arrow", P: "#lingering_effect" }, result: { item: "arrow", count: 8 }, small: false,
  special: (grid) => {
    const potion = grid.map((g) => (g ? itemDef(g.id)?.name ?? "" : "")).find((n) => n.startsWith("lingering_"));
    return potion ? { id: itemByName(`tipped_arrow_${potion.slice("lingering_".length)}`).id, count: 8 } : null;
  },
});

// Village work stations
shaped("composter", ["S S", "S S", "SSS"], { S: "oak_slab" }, "composter");
shaped("lectern", ["SSS", " B ", " S "], { S: "oak_slab", B: "bookshelf" }, "lectern");
shaped("smoker", [" L ", "LFL", " L "], { L: "#logs", F: "furnace" }, "smoker");
shaped("barrel", ["PSP", "P P", "PSP"], { P: "#planks", S: "oak_slab" }, "barrel");
shaped("fletching_table", ["FF", "PP", "PP"], { F: "flint", P: "#planks" }, "fletching_table");
shaped("loom", ["SS", "PP"], { S: "string", P: "#planks" }, "loom");
shaped("stonecutter", [" I ", "SSS"], { I: "iron_ingot", S: "stone" }, "stonecutter");
shaped("smithing_table", ["II", "PP", "PP"], { I: "iron_ingot", P: "#planks" }, "smithing_table");

// Rails and vehicles
shaped("rail", ["I I", "ISI", "I I"], { I: "iron_ingot", S: "stick" }, "rail", 16);
shaped("powered_rail", ["G G", "GSG", "GRG"], { G: "gold_ingot", S: "stick", R: "redstone" }, "powered_rail", 6);
shaped("detector_rail", ["I I", "IPI", "IRI"], { I: "iron_ingot", P: "stone_pressure_plate", R: "redstone" }, "detector_rail", 6);
shaped("activator_rail", ["ISI", "ITI", "ISI"], { I: "iron_ingot", S: "stick", T: "redstone_torch" }, "activator_rail", 6);
shaped("minecart", ["I I", "III"], { I: "iron_ingot" }, "minecart");
shapeless("tnt_minecart", ["tnt", "minecart"], "tnt_minecart");
for (const wood of ["oak", "spruce", "birch", "jungle", "acacia"]) {
  shaped(`${wood}_boat`, ["P P", "PPP"], { P: `${wood}_planks` }, `${wood}_boat`);
}

// Dyes and colour
shapeless("yellow_dye", ["dandelion"], "yellow_dye");
shapeless("red_dye", ["poppy"], "red_dye");
shapeless("red_dye_tulip", ["red_tulip"], "red_dye");
shapeless("blue_dye", ["cornflower"], "blue_dye");
shapeless("blue_dye_lapis", ["lapis_lazuli"], "blue_dye");
shapeless("white_dye", ["bone_meal"], "white_dye");
shapeless("white_dye_lily", ["lily_of_the_valley"], "white_dye");
shapeless("orange_dye", ["red_dye", "yellow_dye"], "orange_dye", 2);
shapeless("purple_dye", ["red_dye", "blue_dye"], "purple_dye", 2);
for (const dye of DYES) {
  const wool = `${dye}_wool`;
  if (dye !== "white" && itemDefOrNull(wool)) shapeless(`${dye}_wool_dyed`, [`${dye}_dye`, "white_wool"], wool);
}

function itemDefOrNull(name: string): boolean {
  try { itemByName(name); return true; } catch { return false; }
}

// The End.
shaped("shulker_box", ["S", "C", "S"], { S: "shulker_shell", C: "chest" }, "shulker_box");
shaped("purpur_slab", ["###"], { "#": "purpur_block" }, "purpur_slab", 6);
shaped("item_frame", ["SSS", "SLS", "SSS"], { S: "stick", L: "leather" }, "item_frame");
// A lucky block: gold round a dropper, as the mod has it.
shaped("lucky_block", ["GGG", "GDG", "GGG"], { G: "gold_ingot", D: "dropper" }, "lucky_block");

// Primal (after ARK): the kit for knocking a creature out, keeping it under, taming it and riding it.
shapeless("narcotic", ["narcoberry", "narcoberry", "narcoberry", "narcoberry", "narcoberry", "rotten_flesh"], "narcotic");
shapeless("tranq_arrow", ["arrow", "arrow", "narcotic"], "tranq_arrow", 2);
shaped("wooden_club", ["L", "L", "S"], { L: "#logs", S: "stick" }, "wooden_club");
shapeless("kibble", ["egg", "cooked_meat", "mejoberry", "mejoberry", "wheat"], "kibble", 2);
shapeless("kibble_beef", ["egg", "cooked_beef", "mejoberry", "mejoberry", "wheat"], "kibble", 2);
shaped("saddle", ["LLL", "LSL"], { L: "leather", S: "string" }, "saddle");
shaped("heavy_saddle", ["LLL", "ISI"], { L: "leather", I: "iron_ingot", S: "string" }, "heavy_saddle");
shaped("flyer_saddle", ["LLL", "FSF"], { L: "leather", F: "feather", S: "string" }, "flyer_saddle");

// Dead Zone: first aid from what a survivor finds, and rounds for the guns they find.
shapeless("bandage", ["white_wool", "string"], "bandage", 3);
shapeless("bandage_paper", ["paper", "paper", "string"], "bandage", 2);
shapeless("splint", ["stick", "stick", "string"], "splint");

// The county: lumber and nails, making do with what is in the house.
shapeless("plank", ["#planks"], "plank", 2);
shapeless("spiked_bat", ["baseball_bat", "nails", "nails"], "spiked_bat");
shapeless("rag", ["bed_sheet"], "rag", 4);
shapeless("bandage_rag", ["rag", "rag"], "bandage");
shapeless("sterile_bandage", ["bandage", "bandage", "bandage", "disinfectant"], "sterile_bandage", 3);
shapeless("sheet_rope", ["bed_sheet", "bed_sheet"], "sheet_rope");
shapeless("spear", ["plank", "kitchen_knife"], "spear");
shapeless("sandwich_ham", ["bread", "deli_ham"], "sandwich");
shapeless("sandwich_cheese", ["bread", "cheese"], "sandwich");
shapeless("sandwich_pb", ["bread", "peanut_butter"], "sandwich");
shapeless("barricade", ["plank", "plank", "nails"], "barricade");
shapeless("nails", ["scrap_metal"], "nails", 4);
shapeless("scrap_metal", ["empty_can", "empty_can", "empty_can", "empty_can"], "scrap_metal");
shaped("county_crate", ["###", "#N#", "###"], { "#": "plank", N: "nails" }, "crate");
shaped("county_workbench", ["###", "P P"], { "#": "plank", P: "#planks" }, "workbench");
// Critters: orbs from iron and redstone (the better ones with gold and diamond), medicine from what grows, and a
// healing station for a base of one's own.
shaped("capture_orb", [" I ", "IRI", " I "], { I: "iron_nugget", R: "redstone" }, "capture_orb", 2);
shaped("silver_orb", [" I ", "IRI", " I "], { I: "iron_ingot", R: "redstone" }, "silver_orb", 2);
shaped("gold_orb", [" G ", "GRG", " G "], { G: "gold_ingot", R: "redstone" }, "gold_orb", 2);
shapeless("herbal_tonic", ["glass_bottle", "wheat_seeds", "sugar"], "herbal_tonic");
shapeless("strong_tonic", ["herbal_tonic", "glistering_melon_slice"], "strong_tonic");
shapeless("cure_all", ["glass_bottle", "sugar", "brown_mushroom", "red_mushroom"], "cure_all");
shapeless("revival_herb", ["golden_carrot", "bone_meal"], "revival_herb");
shapeless("honey_cake", ["wheat", "sugar", "egg", "apple"], "honey_cake");
shaped("healing_station", ["GGG", "IDI", "III"], { G: "glass", I: "iron_ingot", D: "glowstone_dust" }, "healing_station");
shapeless("pistol_ammo", ["iron_nugget", "iron_nugget", "gunpowder"], "pistol_ammo", 8);
shapeless("rifle_ammo", ["iron_ingot", "gunpowder", "gunpowder"], "rifle_ammo", 6);
shapeless("shotgun_shells", ["iron_nugget", "gunpowder", "paper"], "shotgun_shells", 4);
shapeless("canteen", ["leather", "iron_ingot"], "canteen");
// A cooking pot: an iron pot with brick handles, a wooden spoon (shovel) to stir it.
shaped("cooking_pot", ["BSB", "I I", "III"], { B: "brick", S: "wooden_shovel", I: "iron_ingot" }, "cooking_pot");
// A backpack: leather round a chest, a string strap.
shaped("backpack", ["LSL", "LCL", "LLL"], { L: "leather", S: "string", C: "chest" }, "backpack");
// A waystone: a stone-brick pillar on obsidian, an ender pearl at its heart for the travelling.
shaped("waystone", [" B ", "BPB", "OOO"], { B: "stone_bricks", P: "ender_pearl", O: "obsidian" }, "waystone");
// A box and a dye: the same box, same contents, new colour.
RECIPES.push({
  id: "shulker_box_dyed", ingredients: ["shulker_box", "#dye"], result: { item: "shulker_box", count: 1 }, small: true,
  special: (grid) => {
    const box = grid.find((s) => s?.id === B.SHULKER_BOX);
    const dye = grid.find((s) => s && s.id !== B.SHULKER_BOX);
    if (!box || !dye) return null;
    const color = (DYES as readonly string[]).indexOf(itemDef(dye.id)?.name.replace(/_dye$/, "") ?? "") + 1;
    return color > 0 ? { ...box, count: 1, color } : null;
  },
});

export function allRecipes(): readonly Recipe[] {
  return RECIPES;
}

// ---- matching -------------------------------------------------------------------

/** Grid as item ids (or 0) in rows of `width`. */
function trim(grid: Slot[], width: number): { rows: number[][] } {
  const height = grid.length / width;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  const rows: number[][] = [];
  for (let y = minY; y <= maxY; y++) {
    const row: number[] = [];
    for (let x = minX; x <= maxX; x++) row.push(grid[y * width + x]?.id ?? 0);
    rows.push(row);
  }
  return { rows };
}

function matchesShaped(r: Recipe, rows: number[][], mirror: boolean): boolean {
  const pattern = r.pattern!;
  if (rows.length !== pattern.length) return false;
  const w = Math.max(...pattern.map((p) => p.length));
  for (let y = 0; y < pattern.length; y++) {
    if (rows[y].length !== w) return false;
    for (let x = 0; x < w; x++) {
      const ch = (pattern[y][mirror ? w - 1 - x : x] ?? " ");
      const have = rows[y][x];
      if (ch === " ") { if (have !== 0) return false; continue; }
      if (!have || !ingredientIds(r.key![ch]).includes(have)) return false;
    }
  }
  return true;
}

function matchesShapeless(r: Recipe, grid: Slot[]): boolean {
  const have = grid.filter(Boolean).map((s) => s!.id);
  const need = [...r.ingredients!];
  if (have.length !== need.length) return false;
  const used = new Array(need.length).fill(false);
  for (const id of have) {
    const i = need.findIndex((ing, k) => !used[k] && ingredientIds(ing).includes(id));
    if (i < 0) return false;
    used[i] = true;
  }
  return true;
}

/** The recipe the grid currently makes, if any. */
export function matchRecipe(grid: Slot[], width: number): Recipe | null {
  if (!grid.some(Boolean)) return null;
  const { rows } = trim(grid, width);
  const small = width === 2;
  for (const r of RECIPES) {
    if (small && !r.small) continue;
    if (r.matches) {
      if (r.matches(grid)) return r;
      continue;
    }
    if (r.pattern) {
      if (matchesShaped(r, rows, false) || matchesShaped(r, rows, true)) return r;
    } else if (matchesShapeless(r, grid)) return r;
  }
  return null;
}

/** What a recipe makes — from the grid itself when the result carries something over (see Recipe.special). */
export function recipeResult(r: Recipe, grid?: Slot[]): ItemStack {
  if (r.special && grid) {
    const made = r.special(grid);
    if (made) return made;
  }
  return { id: itemByName(r.result.item).id, count: r.result.count };
}

/** Takes one of each ingredient from the grid after crafting, leaving containers (buckets, bowls) behind. */
export function consumeGrid(grid: Slot[]): Slot[] {
  return grid.map((s) => {
    if (!s) return null;
    const def = itemDef(s.id);
    if (s.count > 1) return { ...s, count: s.count - 1 };
    if (def?.name === "water_bucket" || def?.name === "lava_bucket" || def?.name === "milk_bucket") return { id: itemByName("bucket").id, count: 1 };
    return null;
  });
}

/** Ingredients a recipe needs, as groups of acceptable ids with counts — for the recipe book. */
export function recipeNeeds(r: Recipe): { ids: number[]; count: number }[] {
  const list: Ingredient[] = r.pattern
    ? r.pattern.join("").split("").filter((c) => c !== " ").map((c) => r.key![c])
    : r.ingredients!;
  const groups = new Map<string, { ids: number[]; count: number }>();
  for (const ing of list) {
    const g = groups.get(ing);
    if (g) g.count++;
    else groups.set(ing, { ids: ingredientIds(ing), count: 1 });
  }
  return [...groups.values()];
}

/** Whether an inventory (item counts by id) holds enough to craft this once. */
export function canAfford(r: Recipe, counts: Map<number, number>): boolean {
  const left = new Map(counts);
  for (const need of recipeNeeds(r)) {
    let n = need.count;
    for (const id of need.ids) {
      const have = left.get(id) ?? 0;
      const take = Math.min(have, n);
      left.set(id, have - take);
      n -= take;
      if (n === 0) break;
    }
    if (n > 0) return false;
  }
  return true;
}

/**
 * Lays a recipe into a grid from an inventory's items, the way clicking a
 * recipe in the book fills the table. Returns the grid, or null if short.
 */
export function layout(r: Recipe, width: number, take: (ids: number[]) => number | null): Slot[] | null {
  const grid: Slot[] = new Array(width * width).fill(null);
  if (r.pattern) {
    if (r.pattern.length > width || r.pattern.some((row) => row.length > width)) return null;
    for (let y = 0; y < r.pattern.length; y++) {
      for (let x = 0; x < r.pattern[y].length; x++) {
        const ch = r.pattern[y][x];
        if (ch === " ") continue;
        const id = take(ingredientIds(r.key![ch]));
        if (id === null) return null;
        grid[y * width + x] = { id, count: 1 };
      }
    }
  } else {
    if (r.ingredients!.length > width * width) return null;
    r.ingredients!.forEach((ing, i) => {
      const id = take(ingredientIds(ing));
      if (id !== null) grid[i] = { id, count: 1 };
    });
    if (grid.filter(Boolean).length !== r.ingredients!.length) return null;
  }
  return grid;
}

// The Nether
shaped("nether_bricks", ["##", "##"], { "#": "nether_brick" }, "nether_bricks");
shaped("nether_brick_fence", ["#N#", "#N#"], { "#": "nether_bricks", N: "nether_brick" }, "nether_brick_fence", 6);
shaped("nether_brick_stairs", ["#  ", "## ", "###"], { "#": "nether_bricks" }, "nether_brick_stairs", 4);
shaped("quartz_block", ["##", "##"], { "#": "quartz" }, "quartz_block");
shaped("magma_block", ["##", "##"], { "#": "magma_cream" }, "magma_block");
shaped("nether_wart_block", ["###", "###", "###"], { "#": "nether_wart" }, "nether_wart_block");
shaped("bone_block", ["###", "###", "###"], { "#": "bone_meal" }, "bone_block");
// Space: iron for the hull, glass for the window, an eye of ender to steer by, rockets to go up on.
shaped("starship", [" G ", "IEI", "IRI"], { G: "glass", I: "iron_block", E: "eye_of_ender", R: "firework_rocket" }, "starship");
shapeless("bone_meal_from_block", ["bone_block"], "bone_meal", 9);
shapeless("netherite_ingot", ["netherite_scrap", "netherite_scrap", "netherite_scrap", "netherite_scrap", "gold_ingot", "gold_ingot", "gold_ingot", "gold_ingot"], "netherite_ingot");
shapeless("fire_charge", ["gunpowder", "blaze_powder", "#coals"], "fire_charge", 3);

// ---- smelting ----------------------------------------------------------------------

export interface Smelt {
  input: Ingredient;
  output: string;
  xp: number;
}

const SMELTING: Smelt[] = [
  { input: "raw_iron", output: "iron_ingot", xp: 0.7 },
  { input: "iron_ore", output: "iron_ingot", xp: 0.7 },
  { input: "deepslate_iron_ore", output: "iron_ingot", xp: 0.7 },
  { input: "raw_gold", output: "gold_ingot", xp: 1 },
  { input: "gold_ore", output: "gold_ingot", xp: 1 },
  { input: "deepslate_gold_ore", output: "gold_ingot", xp: 1 },
  { input: "raw_copper", output: "copper_ingot", xp: 0.7 },
  { input: "copper_ore", output: "copper_ingot", xp: 0.7 },
  { input: "sand", output: "glass", xp: 0.1 },
  { input: "red_sand", output: "glass", xp: 0.1 },
  { input: "cobblestone", output: "stone", xp: 0.1 },
  { input: "stone", output: "smooth_stone", xp: 0.1 },
  { input: "cobbled_deepslate", output: "deepslate", xp: 0.1 },
  { input: "stone_bricks", output: "cracked_stone_bricks", xp: 0.1 },
  { input: "clay_ball", output: "brick", xp: 0.3 },
  { input: "clay", output: "terracotta", xp: 0.35 },
  { input: "#logs", output: "charcoal", xp: 0.15 },
  { input: "cactus", output: "green_dye", xp: 1 },
  { input: "porkchop", output: "cooked_porkchop", xp: 0.35 },
  { input: "beef", output: "cooked_beef", xp: 0.35 },
  { input: "venison", output: "cooked_venison", xp: 0.35 },
  { input: "raw_meat", output: "cooked_meat", xp: 0.35 },
  { input: "chicken", output: "cooked_chicken", xp: 0.35 },
  { input: "mutton", output: "cooked_mutton", xp: 0.35 },
  { input: "potato", output: "baked_potato", xp: 0.35 },
  { input: "coal_ore", output: "coal", xp: 0.1 },
  { input: "diamond_ore", output: "diamond", xp: 1 },
  { input: "lapis_ore", output: "lapis_lazuli", xp: 0.2 },
  { input: "redstone_ore", output: "redstone", xp: 0.7 },
  { input: "emerald_ore", output: "emerald", xp: 1 },
  { input: "netherrack", output: "nether_brick", xp: 0.1 },
  { input: "nether_quartz_ore", output: "quartz", xp: 0.2 },
  { input: "nether_gold_ore", output: "gold_ingot", xp: 1 },
  { input: "ancient_debris", output: "netherite_scrap", xp: 2 },
  { input: "chorus_fruit", output: "popped_chorus_fruit", xp: 0.1 },
].filter((s) => itemDefOrNull(s.output) && (s.input.startsWith("#") || itemDefOrNull(s.input)));

/** Every smelting recipe, for the recipe viewer. */
export function allSmelting(): readonly Smelt[] {
  return SMELTING;
}

export function smeltResult(id: number): Smelt | null {
  for (const s of SMELTING) if (ingredientIds(s.input).includes(id)) return s;
  return null;
}

export function fuelTicks(id: number): number {
  return itemDef(id)?.fuel ?? 0;
}

export const COOK_TICKS = 200;

