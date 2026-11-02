/**
 * Clicking in inventory screens: the player's inventory, armour, the crafting
 * grids, chests, furnaces and the creative palette.
 *
 * Shift-click routing follows the original per screen — from the hotbar to the
 * main inventory and back, into the open chest, smeltables into the furnace's
 * input and fuel into its fuel slot — because that is the move experienced
 * players make hundreds of times a session without looking.
 */
import { clickSlot, fitsInBox, isCarriedContainer, mergeInto, range, sameItem, sortSlots, type ClickButton, type Slot } from "../engine/inventory";
import { consumeGrid, fuelTicks, layout, matchRecipe, recipeResult, smeltResult, type Recipe } from "../engine/crafting";
import { itemDef, itemId, maxStack, type ItemStack } from "../engine/items";
import { B } from "../engine/blocks";
import type { BrewingEntity, ChestEntity, FurnaceEntity } from "../engine/chunk";
import { isBottle, isBrewingFuel, isBrewingIngredient } from "../engine/brewing";
import {
  ANVIL_LIMIT, anvilResult, countBookshelves, isEnchantable, rollEnchantments, tableClue, tableLevels, type AnvilResult,
} from "../engine/enchanting";
import { Mob } from "../engine/mobs";
import { canAfford } from "../engine/trading";
import { smithingResult } from "../engine/smithing";
import { cookingRecipe, cookingResult, heatedBy, POT_BOWL, POT_SLOTS } from "../engine/cooking";
import type { Game } from "./game";

export type Section = "inv" | "armor" | "offhand" | "grid" | "result" | "chest" | "furnace" | "brewing" | "work" | "anvil_out" | "smithing_out" | "pot_out";

function chestOf(game: Game): ChestEntity | null {
  const s = game.screen;
  // An open backpack is a chest whose slots are its own stack's contents, edited in place.
  if (s?.kind === "backpack") {
    const pack = game.player.inventory.slots[s.slot];
    return pack && isCarriedContainer(pack.id) && pack.contents ? { kind: "chest", items: pack.contents } : null;
  }
  if (s?.kind !== "chest") return null;
  const e = game.world.getEntity(s.x, s.y, s.z);
  return e?.kind === "chest" ? e : null;
}

function furnaceOf(game: Game): FurnaceEntity | null {
  const s = game.screen;
  if (s?.kind !== "furnace") return null;
  const e = game.world.getEntity(s.x, s.y, s.z);
  return e?.kind === "furnace" ? e : null;
}

function brewingOf(game: Game): BrewingEntity | null {
  const s = game.screen;
  if (s?.kind !== "brewing") return null;
  const e = game.world.getEntity(s.x, s.y, s.z);
  return e?.kind === "brewing" ? e : null;
}

const LAPIS = () => itemId("lapis_lazuli");

export function craftWidth(game: Game): number {
  return game.screen?.kind === "crafting" ? 3 : 2;
}

export function craftOutput(game: Game): { recipe: Recipe; stack: ItemStack } | null {
  if (game.screen?.kind !== "inventory" && game.screen?.kind !== "crafting") return null;
  const r = matchRecipe(game.craftGrid, craftWidth(game));
  // A recipe an engram teaches makes nothing until the engram is learned (Primal).
  if (r && game.engramLocking(r.result.item)) return null;
  return r ? { recipe: r, stack: recipeResult(r, game.craftGrid) } : null;
}

/** The engram the grid's recipe waits on, for the crafting screen to name. */
export function craftLockedBy(game: Game): string | null {
  if (game.screen?.kind !== "inventory" && game.screen?.kind !== "crafting") return null;
  const r = matchRecipe(game.craftGrid, craftWidth(game));
  return r ? game.engramLocking(r.result.item)?.name ?? null : null;
}

function changed(game: Game): void {
  const s = game.screen;
  if (s && (s.kind === "chest" || s.kind === "furnace" || s.kind === "brewing")) game.containerChanged(s.x, s.y, s.z);
  else game.bumpInv();
}

