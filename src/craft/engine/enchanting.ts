/**
 * Enchantments: which exist, what they may go on, how an enchanting table
 * rolls them, how an anvil combines them, and the numbers each one changes.
 *
 * An enchanted stack carries `ench: { sharpness: 3 }` — names, not numbers, so
 * a save or a network message reads as what it is. The table's roll follows
 * the original's algorithm (enchantability, the ±15% bonus, power ranges per
 * level, weighted picks, a falling chance of extras) because players judge a
 * table by feel: thirty levels on a diamond pick should usually give
 * Efficiency IV with something else, not Efficiency I or V every time.
 */
import { itemDef, itemId, type ItemDef, type ItemStack } from "./items";
import { Rng } from "./rng";

export type EnchantTarget = "armor" | "helmet" | "boots" | "weapon" | "digger" | "bow" | "breakable";

export interface EnchantDef {
  name: string;
  displayName: string;
  maxLevel: number;
  /** Relative chance of being picked: 10 common, 5 uncommon, 2 rare, 1 very rare. */
  weight: number;
  target: EnchantTarget;
  /** Also allowed on these, though the table never offers it there (sharpness on an axe). */
  alsoOn?: EnchantTarget[];
  /** Enchantments sharing a group exclude each other (the protections, the damage kinds). */
  group?: string;
  /** Only from trading and loot, never from the table. */
  treasure?: boolean;
  /** The table power range that yields `level`. */
  min(level: number): number;
  max(level: number): number;
}

const E: EnchantDef[] = [];
function ench(
  name: string, displayName: string, maxLevel: number, weight: number, target: EnchantTarget,
  min: (l: number) => number, span: number | ((l: number) => number), extra: Partial<EnchantDef> = {},
): void {
  E.push({
    name, displayName, maxLevel, weight, target, min,
    max: (l) => (typeof span === "number" ? min(l) + span : span(l)),
    ...extra,
  });
}

ench("protection", "Protection", 4, 10, "armor", (l) => 1 + (l - 1) * 11, 11, { group: "protection" });
ench("fire_protection", "Fire Protection", 4, 5, "armor", (l) => 10 + (l - 1) * 8, 8, { group: "protection" });
ench("feather_falling", "Feather Falling", 4, 5, "boots", (l) => 5 + (l - 1) * 6, 6);
ench("blast_protection", "Blast Protection", 4, 2, "armor", (l) => 5 + (l - 1) * 8, 8, { group: "protection" });
ench("projectile_protection", "Projectile Protection", 4, 5, "armor", (l) => 3 + (l - 1) * 6, 6, { group: "protection" });
ench("respiration", "Respiration", 3, 2, "helmet", (l) => 10 * l, 30);
ench("aqua_affinity", "Aqua Affinity", 1, 2, "helmet", () => 1, 40);
ench("thorns", "Thorns", 3, 1, "armor", (l) => 10 + 20 * (l - 1), 50);
ench("sharpness", "Sharpness", 5, 10, "weapon", (l) => 1 + (l - 1) * 11, 20, { group: "damage", alsoOn: ["digger"] });
ench("smite", "Smite", 5, 5, "weapon", (l) => 5 + (l - 1) * 8, 20, { group: "damage", alsoOn: ["digger"] });
ench("bane_of_arthropods", "Bane of Arthropods", 5, 5, "weapon", (l) => 5 + (l - 1) * 8, 20, { group: "damage", alsoOn: ["digger"] });
ench("knockback", "Knockback", 2, 5, "weapon", (l) => 5 + 20 * (l - 1), 50);
ench("fire_aspect", "Fire Aspect", 2, 2, "weapon", (l) => 10 + 20 * (l - 1), 50);
ench("looting", "Looting", 3, 2, "weapon", (l) => 15 + (l - 1) * 9, 50);
ench("efficiency", "Efficiency", 5, 10, "digger", (l) => 1 + 10 * (l - 1), 50);
ench("silk_touch", "Silk Touch", 1, 1, "digger", () => 15, 50, { group: "drops" });
ench("unbreaking", "Unbreaking", 3, 5, "breakable", (l) => 5 + (l - 1) * 8, 50);
ench("fortune", "Fortune", 3, 2, "digger", (l) => 15 + (l - 1) * 9, 50, { group: "drops" });
ench("power", "Power", 5, 10, "bow", (l) => 1 + (l - 1) * 10, 15);
ench("punch", "Punch", 2, 2, "bow", (l) => 12 + (l - 1) * 20, 25);
ench("flame", "Flame", 1, 2, "bow", () => 20, 30);
ench("infinity", "Infinity", 1, 1, "bow", () => 20, 30, { group: "arrows" });
ench("mending", "Mending", 1, 2, "breakable", (l) => l * 25, 50, { treasure: true, group: "arrows" });

