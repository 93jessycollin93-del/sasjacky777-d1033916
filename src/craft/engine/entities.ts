/**
 * Everything in the world that is not a block: dropped items, experience
 * orbs, arrows and thrown things, falling sand, lit TNT — and, in mobs.ts,
 * the animals and monsters.
 *
 * Entities only touch the game through `EntityContext`, which is how the same
 * code runs for a single-player world and for the host of an online one: the
 * context decides whether "damage this player" means changing a local health
 * bar or sending a message to someone else's browser.
 */
import { block, B, FACE_DIRS, Face } from "./blocks";
import { sameItem, sanitizeStack } from "./inventory";
import { burstDamage, burstParticle, rocketLife, sanitizeRocket, type Rocket } from "./fireworks";
import { formSeconds, potionByKey, potionOfItem } from "./potions";
import { itemByName, itemDef, maxStack, type ItemStack, type StatusEffect } from "./items";
import { bodyBox, moveBody, newBody, senseEnvironment, type AABB, type Body } from "./physics";
import { raycastBlocks, rayBox } from "./raycast";
import type { World } from "./world";
import { TORPOR } from "./creatures";

export type EntityKind =
  | "item" | "xp" | "arrow" | "snowball" | "egg" | "potion" | "xp_bottle" | "fireball" | "small_fireball" | "falling_block" | "tnt"
  | "ender_pearl" | "eye_of_ender" | "dragon_fireball" | "end_crystal" | "area_cloud" | "enderman" | "silverfish" | "ender_dragon"
  | "pig" | "cow" | "sheep" | "chicken" | "zombie" | "skeleton" | "creeper" | "spider" | "slime" | "villager" | "iron_golem"
  | "zombified_piglin" | "ghast" | "magma_cube" | "blaze" | "wither_skeleton" | "piglin" | "hoglin"
  | "boat" | "minecart" | "tnt_minecart" | "car"
  | "shulker" | "shulker_bullet" | "item_frame" | "firework_rocket"
  | "wolf" | "deer" | "bear" | "tribute"
  | "dodo" | "dilo" | "parasaur" | "raptor" | "trike" | "stego" | "rex" | "bronto" | "ptero" | "gigantoraptor"
  | "infected" | "runner" | "brute" | "spitter" | "screamer" | "bloater" | "shambler" | "crawler"
  | "critter" | "trainer" | "citizen" | "cop";

export interface PlayerRef {
  id: string;
  name: string;
  x: number; y: number; z: number;
  width: number; height: number;
  /** Players in creative or spectator are ignored by monsters. */
  targetable: boolean;
  /** Item the player is holding (tempts animals). */
  heldItem: number;
  sneaking: boolean;
  /** Under an invisibility potion: monsters notice them only up close. */
  invisible?: boolean;
  /** Wearing a piece of gold armour, which piglins respect. */
  goldArmor?: boolean;
  /** Where they are looking (radians), so an enderman knows when it is stared at. */
  yaw?: number;
  pitch?: number;
  /** A carved pumpkin on the head: endermen cannot tell they are being looked at. */
  pumpkin?: boolean;
  /** Sitting in a vehicle or on a mount (so a car hits the car, not them). */
  riding?: boolean;
}

export type DamageSource = "mob" | "arrow" | "explosion" | "fall" | "fire" | "lava" | "drown" | "starve" | "void" | "cactus" | "player" | "magic" | "suffocation"
  /** The wither effect; and a blaze's or ghast's fireball, which also sets its target alight. */
  | "wither" | "fireball"
  /** Gliding into a wall too fast. */
  | "fly_into_wall"
  /** Run over, or rammed. */
  | "vehicle"
  /** The vitals some modes keep (engine/vitals.ts). */
  | "thirst" | "cold" | "heat" | "bleeding" | "sickness" | "infection";

export interface EntityContext {
  world: World;
  tick: number;
  /** Sky brightness, 0 (night) .. 1 (noon). */
  daylight: number;
  difficulty: 0 | 1 | 2 | 3;
  random: () => number;
  players(): PlayerRef[];
  /** `attacker` is the mob's entity id, when a mob struck (so Thorns can strike back). */
  hurtPlayer(id: string, amount: number, source: DamageSource, fromX: number, fromZ: number, knockback: number, attacker?: number): void;
  /** Tries to hand a stack to a player; returns how many they could not take. */
  givePlayer(id: string, stack: ItemStack): number;
  giveXp(id: string, amount: number): void;
  spawn(e: Entity): void;
  dropItem(x: number, y: number, z: number, stack: ItemStack, vx?: number, vy?: number, vz?: number): void;
  /** `fire` leaves flames among the rubble (a ghast's fireball); `blocks: false` spares the blocks (a car going up). */
  explode(x: number, y: number, z: number, power: number, cause: Entity | null, fire?: boolean, blocks?: boolean): void;
  /** A mob's blow carried an effect (a wither skeleton's wither). */
  effectPlayer?(id: string, effect: StatusEffect, seconds: number, amp: number): void;
  sound(name: string, x: number, y: number, z: number, volume?: number, pitch?: number): void;
  particles(kind: string, x: number, y: number, z: number, count?: number, data?: number): void;
  entitiesNear(x: number, y: number, z: number, radius: number): Entity[];
  /** Places a block as the world (sand landing), returning whether it took. */
  placeBlock(x: number, y: number, z: number, id: number, meta: number): boolean;
  /** A player's blow finished a mob off (for advancements). */
  creditKill?(playerId: string, hostile: boolean, kind?: string): void;
  /** A player's blow (or bumper) landed on a mob: the city's police take an interest. */
  creditHit?(playerId: string, victim: Entity): void;
  /** A game mode's say in what a mob drops (Random Drops). */
  transformLoot?(stack: ItemStack): ItemStack;
  /** A thrown potion burst here; `direct` is what it struck, which takes the full dose. */
  splashPotion?(itemId: number, x: number, y: number, z: number, direct: Entity | PlayerRef | null, owner: string | null): void;
  /** An ender pearl landed: carry its thrower here (or, if it struck a gateway, through it). */
  pearlLanded?(playerId: string, x: number, y: number, z: number, gateway: [number, number, number] | null): void;
  /** An end crystal was destroyed (the dragon, if it was drawing on it, is hurt). */
  crystalDestroyed?(crystal: Entity, attacker: string | undefined): void;
  /** The dragon's death throes are over: open the portal home, lay the egg, open a gateway. */
  dragonDefeated?(dragon: Entity): void;
  /** Whether mobs may change blocks (endermen, the dragon's path): the mobGriefing rule. */
  readonly mobGriefing?: boolean;
  /** Rain is falling (overworld only), which endermen flee. */
  readonly raining?: boolean;
  /** Primal's rules, where the world plays them (Ascended tames faster). */
  readonly primal?: "evolved" | "ascended";
  /** A blood moon is up: every infected digs through whatever is in its way. */
  readonly bloodMoon?: boolean;
}