/** The open container is a shulker box or a backpack, which take anything but another. */
function inBox(game?: Game): boolean {
  const s = game?.screen;
  return s?.kind === "backpack" || (s?.kind === "chest" && game!.world.blockAt(s.x, s.y, s.z) === B.SHULKER_BOX);
}

function accepts(section: Section, index: number, game?: Game): (s: ItemStack) => boolean {
  // A carved pumpkin can be worn as a helmet: it hides the wearer from endermen's stares.
  if (section === "armor") return (s) => itemDef(s.id)?.armor?.slot === index || (index === 0 && (s.id === B.CARVED_PUMPKIN || s.id === B.DRAGON_HEAD));
  if (section === "chest" && inBox(game)) return fitsInBox;
  if (section === "furnace" && index === 1) return (s) => fuelTicks(s.id) > 0;
  if (section === "furnace" && index === 2) return () => false;
  if (section === "brewing") return index < 3 ? isBottle : index === 3 ? isBrewingIngredient : isBrewingFuel;
  if (section === "work" && game?.screen?.kind === "cooking") return (s) => (index === POT_BOWL) === (itemDef(s.id)?.name === "bowl");
  if (section === "work" && game?.screen?.kind === "enchanting") {
    return index === 0 ? (s) => isEnchantable({ ...s, count: 1 }) || itemDef(s.id)?.name === "book" : (s) => s.id === LAPIS();
  }
  return () => true;
}

/** Most slots hold a stack; a bottle slot, and the enchanting table's item slot, hold one. */
function slotCap(game: Game, section: Section, index: number): number {
  if (section === "armor") return 1;
  if (section === "brewing" && index < 3) return 1;
  if (section === "work" && index === 0 && game.screen?.kind === "enchanting") return 1;
  return 64;
}

function getBrewingSlot(e: BrewingEntity, i: number): Slot {
  return i < 3 ? e.bottles[i] : i === 3 ? e.ingredient : e.fuel;
}
function setBrewingSlot(e: BrewingEntity, i: number, s: Slot): void {
  if (i < 3) e.bottles[i] = s; else if (i === 3) e.ingredient = s; else e.fuel = s;
}

function sectionSlots(game: Game, section: Section): Slot[] | null {
  const inv = game.player.inventory;
  switch (section) {
    case "inv": return inv.slots;
    case "armor": return inv.armor;
    case "grid": case "work": return game.craftGrid;
    case "chest": return chestOf(game)?.items ?? null;
    default: return null;
  }
}

function getFurnaceSlot(f: FurnaceEntity, i: number): Slot {
  return i === 0 ? f.input : i === 1 ? f.fuel : f.output;
}
function setFurnaceSlot(f: FurnaceEntity, i: number, s: Slot): void {
  if (i === 0) f.input = s; else if (i === 1) f.fuel = s; else f.output = s;
}

