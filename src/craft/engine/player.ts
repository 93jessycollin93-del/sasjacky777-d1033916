/**
 * The player: position, inventory, and the survival rules.
 *
 * Health and hunger follow the original precisely because they are the game's
 * pacing — every action costs "exhaustion", four exhaustion costs a point of
 * saturation (hidden) and only then a point of food, a full bar heals fast and
 * 18+ heals slowly, and an empty bar starves you down to a floor that depends
 * on difficulty. A player who knows the original can plan a trip by it.
 */
import { B, block } from "./blocks";
import { levelOf, protectionFactor, wears } from "./enchanting";
import { Inventory } from "./inventory";
import { itemDef, type FoodInfo, type ItemStack, type StatusEffect } from "./items";
import { glide, newBody, senseEnvironment, travel, type Body, type BlockReader } from "./physics";
import type { DamageSource } from "./entities";
import { sanitizeWaypoints, type Waypoint } from "./waypoints";
import { freshVitals, sanitizeVitals, type Vitals } from "./vitals";
import { perksOf, sanitizeSurvivor, type Perks, type Survivor } from "./survivors";
import { freshCard, sanitizeCard, type TrainerCard } from "./critters";

export type GameMode = "survival" | "creative" | "adventure" | "spectator";

export interface PlayerInput {
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface Effect {
  kind: StatusEffect;
  ticks: number;
  amp: number;
}

export type PlayerEvent =
  | { type: "hurt"; source: DamageSource; amount: number }
  | { type: "death"; source: DamageSource; message: string }
  | { type: "levelup"; level: number }
  | { type: "land"; distance: number; block: number }
  | { type: "splash" }
  | { type: "jump" }
  | { type: "eat"; item: number };

export interface SurvivalRules {
  difficulty: 0 | 1 | 2 | 3;
  naturalRegeneration: boolean;
  raining: boolean;
}

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
export const SNEAK_HEIGHT = 1.5;
export const SNEAK_EYE = 1.27;
export const GLIDE_HEIGHT = 0.6;
export const GLIDE_EYE = 0.4;

/** Points needed to go from `level` to the next. */
export function xpToNext(level: number): number {
  return level >= 30 ? 112 + (level - 30) * 9 : level >= 15 ? 37 + (level - 15) * 5 : 7 + level * 2;
}

const DEATH_MESSAGES: Record<DamageSource, string> = {
  mob: "was slain", arrow: "was shot", explosion: "blew up", fall: "hit the ground too hard", fire: "burned to death",
  lava: "tried to swim in lava", drown: "drowned", starve: "starved to death", void: "fell out of the world",
  cactus: "was pricked to death", player: "was slain", magic: "died", suffocation: "suffocated in a wall",
  wither: "withered away", fireball: "was fireballed", fly_into_wall: "experienced kinetic energy", vehicle: "was run over",
  thirst: "died of thirst", cold: "froze to death", heat: "succumbed to the heat", bleeding: "bled out", sickness: "died of a fever", infection: "succumbed to the infection",
};

/** Elytra: flight wears it a point a second, and at one point from breaking it will no longer open. */
export function elytraUsable(stack: ItemStack | null): boolean {
  if (!stack || itemDef(stack.id)?.armor?.material !== "elytra") return false;
  return (stack.damage ?? 0) < (itemDef(stack.id)?.durability ?? 0) - 1;
}

export class Player {
  body: Body;
  yaw = 0;
  pitch = 0;
  prevX: number; prevY: number; prevZ: number;
  inventory = new Inventory();
  health = 20;
  food = 20;
  saturation = 5;
  exhaustion = 0;
  air = 300;
  xpLevel = 0;
  xpPoints = 0;
  /** Experience collected since the last death — the death screen's score. */
  score = 0;
  /** Advancement ids earned in this world; kept with the player so a guest's travel in the host's save. */
  advancements = new Set<string>();
  /** Whether this player has been shown the poem after the dragon (once, the first time home). */
  poemSeen = false;
  /** Places this player marked (engine/waypoints.ts). */
  waypoints: Waypoint[] = [];
  /** The waystones this player has found and so may travel to, by their key ("dim:x,y,z"). */
  waystones = new Set<string>();
  gameMode: GameMode = "survival";
  flying = false;
  spawn: { x: number; y: number; z: number } | null = null;
  hurtTime = 0;
  invulnerable = 0;
  private lastDamage = 0;
  dead = false;
  deathTime = 0;
  deathMessage = "";
  fireTicks = 0;
  private foodTimer = 0;
  effects: Effect[] = [];
  /** Thirst, body temperature and wounds, where a mode keeps them (engine/vitals.ts). */
  vitals: Vitals = freshVitals();
  /** Primal's engrams this player has learned (engine/engrams.ts). */
  engrams = new Set<string>();
  /** The monster-collecting modes: this player's critters, badges, field guide and coins (engine/critters.ts). */
  card: TrainerCard = freshCard();
  /** Dollars: the city's money and the casino's (play money, earned and lost in game). */
  cash = 0;
  /** Ashgrove County: who this player was before (engine/survivors.ts), or null until they have chosen. */
  survivor: Survivor | null = null;
  /** What that past does to them; the ordinary player's when there is none. */
  perks: Perks = perksOf(null);

