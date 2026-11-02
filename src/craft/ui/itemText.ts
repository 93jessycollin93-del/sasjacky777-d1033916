/**
 * The words shown about an item: its name, its enchantments, what a potion
 * does and for how long. Kept apart from the components so the tooltip and the
 * HUD's effect list read from one place.
 */
import { enchantLabel, enchantsOf, isEnchanted } from "../engine/enchanting";
import type { Slot } from "../engine/inventory";
import { BOX_COLORS } from "../engine/blocks";
import { displayName, itemDef } from "../engine/items";
import { formSeconds, potionOfItem } from "../engine/potions";
import { burstLines } from "../engine/fireworks";

const EFFECT_NAMES: Record<string, string> = {
  speed: "Speed", slowness: "Slowness", strength: "Strength", weakness: "Weakness", instant_health: "Instant Health",
  instant_damage: "Instant Damage", poison: "Poison", regeneration: "Regeneration", fire_resistance: "Fire Resistance",
  night_vision: "Night Vision", invisibility: "Invisibility", water_breathing: "Water Breathing", hunger: "Hunger", absorption: "Absorption",
  wither: "Wither", levitation: "Levitation", blindness: "Blindness",
};
const HARMFUL = new Set(["slowness", "weakness", "instant_damage", "poison", "hunger", "wither", "levitation", "blindness"]);
const ROMAN = ["", "", " II", " III", " IV", " V"];
export const effectName = (kind: string, amp = 0): string => `${EFFECT_NAMES[kind] ?? kind}${ROMAN[amp + 1] ?? ` ${amp + 1}`}`;
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export interface TipLine { text: string; color: string; italic?: boolean; small?: boolean }

/** What a slot's tooltip says: name, enchantments, a potion's effects, and the stats that matter. */
export function tooltipLines(stack: Slot): TipLine[] {
  const def = stack ? itemDef(stack.id) : undefined;
  if (!stack || !def) return [];
  const lines: TipLine[] = [];
  const enchanted = isEnchanted(stack);
  const color = stack.color ? BOX_COLORS[stack.color] : "";
  const dyed = color ? `${color[0].toUpperCase()}${color.slice(1)} ${def.displayName}` : def.displayName;
  lines.push({ text: stack.name ?? dyed, color: enchanted ? "#55ffff" : "#fff", italic: !!stack.name });
  // A shulker box says what it carries: the first five stacks, and how many more.
  if (stack.contents) {
    const held = stack.contents.filter((c): c is NonNullable<typeof c> => !!c);
    for (const c of held.slice(0, 5)) lines.push({ text: `${c.name ?? displayName(c.id)} x${c.count}`, color: "#dddddd", small: true });
    if (held.length > 5) lines.push({ text: `and ${held.length - 5} more…`, color: "#aaaaaa", italic: true, small: true });
  }
  for (const [name, level] of enchantsOf(stack)) lines.push({ text: enchantLabel(name, level), color: "#aaaaaa", small: true });
  const potion = potionOfItem(def.name);
  if (potion) {
    if (!potion.potion.effects.length) lines.push({ text: "No Effects", color: "#aaaaaa", small: true });
    for (const e of potion.potion.effects) {
      const time = e.seconds > 0 ? ` (${clock(formSeconds(e.seconds, potion.form))})` : "";
      lines.push({ text: `${effectName(e.effect, e.amp)}${time}`, color: HARMFUL.has(e.effect) ? "#ff5555" : "#5555ff", small: true });
    }
  }
  // Fireworks say what they will do: a star its burst, a rocket its flight and every star in it.
  if (stack.burst) for (const l of burstLines(stack.burst)) lines.push({ text: l, color: "#aaaaaa", small: true });
  if (def.name === "firework_rocket") {
    lines.push({ text: `Flight Duration: ${stack.fw?.flight ?? 1}`, color: "#aaaaaa", small: true });
    for (const b of stack.fw?.bursts ?? []) for (const [i, l] of burstLines(b).entries()) lines.push({ text: `${i ? "  " : "• "}${l}`, color: "#aaaaaa", small: true });
  }
  if (def.tool && def.damage > 1) lines.push({ text: `${def.damage} Attack Damage`, color: "#9fd0ff", small: true });
  if (def.armor) lines.push({ text: `+${def.armor.points} Armor`, color: "#9fd0ff", small: true });
  if (def.food) lines.push({ text: `Restores ${def.food.hunger / 2} hunger`, color: "#9fd0ff", small: true });
  if (def.durability) lines.push({ text: `Durability: ${def.durability - (stack.damage ?? 0)} / ${def.durability}`, color: "#9fd0ff", small: true });
  return lines;
}