let nextEntityId = 1;
export function allocateEntityId(): number {
  return nextEntityId++;
}
export function bumpEntityIds(past: number): void {
  if (past >= nextEntityId) nextEntityId = past + 1;
}

/** State shipped to other players and saved to disk. */
export interface EntitySnapshot {
  id: number;
  kind: EntityKind;
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  yaw: number;
  pitch?: number;
  health?: number;
  /** Kind-specific fields. */
  data?: Record<string, unknown>;
}

export abstract class Entity {
  readonly id: number;
  abstract readonly kind: EntityKind;
  body: Body;
  yaw = 0;
  pitch = 0;
  /** Where the entity was last tick, for smooth rendering between ticks. */
  prevX: number; prevY: number; prevZ: number; prevYaw = 0;
  age = 0;
  removed = false;
  fireTicks = 0;
  /** Distance walked, drives the leg swing in the renderer. */
  walkDist = 0;
  prevWalkDist = 0;

  constructor(x: number, y: number, z: number, width: number, height: number, id = allocateEntityId()) {
    this.id = id;
    this.body = newBody(x, y, z, width, height, height * 0.85);
    this.prevX = x; this.prevY = y; this.prevZ = z;
  }

  get x(): number { return this.body.x; }
  get y(): number { return this.body.y; }
  get z(): number { return this.body.z; }

  box(): AABB {
    return bodyBox(this.body);
  }

  /** Separate boxes a blow can land on, for an entity bigger than one box (the dragon); null to use box(). */
  hitParts(): { name: string; box: AABB }[] | null {
    return null;
  }

  beginTick(): void {
    this.prevX = this.body.x; this.prevY = this.body.y; this.prevZ = this.body.z;
    this.prevYaw = this.yaw;
    this.prevWalkDist = this.walkDist;
    this.age++;
  }

  abstract tick(ctx: EntityContext): void;

  /** Hit by a player or mob; `knockback` adds to the usual shove (Knockback, Punch). Returns true if it took the hit. */
  hurt(_ctx: EntityContext, _amount: number, _source: DamageSource, _fromX: number, _fromZ: number, _attackerId?: string, _knockback = 0): boolean {
    return false;
  }

  snapshot(): EntitySnapshot {
    return { id: this.id, kind: this.kind, x: round(this.body.x), y: round(this.body.y), z: round(this.body.z), vx: round(this.body.vx), vy: round(this.body.vy), vz: round(this.body.vz), yaw: round(this.yaw) };
  }

  applySnapshot(s: EntitySnapshot): void {
    this.body.x = s.x; this.body.y = s.y; this.body.z = s.z;
    this.body.vx = s.vx ?? 0; this.body.vy = s.vy ?? 0; this.body.vz = s.vz ?? 0;
    this.yaw = s.yaw;
    if (s.pitch !== undefined) this.pitch = s.pitch;
  }

  /** Simple gravity-and-drag motion shared by items, orbs and falling blocks. */
  protected fall(ctx: EntityContext, gravity: number, drag: number): void {
    const b = this.body;
    senseEnvironment(ctx.world, b);
    if (b.inWater) {
      b.vy += 0.005; // bob up in water
      b.vx *= 0.9; b.vz *= 0.9; b.vy *= 0.9;
    } else {
      b.vy -= gravity;
    }
    moveBody(ctx.world, b, b.vx, b.vy, b.vz);
    b.vx *= drag; b.vy *= 0.98; b.vz *= drag;
    if (b.onGround) { b.vx *= 0.6; b.vz *= 0.6; }
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

// ---- dropped items -----------------------------------------------------------------

export class ItemEntity extends Entity {
  readonly kind = "item" as const;
  pickupDelay: number;
  bob: number;
  /** Player who threw it; they cannot pick it straight back up. */
  thrower: string | null = null;

  constructor(x: number, y: number, z: number, public stack: ItemStack, pickupDelay = 10, id?: number) {
    super(x, y, z, 0.25, 0.25, id);
    this.pickupDelay = pickupDelay;
    this.bob = Math.random() * Math.PI * 2;
  }

  tick(ctx: EntityContext): void {
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.fall(ctx, 0.04, 0.98);
    // Netherite shrugs off fire and floats up out of lava; everything else burns.
    if (itemDef(this.stack.id)?.fireproof) {
      if (this.body.inLava) this.body.vy = Math.max(this.body.vy, 0.06);
      this.fireTicks = 0;
    } else if (this.body.inLava || this.fireTicks > 0 && this.age % 10 === 0) {
      this.removed = true;
      ctx.particles("smoke", this.x, this.y + 0.2, this.z, 4);
      ctx.sound("fizz", this.x, this.y, this.z, 0.4);
      return;
    }
    if (this.age > 6000) { this.removed = true; return; }
    // Merge with a nearby identical stack, so a mined vein is one pile, not forty.
    if (this.age % 10 === 0) {
      for (const e of ctx.entitiesNear(this.x, this.y, this.z, 0.8)) {
        // Two swords are two swords: only stacks that could share a slot merge.
        if (e !== this && e instanceof ItemEntity && !e.removed && sameItem(e.stack, this.stack) && e.stack.count + this.stack.count <= maxStack(this.stack.id)) {
          this.stack.count += e.stack.count;
          e.removed = true;
        }
      }
    }
    if (this.pickupDelay > 0) return;
    for (const p of ctx.players()) {
      if (p.id === this.thrower && this.age < 40) continue;
      const dx = p.x - this.x, dy = p.y + 0.5 - this.y, dz = p.z - this.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1.4) {
        const left = ctx.givePlayer(p.id, { ...this.stack });
        if (left < this.stack.count) {
          ctx.sound("pop", this.x, this.y, this.z, 0.25, 1.4 + ctx.random() * 0.6);
          if (left <= 0) { this.removed = true; return; }
          this.stack.count = left;
        }
      } else if (d < 2.2) {
        // A gentle pull the last metre, which reads as "picked up" rather than "touched".
        this.body.vx += (dx / d) * 0.03; this.body.vz += (dz / d) * 0.03; this.body.vy += (dy / d) * 0.02;
      }
    }
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { stack: this.stack, delay: this.pickupDelay } };
  }
  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    const st = s.data?.stack as ItemStack | undefined;
    if (st) this.stack = st;
  }
}

