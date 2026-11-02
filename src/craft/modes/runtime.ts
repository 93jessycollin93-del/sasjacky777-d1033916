/**
 * A game mode at play: the base every mode's runtime extends, and the
 * factory that picks one for a world.
 *
 * Runtimes run where the world is simulated — alone, or on the host — and
 * reach guests through the few things the game already sends (teleports,
 * items) plus `Game.modeTell`, which carries titles, messages, game-mode
 * changes and each player's own scoreboard to whoever they are for.
 */
import type { Game } from "../game/game";
import type { Objective } from "../game/types";
import type { BlockChange } from "../engine/world";
import type { DamageSource, Entity } from "../engine/entities";
import { itemByName, type ItemStack, type StatusEffect } from "../engine/items";
import type { GameMode } from "../engine/player";
import { mapLayout, type MapLayout } from "../engine/maps";
import { Generator } from "../engine/worldgen";
import { Mob, type MobKind } from "../engine/mobs";
import { modeDef, type ModeDef, type ModeState } from "./modes";

/** Someone in the game, here or online, as a mode sees them. */
export interface ModePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  local: boolean;
  dead: boolean;
  spectating: boolean;
  /** Crouched: how a player buys from a pad in the zombie bunker. */
  sneaking: boolean;
}

export abstract class ModeRuntime {
  constructor(readonly game: Game, readonly def: ModeDef, readonly state: ModeState) {}

  protected get data(): Record<string, unknown> {
    return this.state.data;
  }

  /** The first time the world opens in this mode: kits, stages, the start of the clock. */
  start(): void {}
  /** Every time the world opens, the first included: borders and anything not saved. */
  resume(): void {}
  /** Every game tick, where the world is simulated. */
  tick(): void {}
  /** Once a second. */
  second(): void {}
  onBlockChange(_c: BlockChange): void {}
  /** A mob died, credited to `killer` (a player id, or "mob:<id>"). */
  onKill(_killer: string, _kind: string): void {}
  onPlayerDeath(_id: string): void {}
  /** The local player respawned. */
  onRespawn(): void {}
  /** A player caught a critter of this species (the critter modes). */
  onCritterCaught(_player: string, _species: string): void {}
  /** A player took a car from whoever was driving it (the city modes). */
  onCarjack(_player: string): void {}
  /** A car blew up (the city modes). */
  onCarWrecked(_car: Entity): void {}
  /** A player struck a mob (the city modes' police take note). */
  onHit(_player: string, _victim: Entity): void {}
  /** A player made a noise a long way round: a gunshot (the city modes' people scatter, and the police hear). */
  onNoise(_player: string, _x: number, _z: number, _radius: number): void {}
  /** A drop, as this mode would have it (Random Drops swaps it for another). */
  transformDrop(s: ItemStack): ItemStack { return s; }
  /** The scoreboard for one player; null for none. */
  objective(_playerId: string): Objective | null { return null; }
  /** "/mode restart": start the round again. Returns what happened, in words. */
  restart(): string { return "This mode has no rounds to restart."; }

  // ---- helpers ----------------------------------------------------------------------------

  private mapCache: MapLayout | null | undefined;

  /** The world's map pack, laid out, whichever dimension the game has loaded now; null on open terrain. */
  layout(): MapLayout | null {
    if (this.mapCache !== undefined) return this.mapCache;
    const m = this.game.meta;
    if (!m.map) return (this.mapCache = null);
    return (this.mapCache = mapLayout(m.map, m.seed, new Generator({ seed: m.seed, type: m.type, dimension: "overworld" })));
  }

  /** A stack by name, or null for a name this game does not have (so a reward table can never crash a round). */
  static stack(name: string, count = 1): ItemStack | null {
    try { return { id: itemByName(name).id, count }; } catch { return null; }
  }

  /** Gives everyone the same stacks by name. */
  giveAll(stacks: [string, number][]): void {
    for (const p of this.players()) for (const [n, c] of stacks) { const s = ModeRuntime.stack(n, c); if (s) this.give(p.id, s); }
  }

  /** A monster of the mode's making: it stays until the round is over, and hunts from the start. */
  spawnMob(kind: MobKind, x: number, y: number, z: number, hunt?: string): Mob {
    const m = new Mob(kind, x, y, z);
    m.persistent = true;
    m.hunting = true;
    if (hunt) m.targetId = hunt;
    this.game.spawn(m);
    return m;
  }

  /** Whether the local player is in the overworld, where every map pack is. */
  get home(): boolean {
    return this.game.dimension === "overworld";
  }

