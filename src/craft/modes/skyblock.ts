/**
 * SkyBlock: the island's challenges. Everyone on the island shares them —
 * blocks mined and placed and monsters slain count for the island, not for
 * whoever did it — and each one finished pays everyone something the void
 * cannot give: ore, saplings, animals, the odd diamond.
 *
 * The island's level is the old servers' measure of a build: a point for
 * every ten blocks placed, less those broken.
 */
import { B, block, isLog } from "../engine/blocks";
import type { BlockChange } from "../engine/world";
import type { MobKind } from "../engine/mobs";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

export interface Challenge {
  id: string;
  name: string;
  /** What is counted, and how many make it. */
  need: { kind: "break" | "place"; blocks: number[] | "any" | "log"; count: number } | { kind: "kill"; mob: MobKind; count: number } | { kind: "portal" };
  reward: { items: [string, number][]; mobs?: [MobKind, number][]; text: string };
}

export const CHALLENGES: readonly Challenge[] = [
  { id: "cobble", name: "Stone Age", need: { kind: "break", blocks: [B.COBBLE, B.STONE], count: 64 }, reward: { items: [["iron_ingot", 4], ["bone_meal", 4]], text: "4 iron ingots" } },
  { id: "timber", name: "Lumberjack", need: { kind: "break", blocks: "log", count: 16 }, reward: { items: [["birch_sapling", 1], ["spruce_sapling", 1], ["jungle_sapling", 1], ["acacia_sapling", 1]], text: "four new saplings" } },
  { id: "builder", name: "Builder", need: { kind: "place", blocks: "any", count: 128 }, reward: { items: [["dirt", 16], ["grass_block", 2]], text: "16 dirt" } },
  { id: "farmer", name: "Farmer", need: { kind: "break", blocks: [B.WHEAT], count: 16 }, reward: { items: [], mobs: [["cow", 2]], text: "a pair of cows" } },
  { id: "cane", name: "Sweet Tooth", need: { kind: "break", blocks: [B.SUGAR_CANE], count: 24 }, reward: { items: [["clay_ball", 16]], mobs: [["sheep", 2]], text: "clay and a pair of sheep" } },
  { id: "mason", name: "Stonemason", need: { kind: "place", blocks: [B.STONE_BRICKS, B.STONE], count: 64 }, reward: { items: [["redstone", 16], ["gold_ingot", 4]], text: "redstone and gold" } },
  { id: "hunter", name: "Monster Hunter", need: { kind: "kill", mob: "zombie", count: 10 }, reward: { items: [["gold_ingot", 6], ["carrot", 2], ["potato", 2]], text: "gold, carrots and potatoes" } },
  { id: "bones", name: "Bone Collector", need: { kind: "kill", mob: "skeleton", count: 10 }, reward: { items: [["lapis_lazuli", 12], ["diamond", 1]], text: "lapis and a diamond" } },
  { id: "spiders", name: "Arachnophobe", need: { kind: "kill", mob: "spider", count: 6 }, reward: { items: [["slime_ball", 4], ["glowstone_dust", 8]], mobs: [["pig", 2]], text: "slime, glowstone and pigs" } },
  { id: "creepers", name: "Bomb Squad", need: { kind: "kill", mob: "creeper", count: 5 }, reward: { items: [["diamond", 2], ["emerald", 4]], text: "diamonds and emeralds" } },
  { id: "nether", name: "Through the Portal", need: { kind: "portal" }, reward: { items: [["gold_block", 1], ["soul_sand", 4], ["nether_wart", 2]], text: "gold, soul sand and nether wart" } },
];

type Counts = Record<string, number>;

class SkyBlockRuntime extends ModeRuntime {
  private get done(): string[] { return ((this.data.done as string[] | undefined) ??= []); }
  private get counts(): Counts { return ((this.data.counts as Counts | undefined) ??= {}); }

  start(): void {
    if (this.def.id === "lucky_skyblock") this.giveAll([["lucky_block", 16]]);
    this.tell(null, `${CHALLENGES.length} island challenges await. /mode shows the goal; the scoreboard shows the next.`);
  }

  onBlockChange(c: BlockChange): void {
    if (c.cause === "world" || c.cause === "load") return;
    const counts = this.counts;
    if (c.id === B.AIR && c.prevId !== B.AIR) {
      counts[`b${c.prevId}`] = (counts[`b${c.prevId}`] ?? 0) + 1;
      counts.broken = (counts.broken ?? 0) + 1;
    } else if (c.id !== B.AIR && c.prevId !== c.id && block(c.id).shape !== "fluid") {
      counts[`p${c.id}`] = (counts[`p${c.id}`] ?? 0) + 1;
      counts.placed = (counts.placed ?? 0) + 1;
    }
    if (c.id === B.NETHER_PORTAL) counts.portal = 1;
  }

  onKill(_killer: string, kind: string): void {
    this.counts[`k${kind}`] = (this.counts[`k${kind}`] ?? 0) + 1;
  }

  second(): void {
    for (const ch of CHALLENGES) {
      if (this.done.includes(ch.id) || progress(ch, this.counts) < goal(ch)) continue;
      this.done.push(ch.id);
      this.title(null, "Challenge complete!", `${ch.name} — ${ch.reward.text}`);
      this.game.sound("levelup", null);
      this.giveAll(ch.reward.items);
      const s = this.layout()?.spawn;
      if (s && this.home) for (const [kind, n] of ch.reward.mobs ?? []) for (let i = 0; i < n; i++) { const m = this.spawnMob(kind, s[0] + i, s[1], s[2]); m.persistent = true; }
      if (this.done.length === CHALLENGES.length) this.title(null, "Island Master", "Every challenge done");
    }
  }

  objective(): Objective {
    const next = CHALLENGES.find((c) => !this.done.includes(c.id));
    const counts = this.counts;
    const level = Math.max(0, Math.floor(((counts.placed ?? 0) - (counts.broken ?? 0) / 2) / 10));
    return {
      title: this.def.name,
      lines: [
        ["Challenges", `${this.done.length}/${CHALLENGES.length}`],
        ["Island level", String(level)],
        ...(next ? [[next.name, `${Math.min(progress(next, counts), goal(next))}/${goal(next)}`] as [string, string]] : [["All done!", "★"] as [string, string]]),
      ],
    };
  }
}

export function goal(ch: Challenge): number {
  return ch.need.kind === "portal" ? 1 : ch.need.count;
}

/** How far the island has come on a challenge, from its counters. */
export function progress(ch: Challenge, counts: Counts): number {
  const n = ch.need;
  if (n.kind === "portal") return counts.portal ?? 0;
  if (n.kind === "kill") return counts[`k${n.mob}`] ?? 0;
  const prefix = n.kind === "break" ? "b" : "p";
  if (n.blocks === "any") return counts[n.kind === "break" ? "broken" : "placed"] ?? 0;
  let total = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (!k.startsWith(prefix) || !/^\d+$/.test(k.slice(1))) continue;
    const id = Number(k.slice(1));
    if (n.blocks === "log" ? isLog(id) : n.blocks.includes(id)) total += v;
  }
  return total;
}

registerRuntime("skyblock", (g, d, s) => new SkyBlockRuntime(g, d, s));
registerRuntime("lucky_skyblock", (g, d, s) => new SkyBlockRuntime(g, d, s));