// ---- experience -----------------------------------------------------------------------

export class XpOrb extends Entity {
  readonly kind = "xp" as const;
  constructor(x: number, y: number, z: number, public value: number, id?: number) {
    super(x, y, z, 0.25, 0.25, id);
    this.body.vx = (Math.random() - 0.5) * 0.2;
    this.body.vy = Math.random() * 0.2;
    this.body.vz = (Math.random() - 0.5) * 0.2;
  }
  tick(ctx: EntityContext): void {
    this.fall(ctx, 0.03, 0.98);
    if (this.age > 6000) { this.removed = true; return; }
    // Orbs that meet become one (after Clumps): a mob farm's hundred orbs are a handful of entities, not a hundred.
    if ((this.age + this.id) % 10 === 0) {
      for (const e of ctx.entitiesNear(this.x, this.y, this.z, 1.5)) {
        if (e === this || !(e instanceof XpOrb) || e.removed) continue;
        this.value += e.value;
        e.removed = true;
      }
    }
    let best: PlayerRef | null = null, bestD = 8;
    for (const p of ctx.players()) {
      const d = Math.hypot(p.x - this.x, p.y + 0.9 - this.y, p.z - this.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (!best) return;
    if (bestD < 1) {
      ctx.giveXp(best.id, this.value);
      ctx.sound("orb", this.x, this.y, this.z, 0.2, 0.8 + ctx.random() * 0.8);
      this.removed = true;
      return;
    }
    const pull = (1 - bestD / 8) ** 2 * 0.1;
    this.body.vx += ((best.x - this.x) / bestD) * pull;
    this.body.vy += ((best.y + 0.9 - this.y) / bestD) * pull;
    this.body.vz += ((best.z - this.z) / bestD) * pull;
  }
  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { value: this.value } };
  }
}

/** Splits an XP amount into orbs the way the original does (bigger orbs for bigger rewards). */
export function xpOrbValues(total: number): number[] {
  const sizes = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  const out: number[] = [];
  let left = Math.floor(total);
  while (left > 0) {
    const s = sizes.find((v) => v <= left) ?? 1;
    out.push(s);
    left -= s;
  }
  return out;
}

// ---- projectiles -----------------------------------------------------------------------

export type ProjectileKind = "arrow" | "snowball" | "egg" | "potion" | "xp_bottle" | "fireball" | "small_fireball"
  | "ender_pearl" | "eye_of_ender" | "dragon_fireball" | "shulker_bullet";
export const isProjectileKind = (k: unknown): k is ProjectileKind =>
  k === "arrow" || k === "snowball" || k === "egg" || k === "potion" || k === "xp_bottle" || k === "fireball" || k === "small_fireball"
  || k === "ender_pearl" || k === "eye_of_ender" || k === "dragon_fireball" || k === "shulker_bullet";
const isFireball = (k: ProjectileKind) => k === "fireball" || k === "small_fireball" || k === "dragon_fireball";

export class Projectile extends Entity {
  inGround = false;
  groundTicks = 0;
  /** Who fired it: a player id, a mob entity id, or null. */
  owner: string | null;
  /** Players may pick up arrows they shot; skeleton arrows only break. */
  pickup: boolean;
  damage: number;
  /** Punch: extra knockback on a hit. */
  knockback = 0;
  /** Flame: sets what it hits alight. */
  fire = false;
  /** The potion a thrown bottle holds (item id). */
  item = 0;
  /** An eye of ender: the point it flies toward, and whether it drops back down when spent (four in five do). */
  target: { x: number; y: number; z: number } | null = null;
  survives = true;
  /** A shulker's bullet: the player it hunts, and the axis-bound heading it holds until it next turns. */
  homing: string | null = null;
  private turnIn = 0;
  private heading: [number, number, number] = [0, 0, 0];

  constructor(public readonly kind: ProjectileKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, owner: string | null, id?: number) {
    const size = kind === "fireball" || kind === "dragon_fireball" ? 1 : kind === "small_fireball" || kind === "shulker_bullet" ? 0.3125 : 0.25;
    super(x, y, z, size, size, id);
    this.body.vx = vx; this.body.vy = vy; this.body.vz = vz;
    this.owner = owner;
    this.pickup = kind === "arrow" && owner !== null && !owner.startsWith("mob:");
    this.damage = kind === "arrow" ? 2 : kind === "fireball" ? 6 : kind === "small_fireball" ? 5 : kind === "shulker_bullet" ? 4 : 0;
    this.faceVelocity();
  }

  /**
   * A ghast's fireball can be batted back: any blow sends it off the way the
   * blow was struck, and it counts as the striker's from then on.
   */
  hurt(ctx: EntityContext, _amount: number, _source: DamageSource, fromX: number, fromZ: number, attacker?: string): boolean {
    // A shulker's bullet is swatted out of the air by any blow.
    if (this.kind === "shulker_bullet" && !this.removed) {
      this.removed = true;
      ctx.particles("crit", this.body.x, this.body.y, this.body.z, 8);
      ctx.sound("shulker_bullet_hit", this.body.x, this.body.y, this.body.z, 0.8);
      return true;
    }
    if (this.kind !== "fireball" || this.removed) return false;
    const b = this.body;
    const dx = b.x - fromX, dz = b.z - fromZ, d = Math.hypot(dx, dz) || 1;
    const speed = Math.max(0.6, Math.hypot(b.vx, b.vy, b.vz));
    b.vx = (dx / d) * speed; b.vz = (dz / d) * speed; b.vy = -b.vy * 0.5;
    this.owner = attacker ?? null;
    this.faceVelocity();
    return true;
  }

  private faceVelocity(): void {
    const b = this.body;
    this.yaw = Math.atan2(b.vx, b.vz);
    this.pitch = Math.atan2(b.vy, Math.hypot(b.vx, b.vz));
  }

  /**
   * Sends an eye of ender toward a stronghold as the original does: at most
   * twelve blocks along the way and eight up, or straight to it when closer.
   */
  signalTo(tx: number, ty: number, tz: number, random: () => number): void {
    const b = this.body;
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    this.target = d > 12 ? { x: b.x + (dx / d) * 12, y: b.y + 8, z: b.z + (dz / d) * 12 } : { x: tx, y: ty, z: tz };
    this.survives = random() >= 0.2;
    b.vx = b.vy = b.vz = 0;
  }

