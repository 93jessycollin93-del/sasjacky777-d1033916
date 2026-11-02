/**
 * What the county's containers hold the first time anyone opens them.
 *
 * A container is not filled when its chunk is made: filling it would mark the
 * chunk changed, and a changed chunk is saved — every house walked past would
 * cost a save, and none of them could ever go back to how the county was made.
 * Instead a container with nothing kept in it is filled when it is first
 * opened, from a generator seeded by the world and the container's place, so
 * it holds the same things whoever opens it and whenever. Once opened it has
 * something kept in it (even if that is nothing) and is never filled again.
 *
 * What it holds depends on what it is (a fridge holds food that will spoil, a
 * bathroom cabinet holds pills) and on where it stands: a shelf is groceries
 * in a grocery, pills in a pharmacy and nails in a hardware store; a locker
 * is a nightstick at the police station and a comic at the school.
 */
import type { LootTable } from "./maps";

/** The kinds of building a container can stand in (engine/county.ts lays them out). */
export type BuildingKind =
  | "house" | "trailer" | "farmhouse" | "grocery" | "pharmacy" | "hardware" | "gun_store" | "liquor" | "bookstore" | "clothing"
  | "gas_station" | "diner" | "bar" | "police" | "fire_station" | "school" | "church" | "clinic" | "warehouse" | "barn"
  | "military" | "office" | "motel" | "library" | "checkpoint";

const CANS: LootTable = [
  ["canned_soup", 1, 2, 0.35], ["canned_chili", 1, 2, 0.25], ["canned_corn", 1, 2, 0.25], ["canned_peas", 1, 2, 0.2], ["canned_peaches", 1, 1, 0.2],
  ["canned_tuna", 1, 2, 0.25], ["canned_sardines", 1, 1, 0.15], ["canned_ham", 1, 1, 0.12], ["canned_spaghetti", 1, 2, 0.2], ["canned_carrots", 1, 1, 0.15],
  ["canned_beans", 1, 2, 0.25],
];
const DRY: LootTable = [
  ["cereal", 1, 1, 0.25], ["crackers", 1, 1, 0.25], ["peanut_butter", 1, 1, 0.2], ["jam", 1, 1, 0.15], ["honey_jar", 1, 1, 0.08],
  ["dried_pasta", 1, 2, 0.25], ["rice_bag", 1, 1, 0.2], ["oatmeal", 1, 1, 0.15], ["popcorn", 1, 2, 0.15], ["potato_chips", 1, 2, 0.2],
  ["candy_bar", 1, 2, 0.15], ["granola_bar", 1, 2, 0.15], ["coffee_tin", 1, 1, 0.15], ["flour_bag", 1, 1, 0.12], ["salt", 1, 1, 0.12], ["sugar", 1, 3, 0.15],
];
const MEDS: LootTable = [
  ["bandage", 1, 3, 0.45], ["painkillers", 1, 1, 0.35], ["vitamins", 1, 1, 0.25], ["antidepressants", 1, 1, 0.12], ["beta_blockers", 1, 1, 0.1],
  ["sleeping_pills", 1, 1, 0.15], ["disinfectant", 1, 1, 0.2], ["alcohol_wipes", 1, 2, 0.25], ["tweezers", 1, 1, 0.12], ["sewing_needle", 1, 1, 0.1],
  ["toilet_paper", 1, 2, 0.3], ["antibiotics", 1, 1, 0.06], ["sterile_bandage", 1, 2, 0.08],
];
const TOOLS: LootTable = [
  ["hammer", 1, 1, 0.25], ["saw", 1, 1, 0.15], ["screwdriver", 1, 1, 0.3], ["wrench", 1, 1, 0.2], ["pipe_wrench", 1, 1, 0.08], ["needle_nose_pliers", 1, 1, 0.12],
  ["nails", 4, 16, 0.45], ["screws", 4, 12, 0.3], ["duct_tape", 1, 1, 0.25], ["wood_glue", 1, 1, 0.12], ["electric_wire", 1, 2, 0.15], ["crowbar", 1, 1, 0.05],
];
const READING: LootTable = [
  ["paperback_novel", 1, 2, 0.3], ["comic_book", 1, 1, 0.15], ["newspaper", 1, 1, 0.2], ["glossy_magazine", 1, 1, 0.2], ["crossword_book", 1, 1, 0.1],
];

