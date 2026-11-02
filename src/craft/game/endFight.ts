/**
 * The dragon fight's bookkeeping, host side: starting it the first time
 * anyone reaches the End, what follows the dragon's death (the portal home,
 * the egg, a gateway), and summoning it again with four crystals on the
 * exit portal's rim.
 *
 * The state lives in the world's meta so it survives a reload and a trip
 * home: whether the fight has begun, whether a dragon has ever died (the egg
 * is laid and the big experience paid only the first time), and how many
 * gateways have opened.
 */
import { B } from "../engine/blocks";
import { buildGateway, buildPodium, crystalSpot, EndGenerator, endSpikes, GATEWAY_COUNT, gatewayOrder, gatewayPosition, podiumPortalCells } from "../engine/end";
import { EndCrystal } from "../engine/entities";
import { Mob } from "../engine/mobs";
import type { Game } from "./game";

export interface EndState {
  /** The dragon and its crystals have been put in place. */
  fight: boolean;
  /** A dragon has been killed at least once. */
  killed: boolean;
  /** Gateways opened so far (in the world's gateway order). */
  gateways: number;
  /** A dragon is alive now (between its summoning and its death). */
  alive: boolean;
  /** Ticks left in a summoning started with four crystals on the rim. */
  summoning?: number;
}

const DRAGON_XP_FIRST = 12000;
const DRAGON_XP_AGAIN = 500;

export class EndFight {
  constructor(private game: Game) {}

  private get state(): EndState {
    return (this.game.meta.end ??= { fight: false, killed: false, gateways: 0, alive: false });
  }

  private get podiumY(): number {
    const g = this.game.generator;
    return g instanceof EndGenerator ? g.podiumY() : 64;
  }

  /** The dragon, if one is in the world. */
  dragon(): Mob | null {
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.kind === "ender_dragon" && !e.removed) return e;
    return null;
  }

  /** Called every tick while the End is loaded and simulated. */
  tick(): void {
    const s = this.state;
    const g = this.game;
    if (!s.fight) {
      // The first arrival: crystals on every spike, and the dragon over the island.
      s.fight = true;
      for (const spike of endSpikes(g.meta.seed)) g.spawn(new EndCrystal(...crystalSpot(spike)));
      this.spawnDragon();
    } else if (s.alive && !this.dragon() && !s.summoning) {
      // A world saved mid-fight whose dragon went missing: bring it back rather than leave the fight unwinnable.
      this.spawnDragon();
    }
    if (s.summoning !== undefined) this.tickSummoning();
  }

  private spawnDragon(): void {
    const dragon = new Mob("ender_dragon", 0.5, this.podiumY + 40, 0.5);
    dragon.dragon!.podiumY = this.podiumY;
    this.game.spawn(dragon);
    this.state.alive = true;
    this.game.sound("ender_dragon_growl", 0.5, this.podiumY + 30, 0.5, 4, 0.7);
  }

  /** A crystal went up: if the dragon was drawing on it, the dragon takes the blast. */
  crystalDestroyed(crystal: EndCrystal, attacker: string | undefined): void {
    const d = this.dragon();
    if (!d || d.dragon?.crystal !== crystal.id) return;
    d.dragon.crystal = null;
    d.invulnerable = 0;
    d.hurt(this.game.ctx, 10, "magic", crystal.x, crystal.z, attacker);
  }

  /**
   * The dragon's death throes are over: its experience rains on the portal,
   * the portal home lights, the egg is laid on the pillar (the first time),
   * and the next gateway opens.
   */
  defeated(): void {
    const g = this.game;
    const s = this.state;
    const y = this.podiumY;
    const first = !s.killed;
    s.killed = true;
    s.alive = false;
    g.spawnXp(0.5, y + 4, 0.5, first ? DRAGON_XP_FIRST : DRAGON_XP_AGAIN);
    const place = (x: number, py: number, z: number, id: number, m = 0) => { g.world.setBlock(x, py, z, id, m, "world"); };
    buildPodium(place, 0, y, 0, true);
    if (first) place(0, y + 4, 0, B.DRAGON_EGG);
    if (s.gateways < GATEWAY_COUNT) {
      const i = gatewayOrder(g.meta.seed)[s.gateways++];
      buildGateway(place, ...gatewayPosition(i));
      g.sound("end_gateway_spawn", 0.5, y + 10, 0.5, 4);
    }
    g.sound("ender_dragon_death", 0.5, y + 10, 0.5, 4);
    g.showTitle(first ? "The End" : "The dragon falls again", first ? "The Ender Dragon is slain" : undefined);
    // Everyone in the End shares the kill: the fight is won together.
    g.advance({ kind: "dragon" });
    for (const r of g.remote.values()) g.net?.advanceRemote?.(r.id, { kind: "dragon" });
  }

  /**
   * A crystal set on the exit portal's rim: with one on each of its four
   * sides, the dragon is summoned again — the portal closes, the spikes'
   * crystals come back, and it rises.
   */
  crystalPlaced(): void {
    const s = this.state;
    if (s.alive || s.summoning !== undefined || !s.killed) return;
    const y = this.podiumY;
    const sides: [number, number][] = [[3, 0], [-3, 0], [0, 3], [0, -3]];
    const crystals = [...this.game.entities.values()].filter((e): e is EndCrystal => e instanceof EndCrystal && !e.removed);
    const onRim = sides.map(([dx, dz]) => crystals.find((c) => Math.floor(c.x) === dx && Math.floor(c.z) === dz && Math.abs(c.y - (y + 1)) < 0.5));
    if (onRim.some((c) => !c)) return;
    s.summoning = 100;
    for (const c of onRim) c!.beam = { x: 0.5, y: y + 12, z: 0.5 };
    this.game.sound("ender_dragon_growl", 0.5, y + 10, 0.5, 4, 0.5);
  }

  private tickSummoning(): void {
    const s = this.state;
    const g = this.game;
    s.summoning = (s.summoning ?? 0) - 1;
    const y = this.podiumY;
    if (s.summoning % 10 === 0) g.particles("end_rod", 0.5, y + 12, 0.5, 12);
    if (s.summoning > 0) return;
    s.summoning = undefined;
    for (const [x, py, z] of podiumPortalCells(0, y, 0)) if (g.world.blockAt(x, py, z) === B.END_PORTAL) g.world.setBlock(x, py, z, B.AIR, 0, "world");
    // The rim's crystals are spent; the spikes are armed again.
    for (const e of g.entities.values()) {
      if (e instanceof EndCrystal && Math.hypot(e.x - 0.5, e.z - 0.5) < 6) { e.removed = true; g.particles("explosion", e.x, e.y + 1, e.z, 6); }
    }
    for (const spike of endSpikes(g.meta.seed)) {
      const [cx, cy, cz] = crystalSpot(spike);
      if (![...g.entities.values()].some((e) => e instanceof EndCrystal && Math.hypot(e.x - cx, e.z - cz) < 1)) g.spawn(new EndCrystal(cx, cy, cz));
    }
    this.spawnDragon();
  }

  /** For the boss bar: the dragon's health as a fraction, or null with no dragon about. */
  bossBar(): { name: string; health: number } | null {
    const d = this.dragon();
    if (!d) return null;
    const p = this.game.player.body;
    if (Math.hypot(d.x - p.x, d.z - p.z) > 192) return null;
    return { name: "Ender Dragon", health: Math.max(0, d.health / d.maxHealth) };
  }
}