  /** The eye's flight: speeding up toward its target, bobbing toward its height, and after four seconds dropping or shattering. */
  private eyeTick(ctx: EntityContext): void {
    const b = this.body;
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    const t = this.target;
    if (t) {
      const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
      const angle = Math.atan2(dz, dx);
      let speed = Math.hypot(b.vx, b.vz) + (d - Math.hypot(b.vx, b.vz)) * 0.0025;
      let vy = b.vy;
      if (d < 1) { speed *= 0.8; vy *= 0.8; }
      const up = b.y < t.y ? 1 : -1;
      b.vx = Math.cos(angle) * speed; b.vz = Math.sin(angle) * speed;
      b.vy = vy + (up - vy) * 0.015;
    }
    if (this.age % 2 === 0) ctx.particles("portal", b.x, b.y, b.z, 2);
    if (this.age > 80) {
      this.removed = true;
      ctx.sound("eye_of_ender_death", b.x, b.y, b.z, 1);
      if (this.survives) ctx.dropItem(b.x, b.y, b.z, { id: this.item, count: 1 }, 0, 0.1, 0);
      else ctx.particles("portal", b.x, b.y, b.z, 24);
    }
  }

  /**
   * A shulker's bullet flies along one axis at a time — never straight at its
   * mark — turning every half second or so onto whichever axis still has the
   * most distance to close. That is what makes it dodgeable, and why it
   * swerves around corners. With its mark gone it sinks and bursts.
   *
   * A leg also ends as soon as it has closed its axis or passed the mark on
   * it. Run for its full half second regardless, a leg overshot the mark's
   * line, came back and overshot again, and a bullet whose passes stayed half
   * a block to one side never struck at all — one in forty, standing still.
   * An axis counts as closed only inside the mark's hitbox (a quarter block),
   * so the last leg lands on it rather than beside it.
   */
  private steerBullet(ctx: EntityContext): void {
    const b = this.body;
    const mark = this.homing ? ctx.players().find((p) => p.id === this.homing && p.targetable) : undefined;
    const d = mark ? [mark.x - b.x, mark.y + mark.height / 2 - b.y, mark.z - b.z] : [0, 0, 0];
    const leg = this.heading.findIndex((h) => h !== 0);
    const legDone = !!mark && leg >= 0 && (Math.abs(d[leg]) < 0.25 || Math.sign(d[leg]) !== Math.sign(this.heading[leg]));
    if (!mark) {
      this.heading = [0, -0.15, 0];
    } else if (--this.turnIn <= 0 || legDone) {
      // A leg that reached the mark's line stops on it, rather than drifting on across while the next leg starts.
      if (legDone) {
        if (leg === 0) b.vx = 0;
        else if (leg === 1) b.vy = 0;
        else b.vz = 0;
      }
      const axes = [0, 1, 2].filter((i) => Math.abs(d[i]) > 0.25);
      // Already on its mark on every axis: keep closing on the farthest, however little is left.
      let axis = axes.length ? axes[0] : [0, 1, 2].reduce((m, i) => (Math.abs(d[i]) > Math.abs(d[m]) ? i : m), 0);
      // Weighted toward the longest leg, but not always it.
      let total = 0;
      for (const i of axes) total += Math.abs(d[i]);
      let roll = ctx.random() * total;
      for (const i of axes) { roll -= Math.abs(d[i]); if (roll <= 0) { axis = i; break; } }
      this.heading = [0, 0, 0];
      this.heading[axis] = Math.sign(d[axis] || 1) * 0.15;
      this.turnIn = 10 + Math.floor(ctx.random() * 5) * 5;
    }
    b.vx += (this.heading[0] - b.vx) * 0.2;
    b.vy += (this.heading[1] - b.vy) * 0.2;
    b.vz += (this.heading[2] - b.vz) * 0.2;
  }

