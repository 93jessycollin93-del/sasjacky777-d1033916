/**
 * The city and casino modes' runtimes. The casino games themselves are each
 * player's own, played on their own screen (ui/CasinoScreens.tsx); what runs
 * here, on the host, is the house: the stake it hands each player on the way
 * in, and the goal on the board.
 *
 * A city mode also keeps the city alive round its players, and only there:
 * traffic on the lanes and people on the sidewalks within a block or two of
 * someone, cars parked in the lots as they come near, all of it tidied away
 * again once everyone has gone. None of that is saved — it is the city's,
 * not the player's — and a car a player was given is kept.
 */
import type { Objective } from "../game/types";
import { Car, CAR_COLORS, CAR_MODELS, type CarModelId } from "../engine/cars";
import { STREET, type City, LOT } from "../engine/city";
import type { Entity } from "../engine/entities";
import { Mob } from "../engine/mobs";
import {
  addHeat, BUSTED_QUIPS, canSee, chaseDrive, COPS_ON_FOOT, CRUISERS, evadeSeconds, heatFor, starsFor, WASTED_QUIPS,
  type ChaseState, type Crime,
} from "../engine/police";
import { laneNear, laneSpot, newTraffic, sidewalkSpot, trafficDrive, type TrafficState } from "../engine/traffic";
import type { PlayerRef } from "../engine/entities";
import { ALL_MISSIONS, boostPay, CONTACTS, contactSpot, nextMission, placeSpot, raceRoute, type Contact, type MissionDef } from "../engine/missions";
import { hash4 } from "../engine/rng";
import type { Marker } from "../game/types";
import { ModeRuntime, registerRuntime } from "./runtime";

/** Dollars a player starts High Roller with. */
export const HIGH_ROLLER_STAKE = 1000;

class HighRollerRuntime extends ModeRuntime {
  private get given(): string[] { return ((this.data.given as string[] | undefined) ??= []); }

  start(): void {
    this.title(null, "The Golden Stonk", "A thousand dollars. Make it a million.");
    this.tell(null, "Walk up to a machine or a table and use it to play: slots, blackjack, roulette, video poker on the east wall, the wheel on the north, and the Stonks terminal on the west.", "#ffcc66");
  }

  second(): void {
    // Everyone gets their stake once, whenever they walk in.
    for (const p of this.players()) {
      if (this.given.includes(p.name)) continue;
      this.given.push(p.name);
      this.giveCash(p.id, HIGH_ROLLER_STAKE);
    }
  }

  objective(): Objective {
    return { title: "The Golden Stonk", lines: [["Goal", "$1,000,000"], ["Stake", `$${HIGH_ROLLER_STAKE.toLocaleString("en-US")}`]] };
  }

  restart(): string {
    this.data.given = [];
    return "Everyone gets a fresh thousand on the house.";
  }
}

registerRuntime("high_roller", (g, d, s) => new HighRollerRuntime(g, d, s));

/** A job in progress: whose, from whom, how far along, against what clock, and what the city put out for it. */
interface Job {
  player: string;
  contact: Contact;
  def: MissionDef;
  stage: number;
  deadline: number | null;
  from?: [number, number, number];
  to?: [number, number, number];
  car?: number;
  target?: number;
  guards: number[];
  route?: [number, number, number][];
}

/** What the traffic drives, and how often. */
const TRAFFIC_MIX: [CarModelId, number][] = [["sedan", 30], ["compact", 18], ["taxi", 14], ["pickup", 10], ["van", 8], ["muscle", 8], ["sports", 7], ["police", 3], ["super", 2]];

function weighted<T>(table: [T, number][], random: () => number): T {
  let roll = random() * table.reduce((t, [, w]) => t + w, 0);
  for (const [v, w] of table) if ((roll -= w) < 0) return v;
  return table[0][0];
}

/**
 * The base of every mode played in a city: it drives the traffic, and keeps
 * the streets populated round each player and empty everywhere else.
 */
