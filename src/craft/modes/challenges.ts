/**
 * The modes that bend an ordinary world rather than build a new one: UHC's
 * one life and closing border, the speedrun's clock and splits, Random
 * Drops' shuffled loot, One Heart, and a tally for Lucky Blocks.
 */
import { allItems, maxStack, type ItemStack } from "../engine/items";
import { B } from "../engine/blocks";
import { Rng } from "../engine/rng";
import type { BlockChange } from "../engine/world";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

// ---- UHC ------------------------------------------------------------------------------------

const UHC_START = 400, UHC_END = 50, UHC_GRACE = 300, UHC_CLOSED = 3600;

/** UHC's border half-width `t` seconds in: still for the grace period, then closing to 50 by the hour. */
export function uhcBorder(t: number): number {
  if (t <= UHC_GRACE) return UHC_START;
  const k = Math.min(1, (t - UHC_GRACE) / (UHC_CLOSED - UHC_GRACE));
  return Math.round(UHC_START + (UHC_END - UHC_START) * k);
}

class UhcRuntime extends ModeRuntime {
  private get t(): number { return (this.data.t as number | undefined) ?? 0; }

  start(): void {
    this.title(null, "Ultra Hardcore", "No natural healing. One life.");
    this.tell(null, "Only golden apples and potions heal. The border starts closing in five minutes.", "#ffaa00");
  }

  resume(): void {
    this.border();
  }

  private border(): void {
    const s = this.game.worldSpawn();
    this.game.setBorder({ x: Math.round(s.x) + 0.5, z: Math.round(s.z) + 0.5, radius: uhcBorder(this.t) });
  }

  second(): void {
    if (this.data.over) return;
    this.data.t = this.t + 1;
    if (this.t === UHC_GRACE) this.title(null, "The border is moving", `${UHC_START} → ${UHC_END} over the next ${(UHC_CLOSED - UHC_GRACE) / 60} minutes`);
    if (this.t % 5 === 0) this.border();
    if (this.game.player.advancements.has("dragon")) {
      this.data.over = true;
      this.title(null, "UHC won!", `The dragon fell at ${ModeRuntime.clock(this.t)}`);
    }
  }

  onPlayerDeath(id: string): void {
    if (this.data.over) return;
    if (!this.isLocal(id)) this.setGameMode(id, "spectator");
    const left = this.alive().filter((p) => p.id !== id);
    if (!left.length) { this.data.over = true; this.title(null, "Game over", `Everyone fell by ${ModeRuntime.clock(this.t)}`); }
  }

  onRespawn(): void {
    // One life: the dead watch.
    this.setGameMode(this.game.player.id, "spectator");
  }

  objective(): Objective {
    return {
      title: "UHC",
      lines: [
        ["Time", ModeRuntime.clock(this.t)],
        ["Border", `±${uhcBorder(this.t)}`],
        ["Alive", String(this.alive().length)],
        ["Goal", this.data.over ? "over" : "the dragon"],
      ],
    };
  }
}

// ---- speedrun -------------------------------------------------------------------------------

/** The run's milestones, in the order a run meets them, by advancement. */
export const SPLITS: readonly [string, string][] = [
  ["iron", "Iron"], ["nether", "Nether"], ["blaze", "Blaze rod"], ["stronghold", "Stronghold"], ["end", "The End"], ["dragon", "Dragon"],
];

class SpeedrunRuntime extends ModeRuntime {
  private get ticks(): number { return (this.data.ticks as number | undefined) ?? 0; }
  private get splits(): Record<string, number> { return ((this.data.splits as Record<string, number> | undefined) ??= {}); }

  start(): void {
    this.title(null, "Speedrun", "The clock is running");
  }

  tick(): void {
    if (this.data.done) return;
    this.data.ticks = this.ticks + 1;
    const adv = this.game.player.advancements;
    for (const [id, name] of SPLITS) {
      if (this.splits[id] !== undefined || !adv.has(id)) continue;
      const secs = this.ticks / 20;
      this.splits[id] = secs;
      this.tell(null, `Split: ${name} at ${ModeRuntime.clock(secs, true)}`, "#55ffff");
      if (id === "dragon") this.finish(secs);
    }
  }

