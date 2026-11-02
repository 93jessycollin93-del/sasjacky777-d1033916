/**
 * Boats and minecarts.
 *
 * A vehicle is an entity a player can ride. Whoever rides it drives it: its
 * input arrives through `input`, and on a guest's screen the guest simulates
 * the vehicle it rides and reports where it went (see net/session.ts), the way
 * the original trusts a rider with their own boat — a boat steered through a
 * round trip to the host would lag behind every turn.
 *
 * Boats float, turn with A/D and push with W/S; they glide on ice and crawl on
 * land. Minecarts run along the line between a rail's two ends — a curve is a
 * diagonal, as in the original — speed up downhill, are boosted by powered
 * rails and stopped by unpowered ones, and top out at eight blocks a second.
 */
import { B, block } from "./blocks";
import { Entity, type DamageSource, type EntityContext, type EntitySnapshot } from "./entities";
import { itemByName } from "./items";
import { fluidSurface, groundBlock, moveBody, senseEnvironment } from "./physics";
import { isRail, isSlope, RAIL_EXITS, railShape } from "./rails";

export interface DriveInput {
  forward: number;
  strafe: number;
  /** Where the rider is looking (minecarts are nudged that way). */
  yaw: number;
  /** A ridden creature: jump, and (a flyer) how steeply the rider looks up or down. */
  jump?: boolean;
  pitch?: number;
}

/** Wood types a boat can be made of, in variant order. */
export const BOAT_WOODS = ["oak", "spruce", "birch", "jungle", "acacia"] as const;

export type VehicleKind = "boat" | "minecart" | "tnt_minecart" | "car";
export const isVehicleKind = (k: unknown): k is VehicleKind => k === "boat" || k === "minecart" || k === "tnt_minecart" || k === "car";

/**
 * Vehicles defined in their own modules (cars, engine/cars.ts), which build
 * on this one: they register how to rebuild themselves from a snapshot, so
 * this module need not import theirs — an import the other way round would
 * be a cycle, and a class cannot extend one not yet defined.
 */
const registered = new Map<VehicleKind, (s: EntitySnapshot) => Vehicle>();
export function registerVehicle(kind: VehicleKind, make: (s: EntitySnapshot) => Vehicle): void {
  registered.set(kind, make);
}

export abstract class Vehicle extends Entity {
  abstract readonly kind: VehicleKind;
  /** Id of the player riding it, or null. */
  rider: string | null = null;
  /** Accumulated blows; it breaks past 40, and the count drains back while left alone. */
  damage = 0;
  /** Ticks of the shake after a blow. */
  hurtTime = 0;
  input: DriveInput = { forward: 0, strafe: 0, yaw: 0 };

  /** Where the rider's feet go: low, so a seated player's hips rest in the vehicle. */
  abstract riderY(): number;
  /** Whether anyone can sit in it now (a burnt-out car cannot be driven). */
  get rideable(): boolean { return true; }
  /** The item it drops when broken. */
  abstract itemName(): string;

  hurt(ctx: EntityContext, amount: number, source: DamageSource, _fx: number, _fz: number, attacker?: string): boolean {
    if (this.removed) return false;
    if (source === "fire" || source === "drown" || source === "fall" || source === "starve" || source === "suffocation") return false;
    this.hurtTime = 10;
    this.damage += Math.max(1, amount) * 10;
    // A player in creative breaks it at once and takes nothing, as in the original.
    const creative = !!attacker && ctx.players().some((p) => p.id === attacker && !p.targetable);
    if (creative || this.damage > 40) this.breakApart(ctx, !creative);
    ctx.sound("hit", this.x, this.y + 0.3, this.z, 0.5, 1.4);
    return true;
  }

  protected breakApart(ctx: EntityContext, drop: boolean): void {
    this.removed = true;
    if (drop) ctx.dropItem(this.x, this.y + 0.3, this.z, { id: itemByName(this.itemName()).id, count: 1 });
  }