export abstract class CityRuntime extends ModeRuntime {
  /** Traffic brains by car id: the host's alone, and never saved. */
  private readonly brains = new Map<number, TrafficState>();
  /** Lots whose parked cars are out, so they are not parked twice. */
  private readonly parked = new Set<string>();
  /** Cruisers after someone, by car id. */
  private readonly chases = new Map<number, ChaseState>();
  protected trafficPerPlayer = 11;
  protected peoplePerPlayer = 16;
  /** Whether the police come at all (a mode can call them off). */
  protected police = true;
  /** Each player's heat, the seconds they have been out of the police's sight, and the stars they were last told. */
  private readonly heat = new Map<string, number>();
  private readonly unseen = new Map<string, number>();
  private readonly told = new Map<string, number>();
  /** Ticks a cop has had a hand on someone standing still; who is waiting on a hospital bed. */
  private readonly bustHold = new Map<string, number>();
  private readonly wasted = new Set<string>();
  /** Cars through the respray lately, so one pass is one respray. */
  private readonly sprayed = new Map<number, number>();
  /** People the city must not tidy away: a mission's target and their friends. */
  protected readonly keep = new Set<number>();
  /** Lines of dialogue waiting to be shown, per player; and the marks each player was last sent. */
  protected readonly lines = new Map<string, { at: number; who: string; text: string; color: string }[]>();
  private readonly marked = new Map<string, string>();

  /** A line of dialogue for one player, now or after a pause. */
  protected say(id: string, who: string, text: string, color: string, delayTicks = 0): void {
    const q = this.lines.get(id) ?? [];
    q.push({ at: this.game.tickCount + delayTicks, who, text, color });
    this.lines.set(id, q);
  }

  private flushLines(): void {
    const now = this.game.tickCount;
    for (const [id, q] of this.lines) {
      while (q.length && q[0].at <= now) {
        const l = q.shift()!;
        if (this.isLocal(id)) this.game.caption(l.who, l.text, l.color);
        else this.game.modeTell(id, { caption: { who: l.who, text: l.text, color: l.color } });
      }
      if (!q.length) this.lines.delete(id);
    }
  }

  /** Sets the marks a player sees, sending them only when they change. */
  protected mark(id: string, out: Marker[]): void {
    const key = out.map((m) => `${m.color}${Math.round(m.x)},${Math.round(m.z)}`).join("|");
    if (this.marked.get(id) === key) return;
    this.marked.set(id, key);
    if (this.isLocal(id)) this.game.markers = out; else this.game.modeTell(id, { markers: out });
  }

  city(): City | null {
    return this.layout()?.city ?? null;
  }

  tick(): void {
    const city = this.city();
    if (!city || !this.home) return;
    const g = this.game;
    const players = g.playerRefs();
    for (const e of g.entities.values()) {
      if (!(e instanceof Car) || e.removed) continue;
      if (e.wrecked === 2 && this.state.started) {
        this.onCarWrecked(e);
        if (e.lastAttacker) this.crime(e.lastAttacker, "carBombed");
      }
      if (e.rider) { e.lastDriver = e.rider; this.brains.delete(e.id); this.chases.delete(e.id); continue; }
      if (!e.npc || e.wrecked) { this.brains.delete(e.id); this.chases.delete(e.id); continue; }
      const chase = this.chases.get(e.id);
      if (chase) { this.driveCruiser(city, e, chase, players); continue; }
      let st = this.brains.get(e.id);
      if (!st) {
        // A car the city lost track of (brought back from the host's last session): the lane it is on now.
        st = newTraffic(laneNear(city, e.x, e.z, e.yaw), g.ctx.random);
        this.brains.set(e.id, st);
      }
      trafficDrive(city, e, st, g.ctx, g.ctx.entitiesNear(e.x, e.y, e.z, 18), players);
    }
    this.flushLines();
    if (g.tickCount % 5 === 0) this.checkBusts(city, players);
    if (g.tickCount % 20 === 0) { this.populate(city); if (this.police) this.dispatch(city); }
  }

  second(): void {
    const city = this.city();
    if (!city || !this.home) return;
    this.lookForSuspects();
    this.respray(city);
    this.patchUpWasted(city);
  }

  // ---- the police --------------------------------------------------------------------------------

  /** A player's wanted stars. */
  stars(id: string): number {
    return starsFor(this.heat.get(id) ?? 0);
  }

  /** A crime, on the record: the heat goes up, and the police know where you are. */
  crime(id: string, crime: Crime): void {
    if (!this.police || !this.players().some((p) => p.id === id)) return;
    this.heat.set(id, addHeat(this.heat.get(id) ?? 0, crime));
    this.unseen.set(id, 0);
    this.tellWanted(id);
  }

  /** Heat straight onto a player's record, at least this much (a job the police notice from the start). */
  protected raiseHeat(id: string, heat: number): void {
    this.heat.set(id, Math.max(this.heat.get(id) ?? 0, heat));
    this.unseen.set(id, 0);
    this.tellWanted(id);
  }