  private finish(secs: number): void {
    this.data.done = true;
    const best = this.data.best as number | undefined;
    const record = best === undefined || secs < best;
    if (record) this.data.best = secs;
    this.title(null, record ? "New record!" : "Run complete", ModeRuntime.clock(secs, true));
  }

  restart(): string {
    this.data.ticks = 0;
    this.data.splits = {};
    this.data.done = false;
    return "The clock is back to zero (the world stays as it is).";
  }

  objective(): Objective {
    const lines: [string, string][] = [["Time", ModeRuntime.clock(this.ticks / 20, true)]];
    for (const [id, name] of SPLITS) { const s = this.splits[id]; if (s !== undefined) lines.push([name, ModeRuntime.clock(s, true)]); }
    const next = SPLITS.find(([id]) => this.splits[id] === undefined);
    if (next) lines.push(["Next", next[1]]);
    if (this.data.best !== undefined) lines.push(["Record", ModeRuntime.clock(this.data.best as number, true)]);
    return { title: "Speedrun", lines };
  }
}

// ---- random drops ---------------------------------------------------------------------------

/** Things no drop should ever become: the unbreakable, the unobtainable, and the block of air. */
const NEVER = new Set(["air", "bedrock", "spawner", "end_portal_frame", "end_portal", "end_gateway", "nether_portal", "fire", "soul_fire", "piston_head", "water", "lava", "barrier"]);

const tables = new Map<number, Map<number, number>>();

/**
 * This world's drop table: every item mapped to another, one to one, the
 * same for the whole world (so it can be learned) and different in every
 * world (so it has to be).
 */
export function randomDropTable(seed: number): Map<number, number> {
  let t = tables.get(seed);
  if (t) return t;
  const ids = allItems().filter((d) => d.id > 0 && !d.hidden && !NEVER.has(d.name)).map((d) => d.id);
  const shuffled = [...ids];
  const rng = new Rng((seed ^ 0x5eed1e) | 0);
  for (let i = shuffled.length - 1; i > 0; i--) { const j = rng.int(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  t = new Map(ids.map((id, i) => [id, shuffled[i]]));
  tables.set(seed, t);
  return t;
}

class RandomizerRuntime extends ModeRuntime {
  start(): void {
    this.title(null, "Random Drops", "Nothing drops what it should");
  }

  transformDrop(s: ItemStack): ItemStack {
    const to = randomDropTable(this.game.meta.seed).get(s.id);
    if (to === undefined) return s;
    return { id: to, count: Math.max(1, Math.min(s.count, maxStack(to))) };
  }
}

// ---- one heart ------------------------------------------------------------------------------

class OneHeartRuntime extends ModeRuntime {
  resume(): void {
    this.game.maxHealth = 2;
  }

  start(): void {
    this.title(null, "One Heart", "Be careful");
  }
}

// ---- lucky blocks ---------------------------------------------------------------------------

class LuckyRuntime extends ModeRuntime {
  onBlockChange(c: BlockChange): void {
    if (c.prevId === B.LUCKY_BLOCK && c.id !== B.LUCKY_BLOCK && c.cause !== "world" && c.cause !== "load") this.data.opened = ((this.data.opened as number | undefined) ?? 0) + 1;
  }

  objective(): Objective {
    return { title: "Lucky Blocks", lines: [["Opened", String((this.data.opened as number | undefined) ?? 0)]] };
  }
}

registerRuntime("uhc", (g, d, s) => new UhcRuntime(g, d, s));
registerRuntime("speedrun", (g, d, s) => new SpeedrunRuntime(g, d, s));
registerRuntime("randomizer", (g, d, s) => new RandomizerRuntime(g, d, s));
registerRuntime("one_heart", (g, d, s) => new OneHeartRuntime(g, d, s));
registerRuntime("lucky_blocks", (g, d, s) => new LuckyRuntime(g, d, s));