  setSurvivor(s: Survivor | null): void {
    this.survivor = s;
    this.perks = perksOf(s);
  }
  /** The city modes: wanted stars, as the host last told this player (not saved: the heat dies with the session). */
  wanted = 0;
  /** Chance source for Unbreaking and Respiration; tests pin it. */
  rng: () => number = Math.random;
  /**
   * Seeds the enchanting table's offers. It changes only when the player
   * enchants, so closing and reopening the table cannot re-roll a bad offer.
   */
  enchantSeed = Math.floor(Math.random() * 0x7fffffff);
  /** The vehicle being ridden (entity id), or null. */
  riding: number | null = null;
  sneaking = false;
  sprinting = false;
  /** Ticks since the last swing; the attack meter charges back up over 1 / attackSpeed seconds. */
  attackTicks = 100;
  walkDist = 0;
  prevWalkDist = 0;
  sleeping: { x: number; y: number; z: number } | null = null;
  sleepTicks = 0;
  events: PlayerEvent[] = [];
  /** Flying on elytra. */
  gliding = false;
  /** Ticks of firework thrust left. */
  boostTicks = 0;
  private jumpHeld = false;
  private glideTicks = 0;

  constructor(public readonly id: string, public name: string, x = 0, y = 80, z = 0) {
    this.body = newBody(x, y, z, PLAYER_WIDTH, PLAYER_HEIGHT, EYE_HEIGHT);
    this.prevX = x; this.prevY = y; this.prevZ = z;
  }

  get survivalLike(): boolean {
    return this.gameMode === "survival" || this.gameMode === "adventure";
  }
  get canFly(): boolean {
    return this.gameMode === "creative" || this.gameMode === "spectator";
  }
  get eyeY(): number {
    return this.body.y + this.body.eyeHeight;
  }
  get armor(): number {
    return this.inventory.armorPoints();
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
    this.body.noClip = mode === "spectator";
    if (mode === "spectator") this.flying = true;
    else if (!this.canFly) this.flying = false;
    if (!this.survivalLike) { this.fireTicks = 0; this.air = 300; }
  }

  /** Attack strength 0..1 from the swing cooldown (the 1.9+ combat meter). */
  attackStrength(): number {
    const held = this.inventory.held;
    const speed = held ? itemDef(held.id)?.attackSpeed ?? 4 : 4;
    const cooldown = 20 / speed;
    return Math.min(1, (this.attackTicks + 0.5) / cooldown);
  }

  addEffect(kind: StatusEffect, seconds: number, amp = 0): void {
    const existing = this.effects.find((e) => e.kind === kind);
    if (existing) { existing.ticks = Math.max(existing.ticks, seconds * 20); existing.amp = Math.max(existing.amp, amp); }
    else this.effects.push({ kind, ticks: seconds * 20, amp });
  }

  hasEffect(kind: StatusEffect): boolean {
    return this.effects.some((e) => e.kind === kind);
  }

