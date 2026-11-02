/**
 * Engrams (after ARK): in a Primal world, anything past the stone age has to
 * be learned before it can be made. Each level earns points; each engram
 * costs some and needs a level to learn. What an engram teaches is a set of
 * recipes, named by what they make — the crafting grid shows nothing for a
 * recipe you have not learned, and says which engram would teach it.
 *
 * Wood and stone tools, planks, sticks, torches, chests and the like are
 * never locked: a survivor can always make a start.
 */

export interface Engram {
  id: string;
  name: string;
  /** Level (experience level) it can first be learned at. */
  level: number;
  /** Engram points it costs. */
  points: number;
  /** The items whose recipes it teaches. */
  unlocks: readonly string[];
  /** An item to draw it with. */
  icon: string;
}

const pieces = (mat: string) => ["helmet", "chestplate", "leggings", "boots"].map((p) => `${mat}_${p}`);
const tools = (mat: string) => ["pickaxe", "axe", "shovel", "hoe", "sword"].map((t) => `${mat}_${t}`);

export const ENGRAMS: readonly Engram[] = [
  { id: "club", name: "Wooden Club", level: 1, points: 2, unlocks: ["wooden_club"], icon: "wooden_club" },
  { id: "hide", name: "Hide Armor", level: 2, points: 4, unlocks: pieces("leather"), icon: "leather_chestplate" },
  { id: "bed", name: "Bed", level: 2, points: 3, unlocks: ["red_bed"], icon: "red_bed" },
  { id: "furnace", name: "Furnace", level: 3, points: 4, unlocks: ["furnace", "smoker"], icon: "furnace" },
  { id: "bow", name: "Bow and Arrows", level: 4, points: 5, unlocks: ["bow", "arrow"], icon: "bow" },
  { id: "narcotic", name: "Narcotic", level: 5, points: 4, unlocks: ["narcotic"], icon: "narcotic" },
  { id: "tranq", name: "Tranquilizer Arrow", level: 6, points: 6, unlocks: ["tranq_arrow"], icon: "tranq_arrow" },
  { id: "kibble", name: "Kibble", level: 6, points: 5, unlocks: ["kibble"], icon: "kibble" },
  { id: "saddle", name: "Primitive Saddle", level: 8, points: 8, unlocks: ["saddle"], icon: "saddle" },
  { id: "iron_tools", name: "Metal Tools", level: 10, points: 10, unlocks: tools("iron"), icon: "iron_pickaxe" },
  { id: "flyer_saddle", name: "Flyer Saddle", level: 12, points: 10, unlocks: ["flyer_saddle"], icon: "flyer_saddle" },
  { id: "iron_armor", name: "Metal Armor", level: 14, points: 12, unlocks: pieces("iron"), icon: "iron_chestplate" },
  { id: "heavy_saddle", name: "Heavy Saddle", level: 16, points: 14, unlocks: ["heavy_saddle"], icon: "heavy_saddle" },
  { id: "arcane", name: "Enchanting and Brewing", level: 18, points: 14, unlocks: ["enchanting_table", "anvil", "brewing_stand"], icon: "enchanting_table" },
  { id: "diamond", name: "Diamond Gear", level: 24, points: 20, unlocks: [...tools("diamond"), ...pieces("diamond")], icon: "diamond_sword" },
];

const BY_ITEM = new Map<string, Engram>();
for (const e of ENGRAMS) for (const u of e.unlocks) BY_ITEM.set(u, e);

/** The engram that teaches making this item, if making it must be learned. */
export function engramFor(item: string): Engram | undefined {
  return BY_ITEM.get(item);
}

/** Points earned by reaching a level: four a level, and four more every fifth. */
export function pointsAt(level: number): number {
  const l = Math.max(0, Math.floor(level));
  return l * 4 + Math.floor(l / 5) * 4;
}

export function pointsSpent(learned: ReadonlySet<string>): number {
  return ENGRAMS.filter((e) => learned.has(e.id)).reduce((t, e) => t + e.points, 0);
}

export function pointsFree(level: number, learned: ReadonlySet<string>): number {
  return pointsAt(level) - pointsSpent(learned);
}

/** Whether an engram can be learned now, and if not, why not (in words). */
export function canLearn(e: Engram, level: number, learned: ReadonlySet<string>): true | string {
  if (learned.has(e.id)) return "Already learned";
  if (level < e.level) return `Needs level ${e.level}`;
  if (pointsFree(level, learned) < e.points) return `Needs ${e.points} points`;
  return true;
}
