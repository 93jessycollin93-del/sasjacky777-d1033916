/**
 * The smithing table: diamond gear and a netherite ingot become netherite
 * gear, keeping everything the piece had — enchantments, name, anvil history
 * and wear — as in the original's upgrade.
 */
import { itemByName, itemDef, type ItemStack } from "./items";

export function smithingResult(base: ItemStack | null, addition: ItemStack | null): ItemStack | null {
  if (!base || !addition || base.count !== 1) return null;
  if (itemDef(addition.id)?.name !== "netherite_ingot") return null;
  const name = itemDef(base.id)?.name ?? "";
  if (!name.startsWith("diamond_")) return null;
  let to;
  try { to = itemByName(`netherite_${name.slice("diamond_".length)}`); } catch { return null; }
  return { ...base, id: to.id, count: 1 };
}