  /** A player's job ended badly (wasted, busted): the mode's to deal with. */
  protected jobLost(_id: string, _why: string): void {}

  /** Clears a player's record: busted, wasted, or resprayed. */
  protected clearHeat(id: string): void {
    this.heat.delete(id);
    this.unseen.delete(id);
    this.tellWanted(id);
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.kind === "cop" && e.targetId === id) e.targetId = null;
  }

  private tellWanted(id: string): void {
    const s = this.stars(id);
    if (this.told.get(id) === s) return;
    this.told.set(id, s);
    if (this.isLocal(id)) this.game.player.wanted = s;
    else this.game.modeTell(id, { wanted: s });
  }

  onHit(player: string, victim: Entity): void {
    if (!(victim instanceof Mob)) return;
    if (victim.kind === "citizen") this.crime(player, "assault");
    else if (victim.kind === "cop") this.crime(player, "assaultCop");
  }

  onKill(killer: string, kind: string): void {
    if (kind === "citizen") this.crime(killer, "murder");
    else if (kind === "cop") this.crime(killer, "copKiller");
  }

  /** Taking a car is only a crime if a cop sees it. */
  onCarjack(player: string): void {
    const p = this.players().find((q) => q.id === player);
    if (p && this.copsNear(p.x, p.z, 32).length) this.crime(player, "carjack");
  }

  /** A shot fired where people can hear it. */
  onNoise(player: string, x: number, z: number, radius: number): void {
    if (radius < 30) return;
    const heard = [...this.game.entities.values()].some((e) => e instanceof Mob && (e.kind === "citizen" || e.kind === "cop") && Math.hypot(e.x - x, e.z - z) < 24);
    if (heard) this.crime(player, "gunfire");
  }

  onPlayerDeath(id: string): void {
    this.jobLost(id, "Wasted. The job's off.");
    if (!this.police) return;
    this.clearHeat(id);
    this.wasted.add(id);
  }

  private copsNear(x: number, z: number, r: number): Mob[] {
    const out: Mob[] = [];
    for (const e of this.game.entities.values()) if (e instanceof Mob && e.kind === "cop" && !e.dying && Math.hypot(e.x - x, e.z - z) < r) out.push(e);
    return out;
  }

  /** Once a second: can the police see each wanted player? Out of sight long enough, a star goes. */
  private lookForSuspects(): void {
    const g = this.game;
    for (const p of this.alive()) {
      const s = this.stars(p.id);
      if (s === 0) continue;
      const cop = this.copsNear(p.x, p.z, 40).some((c) => canSee(g.ctx, c.x, c.y + 1.6, c.z, p.x, p.y + 1.4, p.z));
      const cruiser = [...g.entities.values()].some((e) => e instanceof Car && e.model === "police" && e.npc && !e.wrecked && Math.hypot(e.x - p.x, e.z - p.z) < 36);
      if (cop || cruiser) { this.unseen.set(p.id, 0); continue; }
      const u = (this.unseen.get(p.id) ?? 0) + 1;
      if (u >= evadeSeconds(s)) {
        this.heat.set(p.id, heatFor(s - 1));
        this.unseen.set(p.id, 0);
        this.tellWanted(p.id);
        if (s - 1 === 0) { this.clearHeat(p.id); this.tell(p.id, "You lost them. For now.", "#9ad8ff"); }
      } else this.unseen.set(p.id, u);
    }
  }

  /** Every second or so: enough cops and cruisers after each wanted player, and their orders kept current. */
  private dispatch(city: City): void {
    const g = this.game;
    const random = g.ctx.random;
    for (const p of this.alive()) {
      const s = this.stars(p.id);
      if (s === 0) continue;
      let onFoot = 0, cruisers = 0;
      for (const e of g.entities.values()) {
        if (e instanceof Mob && e.kind === "cop" && !e.dying && e.targetId === p.id) { onFoot++; e.copStars = s; }
      }
      for (const st of this.chases.values()) if (st.target === p.id) cruisers++;
      if (onFoot < COPS_ON_FOOT[s]) {
        const spot = sidewalkSpot(city, random, p, 24, 48);
        if (spot && g.world.isLoaded(Math.floor(spot.x), Math.floor(spot.z))) {
          const cop = new Mob("cop", spot.x, STREET, spot.z);
          cop.targetId = p.id;
          cop.copStars = s;
          g.spawn(cop);
        }
      }
      if (cruisers < CRUISERS[s]) {
        const spot = laneSpot(city, random, p, 45, 85);
        if (spot && g.world.isLoaded(Math.floor(spot.x), Math.floor(spot.z)) && g.ctx.entitiesNear(spot.x, STREET, spot.z, 7).length === 0) {
          const car = new Car(spot.x, STREET, spot.z, "police");
          car.yaw = car.prevYaw = spot.yaw;
          car.npc = true;
          car.siren = true;
          g.spawn(car);
          this.chases.set(car.id, { target: p.id, stuck: 0, reverse: 0 });
        }
      }
    }
  }

  /** A cruiser on a chase: to its quarry by the streets; beside them on foot, two cops get out. */
  private driveCruiser(city: City, car: Car, st: ChaseState, players: PlayerRef[]): void {
    const g = this.game;
    const t = players.find((p) => p.id === st.target);
    if (!t || this.stars(st.target) === 0) {
      // Called off: back to being traffic, lights off.
      this.chases.delete(car.id);
      car.siren = false;
      this.brains.set(car.id, newTraffic(laneNear(city, car.x, car.z, car.yaw), g.ctx.random));
      return;
    }
    const d = Math.hypot(t.x - car.x, t.z - car.z);
    if (d < 10 && !t.riding && Math.abs(car.speed) < 0.35) {
      this.chases.delete(car.id);
      car.npc = false;
      car.input = { forward: 0, strafe: 0, yaw: car.yaw, jump: true };
      for (const side of [-1, 1]) {
        const x = car.x + Math.cos(car.yaw) * side * (car.spec.w / 2 + 0.7), z = car.z - Math.sin(car.yaw) * side * (car.spec.w / 2 + 0.7);
        const cop = new Mob("cop", x, car.y, z);
        cop.targetId = t.id;
        cop.copStars = this.stars(t.id);
        g.spawn(cop);
      }
      return;
    }
    chaseDrive(city, car, st, t, g.ctx);
    if (g.tickCount % 18 === car.id % 18) g.sound("siren_wail", car.x, car.y + 1, car.z, 0.7);
  }

  /** A cop's hand on a wanted player standing still, for a second and a half: busted. */
  private checkBusts(city: City, players: PlayerRef[]): void {
    for (const p of players) {
      if (this.stars(p.id) === 0 || p.riding) { this.bustHold.delete(p.id); continue; }
      const collar = this.copsNear(p.x, p.z, 1.6).some((c) => c.targetId === p.id);
      const hold = collar ? (this.bustHold.get(p.id) ?? 0) + 5 : 0;
      if (hold >= 30) { this.bust(city, p.id); this.bustHold.delete(p.id); } else this.bustHold.set(p.id, hold);
    }
  }

  private bust(city: City, id: string): void {
    this.jobLost(id, "Busted. The job's off.");
    const s = this.stars(id);
    const fine = 100 + 50 * s;
    this.clearHeat(id);
    this.giveCash(id, -fine);
    if (this.isLocal(id)) this.game.confiscateGuns(); else this.game.modeTell(id, { confiscate: true });
    const door = city.landmarkDoor("police");
    if (door) this.teleport(id, door[0], door[1], door[2]);
    this.title(id, "BUSTED", `${BUSTED_QUIPS[Math.floor(Math.random() * BUSTED_QUIPS.length)]} Fined $${fine}; guns seized.`);
  }

  /** Whoever died: once they are back on their feet, St. Ouchie's has patched them up, for a fee. */
  private patchUpWasted(city: City): void {
    for (const id of [...this.wasted]) {
      const p = this.players().find((q) => q.id === id);
      if (!p) { this.wasted.delete(id); continue; }
      if (p.dead) continue;
      this.wasted.delete(id);
      const door = city.landmarkDoor("hospital");
      if (door) this.teleport(id, door[0], door[1], door[2]);
      this.giveCash(id, -100);
      this.title(id, "WASTED", WASTED_QUIPS[Math.floor(Math.random() * WASTED_QUIPS.length)]);
    }
  }

  /** Spray & Pray: drive in and out comes a different car, as far as the police can tell. */
  private respray(city: City): void {
    const lot = city.landmark("respray");
    if (!lot) return;
    const x0 = lot.x0 + 9, x1 = lot.x0 + LOT - 10, z0 = lot.z0 + 5, z1 = lot.z0 + LOT - 3;
    const now = this.game.tickCount;
    for (const e of this.game.entities.values()) {
      if (!(e instanceof Car) || !e.rider || e.wrecked) continue;
      if (e.x < x0 || e.x > x1 + 1 || e.z < z0 || e.z > z1 + 1) continue;
      if (now - (this.sprayed.get(e.id) ?? -10000) < 400) continue;
      this.sprayed.set(e.id, now);
      let colour = e.color;
      while (colour === e.color && !e.spec.livery) colour = Math.floor(Math.random() * CAR_COLORS.length);
      e.color = colour;
      e.health = e.spec.health;
      const had = this.stars(e.rider);
      this.clearHeat(e.rider);
      this.giveCash(e.rider, -100);
      this.title(e.rider, "Spray & Pray", had ? "New paint, who dis? The heat is off." : "New paint, who dis? Good as new.");
      this.game.sound("cashout", e.x, e.y + 1, e.z, 1);
    }
  }

  /** Tidies away what nobody is near, and fills the streets round whoever is. */
  protected populate(city: City): void {
    const g = this.game;
    const here = this.alive().map((p) => ({ x: p.x, z: p.z }));
    const far = (x: number, z: number, d: number) => here.every((p) => Math.hypot(p.x - x, p.z - z) > d);
    let traffic = 0, people = 0;
    for (const e of g.entities.values()) {
      if (e instanceof Car && e.ambient && !e.rider) {
        if (far(e.x, e.z, e.wrecked ? 70 : 120)) { e.removed = true; this.brains.delete(e.id); } else if (e.npc) traffic++;
      } else if (e instanceof Mob && e.kind === "citizen" && !e.dying) {
        if (this.keep.has(e.id)) continue;
        if (far(e.x, e.z, 90)) e.removed = true; else people++;
      } else if (e instanceof Mob && e.kind === "cop" && !e.dying && far(e.x, e.z, 100)) e.removed = true;
    }
    for (const key of [...this.parked]) {
      const [i, j] = key.split(",").map(Number);
      const lot = city.lot(i, j);
      if (far(lot.x0 + LOT / 2, lot.z0 + LOT / 2, 130)) this.parked.delete(key);
    }
    const random = g.ctx.random;
    for (const p of here) {
      if (traffic < this.trafficPerPlayer * here.length) {
        const spot = laneSpot(city, random, p, 40, 90);
        if (spot && g.world.isLoaded(Math.floor(spot.x), Math.floor(spot.z)) && g.ctx.entitiesNear(spot.x, STREET, spot.z, 7).length === 0) {
          const model = weighted(TRAFFIC_MIX, random);
          const car = new Car(spot.x, STREET, spot.z, model, Math.floor(random() * CAR_COLORS.length));
          car.yaw = car.prevYaw = spot.yaw;
          car.npc = true;
          const st = newTraffic(spot.lane, random);
          car.body.vx = -Math.sin(spot.yaw) * st.cruise; car.body.vz = -Math.cos(spot.yaw) * st.cruise;
          g.spawn(car);
          this.brains.set(car.id, st);
          traffic++;
        }
      }
      if (people < this.peoplePerPlayer * here.length) {
        const spot = sidewalkSpot(city, random, p, 18, 60);
        if (spot && g.world.isLoaded(Math.floor(spot.x), Math.floor(spot.z))) {
          g.spawn(new Mob("citizen", spot.x, STREET, spot.z));
          people++;
        }
      }
      // Parked cars in the lots as they come near.
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
        const ai = city.across(Math.floor(p.x), true), aj = city.across(Math.floor(p.z), false);
        if (!ai || !aj) continue;
        const i = ("lot" in ai ? ai.lot : ai.road) + di, j = ("lot" in aj ? aj.lot : aj.road) + dj;
        if (i < 0 || j < 0 || i >= city.spec.cols || j >= city.spec.rows) continue;
        const key = `${i},${j}`;
        if (this.parked.has(key)) continue;
        const lot = city.lot(i, j);
        if (!lot.parking.length || !g.world.isLoaded(lot.x0, lot.z0) || !g.world.isLoaded(lot.x0 + LOT - 1, lot.z0 + LOT - 1)) continue;
        this.parked.add(key);
        for (const [x, y, z, yaw] of lot.parking) {
          if (lot.landmark?.kind === "safehouse" || random() < 0.35) continue;
          if (g.ctx.entitiesNear(x, y, z, 2.5).length) continue;
          const model = lot.landmark?.kind === "police" ? "police" : lot.landmark?.kind === "dealer" ? weighted<CarModelId>([["sports", 3], ["super", 1], ["muscle", 2]], random) : weighted(TRAFFIC_MIX, random);
          const car = new Car(x, y, z, model, Math.floor(random() * CAR_COLORS.length));
          car.yaw = car.prevYaw = yaw;
          g.spawn(car);
        }
      }
    }
  }
}

