/**
 * The city's minigames, each played on one of the city maps with its
 * traffic, people and (mostly) police:
 *
 *  - Street Racing: a fixed route of checkpoints from the start line, the
 *    same for everyone in the world, so a time means something. Drive into
 *    the start line in any car, wait out the countdown, and go; personal
 *    bests and the world record are kept. No police: it is a sport here.
 *  - Rampage: three minutes, a rifle and a bat, and a score for everyone and
 *    everything you take down. The police come, as they do.
 *  - Cops & Robbers: rob the stores (stand at the counter for three seconds
 *    while they empty the till), every robbery a wanted star hotter, and
 *    bank the bag at your hideout before the police catch you and take it.
 */
import { Car, type CarModelId } from "../engine/cars";
import { STREET, type City, ROAD, PITCH } from "../engine/city";
import type { Entity } from "../engine/entities";
import { Mob } from "../engine/mobs";
import { placeSpot, raceRoute } from "../engine/missions";
import { heatFor } from "../engine/police";
import { Rng } from "../engine/rng";
import type { Objective, Marker } from "../game/types";
import { CityRuntime } from "./cityModes";
import { ModeRuntime, registerRuntime } from "./runtime";

type Spot = [number, number, number];
const money = (n: number) => `$${Math.floor(n).toLocaleString("en-US")}`;
const near = (p: { x: number; z: number }, s: Spot | undefined, r: number) => !!s && Math.hypot(p.x - s[0], p.z - s[2]) < r;

/** A car of a player's own, by the road beside them, once per player per world. */
function giveCar(rt: CityRuntime, x: number, z: number, model: CarModelId, color: number): void {
  const car = new Car(x, STREET, z, model, color);
  car.ambient = false;
  rt.game.spawn(car);
}

// ---- Street Racing ---------------------------------------------------------------------------------

interface Race { stage: number; countdown: number; started: number }

class StreetRacingRuntime extends CityRuntime {
  protected police = false;
  protected trafficPerPlayer = 7;
  private readonly races = new Map<string, Race>();
  private course: { start: Spot; route: Spot[] } | null = null;

  private get best(): Record<string, number> { return ((this.data.best as Record<string, number> | undefined) ??= {}); }
  private get record(): { name: string; time: number } | null { return (this.data.record as { name: string; time: number } | undefined) ?? null; }
  private get given(): string[] { return ((this.data.given as string[] | undefined) ??= []); }

  /** The world's one course: from the junction nearest the crib, twelve checkpoints on, laid from the seed. */
  private courseOf(city: City): { start: Spot; route: Spot[] } {
    if (this.course) return this.course;
    const home = city.landmarkDoor("safehouse") ?? [0, STREET, 0];
    const s = city.spec;
    const i = Math.max(0, Math.min(s.cols, Math.round((home[0] - s.x0 - ROAD / 2) / PITCH)));
    const j = Math.max(0, Math.min(s.rows, Math.round((home[2] - s.z0 - ROAD / 2) / PITCH)));
    const start: Spot = [s.x0 + i * PITCH + ROAD / 2, STREET, s.z0 + j * PITCH + ROAD / 2];
    const rng = new Rng(this.game.meta.seed ^ 0x2ace);
    return (this.course = { start, route: raceRoute(city, start[0], start[2], 12, () => rng.next()) });
  }

  start(): void {
    this.title(null, "Street Racing", "Twelve checkpoints. One record. Zero chill.");
    this.tell(null, "Drive into the white column at the junction by your crib to start a run. Hit every blue checkpoint; the next one is the dimmer column past it.", "#9ad8ff");
  }

