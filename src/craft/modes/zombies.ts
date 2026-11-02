/**
 * The zombie modes, each after a game that made the genre:
 *
 * - Zombie Rounds (Call of Duty's zombies): the bunker, a round at a time,
 *   the infected tearing the boards off the windows. Points for kills and for
 *   boarding up, spent on the guns on the walls, the mystery box, a perk and
 *   the doors to the other rooms. Power-ups drop now and then.
 * - Blood Moon (7 Days to Die): an open world with the infected in it, and
 *   every seventh night a horde that hunts you down and digs through walls.
 * - Infection: survivors against the infected in the colosseum; whoever falls
 *   joins the infected. Alone, you hold out against an endless stream.
 * - Outbreak: an ordinary world, overrun — the infected by day and by night.
 */
import { B } from "../engine/blocks";
import { fillLoot, mapLootTable, type Buy } from "../engine/maps";
import { GUNS } from "../engine/guns";
import { itemByName } from "../engine/items";
import { ItemEntity } from "../engine/entities";
import { Mob, type MobKind } from "../engine/mobs";
import { Rng } from "../engine/rng";
import type { Objective } from "../game/types";
import { ModeRuntime, registerRuntime, type ModePlayer } from "./runtime";

// ---- zombie rounds ----------------------------------------------------------------------------

/** How many infected a round sends, and how many of each kind. */
export function roundMobs(round: number): MobKind[] {
  const n = Math.min(60, 6 + round * 4);
  const out: MobKind[] = [];
  for (let i = 0; i < n; i++) {
    if (round % 5 === 0 && i < round / 5) out.push("brute");
    else if (round >= 5 && i % 9 === 4) out.push("bloater");
    else if (round >= 3 && i % 4 === 1) out.push("runner");
    else out.push("infected");
  }
  return out;
}

export type PowerUp = "max_ammo" | "insta_kill" | "double_points" | "nuke";
const POWER_ITEMS: Record<PowerUp, string> = { max_ammo: "rifle_ammo", insta_kill: "bone", double_points: "gold_ingot", nuke: "tnt" };
const POWER_NAMES: Record<PowerUp, string> = { max_ammo: "Max Ammo", insta_kill: "Insta-Kill", double_points: "Double Points", nuke: "Nuke" };

const START_POINTS = 500;
const KILL_POINTS = 60;
const MAX_ALIVE = 24;

class RoundsRuntime extends ModeRuntime {
  private phase: "prep" | "round" | "over" = "prep";
  private timer = 10;
  private toSpawn: MobKind[] = [];
  private spawnTick = 0;
  private counted = new Set<number>();
  private powerUps = new Map<number, { kind: PowerUp; until: number }>();
  private instaKill = 0;
  private doublePoints = 0;
  private buyCooldown = new Map<string, number>();
  private repairTick = 0;

  private get round(): number { return (this.data.round as number | undefined) ?? 0; }
  private get points(): Record<string, number> { return ((this.data.points as Record<string, number> | undefined) ??= {}); }
  private get perks(): string[] { return ((this.data.perks as string[] | undefined) ??= []); }
  private get opened(): string[] { return ((this.data.opened as string[] | undefined) ??= []); }

  start(): void {
    this.newGame();
    this.tell(null, "Crouch on a gold pad to buy what is on it, emerald for the mystery box, redstone for the perk, by a door to open it, and inside a window to board it up.", "#aaffaa");
  }

  resume(): void {
    const g = this.game;
    g.time = Math.floor(g.time / 24000) * 24000 + 18000;
    // A round cut short by the world closing starts again, its infected gone.
    if (this.round > 0) this.data.round = this.round - 1;
    this.phase = "prep";
    this.timer = 8;
  }

  private newGame(): void {
    this.data.round = 0;
    this.data.points = {};
    this.data.perks = [];
    this.data.opened = [];
    this.phase = "prep";
    this.timer = 10;
    for (const m of this.infected()) m.removed = true;
    this.restoreBunker();
    for (const p of this.players()) {
      this.setGameMode(p.id, "survival");
      this.resetPlayer(p.id);
      this.points[p.name] = START_POINTS;
      const pistol = ModeRuntime.stack("pistol"), ammo = ModeRuntime.stack("pistol_ammo", 48);
      if (pistol) this.give(p.id, pistol);
      if (ammo) this.give(p.id, ammo);
      const s = this.layout()?.spawn;
      if (s) this.teleport(p.id, s[0], s[1], s[2]);
    }
  }

