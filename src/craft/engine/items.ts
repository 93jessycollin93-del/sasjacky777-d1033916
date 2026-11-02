/**
 * The item registry.
 *
 * Every placeable block is also an item with the same id (0-255). Items that
 * are not blocks start at 256. Like the block list, ids here are saved in
 * inventories and chests and sent to other players, so the list is
 * append-only.
 *
 * Numbers follow the original game's published values (tool speeds and
 * durability, armour points, food and saturation) so the game feels the way a
 * player's hands already expect: a stone pickaxe takes as long on iron ore as
 * they remember, and a steak fills the same number of shanks.
 */
import { allBlocks, B, block, type Drop, type ToolType } from "./blocks";
import { POTIONS } from "./potions";
import type { Burst, Rocket } from "./fireworks";
import { defineCountyItems } from "./countyItems";
import { FIRST_WIDE_BLOCK } from "./countyBlocks";

export interface ToolInfo {
  type: ToolType;
  /** 0 wood/gold, 1 stone, 2 iron, 3 diamond. */
  tier: number;
  /** Mining speed multiplier against blocks this tool is for. */
  speed: number;
}

export interface FoodInfo {
  hunger: number;
  saturation: number;
  alwaysEdible?: boolean;
  /** Side effect: [effect, seconds, chance]. */
  effect?: [StatusEffect, number, number];
  /** Item left behind (the bowl after stew). */
  remainder?: string;
}

export type StatusEffect =
  | "regeneration" | "hunger" | "poison" | "absorption" | "speed" | "night_vision"
  | "slowness" | "strength" | "weakness" | "fire_resistance" | "invisibility" | "water_breathing"
  /** From a wither skeleton's blade: like poison, but it can kill. */
  | "wither"
  /** From a shulker's bullet: carried slowly upward, whatever is underfoot. */
  | "levitation"
  /** A dilophosaur's spit: the world closes in to a few blocks' fog. */
  | "blindness"
  /** Instant effects: applied once, never listed. */
  | "instant_health" | "instant_damage";

export interface ArmorInfo {
  /** 0 head, 1 chest, 2 legs, 3 feet. */
  slot: 0 | 1 | 2 | 3;
  points: number;
  toughness: number;
  material: "leather" | "iron" | "golden" | "diamond" | "netherite" | "elytra";
}

export type ItemUse =
  | "bucket" | "water_bucket" | "lava_bucket" | "milk_bucket" | "bow" | "flint_and_steel"
  | "bone_meal" | "throw" | "shears" | "hoe" | "plant"
  /** Drunk like milk (potions); thrown to burst (splash potions, bottles o' enchanting); filled at water (glass bottles). */
  | "drink" | "splash" | "xp_bottle" | "bottle"
  /** Put down on water or rails to ride. */
  | "boat" | "minecart"
  /** Thrown: an ender pearl carries its thrower; an eye of ender flies toward the stronghold (or fills a frame). */
  | "pearl" | "ender_eye"
  /** Set on obsidian or bedrock (end crystals); fired while gliding for a burst of speed (rockets). */
  | "end_crystal" | "rocket"
  /** Hung on the face of a block. */
  | "item_frame"
  /** Treats a wound (engine/vitals.ts): a bandage stops bleeding, a splint sets a leg, antibiotics end sickness. */
  | "treat"
  /** Fires (engine/guns.ts), spending a round of its ammunition. */
  | "gun"
  /** Opened in the hand: a satchel of 27 slots carried with you. */
  | "backpack"
  /** Critters: an orb starts a battle with the wild critter it is aimed at (and catches, thrown in one); a medicine opens the party to give it. */
  | "orb" | "critter_medicine"
  /** Launches its holder into space (space/): the ship waits in orbit above wherever they stand. */
  | "launch"
  /** Read (the county): a skill book or magazine teaches, anything else passes the time. */
  | "read";

export type Category = "building" | "colored" | "natural" | "functional" | "redstone" | "tools" | "combat" | "food" | "ingredients";