  /** Everyone playing, here first. */
  players(): ModePlayer[] {
    const g = this.game, p = g.player, b = p.body;
    const out: ModePlayer[] = [{ id: p.id, name: p.name, x: b.x, y: b.y, z: b.z, local: true, dead: p.dead, spectating: p.gameMode === "spectator", sneaking: p.sneaking }];
    for (const r of g.remote.values()) out.push({ id: r.id, name: r.name, x: r.x, y: r.y, z: r.z, local: false, dead: r.dead, spectating: r.gameMode === "spectator", sneaking: r.sneaking });
    return out;
  }

  /** Everyone still in the round: alive and not watching. */
  alive(): ModePlayer[] {
    return this.players().filter((p) => !p.dead && !p.spectating);
  }

  /** The nearest player still in the round to a point, or null. */
  nearest(x: number, z: number): ModePlayer | null {
    let best: ModePlayer | null = null, d = Infinity;
    for (const p of this.alive()) { const dd = Math.hypot(p.x - x, p.z - z); if (dd < d) { d = dd; best = p; } }
    return best;
  }

  isLocal(id: string): boolean {
    return id === this.game.player.id;
  }

  give(id: string, stack: ItemStack): void {
    const g = this.game;
    if (this.isLocal(id)) {
      const left = g.player.inventory.add({ ...stack });
      if (left > 0) g.dropItem(g.player.body.x, g.player.body.y + 1, g.player.body.z, { ...stack, count: left });
      g.bumpInv();
    } else g.net?.giveRemote(id, stack);
  }

  tell(id: string | null, text: string, color = "#ffff55"): void {
    const g = this.game;
    if (id === null || this.isLocal(id)) g.message(text, color);
    if (id === null) g.modeTell(null, { msg: text, color });
    else if (!this.isLocal(id)) g.modeTell(id, { msg: text, color });
  }

  title(id: string | null, text: string, sub?: string): void {
    const g = this.game;
    if (id === null || this.isLocal(id)) g.showTitle(text, sub);
    if (id === null) g.modeTell(null, { title: text, sub });
    else if (!this.isLocal(id)) g.modeTell(id, { title: text, sub });
  }

  setGameMode(id: string, mode: GameMode): void {
    if (this.isLocal(id)) { this.game.player.setGameMode(mode); this.game.bumpInv(); }
    else this.game.modeTell(id, { gm: mode });
  }

  /** A status effect on a player, here or online. */
  /** Hurts a player, here or online, as the world would (a fall, a shot). */
  hurt(id: string, amount: number, source: DamageSource = "magic"): void {
    if (this.isLocal(id)) this.game.hurtLocal(amount, source);
    else this.game.net?.hurtRemote(id, amount, source, 0, 0, 0);
  }

  effect(id: string, effect: StatusEffect, seconds: number, amp: number): void {
    if (this.isLocal(id)) this.game.player.applyEffect(effect, seconds, amp);
    else this.game.net?.effectRemote?.(id, effect, seconds, amp);
  }

  /** Empties a player's hands and heals them for a new round. */
  resetPlayer(id: string): void {
    if (this.isLocal(id)) this.game.resetForRound();
    else this.game.modeTell(id, { reset: true });
  }

  /** Dollars to a player (or from one, if negative), here or online. */
  giveCash(id: string, n: number): void {
    if (this.isLocal(id)) { this.game.player.cash = Math.max(0, this.game.player.cash + n); this.game.bumpInv(); }
    else this.game.modeTell(id, { cash: n });
  }

  teleport(id: string, x: number, y: number, z: number): void {
    const g = this.game;
    if (this.isLocal(id)) g.teleportLocal(x, y, z);
    else g.net?.teleportRemote?.(id, { kind: "exact", x, y, z });
  }

  /** Seconds as m:ss (or m:ss.t with tenths). */
  static clock(seconds: number, tenths = false): string {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${(tenths ? r.toFixed(1) : Math.floor(r).toString()).padStart(tenths ? 4 : 2, "0")}`;
  }
}

/** A mode with nothing to run: the classics. */
class NoRuntime extends ModeRuntime {}

type Maker = (game: Game, def: ModeDef, state: ModeState) => ModeRuntime;
const MAKERS = new Map<string, Maker>();

/** Each mode's file registers its runtime here, so this file need not import them all. */
export function registerRuntime(id: string, make: Maker): void {
  MAKERS.set(id, make);
}

/** The runtime for a world's mode, or null for a world without one. */
export function createRuntime(game: Game): ModeRuntime | null {
  const state = game.meta.mode;
  const def = modeDef(state?.id);
  if (!state || !def) return null;
  state.data ??= {};
  const make = MAKERS.get(def.id);
  return make ? make(game, def, state) : new NoRuntime(game, def, state);
}