  /** Doors shut again and every window boarded, for a new game. */
  private restoreBunker(): void {
    const l = this.layout();
    const w = this.game.world;
    if (!l) return;
    for (const b of l.buys ?? []) for (const [x, y, z] of b.door ?? []) if (w.isLoaded(x, z)) w.setBlock(x, y, z, B.OAK_PLANKS, 0, "world");
    for (const win of l.windows ?? []) for (const [x, y, z] of win.boards) if (w.isLoaded(x, z)) w.setBlock(x, y, z, B.OAK_FENCE, 0, "world");
  }

  private infected(): Mob[] {
    const out: Mob[] = [];
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.infected && e.hunting && !e.dying && !e.removed) out.push(e);
    return out;
  }

  private award(p: ModePlayer | string, n: number): void {
    const name = typeof p === "string" ? p : p.name;
    this.points[name] = (this.points[name] ?? 0) + n * (this.doublePoints > 0 ? 2 : 1);
  }

  onKill(killer: string): void {
    const p = this.players().find((x) => x.id === killer);
    if (p) this.award(p, KILL_POINTS);
  }

  tick(): void {
    if (!this.home) return;
    const g = this.game;
    // Infected that just died: a chance of a power-up where they fell.
    for (const e of g.entities.values()) {
      if (!(e instanceof Mob) || !e.infected || !e.hunting || !e.dying || this.counted.has(e.id)) continue;
      this.counted.add(e.id);
      if (Math.random() < 0.04) this.dropPowerUp(e.x, e.y + 0.5, e.z);
    }
    // Power-ups: taken by walking into them, gone after half a minute.
    for (const [id, pu] of this.powerUps) {
      const e = g.entities.get(id);
      if (!e || e.removed || g.tickCount > pu.until) { if (e) e.removed = true; this.powerUps.delete(id); continue; }
      const taker = this.alive().find((p) => Math.hypot(p.x - e.x, p.z - e.z) < 1.6 && Math.abs(p.y - e.y) < 2.5);
      if (taker) { e.removed = true; this.powerUps.delete(id); this.applyPowerUp(pu.kind); }
    }
    if (this.instaKill > 0) { this.instaKill--; for (const m of this.infected()) if (m.health > 1) m.health = 1; }
    if (this.doublePoints > 0) this.doublePoints--;
    if (this.phase === "round" && this.toSpawn.length && ++this.spawnTick >= 24 && this.infected().length < MAX_ALIVE) {
      this.spawnTick = 0;
      this.spawnOne(this.toSpawn.shift()!);
    }
    this.pads();
  }

  private dropPowerUp(x: number, y: number, z: number): void {
    const kinds: PowerUp[] = ["max_ammo", "insta_kill", "double_points", "nuke"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    // Never picked up the ordinary way: walking into it is what takes it (see tick).
    const e = new ItemEntity(x, y, z, { id: itemByName(POWER_ITEMS[kind]).id, count: 1 }, 32767);
    this.game.spawn(e);
    this.powerUps.set(e.id, { kind, until: this.game.tickCount + 600 });
    this.tell(null, `A power-up: ${POWER_NAMES[kind]}!`, "#55ffff");
  }

  private applyPowerUp(kind: PowerUp): void {
    this.title(null, POWER_NAMES[kind]);
    this.game.sound("purchase", null, 0, 0, 1, 1.2);
    if (kind === "max_ammo") this.giveAll([["pistol_ammo", 48], ["rifle_ammo", 60], ["shotgun_shells", 24]]);
    else if (kind === "insta_kill") this.instaKill = 600;
    else if (kind === "double_points") this.doublePoints = 600;
    else {
      for (const m of this.infected()) { m.invulnerable = 0; m.hurt(this.game.ctx, 10000, "magic", m.x, m.z); }
      for (const p of this.players()) this.award(p, 400);
    }
  }

  /** The windows in rooms that are open (a window of a closed room brings nobody). */
  private openWindows() {
    const l = this.layout();
    const opened = this.opened;
    return (l?.windows ?? []).filter((w) => {
      const x = w.pad[0];
      if (x < -8) return opened.includes("West door");
      if (x > 8) return opened.includes("East door");
      return true;
    });
  }

  private spawnOne(kind: MobKind): void {
    const wins = this.openWindows();
    if (!wins.length) return;
    const [x, y, z] = wins[Math.floor(Math.random() * wins.length)].spawn;
    const m = this.spawnMob(kind, x + (Math.random() - 0.5) * 3, y, z + (Math.random() - 0.5) * 3, this.nearest(x, z)?.id);
    m.level = this.round;
    m.health = m.maxHealth;
  }

  second(): void {
    if (!this.home) return;
    const g = this.game;
    if (this.phase === "prep") {
      if (--this.timer <= 0) this.beginRound();
      else if (this.timer <= 3) this.title(null, String(this.timer), `Round ${this.round + 1}`);
      return;
    }
    if (this.phase === "over") {
      if (--this.timer <= 0) this.newGame();
      return;
    }
    if (!this.alive().length) { this.gameOver(); return; }
    // The infected at a window tear the boards off, one at a time — about five seconds a board, long enough
    // to turn and shoot (at twice that rate a lone player was overrun inside round one).
    const w = g.world;
    for (const win of this.openWindows()) {
      const [px, , pz] = win.pad;
      const outside = this.infected().some((m) => Math.hypot(m.x - (px + 0.5), m.z - (pz + 0.5)) < 3.2);
      if (!outside || Math.random() > 0.2) continue;
      const board = [...win.boards].reverse().find(([x, y, z]) => w.blockAt(x, y, z) === B.OAK_FENCE);
      if (board) { w.setBlock(board[0], board[1], board[2], B.AIR, 0, "world"); g.sound("zombie_break", board[0] + 0.5, board[1], board[2] + 0.5, 1); }
    }
    for (const m of this.infected()) if (!m.targetId || !this.alive().some((p) => p.id === m.targetId)) m.targetId = this.nearest(m.x, m.z)?.id ?? null;
    if (!this.toSpawn.length && !this.infected().length) {
      this.phase = "prep";
      this.timer = 10;
      this.data.best = Math.max((this.data.best as number | undefined) ?? 0, this.round);
      this.title(null, `Round ${this.round} survived`, "The next is coming");
      for (const p of this.players()) if (p.spectating && !p.dead) { this.setGameMode(p.id, "survival"); const s = this.layout()?.spawn; if (s) this.teleport(p.id, s[0], s[1], s[2]); }
    }
  }

  private beginRound(): void {
    const r = this.round + 1;
    this.data.round = r;
    this.phase = "round";
    this.toSpawn = roundMobs(r);
    this.spawnTick = 0;
    this.title(null, `Round ${r}`);
    this.game.sound("horn", null, 0, 0, 1, 0.8);
    // Tough Skin lasts from round to round.
    for (const p of this.players()) if (this.perks.includes(p.name)) this.effect(p.id, "absorption", 900, 1);
  }

  private gameOver(): void {
    this.phase = "over";
    this.timer = 12;
    const survived = Math.max(0, this.round - 1);
    this.data.best = Math.max((this.data.best as number | undefined) ?? 0, survived);
    for (const m of this.infected()) m.removed = true;
    this.title(null, "Game over", `You survived ${survived} round${survived === 1 ? "" : "s"}`);
  }

  onPlayerDeath(id: string): void {
    if (this.phase === "round" && !this.isLocal(id)) this.setGameMode(id, "spectator");
  }

  onRespawn(): void {
    if (this.phase === "round") this.setGameMode(this.game.player.id, "spectator");
  }

  /** Crouching on a pad buys what it sells; crouching inside a window boards it up. */
  private pads(): void {
    const l = this.layout();
    if (!l) return;
    const g = this.game;
    for (const p of this.alive()) {
      if (!p.sneaking) continue;
      const fx = Math.floor(p.x), fy = Math.floor(p.y) - 1, fz = Math.floor(p.z);
      const buy = (l.buys ?? []).find((b) => b.pad[0] === fx && b.pad[1] === fy && b.pad[2] === fz);
      if (buy) {
        const until = this.buyCooldown.get(p.id) ?? 0;
        if (g.tickCount >= until) { this.buyCooldown.set(p.id, g.tickCount + 20); this.buy(p, buy); }
        continue;
      }
      if (++this.repairTick % 20 !== 0) continue;
      const win = this.openWindows().find((w) => w.pad[0] === fx && w.pad[2] === fz);
      const gap = win?.boards.find(([x, y, z]) => g.world.blockAt(x, y, z) === B.AIR);
      if (gap && !this.infected().some((m) => Math.hypot(m.x - (gap[0] + 0.5), m.z - (gap[2] + 0.5)) < 0.9)) {
        g.world.setBlock(gap[0], gap[1], gap[2], B.OAK_FENCE, 0, "world");
        g.sound("item_frame_place", gap[0] + 0.5, gap[1], gap[2] + 0.5, 0.8);
        this.award(p, 10);
      }
    }
  }

  private buy(p: ModePlayer, b: Buy): void {
    const have = this.points[p.name] ?? 0;
    if (b.kind === "door" && this.opened.includes(b.name)) return;
    if (b.kind === "perk" && this.perks.includes(p.name)) { this.tell(p.id, "You already have Tough Skin.", "#aaaaaa"); return; }
    if (have < b.price) { this.tell(p.id, `${b.name} costs ${b.price} points; you have ${have}.`, "#ff8888"); return; }
    this.points[p.name] = have - b.price;
    this.game.sound("purchase", null, 0, 0, 1);
    if (b.kind === "door") {
      this.opened.push(b.name);
      for (const [x, y, z] of b.door ?? []) this.game.world.setBlock(x, y, z, B.AIR, 0, "world");
      this.title(null, `${b.name} opened`);
    } else if (b.kind === "perk") {
      this.perks.push(p.name);
      this.effect(p.id, "absorption", 900, 1);
      this.title(p.id, "Tough Skin", "Four more hearts, every round");
    } else {
      const item = b.kind === "box" ? Object.keys(GUNS)[Math.floor(Math.random() * Object.keys(GUNS).length)] : b.item!;
      const gun = GUNS[item];
      const give = ModeRuntime.stack(item), ammo = ModeRuntime.stack(gun.ammo, gun.ammo === "shotgun_shells" ? 24 : 48);
      if (give) this.give(p.id, give);
      if (ammo) this.give(p.id, ammo);
      this.title(p.id, b.kind === "box" ? "Mystery Box!" : b.name, give ? itemByName(item).displayName : undefined);
    }
  }

  restart(): string {
    this.newGame();
    return "A new game: round one in ten seconds.";
  }

  objective(id: string): Objective {
    const name = this.players().find((p) => p.id === id)?.name ?? "";
    const left = this.phase === "round" ? this.toSpawn.length + this.infected().length : 0;
    const lines: [string, string][] = [
      ["Round", String(this.round)],
      [this.phase === "prep" ? "Next round in" : this.phase === "over" ? "Game over" : "Infected left", this.phase === "round" ? String(left) : `${Math.max(0, this.timer)}s`],
      ["Points", String(this.points[name] ?? 0)],
      ["Best round", String((this.data.best as number | undefined) ?? 0)],
    ];
    if (this.doublePoints > 0) lines.push(["Double Points", `${Math.ceil(this.doublePoints / 20)}s`]);
    if (this.instaKill > 0) lines.push(["Insta-Kill", `${Math.ceil(this.instaKill / 20)}s`]);
    return { title: "Zombie Rounds", lines };
  }
}