  /** The amplifier of an active effect (0 is level I), or -1 when it is not active. */
  effectLevel(kind: StatusEffect): number {
    return this.effects.find((e) => e.kind === kind)?.amp ?? -1;
  }

  /**
   * An effect from a potion or a splash: instant ones act now (healing heals
   * 4 per level, harming hurts 6 per level), the rest are added as timed effects.
   */
  applyEffect(kind: StatusEffect, seconds: number, amp = 0): void {
    if (kind === "instant_health") { this.heal(4 << amp); return; }
    if (kind === "instant_damage") { this.hurt(6 << amp, "magic"); return; }
    if (seconds > 0) this.addEffect(kind, seconds, amp);
  }

  /** Melee damage added (Strength) or taken away (Weakness) by effects. */
  get meleeBonus(): number {
    const s = this.effectLevel("strength"), w = this.effectLevel("weakness");
    return (s >= 0 ? 3 * (s + 1) : 0) - (w >= 0 ? 4 * (w + 1) : 0);
  }

  addExhaustion(n: number): void {
    if (this.survivalLike) this.exhaustion = Math.min(40, this.exhaustion + n * this.perks.hunger);
  }

  heal(n: number): void {
    if (this.dead) return;
    this.health = Math.min(20, this.health + n);
  }

  canEat(food: FoodInfo): boolean {
    return !this.survivalLike || this.food < 20 || !!food.alwaysEdible;
  }

  eat(item: ItemStack, random: () => number): void {
    const food = itemDef(item.id)?.food;
    if (!food) return;
    this.food = Math.min(20, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
    if (food.effect && random() < food.effect[2]) this.addEffect(food.effect[0], food.effect[1], 0);
    if (itemDef(item.id)?.name === "golden_apple") this.addEffect("absorption", 120, 0);
    this.events.push({ type: "eat", item: item.id });
  }

  addXp(points: number): void {
    if (points > 0) this.score += points;
    this.xpPoints += points;
    while (this.xpPoints >= xpToNext(this.xpLevel)) {
      this.xpPoints -= xpToNext(this.xpLevel);
      this.xpLevel++;
      if (this.xpLevel % 5 === 0) this.events.push({ type: "levelup", level: this.xpLevel });
    }
  }

  get xpProgress(): number {
    return this.xpPoints / xpToNext(this.xpLevel);
  }

  /** Pays whole levels (enchanting, the anvil), keeping progress into the current level. */
  spendLevels(n: number): void {
    this.xpLevel = Math.max(0, this.xpLevel - n);
  }

  /** Experience dropped on death: 7 per level, capped at 100. */
  deathXp(): number {
    return Math.min(100, this.xpLevel * 7);
  }

  /**
   * Takes damage after armour. Returns the damage actually dealt (0 if
   * ignored: creative, invulnerable, or a weaker hit during the immunity window).
   */
  hurt(amount: number, source: DamageSource, fromX?: number, fromZ?: number, knockback = 0): number {
    if (this.dead || amount <= 0) return 0;
    if (!this.survivalLike && source !== "void") return 0;
    if (this.sleeping) this.sleeping = null;
    if ((source === "fire" || source === "lava" || source === "fireball") && this.hasEffect("fire_resistance")) return 0;
    let dealt = amount;
    if (this.invulnerable > 10) {
      if (amount <= this.lastDamage) return 0;
      dealt = amount - this.lastDamage;
    }
    const armored = source !== "fall" && source !== "drown" && source !== "starve" && source !== "void" && source !== "fire" && source !== "magic" && source !== "suffocation" && source !== "wither"
      && source !== "thirst" && source !== "cold" && source !== "heat" && source !== "bleeding" && source !== "sickness" && source !== "infection";
    if (armored) {
      const armor = this.inventory.armorPoints();
      const tough = this.inventory.armorToughness();
      const reduced = Math.min(20, Math.max(armor / 5, armor - dealt / (2 + tough / 4)));
      dealt *= 1 - reduced / 25;
      const wear = Math.max(1, Math.floor(amount / 4));
      this.inventory.armor = this.inventory.armor.map((a) => {
        // Elytra are not armour: blows do not wear them, only flight does.
        if (!a || itemDef(a.id)?.armor?.material === "elytra" || !wears(a, this.rng, true)) return a;
        const max = itemDef(a.id)?.durability ?? 0;
        const damage = (a.damage ?? 0) + wear;
        return max && damage >= max ? null : { ...a, damage };
      });
    }
    // Protection enchantments stack on top of the armour, up to 80% off.
    const epf = protectionFactor(this.inventory.armor, source);
    if (epf > 0) dealt *= 1 - epf / 25;
    // Absorption hearts (golden apple) soak damage first.
    const absorb = this.effects.find((e) => e.kind === "absorption");
    if (absorb) {
      const pool = 4 * (absorb.amp + 1);
      const used = Math.min(pool, dealt);
      dealt -= used;
      if (used >= pool) this.effects = this.effects.filter((e) => e !== absorb);
    }
    this.lastDamage = amount;
    this.invulnerable = 20;
    this.hurtTime = 10;
    this.addExhaustion(0.1);
    if (dealt > 0) this.health -= dealt;
    if (fromX !== undefined && fromZ !== undefined && knockback > 0) {
      const dx = this.body.x - fromX, dz = this.body.z - fromZ;
      const d = Math.hypot(dx, dz) || 1;
      this.body.vx = this.body.vx / 2 + (dx / d) * knockback;
      this.body.vz = this.body.vz / 2 + (dz / d) * knockback;
      if (this.body.onGround) this.body.vy = Math.min(0.4, this.body.vy / 2 + knockback);
    }
    this.events.push({ type: "hurt", source, amount: dealt });
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathTime = 0;
      this.deathMessage = `${this.name} ${DEATH_MESSAGES[source]}`;
      this.events.push({ type: "death", source, message: this.deathMessage });
    }
    return dealt;
  }