  protected tickWear(): void {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damage > 0) this.damage = Math.max(0, this.damage - 1);
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { r: this.rider, d: this.damage, ht: this.hurtTime, ...this.extraData() } };
  }

  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    const d = s.data ?? {};
    this.rider = typeof d.r === "string" ? d.r : null;
    if (typeof d.d === "number") this.damage = d.d;
    if (typeof d.ht === "number") this.hurtTime = d.ht;
    this.applyExtra(d);
  }

  protected extraData(): Record<string, unknown> { return {}; }
  protected applyExtra(_d: Record<string, unknown>): void {}
}

// ---- boats -----------------------------------------------------------------------------------

export class Boat extends Vehicle {
  readonly kind = "boat" as const;
  /** Index into BOAT_WOODS. */
  wood: number;
  /** Paddle swing, for the model. */
  paddle = 0;

  constructor(x: number, y: number, z: number, wood = 0, id?: number) {
    super(x, y, z, 1.375, 0.5625, id);
    this.wood = Math.max(0, Math.min(BOAT_WOODS.length - 1, wood));
  }

  riderY(): number { return this.body.y - 0.35; }
  itemName(): string { return `${BOAT_WOODS[this.wood]}_boat`; }

  /** The height of the water surface under the boat's middle, or null when there is none. */
  private waterSurface(ctx: EntityContext): number | null {
    const b = this.body;
    const x = Math.floor(b.x), z = Math.floor(b.z);
    for (let y = Math.floor(b.y + 0.6); y >= Math.floor(b.y - 0.4); y--) {
      if (ctx.world.blockAt(x, y, z) === B.WATER) {
        return y + fluidSurface(ctx.world.getMeta(x, y, z), ctx.world.blockAt(x, y + 1, z) === B.WATER);
      }
    }
    return null;
  }

  tick(ctx: EntityContext): void {
    const b = this.body;
    this.tickWear();
    senseEnvironment(ctx.world, b);
    const surface = this.waterSurface(ctx);
    const floating = surface !== null && b.y < surface + 0.05;
    if (floating) {
      // Sit with the hull a little below the surface: rise when deeper, settle when there.
      const depth = surface! - b.y;
      b.vy = depth > 0.12 ? Math.min(0.1, b.vy + 0.04) : b.vy * 0.5;
      if (Math.abs(depth - 0.1) < 0.05) b.vy *= 0.3;
    } else b.vy -= 0.04;

    if (this.rider) {
      const { forward, strafe } = this.input;
      // A/D turn the boat itself; W pushes hard, S backs off gently.
      this.yaw -= strafe * 0.07;
      const push = forward > 0 ? 0.04 * forward : 0.008 * forward;
      b.vx += -Math.sin(this.yaw) * push;
      b.vz += -Math.cos(this.yaw) * push;
      if (forward !== 0 || strafe !== 0) this.paddle += 0.4;
    }

    moveBody(ctx.world, b, b.vx, b.vy, b.vz);
    const ground = b.onGround ? groundBlock(ctx.world, b) : 0;
    const slip = ground ? block(ground).slipperiness ?? 0.6 : 0.6;
    // Water carries it; ice lets it fly; anything else drags it to a crawl.
    const friction = floating ? 0.9 : b.onGround ? (slip > 0.9 ? slip : 0.45) : 0.95;
    b.vx *= friction; b.vz *= friction;
    if (b.y < -64) this.removed = true;
  }

  protected extraData(): Record<string, unknown> { return { w: this.wood }; }
  protected applyExtra(d: Record<string, unknown>): void { if (typeof d.w === "number") this.wood = d.w; }
}

// ---- minecarts --------------------------------------------------------------------------------

/** Blocks a tick: the original's top speed on rails. */
export const MAX_CART_SPEED = 0.4;
const SLOPE_PULL = 0.0078125;

export class Minecart extends Vehicle {
  readonly kind: "minecart" | "tnt_minecart";
  /** A lit TNT minecart's fuse, in ticks (0 when unlit). */
  fuse = 0;

  constructor(kind: "minecart" | "tnt_minecart", x: number, y: number, z: number, id?: number) {
    super(x, y, z, 0.98, 0.7, id);
    this.kind = kind;
  }

  riderY(): number { return this.body.y - 0.2; }
  itemName(): string { return this.kind; }