/** Dollars a player starts a city's free roam with. */
export const NEON_BAY_STAKE = 500;

/** What each city says when you arrive. */
const TAGLINES: Record<string, string> = { neon_bay: "Sun, sand, and questionable decisions.", golden_coast: "Sun, sand, and slot machines." };

/**
 * Neon Bay, free roam: the whole city, a car of your own outside your
 * crib, and five hundred dollars. Take any car you like — the one you are
 * standing next to, or the one somebody is driving.
 */
class FreeRoamRuntime extends CityRuntime {
  private get given(): string[] { return ((this.data.given as string[] | undefined) ??= []); }
  private count(key: string, by = 1): void { this.data[key] = ((this.data[key] as number | undefined) ?? 0) + by; }

  // ---- missions (engine/missions.ts) ---------------------------------------------------------------

  private readonly jobs = new Map<string, Job>();
  private spots: [number, number, number][] | null = null;

  /** How many of each contact's jobs a player has done, by player name (so it survives a new connection). */
  private done(name: string): Record<string, number> {
    const all = ((this.data.missions as Record<string, Record<string, number>> | undefined) ??= {});
    return (all[name] ??= {});
  }

  private contactSpots(city: City): [number, number, number][] {
    return (this.spots ??= CONTACTS.map((c) => contactSpot(city, c)));
  }


