/**
 * Parkour: the clock starts when a runner steps off the gold start pad, each
 * gold pad after it is a checkpoint, and the diamond pad stops the clock. A
 * fall below the course puts a runner back on their last checkpoint; the
 * best time is kept for each runner, by name.
 */
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime, type ModePlayer } from "./runtime";

interface Run {
  /** Last checkpoint reached (0 is the start). */
  cp: number;
  /** Ticks since the run began, or -1 before stepping off the start. */
  ticks: number;
  falls: number;
}

class ParkourRuntime extends ModeRuntime {
  private runs = new Map<string, Run>();
  private get best(): Record<string, number> { return ((this.data.best as Record<string, number> | undefined) ??= {}); }

  private run(id: string): Run {
    let r = this.runs.get(id);
    if (!r) { r = { cp: 0, ticks: -1, falls: 0 }; this.runs.set(id, r); }
    return r;
  }

  start(): void {
    this.title(null, "Parkour", "Step off the gold to start the clock");
  }

  tick(): void {
    const l = this.layout();
    const cps = l?.checkpoints;
    if (!l || !cps || !this.home) return;
    for (const p of this.players()) {
      if (p.dead) continue;
      const r = this.run(p.id);
      // The start pad is five wide, the others three.
      const on = cps.findIndex(([x, y, z], i) => {
        const half = i === 0 ? 2.6 : 1.6;
        return Math.abs(p.x - (x + 0.5)) < half && Math.abs(p.z - (z + 0.5)) < half && p.y >= y - 0.1 && p.y < y + 0.6;
      });
      if (r.ticks >= 0) r.ticks++;
      if (on === 0) {
        // Back on the start: the clock waits again.
        if (r.cp !== 0 || r.ticks > 0) { r.cp = 0; r.ticks = -1; }
      } else if (r.ticks < 0 && r.cp === 0 && p.y > cps[0][1] - 3) {
        r.ticks = 0;
        this.tell(p.id, "Go!", "#55ff55");
      }
      if (on > r.cp) {
        r.cp = on;
        if (on === cps.length - 1) this.finish(p, r);
        else { this.title(p.id, `Checkpoint ${on}`, ModeRuntime.clock(r.ticks / 20, true)); this.game.sound("orb", null, 0, 0, 0.6, 1.4); }
      }
      if (p.y < l.floorY) this.fall(p, r);
    }
  }

  private fall(p: ModePlayer, r: Run): void {
    const cps = this.layout()!.checkpoints!;
    const [x, y, z] = cps[r.cp];
    r.falls++;
    this.teleport(p.id, x + 0.5, y + 0.1, z + 0.5);
  }

  private finish(p: ModePlayer, r: Run): void {
    const secs = r.ticks / 20;
    const prev = this.best[p.name];
    const record = prev === undefined || secs < prev;
    if (record) this.best[p.name] = secs;
    this.title(p.id, record ? "New best!" : "Finished!", `${ModeRuntime.clock(secs, true)}${prev !== undefined ? ` (best ${ModeRuntime.clock(Math.min(prev, secs), true)})` : ""}`);
    this.tell(null, `${p.name} finished the course in ${ModeRuntime.clock(secs, true)} with ${r.falls} fall${r.falls === 1 ? "" : "s"}.`, "#55ffff");
    const b = this.layout()!.checkpoints!.at(-1)!;
    this.game.launchFirework(b[0] + 0.5, b[1], b[2] + 0.5, { flight: 1, bursts: [{ shape: "star", colors: [3, 11] }] }, null);
    r.ticks = -1;
  }

  restart(): string {
    const cps = this.layout()?.checkpoints;
    if (!cps) return "There is no course in this world.";
    this.runs.clear();
    for (const p of this.players()) this.teleport(p.id, cps[0][0] + 0.5, cps[0][1] + 0.1, cps[0][2] + 0.5);
    return "Everyone is back on the start pad.";
  }

  objective(id: string): Objective {
    const r = this.run(id);
    const cps = this.layout()?.checkpoints?.length ?? 1;
    const name = this.players().find((p) => p.id === id)?.name ?? "";
    const best = this.best[name];
    return {
      title: "Parkour",
      lines: [
        ["Time", r.ticks < 0 ? "—" : ModeRuntime.clock(r.ticks / 20, true)],
        ["Checkpoint", `${r.cp}/${cps - 1}`],
        ["Falls", String(r.falls)],
        ["Best", best === undefined ? "—" : ModeRuntime.clock(best, true)],
      ],
    };
  }
}

registerRuntime("parkour", (g, d, s) => new ParkourRuntime(g, d, s));