/** Moves a stack to where shift-click sends it on the current screen; returns what did not fit. */
function quickMove(game: Game, from: Section, index: number, stack: ItemStack): Slot {
  const inv = game.player.inventory;
  const kind = game.screen?.kind;
  if (from === "inv") {
    if (kind === "chest" || kind === "backpack") {
      const chest = chestOf(game);
      if (chest && (!inBox(game) || fitsInBox(stack))) return mergeInto(stack, chest.items, range(0, chest.items.length));
    }
    if (kind === "furnace") {
      const f = furnaceOf(game);
      if (f) {
        const target = smeltResult(stack.id) ? 0 : fuelTicks(stack.id) > 0 ? 1 : -1;
        if (target >= 0) {
          const cur = getFurnaceSlot(f, target);
          const slots: Slot[] = [cur];
          const left = mergeInto(stack, slots, [0]);
          setFurnaceSlot(f, target, slots[0]);
          return left;
        }
      }
    }
    if (kind === "inventory") {
      const armor = itemDef(stack.id)?.armor;
      if (armor && !inv.armor[armor.slot]) { inv.armor[armor.slot] = stack; return null; }
    }
    if (kind === "brewing") {
      const e = brewingOf(game);
      if (e) {
        // Bottles fill the free bottle slots one each; ingredients and powder go to their own slots.
        if (isBottle(stack)) {
          let left: Slot = stack;
          for (let i = 0; i < 3 && left; i++) {
            if (e.bottles[i]) continue;
            e.bottles[i] = { ...left, count: 1 };
            left = left.count > 1 ? { ...left, count: left.count - 1 } : null;
          }
          if (left?.count !== stack.count) return left;
        }
        const target = isBrewingFuel(stack) ? 4 : isBrewingIngredient(stack) ? 3 : -1;
        if (target >= 0) {
          const slots: Slot[] = [getBrewingSlot(e, target)];
          const left = mergeInto(stack, slots, [0]);
          setBrewingSlot(e, target, slots[0]);
          return left;
        }
      }
    }
    if (kind === "enchanting") {
      if (stack.id === LAPIS()) return mergeInto(stack, game.craftGrid, [1]);
      if (!game.craftGrid[0] && accepts("work", 0, game)(stack)) {
        game.craftGrid[0] = { ...stack, count: 1 };
        return stack.count > 1 ? { ...stack, count: stack.count - 1 } : null;
      }
    }
    if (kind === "anvil") return mergeInto(stack, game.craftGrid, [0, 1]);
    // Bowls to the bowl slot; anything else into the pot.
    if (kind === "cooking") return itemDef(stack.id)?.name === "bowl" ? mergeInto(stack, game.craftGrid, [POT_BOWL]) : mergeInto(stack, game.craftGrid, range(0, POT_BOWL));
    // Ingots to the ingot slot, a piece of gear to the other.
    if (kind === "smithing") return mergeInto(stack, game.craftGrid, [itemDef(stack.id)?.name === "netherite_ingot" ? 1 : 0]);
    return mergeInto(stack, inv.slots, index < 9 ? range(9, 36) : range(0, 9));
  }
  // Everything else goes back into the player's inventory, hotbar last like the original.
  return mergeInto(stack, inv.slots, [...range(9, 36), ...range(0, 9)]);
}

export function clickContainer(game: Game, section: Section, index: number, button: ClickButton, shift: boolean): void {
  const inv = game.player.inventory;
  if (section === "result") { takeResult(game, shift); return; }
  // The open backpack stays where it is: picked up, it would be carrying the screen showing it.
  if (game.screen?.kind === "backpack" && section === "inv" && index === game.screen.slot) return;

  if (section === "brewing") {
    const e = brewingOf(game);
    if (!e) return;
    const cur = getBrewingSlot(e, index);
    if (shift && cur) setBrewingSlot(e, index, quickMove(game, "brewing", index, cur));
    else {
      const [slot, cursor] = clickSlot(cur, game.cursor, button, accepts("brewing", index), slotCap(game, "brewing", index));
      setBrewingSlot(e, index, slot);
      game.cursor = cursor;
    }
    changed(game);
    return;
  }

  if (section === "anvil_out") { takeAnvilResult(game, shift); return; }
  if (section === "smithing_out") { takeSmithingResult(game, shift); return; }
  if (section === "pot_out") { takeCookResult(game, shift); return; }

  if (section === "furnace") {
    const f = furnaceOf(game);
    if (!f) return;
    const cur = getFurnaceSlot(f, index);
    if (shift && cur) {
      setFurnaceSlot(f, index, quickMove(game, "furnace", index, cur));
    } else if (index === 2) {
      // Output: take only, and collect the experience banked by smelting.
      if (!cur) return;
      if (game.cursor && !(sameItem(game.cursor, cur) && game.cursor.count + cur.count <= maxStack(cur.id))) return;
      game.cursor = game.cursor ? { ...game.cursor, count: game.cursor.count + cur.count } : cur;
      setFurnaceSlot(f, 2, null);
    } else {
      const [slot, cursor] = clickSlot(cur, game.cursor, button, accepts("furnace", index));
      setFurnaceSlot(f, index, slot);
      game.cursor = cursor;
    }
    if (index === 2 && f.xp >= 1) {
      const whole = Math.floor(f.xp);
      game.addXp(whole);
      f.xp -= whole;
    }
    changed(game);
    return;
  }

  if (section === "offhand") {
    const [slot, cursor] = clickSlot(inv.offhand, game.cursor, button);
    inv.offhand = slot;
    game.cursor = cursor;
    changed(game);
    return;
  }

  const slots = sectionSlots(game, section);
  if (!slots) return;
  if (shift) {
    const cur = slots[index];
    if (!cur) return;
    slots[index] = quickMove(game, section, index, cur);
  } else {
    const cap = slotCap(game, section, index);
    const [slot, cursor] = clickSlot(slots[index], game.cursor, button, accepts(section, index, game), cap);
    slots[index] = slot;
    game.cursor = cursor;
  }
  changed(game);
}