  hurt(ctx: EntityContext, amount: number, source: DamageSource, fx: number, fz: number, attacker?: string): boolean {
    // Fire and blasts set a TNT cart off rather than breaking it.
    if (this.kind === "tnt_minecart" && (source === "explosion" || source === "fire" || source === "lava")) {
      this.prime(ctx);
      return true;
    }
    return super.hurt(ctx, amount, source, fx, fz, attacker);
  }

  protected breakApart(ctx: EntityContext, drop: boolean): void {
    this.removed = true;
    if (!drop) return;
    // Broken, a TNT cart comes apart into its cart and its TNT.
    if (this.kind === "tnt_minecart") {
      ctx.dropItem(this.x, this.y + 0.3, this.z, { id: itemByName("minecart").id, count: 1 });
      ctx.dropItem(this.x, this.y + 0.3, this.z, { id: B.TNT, count: 1 });
    } else ctx.dropItem(this.x, this.y + 0.3, this.z, { id: itemByName("minecart").id, count: 1 });
  }

  prime(ctx: EntityContext): void {
    if (this.kind !== "tnt_minecart" || this.fuse > 0) return;
    this.fuse = 80;
    ctx.sound("fuse", this.x, this.y + 0.5, this.z, 1);
  }

  /** The rail block the cart is on, or null: its own block, or the one below when it has just rolled down onto it. */
  private railUnder(ctx: EntityContext): [number, number, number] | null {
    const b = this.body;
    const x = Math.floor(b.x), y = Math.floor(b.y), z = Math.floor(b.z);
    if (isRail(ctx.world.blockAt(x, y, z))) return [x, y, z];
    if (isRail(ctx.world.blockAt(x, y - 1, z))) return [x, y - 1, z];
    return null;
  }

  tick(ctx: EntityContext): void {
    const b = this.body;
    this.tickWear();
    if (this.fuse > 0) {
      this.fuse--;
      if (this.age % 2 === 0) ctx.particles("smoke", b.x, b.y + 0.9, b.z, 1);
      if (this.fuse === 0) {
        this.removed = true;
        ctx.explode(b.x, b.y + 0.5, b.z, 4, this);
        return;
      }
    }
    this.pushedByPlayers(ctx);
    const rail = this.railUnder(ctx);
    if (rail) this.onRail(ctx, rail[0], rail[1], rail[2]);
    else this.offRail(ctx);
    if (b.y < -64) this.removed = true;
  }