  tick(ctx: EntityContext): void {
    const b = this.body;
    if (this.kind === "eye_of_ender") { this.eyeTick(ctx); return; }
    if (this.kind === "shulker_bullet") this.steerBullet(ctx);
    if (this.inGround) {
      this.groundTicks++;
      if (this.groundTicks > 1200) this.removed = true;
      // The block it stuck in was mined: fall out.
      if (ctx.world.blockAt(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)) === 0) this.inGround = false;
      if (this.pickup && this.groundTicks > 5) {
        for (const p of ctx.players()) {
          if (Math.hypot(p.x - b.x, p.y + 0.5 - b.y, p.z - b.z) < 1.2) {
            if (ctx.givePlayer(p.id, { id: this.item || ARROW_ITEM(), count: 1 }) === 0) {
              ctx.sound("pop", b.x, b.y, b.z, 0.25, 1.6);
              this.removed = true;
            }
          }
        }
      }
      return;
    }
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    // Entities along this tick's path.
    let hitEntity: Entity | null = null, hitPlayer: PlayerRef | null = null, best = 1;
    let hitPart: string | undefined;
    // Wide enough to take in a dragon's wingtip, seven blocks from its middle.
    for (const e of ctx.entitiesNear(b.x, b.y, b.z, speed + 8)) {
      if (e === this || e.kind === "item" || e.kind === "xp" || e instanceof Projectile || `mob:${e.id}` === this.owner) continue;
      if (this.age < 3 && e.kind === "tnt") continue;
      const parts = e.hitParts();
      if (parts) {
        for (const part of parts) {
          const r = rayBox(b.x, b.y, b.z, b.vx, b.vy, b.vz, grow(part.box, 0.3), 1);
          if (r && r.t < best) { best = r.t; hitEntity = e; hitPlayer = null; hitPart = part.name; }
        }
        continue;
      }
      const box = e.box();
      const r = rayBox(b.x, b.y, b.z, b.vx, b.vy, b.vz, grow(box, 0.3), 1);
      if (r && r.t < best) { best = r.t; hitEntity = e; hitPlayer = null; }
    }
    for (const p of ctx.players()) {
      if (p.id === this.owner && this.age < 5) continue;
      const box: AABB = { minX: p.x - p.width / 2, minY: p.y, minZ: p.z - p.width / 2, maxX: p.x + p.width / 2, maxY: p.y + p.height, maxZ: p.z + p.width / 2 };
      const r = rayBox(b.x, b.y, b.z, b.vx, b.vy, b.vz, grow(box, 0.3), 1);
      if (r && r.t < best) { best = r.t; hitPlayer = p; hitEntity = null; }
    }
    let blockHit = raycastBlocks(ctx.world, b.x, b.y, b.z, b.vx, b.vy, b.vz, speed);
    // A pearl that meets a gateway goes through it, carrying its thrower.
    if (blockHit && this.kind === "ender_pearl" && ctx.world.blockAt(blockHit.x, blockHit.y, blockHit.z) === B.END_GATEWAY) {
      this.removed = true;
      if (this.owner && !this.owner.startsWith("mob:")) ctx.pearlLanded?.(this.owner, b.x, b.y, b.z, [blockHit.x, blockHit.y, blockHit.z]);
      return;
    }
    if (blockHit && this.kind === "dragon_fireball" && !block(ctx.world.blockAt(blockHit.x, blockHit.y, blockHit.z)).solid) blockHit = null;
    const blockT = blockHit ? blockHit.distance / Math.max(speed, 1e-6) : 2;
    if ((hitEntity || hitPlayer) && best < blockT) {
      if (hitEntity && hitPart) (hitEntity as Entity & { hurtPart?: string }).hurtPart = hitPart;
      // Snowballs sting blazes, and only blazes.
      const dmg = this.kind === "arrow" ? Math.ceil(speed * this.damage) : isFireball(this.kind) ? this.damage
        : this.kind === "snowball" && hitEntity?.kind === "blaze" ? 3 : this.kind === "ender_pearl" ? 0.001 : 0;
      const nx = b.vx / (speed || 1), nz = b.vz / (speed || 1);
      if (this.kind === "shulker_bullet") {
        // It strikes, and lifts what it struck: ten seconds rising, and a fall at the end of it.
        if (hitEntity) {
          hitEntity.hurt(ctx, this.damage, "arrow", b.x - nx, b.z - nz, this.owner ?? undefined);
          (hitEntity as Entity & { applyEffect?: (c: EntityContext, k: StatusEffect, s: number, a: number) => void }).applyEffect?.(ctx, "levitation", 10, 0);
        }
        if (hitPlayer) {
          ctx.hurtPlayer(hitPlayer.id, this.damage, "arrow", b.x - nx, b.z - nz, 0.2);
          ctx.effectPlayer?.(hitPlayer.id, "levitation", 10, 0);
        }
        this.impact(ctx, hitEntity ?? hitPlayer);
        return;
      }
      if (this.kind === "dragon_fireball") {
        // It bursts into a cloud of breath rather than striking; the dragon does not burst its own.
        if (hitEntity && `mob:${hitEntity.id}` === this.owner) { b.x += b.vx; b.y += b.vy; b.z += b.vz; return; }
        this.impact(ctx, hitEntity ?? hitPlayer);
        return;
      }
      if (isFireball(this.kind)) {
        if (hitEntity) {
          hitEntity.hurt(ctx, dmg, "fireball", b.x - nx, b.z - nz, this.owner ?? undefined);
          if (this.kind === "small_fireball") hitEntity.fireTicks = Math.max(hitEntity.fireTicks, 100);
        }
        if (hitPlayer) ctx.hurtPlayer(hitPlayer.id, dmg, "fireball", b.x - nx, b.z - nz, 0.4);
        this.impact(ctx, hitEntity ?? hitPlayer);
        return;
      }
      // A bottle bursts on whatever it meets; only arrows and snowballs strike.
      if (this.kind !== "potion" && this.kind !== "xp_bottle") {
        if (hitEntity) {
          if (hitEntity.hurt(ctx, Math.max(dmg, 0.001), this.kind === "arrow" ? "arrow" : "player", b.x - nx, b.z - nz, this.owner ?? undefined, this.knockback * 0.5) && this.fire) {
            hitEntity.fireTicks = Math.max(hitEntity.fireTicks, 100);
          }
        }
        if (hitPlayer && dmg > 0) ctx.hurtPlayer(hitPlayer.id, dmg, "arrow", b.x - nx, b.z - nz, 0.4 + this.knockback * 0.5);
        // A tipped arrow's potion goes in with it, an eighth as long as the drink.
        if (this.kind === "arrow" && this.item) this.tip(ctx, hitEntity, hitPlayer);
      }
      this.impact(ctx, hitEntity ?? hitPlayer);
      return;
    }
    if (blockHit) {
      b.x = blockHit.px - b.vx / speed * 0.05; b.y = blockHit.py - b.vy / speed * 0.05; b.z = blockHit.pz - b.vz / speed * 0.05;
      if (this.kind === "arrow") {
        this.inGround = true;
        b.vx = b.vy = b.vz = 0;
        ctx.sound("arrow_hit", b.x, b.y, b.z, 0.6);
        if (ctx.world.blockAt(blockHit.x, blockHit.y, blockHit.z) === B.TNT) {
          ctx.world.setBlock(blockHit.x, blockHit.y, blockHit.z, B.AIR);
          ctx.spawn(new PrimedTnt(blockHit.x + 0.5, blockHit.y, blockHit.z + 0.5, 80));
        }
      } else this.impact(ctx);
      return;
    }
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    senseEnvironment(ctx.world, b);
    if (this.kind === "shulker_bullet") {
      if (this.age % 2 === 0) ctx.particles("end_rod", b.x, b.y, b.z, 1);
      if (this.age > 600 || b.y < -64) this.removed = true;
      return;
    }
    if (isFireball(this.kind)) {
      // Fireballs fly straight, trailing smoke (the dragon's, its breath), and burn out after half a minute.
      if (this.age % 2 === 0) ctx.particles(this.kind === "dragon_fireball" ? "dragon_breath" : "smoke", b.x, b.y + b.height / 2, b.z, this.kind === "dragon_fireball" ? 3 : 1);
      if (this.age > 600 || b.y < -64) this.removed = true;
      return;
    }
    const drag = b.inWater ? 0.6 : 0.99;
    b.vx *= drag; b.vy = b.vy * drag - (this.kind === "arrow" ? 0.05 : 0.03); b.vz *= drag;
    this.faceVelocity();
    if (this.age > 1200 || b.y < -64) this.removed = true;
  }

  private tip(ctx: EntityContext, entity: Entity | null, player: PlayerRef | null): void {
    const def = itemDef(this.item);
    // A tranquilizer arrow carries a dose of torpor, and slows a player it strikes.
    if (def?.name === "tranq_arrow") {
      const by = this.owner && !this.owner.startsWith("mob:") ? this.owner : undefined;
      (entity as (Entity & { addTorpor?: (c: EntityContext, n: number, by?: string) => void }) | null)?.addTorpor?.(ctx, TORPOR.tranq, by);
      if (player) ctx.effectPlayer?.(player.id, "slowness", 6, 1);
      return;
    }
    const potion = def ? potionOfItem(def.name) : undefined;
    if (!potion) return;
    const attacker = this.owner && !this.owner.startsWith("mob:") ? this.owner : undefined;
    for (const fx of potion.potion.effects) {
      const seconds = formSeconds(fx.seconds, "arrow");
      if (player) ctx.effectPlayer?.(player.id, fx.effect, seconds, fx.amp);
      (entity as (Entity & { applyEffect?: (c: EntityContext, k: StatusEffect, s: number, a: number, by?: string) => void }) | null)?.applyEffect?.(ctx, fx.effect, seconds, fx.amp, attacker);
    }
  }

  private impact(ctx: EntityContext, struck: Entity | PlayerRef | null = null): void {
    this.removed = true;
    const b = this.body;
    if (this.kind === "shulker_bullet") {
      ctx.particles("crit", b.x, b.y, b.z, 10);
      ctx.sound("shulker_bullet_hit", b.x, b.y, b.z, 0.9);
    }
    if (this.kind === "fireball") ctx.explode(b.x, b.y + b.height / 2, b.z, 1, null, true);
    if (this.kind === "dragon_fireball") {
      ctx.spawn(new AreaCloud(b.x, b.y, b.z, 3, 600, this.owner));
      ctx.sound("dragon_fireball_explode", b.x, b.y, b.z, 1);
    }
    if (this.kind === "ender_pearl") {
      ctx.particles("portal", b.x, b.y, b.z, 24);
      if (this.owner && !this.owner.startsWith("mob:")) ctx.pearlLanded?.(this.owner, b.x, b.y, b.z, null);
    }
    if (this.kind === "small_fireball") {
      const x = Math.floor(b.x), y = Math.floor(b.y), z = Math.floor(b.z);
      if (!struck && ctx.world.blockAt(x, y, z) === B.AIR) ctx.placeBlock(x, y, z, B.FIRE, 0);
      ctx.sound("fire", b.x, b.y, b.z, 0.5);
    }
    if (this.kind === "potion") ctx.splashPotion?.(this.item, b.x, b.y, b.z, struck, this.owner);
    if (this.kind === "xp_bottle") {
      ctx.sound("glass_break", b.x, b.y, b.z, 0.8);
      ctx.particles("splash", b.x, b.y, b.z, 12);
      // Three to eleven points, as the original's bottle o' enchanting.
      for (const v of xpOrbValues(3 + Math.floor(ctx.random() * 5) + Math.floor(ctx.random() * 5))) ctx.spawn(new XpOrb(b.x, b.y, b.z, v));
    }
    if (this.kind === "snowball") ctx.particles("snow", b.x, b.y, b.z, 8);
    if (this.kind === "egg") {
      ctx.particles("egg", b.x, b.y, b.z, 8);
      if (ctx.random() < 0.125 && spawnChicken) {
        const chick = spawnChicken(b.x, b.y, b.z, true);
        if (chick) ctx.spawn(chick);
      }
    }
    if (this.kind === "arrow") ctx.sound("arrow_hit", b.x, b.y, b.z, 0.6);
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), pitch: round(this.pitch), data: { k: this.kind, g: this.inGround, i: this.item || undefined, f: this.fire ? 1 : undefined } };
  }
  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    this.inGround = !!s.data?.g;
    if (typeof s.data?.i === "number") this.item = s.data.i;
    this.fire = s.data?.f === 1;
  }
}

