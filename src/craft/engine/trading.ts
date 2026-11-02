/**
 * Villager trades: what each profession buys and sells at each of its five
 * levels, and how a villager's offers grow as it is traded with.
 *
 * Prices are the original's where our items allow (twenty wheat for an
 * emerald, sixteen arrows for one), so a player who knows which villager to
 * look for finds them there. A villager starts with two offers of its first
 * level and gains two more at each level; every trade earns it experience, and
 * offers restock twice a day.
 */
import { ENCHANTMENTS, enchantedBook, rollEnchantments } from "./enchanting";
import { sanitizeStack } from "./inventory";
import { itemByName, type ItemStack } from "./items";
import { Rng } from "./rng";
import type { Profession } from "./villages";

export interface Offer {
  buy: ItemStack;
  buyB?: ItemStack;
  sell: ItemStack;
  uses: number;
  maxUses: number;
  /** Experience the villager earns per trade. */
  xp: number;
}

/** Experience a villager needs to reach each level (index 1 = level 2). */
export const LEVEL_XP = [0, 10, 70, 150, 250];
export const LEVEL_NAMES = ["Novice", "Apprentice", "Journeyman", "Expert", "Master"];

type Count = number | [number, number];
interface Template {
  buy: [string, Count];
  buyB?: [string, Count];
  /** An item and count, or a function for the special ones (an enchanted book or tool). */
  sell: [string, Count] | ((rng: Rng, level: number) => ItemStack);
  maxUses?: number;
  xp?: number;
}

const E = "emerald";
const t = (buy: [string, Count], sell: Template["sell"], extra: Partial<Template> = {}): Template => ({ buy, sell, ...extra });

/** A random enchanted book, Mending included: the librarian's famous trade. */
const book = (rng: Rng): ItemStack => {
  const e = ENCHANTMENTS[rng.int(ENCHANTMENTS.length)];
  return enchantedBook(e.name, 1 + rng.int(e.maxLevel));
};

/** A tool or weapon with enchantments rolled as a table would at 5-19 levels. */
const enchanted = (name: string) => (rng: Rng): ItemStack => {
  const def = itemByName(name);
  const ench = rollEnchantments(rng.int(0x7fffffff), 0, 5 + rng.int(15), def);
  return { id: def.id, count: 1, ench };
};

const TRADES: Record<Profession, Template[][]> = {
  farmer: [
    [t(["wheat", 20], [E, 1]), t(["potato", 26], [E, 1]), t(["carrot", 22], [E, 1]), t([E, 1], ["bread", 6])],
    [t(["pumpkin", 6], [E, 1]), t([E, 1], ["pumpkin_pie", 4]), t([E, 1], ["apple", 4])],
    [t(["melon", 4], [E, 1]), t([E, 3], ["golden_carrot", 3])],
    [t([E, 1], ["baked_potato", 6]), t([E, 4], ["glistering_melon_slice", 3])],
    [t([E, 3], ["golden_carrot", 3]), t([E, 4], ["glistering_melon_slice", 3])],
  ],
  librarian: [
    [t(["paper", 24], [E, 1]), t([E, [5, 20]], book, { buyB: ["book", 1], maxUses: 12 }), t([E, 9], ["bookshelf", 1])],
    [t(["book", 4], [E, 1]), t([E, 1], ["lantern", 1]), t([E, [5, 25]], book, { buyB: ["book", 1], maxUses: 12 })],
    [t(["paper", 24], [E, 1]), t([E, 1], ["glass", 4]), t([E, [8, 30]], book, { buyB: ["book", 1], maxUses: 12 })],
    [t(["book", 4], [E, 1]), t([E, [10, 35]], book, { buyB: ["book", 1], maxUses: 12 })],
    [t([E, [10, 35]], book, { buyB: ["book", 1], maxUses: 12 }), t([E, 2], ["glass", 8])],
  ],
  butcher: [
    [t(["chicken", 14], [E, 1]), t(["porkchop", 7], [E, 1]), t([E, 1], ["cooked_porkchop", 5])],
    [t(["coal", 15], [E, 1]), t([E, 1], ["cooked_chicken", 8])],
    [t(["mutton", 7], [E, 1]), t(["beef", 10], [E, 1])],
    [t(["mutton", 7], [E, 1]), t([E, 1], ["cooked_beef", 5])],
    [t(["pumpkin", 10], [E, 1]), t([E, 1], ["cooked_mutton", 5])],
  ],
  fisherman: [
    [t(["string", 20], [E, 1]), t(["coal", 10], [E, 1]), t([E, 1], ["pufferfish", 1], { maxUses: 12 })],
    [t([E, 1], ["pufferfish", 2]), t(["string", 20], [E, 1])],
    [t([E, 8], ["oak_boat", 1]), t([E, 1], ["pufferfish", 3])],
    [t([E, 2], ["pufferfish", 4]), t([E, 1], ["water_bucket", 1])],
    [t([E, 3], ["tnt_minecart", 1])],
  ],
  fletcher: [
    [t(["stick", 32], [E, 1]), t([E, 1], ["arrow", 16]), t(["gravel", 10], ["flint", 10], { buyB: [E, 1] })],
    [t(["flint", 26], [E, 1]), t([E, 2], ["bow", 1])],
    [t(["string", 14], [E, 1]), t([E, 1], ["arrow", 24])],
    [t(["feather", 24], [E, 1]), t([E, [7, 16]], enchanted("bow"))],
    [t([E, [8, 18]], enchanted("bow"))],
  ],
  shepherd: [
    [t(["white_wool", 18], [E, 1]), t([E, 2], ["shears", 1])],
    [t(["white_dye", 12], [E, 1]), t([E, 1], ["white_wool", 1]), t([E, 1], ["red_wool", 1])],
    [t(["yellow_dye", 12], [E, 1]), t([E, 3], ["red_bed", 1])],
    [t(["black_dye", 12], [E, 1]), t([E, 1], ["blue_wool", 1])],
    [t([E, 2], ["white_wool", 4]), t([E, 3], ["red_bed", 1])],
  ],
  mason: [
    [t(["clay_ball", 10], [E, 1]), t([E, 1], ["brick", 10])],
    [t(["stone", 20], [E, 1]), t([E, 1], ["stone_bricks", 4])],
    [t(["granite", 16], [E, 1]), t(["andesite", 16], [E, 1]), t([E, 1], ["smooth_stone", 4])],
    [t(["diorite", 16], [E, 1]), t([E, 1], ["terracotta", 1])],
    [t([E, 1], ["quartz", 1]), t([E, 1], ["calcite", 4])],
  ],
  toolsmith: [
    [t(["coal", 15], [E, 1]), t([E, 1], ["stone_axe", 1]), t([E, 1], ["stone_pickaxe", 1])],
    [t(["iron_ingot", 4], [E, 1]), t([E, 5], ["iron_chestplate", 1]), t([E, 3], ["iron_sword", 1])],
    [t(["flint", 30], [E, 1]), t([E, [6, 12]], enchanted("iron_pickaxe"))],
    [t(["diamond", 1], [E, 1]), t([E, [17, 30]], enchanted("diamond_axe"))],
    [t([E, [18, 32]], enchanted("diamond_pickaxe")), t([E, [18, 32]], enchanted("diamond_sword"))],
  ],
  cleric: [
    [t(["rotten_flesh", 32], [E, 1]), t([E, 1], ["redstone", 2])],
    [t(["gold_ingot", 3], [E, 1]), t([E, 1], ["lapis_lazuli", 1])],
    [t(["spider_eye", 2], [E, 1]), t([E, 4], ["glowstone", 1])],
    [t(["glass_bottle", 9], [E, 1]), t([E, 5], ["glowstone_dust", 8])],
    [t(["nether_wart", 22], [E, 1]), t([E, 3], ["experience_bottle", 1])],
  ],
  leatherworker: [
    [t(["leather", 6], [E, 1]), t([E, 3], ["leather_leggings", 1]), t([E, 7], ["leather_chestplate", 1])],
    [t(["flint", 26], [E, 1]), t([E, 5], ["leather_helmet", 1]), t([E, 4], ["leather_boots", 1])],
    [t(["leather", 6], [E, 1]), t([E, 7], ["leather_chestplate", 1])],
    [t(["leather", 6], [E, 1]), t([E, 6], ["leather_helmet", 1])],
    [t([E, 5], ["leather_leggings", 1]), t([E, 4], ["leather_boots", 1])],
  ],
};

