/**
 * Cars: the city modes' vehicles, driven by players and by the traffic.
 *
 * The handling is arcade, the way the crime-sandbox games tuned theirs: the
 * throttle pulls hard off the line and fades toward the top speed, the
 * brakes bite, steering is sharp at a crawl and calmer at speed, and the
 * tyres grip — shed most of any sideways slide each tick — unless the
 * handbrake is on, when they let go and the tail swings out. Speeds are in
 * blocks a tick; a block is a metre, so 1.0 is 72 km/h.
 *
 * A car is longer than it is wide, and the physics body is a square, so the
 * body is the car's width and the ends are checked separately: points at
 * each corner and bumper are probed against the blocks after every move,
 * and a bumper in a wall undoes the move and counts as a crash.
 *
 * Health runs to a thousand. Crashes, bullets and blasts take it down;
 * under a quarter the engine burns, and a burning car explodes a few
 * seconds later — a blast that hurts whoever is near but leaves the city's
 * buildings standing — and what is left is a black wreck that sits smoking
 * until it is towed (despawns). A car in deep water drowns: its engine
 * dies and it sinks, without the bang.
 */
import { B, block } from "./blocks";
import type { DamageSource, Entity, EntityContext, EntitySnapshot, PlayerRef } from "./entities";
import type { AABB } from "./physics";
import { Mob } from "./mobs";
import { groundBlock, moveBody, senseEnvironment } from "./physics";
import { registerVehicle, Vehicle } from "./vehicles";

export type CarModelId = "compact" | "sedan" | "taxi" | "police" | "sports" | "super" | "muscle" | "van" | "pickup";

export interface CarModel {
  name: string;
  /** Width, length and height of the body, in blocks. */
  w: number;
  l: number;
  h: number;
  /** Top speed (blocks a tick), pull off the line, braking, and full-lock turn (radians a tick). */
  top: number;
  accel: number;
  brake: number;
  turn: number;
  /** How much of a sideways slide survives each tick: lower is grippier. */
  slide: number;
  health: number;
  /** Where the driver sits: their hips' height above the ground, and how far forward of the car's middle. */
  seatY: number;
  seatZ: number;
  price: number;
  /** A fixed livery (the taxi's yellow, the police black and white); otherwise any colour from the list. */
  livery?: number;
  blurb: string;
}

/** Paint, by index: what the renderer and the respray shop draw from. */
export const CAR_COLORS = [
  "#d8d8dc", "#1c1c20", "#b8202a", "#1e4fb8", "#f4c21a", "#2a9a4a", "#f06aa8", "#3ad0d8",
  "#f07a1a", "#7a3ab8", "#8a8a90", "#5a3a22", "#0e2a5a", "#e8e0c0", "#ff3a8a", "#9aff3a",
] as const;

