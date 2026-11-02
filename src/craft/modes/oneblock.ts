/**
 * OneBlock: a single block in the void that comes back as something else
 * every time it breaks. It works through phases — plains, the underground,
 * snow, the ocean floor, jungle, desert, the deep, the Nether and the End —
 * now and then coming back as a chest of that phase's treasures, or bringing
 * a creature with it. The End phase's first chest holds a portal's frame and
 * its eyes: build it and the dragon waits.
 */
import { B } from "../engine/blocks";
import { fillLoot, type LootTable } from "../engine/maps";
import { Rng } from "../engine/rng";
import type { BlockChange } from "../engine/world";
import type { MobKind } from "../engine/mobs";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

export interface Phase {
  name: string;
  /** Breaks it lasts. */
  length: number;
  blocks: [number, number][];
  mobs: MobKind[];
  chest: LootTable;
}

export const PHASES: readonly Phase[] = [
  { name: "Plains", length: 60, mobs: ["pig", "cow", "sheep", "chicken"],
    blocks: [[B.GRASS, 30], [B.DIRT, 20], [B.OAK_LOG, 18], [B.OAK_LEAVES, 8], [B.COBBLE, 8], [B.PUMPKIN, 2], [B.HAY, 2]],
    chest: [["water_bucket", 1, 1, 0.9], ["wheat_seeds", 2, 4, 0.8], ["oak_sapling", 1, 2, 0.8], ["bread", 2, 4, 0.7], ["torch", 4, 8, 0.6], ["carrot", 1, 2, 0.4], ["potato", 1, 2, 0.4]] },
  { name: "Underground", length: 100, mobs: ["zombie", "skeleton", "spider", "creeper"],
    blocks: [[B.STONE, 30], [B.COBBLE, 15], [B.COAL_ORE, 14], [B.IRON_ORE, 10], [B.COPPER_ORE, 6], [B.GRAVEL, 8], [B.ANDESITE, 5], [B.GRANITE, 5], [B.DIORITE, 5], [B.GOLD_ORE, 3]],
    chest: [["lava_bucket", 1, 1, 0.9], ["iron_ingot", 2, 6, 0.8], ["torch", 8, 16, 0.7], ["coal", 4, 8, 0.6], ["iron_pickaxe", 1, 1, 0.25], ["bone_meal", 2, 6, 0.5]] },
  { name: "Snow", length: 100, mobs: ["wolf", "sheep", "skeleton"],
    blocks: [[B.SNOW_BLOCK, 25], [B.ICE, 15], [B.PACKED_ICE, 12], [B.SPRUCE_LOG, 20], [B.SPRUCE_LEAVES, 6], [B.STONE, 12], [B.CALCITE, 4]],
    chest: [["spruce_sapling", 1, 2, 0.9], ["leather", 2, 4, 0.6], ["snowball", 4, 12, 0.5], ["bone", 2, 6, 0.6], ["cooked_mutton", 2, 5, 0.6]] },
  { name: "Ocean", length: 100, mobs: ["chicken", "zombie"],
    blocks: [[B.SAND, 30], [B.CLAY, 15], [B.GRAVEL, 12], [B.SANDSTONE, 12], [B.SEA_LANTERN, 3], [B.LILY_PAD, 0], [B.MOSSY_COBBLE, 5]],
    chest: [["sugar_cane", 1, 3, 0.9], ["clay_ball", 4, 8, 0.6], ["glass", 4, 8, 0.5], ["pufferfish", 1, 2, 0.4], ["lily_pad", 1, 2, 0.5]] },
  { name: "Jungle", length: 100, mobs: ["chicken", "pig", "spider"],
    blocks: [[B.JUNGLE_LOG, 30], [B.JUNGLE_LEAVES, 8], [B.MELON, 8], [B.PODZOL, 10], [B.MOSS, 10], [B.MUD, 6], [B.GRASS, 10]],
    chest: [["jungle_sapling", 1, 2, 0.9], ["melon_slice", 2, 6, 0.8], ["apple", 2, 4, 0.6], ["moss_block", 2, 4, 0.4]] },
  { name: "Desert", length: 100, mobs: ["zombie", "creeper", "spider"],
    blocks: [[B.SAND, 25], [B.SANDSTONE, 20], [B.RED_SAND, 12], [B.TERRACOTTA, 10], [B.ORANGE_TERRACOTTA, 5], [B.YELLOW_TERRACOTTA, 5], [B.CACTUS, 4], [B.DEAD_BUSH, 2], [B.ACACIA_LOG, 10]],
    chest: [["acacia_sapling", 1, 2, 0.9], ["gold_ingot", 2, 6, 0.6], ["emerald", 1, 3, 0.4], ["tnt", 1, 2, 0.3], ["diamond", 1, 1, 0.2]] },
  { name: "The Deep", length: 140, mobs: ["zombie", "skeleton", "creeper", "silverfish"],
    blocks: [[B.DEEPSLATE, 30], [B.TUFF, 10], [B.DS_IRON, 10], [B.DS_GOLD, 6], [B.DS_REDSTONE, 8], [B.DS_LAPIS, 6], [B.DS_DIAMOND, 4], [B.OBSIDIAN, 4], [B.AMETHYST, 3]],
    chest: [["diamond", 1, 3, 0.7], ["obsidian", 4, 10, 0.8], ["flint_and_steel", 1, 1, 0.8], ["redstone", 8, 16, 0.5], ["golden_apple", 1, 1, 0.3]] },
  { name: "The Nether", length: 150, mobs: ["zombified_piglin", "magma_cube", "blaze", "piglin"],
    blocks: [[B.NETHERRACK, 30], [B.SOUL_SAND, 10], [B.SOUL_SOIL, 6], [B.GLOWSTONE, 6], [B.NETHER_QUARTZ_ORE, 8], [B.NETHER_GOLD_ORE, 5], [B.MAGMA_BLOCK, 6], [B.NETHER_BRICKS, 8], [B.BLACKSTONE, 8], [B.CRIMSON_STEM, 6], [B.WARPED_STEM, 6], [B.ANCIENT_DEBRIS, 1]],
    chest: [["blaze_rod", 2, 4, 0.8], ["nether_wart", 2, 4, 0.8], ["gold_ingot", 4, 8, 0.6], ["ender_pearl", 1, 3, 0.5], ["brewing_stand", 1, 1, 0.3]] },
  { name: "The End", length: Infinity, mobs: ["enderman", "shulker"],
    blocks: [[B.END_STONE, 40], [B.END_STONE_BRICKS, 10], [B.OBSIDIAN, 10], [B.PURPUR_BLOCK, 10], [B.PURPUR_PILLAR, 4], [B.CHORUS_FLOWER, 2]],
    chest: [["ender_pearl", 2, 6, 0.8], ["chorus_fruit", 2, 6, 0.6], ["shulker_shell", 1, 2, 0.3], ["experience_bottle", 2, 6, 0.5], ["diamond", 1, 3, 0.5]] },
];