const roll = (rng: Rng, c: Count): number => (typeof c === "number" ? c : c[0] + rng.int(c[1] - c[0] + 1));

function offerFrom(tpl: Template, rng: Rng, level: number): Offer {
  const stack = ([name, count]: [string, Count]): ItemStack => ({ id: itemByName(name).id, count: roll(rng, count) });
  return {
    buy: stack(tpl.buy),
    buyB: tpl.buyB ? stack(tpl.buyB) : undefined,
    sell: typeof tpl.sell === "function" ? tpl.sell(rng, level) : stack(tpl.sell),
    uses: 0,
    maxUses: tpl.maxUses ?? 16,
    xp: tpl.xp ?? [2, 5, 10, 15, 30][level - 1] ?? 2,
  };
}

/** The two new offers a villager gains on reaching `level` (1-5). */
export function offersForLevel(profession: Profession, level: number, rng: Rng): Offer[] {
  const pool = TRADES[profession][level - 1] ?? [];
  const picks: Offer[] = [];
  const left = [...pool];
  while (picks.length < 2 && left.length) {
    const i = rng.int(left.length);
    picks.push(offerFrom(left.splice(i, 1)[0], rng, level));
  }
  return picks;
}

/** The level a villager's experience has earned. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) level = i + 1;
  return level;
}

/** Whether an inventory's item counts can pay for an offer. */
export function canAfford(offer: Offer, count: (id: number) => number): boolean {
  if (offer.uses >= offer.maxUses) return false;
  if (offer.buyB && offer.buyB.id === offer.buy.id) return count(offer.buy.id) >= offer.buy.count + offer.buyB.count;
  return count(offer.buy.id) >= offer.buy.count && (!offer.buyB || count(offer.buyB.id) >= offer.buyB.count);
}

/**
 * An offer read back from a save or the host, or null if it is not one. The
 * stacks go through the same check as any other stack, so a hand-edited save
 * cannot make a villager sell an item that does not exist.
 */
export function sanitizeOffer(value: unknown): Offer | null {
  const o = value as Partial<Offer> | null;
  if (!o || typeof o !== "object") return null;
  const buy = sanitizeStack(o.buy), sell = sanitizeStack(o.sell);
  if (!buy || !sell || typeof o.uses !== "number" || typeof o.maxUses !== "number") return null;
  const buyB = o.buyB === undefined ? undefined : sanitizeStack(o.buyB);
  if (buyB === null) return null;
  return {
    buy, buyB, sell,
    uses: Math.max(0, Math.floor(o.uses)), maxUses: Math.max(1, Math.floor(o.maxUses)),
    xp: typeof o.xp === "number" ? Math.max(0, Math.floor(o.xp)) : 2,
  };
}