/** Skill books: the first volume is common, the third rare. */
const BOOKS: LootTable = (() => {
  const skills = ["carpentry", "cooking", "farming", "first_aid", "electrical", "metalworking", "mechanics", "tailoring", "fishing", "trapping", "foraging"];
  return skills.flatMap((s) => [[`${s}_book_1`, 1, 1, 0.05], [`${s}_book_2`, 1, 1, 0.025], [`${s}_book_3`, 1, 1, 0.01]] as const);
})();
const MAGAZINES: LootTable = [
  ["weekend_builder", 1, 1, 0.05], ["generator_guide", 1, 1, 0.03], ["country_cooking", 1, 1, 0.05], ["rod_and_reel", 1, 1, 0.04],
  ["trappers_almanac", 1, 1, 0.04], ["wiring_made_easy", 1, 1, 0.03], ["home_mechanic", 1, 1, 0.04],
];
const scale = (t: LootTable, f: number): LootTable => t.map(([n, lo, hi, c]) => [n, lo, hi, Math.min(1, c * f)] as const);

export const COUNTY_LOOT: Record<string, LootTable> = {
  kitchen: [...scale(CANS, 0.6), ...scale(DRY, 0.4), ["kitchen_knife", 1, 1, 0.2], ["can_opener", 1, 1, 0.2], ["frying_pan", 1, 1, 0.1],
    ["rolling_pin", 1, 1, 0.06], ["matches", 1, 1, 0.15], ["candle", 1, 2, 0.12], ["bowl", 1, 2, 0.15], ["glass_bottle", 1, 2, 0.1], ["country_cooking", 1, 1, 0.03]],
  pantry: [...scale(DRY, 0.8), ...scale(CANS, 0.5)],
  fridge: [["milk_carton", 1, 1, 0.4], ["cheese", 1, 1, 0.3], ["butter", 1, 1, 0.25], ["deli_ham", 1, 1, 0.2], ["egg", 2, 6, 0.3], ["lettuce", 1, 1, 0.2],
    ["tomato", 1, 3, 0.25], ["onion", 1, 2, 0.2], ["bell_pepper", 1, 2, 0.15], ["cabbage", 1, 1, 0.1], ["orange_juice", 1, 1, 0.25], ["cola_bottle", 1, 2, 0.25],
    ["beer_can", 1, 4, 0.2], ["hot_dogs", 1, 1, 0.15], ["apple", 1, 3, 0.2], ["orange", 1, 2, 0.15], ["grapes", 1, 1, 0.1], ["strawberries", 1, 1, 0.08],
    ["ground_beef", 1, 1, 0.15], ["bread", 1, 1, 0.15], ["bottled_water", 1, 2, 0.2]],
  freezer: [["frozen_pizza", 1, 2, 0.35], ["tv_dinner", 1, 2, 0.35], ["ice_cream", 1, 1, 0.3], ["ground_beef", 1, 2, 0.25], ["beef", 1, 2, 0.2],
    ["chicken", 1, 2, 0.2], ["porkchop", 1, 2, 0.15]],
  trash: [["empty_can", 1, 2, 0.4], ["empty_water_bottle", 1, 1, 0.3], ["rag", 1, 1, 0.2], ["newspaper", 1, 1, 0.2], ["glass_bottle", 1, 1, 0.15],
    ["rotten_flesh", 1, 1, 0.1], ["candy_bar", 1, 1, 0.04], ["scrap_metal", 1, 1, 0.05]],
  living: [...READING, ["playing_cards", 1, 1, 0.15], ["candle", 1, 2, 0.15], ["lighter", 1, 1, 0.12], ["batteries", 1, 2, 0.15], ["painkillers", 1, 1, 0.08],
    ["flashlight", 1, 1, 0.06], ["portable_radio", 1, 1, 0.04], ...scale(MAGAZINES, 1)],
  books: [...scale(READING, 1.5), ...scale(BOOKS, 3), ...scale(MAGAZINES, 2)],
  wardrobe: [["bed_sheet", 1, 2, 0.4], ["school_bag", 1, 1, 0.12], ["hiking_bag", 1, 1, 0.06], ["duffel_bag", 1, 1, 0.08], ["leather_chestplate", 1, 1, 0.12],
    ["leather_boots", 1, 1, 0.12], ["leather_helmet", 1, 1, 0.05], ["rope", 1, 1, 0.1], ["flashlight", 1, 1, 0.08], ["baseball_bat", 1, 1, 0.08], ["golf_club", 1, 1, 0.06],
    ["shotgun", 1, 1, 0.02], ["shotgun_shells", 2, 6, 0.04]],
  dresser: [["bed_sheet", 1, 1, 0.25], ["rag", 1, 2, 0.2], ["thread", 1, 1, 0.12], ["sewing_needle", 1, 1, 0.1], ["playing_cards", 1, 1, 0.1],
    ["paperback_novel", 1, 1, 0.12], ["batteries", 1, 2, 0.12], ["pistol", 1, 1, 0.02], ["pistol_ammo", 4, 10, 0.04], ["cash", 1, 3, 0.1]],
  nightstand: [["paperback_novel", 1, 1, 0.25], ["sleeping_pills", 1, 1, 0.12], ["painkillers", 1, 1, 0.15], ["flashlight", 1, 1, 0.12], ["batteries", 1, 2, 0.15],
    ["lighter", 1, 1, 0.1], ["candle", 1, 1, 0.12], ["pistol", 1, 1, 0.03], ["pistol_ammo", 4, 10, 0.04], ["glossy_magazine", 1, 1, 0.1]],
  medicine: MEDS,
  laundry: [["bed_sheet", 1, 2, 0.4], ["rag", 1, 3, 0.35], ["thread", 1, 1, 0.1]],
  garage: [...scale(TOOLS, 1), ["plank", 2, 6, 0.3], ["rope", 1, 1, 0.2], ["gas_can", 1, 1, 0.2], ["full_gas_can", 1, 1, 0.06], ["car_battery", 1, 1, 0.08],
    ["lightbulb", 1, 2, 0.12], ["flashlight", 1, 1, 0.12], ["batteries", 1, 2, 0.15], ["tire_iron", 1, 1, 0.1], ["sledgehammer", 1, 1, 0.03], ["hatchet", 1, 1, 0.06],
    ["wood_axe", 1, 1, 0.04], ["generator_guide", 1, 1, 0.03], ["weekend_builder", 1, 1, 0.05], ["car_keys", 1, 1, 0.05]],
  tools: scale(TOOLS, 1.8),
  crate: [["plank", 4, 10, 0.4], ["nails", 8, 24, 0.35], ["scrap_metal", 1, 4, 0.25], ["sheet_metal", 1, 2, 0.15], ["rope", 1, 2, 0.15],
    ...scale(CANS, 0.8), ["bottled_water", 2, 6, 0.3]],
  grocery: [...scale(CANS, 1.4), ...scale(DRY, 1.4), ["bottled_water", 1, 4, 0.3], ["cola_bottle", 1, 3, 0.25]],
  cooler: [["bottled_water", 2, 6, 0.6], ["cola_bottle", 1, 4, 0.5], ["orange_juice", 1, 2, 0.35], ["milk_carton", 1, 2, 0.3], ["beer_can", 2, 6, 0.3]],
  register: [["cash", 1, 6, 0.6], ["candy_bar", 1, 2, 0.2], ["lighter", 1, 1, 0.15], ["batteries", 1, 2, 0.1]],
  clothing: [["school_bag", 1, 1, 0.2], ["hiking_bag", 1, 1, 0.15], ["duffel_bag", 1, 1, 0.15], ["leather_chestplate", 1, 1, 0.25], ["leather_leggings", 1, 1, 0.2],
    ["leather_boots", 1, 1, 0.25], ["leather_helmet", 1, 1, 0.1], ["bed_sheet", 1, 2, 0.2]],
  guns: [["hunting_rifle", 1, 1, 0.3], ["shotgun", 1, 1, 0.3], ["pistol", 1, 1, 0.35], ["pistol_ammo", 8, 24, 0.5], ["rifle_ammo", 6, 18, 0.4], ["shotgun_shells", 4, 12, 0.45]],
  vending: [["candy_bar", 1, 3, 0.6], ["potato_chips", 1, 2, 0.5], ["cola_bottle", 1, 3, 0.5], ["granola_bar", 1, 2, 0.4], ["bottled_water", 1, 2, 0.3]],
  office: [...READING, ["playing_cards", 1, 1, 0.1], ["painkillers", 1, 1, 0.1], ["coffee_tin", 1, 1, 0.1], ["candy_bar", 1, 1, 0.12], ["cash", 1, 2, 0.08],
    ["pistol", 1, 1, 0.01]],
  locker: [["duffel_bag", 1, 1, 0.1], ["school_bag", 1, 1, 0.08], ["bottled_water", 1, 1, 0.15], ["granola_bar", 1, 1, 0.12], ["baseball_bat", 1, 1, 0.06], ["paperback_novel", 1, 1, 0.1]],
  police_locker: [["nightstick", 1, 1, 0.35], ["pistol", 1, 1, 0.25], ["pistol_ammo", 8, 20, 0.45], ["shotgun", 1, 1, 0.1], ["shotgun_shells", 4, 10, 0.25],
    ["flashlight", 1, 1, 0.3], ["bandage", 1, 2, 0.3], ["iron_chestplate", 1, 1, 0.1], ["walkie_talkie", 1, 1, 0.15]],
  school_locker: [["school_bag", 1, 1, 0.3], ["comic_book", 1, 1, 0.2], ["candy_bar", 1, 2, 0.25], ["paperback_novel", 1, 1, 0.12], ["baseball_bat", 1, 1, 0.05],
    ...scale(BOOKS, 0.5)],
  fire_locker: [["fire_axe", 1, 1, 0.3], ["crowbar", 1, 1, 0.2], ["flashlight", 1, 1, 0.3], ["bandage", 1, 3, 0.4], ["sterile_bandage", 1, 2, 0.2],
    ["iron_helmet", 1, 1, 0.12], ["bottled_water", 1, 2, 0.3]],
  military: [["rifle_ammo", 12, 30, 0.7], ["assault_rifle", 1, 1, 0.25], ["hunting_rifle", 1, 1, 0.15], ["pistol", 1, 1, 0.3], ["pistol_ammo", 8, 20, 0.5],
    ["shotgun_shells", 4, 12, 0.3], ["iron_helmet", 1, 1, 0.3], ["iron_chestplate", 1, 1, 0.25], ["sterile_bandage", 1, 3, 0.4], ["bottled_water", 2, 4, 0.4],
    ["beef_jerky", 1, 3, 0.4], ["canned_chili", 1, 3, 0.3], ["walkie_talkie", 1, 1, 0.3], ["hunting_knife", 1, 1, 0.2]],
  safe: [["cash", 4, 16, 0.8], ["pistol", 1, 1, 0.3], ["pistol_ammo", 8, 20, 0.35], ["gold_ingot", 1, 3, 0.2], ["whiskey_bottle", 1, 1, 0.15], ["car_keys", 1, 1, 0.2]],
  mail: [["newspaper", 1, 1, 0.4], ["glossy_magazine", 1, 1, 0.3], ["comic_book", 1, 1, 0.1], ...scale(MAGAZINES, 1.5)],
  dumpster: [["empty_can", 1, 4, 0.5], ["empty_water_bottle", 1, 3, 0.4], ["plank", 1, 3, 0.3], ["scrap_metal", 1, 2, 0.3], ["rag", 1, 2, 0.3], ["newspaper", 1, 1, 0.3],
    ["glass_bottle", 1, 2, 0.25], ["rotten_flesh", 1, 2, 0.2], ["lead_pipe", 1, 1, 0.04], ["pool_cue", 1, 1, 0.02]],
  pharmacy: [...scale(MEDS, 1.8), ["first_aid_kit", 1, 1, 0.15], ["sterile_bandage", 1, 3, 0.3], ["antibiotics", 1, 2, 0.2]],
  hardware: [...scale(TOOLS, 2), ["plank", 4, 12, 0.4], ["rope", 1, 2, 0.3], ["gas_can", 1, 1, 0.3], ["hatchet", 1, 1, 0.15], ["wood_axe", 1, 1, 0.1],
    ["sledgehammer", 1, 1, 0.08], ["crowbar", 1, 1, 0.12], ["lightbulb", 1, 3, 0.3], ["batteries", 1, 3, 0.3], ["flashlight", 1, 1, 0.2], ["generator_guide", 1, 1, 0.08],
    ["weekend_builder", 1, 1, 0.15], ["wiring_made_easy", 1, 1, 0.08]],
  gunstore: [["hunting_rifle", 1, 1, 0.3], ["shotgun", 1, 1, 0.3], ["pistol", 1, 1, 0.35], ["pistol_ammo", 12, 30, 0.6], ["rifle_ammo", 8, 24, 0.5],
    ["shotgun_shells", 6, 16, 0.55], ["hunting_knife", 1, 1, 0.3], ["flashlight", 1, 1, 0.2], ["hiking_bag", 1, 1, 0.15]],
  liquor: [["beer_can", 2, 8, 0.6], ["wine_bottle", 1, 3, 0.4], ["whiskey_bottle", 1, 2, 0.35], ["potato_chips", 1, 2, 0.3], ["popcorn", 1, 2, 0.15], ["lighter", 1, 1, 0.15]],
  bookshop: [...scale(READING, 2), ...scale(BOOKS, 5), ...scale(MAGAZINES, 4)],
  gas_station: [["candy_bar", 1, 3, 0.4], ["potato_chips", 1, 3, 0.4], ["beef_jerky", 1, 2, 0.3], ["lighter", 1, 2, 0.3], ["batteries", 1, 2, 0.3],
    ["county_map", 1, 1, 0.3], ["gas_can", 1, 1, 0.2], ["cola_bottle", 1, 3, 0.3], ["bottled_water", 1, 3, 0.3], ["newspaper", 1, 1, 0.2], ["popcorn", 1, 1, 0.15]],
  restaurant: [...scale(CANS, 1.2), ...scale(DRY, 1), ["kitchen_knife", 1, 1, 0.3], ["frying_pan", 1, 1, 0.25], ["rolling_pin", 1, 1, 0.1], ["salt", 1, 2, 0.3]],
  restaurant_fridge: [["ground_beef", 1, 3, 0.4], ["cheese", 1, 2, 0.35], ["lettuce", 1, 2, 0.3], ["tomato", 1, 3, 0.35], ["onion", 1, 3, 0.3], ["milk_carton", 1, 2, 0.3],
    ["egg", 4, 12, 0.35], ["butter", 1, 2, 0.3], ["hot_dogs", 1, 2, 0.25], ["cola_bottle", 2, 4, 0.3]],
  warehouse: [["plank", 6, 16, 0.4], ["nails", 8, 32, 0.4], ["sheet_metal", 1, 3, 0.2], ["scrap_metal", 1, 4, 0.25], ["rope", 1, 2, 0.2], ["duct_tape", 1, 2, 0.2],
    ["bottled_water", 4, 12, 0.3], ...scale(CANS, 1.2), ["gas_can", 1, 1, 0.15]],
  farm: [["wheat_seeds", 4, 12, 0.4], ["carrot", 1, 4, 0.3], ["potato", 1, 4, 0.3], ["hatchet", 1, 1, 0.15], ["wood_axe", 1, 1, 0.1], ["rope", 1, 2, 0.25],
    ["full_gas_can", 1, 1, 0.1], ["shotgun", 1, 1, 0.05], ["shotgun_shells", 2, 6, 0.1], ["iron_hoe", 1, 1, 0.2], ["iron_shovel", 1, 1, 0.15], ["trappers_almanac", 1, 1, 0.05]],
  clinic: [...scale(MEDS, 2), ["first_aid_kit", 1, 1, 0.3], ["sterile_bandage", 2, 4, 0.4], ["antibiotics", 1, 2, 0.3], ["suture_needle", 1, 2, 0.3]],
  church: [["candle", 1, 4, 0.5], ["paperback_novel", 1, 1, 0.2], ["bottled_water", 1, 2, 0.15], ["canned_soup", 1, 2, 0.15]],
};

