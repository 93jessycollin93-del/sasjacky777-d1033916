/**
 * Lucky blocks (after the Lucky Block mod): a yellow block with a question
 * mark that, broken, does something — mostly good, sometimes terrible, now
 * and then just strange. This file only decides; the game carries each
 * outcome out (Game.luckyOutcome), so the table can be tested and read in
 * one place.
 */
import { B, WOOL_COLORS } from "./blocks";
import { ENCHANTMENTS, enchantedBook } from "./enchanting";
import { itemByName, type ItemStack, type StatusEffect } from "./items";
import type { MobKind } from "./mobs";

export type LuckyAction =
  | { kind: "drop"; stacks: ItemStack[] }
  | { kind: "spawn"; mob: MobKind; count: number; tame?: boolean; baby?: boolean }
  | { kind: "tnt"; count: number; fuse: number }
  | { kind: "blocks"; list: [number, number, number, number, number][] }
  | { kind: "effect"; effect: StatusEffect; seconds: number; amp: number }
  | { kind: "xp"; amount: number }
  | { kind: "fireworks"; count: number }
  | { kind: "lightning" }
  | { kind: "launch"; height: number };

export interface LuckyOutcome {
  id: string;
  /** Good, bad or just strange. */
  mood: "good" | "bad" | "odd";
  /** Shown to whoever broke it. */
  message: string;
  actions: LuckyAction[];
}

const stack = (name: string, count = 1, extra: Partial<ItemStack> = {}): ItemStack => ({ id: itemByName(name).id, count, ...extra });

type Maker = (random: () => number) => LuckyOutcome;

const GARDEN = [B.POPPY, B.DANDELION, B.CORNFLOWER, B.ALLIUM, B.OXEYE_DAISY];

const OUTCOMES: [number, Maker][] = [
  [10, () => ({ id: "diamonds", mood: "good", message: "Diamonds!", actions: [{ kind: "drop", stacks: [stack("diamond", 4)] }] })],
  [8, () => ({ id: "iron_kit", mood: "good", message: "A full set of iron.", actions: [{ kind: "drop", stacks: ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots", "iron_sword", "iron_pickaxe"].map((n) => stack(n)) }] })],
  [4, () => ({ id: "diamond_sword", mood: "good", message: "An enchanted diamond sword.", actions: [{ kind: "drop", stacks: [stack("diamond_sword", 1, { ench: { sharpness: 3, looting: 2 } })] }] })],
  [8, () => ({ id: "feast", mood: "good", message: "A feast.", actions: [{ kind: "drop", stacks: [stack("cooked_beef", 8), stack("bread", 6), stack("golden_apple", 2), stack("apple", 4)] }] })],
  [6, (r) => ({ id: "books", mood: "good", message: "Old books of power.", actions: [{ kind: "drop", stacks: [0, 1, 2].map(() => { const e = ENCHANTMENTS[Math.floor(r() * ENCHANTMENTS.length)]; return enchantedBook(e.name, e.maxLevel); }) }] })],
  [7, () => ({ id: "xp", mood: "good", message: "A shower of experience.", actions: [{ kind: "xp", amount: 120 }] })],
  [5, () => ({ id: "pets", mood: "good", message: "A pair of wolves, and they like you.", actions: [{ kind: "spawn", mob: "wolf", count: 2, tame: true }, { kind: "drop", stacks: [stack("bone", 6)] }] })],
  [6, () => ({ id: "ores", mood: "good", message: "A column of ore.", actions: [{ kind: "blocks", list: [[0, 0, 0, B.GOLD_BLOCK, 0], [0, 1, 0, B.IRON_BLOCK, 0], [0, 2, 0, B.EMERALD_BLOCK, 0], [0, 3, 0, B.LAPIS_BLOCK, 0], [0, 4, 0, B.REDSTONE_BLOCK, 0]] }] })],
  [5, () => ({ id: "potions", mood: "good", message: "Strength and speed.", actions: [{ kind: "effect", effect: "strength", seconds: 120, amp: 1 }, { kind: "effect", effect: "speed", seconds: 120, amp: 1 }] })],
  [4, () => ({ id: "elytra", mood: "good", message: "Wings!", actions: [{ kind: "drop", stacks: [stack("elytra"), stack("firework_rocket", 16, { fw: { flight: 2, bursts: [] } })] }] })],
  [6, () => ({ id: "fireworks", mood: "odd", message: "A celebration.", actions: [{ kind: "fireworks", count: 8 }] })],
  [5, () => ({ id: "pig_party", mood: "odd", message: "Pig party!", actions: [{ kind: "spawn", mob: "pig", count: 8, baby: true }] })],
  [5, () => ({ id: "rainbow", mood: "odd", message: "A rainbow.", actions: [{ kind: "blocks", list: WOOL_COLORS.map((c, i): [number, number, number, number, number] => [0, i, 0, B.WHITE_WOOL + WOOL_COLORS.indexOf(c), 0]) }] })],
  [4, () => ({ id: "garden", mood: "odd", message: "A garden grows.", actions: [{ kind: "blocks", list: [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz): [number, number, number, number, number] => [dx, 0, dz, GARDEN[(dx * 3 + dz + 4) % GARDEN.length], 0])) }] })],
  [9, () => ({ id: "tnt", mood: "bad", message: "Uh oh. Run.", actions: [{ kind: "tnt", count: 3, fuse: 50 }] })],
  [8, (r) => ({ id: "horde", mood: "bad", message: "The dead rise.", actions: [{ kind: "spawn", mob: r() < 0.5 ? "zombie" : "skeleton", count: 5 }] })],
  [5, () => ({ id: "creepers", mood: "bad", message: "Ssssss…", actions: [{ kind: "spawn", mob: "creeper", count: 3 }] })],
  [5, () => ({ id: "cobweb", mood: "bad", message: "Stuck!", actions: [{ kind: "blocks", list: [-1, 0, 1].flatMap((dx) => [0, 1].flatMap((dy) => [-1, 0, 1].map((dz): [number, number, number, number, number] => [dx, dy, dz, B.COBWEB, 0]))) }, { kind: "spawn", mob: "spider", count: 2 }] })],
  [5, () => ({ id: "poison", mood: "bad", message: "That did not agree with you.", actions: [{ kind: "effect", effect: "poison", seconds: 12, amp: 0 }, { kind: "effect", effect: "slowness", seconds: 20, amp: 1 }] })],
  [4, () => ({ id: "lightning", mood: "bad", message: "Struck by luck.", actions: [{ kind: "lightning" }] })],
  [4, () => ({ id: "launch", mood: "bad", message: "Up you go!", actions: [{ kind: "launch", height: 25 }] })],
  [3, () => ({ id: "silverfish", mood: "bad", message: "Something crawls out.", actions: [{ kind: "spawn", mob: "silverfish", count: 6 }] })],
];

/** What a broken lucky block does, by weight. `random` is 0..1. */
export function luckyOutcome(random: () => number): LuckyOutcome {
  const total = OUTCOMES.reduce((t, [w]) => t + w, 0);
  let roll = random() * total;
  for (const [w, make] of OUTCOMES) {
    roll -= w;
    if (roll < 0) return make(random);
  }
  return OUTCOMES[0][1](random);
}

export const LUCKY_OUTCOME_COUNT = OUTCOMES.length;