/** Set by mobs.ts, so an egg can hatch without entities.ts importing the mob module. */
export let spawnChicken: ((x: number, y: number, z: number, baby: boolean) => Entity | null) | null = null;
export function registerChickenSpawner(fn: (x: number, y: number, z: number, baby: boolean) => Entity | null): void {
  spawnChicken = fn;
}
let arrowItemId = -1;
export function registerArrowItem(id: number): void {
  arrowItemId = id;
}
const ARROW_ITEM = () => arrowItemId;

function grow(b: AABB, by: number): AABB {
  return { minX: b.minX - by, minY: b.minY - by, minZ: b.minZ - by, maxX: b.maxX + by, maxY: b.maxY + by, maxZ: b.maxZ + by };
}

// ---- falling blocks and TNT --------------------------------------------------------------

export class FallingBlock extends Entity {
  readonly kind = "falling_block" as const;
  constructor(x: number, y: number, z: number, public blockId: number, public meta = 0, id?: number) {
    super(x, y, z, 0.98, 0.98, id);
  }
  tick(ctx: EntityContext): void {
    const b = this.body;
    b.vy -= 0.04;
    moveBody(ctx.world, b, 0, b.vy, 0);
    b.vy *= 0.98;
    if (b.onGround || this.age > 600) {
      this.removed = true;
      const x = Math.floor(b.x), y = Math.floor(b.y + 0.5), z = Math.floor(b.z);
      const here = ctx.world.blockAt(x, y, z);
      if ((here === 0 || block(here).replaceable) && ctx.placeBlock(x, y, z, this.blockId, this.meta)) return;
      ctx.dropItem(b.x, b.y + 0.5, b.z, { id: this.blockId, count: 1 });
    }
    // Landing on someone hurts, a little.
    for (const p of ctx.players()) {
      if (Math.abs(p.x - b.x) < 0.8 && Math.abs(p.z - b.z) < 0.8 && b.y > p.y + 1.2 && b.y < p.y + p.height + 0.3 && b.vy < -0.3) {
        ctx.hurtPlayer(p.id, 2, "suffocation", b.x, b.z, 0);
      }
    }
  }
  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { b: this.blockId, m: this.meta } };
  }
}

export class PrimedTnt extends Entity {
  readonly kind = "tnt" as const;
  constructor(x: number, y: number, z: number, public fuse = 80, id?: number) {
    super(x, y, z, 0.98, 0.98, id);
    const a = Math.random() * Math.PI * 2;
    this.body.vx = -Math.sin(a) * 0.02;
    this.body.vy = 0.2;
    this.body.vz = -Math.cos(a) * 0.02;
  }
  tick(ctx: EntityContext): void {
    this.fall(ctx, 0.04, 0.98);
    this.fuse--;
    if (this.age % 3 === 0) ctx.particles("smoke", this.x, this.y + 1, this.z, 1);
    if (this.fuse <= 0) {
      this.removed = true;
      ctx.explode(this.x, this.y + 0.49, this.z, 4, this);
    }
  }
  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { fuse: this.fuse } };
  }
  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    if (typeof s.data?.fuse === "number") this.fuse = s.data.fuse;
  }
}

// ---- the End's entities --------------------------------------------------------------------------

/**
 * A lingering cloud of the dragon's breath: a disc that spreads from three
 * blocks across to seven over half a minute, harming whatever stands in it
 * once a second.
 */