  second(): void {
    super.second();
    const city = this.city();
    if (!city || !this.home) return;
    const course = this.courseOf(city);
    for (const p of this.alive()) {
      // Everyone gets a Gigachad GT to race in.
      if (!this.given.includes(p.name)) { this.given.push(p.name); giveCar(this, p.x + 3, p.z, "sports", this.given.length + 5); }
      const race = this.races.get(p.id);
      if (!race && near(p, course.start, 6) && this.driving(p.id)) {
        this.races.set(p.id, { stage: 0, countdown: 60, started: 0 });
        this.title(p.id, "3", "Get ready…");
      }
      const out: Marker[] = [];
      if (!race) out.push({ x: course.start[0], y: STREET, z: course.start[2], color: "#ffffff", r: 5 });
      else {
        const [a, b] = [course.route[race.stage], course.route[race.stage + 1]];
        if (a) out.push({ x: a[0], y: a[1], z: a[2], color: "#3ad0ff", r: 6 });
        if (b) out.push({ x: b[0], y: b[1], z: b[2], color: "#1a6a8a", r: 4 });
      }
      this.mark(p.id, out);
    }
  }

  /** The car a player is driving, if any. */
  private driving(id: string): Car | null {
    for (const e of this.game.entities.values()) if (e instanceof Car && e.rider === id && !e.wrecked) return e;
    return null;
  }

  tick(): void {
    super.tick();
    const city = this.city();
    if (!city || !this.home) return;
    const course = this.courseOf(city);
    const g = this.game;
    for (const [id, race] of [...this.races]) {
      const p = this.players().find((q) => q.id === id);
      const car = this.driving(id);
      if (!p || p.dead || !car) { this.races.delete(id); if (p) this.title(id, "DNF", "You left your car. That's a forfeit."); continue; }
      if (race.countdown > 0) {
        // Held on the line until the lights go.
        car.body.vx = car.body.vz = 0;
        race.countdown--;
        if (race.countdown === 40) this.title(id, "2", "");
        if (race.countdown === 20) this.title(id, "1", "");
        if (race.countdown === 0) { this.title(id, "GO!", "Twelve checkpoints."); race.started = g.tickCount; g.sound("orb_catch", p.x, p.y + 1, p.z, 1); }
        continue;
      }
      if (near(p, course.route[race.stage], 7)) {
        race.stage++;
        g.sound("orb", p.x, p.y + 1, p.z, 1, 1.2 + race.stage * 0.05);
        if (race.stage >= course.route.length) this.finish(p.id, p.name, (g.tickCount - race.started) / 20);
      }
    }
  }

  private finish(id: string, name: string, time: number): void {
    this.races.delete(id);
    const best = this.best[name];
    const record = this.record;
    let pay = 300;
    let sub = `${ModeRuntime.clock(time, true)}`;
    if (best === undefined || time < best) { this.best[name] = time; pay += 200; sub += " · personal best"; }
    if (!record || time < record.time) { this.data.record = { name, time }; pay += 1000; sub += " · NEW RECORD"; }
    this.giveCash(id, pay);
    this.title(id, "FINISHED", `${sub} · +${money(pay)}`);
    this.game.sound("mission_passed", null);
  }

  objective(playerId: string): Objective {
    const name = this.players().find((p) => p.id === playerId)?.name ?? "";
    const race = this.races.get(playerId);
    const course = this.course;
    const record = this.record;
    const lines: [string, string][] = [];
    if (race && course) {
      lines.push(["Checkpoint", `${Math.min(race.stage + 1, course.route.length)} / ${course.route.length}`]);
      lines.push(["Time", race.countdown > 0 ? "0:00.0" : ModeRuntime.clock((this.game.tickCount - race.started) / 20, true)]);
    } else lines.push(["Start", "the white column"]);
    lines.push(["Your best", this.best[name] !== undefined ? ModeRuntime.clock(this.best[name], true) : "—"]);
    lines.push(["Record", record ? `${ModeRuntime.clock(record.time, true)} ${record.name}` : "—"]);
    return { title: "Street Racing", lines };
  }

  restart(): string {
    this.data.best = {};
    this.data.record = null;
    this.races.clear();
    return "The board is wiped: every time and the record.";
  }
}

// ---- Rampage -----------------------------------------------------------------------------------------

/** How long a rampage lasts, and the breather between them, in ticks. */
const RAMPAGE_TICKS = 180 * 20;
const RAMPAGE_REST = 10 * 20;
const RAMPAGE_POINTS: Record<string, number> = { citizen: 10, cop: 25, car: 30 };

interface Spree { score: number; kills: number; until: number; resting: number }

