/**
 * The county's items: what fills the kitchens, garages, bathrooms and shops of
 * a small county at the end of the world — tins and packets and fresh food
 * that will not stay fresh, drinks, first aid, tools that double as weapons
 * and weapons that are only tools, lumber and nails for boarding up, skill
 * books and magazines, and the odds and ends worth carrying.
 *
 * Appended after every item before them (items.ts calls this last), so their
 * ids follow on and never move. The numbers are this game's own scale: a tin
 * of chili fills as much as a steak (food and saturation as the original's
 * food bar reads), a fire axe hits like a diamond one and wears out like iron.
 */
import type { FoodInfo, ItemDef, ToolInfo } from "./items";

type ItemFn = (name: string, displayName: string, opts?: Partial<ItemDef>) => ItemDef;

/** The skills a book can teach (engine/countySkills.ts reads them). */
export const BOOK_SKILLS = [
  ["carpentry", "Carpentry"], ["cooking", "Cooking"], ["farming", "Farming"], ["first_aid", "First Aid"], ["electrical", "Electrical"],
  ["metalworking", "Metalworking"], ["mechanics", "Mechanics"], ["tailoring", "Tailoring"], ["fishing", "Fishing"], ["trapping", "Trapping"],
  ["foraging", "Foraging"],
] as const;

/** Water, 0..20, that a county drink gives (vitals.ts adds these to its own). */
export const COUNTY_WATER: Readonly<Record<string, number>> = {
  bottled_water: 10, orange_juice: 7, cola_bottle: 6, beer_can: 3, wine_bottle: 2, whiskey_bottle: 1, milk_carton: 7,
  canned_peaches: 2, orange: 3, grapes: 1, strawberries: 1, tomato: 1, lettuce: 1,
};

/** Food that goes off (engine/countyFood.ts ages it): how many in-game days it stays fresh, then stale. */
export const PERISHABLE: Readonly<Record<string, number>> = {
  milk_carton: 3, cheese: 7, butter: 7, deli_ham: 3, ground_beef: 2, hot_dogs: 4, lettuce: 3, tomato: 4, onion: 10, bell_pepper: 5,
  cabbage: 6, banana: 3, orange: 7, grapes: 3, strawberries: 2, frozen_pizza: 2, tv_dinner: 2, ice_cream: 1, sandwich: 2,
  bread: 4, egg: 7, apple: 8, beef: 2, chicken: 2, porkchop: 2,
};

