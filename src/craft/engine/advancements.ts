/**
 * Advancements: small goals that mark a player's progress — the first log,
 * the first iron, the first night slept through — each announced with a toast
 * when it is earned.
 *
 * Titles and descriptions are this game's own. Each is checked against the
 * player's state (inventory, position, level) or an event (a kill, a meal, a
 * night in bed), never against a separate counter that could drift from what
 * actually happened.
 */
import { ingredientIds } from "./crafting";
import type { Dimension } from "./dimension";
import type { Inventory } from "./inventory";

export type Trigger =
  | { kind: "has"; items: string[] }
  | { kind: "armor" }
  | { kind: "below"; y: number }
  | { kind: "above"; y: number }
  | { kind: "level"; level: number }
  | { kind: "kill"; hostile: boolean }
  | { kind: "sleep" }
  | { kind: "eat" }
  | { kind: "enchant" }
  | { kind: "brew" }
  | { kind: "dimension"; dimension: Dimension }
  /** Something that happened once, named: the dragon slain, a stronghold found, a gateway taken. */
  | { kind: "event"; event: "dragon" | "stronghold" | "gateway" | "city" | "levitate" | "waystone" | "tame" | "catch" | "badge" | "champion" | "casino_win" | "jackpot" | "millionaire" | "link_win" | "trade" | "copium" | "space" | "totality" };

export interface Advancement {
  id: string;
  title: string;
  description: string;
  /** Item name drawn on the toast and in the list. */
  icon: string;
  trigger: Trigger;
}

const has = (...items: string[]): Trigger => ({ kind: "has", items });

