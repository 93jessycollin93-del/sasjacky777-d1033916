/**
 * Gravestones (after the Gravestone Mod and Corail Tombstone): dying leaves
 * a headstone holding everything that was carried, rather than a scatter of
 * items that despawn in five minutes or burn in the lava that did the killing.
 * Using the stone puts each thing back where it was — armour on, the sword
 * in its hotbar slot — and whatever no longer fits falls at your feet.
 *
 * A grave's items are laid out as the inventory is: 36 slots, four armour
 * pieces, the offhand, then anything that was in the cursor or crafting grid.
 */
import { B, block, isFluid } from "./blocks";
import { WORLD_HEIGHT } from "./constants";
import type { Inventory, Slot } from "./inventory";
import type { ItemStack } from "./items";

export const GRAVE_ARMOR = 36;
export const GRAVE_OFFHAND = 40;

/** Everything the player carries, in grave order; null when there is nothing to keep. */
export function packGrave(inv: Inventory, extras: Slot[] = []): Slot[] | null {
  const items: Slot[] = [...inv.slots, ...inv.armor, inv.offhand, ...extras.filter(Boolean)].map((s) => (s ? { ...s } : null));
  return items.some(Boolean) ? items : null;
}

/** Puts a grave's items back into an inventory, each into its own slot if it is free; returns what did not fit. */
export function unpackGrave(items: Slot[], inv: Inventory): ItemStack[] {
  const rest: ItemStack[] = [];
  items.forEach((s, i) => {
    if (!s) return;
    if (i < 36 && !inv.slots[i]) inv.slots[i] = { ...s };
    else if (i >= GRAVE_ARMOR && i < GRAVE_OFFHAND && !inv.armor[i - GRAVE_ARMOR]) inv.armor[i - GRAVE_ARMOR] = { ...s };
    else if (i === GRAVE_OFFHAND && !inv.offhand) inv.offhand = { ...s };
    else rest.push({ ...s });
  });
  const spill: ItemStack[] = [];
  for (const s of rest) {
    const left = inv.add(s);
    if (left > 0) spill.push({ ...s, count: left });
  }
  return spill;
}

/**
 * Where a grave goes for a death at x, y, z: that cell or the first above it
 * that is open (air, water, lava, grass), inside the world. Out of the bottom
 * of the world it rests on the lowest layer instead. Null when nowhere near
 * is open — the items then fall as they always did.
 */
export function graveSpot(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number): [number, number, number] | null {
  const gx = Math.floor(x), gz = Math.floor(z);
  const start = Math.max(1, Math.min(WORLD_HEIGHT - 2, Math.floor(y)));
  for (let gy = start; gy < Math.min(WORLD_HEIGHT - 1, start + 12); gy++) {
    const id = get(gx, gy, gz);
    if (id === B.AIR || isFluid(id) || (block(id).replaceable && !block(id).interact)) return [gx, gy, gz];
  }
  return null;
}
