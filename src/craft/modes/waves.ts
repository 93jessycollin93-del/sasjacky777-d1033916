/**
 * Wave Defense (after Mob Arena): monsters pour through the colosseum's four
 * gates, a little more of them and a little worse each wave. Between waves
 * there is a short breather, and gear: arrows and food every time, a piece of
 * armour most times, better as the waves go on. Anyone who dies watches from
 * the stands until the next wave; when nobody is left, it is over — and the
 * best wave reached is remembered.
 */
import { Mob, type MobKind } from "../engine/mobs";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

/** The monsters of wave `n` (from 1), strongest last. */
export function waveMobs(n: number): MobKind[] {
  const out: MobKind[] = [];
  const add = (kind: MobKind, count: number) => { for (let i = 0; i < Math.max(0, Math.floor(count)); i++) out.push(kind); };
  add("zombie", 2 + n);
  add("skeleton", n / 2);
  add("spider", (n - 1) / 3);
  add("creeper", (n - 2) / 3);
  add("wither_skeleton", (n - 4) / 3);
  add("blaze", (n - 6) / 2);
  if (n % 5 === 0) add("hoglin", n / 5);
  return out.slice(0, 32);
}

/** What everyone gets for clearing wave `n`. */
export function waveReward(n: number): [string, number][] {
  const out: [string, number][] = [["arrow", 8], ["cooked_beef", 3]];
  const gear: Record<number, [string, number][]> = {
    1: [["iron_helmet", 1]], 2: [["iron_boots", 1]], 3: [["iron_leggings", 1]], 4: [["iron_chestplate", 1]],
    5: [["golden_apple", 2], ["diamond_sword", 1]], 6: [["diamond_helmet", 1]], 7: [["diamond_boots", 1]],
    8: [["diamond_leggings", 1]], 9: [["diamond_chestplate", 1]], 10: [["golden_apple", 3], ["experience_bottle", 16]],
  };
  out.push(...(gear[n] ?? (n > 10 && n % 2 === 0 ? [["golden_apple", 1] as [string, number]] : [])));
  return out;
}

const BREAK_SECONDS = 12;
const KIT: [string, number][] = [["stone_sword", 1], ["bow", 1], ["arrow", 24], ["leather_chestplate", 1], ["bread", 8]];

type Phase = "break" | "fight" | "over";

class WavesRuntime extends ModeRuntime {
  private get wave(): number { return (this.data.wave as number | undefined) ?? 0; }
  private get phase(): Phase { return (this.data.phase as Phase | undefined) ?? "break"; }
  private timer = BREAK_SECONDS;
  private kills = 0;

  start(): void {
    this.giveAll(KIT);
    this.title(null, "Wave Defense", "Hold the colosseum");
    this.begin();
  }

  resume(): void {
    // Night, always: the undead burn in daylight, and a colosseum at dusk is the better show.
    const g = this.game;
    g.time = Math.floor(g.time / 24000) * 24000 + 18000;
    // A wave left half fought when the world closed starts over.
    if (this.phase === "fight") this.data.phase = "break";
    this.timer = BREAK_SECONDS;
  }

  private begin(): void {
    this.data.wave = 0;
    this.data.phase = "break";
    this.timer = BREAK_SECONDS;
    this.kills = 0;
  }

  /** Every monster of the waves still standing in the arena. */
  private monsters(): Mob[] {
    const out: Mob[] = [];
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.hunting && !e.dying && !e.removed) out.push(e);
    return out;
  }

  second(): void {
    if (!this.home) return;
    const phase = this.phase;
    if (phase === "break") {
      if (--this.timer <= 0) this.spawnWave();
      else if (this.timer <= 3) this.title(null, String(this.timer), `Wave ${this.wave + 1}`);
      return;
    }
    if (phase === "fight") {
      if (!this.alive().length) { this.gameOver(); return; }
      // Keep every monster on someone: one that lost its target would idle by its gate.
      for (const m of this.monsters()) {
        if (m.targetId && this.alive().some((p) => p.id === m.targetId)) continue;
        m.targetId = this.nearest(m.x, m.z)?.id ?? null;
      }
      if (!this.monsters().length) this.cleared();
      return;
    }
    if (phase === "over" && --this.timer <= 0) {
      this.begin();
      for (const p of this.players()) { this.setGameMode(p.id, "survival"); this.teleportCentre(p.id); }
      this.giveAll(KIT);
      this.tell(null, "A new game begins.", "#55ff55");
    }
  }

  private spawnWave(): void {
    const n = this.wave + 1;
    this.data.wave = n;
    this.data.phase = "fight";
    const gates = this.layout()?.pads ?? [[0, 65, 0]];
    // Everyone watching comes back for the new wave.
    for (const p of this.players()) if (p.spectating && !p.dead) { this.setGameMode(p.id, "survival"); this.teleportCentre(p.id); }
    waveMobs(n).forEach((kind, i) => {
      const [x, y, z] = gates[i % gates.length];
      const target = this.nearest(x, z);
      this.spawnMob(kind, x + 0.5 + ((i >> 2) % 3) - 1, y, z + 0.5, target?.id);
    });
    this.title(null, `Wave ${n}`, `${waveMobs(n).length} monsters`);
    this.game.sound("horn", null, 0, 0, 1);
  }

  private cleared(): void {
    const n = this.wave;
    this.data.phase = "break";
    this.timer = BREAK_SECONDS;
    this.data.best = Math.max((this.data.best as number | undefined) ?? 0, n);
    this.title(null, `Wave ${n} cleared!`, "Gear up");
    this.giveAll(waveReward(n));
    for (const p of this.players()) {
      if (this.isLocal(p.id)) this.game.player.addEffect("regeneration", 8, 1);
      else this.game.net?.effectRemote?.(p.id, "regeneration", 8, 1);
    }
  }

  private gameOver(): void {
    const n = this.wave;
    const survived = Math.max(0, n - 1);
    this.data.phase = "over";
    this.data.best = Math.max((this.data.best as number | undefined) ?? 0, survived);
    this.timer = 8;
    for (const m of this.monsters()) m.removed = true;
    this.title(null, "Game over", `You held for ${survived} wave${survived === 1 ? "" : "s"} — best ${this.data.best}`);
  }

  private teleportCentre(id: string): void {
    const s = this.layout()?.spawn;
    if (s) this.teleport(id, s[0], s[1], s[2]);
  }

  onKill(): void {
    this.kills++;
  }

  onPlayerDeath(id: string): void {
    // Whoever falls watches the rest of the wave from above.
    if (this.phase === "fight" && !this.isLocal(id)) this.setGameMode(id, "spectator");
  }

  onRespawn(): void {
    if (this.phase === "fight") this.setGameMode(this.game.player.id, "spectator");
  }

  restart(): string {
    for (const m of this.monsters()) m.removed = true;
    this.begin();
    for (const p of this.players()) { this.setGameMode(p.id, "survival"); this.teleportCentre(p.id); }
    this.giveAll(KIT);
    return "The arena is cleared; wave 1 is coming.";
  }

  objective(): Objective {
    const left = this.phase === "fight" ? this.monsters().length : 0;
    return {
      title: "Wave Defense",
      lines: [
        ["Wave", String(this.wave)],
        this.phase === "break" ? ["Next wave in", `${this.timer}s`] : this.phase === "over" ? ["Game over", `${this.timer}s`] : ["Monsters left", String(left)],
        ["Kills", String(this.kills)],
        ["Best", String((this.data.best as number | undefined) ?? 0)],
      ],
    };
  }
}

registerRuntime("waves", (g, d, s) => new WavesRuntime(g, d, s));