export interface ItemDef {
  id: number;
  name: string;
  displayName: string;
  maxStack: number;
  /** The block this item places, if any. */
  places?: number;
  /** Texture name drawn flat as the icon; undefined means render the block as a cube. */
  icon?: string;
  tool?: ToolInfo;
  /** Melee damage in half-hearts. */
  damage: number;
  /** Swings per second at full strength. */
  attackSpeed: number;
  durability?: number;
  food?: FoodInfo;
  armor?: ArmorInfo;
  /** Burn time in ticks when used as furnace fuel. */
  fuel?: number;
  use?: ItemUse;
  category: Category;
  hidden?: boolean;
  /** Dropped in lava or fire it floats and survives (netherite). */
  fireproof?: boolean;
  /** A drink's container once it is drunk: an item name, or null for nothing left (a carton, crushed). Absent is a glass bottle. */
  empty?: string | null;
}

const ITEMS: ItemDef[] = [];
const BY_NAME = new Map<string, ItemDef>();

function add(def: Partial<ItemDef> & { id: number; name: string; displayName: string }): ItemDef {
  if (ITEMS[def.id]) throw new Error(`item id ${def.id} used twice (${ITEMS[def.id].name}, ${def.name})`);
  // A second item by the same name would quietly take the name over, and every table naming it would get the wrong one.
  if (BY_NAME.has(def.name)) throw new Error(`item name ${def.name} used twice (ids ${BY_NAME.get(def.name)!.id} and ${def.id})`);
  const full: ItemDef = {
    maxStack: 64,
    damage: 1,
    attackSpeed: 4,
    category: "ingredients",
    icon: def.name,
    ...def,
  };
  ITEMS[def.id] = full;
  BY_NAME.set(full.name, full);
  return full;
}

// ---- block items -----------------------------------------------------------

/** Blocks whose item is drawn flat, the way they read in a hand, not as a cube. */
const FLAT_BLOCK_ICONS: Record<string, string> = {
  torch: "torch", ladder: "ladder", lantern: "lantern_item", cobweb: "cobweb", lily_pad: "lily_pad",
  glass_pane: "glass", redstone_torch: "redstone_torch", lever: "lever_item", stone_button: "button_item_stone",
  oak_button: "button_item_oak", stone_pressure_plate: "plate_item_stone", oak_pressure_plate: "plate_item_oak",
  repeater: "repeater", comparator: "comparator", hopper: "hopper_item", daylight_detector: "daylight_detector_item",
  brewing_stand: "brewing_stand_item", cauldron: "cauldron_item",
  rail: "rail", powered_rail: "powered_rail", detector_rail: "detector_rail", activator_rail: "activator_rail",
  end_rod: "end_rod_item", iron_bars: "iron_bars",
};
const REDSTONE = new Set([
  "redstone_torch", "lever", "stone_button", "oak_button", "stone_pressure_plate", "oak_pressure_plate", "redstone_lamp",
  "repeater", "comparator", "piston", "sticky_piston", "observer", "daylight_detector", "hopper", "dispenser", "dropper",
  "oak_trapdoor", "iron_trapdoor", "slime_block", "redstone_block", "tnt", "note_block",
  "rail", "powered_rail", "detector_rail", "activator_rail",
]);

const COLORED = /_wool$|terracotta$/;
const NATURAL = new Set([
  "grass_block", "dirt", "stone", "sand", "gravel", "red_sand", "clay", "snow_block", "snow", "ice",
  "packed_ice", "podzol", "coarse_dirt", "mud", "moss_block", "deepslate", "granite", "diorite",
  "andesite", "calcite", "tuff", "bedrock", "obsidian", "pumpkin", "melon", "cactus", "sugar_cane",
  "dead_bush", "short_grass", "fern", "brown_mushroom", "red_mushroom", "lily_pad", "cobweb",
  "amethyst_block",
  "netherrack", "soul_sand", "soul_soil", "basalt", "blackstone", "magma_block", "crimson_nylium", "warped_nylium",
  "crimson_stem", "warped_stem", "nether_wart_block", "warped_wart_block", "shroomlight", "bone_block", "ancient_debris",
  "end_stone", "chorus_plant", "chorus_flower", "dragon_egg",
]);
const FUNCTIONAL = new Set([
  "crafting_table", "furnace", "chest", "torch", "lantern", "ladder", "tnt", "bookshelf", "glowstone",
  "sea_lantern", "jack_o_lantern", "carved_pumpkin", "note_block", "hay_block", "oak_fence", "glass_pane",
  "enchanting_table", "anvil", "chipped_anvil", "damaged_anvil", "brewing_stand", "cauldron",
  "composter", "lectern", "smoker", "barrel", "fletching_table", "loom", "stonecutter", "smithing_table", "bell",
  "end_rod", "end_portal_frame", "iron_bars", "waystone", "cooking_pot", "lucky_block", "healing_station",
]);