// ---- blood moon --------------------------------------------------------------------------------

const DAY = 24000;
/** Blood moons come every seventh night. */
export const BLOOD_MOON_EVERY = 7;

/** Whether a blood moon is up at world time `t`: the night of every seventh day (0-based day 6, 13, …). */
export function bloodMoonAt(t: number): boolean {
  const day = Math.floor(t / DAY), tod = t % DAY;
  return day % BLOOD_MOON_EVERY === BLOOD_MOON_EVERY - 1 && tod >= 12800;
}

/** Days until the next blood moon's night begins (0 on the day itself). */
export function daysToBloodMoon(t: number): number {
  const day = Math.floor(t / DAY);
  return (BLOOD_MOON_EVERY - 1 - (day % BLOOD_MOON_EVERY) + BLOOD_MOON_EVERY) % BLOOD_MOON_EVERY;
}

const HORDE: MobKind[] = ["infected", "infected", "runner", "runner", "bloater", "brute", "screamer", "spitter"];

class BloodMoonRuntime extends ModeRuntime {
  private get kills(): number { return (this.data.kills as number | undefined) ?? 0; }

  start(): void {
    this.giveAll([["pistol", 1], ["pistol_ammo", 32], ["bandage", 2], ["canned_beans", 3], ["water_canteen", 1], ["stone_axe", 1]]);
    this.title(null, "Blood Moon", "Every seventh night, they come for you");
    this.tell(null, "Build and dig in while you can. On the seventh night the horde hunts you wherever you are, and digs through whatever you hide behind.", "#ffaaaa");
  }