export const CAR_MODELS: Record<CarModelId, CarModel> = {
  compact: { name: "Smol Bean", w: 1.7, l: 3.0, h: 1.5, top: 0.95, accel: 0.02, brake: 0.05, turn: 0.075, slide: 0.55, health: 800, seatY: 0.35, seatZ: 0.1, price: 3000,
    blurb: "Fits anywhere. Including, eventually, the scrapyard." },
  sedan: { name: "Midmobile", w: 1.9, l: 4.0, h: 1.6, top: 1.1, accel: 0.02, brake: 0.055, turn: 0.062, slide: 0.55, health: 1000, seatY: 0.35, seatZ: 0.2, price: 6000,
    blurb: "It's mid. It gets you there. That's the review." },
  taxi: { name: "Yeet Cab", w: 1.9, l: 4.0, h: 1.6, top: 1.1, accel: 0.021, brake: 0.055, turn: 0.062, slide: 0.55, health: 1000, seatY: 0.35, seatZ: 0.2, price: 7000, livery: 4,
    blurb: "Where to? Doesn't matter. The meter's already running." },
  police: { name: "NBPD Interceptor", w: 1.9, l: 4.1, h: 1.6, top: 1.45, accel: 0.028, brake: 0.065, turn: 0.066, slide: 0.5, health: 1300, seatY: 0.35, seatZ: 0.2, price: 0, livery: 1,
    blurb: "To protect and to serve. Mostly the second one, on donuts." },
  sports: { name: "Gigachad GT", w: 1.95, l: 4.0, h: 1.3, top: 1.6, accel: 0.034, brake: 0.07, turn: 0.068, slide: 0.45, health: 900, seatY: 0.25, seatZ: 0.0, price: 60000,
    blurb: "Jawline aerodynamics. Zero to sixty before you finish the sentence." },
  super: { name: "Wen Lambo", w: 2.0, l: 4.2, h: 1.2, top: 1.8, accel: 0.04, brake: 0.08, turn: 0.07, slide: 0.42, health: 850, seatY: 0.2, seatZ: -0.1, price: 250000,
    blurb: "You asked wen. It's now. Probably financed with something that went to zero." },
  muscle: { name: "Boomer Blaster", w: 1.95, l: 4.3, h: 1.45, top: 1.45, accel: 0.036, brake: 0.05, turn: 0.056, slide: 0.62, health: 1100, seatY: 0.3, seatZ: 0.1, price: 25000,
    blurb: "V8. Gas was 30 cents when this was designed, and it still thinks it is." },
  van: { name: "Sus Van", w: 2.0, l: 4.6, h: 2.2, top: 0.95, accel: 0.016, brake: 0.045, turn: 0.052, slide: 0.6, health: 1400, seatY: 0.45, seatZ: 1.1, price: 9000, livery: 0,
    blurb: "White. Unmarked. Nobody knows what's in the back. Nobody asks." },
  pickup: { name: "Ohio Pickup", w: 2.0, l: 4.6, h: 1.75, top: 1.15, accel: 0.022, brake: 0.05, turn: 0.056, slide: 0.6, health: 1300, seatY: 0.45, seatZ: 0.4, price: 12000,
    blurb: "Built for a state where anything can happen. Anything does." },
};
export const CAR_MODEL_IDS = Object.keys(CAR_MODELS) as CarModelId[];
export const isCarModel = (v: unknown): v is CarModelId => typeof v === "string" && v in CAR_MODELS;

/** What drives a car that nobody sits in: the traffic's lane and plans (engine/traffic.ts). Host only; never saved. */
export interface CarBrain {
  kind: "traffic" | "chase";
  state: unknown;
}

/** Kilometres an hour, for the speedometer. */
export const kmh = (blocksPerTick: number): number => Math.round(Math.abs(blocksPerTick) * 72);

export class Car extends Vehicle {
  readonly kind = "car" as const;
  model: CarModelId;
  color: number;
  health: number;
  /** Ticks since it blew up (or drowned), or 0 while it runs. */
  wrecked = 0;
  /** The police lights and siren. */
  siren = false;
  /** Somebody at the wheel who is not a player: traffic, or a cop. Shown in the seat; thrown out by a carjacker. */
  npc = false;
  /** A car the city put there (traffic, a parked car): tidied away when nobody is near. A car a player has driven is theirs to keep. */
  ambient = true;
  /** The front wheels' angle, for the model; and how far the wheels have rolled. */
  steer = 0;
  roll = 0;
  /** The last player to drive it: credited for what it hits. */
  lastDriver: string | null = null;
  /** The last player to shoot or strike it: blamed if it goes up. */
  lastAttacker: string | null = null;
  brain: CarBrain | null = null;
  /** Ticks until the horn may sound again. */
  hornCool = 0;
  /** What it lost in its last crash (driver-side), for the host and the screen shake. */
  lastImpact = 0;

  constructor(x: number, y: number, z: number, model: CarModelId = "sedan", color = 0, id?: number) {
    const m = CAR_MODELS[model];
    super(x, y, z, m.w, m.h, id);
    this.model = model;
    this.color = m.livery ?? color;
    this.health = m.health;
    this.body.stepHeight = 0.6;
  }