  respawn(x: number, y: number, z: number): void {
    this.dead = false;
    this.score = 0;
    this.deathTime = 0;
    this.health = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.fireTicks = 0;
    this.effects = [];
    this.gliding = false;
    // Death takes the thirst and the wounds with it; what you learned stays.
    this.vitals = freshVitals();
    this.body.x = x; this.body.y = y; this.body.z = z;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
    this.prevX = x; this.prevY = y; this.prevZ = z;
    this.invulnerable = 60;
  }

  beginTick(): void {
    this.prevX = this.body.x; this.prevY = this.body.y; this.prevZ = this.body.z;
    this.prevWalkDist = this.walkDist;
  }

  /**
   * A tick spent riding: the vehicle does the moving (the game seats the
   * player on it), but breath, fire, hunger and effects run as usual.
   */
  tickRiding(world: BlockReader, rules: SurvivalRules): void {
    if (this.dead) { this.deathTime++; return; }
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
    this.attackTicks++;
    this.sneaking = false;
    this.sprinting = false;
    this.gliding = false;
    const b = this.body;
    b.height = PLAYER_HEIGHT;
    b.eyeHeight = EYE_HEIGHT;
    b.vx = b.vy = b.vz = 0;
    b.fallDistance = 0;
    // Nothing moved the body this tick, so sense the water and lava around the seat directly.
    senseEnvironment(world, b);
    this.environment(world, rules);
    this.metabolism(rules);
    this.tickEffects();
  }