export class AreaCloud extends Entity {
  readonly kind = "area_cloud" as const;
  private lastHit = new Map<string, number>();
  /**
   * A lingering potion's cloud holds that potion (its key) and shrinks as it
   * is breathed in; without one it is the dragon's breath, which harms, spreads,
   * and can be bottled.
   */
  potion: string | null = null;

  constructor(x: number, y: number, z: number, public radius: number, public duration: number, public owner: string | null, id?: number) {
    super(x, y, z, radius * 2, 0.5, id);
  }

  /** A glass bottle filled at the dragon's breath takes a little of the cloud with it. */
  bottled(): boolean {
    if (this.potion || this.removed || this.radius < 0.5) return false;
    this.radius -= 0.5;
    if (this.radius < 0.5) this.removed = true;
    return true;
  }

  tick(ctx: EntityContext): void {
    const b = this.body;
    const def = this.potion ? potionByKey(this.potion) : undefined;
    this.radius += def ? -3 / this.duration : 4 / 600;
    if (this.age >= this.duration || this.radius < 0.5) { this.removed = true; return; }
    if (this.age % 3 === 0) {
      const a = ctx.random() * Math.PI * 2, r = Math.sqrt(ctx.random()) * this.radius;
      if (def) ctx.particles("potion", b.x + Math.cos(a) * r, b.y + 0.2, b.z + Math.sin(a) * r, 2, parseInt(def.color.slice(1), 16));
      else ctx.particles("dragon_breath", b.x + Math.cos(a) * r, b.y + 0.2, b.z + Math.sin(a) * r, 2);
    }
    if (this.age % 5 !== 0) return;
    const inside = (x: number, y: number, z: number) => Math.hypot(x - b.x, z - b.z) <= this.radius && y > b.y - 1.5 && y < b.y + 1.5;
    const attacker = this.owner && !this.owner.startsWith("mob:") ? this.owner : undefined;
    for (const p of ctx.players()) {
      if (!p.targetable || !inside(p.x, p.y, p.z)) continue;
      // Once a second for each victim, as the original's reapplication delay.
      if (ctx.tick - (this.lastHit.get(p.id) ?? -100) < 20) continue;
      this.lastHit.set(p.id, ctx.tick);
      if (!def) { ctx.effectPlayer?.(p.id, "instant_damage", 0, 0); continue; }
      for (const e of def.effects) ctx.effectPlayer?.(p.id, e.effect, formSeconds(e.seconds, "lingering"), e.amp);
      this.radius -= 0.5;
    }
    for (const e of ctx.entitiesNear(b.x, b.y, b.z, this.radius + 1)) {
      if (e === this || e.kind === "ender_dragon" || e.kind === "item" || e.kind === "xp" || e instanceof Projectile || e instanceof AreaCloud) continue;
      if (!inside(e.x, e.y, e.z) || ctx.tick - (this.lastHit.get(`e${e.id}`) ?? -100) < 20) continue;
      this.lastHit.set(`e${e.id}`, ctx.tick);
      if (!def) { e.hurt(ctx, 6, "magic", b.x, b.z, this.owner ?? undefined); continue; }
      const affect = (e as Entity & { applyEffect?: (c: EntityContext, k: StatusEffect, s: number, a: number, by?: string) => void }).applyEffect;
      if (!affect) continue;
      for (const fx of def.effects) affect.call(e, ctx, fx.effect, formSeconds(fx.seconds, "lingering"), fx.amp, attacker);
      this.radius -= 0.5;
    }
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { r: round(this.radius), d: this.duration, p: this.potion ?? undefined } };
  }
  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    if (typeof s.data?.r === "number") this.radius = s.data.r;
    this.potion = typeof s.data?.p === "string" && potionByKey(s.data.p) ? s.data.p : null;
  }
}

/**
 * An end crystal: it heals the dragon from its spike, and any blow — a sword,
 * an arrow, a blast — sets it off in an explosion of its own.
 */
export class EndCrystal extends Entity {
  readonly kind = "end_crystal" as const;
  /** Where its beam points (the dragon it heals), for drawing; null for none. */
  beam: { x: number; y: number; z: number } | null = null;

  constructor(x: number, y: number, z: number, public showBase = true, id?: number) {
    super(x, y, z, 2, 2, id);
  }

  tick(): void {
    // It hangs where it was put; the dragon's side of the beam is set by the dragon each tick.
  }

  hurt(ctx: EntityContext, _amount: number, _source: DamageSource, _fromX: number, _fromZ: number, attacker?: string): boolean {
    if (this.removed) return false;
    this.removed = true;
    ctx.explode(this.body.x, this.body.y, this.body.z, 6, this);
    ctx.crystalDestroyed?.(this, attacker);
    return true;
  }

  snapshot(): EntitySnapshot {
    const bm = this.beam ? [round(this.beam.x), round(this.beam.y), round(this.beam.z)] : undefined;
    return { ...super.snapshot(), data: { b: this.showBase ? 1 : 0, bm } };
  }
  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    this.showBase = s.data?.b !== 0;
    const bm = s.data?.bm;
    this.beam = Array.isArray(bm) && bm.length === 3 && bm.every((v) => typeof v === "number") ? { x: bm[0], y: bm[1], z: bm[2] } : null;
  }
}

// ---- item frames ---------------------------------------------------------------------

/**
 * An item frame: hung on a face of a block, holding one item, which it shows
 * turned in eighths. Using it puts in what is held, or turns what is there; a
 * blow knocks the item out, and the next takes the frame down. It stays only
 * while the block behind it stands.
 */
export class ItemFrame extends Entity {
  readonly kind = "item_frame" as const;

  /**
   * `face` is the way the frame looks out (the face of the block it was hung
   * on); (bx, by, bz) is the cell in front of that face, which it occupies.
   */
  constructor(public face: number, public bx: number, public by: number, public bz: number, public item: ItemStack | null = null, public turn = 0, id?: number) {
    const flat = face === Face.Up || face === Face.Down;
    super(bx + 0.5, by, bz + 0.5, 0.75, flat ? 0.25 : 0.75, id);
    this.place();
  }

  /** Sits the body flat against the block behind it. */
  private place(): void {
    const [dx, , dz] = FACE_DIRS[this.face];
    const b = this.body;
    b.x = this.bx + 0.5 - dx * 0.47;
    b.z = this.bz + 0.5 - dz * 0.47;
    b.y = this.face === Face.Up ? this.by : this.face === Face.Down ? this.by + 0.75 : this.by + 0.125;
    b.vx = b.vy = b.vz = 0;
    this.prevX = b.x; this.prevY = b.y; this.prevZ = b.z;
  }