export const ADVANCEMENTS: readonly Advancement[] = [
  { id: "timber", title: "Timber!", description: "Punch a tree until a log comes loose", icon: "oak_log", trigger: has("#logs") },
  { id: "workbench", title: "Workbench", description: "Make a crafting table from planks", icon: "crafting_table", trigger: has("crafting_table") },
  { id: "light", title: "Light the Way", description: "Make torches for the dark", icon: "torch", trigger: has("torch") },
  { id: "rock", title: "Rock Solid", description: "Dig out some cobblestone", icon: "cobblestone", trigger: has("cobblestone", "cobbled_deepslate") },
  { id: "upgrade", title: "Upgrade!", description: "Make a stone pickaxe", icon: "stone_pickaxe", trigger: has("stone_pickaxe") },
  { id: "furnace", title: "Fire It Up", description: "Build a furnace", icon: "furnace", trigger: has("furnace") },
  { id: "iron", title: "Iron Age", description: "Smelt an iron ingot", icon: "iron_ingot", trigger: has("iron_ingot") },
  { id: "iron_pick", title: "Heavy Metal", description: "Make an iron pickaxe", icon: "iron_pickaxe", trigger: has("iron_pickaxe") },
  { id: "suited", title: "Suited Up", description: "Wear a piece of armour", icon: "iron_chestplate", trigger: { kind: "armor" } },
  { id: "deep", title: "Deep Down", description: "Dig down into the deepslate, below y=16", icon: "cobbled_deepslate", trigger: { kind: "below", y: 16 } },
  { id: "diamond", title: "Shiny!", description: "Find a diamond", icon: "diamond", trigger: has("diamond") },
  { id: "sharp", title: "Sharp", description: "Make a diamond sword", icon: "diamond_sword", trigger: has("diamond_sword") },
  { id: "summit", title: "Summit", description: "Stand higher than y=110", icon: "stone", trigger: { kind: "above", y: 110 } },
  { id: "hunter", title: "Monster Slayer", description: "Defeat a hostile mob", icon: "iron_sword", trigger: { kind: "kill", hostile: true } },
  { id: "rested", title: "Well Rested", description: "Sleep through the night in a bed", icon: "red_bed", trigger: { kind: "sleep" } },
  { id: "snack", title: "Snack Time", description: "Eat something", icon: "apple", trigger: { kind: "eat" } },
  { id: "harvest", title: "Harvest Time", description: "Gather wheat from a farm", icon: "wheat", trigger: has("wheat") },
  { id: "bread", title: "Bread Winner", description: "Bake bread", icon: "bread", trigger: has("bread") },
  { id: "wool", title: "Fluffy", description: "Get wool from a sheep", icon: "white_wool", trigger: has("#wool") },
  { id: "archer", title: "Archer", description: "Make a bow", icon: "bow", trigger: has("bow") },
  { id: "bucket", title: "Bucket List", description: "Fill a bucket with water", icon: "water_bucket", trigger: has("water_bucket") },
  { id: "lava", title: "Hot Stuff", description: "Carry lava in a bucket", icon: "lava_bucket", trigger: has("lava_bucket") },
  { id: "kaboom", title: "Kaboom", description: "Get your hands on TNT", icon: "tnt", trigger: has("tnt") },
  { id: "level10", title: "Seasoned", description: "Reach experience level 10", icon: "gold_ingot", trigger: { kind: "level", level: 10 } },
  { id: "enchanter", title: "Enchanter", description: "Enchant an item at an enchanting table", icon: "enchanting_table", trigger: { kind: "enchant" } },
  { id: "brewery", title: "Local Brewery", description: "Brew a potion", icon: "potion_healing", trigger: { kind: "brew" } },
  { id: "nether", title: "Deeper Still", description: "Step through a portal into the Nether", icon: "obsidian", trigger: { kind: "dimension", dimension: "nether" } },
  { id: "blaze", title: "Into the Fire", description: "Take a blaze rod from a blaze", icon: "blaze_rod", trigger: has("blaze_rod") },
  { id: "debris", title: "Buried Treasure", description: "Dig out ancient debris", icon: "ancient_debris", trigger: has("ancient_debris") },
  { id: "netherite", title: "Forged in Fire", description: "Make a netherite ingot", icon: "netherite_ingot", trigger: has("netherite_ingot") },
  { id: "stronghold", title: "Eye Spy", description: "Follow the eyes of ender into a stronghold", icon: "eye_of_ender", trigger: { kind: "event", event: "stronghold" } },
  { id: "end", title: "The End?", description: "Drop through the portal into the End", icon: "end_stone", trigger: { kind: "dimension", dimension: "end" } },
  { id: "dragon", title: "Free the End", description: "Slay the Ender Dragon", icon: "dragon_egg", trigger: { kind: "event", event: "dragon" } },
  { id: "egg", title: "The Next Generation", description: "Hold the dragon's egg", icon: "dragon_egg", trigger: has("dragon_egg") },
  { id: "gateway", title: "Remote Getaway", description: "Escape the island through a gateway", icon: "ender_pearl", trigger: { kind: "event", event: "gateway" } },
  { id: "elytra", title: "Sky's the Limit", description: "Find a pair of elytra", icon: "elytra", trigger: has("elytra") },
  { id: "city", title: "The City at the End of the Game", description: "Walk into an End city", icon: "purpur_block", trigger: { kind: "event", event: "city" } },
  { id: "levitate", title: "Great View From Up Here", description: "Float fifty blocks up on a shulker's levitation", icon: "shulker_shell", trigger: { kind: "event", event: "levitate" } },
  { id: "box", title: "Pack It Up", description: "Make a shulker box", icon: "shulker_box", trigger: has("shulker_box") },
  { id: "tame", title: "Best Friends Forever", description: "Tame a wolf with a bone", icon: "bone", trigger: { kind: "event", event: "tame" } },
  { id: "waystone", title: "Well Travelled", description: "Travel from one waystone to another", icon: "waystone", trigger: { kind: "event", event: "waystone" } },
  // The critter modes.
  { id: "catch", title: "Gotcha!", description: "Catch a wild critter in an orb", icon: "capture_orb", trigger: { kind: "event", event: "catch" } },
  { id: "badge", title: "Badge of Honour", description: "Win a badge from a gym leader", icon: "gold_orb", trigger: { kind: "event", event: "badge" } },
  { id: "champion", title: "Champion of the Region", description: "Defeat the Champion at the end of the road", icon: "star_orb", trigger: { kind: "event", event: "champion" } },
  { id: "copium", title: "Cope Harder", description: "Defeat Maximus Hype, the CEO of Team Copium", icon: "silver_orb", trigger: { kind: "event", event: "copium" } },
  { id: "link_win", title: "GG", description: "Win a link battle against another player", icon: "capture_orb", trigger: { kind: "event", event: "link_win" } },
  { id: "trade", title: "Fair Trade", description: "Trade a critter with another player", icon: "emerald", trigger: { kind: "event", event: "trade" } },
  // Space.
  { id: "space", title: "We Have Liftoff", description: "Launch a starship into orbit", icon: "starship", trigger: { kind: "event", event: "space" } },
  { id: "totality", title: "Path of Totality", description: "Stand under a total eclipse of the Sun", icon: "daylight_detector", trigger: { kind: "event", event: "totality" } },
  // The casino.
  { id: "casino_win", title: "Winner Winner", description: "Win at a casino table", icon: "gold_nugget", trigger: { kind: "event", event: "casino_win" } },
  { id: "jackpot", title: "Stonks", description: "Win a hundred times your stake at once", icon: "gold_block", trigger: { kind: "event", event: "jackpot" } },
  { id: "millionaire", title: "Number Go Up", description: "Hold a million dollars", icon: "diamond_block", trigger: { kind: "event", event: "millionaire" } },
];