for (const def of allBlocks()) {
  if (def.hidden || def.id === 0) continue;
  const flat = FLAT_BLOCK_ICONS[def.name] ?? (def.shape === "cross" ? def.textures.side : undefined);
  const woodBurns = def.material === "wood" && def.flammable;
  // The county's furniture and fittings are for using or setting up; its siding, flooring and roofs are for building.
  const countyFitting = def.id >= FIRST_WIDE_BLOCK && (def.shape === "boxes" || def.interact !== undefined);
  const category: Category = countyFitting ? "functional" : REDSTONE.has(def.name)
    ? "redstone"
    : COLORED.test(def.name)
    ? "colored"
    : NATURAL.has(def.name) || /_ore$|_log$|_leaves$|_sapling$/.test(def.name) || def.shape === "cross"
      ? "natural"
      : FUNCTIONAL.has(def.name)
        ? "functional"
        : "building";
  add({
    id: def.id,
    name: def.name,
    displayName: def.displayName,
    places: def.id,
    icon: flat,
    fuel: def.id === B.COAL_BLOCK ? 16000 : def.name.endsWith("_sapling") ? 100 : def.name.endsWith("_wool") ? 100
      : woodBurns || def.id === B.CRAFTING_TABLE || def.id === B.BOOKSHELF || def.id === B.CHEST || def.id === B.OAK_SLAB
        ? (def.id === B.OAK_SLAB ? 150 : 300) : undefined,
    category,
  });
}

// A box carries a whole inventory; two never share a slot.
ITEMS[B.SHULKER_BOX].maxStack = 1;

// ---- materials ---------------------------------------------------------------

let next = 256;
const item = (name: string, displayName: string, opts: Partial<ItemDef> = {}) =>
  add({ id: next++, name, displayName, ...opts });

item("stick", "Stick", { fuel: 100 });
item("coal", "Coal", { fuel: 1600 });
item("charcoal", "Charcoal", { fuel: 1600 });
item("raw_iron", "Raw Iron");
item("raw_gold", "Raw Gold");
item("raw_copper", "Raw Copper");
item("iron_ingot", "Iron Ingot");
item("gold_ingot", "Gold Ingot");
item("copper_ingot", "Copper Ingot");
item("diamond", "Diamond");
item("emerald", "Emerald");
item("lapis_lazuli", "Lapis Lazuli");
item("redstone", "Redstone Dust", { places: B.REDSTONE_WIRE, category: "redstone" });
item("flint", "Flint");
item("feather", "Feather");
item("string", "String");
item("bone", "Bone");
item("bone_meal", "Bone Meal", { use: "bone_meal" });
item("gunpowder", "Gunpowder");
item("leather", "Leather");
item("clay_ball", "Clay Ball");
item("brick", "Brick");
item("paper", "Paper");
item("book", "Book");
item("sugar", "Sugar");
item("wheat", "Wheat");
item("wheat_seeds", "Wheat Seeds", { places: B.WHEAT, use: "plant" });
item("egg", "Egg", { maxStack: 16, use: "throw" });
item("snowball", "Snowball", { maxStack: 16, use: "throw" });
item("rotten_flesh", "Rotten Flesh", { category: "food", food: { hunger: 4, saturation: 0.8, effect: ["hunger", 30, 0.8] } });
item("spider_eye", "Spider Eye", { category: "food", food: { hunger: 2, saturation: 3.2, effect: ["poison", 5, 1] } });
item("glowstone_dust", "Glowstone Dust");

// ---- food ----------------------------------------------------------------------

const food = (name: string, displayName: string, hunger: number, saturation: number, extra: Partial<FoodInfo> = {}, opts: Partial<ItemDef> = {}) =>
  item(name, displayName, { category: "food", food: { hunger, saturation, ...extra }, ...opts });