  /** Walking into a cart nobody is riding shoves it, as in the original. */
  private pushedByPlayers(ctx: EntityContext): void {
    if (this.rider) return;
    const b = this.body;
    for (const p of ctx.players()) {
      const dx = b.x - p.x, dz = b.z - p.z;
      const reach = (b.width + p.width) / 2;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach || p.y > b.y + b.height || p.y + p.height < b.y) continue;
      const d = Math.hypot(dx, dz) || 1;
      b.vx += (dx / d) * 0.02;
      b.vz += (dz / d) * 0.02;
    }
  }

  private onRail(ctx: EntityContext, x: number, y: number, z: number): void {
    const b = this.body;
    const w = ctx.world;
    const id = w.blockAt(x, y, z);
    const m = w.getMeta(x, y, z);
    const shape = railShape(id, m);
    const [e1, e2] = RAIL_EXITS[shape] ?? RAIL_EXITS[0];

    // Downhill pulls.
    if (shape === 2) b.vx -= SLOPE_PULL;
    else if (shape === 3) b.vx += SLOPE_PULL;
    else if (shape === 4) b.vz += SLOPE_PULL;
    else if (shape === 5) b.vz -= SLOPE_PULL;

    let dx = e2[0] - e1[0], dz = e2[2] - e1[2];
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    // Keep the speed, turned onto the track: a curve bends the motion, it does not bleed it.
    const dot = b.vx * dx + b.vz * dz;
    let along = dot === 0 ? 0 : Math.sign(dot) * Math.hypot(b.vx, b.vz);

    if (this.rider && this.input.forward > 0 && Math.abs(along) < 0.1) {
      const look = -Math.sin(this.input.yaw) * dx + -Math.cos(this.input.yaw) * dz;
      along += Math.sign(look || 1) * 0.01 * this.input.forward;
    }
    if (id === B.POWERED_RAIL) {
      if ((m & 8) !== 0) {
        if (Math.abs(along) > 0.01) along += Math.sign(along) * 0.06;
        else {
          // From a standstill against a wall, a powered rail sends the cart away from it.
          const solidAt = (e: readonly number[]) => block(w.blockAt(x + e[0], y, z + e[2])).solid;
          if (solidAt(e1)) along = 0.02;
          else if (solidAt(e2)) along = -0.02;
        }
      } else if (Math.abs(along) < 0.03) along = 0;
      else along *= 0.5;
    }
    if (id === B.ACTIVATOR_RAIL && (m & 8) !== 0) {
      if (this.kind === "tnt_minecart") this.prime(ctx);
      // An active activator rail throws the rider out.
      if (this.rider) this.rider = null;
    }
    along *= this.rider ? 0.997 : 0.96;
    along = Math.max(-MAX_CART_SPEED, Math.min(MAX_CART_SPEED, along));

    // Snap onto the line between the ends (through the block's edge midpoints), then run along it.
    const p1x = e1[0] * 0.5, p1z = e1[2] * 0.5, p2x = e2[0] * 0.5, p2z = e2[2] * 0.5;
    const lx = p2x - p1x, lz = p2z - p1z;
    const lsq = lx * lx + lz * lz;
    const px = b.x - (x + 0.5), pz = b.z - (z + 0.5);
    const t = Math.max(0, Math.min(1, ((px - p1x) * lx + (pz - p1z) * lz) / lsq));
    let nx = x + 0.5 + p1x + lx * t + dx * along;
    let nz = z + 0.5 + p1z + lz * t + dz * along;
    // Track running into a wall: stop at the wall. Up a slope the next rail is a level higher,
    // so the block to test is the one at that level, not the one holding it up.
    const toward = along >= 0 ? e2 : e1;
    const ahead = w.blockAt(Math.floor(nx), y + toward[1], Math.floor(nz));
    if (ahead && block(ahead).solid && !isRail(ahead) && !(Math.floor(nx) === x && Math.floor(nz) === z)) {
      nx = x + 0.5 + p1x + lx * t;
      nz = z + 0.5 + p1z + lz * t;
      along = 0;
    }
    b.x = nx; b.z = nz;
    if (isSlope(shape)) {
      const t2 = Math.max(0, Math.min(1, ((b.x - (x + 0.5) - p1x) * lx + (b.z - (z + 0.5) - p1z) * lz) / lsq));
      b.y = y + e1[1] + (e2[1] - e1[1]) * t2 + 0.0625;
    } else b.y = y + 0.0625;
    b.vx = dx * along; b.vz = dz * along; b.vy = 0;
    b.onGround = true;
    b.fallDistance = 0;
    this.yaw = Math.atan2(-dx, -dz);
    this.walkDist += Math.abs(along);
  }

  private offRail(ctx: EntityContext): void {
    const b = this.body;
    senseEnvironment(ctx.world, b);
    b.vy -= 0.04;
    moveBody(ctx.world, b, b.vx, b.vy, b.vz);
    const friction = b.onGround ? 0.5 : b.inWater ? 0.8 : 0.95;
    b.vx *= friction; b.vz *= friction;
    b.vy *= 0.98;
    if (Math.hypot(b.vx, b.vz) > MAX_CART_SPEED) { const k = MAX_CART_SPEED / Math.hypot(b.vx, b.vz); b.vx *= k; b.vz *= k; }
  }

  protected extraData(): Record<string, unknown> { return { f: this.fuse || undefined }; }
  protected applyExtra(d: Record<string, unknown>): void { this.fuse = typeof d.f === "number" ? d.f : 0; }
}

/** Rebuilds a vehicle from a save or a host's snapshot. */
export function vehicleFromSnapshot(s: EntitySnapshot): Vehicle | null {
  let v: Vehicle | null = null;
  if (s.kind === "boat") v = new Boat(s.x, s.y, s.z, Number(s.data?.w ?? 0), s.id);
  else if (s.kind === "minecart" || s.kind === "tnt_minecart") v = new Minecart(s.kind, s.x, s.y, s.z, s.id);
  else if (isVehicleKind(s.kind)) v = registered.get(s.kind)?.(s) ?? null;
  v?.applySnapshot(s);
  return v;
}