export function defineCountyItems(item: ItemFn): void {
  const food = (name: string, display: string, hunger: number, saturation: number, extra: Partial<FoodInfo> = {}, opts: Partial<ItemDef> = {}) =>
    item(name, display, { category: "food", food: { hunger, saturation, ...extra }, ...opts });
  const drink = (name: string, display: string, empty: string | null) =>
    item(name, display, { category: "food", use: "drink", maxStack: 8, empty });
  const weapon = (name: string, display: string, damage: number, attackSpeed: number, durability: number, tool?: ToolInfo) =>
    item(name, display, { category: "combat", maxStack: 1, damage, attackSpeed, durability, tool });
  const tool = (name: string, display: string, damage: number, attackSpeed: number, durability: number) =>
    item(name, display, { category: "tools", maxStack: 1, damage, attackSpeed, durability });
  const thing = (name: string, display: string, opts: Partial<ItemDef> = {}) => item(name, display, { category: "ingredients", ...opts });

  // ---- lumber and hardware -------------------------------------------------------------------------
  thing("plank", "Plank", { fuel: 300, damage: 3, attackSpeed: 1.4 });
  thing("nails", "Nails");
  thing("screws", "Screws");
  thing("duct_tape", "Duct Tape", { maxStack: 16 });
  thing("wood_glue", "Wood Glue", { maxStack: 16 });
  thing("scrap_metal", "Scrap Metal");
  thing("sheet_metal", "Sheet Metal", { maxStack: 16 });
  thing("electric_wire", "Electric Wire", { maxStack: 16 });
  thing("rope", "Rope", { maxStack: 16 });
  thing("bed_sheet", "Bed Sheet", { maxStack: 16 });
  thing("rag", "Rag");
  thing("thread", "Thread", { maxStack: 16 });
  thing("sewing_needle", "Sewing Needle", { maxStack: 16 });
  thing("sheet_rope", "Sheet Rope", { maxStack: 16 });

  // ---- tools (and what they are good for when something comes through the window) -------------------------
  tool("hammer", "Hammer", 4, 1.3, 250);
  tool("saw", "Saw", 2, 1.2, 200);
  tool("screwdriver", "Screwdriver", 3, 2, 150);
  tool("wrench", "Wrench", 4, 1.4, 300);
  tool("can_opener", "Can Opener", 1, 2, 300);
  tool("needle_nose_pliers", "Pliers", 2, 1.6, 250);
  item("flashlight", "Flashlight", { category: "tools", maxStack: 1, damage: 2, attackSpeed: 1.6 });
  thing("batteries", "Batteries", { maxStack: 16 });
  thing("lighter", "Lighter", { maxStack: 8 });
  thing("matches", "Box of Matches", { maxStack: 16 });
  thing("candle", "Candle", { maxStack: 16 });
  item("gas_can", "Gas Can (Empty)", { category: "tools", maxStack: 1 });
  item("full_gas_can", "Gas Can (Full)", { category: "tools", maxStack: 1 });
  thing("propane_tank", "Propane Tank", { maxStack: 1 });
  thing("car_battery", "Car Battery", { maxStack: 1 });
  thing("lightbulb", "Light Bulb", { maxStack: 16 });
  item("car_keys", "Car Keys", { category: "tools", maxStack: 1 });
  item("portable_radio", "Portable Radio", { category: "tools", maxStack: 1 });
  item("walkie_talkie", "Walkie-Talkie", { category: "tools", maxStack: 1 });
  item("county_map", "County Map", { category: "tools", maxStack: 1 });
  thing("toilet_paper", "Toilet Paper", { maxStack: 16 });
  thing("empty_water_bottle", "Empty Water Bottle", { maxStack: 16, use: "bottle" });
  thing("empty_can", "Empty Can", { maxStack: 16 });

  // ---- melee weapons -----------------------------------------------------------------------------------------
  weapon("crowbar", "Crowbar", 6, 1.1, 500);
  weapon("pipe_wrench", "Pipe Wrench", 6, 1, 350);
  weapon("sledgehammer", "Sledgehammer", 10, 0.6, 400, { type: "pickaxe", tier: 1, speed: 5 });
  weapon("kitchen_knife", "Kitchen Knife", 4, 2, 120);
  weapon("hunting_knife", "Hunting Knife", 5, 2, 250);
  weapon("machete", "Machete", 8, 1.3, 300);
  weapon("katana", "Collector's Katana", 11, 1.2, 400);
  weapon("fire_axe", "Fire Axe", 10, 0.9, 350, { type: "axe", tier: 2, speed: 7 });
  weapon("wood_axe", "Wood Axe", 9, 0.9, 300, { type: "axe", tier: 1, speed: 6 });
  weapon("hatchet", "Hatchet", 6, 1.2, 200, { type: "axe", tier: 1, speed: 4 });
  weapon("frying_pan", "Frying Pan", 5, 1.2, 300);
  weapon("rolling_pin", "Rolling Pin", 3, 1.4, 150);
  weapon("golf_club", "Golf Club", 6, 1.2, 180);
  weapon("lead_pipe", "Lead Pipe", 6, 1.1, 400);
  weapon("spiked_bat", "Nailed Baseball Bat", 8, 1.2, 220);
  weapon("nightstick", "Nightstick", 5, 1.6, 400);
  weapon("tire_iron", "Tire Iron", 5, 1.3, 400);
  weapon("pool_cue", "Pool Cue", 4, 1.4, 80);
  weapon("spear", "Crafted Spear", 7, 1.1, 120);

  // ---- tins, packets and jars -----------------------------------------------------------------------------------
  for (const [name, display, h, s] of [
    ["canned_soup", "Canned Soup", 6, 6], ["canned_chili", "Canned Chili", 7, 7], ["canned_corn", "Canned Corn", 4, 4], ["canned_peas", "Canned Peas", 4, 4],
    ["canned_peaches", "Canned Peaches", 4, 3], ["canned_tuna", "Canned Tuna", 5, 6], ["canned_sardines", "Canned Sardines", 4, 5],
    ["canned_ham", "Canned Ham", 7, 8], ["canned_spaghetti", "Canned Spaghetti", 6, 6], ["canned_carrots", "Canned Carrots", 3, 3],
  ] as const) food(name, display, h, s, {}, { maxStack: 16 });
  for (const [name, display, h, s] of [
    ["cereal", "Box of Cereal", 4, 3], ["crackers", "Crackers", 3, 2], ["potato_chips", "Bag of Chips", 3, 1.5], ["candy_bar", "Candy Bar", 3, 1],
    ["peanut_butter", "Jar of Peanut Butter", 6, 8], ["jam", "Jar of Jam", 3, 2], ["honey_jar", "Jar of Honey", 4, 3], ["dried_pasta", "Box of Pasta", 2, 1],
    ["rice_bag", "Bag of Rice", 2, 1], ["oatmeal", "Oatmeal", 3, 2], ["beef_jerky", "Beef Jerky", 5, 5], ["granola_bar", "Granola Bar", 4, 3],
    ["popcorn", "Bag of Popcorn", 2, 1], ["flour_bag", "Bag of Flour", 1, 0.5], ["salt", "Salt", 0, 0], ["coffee_tin", "Tin of Coffee", 1, 0],
  ] as const) food(name, display, h, s, h === 0 ? { alwaysEdible: true } : {}, { maxStack: 16 });

  // ---- fresh food, which will not stay fresh ----------------------------------------------------------------------
  for (const [name, display, h, s] of [
    ["cheese", "Cheese", 4, 4], ["butter", "Butter", 2, 2], ["deli_ham", "Deli Ham", 4, 4], ["ground_beef", "Raw Ground Beef", 3, 1],
    ["hot_dogs", "Hot Dogs", 3, 2], ["lettuce", "Lettuce", 2, 1], ["tomato", "Tomato", 2, 1.5], ["onion", "Onion", 2, 1], ["bell_pepper", "Bell Pepper", 2, 1],
    ["cabbage", "Cabbage", 3, 2], ["banana", "Banana", 3, 2], ["orange", "Orange", 3, 2.4], ["grapes", "Grapes", 2, 1.5], ["strawberries", "Strawberries", 2, 1.5],
    ["frozen_pizza", "Frozen Pizza", 7, 6], ["tv_dinner", "TV Dinner", 6, 6], ["ice_cream", "Tub of Ice Cream", 3, 2], ["sandwich", "Sandwich", 7, 8],
  ] as const) food(name, display, h, s, {}, { maxStack: 16 });

  // ---- drinks --------------------------------------------------------------------------------------------------------
  drink("bottled_water", "Bottle of Water", "empty_water_bottle");
  drink("orange_juice", "Carton of Orange Juice", null);
  drink("milk_carton", "Carton of Milk", null);
  drink("cola_bottle", "Bottle of Pop", "empty_water_bottle");
  drink("beer_can", "Can of Beer", "empty_can");
  drink("wine_bottle", "Bottle of Wine", "glass_bottle");
  drink("whiskey_bottle", "Bottle of Whiskey", "glass_bottle");

  // ---- first aid -------------------------------------------------------------------------------------------------------
  for (const [name, display] of [
    ["sterile_bandage", "Sterilized Bandage"], ["disinfectant", "Bottle of Disinfectant"], ["alcohol_wipes", "Alcohol Wipes"], ["suture_needle", "Suture Needle"],
    ["tweezers", "Tweezers"], ["painkillers", "Painkillers"], ["vitamins", "Vitamins"], ["beta_blockers", "Beta Blockers"], ["sleeping_pills", "Sleeping Pills"],
    ["antidepressants", "Antidepressants"], ["first_aid_kit", "First Aid Kit"],
  ] as const) item(name, display, { category: "tools", use: "treat", maxStack: 16 });

  // ---- reading -----------------------------------------------------------------------------------------------------------
  for (const [skill, title] of BOOK_SKILLS) {
    for (let vol = 1; vol <= 3; vol++) item(`${skill}_book_${vol}`, `${title}, Vol. ${vol}`, { category: "tools", use: "read", maxStack: 1 });
  }
  for (const [name, display] of [
    ["weekend_builder", "Weekend Builder Magazine"], ["generator_guide", "Generator Guide"], ["country_cooking", "Country Cooking Magazine"],
    ["rod_and_reel", "Rod & Reel Monthly"], ["trappers_almanac", "Trapper's Almanac"], ["wiring_made_easy", "Wiring Made Easy"], ["home_mechanic", "Home Mechanic Magazine"],
  ] as const) item(name, display, { category: "tools", use: "read", maxStack: 1 });
  for (const [name, display] of [
    ["newspaper", "Newspaper"], ["comic_book", "Comic Book"], ["paperback_novel", "Paperback Novel"], ["crossword_book", "Book of Crosswords"],
    ["playing_cards", "Deck of Cards"], ["glossy_magazine", "Glossy Magazine"],
  ] as const) item(name, display, { category: "tools", use: "read", maxStack: 4 });

  // ---- bags -------------------------------------------------------------------------------------------------------------
  item("school_bag", "School Backpack", { category: "tools", use: "backpack", maxStack: 1 });
  item("hiking_bag", "Hiking Backpack", { category: "tools", use: "backpack", maxStack: 1 });
  item("duffel_bag", "Duffel Bag", { category: "tools", use: "backpack", maxStack: 1 });

  // ---- what a fridge holds once the power has been off a while (engine/countyLife.ts) ----
  food("spoiled_food", "Spoiled Food", 2, 0.2, {}, { maxStack: 16 });
}