  /** Walked into a contact's mark with no stars: their next job. */
  private offerJobs(city: City): void {
    const spots = this.contactSpots(city);
    for (const p of this.alive()) {
      if (this.jobs.has(p.id) || this.stars(p.id) > 0) continue;
      CONTACTS.forEach((c, k) => {
        if (this.jobs.has(p.id)) return;
        const [x, , z] = spots[k];
        if (Math.hypot(p.x - x, p.z - z) > 2.6) return;
        const def = nextMission(c, this.done(p.name)[c.id] ?? 0);
        if (def) this.startJob(city, p.id, p.name, c, def);
      });
    }
  }

  private startJob(city: City, id: string, name: string, contact: Contact, def: MissionDef): void {
    const g = this.game;
    const salt = hash4(g.meta.seed, name.length * 131 + def.id.length, this.done(name)[contact.id] ?? 0, g.tickCount);
    const job: Job = { player: id, contact, def, stage: 0, deadline: def.seconds ? g.tickCount + def.seconds * 20 : null, guards: [] };
    if (def.from) job.from = placeSpot(city, def.from, salt);
    if (def.to) job.to = placeSpot(city, def.to, salt + 1);
    if (def.kind === "boost" && job.from) {
      // The car waits in the lot, nose to the street.
      const car = new Car(job.from[0], STREET, job.from[2] - 4, def.car ?? "sedan", Math.floor(g.ctx.random() * CAR_COLORS.length));
      car.yaw = car.prevYaw = Math.PI;
      car.ambient = false;
      g.spawn(car);
      job.car = car.id;
    }
    if (def.kind === "hit" && job.from) {
      const target = new Mob("citizen", job.from[0], STREET, job.from[2] - 3);
      target.quip = def.target ?? "The Target";
      target.quipTicks = 1e9;
      g.spawn(target);
      job.target = target.id;
      this.keep.add(target.id);
      for (let k = 0; k < (def.guards ?? 0); k++) {
        const guard = new Mob("citizen", job.from[0] + (k % 2 ? 2 : -2), STREET, job.from[2] - 3 - Math.floor(k / 2) * 2);
        guard.say("I'm with them.");
        g.spawn(guard);
        job.guards.push(guard.id);
        this.keep.add(guard.id);
      }
    }
    if (def.kind === "race") {
      const p = this.players().find((q) => q.id === id)!;
      job.route = raceRoute(city, p.x, p.z, def.checkpoints ?? 6, g.ctx.random);
    }
    if (def.heat) this.raiseHeat(id, def.heat);
    this.jobs.set(id, job);
    this.title(id, def.name, `${contact.name} · $${def.pay.toLocaleString("en-US")}`);
    def.brief.forEach((line, i) => this.say(id, contact.name, line, contact.color, 20 + i * 75));
    this.game.sound("orb_catch", null);
  }