food("apple", "Apple", 4, 2.4);
food("golden_apple", "Golden Apple", 4, 9.6, { alwaysEdible: true, effect: ["regeneration", 5, 1] });
food("bread", "Bread", 5, 6);
food("porkchop", "Raw Porkchop", 3, 1.8);
food("cooked_porkchop", "Cooked Porkchop", 8, 12.8);
food("beef", "Raw Beef", 3, 1.8);
food("cooked_beef", "Steak", 8, 12.8);
food("venison", "Raw Venison", 3, 1.8);
food("cooked_venison", "Cooked Venison", 8, 12.8);
food("chicken", "Raw Chicken", 2, 1.2, { effect: ["hunger", 30, 0.3] });
food("cooked_chicken", "Cooked Chicken", 6, 7.2);
food("mutton", "Raw Mutton", 2, 1.2);
food("cooked_mutton", "Cooked Mutton", 6, 9.6);
food("carrot", "Carrot", 3, 3.6, {}, { places: B.CARROTS, use: "plant" });
food("potato", "Potato", 1, 0.6, {}, { places: B.POTATOES, use: "plant" });
food("baked_potato", "Baked Potato", 5, 6);
food("melon_slice", "Melon Slice", 2, 1.2);
food("pumpkin_pie", "Pumpkin Pie", 8, 4.8);
item("bowl", "Bowl", { fuel: 100 });
food("mushroom_stew", "Mushroom Stew", 6, 7.2, { remainder: "bowl" }, { maxStack: 1 });
// Meals from the cooking pot (engine/cooking.ts): more than their parts, and the bowl comes back.
food("vegetable_soup", "Vegetable Soup", 10, 12, { remainder: "bowl" }, { maxStack: 16 });
food("beef_stew", "Beef Stew", 12, 14.4, { remainder: "bowl" }, { maxStack: 16 });
food("chicken_soup", "Chicken Soup", 11, 13, { remainder: "bowl", effect: ["regeneration", 8, 1] }, { maxStack: 16 });
food("venison_stew", "Venison Stew", 12, 14.4, { remainder: "bowl" }, { maxStack: 16 });
food("pumpkin_soup", "Pumpkin Soup", 10, 12, { remainder: "bowl" }, { maxStack: 16 });
food("hearty_stew", "Hearty Stew", 16, 19.2, { remainder: "bowl", effect: ["regeneration", 20, 1] }, { maxStack: 16 });

// ---- functional ------------------------------------------------------------------

item("bucket", "Bucket", { maxStack: 16, use: "bucket", category: "tools" });
item("water_bucket", "Water Bucket", { maxStack: 1, use: "water_bucket", category: "tools" });
item("lava_bucket", "Lava Bucket", { maxStack: 1, use: "lava_bucket", fuel: 20000, category: "tools" });
item("milk_bucket", "Milk Bucket", { maxStack: 1, use: "milk_bucket", category: "food" });
item("bow", "Bow", { maxStack: 1, use: "bow", durability: 384, category: "combat" });
item("arrow", "Arrow", { category: "combat" });
item("flint_and_steel", "Flint and Steel", { maxStack: 1, use: "flint_and_steel", durability: 64, category: "tools" });
item("shears", "Shears", { maxStack: 1, use: "shears", durability: 238, tool: { type: "shears", tier: 0, speed: 1.5 }, category: "tools" });
item("oak_door", "Oak Door", { places: B.OAK_DOOR, category: "building", fuel: 200 });
item("red_bed", "Red Bed", { places: B.RED_BED, maxStack: 1, category: "functional" });

export const DYES = ["white", "red", "yellow", "blue", "green", "orange", "purple", "black"] as const;
for (const dye of DYES) {
  item(`${dye}_dye`, `${dye[0].toUpperCase()}${dye.slice(1)} Dye`, { category: "ingredients" });
}

item("iron_nugget", "Iron Nugget");
item("gold_nugget", "Gold Nugget");
if (next > 340) throw new Error("item ids before the tool block overflowed into it");

// ---- tools -------------------------------------------------------------------------