/**
 * The table a county container fills from: what it is, adjusted for where it
 * stands. `blockLoot` is the block's own kind (blocks.ts `loot`).
 */
export function countyLootTable(blockLoot: string, building: BuildingKind | null): string {
  const b = building ?? "house";
  switch (blockLoot) {
    case "grocery":
      return b === "pharmacy" || b === "clinic" ? "pharmacy" : b === "hardware" ? "hardware" : b === "gun_store" ? "gunstore" : b === "liquor" || b === "bar" ? "liquor"
        : b === "bookstore" || b === "library" ? "bookshop" : b === "clothing" ? "clothing" : b === "gas_station" ? "gas_station" : b === "warehouse" ? "warehouse" : "grocery";
    case "locker":
      return b === "police" || b === "checkpoint" ? "police_locker" : b === "school" ? "school_locker" : b === "fire_station" ? "fire_locker" : b === "military" ? "military" : "locker";
    case "garage":
      return b === "warehouse" ? "warehouse" : b === "hardware" ? "hardware" : b === "farmhouse" || b === "barn" ? "farm" : b === "clinic" ? "clinic" : b === "military" ? "military" : "garage";
    case "kitchen": case "pantry":
      return b === "diner" || b === "bar" ? "restaurant" : blockLoot;
    case "fridge":
      return b === "diner" || b === "bar" ? "restaurant_fridge" : "fridge";
    case "medicine":
      return b === "clinic" ? "clinic" : "medicine";
    case "crate":
      return b === "military" || b === "checkpoint" ? "military" : b === "farmhouse" || b === "barn" ? "farm" : b === "warehouse" ? "warehouse" : "crate";
    case "office":
      return b === "church" ? "church" : "office";
    default:
      return blockLoot;
  }
}

/** Every item name the county's tables use, for the test that keeps them real. */
export function countyLootNames(): string[] {
  return Object.values(COUNTY_LOOT).flatMap((t) => t.map(([n]) => n));
}