function takeResult(game: Game, shift: boolean): void {
  const out = craftOutput(game);
  if (!out) return;
  const width = craftWidth(game);
  const inv = game.player.inventory;
  if (shift) {
    // Craft as many as fit, re-matching each time (the grid changes as it empties).
    for (let i = 0; i < 64; i++) {
      const r = matchRecipe(game.craftGrid, width);
      if (!r || r.id !== out.recipe.id) break;
      const stack = recipeResult(r, game.craftGrid);
      const probe = inv.slots.map((s) => (s ? { ...s } : null));
      if (mergeInto(stack, probe, range(0, 36))) break;
      mergeInto(stack, inv.slots, [...range(9, 36), ...range(0, 9)]);
      game.craftGrid = consumeGrid(game.craftGrid);
    }
  } else {
    const stack = out.stack;
    if (game.cursor) {
      if (!sameItem(game.cursor, stack) || game.cursor.count + stack.count > maxStack(stack.id)) return;
      game.cursor = { ...game.cursor, count: game.cursor.count + stack.count };
    } else game.cursor = { ...stack };
    game.craftGrid = consumeGrid(game.craftGrid);
  }
  game.sound("click", null, 0, 0, 0.2, 1.4);
  game.bumpInv();
}

/** Clicking outside any slot drops the held stack (or one item with right click). */
export function dropCursor(game: Game, one: boolean): void {
  if (!game.cursor) return;
  const n = one ? 1 : game.cursor.count;
  game.actions.throwStack({ ...game.cursor, count: n });
  game.cursor = game.cursor.count > n ? { ...game.cursor, count: game.cursor.count - n } : null;
  game.bumpInv();
}

/** Creative palette: pick up a full stack (shift/middle: into the hotbar). */
export function creativeTake(game: Game, itemId: number, button: ClickButton, shift: boolean, template?: ItemStack): void {
  const def = itemDef(itemId);
  if (!def) return;
  const count = button === "right" ? 1 : def.maxStack;
  // A template carries what the palette entry is beyond its id (an enchanted book's enchantment).
  const base: ItemStack = template ? { ...template, id: itemId } : { id: itemId, count: 1 };
  if (shift) {
    game.player.inventory.add({ ...base, count: def.maxStack });
  } else if (game.cursor && sameItem(game.cursor, base) && button === "left") {
    game.cursor = { ...game.cursor, count: Math.min(def.maxStack, game.cursor.count + 1) };
  } else {
    game.cursor = { ...base, count };
  }
  game.bumpInv();
}

export function creativeTrash(game: Game): void {
  game.cursor = null;
  game.bumpInv();
}