  get spec(): CarModel { return CAR_MODELS[this.model]; }
  /** A seated rider's feet: their hips (0.64 up, drawn at 0.85 size) at the seat. */
  riderY(): number { return this.body.y + this.spec.seatY - 0.64; }
  itemName(): string { return "air"; }
  get rideable(): boolean { return this.wrecked === 0; }

  /** The body is only as long as the car is wide: struck, aimed at or climbed into, it is three boxes nose to tail. */
  hitParts(): { name: string; box: AABB }[] {
    const b = this.body, m = this.spec, half = m.w / 2;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    return [-1, 0, 1].map((k) => {
      const cx = b.x + fx * k * (m.l - m.w) / 2, cz = b.z + fz * k * (m.l - m.w) / 2;
      return { name: "car", box: { minX: cx - half, minY: b.y, minZ: cz - half, maxX: cx + half, maxY: b.y + m.h, maxZ: cz + half } };
    });
  }

  /** Signed speed along the way it faces. */
  get speed(): number {
    return this.body.vx * -Math.sin(this.yaw) + this.body.vz * -Math.cos(this.yaw);
  }

  /** Where the driver's seat is in the world: forward of the middle, on the left. */
  seat(): { x: number; y: number; z: number } {
    const f = this.spec.seatZ, side = -(this.spec.w / 4 - 0.05);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { x: this.body.x - s * f + c * side, y: this.riderY(), z: this.body.z - c * f - s * side };
  }

  hurt(ctx: EntityContext, amount: number, source: DamageSource, _fx: number, _fz: number, attacker?: string): boolean {
    if (this.removed || this.wrecked) return false;
    if (source === "fall" || source === "drown" || source === "starve" || source === "suffocation" || source === "void") return false;
    const creative = !!attacker && ctx.players().some((p) => p.id === attacker && !p.targetable);
    if (creative) { this.removed = true; return true; }
    if (attacker && !attacker.startsWith("mob:") && attacker !== this.rider) this.lastAttacker = attacker;
    // A fist barely dents it; bullets and blades do; a blast wrecks it outright.
    const scale = source === "explosion" ? 90 : source === "fire" || source === "lava" ? 3 : source === "vehicle" ? 1 : 12;
    this.damageBy(ctx, amount * scale);
    this.hurtTime = 10;
    ctx.sound("car_hit", this.x, this.y + 0.5, this.z, 0.6, 0.9 + ctx.random() * 0.3);
    return true;
  }

  /** Takes health off, and sets it burning (or off) when that is the end of it. */
  damageBy(ctx: EntityContext, amount: number): void {
    if (this.wrecked || amount <= 0) return;
    const was = this.health;
    this.health = Math.max(0, this.health - amount);
    if (was >= 250 && this.health < 250) ctx.sound("ignite", this.x, this.y + 0.8, this.z, 0.8);
    if (this.health <= 0) this.blowUp(ctx);
  }

  /** The bang: a blast that spares the blocks, and a wreck left behind. */
  blowUp(ctx: EntityContext): void {
    if (this.wrecked) return;
    this.wrecked = 1;
    this.health = 0;
    this.siren = false;
    this.npc = false;
    this.brain = null;
    this.rider = null;
    const b = this.body;
    b.vy = 0.45;
    ctx.explode(b.x, b.y + 0.8, b.z, 4, this, false, false);
  }

  tick(ctx: EntityContext): void {
    const b = this.body;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.hornCool > 0) this.hornCool--;
    senseEnvironment(ctx.world, b);
    const m = this.spec;

    if (this.wrecked) {
      this.wrecked++;
      b.vy -= 0.08;
      moveBody(ctx.world, b, b.vx, b.vy, b.vz);
      b.vx *= b.onGround ? 0.7 : 0.98; b.vz *= b.onGround ? 0.7 : 0.98;
      if (this.wrecked < 400 && this.age % 3 === 0) ctx.particles(this.wrecked < 140 ? "flame" : "smoke", b.x, b.y + m.h, b.z, 1);
      if (this.wrecked > 2400 || b.y < -64) this.removed = true;
      return;
    }