  private endJob(job: Job): void {
    this.jobs.delete(job.player);
    // Whatever the contact had left to say is moot now.
    this.lines.delete(job.player);
    for (const e of [job.target, ...job.guards]) if (e !== undefined) this.keep.delete(e);
  }

  private passJob(job: Job, pay: number): void {
    const p = this.players().find((q) => q.id === job.player);
    this.endJob(job);
    if (!p) return;
    const done = this.done(p.name);
    done[job.contact.id] = (done[job.contact.id] ?? 0) + 1;
    this.count("jobs");
    this.giveCash(p.id, pay);
    this.title(p.id, "MISSION PASSED", `+$${pay.toLocaleString("en-US")}`);
    this.say(p.id, job.contact.name, job.def.pass, job.contact.color, 30);
    this.game.sound("mission_passed", p.x, p.y + 1, p.z, 1);
    const all = CONTACTS.every((c) => (done[c.id] ?? 0) >= c.missions.length);
    if (all) this.say(p.id, "Neon Bay", "Every contact, every job. The city is yours now. Main character energy: confirmed.", "#ff9ad8", 140);
  }

  private failJob(job: Job, why: string): void {
    this.endJob(job);
    this.title(job.player, "MISSION FAILED", why);
    const p = this.players().find((q) => q.id === job.player);
    if (p) this.game.sound("mission_failed", p.x, p.y + 1, p.z, 1);
  }