/** Recipe book: moves the ingredients for one craft (or as many as possible) from the inventory into the grid. */
export function fillRecipe(game: Game, recipe: Recipe, all: boolean): boolean {
  const width = craftWidth(game);
  const inv = game.player.inventory;
  // Start from an empty grid, returning whatever was there.
  for (let i = 0; i < game.craftGrid.length; i++) {
    const s = game.craftGrid[i];
    if (s) {
      const left = inv.add(s);
      if (left > 0) game.actions.throwStack({ ...s, count: left });
      game.craftGrid[i] = null;
    }
  }
  const take = (ids: number[]): number | null => {
    for (let i = 35; i >= 0; i--) {
      const s = inv.slots[i];
      if (s && ids.includes(s.id)) {
        const id = s.id;
        s.count--;
        if (s.count <= 0) inv.slots[i] = null;
        return id;
      }
    }
    return null;
  };
  const snapshot = inv.slots.map((s) => (s ? { ...s } : null));
  const first = layout(recipe, width, take);
  if (!first) {
    inv.slots = snapshot;
    game.bumpInv();
    return false;
  }
  game.craftGrid = first;
  if (all) {
    for (let n = 1; n < 64; n++) {
      const before = inv.slots.map((s) => (s ? { ...s } : null));
      const more = layout(recipe, width, take);
      if (!more || more.some((s, i) => (s ? !first[i] || s.id !== first[i]!.id : false))) { inv.slots = before; break; }
      let full = false;
      game.craftGrid = game.craftGrid.map((s, i) => {
        if (!s) return s;
        if (s.count >= maxStack(s.id)) full = true;
        return { ...s, count: s.count + (more[i] ? 1 : 0) };
      });
      if (full) break;
    }
  }
  game.bumpInv();
  return true;
}

/** Item counts in the inventory by id, for the recipe book's "can craft" check. */
export function inventoryCounts(game: Game): Map<number, number> {
  const counts = new Map<number, number>();
  for (const s of [...game.player.inventory.slots, ...game.craftGrid]) if (s) counts.set(s.id, (counts.get(s.id) ?? 0) + s.count);
  return counts;
}

// ---- the enchanting table ------------------------------------------------------------------

export interface EnchantOffer {
  /** Level requirement shown on the button (0 when the slot offers nothing). */
  level: number;
  /** Lapis and levels actually taken: 1, 2 or 3. */
  cost: number;
  /** The one enchantment the table reveals. */
  clue: [string, number] | null;
  /** Whether this player can take it right now. */
  affordable: boolean;
}

export function enchantOffers(game: Game): { shelves: number; offers: EnchantOffer[] } | null {
  const s = game.screen;
  if (s?.kind !== "enchanting") return null;
  const w = game.world;
  const shelves = countBookshelves((x, y, z) => w.blockAt(x, y, z), s.x, s.y, s.z, B.BOOKSHELF);
  const item = game.craftGrid[0];
  const def = item ? itemDef(item.id) : undefined;
  if (!item || !def || !accepts("work", 0, game)(item)) return { shelves, offers: [] };
  const p = game.player;
  const lapis = game.craftGrid[1]?.count ?? 0;
  const levels = tableLevels(p.enchantSeed, shelves, def);
  const creative = !p.survivalLike;
  return {
    shelves,
    offers: levels.map((level, slot) => {
      const cost = slot + 1;
      const clue = level > 0 ? tableClue(p.enchantSeed, slot, level, def) : null;
      return { level, cost, clue, affordable: !!clue && (creative || (p.xpLevel >= level && lapis >= cost)) };
    }),
  };
}

/** Takes one of the table's three offers: pays lapis and levels, enchants, and re-seeds the table. */
export function enchantItem(game: Game, slot: number): boolean {
  const view = enchantOffers(game);
  const offer = view?.offers[slot];
  const item = game.craftGrid[0];
  const def = item ? itemDef(item.id) : undefined;
  if (!offer?.affordable || !item || !def) return false;
  const p = game.player;
  const ench = rollEnchantments(p.enchantSeed, slot, offer.level, def);
  if (!Object.keys(ench).length) return false;
  const toBook = def.name === "book";
  game.craftGrid[0] = { ...(toBook ? { id: itemId("enchanted_book"), count: 1 } : item), ench };
  if (p.survivalLike) {
    p.spendLevels(offer.cost);
    const lapis = game.craftGrid[1]!;
    game.craftGrid[1] = lapis.count > offer.cost ? { ...lapis, count: lapis.count - offer.cost } : null;
  }
  p.enchantSeed = Math.floor(Math.random() * 0x7fffffff);
  const s = game.screen!;
  if (s.kind === "enchanting") game.sound("enchant", s.x + 0.5, s.y + 0.5, s.z + 0.5, 1);
  game.advance({ kind: "enchant" });
  game.bumpInv();
  return true;
}

