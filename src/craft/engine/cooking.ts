/**
 * The cooking pot (after Farmer's Delight): a pot set over heat — fire, lava,
 * a magma block, a lit furnace — turns up to six ingredients and a bowl into
 * a meal worth far more than its parts eaten one by one. The ingredients go
 * in any order; what matters is what is in the pot.
 */
import { B } from "./blocks";
import { itemByName, itemDef, type ItemStack } from "./items";
import type { Slot } from "./inventory";

export interface CookingRecipe {
  id: string;
  /** Ingredient item names, as a multiset: two carrots is two entries. */
  ingredients: string[];
  result: string;
}

export const COOKING: readonly CookingRecipe[] = [
  { id: "vegetable_soup", ingredients: ["carrot", "potato", "brown_mushroom"], result: "vegetable_soup" },
  { id: "beef_stew", ingredients: ["beef", "carrot", "potato"], result: "beef_stew" },
  { id: "chicken_soup", ingredients: ["chicken", "carrot", "brown_mushroom"], result: "chicken_soup" },
  { id: "venison_stew", ingredients: ["venison", "potato", "red_mushroom"], result: "venison_stew" },
  { id: "pumpkin_soup", ingredients: ["pumpkin", "potato", "egg"], result: "pumpkin_soup" },
  { id: "hearty_stew", ingredients: ["beef", "mutton", "chicken", "carrot", "potato", "brown_mushroom"], result: "hearty_stew" },
];

/** The six ingredient slots, then the bowl. */
export const POT_SLOTS = 7;
export const POT_BOWL = 6;

/** The recipe the pot's six ingredient slots make, or null: exactly those ingredients, no more, no fewer. */
export function cookingRecipe(grid: Slot[]): CookingRecipe | null {
  const have = grid.slice(0, POT_BOWL).filter((s): s is ItemStack => !!s).map((s) => itemDef(s.id)?.name ?? "").sort();
  if (!have.length) return null;
  for (const r of COOKING) {
    const need = [...r.ingredients].sort();
    if (need.length === have.length && need.every((n, i) => n === have[i])) return r;
  }
  return null;
}

/** What the pot would give now: a recipe matched and a bowl to serve it in. */
export function cookingResult(grid: Slot[]): ItemStack | null {
  const r = cookingRecipe(grid);
  const bowl = grid[POT_BOWL];
  if (!r || !bowl || itemDef(bowl.id)?.name !== "bowl") return null;
  return { id: itemByName(r.result).id, count: 1 };
}

/** Heat under a pot: fire, lava, a magma block or a lit furnace. */
export function heatedBy(below: number): boolean {
  return below === B.FIRE || below === B.SOUL_FIRE || below === B.LAVA || below === B.MAGMA_BLOCK || below === B.LIT_FURNACE;
}