export const TIERS = [
  { key: "wooden", name: "Wooden", tier: 0, speed: 2, durability: 59, bonus: 0 },
  { key: "stone", name: "Stone", tier: 1, speed: 4, durability: 131, bonus: 1 },
  { key: "iron", name: "Iron", tier: 2, speed: 6, durability: 250, bonus: 2 },
  { key: "golden", name: "Golden", tier: 0, speed: 12, durability: 32, bonus: 0 },
  { key: "diamond", name: "Diamond", tier: 3, speed: 8, durability: 1561, bonus: 3 },
] as const;

next = 340;
const SWORD_DAMAGE = [4, 5, 6, 4, 7];
const AXE_DAMAGE = [7, 9, 9, 7, 9];
const AXE_SPEED = [0.8, 0.8, 0.9, 1, 1];
TIERS.forEach((t, i) => {
  const fuel = t.key === "wooden" ? 200 : undefined;
  item(`${t.key}_sword`, `${t.name} Sword`, {
    maxStack: 1, durability: t.durability, damage: SWORD_DAMAGE[i], attackSpeed: 1.6, fuel, category: "combat",
    tool: { type: "sword", tier: t.tier, speed: 1.5 },
  });
  item(`${t.key}_shovel`, `${t.name} Shovel`, {
    maxStack: 1, durability: t.durability, damage: 2.5 + t.bonus, attackSpeed: 1, fuel, category: "tools",
    tool: { type: "shovel", tier: t.tier, speed: t.speed },
  });
  item(`${t.key}_pickaxe`, `${t.name} Pickaxe`, {
    maxStack: 1, durability: t.durability, damage: 2 + t.bonus, attackSpeed: 1.2, fuel, category: "tools",
    tool: { type: "pickaxe", tier: t.tier, speed: t.speed },
  });
  item(`${t.key}_axe`, `${t.name} Axe`, {
    maxStack: 1, durability: t.durability, damage: AXE_DAMAGE[i], attackSpeed: AXE_SPEED[i], fuel, category: "tools",
    tool: { type: "axe", tier: t.tier, speed: t.speed },
  });
  item(`${t.key}_hoe`, `${t.name} Hoe`, {
    maxStack: 1, durability: t.durability, damage: 1, attackSpeed: 1 + t.bonus, fuel, use: "hoe", category: "tools",
    tool: { type: "hoe", tier: t.tier, speed: t.speed },
  });
});

// Netherite is never crafted from scratch: a smithing table turns diamond gear into it,
// enchantments and all. It fits the five ids left after the crafted tiers.
const NETHERITE = { tier: 4, speed: 9, durability: 2031, bonus: 4 };
item("netherite_sword", "Netherite Sword", {
  maxStack: 1, durability: NETHERITE.durability, damage: 8, attackSpeed: 1.6, category: "combat", fireproof: true,
  tool: { type: "sword", tier: NETHERITE.tier, speed: 1.5 },
});
for (const [type, name, damage, speed] of [
  ["shovel", "Shovel", 6.5, 1], ["pickaxe", "Pickaxe", 6, 1.2], ["axe", "Axe", 10, 1], ["hoe", "Hoe", 1, 4],
] as const) {
  item(`netherite_${type}`, `Netherite ${name}`, {
    maxStack: 1, durability: NETHERITE.durability, damage, attackSpeed: speed, category: "tools", fireproof: true,
    use: type === "hoe" ? "hoe" : undefined, tool: { type, tier: NETHERITE.tier, speed: NETHERITE.speed },
  });
}
if (next > 380) throw new Error("tool ids overflowed into the armour block");

// ---- armour ------------------------------------------------------------------------