  tick(world: BlockReader, input: PlayerInput, rules: SurvivalRules): void {
    if (this.dead) { this.deathTime++; return; }
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
    this.attackTicks++;

    if (this.sleeping) {
      this.sleepTicks++;
      input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    }

    // Sneaking shrinks the hitbox; standing back up needs headroom.
    const b = this.body;
    // A fresh press of jump in mid-fall opens the elytra; land, swim, fly or break it and it folds.
    const jumpPressed = input.jump && !this.jumpHeld;
    this.jumpHeld = input.jump;
    const elytra = elytraUsable(this.inventory.armor[1]);
    if (this.gliding && (b.onGround || b.inWater || b.inLava || this.flying || !elytra || b.onLadder)) this.gliding = false;
    else if (!this.gliding && jumpPressed && elytra && !b.onGround && !b.inWater && !b.inLava && !this.flying && !b.onLadder) {
      this.gliding = true;
      this.glideTicks = 0;
    }
    if (!this.gliding) this.boostTicks = 0;
    this.sneaking = input.sneak && !this.flying && !b.inWater && !this.gliding;
    // Gliding, the body lies flat and only 0.6 tall: it fits through a one-block gap.
    const wantHeight = this.gliding ? GLIDE_HEIGHT : this.sneaking ? SNEAK_HEIGHT : PLAYER_HEIGHT;
    if (wantHeight > b.height) {
      const hx = Math.floor(b.x), hy = Math.floor(b.y + PLAYER_HEIGHT - 0.01), hz = Math.floor(b.z);
      if (!block(Math.max(0, world.getBlock(hx, hy, hz))).solid) b.height = wantHeight;
    } else b.height = wantHeight;
    b.eyeHeight = b.height === PLAYER_HEIGHT ? EYE_HEIGHT : b.height === GLIDE_HEIGHT ? GLIDE_EYE : SNEAK_EYE;

    const canSprint = !this.survivalLike || this.food > 6;
    if (input.sprint && input.forward > 0.5 && canSprint && !this.sneaking) this.sprinting = true;
    if (input.forward <= 0.5 || this.sneaking || !canSprint || (b.collidedH && !this.flying)) this.sprinting = false;

    const wasInWater = b.inWater;
    const swift = this.effectLevel("speed"), slow = this.effectLevel("slowness");
    const speedBoost = Math.max(0, (1 + (swift >= 0 ? 0.2 * (swift + 1) : 0)) * (1 - (slow >= 0 ? 0.15 * (slow + 1) : 0)));
    let res;
    if (this.gliding) {
      const g = glide(world, b, this.yaw, this.pitch, this.boostTicks > 0);
      if (this.boostTicks > 0) this.boostTicks--;
      if (g.wallHit > 0 && this.survivalLike) this.hurt(g.wallHit, "fly_into_wall");
      // A point of wear a second in the air, spared by Unbreaking.
      if (++this.glideTicks % 20 === 0 && this.survivalLike) {
        const e = this.inventory.armor[1];
        if (e && wears(e, this.rng, false)) this.inventory.armor[1] = { ...e, damage: (e.damage ?? 0) + 1 };
      }
      res = g;
    } else {
      res = travel(world, b, {
        forward: input.forward, strafe: input.strafe, yaw: this.yaw, jump: input.jump, sneak: input.sneak,
        sprint: this.sprinting, flying: this.flying, speed: 0.1 * speedBoost * this.perks.speed,
        levitation: this.flying ? 0 : this.effectLevel("levitation") + 1,
      });
    }
    if (!wasInWater && b.inWater && b.vy < -0.3) this.events.push({ type: "splash" });
    this.walkDist += res.moved;
    if (res.jumped) {
      this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      this.events.push({ type: "jump" });
    }
    if (this.sprinting) this.addExhaustion(0.1 * res.moved);
    else if (b.inWater) this.addExhaustion(0.01 * res.moved);
    if (b.onGround && this.flying && this.gameMode !== "spectator") this.flying = false;

    if (res.landedFrom > 0) {
      const ground = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
      this.events.push({ type: "land", distance: res.landedFrom, block: ground });
      if (res.landedFrom > 3 && this.survivalLike) {
        const soft = ground === B.HAY ? 0.2 : ground === B.WATER ? 0 : 1;
        const dmg = Math.ceil((res.landedFrom - 3) * soft);
        if (dmg > 0) this.hurt(dmg, "fall");
      }
    }
    if (this.dead) return;
    this.environment(world, rules);
    this.metabolism(rules);
    this.tickEffects();
  }

  /** Ticks counted for damage that comes in beats (fire, magma). */
  private envTicks = 0;