export const ENCHANTMENTS: readonly EnchantDef[] = E;
const BY_NAME = new Map(E.map((e) => [e.name, e]));

export function enchantDef(name: string): EnchantDef | undefined {
  return BY_NAME.get(name);
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export function enchantLabel(name: string, level: number): string {
  const d = BY_NAME.get(name);
  const title = d?.displayName ?? name;
  return d && d.maxLevel === 1 && level === 1 ? title : `${title} ${ROMAN[level] ?? level}`;
}

/** The enchantments on a stack, in a stable order (the table's order). */
export function enchantsOf(stack: ItemStack | null | undefined): [string, number][] {
  if (!stack?.ench) return [];
  return E.filter((e) => (stack.ench![e.name] ?? 0) > 0).map((e) => [e.name, stack.ench![e.name]]);
}

export function levelOf(stack: ItemStack | null | undefined, name: string): number {
  return stack?.ench?.[name] ?? 0;
}

export function isEnchanted(stack: ItemStack | null | undefined): boolean {
  return !!stack?.ench && Object.keys(stack.ench).length > 0;
}

// ---- what goes on what -----------------------------------------------------------------

function targetsOf(def: ItemDef): Set<EnchantTarget> {
  const t = new Set<EnchantTarget>();
  if (def.armor) {
    t.add("armor");
    if (def.armor.slot === 0) t.add("helmet");
    if (def.armor.slot === 3) t.add("boots");
  }
  const tool = def.tool?.type;
  if (tool === "sword") t.add("weapon");
  if (tool === "pickaxe" || tool === "shovel" || tool === "axe" || tool === "hoe") t.add("digger");
  if (def.use === "bow") t.add("bow");
  if (def.durability) t.add("breakable");
  return t;
}

const isBook = (def: ItemDef) => def.name === "book" || def.name === "enchanted_book";

/** Whether an enchantment may go on an item at all (an anvil's rule). */
export function canApply(e: EnchantDef, def: ItemDef): boolean {
  if (isBook(def)) return true;
  const t = targetsOf(def);
  return t.has(e.target) || (e.alsoOn ?? []).some((x) => t.has(x));
}

/** Whether the table may offer an enchantment on an item: primary targets only, no treasure. */
function tableOffers(e: EnchantDef, def: ItemDef): boolean {
  if (e.treasure) return false;
  if (isBook(def)) return true;
  // Axes take the damage enchantments at the table too, as in the original.
  if (def.tool?.type === "axe" && e.group === "damage") return true;
  return targetsOf(def).has(e.target);
}

export function compatible(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = BY_NAME.get(a)?.group, gb = BY_NAME.get(b)?.group;
  return !ga || ga !== gb;
}

/** How readily an item takes enchantments: the original's per-material numbers. */
export function enchantability(def: ItemDef): number {
  if (isBook(def)) return 1;
  if (def.armor) return { leather: 15, iron: 9, golden: 25, diamond: 10, netherite: 15 }[def.armor.material];
  if (def.tool) {
    const tier = def.name.split("_")[0];
    return ({ wooden: 15, stone: 5, iron: 14, golden: 22, diamond: 10, netherite: 15 } as Record<string, number>)[tier] ?? 0;
  }
  if (def.use === "bow") return 1;
  return 0;
}

export function isEnchantable(stack: ItemStack | null): boolean {
  if (!stack || isEnchanted(stack) || stack.count !== 1) return false;
  const def = itemDef(stack.id);
  return !!def && def.name !== "enchanted_book" && enchantability(def) > 0;
}

// ---- the enchanting table --------------------------------------------------------------

/** Bookshelves around a table count up to fifteen. */
export const MAX_SHELVES = 15;

/**
 * Bookshelves powering a table: those in the ring two blocks out, on the
 * table's level or one above, with air between them and the table — a torch
 * or a carpet in the gap cuts a shelf off, as in the original.
 */
export function countBookshelves(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number, shelf: number): number {
  let n = 0;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
    for (let dy = 0; dy <= 1; dy++) {
      if (get(x + dx, y + dy, z + dz) !== shelf) continue;
      const gx = x + Math.trunc(dx / 2), gz = z + Math.trunc(dz / 2);
      if (get(gx, y + dy, gz) === 0) n++;
    }
  }
  return Math.min(MAX_SHELVES, n);
}