next = 380;
const ARMOR = [
  { key: "leather", name: "Leather", points: [1, 3, 2, 1], toughness: 0, mult: 5 },
  { key: "iron", name: "Iron", points: [2, 6, 5, 2], toughness: 0, mult: 15 },
  { key: "golden", name: "Golden", points: [2, 5, 3, 1], toughness: 0, mult: 7 },
  { key: "diamond", name: "Diamond", points: [3, 8, 6, 3], toughness: 2, mult: 33 },
  { key: "netherite", name: "Netherite", points: [3, 8, 6, 3], toughness: 3, mult: 37 },
] as const;
const PIECES = [
  { key: "helmet", name: "Cap", base: 11 },
  { key: "chestplate", name: "Tunic", base: 16 },
  { key: "leggings", name: "Pants", base: 15 },
  { key: "boots", name: "Boots", base: 13 },
] as const;
const PIECE_NAMES = ["Helmet", "Chestplate", "Leggings", "Boots"];
for (const a of ARMOR) {
  PIECES.forEach((p, slot) => {
    const display = a.key === "leather" ? `Leather ${p.name}` : `${a.name} ${PIECE_NAMES[slot]}`;
    item(`${a.key}_${p.key}`, display, {
      maxStack: 1, durability: p.base * a.mult, category: "combat",
      armor: { slot: slot as 0 | 1 | 2 | 3, points: a.points[slot], toughness: a.toughness, material: a.key },
      fireproof: a.key === "netherite" ? true : undefined,
    });
  });
}
if (next > 400) throw new Error("armour ids overflowed into the later block");

// ---- redstone and later additions (400+) -----------------------------------------------

next = 400;
item("iron_door", "Iron Door", { places: B.IRON_DOOR, category: "redstone" });
item("slime_ball", "Slimeball");
item("quartz", "Nether Quartz");

// Enchanting and brewing.
item("glass_bottle", "Glass Bottle", { use: "bottle", category: "ingredients" });
for (const p of POTIONS) {
  item(p.key, p.displayName, { maxStack: 1, use: "drink", category: "food", icon: `potion_${p.art}` });
}
for (const p of POTIONS) {
  const name = p.key === "water_bottle" ? "Splash Water Bottle" : `Splash ${p.displayName}`;
  item(`splash_${p.key}`, name, { maxStack: 1, use: "splash", category: "food", icon: `splash_potion_${p.art}` });
}
item("nether_wart", "Nether Wart", { places: B.NETHER_WART, use: "plant" });
item("blaze_rod", "Blaze Rod", { fuel: 2400 });
item("blaze_powder", "Blaze Powder");
item("ghast_tear", "Ghast Tear");
item("magma_cream", "Magma Cream");
item("fermented_spider_eye", "Fermented Spider Eye");
item("glistering_melon_slice", "Glistering Melon Slice");
food("golden_carrot", "Golden Carrot", 6, 14.4);
food("pufferfish", "Pufferfish", 1, 0.2, { effect: ["poison", 60, 1] });
// Plain enchanted books are listed per enchantment in the creative menu instead (Screens.tsx).
item("enchanted_book", "Enchanted Book", { maxStack: 1, category: "ingredients", hidden: true });
item("experience_bottle", "Bottle o' Enchanting", { use: "xp_bottle", category: "ingredients" });

// Vehicles.
for (const wood of ["oak", "spruce", "birch", "jungle", "acacia"]) {
  item(`${wood}_boat`, `${wood[0].toUpperCase()}${wood.slice(1)} Boat`, { maxStack: 1, use: "boat", category: "tools", fuel: 1200 });
}
item("minecart", "Minecart", { maxStack: 1, use: "minecart", category: "tools" });
item("tnt_minecart", "Minecart with TNT", { maxStack: 1, use: "minecart", category: "tools" });

// The Nether.
item("nether_brick", "Nether Brick");
item("netherite_scrap", "Netherite Scrap", { fireproof: true });
item("netherite_ingot", "Netherite Ingot", { fireproof: true });
item("fire_charge", "Fire Charge", { use: "flint_and_steel" });
// Bartered from piglins and dropped by endermen; thrown, it carries its thrower.
item("ender_pearl", "Ender Pearl", { maxStack: 16, use: "pearl" });