    // Deep water drowns the engine: it sinks and dies, quietly.
    const drowned = b.inWater && ctx.world.blockAt(Math.floor(b.x), Math.floor(b.y + m.h * 0.6), Math.floor(b.z)) === B.WATER;
    if (drowned) {
      this.health = Math.max(0, this.health - 6);
      b.vy = Math.max(b.vy - 0.02, -0.08);
      b.vx *= 0.9; b.vz *= 0.9;
      moveBody(ctx.world, b, b.vx, b.vy, b.vz);
      if (this.health <= 0) { this.wrecked = 1; this.rider = null; this.npc = false; this.brain = null; }
      return;
    }
    // Burning: it has a few seconds, and so does anyone inside.
    if (this.health < 250) {
      this.health -= 1.6;
      if (this.age % 2 === 0) ctx.particles("flame", b.x - Math.sin(this.yaw) * m.l * 0.35, b.y + m.h, b.z - Math.cos(this.yaw) * m.l * 0.35, 1);
      if (this.health <= 0) { this.blowUp(ctx); return; }
    } else if (this.health < 450 && this.age % 4 === 0) {
      ctx.particles("smoke", b.x - Math.sin(this.yaw) * m.l * 0.35, b.y + m.h, b.z - Math.cos(this.yaw) * m.l * 0.35, 1);
    }