class RampageRuntime extends CityRuntime {
  protected peoplePerPlayer = 26;
  protected trafficPerPlayer = 12;
  private readonly sprees = new Map<string, Spree>();
  private get best(): Record<string, number> { return ((this.data.best as Record<string, number> | undefined) ??= {}); }

  start(): void {
    this.title(null, "Rampage", "Three minutes. Maximum mayhem. Minimum chill.");
  }

  private begin(id: string): void {
    this.sprees.set(id, { score: 0, kills: 0, until: this.game.tickCount + RAMPAGE_TICKS, resting: 0 });
    for (const [n, c] of [["assault_rifle", 1], ["rifle_ammo", 240], ["baseball_bat", 1], ["golden_apple", 2]] as const) {
      const s = ModeRuntime.stack(n, c);
      if (s) this.give(id, s);
    }
    this.title(id, "RAMPAGE!", "Everything counts. Cops count double.");
  }

  second(): void {
    super.second();
    const g = this.game;
    for (const p of this.alive()) {
      const s = this.sprees.get(p.id);
      if (!s) { this.begin(p.id); continue; }
      if (s.resting > 0) { if (g.tickCount >= s.resting) this.begin(p.id); continue; }
      if (g.tickCount >= s.until) {
        const name = p.name;
        const best = this.best[name] ?? 0;
        if (s.score > best) this.best[name] = s.score;
        this.giveCash(p.id, s.score * 2);
        this.title(p.id, "RAMPAGE OVER", `${s.score} points${s.score > best ? " · personal best" : ""} · next in 10 seconds`);
        s.resting = g.tickCount + RAMPAGE_REST;
      }
    }
  }

  private score(id: string, what: string): void {
    const s = this.sprees.get(id);
    if (!s || s.resting > 0) return;
    s.score += RAMPAGE_POINTS[what] ?? 0;
    s.kills++;
  }

  onKill(killer: string, kind: string): void {
    super.onKill(killer, kind);
    this.score(killer, kind);
  }

  onCarWrecked(car: Entity): void {
    if (car instanceof Car && (car.lastAttacker ?? car.lastDriver)) this.score((car.lastAttacker ?? car.lastDriver)!, "car");
  }

  objective(playerId: string): Objective {
    const s = this.sprees.get(playerId);
    const name = this.players().find((p) => p.id === playerId)?.name ?? "";
    const left = s ? (s.resting > 0 ? 0 : Math.max(0, (s.until - this.game.tickCount) / 20)) : 0;
    return {
      title: "Rampage",
      lines: [["Score", String(s?.score ?? 0)], ["Takedowns", String(s?.kills ?? 0)], ["Time", s?.resting ? "next soon" : ModeRuntime.clock(left)], ["Best", String(this.best[name] ?? 0)]],
    };
  }

  restart(): string {
    this.sprees.clear();
    this.data.best = {};
    return "Every rampage starts again from zero, and the best scores are wiped.";
  }
}

// ---- Cops & Robbers ---------------------------------------------------------------------------------

/** Ticks a hold-up takes, and before a store has cash in its till again. */
const HOLDUP_TICKS = 60;
const RESTOCK_TICKS = 90 * 20;

interface Robber { bag: number; holdup: number; at: number }

class CopsAndRobbersRuntime extends CityRuntime {
  private readonly robbers = new Map<string, Robber>();
  private readonly restock = new Map<number, number>();
  private stores: Spot[] | null = null;

  private get banked(): Record<string, number> { return ((this.data.banked as Record<string, number> | undefined) ??= {}); }

  /** Six stores round the city, and the hideout (your crib). */
  private spots(city: City): { stores: Spot[]; hideout: Spot } {
    this.stores ??= (["little", "midtown", "vegas", "downtown", "suburb", "midtown"] as const).map((d, k) => placeSpot(city, { district: d }, 3000 + k * 17));
    return { stores: this.stores, hideout: city.landmarkDoor("safehouse") ?? [0, STREET, 0] };
  }

  start(): void {
    this.title(null, "Cops & Robbers", "Rob the stores. Bank the bag. Don't get caught holding it.");
    this.tell(null, "Stand in a yellow column for three seconds to empty a store's till. Every hold-up adds a wanted star. Bank the bag at the green column by your crib — busted or wasted, and the bag is gone.", "#ffd83a");
  }

