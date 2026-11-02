/**
 * Dead Zone (after DayZ). The world does most of it: the infected roam by day
 * and night and hear every gunshot, the towns and the military base hold
 * what there is to find, and thirst, cold, bleeding, fever and broken legs are
 * kept (engine/vitals.ts). The runtime starts each life with what a fresh
 * spawn has — next to nothing — counts how long each survivor has lasted and
 * how many infected they have put down, and now and then brings a helicopter
 * down somewhere near, with military crates in the wreck and infected round it.
 */
import { B } from "../engine/blocks";
import { fillLoot, mapLootTable } from "../engine/maps";
import { Mob } from "../engine/mobs";
import { Rng } from "../engine/rng";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

/** What a fresh spawn carries: a bandage, something to drink and something to eat. */
export const FRESH_SPAWN: [string, number][] = [["bandage", 1], ["soda_can", 1], ["canned_beans", 1]];

/** Which way a point lies from another, in words. */
export function bearing(dx: number, dz: number): string {
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  // North is -z in this world.
  const a = (Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2);
  return names[Math.round(a / (Math.PI / 4)) % 8];
}

class DeadZoneRuntime extends ModeRuntime {
  private nextCrash = 300 + Math.floor(Math.random() * 120);

  private get born(): Record<string, number> { return ((this.data.born as Record<string, number> | undefined) ??= {}); }
  private get kills(): Record<string, number> { return ((this.data.kills as Record<string, number> | undefined) ??= {}); }

  start(): void {
    this.title(null, "Dead Zone", "Stay quiet. Stay fed. Stay alive.");
    this.tell(null, "The infected hear gunshots and running. Loot the towns; the hospital holds medicine, the military base to the north holds guns.", "#aaffaa");
    this.tell(null, "A bandage stops bleeding, a splint (two sticks and string) sets a leg, antibiotics break a fever. Drink from water with an empty hand.", "#aaffaa");
    for (const p of this.players()) this.freshSpawn(p.id, p.name);
  }

  private freshSpawn(id: string, name: string): void {
    for (const [n, c] of FRESH_SPAWN) { const s = ModeRuntime.stack(n, c); if (s) this.give(id, s); }
    this.born[name] = this.game.time;
    this.kills[name] = 0;
  }

  onKill(killer: string): void {
    const p = this.players().find((x) => x.id === killer);
    if (p) this.kills[p.name] = (this.kills[p.name] ?? 0) + 1;
  }

  onPlayerDeath(id: string): void {
    const p = this.players().find((x) => x.id === id);
    if (!p) return;
    const days = (this.game.time - (this.born[p.name] ?? this.game.time)) / 24000;
    this.tell(null, `${p.name} died after ${days.toFixed(1)} days, with ${this.kills[p.name] ?? 0} infected put down.`, "#ff8888");
    // A guest's fresh-spawn kit waits in their emptied inventory for them to respawn into.
    if (!this.isLocal(id)) this.freshSpawn(id, p.name);
  }

  onRespawn(): void {
    const p = this.game.player;
    this.freshSpawn(p.id, p.name);
  }

  second(): void {
    if (!this.home) return;
    // Anyone who joined partway through starts their count now.
    for (const p of this.players()) if (this.born[p.name] === undefined) this.born[p.name] = this.game.time;
    if (--this.nextCrash > 0) return;
    this.nextCrash = 600 + Math.floor(Math.random() * 240);
    this.crash();
  }

  /** A helicopter down: wreckage burning, two military crates, and the infected drawn by the noise. */
  private crash(): void {
    const g = this.game;
    const people = this.alive();
    if (!people.length) return;
    const who = people[Math.floor(Math.random() * people.length)];
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 50;
    const x = Math.floor(who.x + Math.cos(a) * r), z = Math.floor(who.z + Math.sin(a) * r);
    if (!g.world.isLoaded(x, z)) { this.nextCrash = 20; return; }
    const y = g.world.topSolid(x, z) + 1;
    if (y < 2) return;
    const w = g.world;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -1; dz <= 1; dz++) w.setBlock(x + dx, y, z + dz, dx === 0 ? B.IRON_BLOCK : B.IRON_BARS, 0, "world");
    for (let dz = 2; dz <= 6; dz++) w.setBlock(x, y, z + dz, B.IRON_BARS, 0, "world");
    for (const [dx, dz] of [[-2, 2], [2, -2], [1, 3]]) if (w.blockAt(x + dx, y, z + dz) === B.AIR) w.setBlock(x + dx, y, z + dz, B.FIRE, 0, "world");
    const table = mapLootTable("dz_military");
    for (const [dx, dz] of [[-2, -2], [2, 2]]) g.placeChest(x + dx, y, z + dz, (items) => fillLoot(items, new Rng((g.meta.seed ^ (x * 31) ^ (z * 17) ^ dx) | 0), table, false));
    for (let i = 0; i < 4; i++) {
      const m = new Mob(i === 0 ? "brute" : "infected", x + (Math.random() - 0.5) * 10, y, z + (Math.random() - 0.5) * 10);
      g.spawn(m);
    }
    g.sound("explode", x, y, z, 1.5, 0.7);
    g.makeNoise(x, y, z, 80, who.id);
    this.tell(null, `A helicopter has come down to the ${bearing(x - who.x, z - who.z)}, about ${Math.round(r)} blocks from ${who.name}. Military crates in the wreck — and it drew the infected.`, "#ffd060");
  }

  objective(id: string): Objective {
    const p = this.players().find((x) => x.id === id);
    const name = p?.name ?? "";
    const days = (this.game.time - (this.born[name] ?? this.game.time)) / 24000;
    return {
      title: "Dead Zone",
      lines: [
        ["Days alive", days.toFixed(1)],
        ["Infected down", String(this.kills[name] ?? 0)],
        ["Survivors", String(this.alive().length)],
      ],
    };
  }
}

registerRuntime("dead_zone", (g, d, s) => new DeadZoneRuntime(g, d, s));