// The End.
item("eye_of_ender", "Eye of Ender", { use: "ender_eye" });
item("end_crystal", "End Crystal", { use: "end_crystal", category: "combat" });
// Eaten, it throws the eater somewhere nearby; so it is edible even on a full stomach.
food("chorus_fruit", "Chorus Fruit", 4, 2.4, { alwaysEdible: true });
item("popped_chorus_fruit", "Popped Chorus Fruit");
// Worn in the chest slot: no armour at all, but a jump from high up opens it into a glide.
item("elytra", "Elytra", {
  maxStack: 1, durability: 432, category: "tools", armor: { slot: 1, points: 0, toughness: 0, material: "elytra" },
});
item("firework_rocket", "Firework Rocket", { use: "rocket", category: "tools" });
// Shulkers' shells, which make shulker boxes; and the frame an End ship hangs its elytra in.
item("shulker_shell", "Shulker Shell");
item("item_frame", "Item Frame", { use: "item_frame", category: "functional" });
item("backpack", "Backpack", { use: "backpack", maxStack: 1, category: "tools" });
item("firework_star", "Firework Star");
// Bottled from the dragon's breath: brewed into a splash potion, it makes it linger.
item("dragon_breath", "Dragon's Breath", { category: "ingredients" });
// Thrown, a lingering potion leaves a cloud of itself behind.
for (const p of POTIONS) {
  const name = p.key === "water_bottle" ? "Lingering Water Bottle" : `Lingering ${p.displayName}`;
  item(`lingering_${p.key}`, name, { maxStack: 1, use: "splash", category: "food", icon: `lingering_potion_${p.art}` });
}
// Arrows dipped in a lingering potion: a hit carries an eighth of the potion.
for (const p of POTIONS) {
  if (!p.effects.length) continue;
  item(`tipped_arrow_${p.key}`, `Arrow of ${p.displayName.replace(/^Potion of /, "")}`, { category: "combat", icon: `tipped_arrow_${p.art}` });
}

// Primal (after ARK). Appended rather than filed with their kind, so that no item a save holds changes id.
food("mejoberry", "Mejoberry", 1, 0.6);
// Eaten, it makes you drowsy; fed to a creature asleep, it keeps it under.
food("narcoberry", "Narcoberry", 1, 0.2, { alwaysEdible: true, effect: ["slowness", 8, 1] });
item("narcotic", "Narcotic", { category: "ingredients" });
item("tranq_arrow", "Tranquilizer Arrow", { category: "combat" });
// A club hits softly and knocks out: most of its blow is torpor, not harm.
item("wooden_club", "Wooden Club", { maxStack: 1, damage: 2, attackSpeed: 1.4, category: "combat" });
food("kibble", "Kibble", 2, 1);
item("saddle", "Primitive Saddle", { maxStack: 1, category: "tools" });
item("heavy_saddle", "Heavy Saddle", { maxStack: 1, category: "tools" });
item("flyer_saddle", "Flyer Saddle", { maxStack: 1, category: "tools" });
food("raw_meat", "Raw Meat", 3, 1.8);
food("cooked_meat", "Cooked Meat", 8, 12.8);
// Wounds (Dead Zone, after DayZ): what treats them, and a canteen to carry water in.
item("bandage", "Bandage", { use: "treat", category: "tools" });
item("splint", "Splint", { use: "treat", category: "tools" });
item("antibiotics", "Antibiotics", { use: "treat", category: "tools" });
item("water_canteen", "Canteen of Water", { maxStack: 1, use: "drink", category: "food" });
item("canteen", "Empty Canteen", { maxStack: 1, use: "bottle", category: "tools" });
// Dead Zone and the zombie modes: firearms and their rounds, and what a survivor scavenges.
item("pistol", "Pistol", { maxStack: 1, use: "gun", damage: 3, category: "combat" });
item("hunting_rifle", "Hunting Rifle", { maxStack: 1, use: "gun", damage: 4, category: "combat" });
item("assault_rifle", "Assault Rifle", { maxStack: 1, use: "gun", damage: 4, category: "combat" });
item("shotgun", "Shotgun", { maxStack: 1, use: "gun", damage: 4, category: "combat" });
item("pistol_ammo", "Pistol Rounds", { category: "combat" });
item("rifle_ammo", "Rifle Rounds", { category: "combat" });
item("shotgun_shells", "Shotgun Shells", { category: "combat" });
food("canned_beans", "Canned Beans", 6, 7.2);
item("soda_can", "Can of Soda", { maxStack: 16, use: "drink", category: "food" });
item("baseball_bat", "Baseball Bat", { maxStack: 1, damage: 6, attackSpeed: 1.2, category: "combat" });
// Critters (engine/critters.ts): the orbs they are caught in, and their medicines.
item("capture_orb", "Capture Orb", { use: "orb", category: "tools" });
item("silver_orb", "Silver Orb", { use: "orb", category: "tools" });
item("gold_orb", "Gold Orb", { use: "orb", category: "tools" });
item("star_orb", "Star Orb", { use: "orb", category: "tools", maxStack: 16 });
item("park_orb", "Park Orb", { use: "orb", category: "tools" });
item("herbal_tonic", "Herbal Tonic", { use: "critter_medicine", category: "tools", maxStack: 16 });
item("strong_tonic", "Strong Tonic", { use: "critter_medicine", category: "tools", maxStack: 16 });
item("cure_all", "Cure-All", { use: "critter_medicine", category: "tools", maxStack: 16 });
item("revival_herb", "Revival Herb", { use: "critter_medicine", category: "tools", maxStack: 16 });
item("honey_cake", "Honey Cake", { use: "critter_medicine", category: "tools", maxStack: 16 });
// The city modes: a wad of bills dropped in the street. Picked up in a city, it goes straight to your cash (game.ts).
item("cash", "Wad of Cash", { category: "tools" });
// Space: a starship, kept folded in a pocket in the way of every other item, launched from wherever its holder stands.
item("starship", "Starship", { use: "launch", category: "tools", maxStack: 1 });
// The county (engine/countyItems.ts): food, drink, first aid, tools, weapons, books — appended here, so their ids follow on.
defineCountyItems(item);
// Plain items and blocks share one numbering; the sixteen-bit blocks start where plain items must stop.
if (next > FIRST_WIDE_BLOCK) throw new Error(`plain item ids have reached ${next}, into the block ids that start at ${FIRST_WIDE_BLOCK}`);

