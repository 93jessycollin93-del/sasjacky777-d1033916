/**
 * The Survival Games: twelve pads round a cornucopia of chests, and whoever
 * the players are not, a tribute is. Ten seconds on the pads, then go. The
 * cornucopia holds the best of it; the wild has chests of its own. At five
 * minutes every chest is filled again (the feast); from two minutes the
 * border closes in, to a small circle of ground by ten. The bold tributes
 * start hunting after a minute, and every one of them by eight. The arena's
 * cannon sounds for each tribute who falls, wherever it happens. The last one
 * standing wins.
 */
import { Mob } from "../engine/mobs";
import { mapLoot } from "../engine/maps";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

const COUNTDOWN = 10;
const FEAST_AT = 300;
const SHRINK_FROM = 120;
const SHRINK_TO = 600;
const FINAL_RADIUS = 20;

/** The border's half-width at `t` seconds into a round that started with `radius`. */
export function sgBorder(t: number, radius: number): number {
  if (t <= SHRINK_FROM) return radius;
  const k = Math.min(1, (t - SHRINK_FROM) / (SHRINK_TO - SHRINK_FROM));
  return Math.round(radius + (FINAL_RADIUS - radius) * k);
}

const NAMES = ["Rue", "Thresh", "Glimmer", "Marvel", "Clove", "Cato", "Foxface", "Finch", "Brutus", "Enobaria", "Wiress", "Beetee", "Mags", "Cecelia", "Chaff", "Blight"];

type Phase = "countdown" | "running" | "over";

class SurvivalGamesRuntime extends ModeRuntime {
  private phase: Phase = "countdown";
  private timer = COUNTDOWN;
  private t = 0;
  private names = new Map<number, string>();
  private tributes = 0;
  private fallen: string[] = [];

  resume(): void {
    // A round never survives the world closing: each opening starts a fresh one once the ground is in.
    this.phase = "countdown";
    this.timer = COUNTDOWN + 1;
    this.game.frozen = true;
  }

  start(): void {
    this.tell(null, "Welcome to the Survival Games. May the odds be ever in your favour.", "#ffaa00");
  }