  /** The block it hangs on. */
  get support(): [number, number, number] {
    const [dx, dy, dz] = FACE_DIRS[this.face];
    return [this.bx - dx, this.by - dy, this.bz - dz];
  }

  tick(ctx: EntityContext): void {
    this.place();
    if (this.age % 10 !== 0) return;
    const [x, y, z] = this.support;
    if (ctx.world.isLoaded(x, z) && !block(ctx.world.blockAt(x, y, z)).solid) this.breakDown(ctx);
  }

  /** Right-click: take what is held (one of it) into an empty frame, or turn what is in it. Returns what happened. */
  use(ctx: EntityContext, held: ItemStack | null): "placed" | "turned" | null {
    if (!this.item) {
      if (!held) return null;
      this.item = { ...held, count: 1 };
      ctx.sound("item_frame_add", this.body.x, this.body.y + 0.4, this.body.z, 0.8);
      return "placed";
    }
    this.turn = (this.turn + 1) % 8;
    ctx.sound("item_frame_rotate", this.body.x, this.body.y + 0.4, this.body.z, 0.6);
    return "turned";
  }

  hurt(ctx: EntityContext): boolean {
    if (this.removed) return false;
    const b = this.body;
    if (this.item) {
      ctx.dropItem(b.x, b.y + 0.3, b.z, this.item);
      this.item = null;
      this.turn = 0;
      ctx.sound("item_frame_remove", b.x, b.y + 0.4, b.z, 0.8);
      return true;
    }
    this.breakDown(ctx);
    return true;
  }

  private breakDown(ctx: EntityContext): void {
    const b = this.body;
    this.removed = true;
    if (this.item) ctx.dropItem(b.x, b.y + 0.3, b.z, this.item);
    ctx.dropItem(b.x, b.y + 0.3, b.z, { id: itemByName("item_frame").id, count: 1 });
    ctx.sound("item_frame_break", b.x, b.y + 0.4, b.z, 0.8);
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { f: this.face, c: [this.bx, this.by, this.bz], it: this.item ?? undefined, t: this.turn } };
  }

  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    const d = s.data ?? {};
    if (typeof d.f === "number" && d.f >= 0 && d.f < 6) this.face = d.f;
    if (Array.isArray(d.c) && d.c.length === 3 && d.c.every((v) => typeof v === "number" && Number.isFinite(v))) [this.bx, this.by, this.bz] = d.c as [number, number, number];
    this.item = sanitizeStack(d.it);
    this.turn = typeof d.t === "number" ? ((Math.floor(d.t) % 8) + 8) % 8 : 0;
    this.place();
  }
}

// ---- fireworks ----------------------------------------------------------------------------

/**
 * A firework rocket in flight: it climbs faster and faster (drifting as it
 * goes if fired straight up, or along its heading from a dispenser) and at
 * the end of its flight bursts — every star at once, and a blast that hurts
 * what stands within five blocks if it carried any.
 */
export class FireworkRocket extends Entity {
  readonly kind = "firework_rocket" as const;
  life: number;

  constructor(x: number, y: number, z: number, public rocket: Rocket, vx: number, vy: number, vz: number, life?: number, public owner: string | null = null, id?: number) {
    super(x, y, z, 0.25, 0.25, id);
    this.body.vx = vx; this.body.vy = vy; this.body.vz = vz;
    this.life = life ?? 10 * (rocket.flight + 1) + 6;
  }

  /** Fired from a block at (x, y, z): straight up, with the original's small random lean. */
  static launch(x: number, y: number, z: number, rocket: Rocket, random: () => number, owner: string | null): FireworkRocket {
    return new FireworkRocket(x, y, z, rocket, (random() - 0.5) * 0.046, 0.05, (random() - 0.5) * 0.046, rocketLife(rocket.flight, random), owner);
  }

  tick(ctx: EntityContext): void {
    const b = this.body;
    b.vx *= 1.15; b.vz *= 1.15; b.vy += 0.04;
    // Capped, so a dispenser's sideways shot does not outrun its own chunk.
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    if (speed > 2) { b.vx *= 2 / speed; b.vy *= 2 / speed; b.vz *= 2 / speed; }
    const hit = raycastBlocks(ctx.world, b.x, b.y, b.z, b.vx, b.vy, b.vz, Math.hypot(b.vx, b.vy, b.vz));
    if (hit) { b.x = hit.px; b.y = hit.py; b.z = hit.pz; this.burst(ctx); return; }
    b.x += b.vx; b.y += b.vy; b.z += b.vz;
    if (this.age >= this.life || b.y > 400) this.burst(ctx);
  }

  burst(ctx: EntityContext): void {
    if (this.removed) return;
    this.removed = true;
    const b = this.body;
    const r = this.rocket;
    if (!r.bursts.length) { ctx.particles("poof", b.x, b.y, b.z, 4); return; }
    for (const s of r.bursts) ctx.particles(burstParticle(s), b.x, b.y, b.z, 1);
    const large = r.bursts.some((s) => s.shape === "large");
    ctx.sound(large ? "firework_large_blast" : "firework_blast", b.x, b.y, b.z, 3);
    if (r.bursts.some((s) => s.twinkle)) ctx.sound("firework_twinkle", b.x, b.y, b.z, 3);
    for (const p of ctx.players()) {
      const dmg = burstDamage(r, Math.hypot(p.x - b.x, p.y + p.height / 2 - b.y, p.z - b.z));
      if (dmg > 0 && p.targetable) ctx.hurtPlayer(p.id, dmg, "explosion", b.x, b.z, 0.2);
    }
    for (const e of ctx.entitiesNear(b.x, b.y, b.z, 6)) {
      if (e === this || e.kind === "item" || e.kind === "xp" || e instanceof Projectile || e instanceof FireworkRocket) continue;
      const dmg = burstDamage(r, Math.hypot(e.x - b.x, e.y + e.body.height / 2 - b.y, e.z - b.z));
      if (dmg > 0) e.hurt(ctx, dmg, "explosion", b.x, b.z, this.owner ?? undefined);
    }
  }

  snapshot(): EntitySnapshot {
    return { ...super.snapshot(), data: { fw: this.rocket, l: this.life } };
  }
  applySnapshot(s: EntitySnapshot): void {
    super.applySnapshot(s);
    this.rocket = sanitizeRocket(s.data?.fw) ?? this.rocket;
    if (typeof s.data?.l === "number") this.life = s.data.l;
  }
}