// ---- lookups -----------------------------------------------------------------------

const GLOWING_ITEMS: Record<string, number> = { lava_bucket: 15, blaze_rod: 10, glowstone_dust: 8, magma_cream: 6 };
/** How brightly an item lights its surroundings when held or dropped: its block's glow, or its own. */
export function itemLight(id: number): number {
  const def = ITEMS[id];
  if (!def) return 0;
  if (def.places !== undefined) return block(def.places).emission;
  return GLOWING_ITEMS[def.name] ?? 0;
}

export function itemDef(id: number): ItemDef | undefined {
  return ITEMS[id];
}
export function itemByName(name: string): ItemDef {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`unknown item ${name}`);
  return def;
}
export function itemId(name: string): number {
  return itemByName(name).id;
}
export function allItems(): readonly ItemDef[] {
  return ITEMS.filter(Boolean);
}
export function isItem(id: number): boolean {
  return ITEMS[id] !== undefined;
}

export interface ItemStack {
  id: number;
  count: number;
  /** A shulker box's inventory, carried with it (27 slots, never another box). */
  contents?: (ItemStack | null)[];
  /** A shulker box's colour, as BOX_COLORS in blocks.ts (0 or absent: undyed). */
  color?: number;
  /** A firework star's burst. */
  burst?: Burst;
  /** A firework rocket's flight and stars. */
  fw?: Rocket;
  /** Uses spent, for items with durability. */
  damage?: number;
  /** Enchantments, by name → level (enchanting.ts). */
  ench?: Record<string, number>;
  /** A name given at an anvil. */
  name?: string;
  /** The anvil's prior-work penalty: 0, 1, 3, 7… levels added to the next job. */
  repair?: number;
}

export function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

export function displayName(id: number): string {
  return ITEMS[id]?.displayName ?? block(id).displayName;
}

/** The item a block drops when broken by hand or tool, resolved from its drop table. */
export function resolveDrops(drops: Drop[] | undefined, blockId: number, random: () => number): ItemStack[] {
  if (drops === undefined) return isItem(blockId) ? [{ id: blockId, count: 1 }] : [];
  const out: ItemStack[] = [];
  let chanceTaken = false;
  for (const d of drops) {
    if (d.chance !== undefined) {
      // Chance-gated entries in one table are alternatives, the way gravel
      // drops flint *or* itself — rolling each independently would sometimes
      // give both and sometimes neither.
      if (chanceTaken || random() >= d.chance) continue;
      chanceTaken = true;
    }
    const count = d.min + Math.floor(random() * (d.max - d.min + 1));
    if (count > 0) out.push({ id: itemId(d.item), count });
  }
  return out;
}