/** The three level requirements the table shows, from the player's enchantment seed and the shelves. */
export function tableLevels(seed: number, shelves: number, def: ItemDef): [number, number, number] {
  if (enchantability(def) <= 0) return [0, 0, 0];
  const rng = new Rng(seed);
  const s = Math.min(MAX_SHELVES, shelves);
  const roll = (slot: number) => {
    const base = rng.range(1, 8) + (s >> 1) + rng.range(0, s);
    const v = slot === 0 ? Math.max(Math.floor(base / 3), 1) : slot === 1 ? Math.floor((base * 2) / 3) + 1 : Math.max(base, s * 2);
    return v;
  };
  return [roll(0), roll(1), roll(2)];
}

/**
 * The enchantments a table slot gives for a level. Deterministic in (seed,
 * slot), so the hint shown before paying is what the player gets.
 */
export function rollEnchantments(seed: number, slot: number, level: number, def: ItemDef): Record<string, number> {
  const rng = new Rng((seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0);
  const ability = enchantability(def);
  if (ability <= 0 || level <= 0) return {};
  let power = level + 1 + rng.range(0, ability >> 2) + rng.range(0, ability >> 2);
  const bonus = 1 + (rng.next() + rng.next() - 1) * 0.15;
  power = Math.max(1, Math.round(power * bonus));

  const options = (p: number, chosen: string[]) => {
    const out: { name: string; level: number; weight: number }[] = [];
    for (const e of E) {
      // An enchantment already rolled is out, or a weaker extra would overwrite it (Sharpness III becoming I).
      if (!tableOffers(e, def) || chosen.includes(e.name) || chosen.some((c) => !compatible(c, e.name))) continue;
      for (let l = e.maxLevel; l >= 1; l--) {
        if (p >= e.min(l) && p <= e.max(l)) { out.push({ name: e.name, level: l, weight: e.weight }); break; }
      }
    }
    return out;
  };
  const pick = (list: { name: string; level: number; weight: number }[]) => {
    const total = list.reduce((n, o) => n + o.weight, 0);
    let r = rng.next() * total;
    for (const o of list) { r -= o.weight; if (r < 0) return o; }
    return list[list.length - 1];
  };

  const result: Record<string, number> = {};
  let list = options(power, []);
  if (!list.length) return result;
  const first = pick(list);
  result[first.name] = first.level;
  // Each extra is less likely than the last; a book keeps them all, as it would at an anvil.
  while (rng.next() < (power + 1) / 50) {
    power = Math.floor(power / 2);
    list = options(power, Object.keys(result));
    if (!list.length) break;
    const next = pick(list);
    result[next.name] = next.level;
  }
  return result;
}

/** The single enchantment the table reveals as a hint for a slot. */
export function tableClue(seed: number, slot: number, level: number, def: ItemDef): [string, number] | null {
  const r = rollEnchantments(seed, slot, level, def);
  const first = Object.entries(r)[0];
  return first ?? null;
}

// ---- the anvil ---------------------------------------------------------------------------

/** What repairs what at an anvil: a unit of material mends a quarter of the item. */
function repairMaterial(def: ItemDef): string | null {
  if (def.armor) return { leather: "leather", iron: "iron_ingot", golden: "gold_ingot", diamond: "diamond", netherite: "netherite_ingot" }[def.armor.material];
  if (def.tool) {
    const tier = def.name.split("_")[0];
    return ({ wooden: "oak_planks", stone: "cobblestone", iron: "iron_ingot", golden: "gold_ingot", diamond: "diamond", netherite: "netherite_ingot" } as Record<string, string>)[tier] ?? null;
  }
  return null;
}

/** Levels an enchantment costs per level when brought over at an anvil (halved from a book). */
function anvilRate(e: EnchantDef, fromBook: boolean): number {
  const rate = e.weight >= 10 ? 1 : e.weight >= 5 ? 2 : e.weight >= 2 ? 4 : 8;
  return fromBook ? Math.max(1, rate >> 1) : rate;
}

export interface AnvilResult {
  stack: ItemStack;
  /** Levels charged. */
  cost: number;
  /** How many of the right-hand stack are used up (materials are used one per quarter mended). */
  rightUsed: number;
}

/** Past this, the anvil refuses in survival: "Too Expensive!" */
export const ANVIL_LIMIT = 40;

/**
 * The anvil's output for a left and a right stack and an optional new name;
 * null when the combination does nothing.
 */
export function anvilResult(left: ItemStack | null, right: ItemStack | null, rename: string | null): AnvilResult | null {
  if (!left) return null;
  const ld = itemDef(left.id);
  if (!ld) return null;
  const out: ItemStack = { ...left, count: left.count, ench: left.ench ? { ...left.ench } : undefined };
  let cost = 0;
  let rightUsed = 0;
  const penalty = (left.repair ?? 0) + (right?.repair ?? 0);

  if (right) {
    const rd = itemDef(right.id);
    if (!rd) return null;
    const material = repairMaterial(ld);
    const rightIsBook = rd.name === "enchanted_book";
    if (material && rd.name === material && ld.durability && (left.damage ?? 0) > 0) {
      // Materials: each mends a quarter, one level apiece.
      let damage = left.damage ?? 0;
      const quarter = Math.max(1, Math.floor(ld.durability / 4));
      while (damage > 0 && rightUsed < right.count) { damage = Math.max(0, damage - quarter); rightUsed++; cost++; }
      out.damage = damage || undefined;
    } else if (rd.id === ld.id || rightIsBook) {
      if (rightIsBook && ld.name === "book") return null;
      // Two of the same: pool durability with a 12% bonus.
      if (rd.id === ld.id && ld.durability && (left.damage ?? 0) > 0) {
        const remaining = (ld.durability - (left.damage ?? 0)) + (ld.durability - (right.damage ?? 0)) + Math.floor(ld.durability * 0.12);
        out.damage = Math.max(0, ld.durability - remaining) || undefined;
        cost += 2;
      }
      const merged: Record<string, number> = { ...(left.ench ?? {}) };
      let any = false;
      for (const [name, lvl] of Object.entries(right.ench ?? {})) {
        const e = BY_NAME.get(name);
        if (!e) continue;
        if (!canApply(e, ld) || Object.keys(merged).some((m) => !compatible(m, name))) { cost++; continue; }
        const cur = merged[name] ?? 0;
        const next = cur === lvl ? Math.min(e.maxLevel, lvl + 1) : Math.max(cur, lvl);
        merged[name] = next;
        cost += next * anvilRate(e, rightIsBook);
        any = true;
      }
      if (!any && cost === 0) return null;
      out.ench = Object.keys(merged).length ? merged : undefined;
      rightUsed = 1;
    } else return null;
  }

  const trimmed = rename?.trim().slice(0, 35) ?? "";
  const defaultName = ld.displayName;
  if (rename !== null && trimmed !== (left.name ?? "") && !(trimmed === defaultName && !left.name)) {
    out.name = trimmed && trimmed !== defaultName ? trimmed : undefined;
    cost += 1;
  }
  if (cost === 0) return null;
  cost += penalty;
  // Every trip to the anvil makes the next one dearer: the work penalty doubles.
  out.repair = Math.max(left.repair ?? 0, right?.repair ?? 0) * 2 + 1;
  if (out.name === undefined) delete out.name;
  if (out.ench === undefined) delete out.ench;
  if (out.damage === undefined) delete out.damage;
  return { stack: out, cost, rightUsed };
}

// ---- what the enchantments do ------------------------------------------------------------

/** Bonus melee damage against a kind of mob (undead and arthropods have their own enchantments). */
export function damageBonus(weapon: ItemStack | null, target: { undead: boolean; arthropod: boolean } | null): number {
  let bonus = 0;
  const sharp = levelOf(weapon, "sharpness");
  if (sharp) bonus += 0.5 * sharp + 0.5;
  if (target?.undead) bonus += 2.5 * levelOf(weapon, "smite");
  if (target?.arthropod) bonus += 2.5 * levelOf(weapon, "bane_of_arthropods");
  return bonus;
}

/**
 * Enchantment protection factor for a hit: each point is 4% less damage,
 * capped at 20 points (80%), on top of what the armour itself stops.
 */
export function protectionFactor(armor: (ItemStack | null)[], source: string): number {
  let epf = 0;
  const bypass = source === "void" || source === "starve";
  if (bypass) return 0;
  for (const piece of armor) {
    if (!piece?.ench) continue;
    epf += levelOf(piece, "protection");
    if (source === "fire" || source === "lava") epf += 2 * levelOf(piece, "fire_protection");
    if (source === "explosion") epf += 2 * levelOf(piece, "blast_protection");
    if (source === "arrow") epf += 2 * levelOf(piece, "projectile_protection");
    if (source === "fall") epf += 3 * levelOf(piece, "feather_falling");
  }
  return Math.min(20, epf);
}

/** Whether a use should wear the item, with Unbreaking's chance to be spared. */
export function wears(stack: ItemStack | null, random: () => number, armor = false): boolean {
  const u = levelOf(stack, "unbreaking");
  if (!u) return true;
  // Armour gets a smaller discount than tools, as in the original.
  return armor ? random() < 0.6 + 0.4 / (u + 1) : random() < 1 / (u + 1);
}

/** Mining speed added by Efficiency when the tool is already faster than a hand. */
export function efficiencyBonus(tool: ItemStack | null): number {
  const e = levelOf(tool, "efficiency");
  return e ? e * e + 1 : 0;
}

/** Ores whose drop Fortune multiplies. */
const FORTUNE_DROPS = new Set(["coal", "diamond", "emerald", "lapis_lazuli", "redstone", "quartz", "raw_iron", "raw_gold", "raw_copper", "glowstone_dust", "wheat_seeds", "flint", "gold_nugget"]);

/** Applies Fortune to a mined block's drops (the item already rolled). */
export function applyFortune(drops: ItemStack[], level: number, random: () => number, blockItem: number): ItemStack[] {
  if (!level) return drops;
  return drops.map((d) => {
    const def = itemDef(d.id);
    if (!def || d.id === blockItem || !FORTUNE_DROPS.has(def.name)) return d;
    // The original: a bonus multiplier of 0..level+1, at least 1.
    const mult = Math.max(0, Math.floor(random() * (level + 2)) - 1) + 1;
    return { ...d, count: Math.min(64, d.count * mult) };
  });
}

/** An enchanted book holding one enchantment, as villagers sell and loot chests hold. */
export function enchantedBook(name: string, level: number): ItemStack {
  return { id: itemId("enchanted_book"), count: 1, ench: { [name]: level } };
}