/** Item sprites for the county: templates first, then each item's picture in its colours. */
export const COUNTY_TEMPLATES: Record<string, string[]> = {
  jar: [
    "................", ".....kkkkkk.....", ".....kkkkkk.....", "....abbbbbba....", "...abcbbbbbba...", "...abcwwwwbba...",
    "...abcwffwbba...", "...abcwwwwbba...", "...abbbbbbbba...", "....abbbbbba....", ".....aaaaaa.....",
  ],
  box: [
    "....aaaaaaaa....", "....abbbbbba....", "....abccccba....", "....abwwwwba....", "....abwffwba....", "....abwffwba....",
    "....abwwwwba....", "....abbbbbba....", "....abddddba....", "....abbbbbba....", "....abbbbbba....", "....aaaaaaaa....",
  ],
  bag: [
    "................", "...aaaaaaaaaa...", "...abbbbbbbba...", "..abbbbbbbbbba..", "..abccwwwwbbba..", "..abcwffffwbba..",
    "..abcwffffwbba..", "..abbwwwwwbbba..", "..abbbbbbbbbba..", "...abbbbbbbba...", "...aaaaaaaaaa...",
  ],
  bar: [
    "................", "................", "..........aaa...", "........aabbba..", "......aabbwbba..", "....aabbwwbba...",
    "..aabbwwbbaa....", ".abbwwbbaa......", ".abbbbaa........", "..aaaa..........",
  ],
  bottle: [
    ".......kk.......", ".......kk.......", "......abba......", ".....abccba.....", ".....abccba.....", ".....awwwwa.....",
    ".....awffwa.....", ".....awwwwa.....", ".....abccba.....", ".....abccba.....", ".....abccba.....", ".....aaaaaa.....",
  ],
  wine: [
    ".......kk.......", ".......bb.......", ".......bb.......", "......abba......", ".....abbbba.....", ".....abcbba.....",
    ".....awwwwa.....", ".....awffwa.....", ".....awwwwa.....", ".....abcbba.....", ".....abbbba.....", ".....aaaaaa.....",
  ],
  carton: [
    "......aaaa......", ".....abbbba.....", "....abbbbbba....", "....accccbba....", "....awwwwwba....", "....awffwwba....",
    "....awffwwba....", "....awwwwwba....", "....abbbbbba....", "....abbbbbba....", "....aaaaaaaa....",
  ],
  pill_bottle: [
    "................", ".....kkkkkk.....", ".....cccccc.....", "....abbbbbba....", "....abwwwwba....", "....abwffwba....",
    "....abwwwwba....", "....abbbbbba....", "....abbbbbba....", ".....aaaaaa.....",
  ],
  medkit: [
    "................", "....aaaaaaaa....", "...abbbbbbbba...", "...abbbffbbba...", "...abbbffbbba...", "...abffffffba...",
    "...abffffffba...", "...abbbffbbba...", "...abbbffbbba...", "...abbbbbbbba...", "....aaaaaaaa....",
  ],
  magazine: [
    "................", "...aaaaaaaaaa...", "...abbbbbbbba...", "...abwwwwwbba...", "...abwffffwba...", "...abwffffwba...",
    "...abwwwwwbba...", "...abcccccbba...", "...abbbbbbbba...", "...abcccbbbba...", "...abbbbbbbba...", "...aaaaaaaaaa...",
  ],
  newspaper: [
    "................", "..aaaaaaaaaaaa..", "..awwwwwwwwwwa..", "..awkkkkkkkkwa..", "..awwwwwwwwwwa..", "..awkkkwwkkkwa..",
    "..awkkkwwwwwwa..", "..awwwwwwkkkwa..", "..awkkkwwkkkwa..", "..awwwwwwwwwwa..", "..aaaaaaaaaaaa..",
  ],
  hammer: [
    "................", "........aaaa....", ".......abbbba...", "......abbbbbba..", ".......aahbba...", "......ahha.aa...",
    ".....ahha.......", "....ahha........", "...ahha.........", "..ahha..........", ".ahha...........", ".aa.............",
  ],
  saw: [
    "................", "..............aa", "............aabc", "..........aabcca", "........aabccca.", "......aabccca...",
    ".....abccca.....", "....hhbca.......", "...hhhha........", "..hh.hh.........", "..hhhh..........",
  ],
  screwdriver: [
    "................", "..............a.", ".............ab.", "............ab..", "...........ab...", "..........ab....",
    ".........ab.....", "........hh......", ".......hhh......", "......hhh.......", ".....hhh........", "....hh..........",
  ],
  wrench: [
    "................", "...........aa.aa", "...........abab.", "..........abbba.", "..........abba..", ".........abba...",
    "........abba....", ".......abba.....", "......abba......", ".....abba.......", "....abba........", "...abba.........",
    "...aba..........", "....a...........",
  ],
  crowbar: [
    "................", "............aa..", "...........abba.", "...........a.ba.", "..........aba...", ".........aba....",
    "........aba.....", ".......aba......", "......aba.......", ".....aba........", "....aba.........", "...aba..........",
    "..abba..........", "..aaa...........",
  ],
  knife: [
    "................", "..............a.", ".............aca", "............acba", "...........acba.", "..........acba..",
    ".........acba...", "........acba....", ".......hhaa.....", "......hhh.......", ".....hhh........", "....hhh.........", "....hh..........",
  ],
  pan: [
    "................", "....aaaaaa......", "...abbbbbba.....", "..abcccccbba....", "..abcccccbba....", "..abcccccbba....",
    "..abcccccbba....", "...abbbbbba.....", "....aaaaaahh....", "..........hhh...", "...........hhh..", "............hh..",
  ],
  rolling_pin: [
    "................", "...........hh...", "..........hha...", ".........abba...", "........abbba...", ".......abbba....",
    "......abbba.....", ".....abbba......", "....abbba.......", "...abba.........", "...hha..........", "..hh............",
  ],
  golf_club: [
    "................", "...........hh...", "..........hh....", ".........aa.....", "........aa......", ".......aa.......",
    "......aa........", ".....aa.........", "....aa..........", "...aa...........", "..abbb..........", "..abbba.........", "...aaa..........",
  ],
  pipe: [
    "................", "............aaa.", "...........abca.", "..........abca..", ".........abca...", "........abca....",
    ".......abca.....", "......abca......", ".....abca.......", "....abca........", "...abca.........", "...aaa..........",
  ],
  spiked_bat: [
    "................", "...........k.aa.", "..........k.abba", "...........abbbk", ".........kabbba.", "........abbba.k.",
    ".......abbba....", "......abbba.....", ".....abba.......", "....hha.........", "...hha..........", "..hha...........", "..hh............",
  ],
  sledgehammer: [
    "................", ".........aaaa...", "........abbbba..", ".......abbbbbba.", ".......abbbbbba.", "........abhbba..",
    ".......ahha.....", "......ahha......", ".....ahha.......", "....ahha........", "...ahha.........", "..ahha..........",
    ".ahha...........", ".aa.............",
  ],
  plank: [
    "................", "................", "............aaa.", "..........aabba.", "........aabbcba.", "......aabbcbba..",
    "....aabbcbba....", "..aabbcbba......", ".abbcbba........", ".abbbaa.........", "..aaa...........",
  ],
  nails: [
    "................", "................", "...a......a.....", "..aaa....aaa....", "...b......b.....", "...b...a..b.....",
    "...b..aaa.b.....", "...b...b..b.....", "...b...b........", ".......b..a.....", ".......b.aaa....", "..........b.....", "..........b.....",
  ],
  tape: [
    "................", "................", ".....aaaaaa.....", "....abbbbbba....", "...abbcccbbba...", "...abca..acba...",
    "...abca..acba...", "...abca..acba...", "...abbcccbbba...", "....abbbbbba....", ".....aaaaaa.....",
  ],
  cloth: [
    "................", "................", "...aaaaaaaaaa...", "...abbbbbbbba...", "...acccccccca...", "...abbbbbbbba...",
    "...acccccccca...", "...abbbbbbbba...", "...aaaaaaaaaa...",
  ],
  jerry_can: [
    "................", "........aaa.....", ".....aaaabbaa...", "....abbbbbbba...", "....abhhhhbba...", "....abbbbbbba...",
    "....abcbbbbba...", "....abcbbbbba...", "....abcbbbbba...", "....abbbbbbba...", "....aaaaaaaaa...",
  ],
  battery: [
    "................", "......kk........", ".....aaaa.......", ".....abba.......", ".....abba.......", ".....awwa.......",
    ".....awwa.......", ".....abba.......", ".....abba.......", ".....aaaa.......",
  ],
  flashlight: [
    "................", "..........aaa...", ".........acwca..", "........abwwba..", ".......abbwba...", "......abbba.....",
    ".....abbba......", "....abbba.......", "...abbba........", "...abba.........", "...aaa..........",
  ],
  lighter: [
    "................", "................", "......kc........", ".....abba.......", ".....abba.......", ".....abba.......",
    ".....abba.......", ".....abba.......", ".....aaaa.......",
  ],
  matchbox: [
    "................", "................", "................", "...aaaaaaaaa....", "...abbbbbbba....", "...abwwwwwba....",
    "...abbbbbbba....", "...aaaaaaaaa....",
  ],
  keys: [
    "................", "................", "....aaa.........", "...a...a........", "...a...a........", "....aaabbbbbbb..",
    "..........b.b...", "............b...",
  ],
  radio_item: [
    "................", "..........a.....", "..........a.....", "......aaaaaa....", ".....abbbbbba...", ".....abkkkkba...",
    ".....abkkkkba...", ".....abbbbbba...", ".....abwbwbba...", ".....abbwbwba...", ".....abbbbbba...", "......aaaaaa....",
  ],
  cheese: [
    "................", "................", "................", "..........aaa...", "........aabbba..", "......aabbbbba..",
    "....aabbbbcbba..", "..aabbbcbbbbba..", "..abbbbbbbbbba..", "..abbcbbbbbcba..", "..aaaaaaaaaaaa..",
  ],
  banana: [
    "................", "................", "............aa..", "...........abba.", "..........abba..", "..........abba..",
    ".........abba...", "........abba....", "......aabba.....", "..aaaabbba......", "..abbbbaa.......", "...aaaa.........",
  ],
  sandwich: [
    "................", "................", "................", "...aaaaaaaaa....", "..abbbbbbbbba...", "..acccccccccca..",
    "..agggggggggga..", "..affffffffffa..", "..abbbbbbbbbba..", "...aaaaaaaaaa...",
  ],
  tray: [
    "................", "................", "................", "................", "..aaaaaaaaaaaa..", "..abffbggbwwba..",
    "..abffbggbwwba..", "..abbbbbbbbbba..", "..aaaaaaaaaaaa..",
  ],
  needle: [
    "................", "..............a.", ".............ab.", "............ab..", "...........ab...", "..........ab....",
    ".........ab.....", "........ab......", ".......ab.......", "......ab........", ".....aa.........", "....a..a........", "....a..a........", ".....aa.........",
  ],
  cards: [
    "................", "................", "....aaaaaa......", "....awwwwaaaa...", "....awrrwawwa...", "....awrrwawwa...",
    "....awwwwarra...", "....aaaaaawwa...", ".......awwwwa...", ".......aaaaaa...",
  ],
  spear: [
    "..............a.", ".............aca", "............acb.", "...........hh...", "..........hh....", ".........hh.....",
    "........hh......", ".......hh.......", "......hh........", ".....hh.........", "....hh..........", "...hh...........", "..hh............", ".hh.............",
  ],
  tube: [
    "................", "................", "....aaaaaaa.....", "...abbbbbbbaa...", "...abwwwwwbbka..", "...abbbbbbbaa...", "....aaaaaaa.....",
  ],
};

