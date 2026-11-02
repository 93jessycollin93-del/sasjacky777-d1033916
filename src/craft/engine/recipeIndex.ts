/**
 * The recipe viewer's index (after Just Enough Items): for any item, every
 * way to make it and everything it goes into — at the crafting table, the
 * furnace, the brewing stand and the smithing table — read from the same
 * lists those blocks use, so the viewer can never show a recipe the game
 * refuses, nor miss one it accepts.
 */
import { BREWING_INGREDIENTS, brewResult } from "./potions";
import { allRecipes, allSmelting, fuelTicks, ingredientIds, recipeResult, type Recipe } from "./crafting";
import { allItems, itemByName, type ItemStack } from "./items";
import { isBottle } from "./brewing";
import { smithingResult } from "./smithing";
import { COOKING } from "./cooking";

export type ShownRecipe =
  | {
    kind: "crafting"; id: string;
    /** Grid width (2 or 3) and each cell's accepted items; an empty list is an empty cell. */
    width: number; cells: number[][];
    result: ItemStack; shapeless: boolean;
    /** For recipes whose ingredients decide their result (fireworks): what the cells can only hint at. */
    note?: string;
  }
  | { kind: "smelting"; id: string; input: number[]; result: ItemStack; xp: number }
  | { kind: "brewing"; id: string; bottle: number; ingredient: number; result: ItemStack }
  | { kind: "smithing"; id: string; base: number; addition: number; result: ItemStack }
  | { kind: "cooking"; id: string; ingredients: number[]; bowl: number; result: ItemStack }
  | { kind: "fuel"; id: string; item: number; items: number };

const NOTES: Record<string, string> = {
  firework_rocket: "Paper, one to three gunpowder for its flight, and up to seven firework stars.",
  firework_star: "Gunpowder and dyes; add a fire charge, gold nugget or feather for a shape, a diamond for a trail, glowstone for a twinkle.",
  firework_star_fade: "A firework star and the dyes it fades to.",
};

function craftingView(r: Recipe): ShownRecipe {
  const result = recipeResult(r);
  if (r.pattern && r.key) {
    const width = Math.max(...r.pattern.map((row) => row.length));
    const cells: number[][] = [];
    for (const row of r.pattern) {
      for (let x = 0; x < width; x++) {
        const ch = row[x] ?? " ";
        cells.push(ch === " " ? [] : ingredientIds(r.key[ch]));
      }
    }
    return { kind: "crafting", id: r.id, width, cells, result, shapeless: false, note: NOTES[r.id] };
  }
  const ings = r.ingredients ?? [];
  const width = ings.length <= 4 ? 2 : 3;
  return { kind: "crafting", id: r.id, width, cells: ings.map(ingredientIds), result, shapeless: true, note: NOTES[r.id] };
}

let index: { makes: Map<number, ShownRecipe[]>; uses: Map<number, ShownRecipe[]> } | null = null;

function build(): NonNullable<typeof index> {
  const makes = new Map<number, ShownRecipe[]>();
  const uses = new Map<number, ShownRecipe[]>();
  const add = (m: Map<number, ShownRecipe[]>, id: number, r: ShownRecipe) => {
    const list = m.get(id) ?? [];
    if (!list.includes(r)) list.push(r);
    m.set(id, list);
  };
  for (const r of allRecipes()) {
    const v = craftingView(r);
    if (v.kind !== "crafting") continue;
    add(makes, v.result.id, v);
    for (const cell of v.cells) for (const id of cell) add(uses, id, v);
  }
  for (const s of allSmelting()) {
    const input = ingredientIds(s.input);
    const v: ShownRecipe = { kind: "smelting", id: `smelt:${s.input}`, input, result: { id: itemByName(s.output).id, count: 1 }, xp: s.xp };
    add(makes, v.result.id, v);
    for (const id of input) add(uses, id, v);
  }
  // Brewing: every bottle the stand holds, against every ingredient it takes.
  const bottles = allItems().filter((d) => isBottle({ id: d.id, count: 1 }));
  for (const b of bottles) {
    for (const ing of BREWING_INGREDIENTS) {
      const to = brewResult(b.name, ing);
      if (!to) continue;
      let out;
      try { out = itemByName(to); } catch { continue; }
      const v: ShownRecipe = { kind: "brewing", id: `brew:${b.name}|${ing}`, bottle: b.id, ingredient: itemByName(ing).id, result: { id: out.id, count: 1 } };
      add(makes, out.id, v);
      add(uses, b.id, v);
      add(uses, v.ingredient, v);
    }
  }
  const netherite = itemByName("netherite_ingot").id;
  for (const d of allItems()) {
    if (!d.name.startsWith("diamond_")) continue;
    const out = smithingResult({ id: d.id, count: 1 }, { id: netherite, count: 1 });
    if (!out) continue;
    const v: ShownRecipe = { kind: "smithing", id: `smith:${d.name}`, base: d.id, addition: netherite, result: out };
    add(makes, out.id, v);
    add(uses, d.id, v);
    add(uses, netherite, v);
  }
  const bowl = itemByName("bowl").id;
  for (const c of COOKING) {
    const v: ShownRecipe = { kind: "cooking", id: `cook:${c.id}`, ingredients: c.ingredients.map((n) => itemByName(n).id), bowl, result: { id: itemByName(c.result).id, count: 1 } };
    add(makes, v.result.id, v);
    for (const id of [...v.ingredients, bowl]) add(uses, id, v);
  }
  for (const d of allItems()) {
    const ticks = fuelTicks(d.id);
    if (ticks > 0) add(uses, d.id, { kind: "fuel", id: `fuel:${d.name}`, item: d.id, items: ticks / 200 });
  }
  return { makes, uses };
}

/** Every way to make an item. */
export function recipesFor(id: number): readonly ShownRecipe[] {
  index ??= build();
  return index.makes.get(id) ?? [];
}

/** Everything an item goes into (and what it burns for). */
export function usesOf(id: number): readonly ShownRecipe[] {
  index ??= build();
  return index.uses.get(id) ?? [];
}
