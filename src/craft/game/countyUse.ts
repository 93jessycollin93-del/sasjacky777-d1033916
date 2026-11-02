/**
 * Using the county's fittings: sliding a window up, nailing boards across it,
 * prying them off, rolling up a garage door, drinking from a tap while the
 * water runs, cooking on a stove while the power is on, a generator to keep
 * a house lit after it goes, a gas pump, and the television and radio.
 *
 * The rules of what works when live in engine/countyLife.ts; this is the
 * game carrying them out for the player at the crosshair. Everything returns
 * whether it dealt with the click, so an ordinary right-click falls through
 * to the rest of Actions when it did not.
 */
import { block, isDoor } from "../engine/blocks";
import { boardsOf, COUNTY_BLOCKS as C, GARAGE_OPEN, WINDOW_BROKEN, WINDOW_CURTAIN, isCountyDoor } from "../engine/countyBlocks";
import { boardUp, broadcast, countyDay, countyHour, nailsPerBoard, pryBoard, toggleWindow } from "../engine/countyLife";
import { itemDef, itemId, type ItemStack } from "../engine/items";
import type { Game } from "./game";

/** What Actions lends the county: the parts of its own machinery a click needs. */
export interface UseHelpers {
  swing(): void;
  consumeHeld(n?: number): void;
  replaceHeld(stack: ItemStack): void;
}

const heldName = (g: Game): string => itemDef(g.player.inventory.held?.id ?? 0)?.name ?? "";

/** A click on one of the county's blocks; true when it was dealt with. */
export function clickCountyBlock(g: Game, h: UseHelpers, x: number, y: number, z: number, id: number, meta: number): boolean {
  if (!g.county() && id < 4096) return false;
  const tool = heldName(g);
  const boardable = id === C.HOUSE_WINDOW || isCountyDoor(id) || id === C.BARRICADE;
  if (boardable && tool === "hammer" && id !== C.BARRICADE && !g.player.sneaking) return nailBoard(g, h, x, y, z, id);
  if (boardable && (tool === "crowbar" || (tool === "hammer" && g.player.sneaking))) return pry(g, h, x, y, z, id, meta);
  switch (block(id).interact) {
    case "window": return workWindow(g, h, x, y, z, id, meta);
    case "garage": return rollGarage(g, h, x, y, z, id, meta);
    case "water": return drinkFromTap(g, h, x, y, z, id);
    case "stove":
      if (!g.poweredAt(x, y, z)) { g.showActionbar("Nothing. The power is out."); return true; }
      g.setScreen({ kind: "cooking", x, y, z });
      return true;
    case "tv": case "radio": {
      const kind = block(id).interact === "tv" ? "tv" : "radio";
      const line = broadcast(kind, countyDay(g.time), countyHour(g.time), g.poweredAt(x, y, z));
      g.message(line, kind === "tv" ? "#c8e0ff" : "#e8d8a8");
      g.sound("click", x + 0.5, y + 0.5, z + 0.5, 0.4, 0.8);
      h.swing();
      return true;
    }
    case "generator": return g.workGenerator(x, y, z, h);
    case "fuel": {
      if (tool !== "gas_can") { g.showActionbar("You need an empty gas can to fill."); return true; }
      if (!g.poweredAt(x, y, z)) { g.showActionbar("The pump needs power to run."); return true; }
      h.replaceHeld({ id: itemId("full_gas_can"), count: 1 });
      g.sound("bucket_fill", x + 0.5, y + 0.5, z + 0.5, 0.6, 0.7);
      g.message("You fill the gas can.", "#aaffaa");
      h.swing();
      return true;
    }
  }
  return false;
}

/** The other half of a two-high door or window, if it has one. */
function pairOf(g: Game, x: number, y: number, z: number, id: number, meta: number): number | null {
  if (isDoor(id)) return meta & 8 ? y - 1 : y + 1;
  if (g.world.blockAt(x, y + 1, z) === id) return y + 1;
  if (g.world.blockAt(x, y - 1, z) === id) return y - 1;
  return null;
}

/** Sets both halves to whatever `f` makes of each one's own meta. */
function both(g: Game, x: number, y: number, z: number, id: number, meta: number, f: (m: number) => number | null): void {
  const pair = pairOf(g, x, y, z, id, meta);
  for (const yy of pair === null ? [y] : [y, pair]) {
    if (g.world.blockAt(x, yy, z) !== id) continue;
    const next = f(g.world.getMeta(x, yy, z));
    if (next !== null) g.world.setBlock(x, yy, z, id, next, "player");
  }
}

function workWindow(g: Game, h: UseHelpers, x: number, y: number, z: number, id: number, meta: number): boolean {
  // Curtains are drawn with an empty hand, so sneaking with a block still places it against the glass.
  if (g.player.sneaking && !g.player.inventory.held && !(meta & WINDOW_BROKEN)) {
    both(g, x, y, z, id, meta, (m) => m ^ WINDOW_CURTAIN);
    g.sound("click", x + 0.5, y + 0.5, z + 0.5, 0.3, 0.5);
    h.swing();
    return true;
  }
  if (boardsOf(meta) > 0) { g.showActionbar("It's boarded up. A crowbar would get the boards off."); return true; }
  const next = toggleWindow(meta);
  if (next === null) { g.showActionbar("The glass is smashed out. You could climb through — or board it up with a hammer, planks and nails."); return true; }
  both(g, x, y, z, id, meta, (m) => toggleWindow(m));
  g.sound("door_open", x + 0.5, y + 0.5, z + 0.5, 0.5, 1.4);
  h.swing();
  return true;
}

