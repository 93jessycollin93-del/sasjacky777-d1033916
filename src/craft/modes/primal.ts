/**
 * Primal (after ARK: Survival Evolved and Ascended). The creatures, taming,
 * riding, engrams, thirst and body heat live in the engine and the game,
 * switched on by the mode's definition; what is left for the runtime is the
 * Island's welcome, a scoreboard, and the supply drops that fall from the sky
 * every so often, better the longer you have lasted.
 */
import { B } from "../engine/blocks";
import { fillLoot, type LootTable } from "../engine/maps";
import { Rng } from "../engine/rng";
import { Mob } from "../engine/mobs";
import { isDino } from "../engine/creatures";
import { ENGRAMS } from "../engine/engrams";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

/** What a supply drop holds, by how many days the survivors have lasted. */
export const SUPPLY_TIERS: readonly LootTable[] = [
  [["kibble", 2, 4, 0.8], ["narcotic", 2, 4, 0.8], ["tranq_arrow", 4, 10, 0.8], ["cooked_meat", 3, 6, 0.8], ["mejoberry", 6, 12, 0.7], ["iron_ingot", 2, 5, 0.6], ["saddle", 1, 1, 0.3], ["leather_chestplate", 1, 1, 0.4]],
  [["kibble", 4, 8, 0.9], ["narcotic", 4, 8, 0.9], ["tranq_arrow", 8, 16, 0.9], ["iron_ingot", 6, 12, 0.8], ["heavy_saddle", 1, 1, 0.35], ["flyer_saddle", 1, 1, 0.35], ["iron_chestplate", 1, 1, 0.4], ["golden_apple", 1, 2, 0.4]],
  [["kibble", 8, 16, 1], ["tranq_arrow", 16, 32, 1], ["diamond", 2, 6, 0.8], ["heavy_saddle", 1, 1, 0.6], ["diamond_sword", 1, 1, 0.4], ["diamond_chestplate", 1, 1, 0.3], ["experience_bottle", 8, 16, 0.8]],
];

/** Which supply tier a day of the world earns. */
export function supplyTier(day: number): number {
  return day >= 8 ? 2 : day >= 3 ? 1 : 0;
}

class PrimalRuntime extends ModeRuntime {
  private nextDrop = 240 + Math.floor(Math.random() * 120);

  start(): void {
    const ascended = this.def.primal === "ascended";
    this.title(null, ascended ? "Survival Ascended" : "Survival Evolved", "You wake on the beach with nothing");
    this.tell(null, "Punch trees; right-click berry bushes. Knock a creature out with a club, your fists or tranquilizer arrows, then feed it — kibble best — until it is yours.", "#aaffaa");
    this.tell(null, `Level up to learn engrams (Esc → Engrams). Keep water and warmth up.${ascended ? " Ascended's creatures tame faster, and tell you what they eat." : ""}`, "#aaffaa");
  }

  second(): void {
    if (!this.home || --this.nextDrop > 0) return;
    this.nextDrop = 360 + Math.floor(Math.random() * 180);
    this.supplyDrop();
  }

  /** A crate out of the sky, near someone: a flare over it, and where it fell, in words. */
  private supplyDrop(): void {
    const g = this.game;
    const people = this.alive();
    if (!people.length) return;
    const who = people[Math.floor(Math.random() * people.length)];
    const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 40;
    const x = Math.floor(who.x + Math.cos(a) * r), z = Math.floor(who.z + Math.sin(a) * r);
    if (!g.world.isLoaded(x, z)) return;
    const top = g.world.topSolid(x, z);
    if (top < 1) return;
    const y = top + 1;
    const day = Math.floor(g.time / 24000);
    const tier = SUPPLY_TIERS[supplyTier(day)];
    g.placeChest(x, y, z, (items) => fillLoot(items, new Rng((g.meta.seed ^ (x * 73856093) ^ (z * 19349663) ^ day) | 0), tier, false));
    g.world.setBlock(x, y + 1, z, B.LANTERN, 0, "world");
    for (let i = 0; i < 3; i++) g.launchFirework(x + 0.5, y + 1, z + 0.5, { flight: 2 + i, bursts: [{ shape: "large", colors: [1 + i * 4] }] }, null);
    this.tell(null, `A supply drop has landed at ${x}, ${y}, ${z}.`, "#ffd060");
  }

  objective(id: string): Objective {
    const g = this.game;
    let tames = 0;
    for (const e of g.entities.values()) if (e instanceof Mob && isDino(e.kind) && e.owner === id) tames++;
    const lines: [string, string][] = [["Day", String(Math.floor(g.time / 24000) + 1)], ["Tames nearby", String(tames)]];
    if (this.isLocal(id)) lines.push(["Engrams", `${g.player.engrams.size}/${ENGRAMS.length}`]);
    lines.push(["Next drop", ModeRuntime.clock(Math.max(0, this.nextDrop))]);
    return { title: this.def.primal === "ascended" ? "Primal · Ascended" : "Primal · Evolved", lines };
  }
}

registerRuntime("primal_evolved", (g, d, s) => new PrimalRuntime(g, d, s));
registerRuntime("primal_ascended", (g, d, s) => new PrimalRuntime(g, d, s));
registerRuntime("primal_wilds", (g, d, s) => new PrimalRuntime(g, d, s));