// ---- the anvil -------------------------------------------------------------------------------

export function anvilView(game: Game): (AnvilResult & { tooExpensive: boolean; affordable: boolean }) | null {
  if (game.screen?.kind !== "anvil") return null;
  const r = anvilResult(game.craftGrid[0], game.craftGrid[1], game.anvilName);
  if (!r) return null;
  const p = game.player;
  const tooExpensive = r.cost >= ANVIL_LIMIT && p.survivalLike;
  return { ...r, tooExpensive, affordable: !tooExpensive && (!p.survivalLike || p.xpLevel >= r.cost) };
}

/** The anvils' wear: a used anvil sometimes chips, and a damaged one breaks. */
const ANVIL_WEAR: Record<number, number> = { [B.ANVIL]: B.CHIPPED_ANVIL, [B.CHIPPED_ANVIL]: B.DAMAGED_ANVIL, [B.DAMAGED_ANVIL]: B.AIR };

function takeAnvilResult(game: Game, shift: boolean): void {
  const view = anvilView(game);
  const s = game.screen;
  if (!view || !view.affordable || s?.kind !== "anvil") return;
  const out = view.stack;
  if (shift) {
    if (mergeInto(out, game.player.inventory.slots, [...range(9, 36), ...range(0, 9)])) return;
  } else {
    if (game.cursor) return;
    game.cursor = out;
  }
  if (game.player.survivalLike) game.player.spendLevels(view.cost);
  game.craftGrid[0] = null;
  const right = game.craftGrid[1];
  game.craftGrid[1] = right && right.count > view.rightUsed ? { ...right, count: right.count - view.rightUsed } : null;
  game.anvilName = null;
  const id = game.world.blockAt(s.x, s.y, s.z);
  if (game.player.survivalLike && id in ANVIL_WEAR && Math.random() < 0.12) {
    const next = ANVIL_WEAR[id];
    const meta = game.world.getMeta(s.x, s.y, s.z);
    game.world.setBlock(s.x, s.y, s.z, next, next ? meta : 0, "player");
    if (!next) {
      game.sound("anvil_break", s.x + 0.5, s.y + 0.5, s.z + 0.5, 1);
      game.setScreen(null);
      return;
    }
  }
  game.sound("anvil_use", s.x + 0.5, s.y + 0.5, s.z + 0.5, 0.8);
  game.bumpInv();
}

/** What the smithing table would make from what is in it now. */
export function smithingView(game: Game): ItemStack | null {
  if (game.screen?.kind !== "smithing") return null;
  return smithingResult(game.craftGrid[0], game.craftGrid[1]);
}

function takeSmithingResult(game: Game, shift: boolean): void {
  const out = smithingView(game);
  const s = game.screen;
  if (!out || s?.kind !== "smithing") return;
  if (shift) {
    if (mergeInto(out, game.player.inventory.slots, [...range(9, 36), ...range(0, 9)])) return;
  } else {
    if (game.cursor) return;
    game.cursor = out;
  }
  game.craftGrid[0] = null;
  const ingot = game.craftGrid[1];
  game.craftGrid[1] = ingot && ingot.count > 1 ? { ...ingot, count: ingot.count - 1 } : null;
  game.sound("anvil_use", s.x + 0.5, s.y + 0.5, s.z + 0.5, 0.7, 0.8);
  game.bumpInv();
}

/** The pot's meal and whether there is heat under it to cook it. */
export function cookView(game: Game): { stack: ItemStack | null; heated: boolean; matched: boolean } {
  const s = game.screen;
  if (s?.kind !== "cooking") return { stack: null, heated: false, matched: false };
  return {
    stack: cookingResult(game.craftGrid),
    heated: heatedBy(game.world.blockAt(s.x, s.y - 1, s.z)),
    matched: cookingRecipe(game.craftGrid) !== null,
  };
}

