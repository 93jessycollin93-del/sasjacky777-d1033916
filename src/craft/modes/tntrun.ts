/**
 * TNT Run: three floors of wool over the void, and every block anyone stands
 * on drops away a moment later. Fall through all three and you are out. The
 * last one standing wins; alone, it is you against the clock.
 */
import { B } from "../engine/blocks";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

/** Ticks between a block being stood on and it falling away. */
export const TNT_RUN_DELAY = 8;
const COUNTDOWN = 5;

type Phase = "countdown" | "running" | "over";

class TntRunRuntime extends ModeRuntime {
  private phase: Phase = "countdown";
  private timer = COUNTDOWN;
  private ticks = 0;
  /** Blocks due to fall: "x,y,z" → the tick they go. */
  private doomed = new Map<string, number>();
  private out = new Map<string, number>();

  start(): void {
    this.title(null, "TNT Run", "Keep moving!");
  }

  resume(): void {
    this.countdown();
  }

  private countdown(): void {
    this.phase = "countdown";
    this.timer = COUNTDOWN;
    this.ticks = 0;
    this.out.clear();
    this.doomed.clear();
    this.game.frozen = true;
  }

  /** Puts every floor back as it was built. */
  private rebuild(): void {
    const l = this.layout();
    if (!l?.floors || !this.home) return;
    const w = this.game.world;
    for (const list of l.blocks.values()) {
      for (let i = 0; i < list.length; i += 5) {
        const [x, y, z, id, meta] = list.slice(i, i + 5);
        if (w.isLoaded(x, z) && w.blockAt(x, y, z) !== id) w.setBlock(x, y, z, id, meta, "world");
      }
    }
  }

  tick(): void {
    if (this.phase !== "running" || !this.home) return;
    const l = this.layout();
    if (!l?.floors) return;
    this.ticks++;
    const w = this.game.world;
    for (const p of this.alive()) {
      // The four blocks under a runner's feet: standing on a seam doesn't save anyone.
      for (const dx of [-0.3, 0.3]) for (const dz of [-0.3, 0.3]) {
        const bx = Math.floor(p.x + dx), by = Math.floor(p.y - 0.2), bz = Math.floor(p.z + dz);
        if (!l.floors.includes(by) || w.blockAt(bx, by, bz) === B.AIR) continue;
        const key = `${bx},${by},${bz}`;
        if (!this.doomed.has(key)) this.doomed.set(key, this.ticks + TNT_RUN_DELAY);
      }
      if (p.y < l.floorY && !this.out.has(p.id)) this.knockOut(p.id, p.name);
    }
    for (const [key, at] of this.doomed) {
      if (at > this.ticks) continue;
      this.doomed.delete(key);
      const [x, y, z] = key.split(",").map(Number);
      if (w.blockAt(x, y, z) !== B.AIR) {
        w.setBlock(x, y, z, B.AIR, 0, "world");
        if (this.ticks % 3 === 0) this.game.particles("smoke", x + 0.5, y + 0.5, z + 0.5, 2);
      }
    }
  }

  private knockOut(id: string, name: string): void {
    const secs = this.ticks / 20;
    this.out.set(id, secs);
    this.setGameMode(id, "spectator");
    const s = this.layout()!.spawn;
    this.teleport(id, s[0], s[1] + 4, s[2]);
    const left = this.alive().filter((p) => p.id !== id);
    this.tell(null, `${name} fell after ${ModeRuntime.clock(secs, true)}.`, "#ffaa00");
    const solo = this.players().length === 1;
    if (solo) {
      const best = Math.max((this.data.best as number | undefined) ?? 0, secs);
      const record = best === secs;
      this.data.best = best;
      this.title(id, record ? "New best!" : "Out!", `You lasted ${ModeRuntime.clock(secs, true)}`);
      this.end();
    } else if (left.length <= 1) {
      const winner = left[0];
      if (winner) this.title(null, `${winner.name} wins!`, `after ${ModeRuntime.clock(secs, true)}`);
      this.end();
    }
  }

  private end(): void {
    this.phase = "over";
    this.timer = 6;
  }

  second(): void {
    if (!this.home) return;
    if (this.phase === "countdown") {
      // The floors go back during the countdown: when the world first opens its chunks are still arriving.
      this.rebuild();
      if (--this.timer > 0) this.title(null, String(this.timer), "Get ready");
      else {
        this.phase = "running";
        this.game.frozen = false;
        this.title(null, "Run!");
      }
    } else if (this.phase === "over" && --this.timer <= 0) this.restartRound();
  }

  private restartRound(): void {
    this.rebuild();
    const s = this.layout()?.spawn;
    for (const p of this.players()) {
      this.setGameMode(p.id, "adventure");
      if (s) this.teleport(p.id, s[0], s[1], s[2]);
    }
    this.countdown();
  }

  restart(): string {
    this.restartRound();
    return "The floors are back; the round starts in a moment.";
  }

  objective(id: string): Objective {
    const time = this.phase === "running" ? ModeRuntime.clock(this.ticks / 20, true) : this.phase === "countdown" ? `starts in ${this.timer}` : "—";
    const out = this.out.get(id);
    return {
      title: "TNT Run",
      lines: [
        ["Time", time],
        ["Still running", String(this.alive().length)],
        ...(out !== undefined ? [["You lasted", ModeRuntime.clock(out, true)] as [string, string]] : []),
        ["Best", this.data.best === undefined ? "—" : ModeRuntime.clock(this.data.best as number, true)],
      ],
    };
  }
}

registerRuntime("tnt_run", (g, d, s) => new TntRunRuntime(g, d, s));
