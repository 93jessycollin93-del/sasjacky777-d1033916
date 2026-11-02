/**
 * Ashgrove County (after the zombie survival sandboxes, Project Zomboid above
 * all): a sealed county, a house of your own to start in, and nothing to do
 * but last. The county itself (engine/county.ts) is the content; the runtime
 * keeps the count — days alive and infected put down — says where you are,
 * and keeps the cordon: the soldiers on the fence turn back anyone who tries
 * to leave, first with a warning and then with rifles.
 */
import { CORDON } from "../engine/county";
import { countyDay, countyHour, helicopter } from "../engine/countyLife";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

class AshgroveRuntime extends ModeRuntime {
  private get born(): Record<string, number> { return ((this.data.born as Record<string, number> | undefined) ??= {}); }
  private get kills(): Record<string, number> { return ((this.data.kills as Record<string, number> | undefined) ??= {}); }
  private warned = new Map<string, number>();

  start(): void {
    this.title(null, "Ashgrove County", "Day one. The county has been sealed.");
    this.tell(null, "Search the houses: kitchens, bathrooms and garages hold what you need. Close doors behind you. The infected hear everything.", "#aaffaa");
    this.tell(null, "The army holds a fence round the county. Nobody crosses it.", "#aaffaa");
    for (const p of this.players()) this.begin(p.name);
  }

  private begin(name: string): void {
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
    this.tell(null, `${p.name} survived ${days.toFixed(1)} days in Ashgrove County, and put down ${this.kills[p.name] ?? 0} of the infected.`, "#ff8888");
    this.begin(p.name);
  }

  onRespawn(): void {
    this.begin(this.game.player.name);
  }

  /**
   * The helicopter: once, on a day and hour of the world's own, it comes low
   * over the county and circles whoever it finds, for a minute and a half —
   * and every one of the dead in earshot follows the noise to them.
   */
  private helicopter(): void {
    const { day, hour } = helicopter(this.game.meta.seed);
    const now = countyDay(this.game.time), h = countyHour(this.game.time);
    const left = (this.data.heli as number | undefined) ?? -1;
    if (left === -1 && now === day && h >= hour) {
      this.data.heli = 90;
      this.tell(null, "A helicopter, low over the rooftops — circling. It isn't landing. And everything dead for miles can hear it.", "#ffcc55");
      return;
    }
    if (left > 0) {
      this.data.heli = left - 1;
      for (const p of this.players()) {
        if (p.dead || p.spectating) continue;
        if (left % 4 === 0) this.game.sound("helicopter", p.x, p.y + 30, p.z, 1.5, 1);
        if (left % 6 === 0) this.game.makeNoise(p.x, p.y, p.z, 90, p.id);
      }
      if (left === 1) { this.data.heli = 0; this.tell(null, "The helicopter's noise fades away to the east.", "#cccccc"); }
    }
  }

  second(): void {
    if (!this.home) return;
    this.helicopter();
    for (const p of this.players()) {
      if (this.born[p.name] === undefined) this.begin(p.name);
      if (p.dead || p.spectating) continue;
      // The fence: a warning at the wire, rifle fire past it.
      const out = Math.max(Math.abs(p.x), Math.abs(p.z)) - CORDON;
      if (out < -6) { this.warned.delete(p.id); continue; }
      const last = this.warned.get(p.id) ?? -99;
      if (out < 0 && this.game.time - last > 400) {
        this.warned.set(p.id, this.game.time);
        this.tell(p.id, "A loudspeaker on the fence: \"Step away from the wire. This is your only warning.\"", "#ffcc55");
      } else if (out >= 0) {
        this.game.sound("gun_rifle", p.x, p.y, p.z, 1.2, 1);
        this.hurt(p.id, 6, "arrow");
        this.tell(p.id, "Shots from the fence. The soldiers are not letting anyone out.", "#ff5555");
      }
    }
  }

  objective(id: string): Objective {
    const p = this.players().find((x) => x.id === id);
    const name = p?.name ?? "";
    const days = (this.game.time - (this.born[name] ?? this.game.time)) / 24000;
    const where = p ? this.game.countyPlace(p.x, p.z) : "";
    return {
      title: "Ashgrove County",
      lines: [["Day", String(Math.floor(days) + 1)], ["Infected down", String(this.kills[name] ?? 0)], ["Where", where]],
    };
  }
}

registerRuntime("ashgrove", (g, d, s) => new AshgroveRuntime(g, d, s));