/** Serves a meal: one of each ingredient and a bowl go, the meal comes out — only with heat under the pot. */
function takeCookResult(game: Game, shift: boolean): void {
  const s = game.screen;
  const { stack, heated } = cookView(game);
  if (!stack || !heated || s?.kind !== "cooking") return;
  if (shift) {
    if (mergeInto(stack, game.player.inventory.slots, [...range(9, 36), ...range(0, 9)])) return;
  } else if (!game.cursor) game.cursor = stack;
  else if (sameItem(game.cursor, stack) && game.cursor.count < maxStack(stack.id)) game.cursor = { ...game.cursor, count: game.cursor.count + 1 };
  else return;
  for (let i = 0; i < POT_SLOTS; i++) {
    const g = game.craftGrid[i];
    if (g) game.craftGrid[i] = g.count > 1 ? { ...g, count: g.count - 1 } : null;
  }
  game.sound("splash", s.x + 0.5, s.y + 0.5, s.z + 0.5, 0.35, 1.4);
  game.particles("smoke", s.x + 0.5, s.y + 0.9, s.z + 0.5, 6);
  game.bumpInv();
}

export function brewingView(game: Game): BrewingEntity | null {
  return brewingOf(game);
}

export function furnaceView(game: Game): FurnaceEntity | null {
  return furnaceOf(game);
}

export function chestView(game: Game): ChestEntity | null {
  return chestOf(game);
}

/**
 * Sorts the open chest (or backpack) or, with none open, the player's main
 * inventory — never the hotbar, which is laid out by hand.
 */
export function sortContainer(game: Game, which: "chest" | "inv"): void {
  if (which === "chest") {
    const c = chestOf(game);
    if (!c) return;
    sortSlots(c.items, range(0, c.items.length));
  } else sortSlots(game.player.inventory.slots, range(9, 36));
  changed(game);
}

// ---- trading ---------------------------------------------------------------------------------

/** The villager on the open trade screen, while it is alive and within reach. */
export function tradingWith(game: Game): Mob | null {
  const s = game.screen;
  if (s?.kind !== "trade") return null;
  const v = game.entities.get(s.entityId);
  if (!(v instanceof Mob) || v.kind !== "villager" || v.dying || v.removed) return null;
  const b = game.player.body;
  if (Math.hypot(v.x - b.x, v.y - b.y, v.z - b.z) > 8) return null;
  return v;
}

/**
 * Makes a trade (or as many as the player can pay for, with `all`): takes
 * the price from the inventory, hands over the goods, and credits the
 * villager — here, or through the host when this is a guest, since the host
 * owns every mob. Returns how many trades were made.
 */
export function makeTrade(game: Game, index: number, all: boolean): number {
  const v = tradingWith(game);
  if (!v) return 0;
  const inv = game.player.inventory;
  let made = 0;
  for (let i = 0; i < (all ? 64 : 1); i++) {
    const o = v.offers[index];
    if (!o || !canAfford(o, (id) => inv.count(id))) break;
    const goods = { ...o.sell, ench: o.sell.ench ? { ...o.sell.ench } : undefined };
    if (!goods.ench) delete goods.ench;
    // Only trade what fits; the goods are never dropped on the floor behind the player's back.
    const probe = inv.slots.map((s) => (s ? { ...s } : null));
    if (mergeInto(goods, probe, range(0, 36))) break;
    inv.remove(o.buy.id, o.buy.count);
    if (o.buyB) inv.remove(o.buyB.id, o.buyB.count);
    mergeInto(goods, inv.slots, [...range(0, 9), ...range(9, 36)]);
    if (game.role === "guest") {
      o.uses++;
      game.net?.trade?.(v.id, index);
    } else if (v.traded(index)) {
      game.particles("potion", v.x, v.y + 2.2, v.z, 12, 0x50e050);
      game.sound("levelup", v.x, v.y + 1, v.z, 0.5, 1.4);
    }
    game.collectXp(3 + Math.floor(Math.random() * 4));
    made++;
  }
  if (made) game.sound("villager_yes", v.x, v.y + 1.5, v.z, 0.8);
  else game.sound("villager_no", v.x, v.y + 1.5, v.z, 0.8);
  game.bumpInv();
  return made;
}