  protected jobLost(id: string, why: string): void {
    const job = this.jobs.get(id);
    if (job) this.failJob(job, why);
  }

  /** Every few ticks: how each job is going. */
  private runJobs(): void {
    const g = this.game;
    for (const job of [...this.jobs.values()]) {
      const p = this.players().find((q) => q.id === job.player);
      if (!p) { this.endJob(job); continue; }
      if (job.deadline !== null && g.tickCount > job.deadline) { this.failJob(job, "Out of time. Skill issue."); continue; }
      const near = (at: [number, number, number] | undefined, r: number) => !!at && Math.hypot(p.x - at[0], p.z - at[2]) < r;
      const { def, contact } = job;
      switch (def.kind) {
        case "delivery":
          if (job.stage === 0 && near(job.from, 3)) { job.stage = 1; this.say(p.id, contact.name, `Got ${def.cargo}? Now get it where it's going.`, contact.color); }
          else if (job.stage === 1 && near(job.to, 3.5)) this.passJob(job, def.pay);
          break;
        case "boost": {
          const car = job.car !== undefined ? g.entities.get(job.car) : undefined;
          if (!(car instanceof Car) || car.removed || car.wrecked) { this.failJob(job, "The car's toast. So is your cut."); break; }
          if (job.stage === 0 && car.rider === p.id) { job.stage = 1; this.say(p.id, contact.name, "Nice ride. Now to the drop-off, and don't scratch it.", contact.color); }
          else if (job.stage === 1 && car.rider === p.id && Math.hypot(car.x - job.to![0], car.z - job.to![2]) < 5) {
            this.passJob(job, boostPay(def.pay, car.model, car.health));
            car.removed = true;
          }
          break;
        }
        case "hit": {
          const target = job.target !== undefined ? g.entities.get(job.target) : undefined;
          if (!(target instanceof Mob) || target.dying || target.removed) { this.passJob(job, def.pay); break; }
          // Their name stays over their head, whatever they shout in between.
          if (target.quipTicks <= 1) { target.quip = def.target ?? "The Target"; target.quipTicks = 1e9; }
          const d = Math.hypot(p.x - target.x, p.z - target.z);
          if (d > 170) { this.failJob(job, "They got away."); break; }
          if (d < 16) {
            // Spotted: the target runs, the friends step up.
            target.panic = Math.max(target.panic, 60);
            target.scare = { x: p.x, z: p.z };
            for (const gid of job.guards) {
              const guard = g.entities.get(gid);
              if (guard instanceof Mob && !guard.dying && guard.anger <= 0) { guard.targetId = p.id; guard.anger = 900; guard.say("Protect the boss!"); }
            }
          }
          break;
        }
        case "race":
          if (job.route && near(job.route[job.stage], 7)) {
            job.stage++;
            g.sound("orb", p.x, p.y + 1, p.z, 1, 1.4);
            if (job.stage >= job.route.length) this.passJob(job, def.pay);
          }
          break;
      }
    }
  }