  resume(): void {
    this.game.bloodMoon = bloodMoonAt(this.game.time);
  }

  onKill(): void {
    if (this.game.bloodMoon) this.data.kills = this.kills + 1;
  }

  second(): void {
    if (!this.home) return;
    const g = this.game;
    const up = bloodMoonAt(g.time);
    if (up && !g.bloodMoon) {
      g.bloodMoon = true;
      this.title(null, "The Blood Moon rises", "Hold out till dawn");
      g.sound("horn", null, 0, 0, 1, 0.6);
    } else if (!up && g.bloodMoon) {
      g.bloodMoon = false;
      this.dawn();
    }
    if (g.bloodMoon) this.horde();
  }

  /** Every other second of a blood moon, more of the horde, from out of sight, already hunting. */
  private horde(): void {
    const g = this.game;
    if (g.tickCount % 40 >= 20) return;
    let alive = 0;
    for (const e of g.entities.values()) if (e instanceof Mob && e.infected && e.hunting && !e.dying) alive++;
    const people = this.alive();
    if (alive >= 10 + people.length * 6) return;
    for (const p of people) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 14;
        const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
        if (!g.world.isLoaded(x, z)) continue;
        const y = g.world.topSolid(x, z) + 1;
        if (y < 2) continue;
        this.spawnMob(HORDE[Math.floor(Math.random() * HORDE.length)], x + 0.5, y, z + 0.5, p.id);
      }
    }
  }

  /** Dawn: the horde stops hunting (and wanders off to despawn); every survivor gets a crate. */
  private dawn(): void {
    const g = this.game;
    for (const e of g.entities.values()) if (e instanceof Mob && e.infected && e.hunting) { e.hunting = false; e.persistent = false; }
    this.title(null, "Dawn", "You survived the Blood Moon");
    const table = mapLootTable("dz_military");
    for (const p of this.alive()) {
      const x = Math.floor(p.x) + 2, z = Math.floor(p.z);
      if (!g.world.isLoaded(x, z)) continue;
      const y = g.world.topSolid(x, z) + 1;
      g.placeChest(x, y, z, (items) => fillLoot(items, new Rng((g.meta.seed ^ g.time) | 0), table, false));
    }
    this.tell(null, "A supply crate for each survivor, next to them.", "#ffd060");
  }

  objective(): Objective {
    const g = this.game;
    const days = daysToBloodMoon(g.time);
    return {
      title: "Blood Moon",
      lines: [
        ["Day", String(Math.floor(g.time / DAY) + 1)],
        ["Blood moon", g.bloodMoon ? "NOW" : days === 0 ? "tonight" : `in ${days} day${days === 1 ? "" : "s"}`],
        ["Horde kills", String(this.kills)],
      ],
    };
  }
}