  private environment(world: BlockReader, rules: SurvivalRules): void {
    const b = this.body;
    if (!this.survivalLike) return;
    this.envTicks++;
    if (b.eyesInWater && !this.hasEffect("water_breathing")) {
      // Respiration: each level is another chance the breath is not spent.
      const resp = levelOf(this.inventory.armor[0], "respiration");
      if (!resp || this.rng() >= resp / (resp + 1)) this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2, "drown"); }
    } else this.air = Math.min(300, this.air + 5);
    if (b.inLava) {
      this.fireTicks = 300;
      this.hurt(4, "lava");
    }
    if (b.inWater || (rules.raining && this.fireTicks > 0 && this.skyAbove(world))) this.fireTicks = 0;
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.fireTicks % 20 === 0) this.hurt(1, "fire");
    }
    if (b.y < -40) this.hurt(4, "void");
    // Cactus pricks on contact, sides included; fire burns whoever stands in it.
    const x0 = Math.floor(b.x - 0.35), x1 = Math.floor(b.x + 0.35), z0 = Math.floor(b.z - 0.35), z1 = Math.floor(b.z + 0.35);
    let burning = false;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (world.getBlock(x, Math.floor(b.y + 0.2), z) === B.CACTUS || world.getBlock(x, Math.floor(b.y - 0.1), z) === B.CACTUS) {
        this.hurt(1, "cactus");
      }
      const feet = world.getBlock(x, Math.floor(b.y + 0.1), z), knees = world.getBlock(x, Math.floor(b.y + 0.9), z);
      if (feet === B.FIRE || feet === B.SOUL_FIRE || knees === B.FIRE || knees === B.SOUL_FIRE) burning = true;
    }
    if (burning) {
      this.fireTicks = Math.max(this.fireTicks, 160);
      if (this.envTicks % 10 === 0) this.hurt(1, "fire");
    }
    // A magma block burns the feet of anyone not sneaking across it.
    if (b.onGround && !this.sneaking && world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z)) === B.MAGMA_BLOCK
      && !this.hasEffect("fire_resistance") && this.envTicks % 10 === 0) {
      this.hurt(1, "fire");
    }
    const head = world.getBlock(Math.floor(b.x), Math.floor(this.eyeY), Math.floor(b.z));
    if (head > 0 && block(head).opaque && !b.noClip) this.hurt(1, "suffocation");
  }

  private skyAbove(world: BlockReader): boolean {
    const x = Math.floor(this.body.x), z = Math.floor(this.body.z);
    for (let y = Math.floor(this.eyeY) + 1; y < 128; y++) {
      const id = world.getBlock(x, y, z);
      if (id > 0 && block(id).solid) return false;
    }
    return true;
  }

  private metabolism(rules: SurvivalRules): void {
    if (!this.survivalLike) return;
    if (rules.difficulty === 0) {
      // Peaceful: hunger and health refill on their own.
      if (this.foodTimer++ % 20 === 0) {
        if (this.health < 20) this.heal(1);
        if (this.food < 20) this.food++;
      }
      return;
    }
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    const regen = rules.naturalRegeneration;
    if (regen && this.saturation > 0 && this.health < 20 && this.food >= 20) {
      if (++this.foodTimer >= 10 / this.perks.heal) {
        const s = Math.min(this.saturation, 6);
        this.heal(s / 6);
        this.addExhaustion(s);
        this.foodTimer = 0;
      }
    } else if (regen && this.food >= 18 && this.health < 20) {
      if (++this.foodTimer >= 80 / this.perks.heal) {
        this.heal(1);
        this.addExhaustion(6);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      if (++this.foodTimer >= 80) {
        if (this.health > 10 || rules.difficulty === 3 || (this.health > 1 && rules.difficulty === 2)) this.hurt(1, "starve");
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
  }

  private tickEffects(): void {
    for (const e of this.effects) {
      e.ticks--;
      if (e.kind === "regeneration" && e.ticks % Math.max(1, 50 >> e.amp) === 0) this.heal(1);
      if (e.kind === "poison" && e.ticks % Math.max(1, 25 >> e.amp) === 0 && this.health > 1) this.hurt(1, "magic");
      // Wither, unlike poison, does not stop at half a heart.
      if (e.kind === "wither" && e.ticks % Math.max(1, 40 >> e.amp) === 0) this.hurt(1, "wither");
      if (e.kind === "hunger") this.addExhaustion(0.005 * (e.amp + 1));
    }
    this.effects = this.effects.filter((e) => e.ticks > 0);
  }

  toJSON(): PlayerSave {
    const b = this.body;
    return {
      x: b.x, y: b.y, z: b.z, yaw: this.yaw, pitch: this.pitch, health: this.health, food: this.food,
      saturation: this.saturation, exhaustion: this.exhaustion, air: this.air, xpLevel: this.xpLevel, xpPoints: this.xpPoints,
      gameMode: this.gameMode, flying: this.flying, spawn: this.spawn, inventory: this.inventory.toJSON(), effects: this.effects,
      fireTicks: this.fireTicks, dead: this.dead, score: this.score, advancements: [...this.advancements],
      enchantSeed: this.enchantSeed, poem: this.poemSeen || undefined,
      waypoints: this.waypoints.length ? this.waypoints : undefined,
      waystones: this.waystones.size ? [...this.waystones] : undefined,
      vitals: this.vitals,
      engrams: this.engrams.size ? [...this.engrams] : undefined,
      // Only once they have a critter: a world that never had any keeps its saves as they were.
      card: this.card.party.length || this.card.box.length || this.card.starter ? this.card : undefined,
      cash: this.cash || undefined,
      survivor: this.survivor ?? undefined,
    };
  }

  load(s: Partial<PlayerSave>): void {
    const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
    this.body.x = num(s.x, this.body.x); this.body.y = num(s.y, this.body.y); this.body.z = num(s.z, this.body.z);
    this.prevX = this.body.x; this.prevY = this.body.y; this.prevZ = this.body.z;
    this.yaw = num(s.yaw, 0); this.pitch = num(s.pitch, 0);
    this.health = Math.max(0, Math.min(20, num(s.health, 20)));
    this.food = Math.max(0, Math.min(20, num(s.food, 20)));
    this.saturation = num(s.saturation, 5); this.exhaustion = num(s.exhaustion, 0);
    this.air = num(s.air, 300); this.xpLevel = num(s.xpLevel, 0); this.xpPoints = num(s.xpPoints, 0); this.score = num(s.score, 0);
    this.advancements = new Set(Array.isArray(s.advancements) ? s.advancements.filter((a): a is string => typeof a === "string") : []);
    this.poemSeen = s.poem === true;
    this.waypoints = sanitizeWaypoints(s.waypoints);
    this.waystones = new Set(Array.isArray(s.waystones) ? s.waystones.filter((k): k is string => typeof k === "string").slice(0, 256) : []);
    this.setGameMode(s.gameMode ?? "survival");
    this.flying = !!s.flying && this.canFly;
    this.spawn = s.spawn ?? null;
    this.inventory.load(s.inventory);
    this.effects = Array.isArray(s.effects) ? s.effects.filter((e) => e && typeof e.ticks === "number") : [];
    this.fireTicks = num(s.fireTicks, 0);
    this.enchantSeed = num(s.enchantSeed, this.enchantSeed);
    this.vitals = sanitizeVitals(s.vitals);
    this.engrams = new Set(Array.isArray(s.engrams) ? s.engrams.filter((e): e is string => typeof e === "string").slice(0, 128) : []);
    this.card = sanitizeCard(s.card);
    this.setSurvivor(sanitizeSurvivor(s.survivor));
    this.cash = typeof s.cash === "number" && Number.isFinite(s.cash) ? Math.max(0, Math.min(999_999_999, Math.floor(s.cash))) : 0;
    if (s.dead || this.health <= 0) { this.dead = true; this.health = 0; }
  }
}

export interface PlayerSave {
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; food: number; saturation: number; exhaustion: number; air: number;
  xpLevel: number; xpPoints: number; gameMode: GameMode; flying: boolean;
  spawn: { x: number; y: number; z: number } | null;
  inventory: ReturnType<Inventory["toJSON"]>;
  effects: Effect[];
  fireTicks: number;
  dead: boolean;
  score?: number;
  advancements?: string[];
  enchantSeed?: number;
  /** The poem after the dragon has been shown to this player. */
  poem?: boolean;
  waypoints?: Waypoint[];
  waystones?: string[];
  vitals?: Vitals;
  engrams?: string[];
  card?: TrainerCard;
  cash?: number;
  survivor?: Survivor;
}