  /** The marks each player should see: their job's next spot, or the contacts who have work. */
  private markJobs(city: City): void {
    const spots = this.contactSpots(city);
    for (const p of this.players()) {
      const job = this.jobs.get(p.id);
      const out: Marker[] = [];
      const at = (s: [number, number, number] | undefined, color: string, r: number) => { if (s) out.push({ x: s[0], y: s[1], z: s[2], color, r }); };
      if (job) {
        const e = (id: number | undefined) => (id === undefined ? undefined : this.game.entities.get(id));
        switch (job.def.kind) {
          case "delivery": at(job.stage === 0 ? job.from : job.to, job.stage === 0 ? "#ffd83a" : "#5aff7a", 3); break;
          case "boost": {
            const car = e(job.car);
            if (job.stage === 0 && car) at([car.x, car.y, car.z], "#ff4a4a", 2.5); else at(job.to, "#5aff7a", 4);
            break;
          }
          case "hit": { const t = e(job.target); if (t) at([t.x, t.y, t.z], "#ff4a4a", 1.5); break; }
          case "race":
            at(job.route?.[job.stage], "#3ad0ff", 6);
            at(job.route?.[job.stage + 1], "#1a6a8a", 4);
            break;
        }
      } else if (this.stars(p.id) === 0) {
        CONTACTS.forEach((c, k) => { if (nextMission(c, this.done(p.name)[c.id] ?? 0)) at(spots[k], c.color, 2.5); });
      }
      this.mark(p.id, out);
    }
  }

  tick(): void {
    super.tick();
    const city = this.city();
    if (!city || !this.home) return;
    if (this.game.tickCount % 5 === 0) this.runJobs();
    if (this.game.tickCount % 10 === 0) this.markJobs(city);
  }

  start(): void {
    this.title(null, this.city()?.spec.name ?? "The City", TAGLINES[this.city()?.spec.id ?? ""] ?? "");
    this.tell(null, "Your ride is parked outside your crib. Use a car to get in, sneak to get out; W and S for the pedals, A and D to steer, Space for the handbrake. Any car is your car if you want it badly enough.", "#ff9ad8");
    const city = this.city();
    const home = city?.landmark("safehouse");
    const spot = home?.parking[0];
    if (spot) {
      const car = new Car(spot[0], spot[1], spot[2], "muscle", 14);
      car.yaw = car.prevYaw = spot[3];
      car.ambient = false;
      this.game.spawn(car);
    }
  }

  second(): void {
    super.second();
    const city = this.city();
    if (city && this.home) this.offerJobs(city);
    for (const p of this.players()) {
      if (this.given.includes(p.name)) continue;
      this.given.push(p.name);
      this.giveCash(p.id, NEON_BAY_STAKE);
    }
  }

  onCarjack(player: string): void { super.onCarjack(player); this.count("jacked"); }
  onKill(killer: string, kind: string): void { super.onKill(killer, kind); if (kind === "citizen") this.count("bonked"); }
  onCarWrecked(): void { this.count("wrecked"); }

  objective(playerId: string): Objective {
    const job = this.jobs.get(playerId);
    if (job) {
      const { def } = job;
      const what = def.kind === "delivery" ? (job.stage === 0 ? `Pick up ${def.cargo}` : `Deliver ${def.cargo}`)
        : def.kind === "boost" ? (job.stage === 0 ? `Steal the ${CAR_MODELS[def.car ?? "sedan"].name}` : "Drive it to the drop-off")
        : def.kind === "hit" ? `Bonk ${def.target}`
        : `Checkpoint ${Math.min(job.stage + 1, job.route?.length ?? 0)} of ${job.route?.length ?? 0}`;
      const lines: [string, string][] = [["Do", what]];
      if (job.deadline !== null) lines.push(["Time", ModeRuntime.clock(Math.max(0, (job.deadline - this.game.tickCount) / 20))]);
      lines.push(["Pay", `$${def.pay.toLocaleString("en-US")}`]);
      return { title: def.name, lines };
    }
    const n = (k: string) => String((this.data[k] as number | undefined) ?? 0);
    const name = this.players().find((p) => p.id === playerId)?.name ?? "";
    const done = Object.values(this.done(name)).reduce((t, v) => t + v, 0);
    return { title: this.city()?.spec.name ?? "The City", lines: [["Jobs done", `${done} of ${ALL_MISSIONS.length}`], ["Cars jacked", n("jacked")], ["Cars wrecked", n("wrecked")], ["People bonked", n("bonked")]] };
  }

  restart(): string {
    this.data.given = [];
    this.data.jacked = this.data.wrecked = this.data.bonked = 0;
    return "The counters are back at zero, and everyone gets their five hundred again.";
  }
}

registerRuntime("neon_bay", (g, d, s) => new FreeRoamRuntime(g, d, s));
registerRuntime("golden_coast", (g, d, s) => new FreeRoamRuntime(g, d, s));