/** Each county item's picture: [template, palette colours as hex, keyed by the template's letters]. */
export const COUNTY_ART: Record<string, [string, Record<string, string>]> = {};
{
  const art = (name: string, template: string, colors: Record<string, string>) => { COUNTY_ART[name] = [template, colors]; };
  const TIN = { a: "#5a5a5e", b: "#b8b8bc", c: "#8a8a8e" };
  for (const [name, label] of [["canned_soup", "#c83a2a"], ["canned_chili", "#8a2a1a"], ["canned_corn", "#e8c030"], ["canned_peas", "#4a8a3a"],
    ["canned_peaches", "#f0a050"], ["canned_tuna", "#3a6aa8"], ["canned_sardines", "#6a8aa0"], ["canned_ham", "#d86a6a"], ["canned_spaghetti", "#e07a2a"],
    ["canned_carrots", "#e8762a"], ["beer_can", "#c8a030"], ["empty_can", "#9a9a9e"]] as const) art(name, "can", { ...TIN, w: label });
  const JAR = { a: "#6a5a4a" };
  art("peanut_butter", "jar", { ...JAR, b: "#b87a3a", c: "#d89a5a", k: "#c83a2a", w: "#f0e8d0", f: "#8a4a1a" });
  art("jam", "jar", { ...JAR, b: "#8a1a3a", c: "#b83a5a", k: "#e8e0d0", w: "#f0e8d0", f: "#c83a5a" });
  art("honey_jar", "jar", { ...JAR, b: "#d8a020", c: "#f0c850", k: "#8a5a2a", w: "#f0e8d0", f: "#c88a10" });
  const BOX = (b: string, f: string, c = "#ffffff") => ({ a: "#3a3a3a", b, c, d: "#2a2a2a", w: "#f0f0e8", f });
  art("cereal", "box", BOX("#d8a020", "#c83a2a"));
  art("crackers", "box", BOX("#c83a2a", "#e8c070"));
  art("dried_pasta", "box", BOX("#3a5aa8", "#e8d080"));
  art("oatmeal", "box", BOX("#8a6a3a", "#e8d8b0"));
  art("frozen_pizza", "box", BOX("#c83a2a", "#e8a040"));
  art("coffee_tin", "can", { ...TIN, b: "#3a2a1e", c: "#5a4a3e", w: "#c83a2a" });
  art("salt", "can", { ...TIN, b: "#2a5aa8", c: "#4a7ac8", w: "#f0f0f0" });
  art("first_aid_kit", "medkit", { a: "#6a1a1a", b: "#e8e8e0", f: "#c83a2a" });
  art("matches", "matchbox", { a: "#3a2a1a", b: "#c83a2a", w: "#f0e060" });
  const BAG = (b: string, f: string) => ({ a: "#3a3a3a", b, c: "#ffffff", w: "#f0f0e8", f });
  art("potato_chips", "bag", BAG("#e8c030", "#c87a2a"));
  art("popcorn", "bag", BAG("#c83a2a", "#f0e8c0"));
  art("rice_bag", "bag", BAG("#e8e8e0", "#8aa05a"));
  art("flour_bag", "bag", BAG("#e8e0d0", "#c8a060"));
  art("beef_jerky", "bag", BAG("#6a3a1a", "#a86a3a"));
  art("candy_bar", "bar", { a: "#3a1a0a", b: "#6a3a1a", w: "#e8c030" });
  art("granola_bar", "bar", { a: "#5a3a1a", b: "#c8a060", w: "#5a8a3a" });
  const BOTTLE = (b: string, c: string, f: string, k = "#e8e8e8") => ({ a: "#3a4a5a", b, c, w: "#f0f0e8", f, k });
  art("bottled_water", "bottle", BOTTLE("#9ac8e8", "#c8e8f8", "#3a8ad8", "#3a6ab8"));
  art("empty_water_bottle", "bottle", BOTTLE("#d8e8f0", "#f0f8ff", "#9ab8d0", "#3a6ab8"));
  art("cola_bottle", "bottle", BOTTLE("#3a1a0a", "#5a2a1a", "#c83a2a", "#c83a2a"));
  art("disinfectant", "bottle", BOTTLE("#e8e8e0", "#ffffff", "#c83a2a", "#3a6ab8"));
  art("wine_bottle", "wine", { a: "#1a2a1a", b: "#2a4a2a", c: "#4a6a4a", k: "#6a1a2a", w: "#f0e8d0", f: "#8a1a2a" });
  art("whiskey_bottle", "wine", { a: "#3a2a0a", b: "#b87a2a", c: "#d89a4a", k: "#2a2a2a", w: "#f0e8d0", f: "#3a2a1a" });
  const CARTON = (b: string, f: string) => ({ a: "#3a3a3a", b, c: "#ffffff", w: "#f8f8f0", f });
  art("milk_carton", "carton", CARTON("#3a6ac8", "#3a6ac8"));
  art("orange_juice", "carton", CARTON("#f0a020", "#f07a10"));
  art("ice_cream", "carton", CARTON("#e8a0b0", "#8a4a2a"));
  const PILLS = (b: string, f: string) => ({ a: "#5a3a1a", b, c: "#f0f0f0", k: "#f0f0f0", w: "#f0f0e8", f });
  art("painkillers", "pill_bottle", PILLS("#e87a2a", "#c83a2a"));
  art("vitamins", "pill_bottle", PILLS("#e8a020", "#3a8a3a"));
  art("beta_blockers", "pill_bottle", PILLS("#e87a2a", "#3a5aa8"));
  art("sleeping_pills", "pill_bottle", PILLS("#e87a2a", "#6a3a8a"));
  art("antidepressants", "pill_bottle", PILLS("#e87a2a", "#3aa8a8"));
  art("sterile_bandage", "tape", { a: "#8a8478", b: "#f4f2ec", c: "#dcd8cc" });
  art("alcohol_wipes", "tube", { a: "#3a5a8a", b: "#e8e8f0", w: "#3a6ab8", k: "#c83a2a" });
  art("suture_needle", "needle", { a: "#6a6a6e", b: "#d8dce0" });
  art("sewing_needle", "needle", { a: "#6a6a6e", b: "#d8dce0" });
  art("tweezers", "screwdriver", { a: "#6a6a6e", b: "#d8dce0", h: "#b8bcc0" });
  // Books by the colour of their skill; magazines and paperbacks in the colours of the rack.
  const SKILL_COLOR: Record<string, string> = {
    carpentry: "#8a5a2a", cooking: "#c83a2a", farming: "#4a8a3a", first_aid: "#e8e8e0", electrical: "#e8c030", metalworking: "#6a6a7a",
    mechanics: "#3a5aa8", tailoring: "#a83a8a", fishing: "#3a8aa8", trapping: "#6a4a2a", foraging: "#6a8a3a",
  };
  for (const [skill, color] of Object.entries(SKILL_COLOR)) {
    for (let vol = 1; vol <= 3; vol++) art(`${skill}_book_${vol}`, "book", { a: "#2a1a0a", b: color, c: vol === 1 ? "#ffffff" : vol === 2 ? "#e8c030" : "#c83a2a", d: "#4a3a2a", w: "#f2f0e6" });
  }
  const MAG = (b: string, f: string) => ({ a: "#3a3a3a", b, c: "#f0f0e8", w: "#ffffff", f });
  art("weekend_builder", "magazine", MAG("#e8a020", "#8a5a2a"));
  art("generator_guide", "magazine", MAG("#e8d020", "#3a3a3a"));
  art("country_cooking", "magazine", MAG("#c83a2a", "#e8c070"));
  art("rod_and_reel", "magazine", MAG("#3a8aa8", "#e8e8f0"));
  art("trappers_almanac", "magazine", MAG("#6a4a2a", "#c8a060"));
  art("wiring_made_easy", "magazine", MAG("#3a3a8a", "#e8c030"));
  art("home_mechanic", "magazine", MAG("#8a1a1a", "#b8bcc0"));
  art("glossy_magazine", "magazine", MAG("#e84a8a", "#f0c0d0"));
  art("comic_book", "magazine", MAG("#3a6ae8", "#e8e030"));
  art("newspaper", "newspaper", { a: "#5a5a5a", w: "#e8e4d8", k: "#6a6a6a" });
  art("crossword_book", "newspaper", { a: "#3a3a3a", w: "#f0f0f0", k: "#1a1a1a" });
  art("paperback_novel", "book", { a: "#2a1a0a", b: "#5a3a8a", c: "#e8c030", d: "#3a2a4a", w: "#f2f0e6" });
  art("playing_cards", "cards", { a: "#3a3a3a", w: "#f8f8f0", r: "#c8201a" });
  art("county_map", "newspaper", { a: "#5a4a2a", w: "#e8dcb8", k: "#6a8a4a" });
  // Tools and weapons.
  const STEEL = { a: "#3a3a3e", b: "#b8bcc0", c: "#e8ecf0", d: "#7a7e82" };
  art("hammer", "hammer", { a: "#2a2a2c", b: "#8a8e92", h: "#8a5a2a" });
  art("saw", "saw", { a: "#3a3a3e", b: "#c8ccd0", c: "#e8ecf0", h: "#c83a2a" });
  art("screwdriver", "screwdriver", { a: "#3a3a3e", b: "#c8ccd0", h: "#e8c030" });
  art("wrench", "wrench", STEEL);
  art("pipe_wrench", "wrench", { a: "#3a1a1a", b: "#c83a2a", c: "#e86a5a", d: "#8a1a1a" });
  art("can_opener", "screwdriver", { a: "#3a3a3e", b: "#c8ccd0", h: "#3a3a3a" });
  art("needle_nose_pliers", "screwdriver", { a: "#3a3a3e", b: "#8a8e92", h: "#c83a2a" });
  art("crowbar", "crowbar", { a: "#3a0a0a", b: "#c8201a" });
  art("tire_iron", "crowbar", { a: "#1a1a1a", b: "#5a5a5e" });
  art("nightstick", "pipe", { a: "#0a0a0a", b: "#2a2a2c", c: "#4a4a4e" });
  art("lead_pipe", "pipe", { a: "#2a2a2e", b: "#6a6e72", c: "#9a9ea2" });
  art("pool_cue", "pipe", { a: "#3a2a1a", b: "#c8a060", c: "#e8c890" });
  art("sledgehammer", "sledgehammer", { a: "#1a1a1a", b: "#5a5a5e", h: "#b88a4a" });
  art("kitchen_knife", "knife", { a: "#3a3a3e", b: "#c8ccd0", c: "#f0f4f8", h: "#2a2a2a" });
  art("hunting_knife", "knife", { a: "#3a3a3e", b: "#9a9ea2", c: "#d8dce0", h: "#6a3a1a" });
  art("frying_pan", "pan", { a: "#1a1a1a", b: "#3a3a3e", c: "#2a2a2c", h: "#1a1a1a" });
  art("rolling_pin", "rolling_pin", { a: "#6a4a2a", b: "#d8b080", h: "#a8804a" });
  art("golf_club", "golf_club", { a: "#6a6e72", b: "#c8ccd0", h: "#1a1a1a" });
  art("spiked_bat", "spiked_bat", { a: "#6a4a26", b: "#c8a06a", h: "#2a2a2a", k: "#9a9ea2" });
  art("spear", "spear", { a: "#3a3a3e", b: "#b8bcc0", c: "#e8ecf0", h: "#8a6a3a" });
  art("plank", "plank", { a: "#6a4a26", b: "#b88a52", c: "#d8aa72" });
  art("nails", "nails", { a: "#5a5a5e", b: "#9a9ea2" });
  art("screws", "nails", { a: "#6a6a4e", b: "#c8c090" });
  art("duct_tape", "tape", { a: "#4a4a4e", b: "#9a9ea2", c: "#c8ccd0" });
  art("rope", "tape", { a: "#6a4a26", b: "#c8a060", c: "#e8c890" });
  art("electric_wire", "tape", { a: "#6a2a1a", b: "#d86a3a", c: "#e8a070" });
  art("thread", "tape", { a: "#3a3a3a", b: "#f0f0f0", c: "#c8c8c8" });
  art("wood_glue", "bottle", BOTTLE("#f0f0e8", "#ffffff", "#e8a020", "#c83a2a"));
  art("bed_sheet", "cloth", { a: "#8a8aa0", b: "#e8e8f8", c: "#c8c8e0" });
  art("rag", "cloth", { a: "#6a5a4a", b: "#c8b8a0", c: "#a89880" });
  art("sheet_rope", "tape", { a: "#8a8aa0", b: "#e8e8f8", c: "#c8c8e0" });
  art("toilet_paper", "tape", { a: "#a8a8a0", b: "#f8f8f0", c: "#e0e0d8" });
  art("scrap_metal", "nails", { a: "#4a3a2a", b: "#8a6a4a" });
  art("sheet_metal", "cloth", { a: "#5a5e62", b: "#b8bcc0", c: "#9a9ea2" });
  art("gas_can", "jerry_can", { a: "#3a0a0a", b: "#8a2a22", c: "#a84a42", h: "#2a2a2a" });
  art("full_gas_can", "jerry_can", { a: "#3a0a0a", b: "#c8201a", c: "#e86a5a", h: "#2a2a2a" });
  art("propane_tank", "jerry_can", { a: "#3a3a3e", b: "#e8e8e0", c: "#ffffff", h: "#6a6a6a" });
  art("car_battery", "matchbox", { a: "#1a1a1a", b: "#2a2a2c", w: "#c83a2a" });
  art("batteries", "battery", { a: "#1a1a1a", b: "#c8a020", w: "#1a1a1a", k: "#c8c8c8" });
  art("flashlight", "flashlight", { a: "#1a1a1a", b: "#3a3a3e", c: "#8a8e92", w: "#fff8c0" });
  art("lighter", "lighter", { a: "#1a1a1a", b: "#c83a2a", k: "#8a8e92", c: "#f0c040" });
  art("candle", "battery", { a: "#8a8470", b: "#f0ecd8", w: "#e8e4d0", k: "#3a2a1a" });
  art("lightbulb", "bottle", BOTTLE("#f8f4d0", "#ffffff", "#e8e0a0", "#8a8e92"));
  art("car_keys", "keys", { a: "#6a6a6e", b: "#b8bcc0" });
  art("portable_radio", "radio_item", { a: "#1a1a1a", b: "#3a3a3e", k: "#6a6a6e", w: "#c8c8c8" });
  art("walkie_talkie", "radio_item", { a: "#1a1a1a", b: "#2a3a2a", k: "#3a4a3a", w: "#c8c8c8" });
  // Fresh food.
  art("cheese", "cheese", { a: "#8a6a10", b: "#e8c030", c: "#c8a020" });
  art("butter", "matchbox", { a: "#8a7a30", b: "#f0e080", w: "#ffffff" });
  art("deli_ham", "cloth", { a: "#8a3a3a", b: "#e89a9a", c: "#d87a7a" });
  art("banana", "banana", { a: "#8a6a10", b: "#f0d040" });
  art("spoiled_food", "sandwich", { a: "#3a3a1a", b: "#6a7a3a", c: "#8a8a4a", g: "#4a5a2a", f: "#7a6a3a" });
  art("sandwich", "sandwich", { a: "#6a4a26", b: "#d8a860", c: "#e8c890", g: "#5aa83a", f: "#e89a9a" });
  art("tv_dinner", "tray", { a: "#6a6a6e", b: "#c8ccd0", f: "#8a4a2a", g: "#5a8a3a", w: "#e8d070" });
  const FRUIT = (b: string, g = "#4c9a2a") => ({ a: "#3a2a1a", b, c: "#ffffff", d: "#2a1a0a", h: "#6a4a26", g });
  art("tomato", "apple", FRUIT("#d83a2a"));
  art("orange", "apple", FRUIT("#f08a1a"));
  art("onion", "apple", FRUIT("#c8a060", "#8aa05a"));
  art("bell_pepper", "apple", FRUIT("#3aa83a", "#2a6a1a"));
  art("cabbage", "apple", FRUIT("#8ac86a", "#5a8a3a"));
  art("lettuce", "apple", FRUIT("#6ac84a", "#4a8a2a"));
  art("grapes", "berries", { a: "#2a0a2a", b: "#6a2a8a", c: "#9a5ab8", g: "#4c9a2a" });
  art("strawberries", "berries", { a: "#5a0a0a", b: "#d8201a", c: "#f86a5a", g: "#4c9a2a" });
  art("hot_dogs", "meat", { a: "#6a2a1a", b: "#c86a4a", c: "#e89a7a", d: "#8a3a2a", e: "#e8b89a", w: "#f0d0c0" });
  art("ground_beef", "meat", { a: "#5a0a0a", b: "#c83a3a", c: "#e86a6a", d: "#8a1a1a", e: "#f0d0d0", w: "#fff0f0" });
  // Bags.
  art("school_bag", "backpack", { a: "#1a2a4a", b: "#3a5aa8", c: "#2a4a88", d: "#1a2a5a", w: "#e8c030" });
  art("hiking_bag", "backpack", { a: "#2a3a1a", b: "#5a7a3a", c: "#4a6a2a", d: "#2a4a1a", w: "#c83a2a" });
  art("duffel_bag", "backpack", { a: "#1a1a1a", b: "#3a3a3e", c: "#2a2a2c", d: "#1a1a1c", w: "#8a8e92" });
  // Blades on the sword and axe drawings the game already has.
  art("machete", "sword", { a: "#3a3a3e", b: "#b8bcc0", c: "#e8ecf0", d: "#7a7e82", h: "#2a2a2a", H: "#1a1a1a" });
  art("katana", "sword", { a: "#3a3a3e", b: "#d8dce0", c: "#ffffff", d: "#9a9ea2", h: "#1a1a1a", H: "#6a1a1a" });
  art("fire_axe", "axe", { a: "#5a0a0a", b: "#c8201a", c: "#e86a5a", d: "#8a1a1a", h: "#e8c030", H: "#8a6a10" });
  art("wood_axe", "axe", { a: "#3a3a3e", b: "#9a9ea2", c: "#d8dce0", d: "#6a6e72", h: "#8a5a2a", H: "#5a3a1a" });
  art("hatchet", "axe", { a: "#3a3a3e", b: "#b8bcc0", c: "#e8ecf0", d: "#7a7e82", h: "#3a3a3a", H: "#1a1a1a" });
}