export function advancement(id: string): Advancement | undefined {
  return ADVANCEMENTS.find((a) => a.id === id);
}

/** Item ids each "has" advancement accepts, resolved once. */
const HAS_IDS = new Map<string, Set<number>>();
function idsFor(a: Advancement): Set<number> {
  let ids = HAS_IDS.get(a.id);
  if (!ids) {
    ids = new Set(a.trigger.kind === "has" ? a.trigger.items.flatMap((n) => ingredientIds(n)) : []);
    HAS_IDS.set(a.id, ids);
  }
  return ids;
}

export interface PlayerState {
  inventory: Inventory;
  y: number;
  level: number;
  /** Heights only count in the overworld: the Nether's floor is not "deep down". */
  dimension?: Dimension;
}

export type AdvancementEvent =
  | { kind: "kill"; hostile: boolean } | { kind: "sleep" } | { kind: "eat" } | { kind: "enchant" } | { kind: "brew" }
  | { kind: "dimension"; dimension: Dimension } | { kind: "dragon" } | { kind: "stronghold" } | { kind: "gateway" }
  | { kind: "city" } | { kind: "levitate" } | { kind: "waystone" } | { kind: "tame" } | { kind: "catch" } | { kind: "badge" } | { kind: "champion" }
  | { kind: "casino_win" } | { kind: "jackpot" } | { kind: "millionaire" } | { kind: "link_win" } | { kind: "trade" } | { kind: "copium" } | { kind: "space" } | { kind: "totality" };

/**
 * Which not-yet-earned advancements the player has now earned: from their
 * state, and from an event if one just happened. Pure — the caller records them.
 */
export function newlyEarned(done: ReadonlySet<string>, state: PlayerState, event?: AdvancementEvent): Advancement[] {
  const out: Advancement[] = [];
  let held: Set<number> | null = null;
  for (const a of ADVANCEMENTS) {
    if (done.has(a.id)) continue;
    const t = a.trigger;
    let earned = false;
    switch (t.kind) {
      case "has": {
        if (!held) {
          held = new Set<number>();
          for (const s of [...state.inventory.slots, ...state.inventory.armor, state.inventory.offhand]) if (s) held.add(s.id);
        }
        for (const id of idsFor(a)) if (held.has(id)) { earned = true; break; }
        break;
      }
      case "armor": earned = state.inventory.armor.some((s) => !!s); break;
      case "below": earned = (state.dimension ?? "overworld") === "overworld" && state.y < t.y; break;
      case "above": earned = (state.dimension ?? "overworld") === "overworld" && state.y > t.y; break;
      case "level": earned = state.level >= t.level; break;
      case "kill": earned = event?.kind === "kill" && (!t.hostile || event.hostile); break;
      case "sleep": earned = event?.kind === "sleep"; break;
      case "eat": earned = event?.kind === "eat"; break;
      case "enchant": earned = event?.kind === "enchant"; break;
      case "brew": earned = event?.kind === "brew"; break;
      case "dimension": earned = event?.kind === "dimension" && event.dimension === t.dimension; break;
      case "event": earned = event?.kind === t.event; break;
    }
    if (earned) out.push(a);
  }
  return out;
}