// ---- infection ----------------------------------------------------------------------------------

const INFECTION_SECONDS = 300;
const SURVIVOR_KIT: [string, number][] = [["iron_sword", 1], ["bow", 1], ["arrow", 24], ["bread", 6], ["iron_chestplate", 1]];
const INFECTED_KIT: [string, number][] = [["stone_sword", 1]];

class InfectionRuntime extends ModeRuntime {
  private phase: "countdown" | "running" | "over" = "countdown";
  private timer = 10;
  private left = INFECTION_SECONDS;
  private infectedPlayers = new Set<string>();

  resume(): void {
    this.phase = "countdown";
    this.timer = 11;
    this.game.time = Math.floor(this.game.time / DAY) * DAY + 18000;
  }

  private setUp(): void {
    for (const m of this.stream()) m.removed = true;
    this.infectedPlayers.clear();
    this.left = INFECTION_SECONDS;
    const people = this.players();
    const zero = people.length > 1 ? people[Math.floor(Math.random() * people.length)] : null;
    for (const p of people) {
      this.setGameMode(p.id, "survival");
      this.resetPlayer(p.id);
      const s = this.layout()?.spawn;
      if (s) this.teleport(p.id, s[0], s[1], s[2]);
      if (zero && p.id === zero.id) this.infect(p);
      else for (const [n, c] of SURVIVOR_KIT) { const st = ModeRuntime.stack(n, c); if (st) this.give(p.id, st); }
    }
    if (zero) this.title(null, `${zero.name} is infected`, "Survive five minutes");
    else this.title(null, "Infection", "Survive five minutes against the stream");
  }