    this.drive(ctx);
    if (b.y < -64) this.removed = true;
  }

  /** The handling: throttle, brakes, steering and grip, then the move and the bumpers. */
  private drive(ctx: EntityContext): void {
    const b = this.body, m = this.spec;
    const driven = !!this.rider || this.npc;
    const input = driven ? this.input : { forward: 0, strafe: 0, yaw: 0, jump: false };
    const handbrake = !!input.jump;
    const ground = b.onGround ? groundBlock(ctx.world, b) : 0;
    // Off the tarmac the wheels dig in: sand and grass hold it back, ice lets it go.
    const soft = ground === B.SAND || ground === B.GRASS || ground === B.DIRT || ground === B.RED_SAND || ground === B.GRAVEL;
    const slick = ground ? (block(ground).slipperiness ?? 0.6) > 0.9 : false;
    const top = m.top * (soft ? 0.55 : 1) * (this.health < 450 ? 0.8 : 1);

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    let s = b.vx * fx + b.vz * fz;
    if (b.onGround) {
      const throttle = input.forward;
      if (throttle > 0) s += s < -0.02 ? m.brake : m.accel * Math.max(0, 1 - Math.max(0, s) / top) * throttle;
      else if (throttle < 0) s -= s > 0.02 ? m.brake : m.accel * 0.6 * Math.max(0, 1 - Math.max(0, -s) / (top * 0.35)) * -throttle;
      else s = Math.sign(s) * Math.max(0, Math.abs(s) * 0.985 - 0.002);
      if (handbrake) s *= 0.965;
      if (Math.abs(s) > top) s *= 0.96;
    }

    // Steering eases toward the wheel's lock, and turns the car by how fast it rolls.
    this.steer += (Math.max(-1, Math.min(1, input.strafe)) - this.steer) * 0.35;
    if (b.onGround) {
      const pace = Math.min(1, Math.abs(s) / 0.18) * (1 - 0.35 * Math.min(1, Math.abs(s) / m.top));
      this.yaw -= this.steer * m.turn * pace * Math.sign(s) * (handbrake ? 1.45 : 1);
    }

    // What the old velocity was, measured against the new heading: the sideways part is the slide.
    const nfx = -Math.sin(this.yaw), nfz = -Math.cos(this.yaw);
    const rx = -nfz, rz = nfx;
    let side = b.vx * rx + b.vz * rz;
    if (b.onGround) side *= handbrake || slick ? 0.93 : m.slide;
    // Tyres squeal in a hard slide.
    if (Math.abs(side) > 0.18 && this.age % 5 === 0) ctx.particles("smoke", b.x, b.y + 0.1, b.z, 1);
    if (b.onGround) {
      b.vx = nfx * s + rx * side;
      b.vz = nfz * s + rz * side;
    }
    b.vy = Math.max(-1.5, b.vy - 0.08);

    const px = b.x, pz = b.z, vx = b.vx, vz = b.vz;
    moveBody(ctx.world, b, b.vx, b.vy, b.vz);
    let impact = Math.hypot(vx - b.vx, vz - b.vz);
    if (this.bumperIn(ctx)) {
      // The nose (or the tail) is in a wall: back out of the move, and bounce off it.
      impact = Math.max(impact, Math.hypot(vx, vz));
      b.x = px; b.z = pz;
      b.vx = -vx * 0.25; b.vz = -vz * 0.25;
    }
    this.lastImpact = impact;
    if (impact > 0.28) this.crashed(ctx, impact);
    this.roll += s * 1.6;
    this.walkDist += Math.abs(s);
  }

  /** Whether a corner or a bumper of the car is inside a solid block. */
  bumperIn(ctx: EntityContext): boolean {
    const b = this.body, m = this.spec;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
    const hl = m.l / 2 - 0.05, hw = m.w / 2 - 0.08;
    for (const [a, c] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0]]) {
      const x = b.x + fx * a + rx * c, z = b.z + fz * a + rz * c;
      for (const dy of [0.35, Math.min(m.h - 0.15, 1.1)]) {
        const id = ctx.world.blockAt(Math.floor(x), Math.floor(b.y + dy), Math.floor(z));
        if (id && block(id).solid) return true;
      }
    }
    return false;
  }

  private crashed(ctx: EntityContext, impact: number): void {
    const b = this.body;
    ctx.sound("car_crash", b.x, b.y + 0.5, b.z, Math.min(1, impact), 0.8 + ctx.random() * 0.3);
    ctx.particles("crit", b.x - Math.sin(this.yaw) * this.spec.l * 0.5, b.y + 0.6, b.z - Math.cos(this.yaw) * this.spec.l * 0.5, 6);
    this.damageBy(ctx, (impact - 0.2) * 260);
  }

  honk(ctx: EntityContext): void {
    if (this.hornCool > 0) return;
    this.hornCool = 12;
    ctx.sound(this.model === "police" && this.siren ? "siren_whoop" : "car_horn", this.x, this.y + 0.8, this.z, 1, this.model === "van" || this.model === "pickup" ? 0.8 : 1);
  }

  /**
   * What the car runs into: people, creatures and other cars. Run where the
   * world is simulated, for every car, whoever drives it — a guest steers
   * their own car, but only the host can hurt what it hits.
   */
  impacts(ctx: EntityContext, others: readonly Entity[], players: readonly PlayerRef[]): void {
    if (this.wrecked) return;
    const b = this.body, m = this.spec;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
    const speed = Math.hypot(b.vx, b.vz);
    const driver = this.rider ?? (this.npc ? null : this.lastDriver);
    const inside = (x: number, z: number, y: number, h: number, r: number): number | null => {
      if (y > b.y + m.h || y + h < b.y) return null;
      const dx = x - b.x, dz = z - b.z;
      const a = dx * fx + dz * fz, c = dx * rx + dz * rz;
      if (Math.abs(a) > m.l / 2 + r || Math.abs(c) > m.w / 2 + r) return null;
      return a;
    };
    for (const p of players) {
      if (p.id === this.rider || p.riding || !p.targetable) continue;
      const a = inside(p.x, p.z, p.y, p.height, p.width / 2);
      if (a === null) continue;
      if (speed > 0.22) {
        ctx.hurtPlayer(p.id, 3 + speed * 16, "vehicle", b.x - fx * 2, b.z - fz * 2, speed * 1.5);
        // The car loses a little to them; they lose a lot to it.
        b.vx *= 0.85; b.vz *= 0.85;
      }
    }
    for (const e of others) {
      if (e === this || e.removed) continue;
      if (e instanceof Car) { this.bump(ctx, e); continue; }
      if (!(e instanceof Mob) || e.dying) continue;
      const a = inside(e.x, e.z, e.y, e.body.height, e.body.width / 2);
      if (a === null) continue;
      if (speed > 0.2) {
        e.hurt(ctx, 3 + speed * 24, "vehicle", b.x - fx * 2, b.z - fz * 2, driver ?? undefined, speed * 1.5);
        b.vx *= 0.92; b.vz *= 0.92;
      } else {
        // At a crawl it only nudges them aside.
        const side = (e.x - b.x) * rx + (e.z - b.z) * rz >= 0 ? 1 : -1;
        e.body.vx += rx * side * 0.08; e.body.vz += rz * side * 0.08;
      }
    }
  }

  /** Two cars touching: pushed apart along the line between them, both dented by how hard they met. */
  private bump(ctx: EntityContext, o: Car): void {
    if (o.id < this.id || o.wrecked && this.wrecked) return;
    const a = this.body, b = o.body;
    const reach = (this.spec.l + o.spec.l) / 2;
    if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach || Math.abs(a.y - b.y) > 1.5) return;
    // Each car as three discs along its length: the nearest pair decides.
    let best = Infinity, nx = 0, nz = 0;
    for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) {
      const ax = a.x - Math.sin(this.yaw) * i * this.spec.l / 3, az = a.z - Math.cos(this.yaw) * i * this.spec.l / 3;
      const bx = b.x - Math.sin(o.yaw) * j * o.spec.l / 3, bz = b.z - Math.cos(o.yaw) * j * o.spec.l / 3;
      const d = Math.hypot(ax - bx, az - bz);
      if (d < best) { best = d; nx = (ax - bx) / (d || 1); nz = (az - bz) / (d || 1); }
    }
    const overlap = (this.spec.w + o.spec.w) / 2 - best;
    if (overlap <= 0) return;
    a.x += nx * overlap / 2; a.z += nz * overlap / 2;
    b.x -= nx * overlap / 2; b.z -= nz * overlap / 2;
    const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (closing <= 0) return;
    // An even trade of momentum along the line of impact, and the dents to match.
    a.vx += nx * closing * 0.6; a.vz += nz * closing * 0.6;
    b.vx -= nx * closing * 0.6; b.vz -= nz * closing * 0.6;
    if (closing > 0.12) {
      ctx.sound("car_crash", (a.x + b.x) / 2, a.y + 0.6, (a.z + b.z) / 2, Math.min(1, closing), 0.9);
      this.damageBy(ctx, closing * 220);
      o.damageBy(ctx, closing * 220);
    }
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), health: Math.round(this.health) };
  }

  protected extraData(): Record<string, unknown> {
    return {
      m: this.model, c: this.color, w: this.wrecked || undefined, s: this.siren ? 1 : undefined, n: this.npc ? 1 : undefined,
      a: this.ambient ? 1 : undefined, st: Math.round(this.steer * 100) / 100, l: this.lastDriver ?? undefined,
    };
  }

  protected applyExtra(d: Record<string, unknown>): void {
    if (isCarModel(d.m)) this.model = d.m;
    if (typeof d.c === "number") this.color = Math.max(0, Math.min(CAR_COLORS.length - 1, Math.floor(d.c)));
    this.wrecked = typeof d.w === "number" ? d.w : 0;
    this.siren = d.s === 1;
    this.npc = d.n === 1;
    this.ambient = d.a === 1;
    if (typeof d.st === "number") this.steer = d.st;
    this.lastDriver = typeof d.l === "string" ? d.l : null;
  }

  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    if (typeof s.health === "number") this.health = s.health;
    const m = this.spec;
    this.body.width = m.w; this.body.height = m.h;
  }
}

registerVehicle("car", (s) => new Car(s.x, s.y, s.z, isCarModel(s.data?.m) ? s.data.m : "sedan", Number(s.data?.c ?? 0), s.id));