  private tributeMobs(): Mob[] {
    const out: Mob[] = [];
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.kind === "tribute" && !e.dying && !e.removed) out.push(e);
    return out;
  }

  /** Clears the arena and puts everyone on a pad. */
  private setUp(): void {
    const l = this.layout();
    if (!l?.pads) return;
    for (const m of this.tributeMobs()) m.removed = true;
    this.names.clear();
    this.fallen = [];
    this.t = 0;
    this.refill();
    this.players().forEach((p, i) => {
      const [x, y, z] = l.pads![i % l.pads!.length];
      this.setGameMode(p.id, "survival");
      this.resetPlayer(p.id);
      this.teleport(p.id, x + 0.5, y, z + 0.5);
    });
    this.game.setBorder({ x: l.center[0] + 0.5, z: l.center[1] + 0.5, radius: l.radius });
  }

  /** Fills every chest of the arena again (the start, and the feast). */
  private refill(): void {
    const l = this.layout();
    const w = this.game.world;
    if (!l) return;
    for (const [x, y, z, table] of l.chests) {
      if (!w.isLoaded(x, z)) continue;
      this.game.placeChest(x, y, z, (items) => mapLoot(items, (this.game.meta.seed ^ (x * 73856093) ^ (z * 19349663) ^ Math.floor(this.t)) | 0, table));
    }
  }

  private go(): void {
    const l = this.layout();
    this.phase = "running";
    this.game.frozen = false;
    this.title(null, "Go!", "The games have begun");
    this.game.sound("cannon", null, 0, 0, 1);
    if (!l?.pads) return;
    const free = l.pads.slice(this.players().length);
    free.forEach(([x, y, z], i) => {
      const m = new Mob("tribute", x + 0.5, y, z + 0.5);
      m.persistent = true;
      this.names.set(m.id, NAMES[i % NAMES.length]);
      this.game.spawn(m);
    });
    this.tributes = free.length;
  }

  second(): void {
    if (!this.home) return;
    if (this.phase === "countdown") {
      if (this.timer === COUNTDOWN + 1) this.setUp();
      if (--this.timer > 0) { if (this.timer <= 5) { this.title(null, String(this.timer)); this.game.sound("countdown", null); } }
      else this.go();
      return;
    }
    if (this.phase === "over") {
      if (--this.timer <= 0) { this.phase = "countdown"; this.timer = COUNTDOWN + 1; this.game.frozen = true; }
      return;
    }
    this.t++;
    const l = this.layout();
    if (l) {
      const r = sgBorder(this.t, l.radius);
      if (!this.game.border || this.game.border.radius !== r) this.game.setBorder({ x: l.center[0] + 0.5, z: l.center[1] + 0.5, radius: r });
      if (this.t === SHRINK_FROM) this.tell(null, "The arena is closing in.", "#ff5555");
    }
    if (this.t === FEAST_AT) { this.refill(); this.title(null, "The Feast", "Every chest has been filled again"); }
    const living = this.tributeMobs();
    // The bold go hunting after a minute; everyone left by eight.
    for (const m of living) {
      if (m.hunting) continue;
      if ((this.t >= 60 && m.id % 3 === 0) || this.t >= 480) { m.hunting = true; m.targetId = this.nearest(m.x, m.z)?.id ?? null; }
    }
    // The fights the players never see: now and then a tribute far from everyone falls.
    if (this.t % 25 === 0 && living.length > 1 && Math.random() < 0.45) {
      const far = living.filter((m) => this.alive().every((p) => Math.hypot(p.x - m.x, p.z - m.z) > 32));
      const victim = far[Math.floor(Math.random() * far.length)];
      if (victim) victim.removed = true;
    }
    const now = this.tributeMobs();
    if (now.length < this.tributes) {
      for (const [id, name] of this.names) if (!now.some((m) => m.id === id)) { this.fallen.push(name); this.names.delete(id); }
      this.tributes = now.length;
      this.game.sound("cannon", null, 0, 0, 1);
      this.tell(null, `A cannon fires. ${this.remaining()} remain.`, "#aaaaaa");
    }
    this.checkWinner();
  }

  private remaining(): number {
    return this.alive().length + this.tributes;
  }

  private checkWinner(): void {
    if (this.phase !== "running" || this.remaining() > 1) return;
    const winner = this.alive()[0];
    this.phase = "over";
    this.timer = 12;
    if (winner) {
      this.title(null, `${winner.name} wins!`, "The victor of the Survival Games");
      for (let i = 0; i < 5; i++) this.game.launchFirework(winner.x + (i - 2) * 2, winner.y, winner.z, { flight: 1, bursts: [{ shape: "large", colors: [1 + i] }] }, null);
      const wins = ((this.data.wins as Record<string, number> | undefined) ??= {});
      wins[winner.name] = (wins[winner.name] ?? 0) + 1;
    } else this.title(null, "A tribute wins", "Better luck in the next games");
    this.game.setBorder(null);
  }

  onPlayerDeath(id: string): void {
    if (this.phase !== "running") return;
    const name = this.players().find((p) => p.id === id)?.name ?? "A player";
    this.game.sound("cannon", null, 0, 0, 1);
    const place = this.remaining();
    this.tell(null, `A cannon fires: ${name} has fallen. ${Math.max(0, place - 1)} remain.`, "#aaaaaa");
    this.title(id, `You placed #${place}`, "Watch the rest from above");
    if (!this.isLocal(id)) this.setGameMode(id, "spectator");
    // The one who fell is still counted among the living until their death reaches us; count them out now.
    this.checkWinnerAfter(id);
  }

  private checkWinnerAfter(dead: string): void {
    const left = this.alive().filter((p) => p.id !== dead).length + this.tributes;
    if (left <= 1) this.checkWinner();
  }

  onRespawn(): void {
    if (this.phase === "running") this.setGameMode(this.game.player.id, "spectator");
  }

  restart(): string {
    this.phase = "countdown";
    this.timer = COUNTDOWN + 1;
    this.game.frozen = true;
    return "New games begin: everyone back on the pads.";
  }

  objective(): Objective {
    const l = this.layout();
    return {
      title: "Survival Games",
      lines: [
        ["Remaining", String(this.remaining())],
        ["Time", this.phase === "countdown" ? `starts in ${Math.max(0, this.timer)}` : ModeRuntime.clock(this.t)],
        ["Border", String(this.game.border?.radius ?? l?.radius ?? 0)],
        ["Feast", this.t < FEAST_AT ? ModeRuntime.clock(FEAST_AT - this.t) : "done"],
        ...(this.fallen.length ? [["Last fallen", this.fallen.at(-1)!] as [string, string]] : []),
      ],
    };
  }
}

registerRuntime("survival_games", (g, d, s) => new SurvivalGamesRuntime(g, d, s));