  private robber(id: string): Robber {
    let r = this.robbers.get(id);
    if (!r) { r = { bag: 0, holdup: 0, at: -1 }; this.robbers.set(id, r); }
    return r;
  }

  tick(): void {
    super.tick();
    const city = this.city();
    if (!city || !this.home || this.game.tickCount % 5 !== 0) return;
    const { stores, hideout } = this.spots(city);
    const g = this.game;
    for (const p of this.alive()) {
      const r = this.robber(p.id);
      const store = stores.findIndex((s, k) => near(p, s, 2.6) && (this.restock.get(k) ?? 0) <= g.tickCount);
      if (store >= 0) {
        r.holdup = r.at === store ? r.holdup + 5 : 5;
        r.at = store;
        if (r.holdup >= HOLDUP_TICKS) {
          const take = 300 + Math.floor(g.ctx.random() * 7) * 100;
          r.bag += take;
          r.holdup = 0;
          this.restock.set(store, g.tickCount + RESTOCK_TICKS);
          this.raiseHeat(p.id, heatFor(Math.min(5, this.stars(p.id) + 1)));
          this.title(p.id, "ROBBED", `+${money(take)} in the bag · ${money(r.bag)} carried`);
          g.sound("cashout", p.x, p.y + 1, p.z, 1);
          for (const e of g.entities.values()) if (e instanceof Mob && e.kind === "citizen" && Math.hypot(e.x - p.x, e.z - p.z) < 16) { e.panic = 140; e.scare = { x: p.x, z: p.z }; }
        } else if (r.holdup % 20 === 0) this.title(p.id, "HANDS UP", `${Math.ceil((HOLDUP_TICKS - r.holdup) / 20)}…`);
      } else { r.holdup = 0; r.at = -1; }
      if (r.bag > 0 && near(p, hideout, 3)) {
        this.banked[p.name] = (this.banked[p.name] ?? 0) + r.bag;
        this.giveCash(p.id, r.bag);
        this.title(p.id, "BANKED", `${money(r.bag)} safe · ${money(this.banked[p.name])} all told`);
        g.sound("mission_passed", p.x, p.y + 1, p.z, 1);
        r.bag = 0;
      }
    }
    if (g.tickCount % 20 === 0) for (const p of this.players()) {
      const r = this.robber(p.id);
      const out: Marker[] = stores.filter((_, k) => (this.restock.get(k) ?? 0) <= g.tickCount).map((s) => ({ x: s[0], y: s[1], z: s[2], color: "#ffd83a", r: 2.5 }));
      if (r.bag > 0) out.push({ x: hideout[0], y: hideout[1], z: hideout[2], color: "#5aff7a", r: 3 });
      this.mark(p.id, out);
    }
  }

  /** Busted or wasted: the bag goes with it. */
  protected jobLost(id: string): void {
    const r = this.robbers.get(id);
    if (r && r.bag > 0) { this.say(id, "The Bag", `Gone. ${money(r.bag)}, gone.`, "#ffd83a", 60); r.bag = 0; }
  }

  objective(playerId: string): Objective {
    const r = this.robbers.get(playerId);
    const name = this.players().find((p) => p.id === playerId)?.name ?? "";
    const open = this.stores ? this.stores.filter((_, k) => (this.restock.get(k) ?? 0) <= this.game.tickCount).length : 0;
    return { title: "Cops & Robbers", lines: [["In the bag", money(r?.bag ?? 0)], ["Banked", money(this.banked[name] ?? 0)], ["Stores open", String(open)]] };
  }

  restart(): string {
    this.robbers.clear();
    this.restock.clear();
    this.data.banked = {};
    return "Every till is full again, every bag is empty, and the takings are wiped.";
  }
}

registerRuntime("street_racing", (g, d, s) => new StreetRacingRuntime(g, d, s));
registerRuntime("rampage", (g, d, s) => new RampageRuntime(g, d, s));
registerRuntime("cops_and_robbers", (g, d, s) => new CopsAndRobbersRuntime(g, d, s));