  private infect(p: ModePlayer): void {
    this.infectedPlayers.add(p.id);
    for (const [n, c] of INFECTED_KIT) { const st = ModeRuntime.stack(n, c); if (st) this.give(p.id, st); }
    this.effect(p.id, "speed", 600, 1);
    this.effect(p.id, "strength", 600, 0);
    this.title(p.id, "You are infected", "Turn the survivors");
  }

  private stream(): Mob[] {
    const out: Mob[] = [];
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.infected && e.hunting && !e.dying && !e.removed) out.push(e);
    return out;
  }

  private survivors(): ModePlayer[] {
    return this.alive().filter((p) => !this.infectedPlayers.has(p.id));
  }

  second(): void {
    if (!this.home) return;
    if (this.phase === "countdown") {
      if (this.timer === 11) this.setUp();
      if (--this.timer <= 0) { this.phase = "running"; this.title(null, "Go!"); }
      else if (this.timer <= 3) this.title(null, String(this.timer));
      return;
    }
    if (this.phase === "over") {
      if (--this.timer <= 0) { this.phase = "countdown"; this.timer = 11; }
      return;
    }
    this.left--;
    // Alone (or with nobody infected yet), the infected come in a stream through the gates.
    const solo = this.players().length === 1;
    if ((solo || this.infectedPlayers.size === 0) && this.stream().length < 6 + (INFECTION_SECONDS - this.left) / 30) {
      const gates = this.layout()?.pads ?? [];
      const gate = gates[Math.floor(Math.random() * gates.length)];
      if (gate) this.spawnMob(Math.random() < 0.35 ? "runner" : "infected", gate[0] + 0.5, gate[1], gate[2] + 0.5, this.survivors()[0]?.id);
    }
    if (!this.survivors().length) this.end(false);
    else if (this.left <= 0) this.end(true);
  }

  private end(survived: boolean): void {
    this.phase = "over";
    this.timer = 10;
    for (const m of this.stream()) m.removed = true;
    const names = this.survivors().map((p) => p.name).join(", ");
    this.title(null, survived ? "The survivors held out" : "Everyone is infected", survived ? names : undefined);
    if (survived) this.data.wins = ((this.data.wins as number | undefined) ?? 0) + 1;
  }

  onPlayerDeath(id: string): void {
    if (this.phase !== "running") return;
    const p = this.players().find((x) => x.id === id);
    if (!p || this.infectedPlayers.has(id)) return;
    // A survivor who falls rises infected — alone, it is simply over.
    if (this.players().length === 1) { this.end(false); return; }
    this.tell(null, `${p.name} has been infected.`, "#88ff88");
    this.infectedPlayers.add(id);
    if (!this.isLocal(id)) this.infect(p);
  }

  onRespawn(): void {
    const me = this.players()[0];
    if (this.phase === "running" && this.infectedPlayers.has(me.id)) this.infect(me);
  }

  restart(): string {
    this.phase = "countdown";
    this.timer = 11;
    return "A new round of Infection begins.";
  }

  objective(id: string): Objective {
    return {
      title: "Infection",
      lines: [
        ["Time left", this.phase === "running" ? ModeRuntime.clock(this.left) : this.phase === "countdown" ? `starts in ${Math.max(0, this.timer)}` : "—"],
        ["Survivors", String(this.survivors().length)],
        ["Infected", String(this.infectedPlayers.size + this.stream().length)],
        ["You are", this.infectedPlayers.has(id) ? "infected" : "a survivor"],
      ],
    };
  }
}

// ---- outbreak ----------------------------------------------------------------------------------

class OutbreakRuntime extends ModeRuntime {
  start(): void {
    this.giveAll([["baseball_bat", 1], ["canned_beans", 3], ["bandage", 2]]);
    this.title(null, "Outbreak", "The world has fallen. Build, loot, survive.");
  }

  onKill(): void {
    this.data.kills = ((this.data.kills as number | undefined) ?? 0) + 1;
  }

  objective(): Objective {
    return {
      title: "Outbreak",
      lines: [["Day", String(Math.floor(this.game.time / DAY) + 1)], ["Infected down", String((this.data.kills as number | undefined) ?? 0)]],
    };
  }
}

registerRuntime("zombie_rounds", (g, d, s) => new RoundsRuntime(g, d, s));
registerRuntime("blood_moon", (g, d, s) => new BloodMoonRuntime(g, d, s));
registerRuntime("infection", (g, d, s) => new InfectionRuntime(g, d, s));
registerRuntime("outbreak", (g, d, s) => new OutbreakRuntime(g, d, s));
