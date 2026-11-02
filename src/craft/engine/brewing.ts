/**
 * The brewing stand: what each slot accepts and one tick of a brew.
 *
 * The original's rules: blaze powder is fuel for twenty brews; a brew takes
 * twenty seconds and only starts when the ingredient changes at least one of
 * the bottles below it; taking the ingredient away, or the last bottle it would
 * change, stops it. Kept apart from the game so the whole thing is testable
 * without a world.
 */
import type { BrewingEntity } from "./chunk";
import { itemDef, itemId, type ItemStack } from "./items";
import { brewResult, BREWING_INGREDIENTS, potionOfItem } from "./potions";

/** Ticks one brew takes. */
export const BREW_TICKS = 400;
/** Brews a blaze powder is good for. */
export const BREWS_PER_FUEL = 20;

const nameOf = (s: ItemStack | null): string => (s ? itemDef(s.id)?.name ?? "" : "");

export function isBrewingIngredient(s: ItemStack): boolean {
  return BREWING_INGREDIENTS.has(nameOf(s));
}

export function isBrewingFuel(s: ItemStack): boolean {
  return nameOf(s) === "blaze_powder";
}

/** Bottle slots take potions and water bottles (anything the stand could work on) and hold one each. */
export function isBottle(s: ItemStack): boolean {
  const p = potionOfItem(nameOf(s));
  // A tipped arrow is a potion's form too, but not one a stand holds.
  return (!!p && p.form !== "arrow") || nameOf(s) === "glass_bottle";
}

/** Whether the ingredient would change any bottle. */
export function canBrew(e: BrewingEntity): boolean {
  if (!e.ingredient) return false;
  const ing = nameOf(e.ingredient);
  return e.bottles.some((b) => b && brewResult(nameOf(b), ing) !== undefined);
}

export interface BrewTick {
  /** Something about the stand changed (save it, redraw the screen). */
  changed: boolean;
  /** A brew just finished (for the sound and the advancement). */
  finished: boolean;
}

/** One tick of a brewing stand. */
export function tickBrewing(e: BrewingEntity): BrewTick {
  let changed = false;
  // Top up the fuel from a blaze powder when it runs dry — only when there is a use for it.
  if (e.fuelLeft <= 0 && e.fuel && isBrewingFuel(e.fuel) && canBrew(e)) {
    e.fuelLeft = BREWS_PER_FUEL;
    e.fuel = e.fuel.count > 1 ? { ...e.fuel, count: e.fuel.count - 1 } : null;
    changed = true;
  }
  if (e.brew > 0) {
    if (!canBrew(e)) {
      e.brew = 0;
      return { changed: true, finished: false };
    }
    e.brew--;
    if (e.brew > 0) return { changed: true, finished: false };
    const ing = nameOf(e.ingredient);
    e.bottles = e.bottles.map((b) => {
      const to = b ? brewResult(nameOf(b), ing) : undefined;
      return to ? { id: itemId(to), count: 1 } : b;
    });
    // Most ingredients are used up; a lava bucket style remainder is not a thing here.
    e.ingredient = e.ingredient!.count > 1 ? { ...e.ingredient!, count: e.ingredient!.count - 1 } : null;
    return { changed: true, finished: true };
  }
  if (e.fuelLeft > 0 && canBrew(e)) {
    e.brew = BREW_TICKS;
    e.fuelLeft--;
    changed = true;
  }
  return { changed, finished: false };
}

/** Which bottle slots are filled, as the block's meta bits (the stand draws a bottle for each). */
export function bottleBits(e: BrewingEntity): number {
  return e.bottles.reduce((bits, b, i) => (b ? bits | (1 << i) : bits), 0);
}