/** The End phase's first chest: a portal to build, and its eyes. */
const PORTAL_KIT: LootTable = [["end_portal_frame", 12, 12, 1], ["eye_of_ender", 12, 12, 1], ["torch", 8, 8, 1]];

/** Which phase the block is in after `broken` breaks, and how far through it. */
export function phaseAt(broken: number): { index: number; into: number } {
  let left = broken;
  for (let i = 0; i < PHASES.length; i++) {
    if (left < PHASES[i].length) return { index: i, into: left };
    left -= PHASES[i].length;
  }
  return { index: PHASES.length - 1, into: left };
}

export type NextBlock = { kind: "block"; id: number } | { kind: "chest"; table: LootTable } | { kind: "mob"; id: number; mob: MobKind };

/**
 * What the block becomes after its `broken`th break. The first block of each
 * phase is a chest (the End's is the portal kit); after that, one in forty
 * is a chest and one in twenty-five brings a creature standing on it.
 */
export function nextBlock(broken: number, seed: number): NextBlock {
  const { index, into } = phaseAt(broken);
  const phase = PHASES[index];
  const rng = new Rng((seed ^ Math.imul(broken + 1, 0x9e3779b1)) >>> 0);
  if (into === 0 && broken > 0) return { kind: "chest", table: index === PHASES.length - 1 ? PORTAL_KIT : phase.chest };
  if (rng.next() < 1 / 40) return { kind: "chest", table: phase.chest };
  const total = phase.blocks.reduce((t, [, w]) => t + w, 0);
  let roll = rng.next() * total, id = phase.blocks[0][0];
  for (const [b, w] of phase.blocks) { roll -= w; if (roll < 0) { id = b; break; } }
  if (rng.next() < 1 / 25) return { kind: "mob", id, mob: phase.mobs[rng.int(phase.mobs.length)] };
  return { kind: "block", id };
}

class OneBlockRuntime extends ModeRuntime {
  private get broken(): number { return (this.data.broken as number | undefined) ?? 0; }

  onBlockChange(c: BlockChange): void {
    const at = this.layout()?.oneBlock;
    if (!at || !this.home || c.cause === "world" || c.cause === "load") return;
    if (c.x !== at[0] || c.y !== at[1] || c.z !== at[2] || c.id !== B.AIR) return;
    const n = this.broken + 1;
    this.data.broken = n;
    const before = phaseAt(n - 1).index, now = phaseAt(n).index;
    if (now !== before) this.title(null, PHASES[now].name, `Phase ${now + 1} of ${PHASES.length}`);
    this.regrow(n);
  }

  /** Puts the next block in place; the one just broken has already dropped what it drops. */
  private regrow(n: number): void {
    const [x, y, z] = this.layout()!.oneBlock!;
    const g = this.game;
    const next = nextBlock(n, g.meta.seed);
    if (next.kind === "chest") {
      g.placeChest(x, y, z, (items) => fillLoot(items, new Rng(g.meta.seed ^ n), next.table, next.table === PORTAL_KIT));
      return;
    }
    g.world.setBlock(x, y, z, next.id, 0, "world");
    if (next.kind === "mob") this.spawnMob(next.mob, x + 0.5, y + 1, z + 0.5).persistent = false;
  }

  /** A block that went missing some other way (a creeper, a piston) comes back when the world opens. */
  resume(): void {
    this.data.broken ??= 0;
  }

  second(): void {
    const at = this.layout()?.oneBlock;
    if (!at || !this.home) return;
    const w = this.game.world;
    if (w.isLoaded(at[0], at[2]) && w.blockAt(at[0], at[1], at[2]) === B.AIR) this.regrow(this.broken);
  }

  objective(): Objective {
    const n = this.broken, { index, into } = phaseAt(n);
    const phase = PHASES[index];
    return {
      title: "OneBlock",
      lines: [
        ["Phase", `${index + 1}. ${phase.name}`],
        ["Progress", Number.isFinite(phase.length) ? `${into}/${phase.length}` : String(into)],
        ["Blocks broken", String(n)],
      ],
    };
  }
}

registerRuntime("oneblock", (g, d, s) => new OneBlockRuntime(g, d, s));