function nailBoard(g: Game, h: UseHelpers, x: number, y: number, z: number, id: number): boolean {
  const inv = g.player.inventory;
  const lower = isDoor(id) && g.world.getMeta(x, y, z) & 8 ? y - 1 : y;
  const meta = g.world.getMeta(x, lower, z);
  const window = id === C.HOUSE_WINDOW;
  if (boardUp(meta, window) === null) { g.showActionbar("There's no room for another board."); return true; }
  const nails = nailsPerBoard(g.hasRead("carpentry"));
  const creative = !g.player.survivalLike;
  if (!creative && (inv.count(itemId("plank")) < 1 || inv.count(itemId("nails")) < nails)) {
    g.showActionbar(`Boarding up takes a plank and ${nails} nails.`);
    return true;
  }
  if (!creative) { inv.remove(itemId("plank"), 1); inv.remove(itemId("nails"), nails); inv.damageHeld(1); g.bumpInv(); }
  both(g, x, lower, z, id, meta, (m) => boardUp(m, window));
  // Hammering is loud: everything dead within earshot knows where you are.
  g.sound("zombie_break", x + 0.5, y + 0.5, z + 0.5, 0.9, 1.4);
  g.makeNoise(x + 0.5, y + 0.5, z + 0.5, 20, g.player.id);
  h.swing();
  return true;
}

function pry(g: Game, h: UseHelpers, x: number, y: number, z: number, id: number, meta: number): boolean {
  const lower = isDoor(id) && meta & 8 ? y - 1 : y;
  const m = g.world.getMeta(x, lower, z);
  if (id === C.BARRICADE) {
    const next = pryBoard(m);
    if (next === null || boardsOf(next) === 0) g.world.setBlock(x, y, z, 0, 0, "player");
    else g.world.setBlock(x, y, z, id, next, "player");
  } else {
    if (pryBoard(m) === null) { g.showActionbar("There are no boards on it."); return true; }
    both(g, x, lower, z, id, m, (mm) => pryBoard(mm));
  }
  g.player.inventory.damageHeld(1);
  const left = g.player.inventory.add({ id: itemId("plank"), count: 1 });
  if (left > 0) g.dropItem(x + 0.5, y + 0.5, z + 0.5, { id: itemId("plank"), count: left });
  g.bumpInv();
  g.sound("zombie_break", x + 0.5, y + 0.5, z + 0.5, 0.7, 1.1);
  h.swing();
  return true;
}

/** A roll-up door is several blocks wide and tall: every panel of it moves together. */
function rollGarage(g: Game, h: UseHelpers, x: number, y: number, z: number, id: number, meta: number): boolean {
  const open = (meta & GARAGE_OPEN) === 0;
  const seen = new Set<string>();
  const stack: [number, number, number][] = [[x, y, z]];
  while (stack.length && seen.size < 48) {
    const [a, b, c] = stack.pop()!;
    const k = `${a},${b},${c}`;
    if (seen.has(k) || g.world.blockAt(a, b, c) !== id || (g.world.getMeta(a, b, c) & 3) !== (meta & 3)) continue;
    seen.add(k);
    const m = g.world.getMeta(a, b, c);
    g.world.setBlock(a, b, c, id, open ? m | GARAGE_OPEN : m & ~GARAGE_OPEN, "player");
    stack.push([a + 1, b, c], [a - 1, b, c], [a, b + 1, c], [a, b - 1, c], [a, b, c + 1], [a, b, c - 1]);
  }
  g.sound(open ? "door_open" : "door_close", x + 0.5, y + 0.5, z + 0.5, 1, 0.5);
  g.makeNoise(x + 0.5, y + 0.5, z + 0.5, 16, g.player.id);
  h.swing();
  return true;
}

/**
 * A tap runs while the county's water does. After, a toilet's tank still
 * holds a drink — not a clean one — and a hydrant or a sink nothing at all.
 */
function drinkFromTap(g: Game, h: UseHelpers, x: number, y: number, z: number, id: number): boolean {
  const running = g.watered();
  const tank = id === C.TOILET || id === C.WATER_HEATER;
  if (!running && !tank) { g.showActionbar("The tap coughs and gives nothing. The water is off."); return true; }
  const clean = running;
  // Only clean water goes in a bottle; a toilet tank's is drunk on the spot or not at all.
  if (clean && heldName(g) === "empty_water_bottle") {
    h.replaceHeld({ id: itemId("bottled_water"), count: 1 });
    g.sound("bucket_fill", x + 0.5, y + 0.5, z + 0.5, 0.5, 1.2);
    h.swing();
    return true;
  }
  g.drank(clean ? "bottled_water" : "pond_water", clean ? 6 : 4);
  g.sound("drink", x + 0.5, y + 0.5, z + 0.5, 0.5);
  g.showActionbar(clean ? "You drink from the tap." : "You drink the stale water from the tank. It tastes of rust.");
  h.swing();
  return true;
}
