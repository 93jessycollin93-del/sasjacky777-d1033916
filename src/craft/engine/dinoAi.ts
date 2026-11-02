/**
 * How Primal's creatures behave (engine/creatures.ts says who they are).
 *
 * Wild, each keeps to its temper: a dodo ignores you, a parasaur bolts, a
 * trike warns you off at close range, a bronto only fights back, and a
 * raptor or a rex hunts — players, and the smaller creatures around it. A
 * dilophosaur spits blinding venom; a raptor pounces; a pteranodon glides.
 *
 * Every one of them carries torpor. Past its limit it drops, and lies there
 * while the torpor drains away; feed it then and it may be yours. Tamed, it
 * follows its owner or waits where told, fights whatever its owner fights,
 * and — saddled — carries its owner wherever they steer it.
 *
 * These are free functions over a Mob rather than methods on it, to keep
 * mobs.ts to the mobs every world has; mobs.ts calls them for any creature.
 */
import type { EntityContext, PlayerRef } from "./entities";
import type { Mob } from "./mobs";
import { travel, moveBody, senseEnvironment } from "./physics";
import { itemByName, type ItemStack } from "./items";
import {
  bonusLevels, CREATURES, damageScale, diet, foodPoints, HIT_PENALTY, isDino, maxTorpor, tameCost, torporDecay, TORPOR, type DinoKind,
} from "./creatures";
import { SPECIES } from "./critters";

type Move = { forward: number; jump: boolean; yaw: number; speedMul: number };

const creature = (m: Mob) => CREATURES[m.kind as DinoKind];

/** How hard this creature bites, at its level. */
export function attackPower(m: Mob): number {
  return m.spec.attack * damageScale(m.level);
}

// ---- torpor ----------------------------------------------------------------------------------

/** Adds torpor from a tranquilizer, a club or a fist; enough, and the creature drops. */
export function addTorpor(m: Mob, ctx: EntityContext, amount: number, by?: string): void {
  if (!isDino(m.kind) || m.owner || m.dying || amount <= 0) return;
  const max = maxTorpor(m.kind, m.level);
  m.torpor = Math.min(max * 1.5, m.torpor + amount);
  if (by) m.lastAttacker = by;
  if (!m.unconscious && m.torpor >= max) {
    m.unconscious = true;
    m.targetId = null;
    m.targetMob = null;
    m.anger = 0;
    m.panic = 0;
    // Down for a tame, it stays in the world however far its hunter wanders.
    m.persistent = true;
    ctx.sound(`${m.kind}_death`, m.x, m.y + 0.5, m.z, 0.6, 0.7);
    ctx.particles("poof", m.x, m.y + m.body.height, m.z, 6);
  }
}

/**
 * Before any behaviour: torpor drains; an unconscious creature only lies
 * there (and wakes when its torpor is gone); a ridden one goes where its rider
 * steers. Returns true when that was the whole tick.
 */
export function dinoTick(m: Mob, ctx: EntityContext): boolean {
  const max = maxTorpor(m.kind as DinoKind, m.level);
  if (m.torpor > 0) m.torpor = Math.max(0, m.torpor - (max * torporDecay(m.unconscious)) / 20);
  const b = m.body;
  if (m.unconscious) {
    if (m.torpor <= 0) {
      m.unconscious = false;
      m.taming = 0;
      m.tameEffect = 1;
      // It wakes as it went down: angry, if anyone was fighting it.
      if (m.lastAttacker && !m.lastAttacker.startsWith("mob:")) { m.targetId = m.lastAttacker; m.anger = 400; }
      ctx.sound(`${m.kind}_idle`, b.x, b.y + 1, b.z, 1);
      return false;
    }
    b.vx *= 0.5; b.vz *= 0.5;
    if (m.spec.flies) {
      // A flyer knocked out falls out of the sky.
      b.vy -= 0.08;
      senseEnvironment(ctx.world, b);
      moveBody(ctx.world, b, b.vx, b.vy, b.vz);
      if (b.onGround) b.vy = 0;
    } else travel(ctx.world, b, { forward: 0, strafe: 0, yaw: m.yaw, jump: false, sneak: false, sprint: false, flying: false, speed: 0 });
    if (m.age % 40 === 0) ctx.particles("note", b.x, b.y + b.height + 0.4, b.z, 1);
    m.environment(ctx);
    return true;
  }
  if (m.rider) {
    if (!ctx.players().some((p) => p.id === m.rider)) m.rider = null;
    else { rideTick(m, ctx); return true; }
  }
  return false;
}

/** A saddled creature under its rider: the rider's keys, the creature's legs (or wings). */
export function rideTick(m: Mob, ctx: EntityContext): void {
  const b = m.body, inp = m.input;
  m.yaw = inp.yaw;
  const speed = m.spec.speed * 1.6;
  if (m.spec.flies) {
    const pitch = inp.pitch ?? 0;
    const f = inp.forward;
    const air = speed * 3;
    b.vx += -Math.sin(inp.yaw) * Math.cos(pitch) * f * air;
    b.vz += -Math.cos(inp.yaw) * Math.cos(pitch) * f * air;
    b.vy += Math.sin(pitch) * f * air + (inp.jump ? 0.05 : 0) - 0.012;
    senseEnvironment(ctx.world, b);
    moveBody(ctx.world, b, b.vx, b.vy, b.vz);
    b.vx *= 0.9; b.vy *= 0.9; b.vz *= 0.9;
    b.fallDistance = 0;
  } else {
    const res = travel(ctx.world, b, {
      forward: inp.forward, strafe: inp.strafe * 0.6, yaw: inp.yaw, jump: !!inp.jump, sneak: false, sprint: true, flying: false, speed, floats: true,
    });
    m.walkDist += res.moved;
    b.fallDistance = 0;
    return;
  }
  m.walkDist += Math.hypot(b.x - m.prevX, b.z - m.prevZ);
}

// ---- behaviour ---------------------------------------------------------------------------------

export function dinoAi(m: Mob, ctx: EntityContext, move: Move): void {
  if (m.owner) { companion(m, ctx, move); return; }
  const c = creature(m);
  if (m.spec.flies) { glide(m, ctx, move); return; }
  if (m.anger > 0) m.anger--;
  switch (c.temper) {
    case "aggressive": hunt(m, ctx, move); break;
    case "territorial": {
      // Too close, standing tall, and it lowers its horns.
      if (m.anger <= 0 && m.age % 10 === 0) {
        const near = m.nearestPlayer(ctx, 4, (p) => p.targetable && !p.sneaking);
        if (near) { m.targetId = near.id; m.anger = 200; ctx.sound(`${m.kind}_idle`, m.x, m.y + 1, m.z, 1, 0.8); }
      }
      if (m.anger > 0 && charge(m, ctx, move, 1.3)) return;
      m.passiveAi(ctx, move);
      break;
    }
    case "neutral":
      if (m.anger > 0 && charge(m, ctx, move, 1.4)) return;
      m.passiveAi(ctx, move);
      move.speedMul *= m.panic > 0 ? 1 : 0.7;
      break;
    case "skittish": {
      const b = m.body;
      const threat = m.panic <= 0 && m.age % 5 === 0 ? m.nearestPlayer(ctx, 10, (p) => p.targetable && !p.sneaking) : null;
      if (threat) {
        const a = Math.atan2(b.z - threat.z, b.x - threat.x) + (ctx.random() - 0.5) * 0.6;
        m.wander = { x: b.x + Math.cos(a) * 14, z: b.z + Math.sin(a) * 14, ticks: 50 };
        m.panic = 40;
      }
      m.passiveAi(ctx, move);
      break;
    }
    default:
      m.passiveAi(ctx, move);
  }
}

/** Runs at whoever angered it and strikes; false once it has given up. */
function charge(m: Mob, ctx: EntityContext, move: Move, speed: number): boolean {
  const t = m.targetId ? ctx.players().find((p) => p.id === m.targetId && p.targetable) : undefined;
  if (!t || Math.hypot(t.x - m.x, t.z - m.z) > m.spec.followRange * 1.5) { m.anger = 0; return false; }
  strike(m, ctx, move, t, speed);
  return true;
}

/** Closes on a player and bites when in reach; big creatures reach further. */
function strike(m: Mob, ctx: EntityContext, move: Move, t: PlayerRef, speed: number): void {
  const b = m.body;
  m.steer(ctx, move, t.x, t.z, false);
  move.speedMul = speed;
  const d = Math.hypot(t.x - b.x, t.z - b.z);
  const reach = (b.width + t.width) / 2 + 0.8 + b.width * 0.15;
  if (d < reach && Math.abs(t.y - b.y) < Math.max(2, b.height * 0.8) && m.attackCooldown <= 0) {
    m.attackCooldown = m.kind === "rex" || m.kind === "bronto" ? 30 : 20;
    m.bite(ctx, t, attackPower(m));
  }
}

/** The hunters: players first, and when there are none, prey. */
function hunt(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  if (m.age % 20 === 0) {
    const cur = m.targetId ? ctx.players().find((p) => p.id === m.targetId) : undefined;
    if (!cur || !cur.targetable || Math.hypot(cur.x - b.x, cur.z - b.z) > m.spec.followRange * 1.3) {
      const seen = m.nearestPlayer(ctx, m.spec.followRange, (p) => p.targetable);
      const had = m.targetId;
      m.targetId = seen && m.canSee(ctx, seen) ? seen.id : null;
      if (m.targetId && m.targetId !== had && m.kind === "rex") ctx.sound("rex_roar", b.x, b.y + 2, b.z, 2);
    }
  }
  const t = m.targetId ? ctx.players().find((p) => p.id === m.targetId && p.targetable) : undefined;
  if (t) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    // A dilophosaur spits from a few blocks off; the venom blinds.
    if (m.kind === "dilo" && d > 3 && d < 9 && m.attackCooldown <= 0 && m.canSee(ctx, t)) {
      m.attackCooldown = 70;
      ctx.effectPlayer?.(t.id, "blindness", 5, 0);
      ctx.particles("slime", t.x, t.y + 1.5, t.z, 8);
      ctx.sound("dilo_spit", b.x, b.y + 1, b.z, 1);
    }
    // A raptor leaps the last few blocks.
    if (m.kind === "raptor" && d > 2.5 && d < 5.5 && b.onGround && ctx.random() < 0.08) {
      b.vx += ((t.x - b.x) / d) * 0.45; b.vz += ((t.z - b.z) / d) * 0.45; b.vy = 0.45;
    }
    strike(m, ctx, move, t, 1.25);
    return;
  }
  // Nobody to hunt: now and then a smaller creature nearby.
  if (m.age % 60 === 0 && m.targetMob === null && ctx.random() < 0.3) {
    const prey = ctx.entitiesNear(b.x, b.y, b.z, 16)
      .map((e) => m.asMob(e))
      .find((e): e is Mob => !!e && e !== m && !e.dying && !e.unconscious && e.maxHealth < m.maxHealth && !e.spec.hostile && e.kind !== "villager" && e.kind !== "iron_golem" && !e.owner);
    if (prey) m.targetMob = prey.id;
  }
  const prey = m.mobTarget(ctx, 24);
  if (prey) { m.fightMob(ctx, move, prey, attackPower(m)); move.speedMul = 1.2; return; }
  m.wanderAi(ctx, move, 1 / 100);
  if (ctx.random() < 1 / 500) ctx.sound(`${m.kind}_idle`, b.x, b.y + 1, b.z, 1);
}

/** A wild pteranodon: long glides between points in the sky, rising away from anyone who hurts it. */
function glide(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  const ground = ctx.world.topSolid(Math.floor(b.x), Math.floor(b.z));
  if (!m.flyTo || ctx.random() < 1 / 200 || Math.hypot(m.flyTo.x - b.x, m.flyTo.y - b.y, m.flyTo.z - b.z) < 3) {
    const alt = Math.max(ground, 62) + 12 + ctx.random() * 16 + (m.panic > 0 ? 12 : 0);
    m.pickFlyTo(ctx, b.x, alt, b.z, 24);
    m.flyTo!.y = alt;
  }
  if (m.panic > 0) m.panic--;
  m.flyToward(m.flyTo!.x, m.flyTo!.y, m.flyTo!.z, 0.012, m.panic > 0 ? 0.35 : 0.22);
  move.yaw = Math.atan2(-b.vx, -b.vz);
  if (ctx.random() < 1 / 400) ctx.sound("ptero_idle", b.x, b.y, b.z, 1);
}

/**
 * Tamed: it follows its owner (or waits where told), comes to their side
 * when left far behind, and fights whatever fights them or whatever they
 * strike.
 */
function companion(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  let owner = ctx.players().find((p) => p.id === m.owner) ?? null;
  if (!owner && m.ownerName && m.age % 40 === 0) {
    owner = ctx.players().find((p) => p.name === m.ownerName) ?? null;
    if (owner) m.owner = owner.id;
  }
  if (m.sitting) {
    if (owner) move.yaw = m.faceTo(owner.x, owner.z);
    if (m.spec.flies) { b.vx *= 0.8; b.vz *= 0.8; b.vy = Math.max(b.vy - 0.04, -0.4); }
    return;
  }
  if (m.age % 20 === 0 && m.targetMob === null && owner) {
    const foe = ctx.entitiesNear(b.x, b.y, b.z, 16)
      .map((e) => m.asMob(e))
      .find((e): e is Mob => !!e && e !== m && !e.dying && e.owner !== m.owner && (e.lastAttacker === m.owner || (e.spec.hostile && e.targetId === m.owner)));
    if (foe) m.targetMob = foe.id;
  }
  const t = m.mobTarget(ctx, 24);
  if (t) {
    if (m.spec.flies) m.flyToward(t.x, t.y + 1, t.z, 0.03, 0.4);
    else { m.fightMob(ctx, move, t, attackPower(m)); move.speedMul = 1.4; }
    return;
  }
  if (!owner) { m.wanderAi(ctx, move, 1 / 300); return; }
  const d = Math.hypot(owner.x - b.x, owner.z - b.z);
  if (d > 32 || Math.abs(owner.y - b.y) > 16) {
    b.x = owner.x + (ctx.random() - 0.5) * 2; b.y = owner.y + (m.spec.flies ? 3 : 0); b.z = owner.z + (ctx.random() - 0.5) * 2;
    b.vx = b.vy = b.vz = 0; b.fallDistance = 0;
    return;
  }
  if (m.spec.flies) {
    m.flyToward(owner.x + 2, owner.y + 3, owner.z + 2, 0.02, d > 10 ? 0.4 : 0.2);
    move.yaw = Math.atan2(-b.vx, -b.vz);
    return;
  }
  if (d > 6) { m.steer(ctx, move, owner.x, owner.z, false); move.speedMul = d > 12 ? 1.6 : 1.2; return; }
  m.wanderAi(ctx, move, 1 / 300);
  move.speedMul = 0.6;
}

// ---- feeding, taming, saddling ---------------------------------------------------------------------

export type DinoResult = "fed" | "tamed" | "sat" | "saddled" | null;

/**
 * Something offered to a creature. Asleep and wild: narcotics keep it down,
 * food it eats tames it. Tamed, from its owner: a saddle goes on, food heals
 * it, and anything else tells it to wait or to follow.
 */
export function dinoInteract(m: Mob, ctx: EntityContext, itemName: string | null, playerId: string, playerName?: string): DinoResult {
  const kind = m.kind as DinoKind;
  const c = CREATURES[kind];
  const b = m.body;
  if (m.owner) {
    const mine = m.owner === playerId || (!!playerName && m.ownerName === playerName);
    if (!mine) return null;
    if (itemName && itemName === c.saddle && !m.saddled) {
      m.saddled = true;
      ctx.sound("item_frame_place", b.x, b.y + 1, b.z, 0.8, 0.7);
      return "saddled";
    }
    if (itemName && foodPoints(kind, itemName) > 0 && m.health < m.maxHealth) {
      m.heal(4 + foodPoints(kind, itemName) * 2);
      ctx.particles("heart", b.x, b.y + b.height, b.z, 2);
      return "fed";
    }
    m.sitting = !m.sitting;
    m.targetMob = null;
    return "sat";
  }
  if (!m.unconscious || !itemName) return null;
  if (itemName === "narcoberry" || itemName === "narcotic") {
    m.torpor = Math.min(maxTorpor(kind, m.level) * 1.5, m.torpor + (itemName === "narcotic" ? TORPOR.narcotic : TORPOR.narcoberry));
    return "fed";
  }
  const points = foodPoints(kind, itemName);
  if (points <= 0) return null;
  m.taming += points / tameCost(kind, m.level, ctx.primal === "ascended");
  ctx.particles("heart", b.x, b.y + b.height, b.z, 1);
  if (m.taming < 1) return "fed";
  const bonus = bonusLevels(m.level, m.tameEffect);
  m.level += bonus;
  m.owner = playerId;
  m.ownerName = playerName ?? null;
  m.unconscious = false;
  m.torpor = 0;
  m.taming = 1;
  m.persistent = true;
  m.sitting = false;
  m.targetId = null;
  m.anger = 0;
  m.health = m.maxHealth;
  ctx.particles("heart", b.x, b.y + b.height + 0.3, b.z, 10);
  ctx.sound(`${kind}_idle`, b.x, b.y + 1, b.z, 1, 1.2);
  return "tamed";
}

/** A blow to a sleeping creature spoils the tame a little. */
export function dinoHurt(m: Mob, attacker?: string): void {
  if (m.unconscious) { m.tameEffect = Math.max(0.2, m.tameEffect * (1 - HIT_PENALTY)); return; }
  if (m.owner || !attacker || attacker.startsWith("mob:")) return;
  const temper = creature(m).temper;
  if (temper === "aggressive" || temper === "territorial" || temper === "neutral") { m.targetId = attacker; m.anger = 600; }
}

/** What a creature leaves: meat (cooked, if it burned), hide, and whatever else is its own. */
export function dinoLoot(m: Mob, ctx: EntityContext): ItemStack[] {
  const c = creature(m);
  const r = ([lo, hi]: [number, number]) => lo + Math.floor(ctx.random() * (hi - lo + 1)) + (hi > 0 ? Math.floor(ctx.random() * (m.looting + 1)) : 0);
  const it = (name: string, n: number): ItemStack[] => (n > 0 ? [{ id: itemByName(name).id, count: n }] : []);
  const out = [...it(m.fireTicks > 0 ? "cooked_meat" : "raw_meat", r(c.meat)), ...it("leather", r(c.hide))];
  if (m.kind === "dodo" && ctx.random() < 0.5) out.push(...it("egg", 1));
  if (m.kind === "rex" || m.kind === "bronto" || m.kind === "stego") out.push(...it("bone", r([2, 5])));
  if (m.kind === "ptero" || m.kind === "gigantoraptor") out.push(...it("feather", r([2, 5])));
  return out;
}

/** Whether a player could climb on: tamed by them, saddled, awake, and free. */
export function canRide(m: Mob, playerId: string, playerName?: string): boolean {
  // A trainer's partner big enough to carry them, out of its orb and not in the middle of a battle.
  if (m.kind === "critter") {
    return !!SPECIES[m.species]?.ride && m.saddled && m.owner === playerId && !m.battle && !m.dying && (m.rider === null || m.rider === playerId);
  }
  return isDino(m.kind) && !!CREATURES[m.kind].saddle && m.saddled && !!m.owner && !m.unconscious && !m.dying
    && (m.owner === playerId || (!!playerName && m.ownerName === playerName)) && (m.rider === null || m.rider === playerId);
}

/** The foods a creature takes, favourite first, by display name — for Ascended's hints. */
export function favouriteFoods(kind: DinoKind): string[] {
  return diet(kind).slice(0, 3).map((n) => { try { return itemByName(n).displayName; } catch { return n; } });
}

/**
 * Whether a creature would take this item from this player — what the host's
 * dinoInteract would consume — so a guest's hand empties as the host's would.
 */
export function dinoWouldTake(m: Mob, itemName: string, playerId: string, playerName?: string): boolean {
  if (!isDino(m.kind) || m.dying) return false;
  const kind = m.kind;
  if (m.owner) {
    const mine = m.owner === playerId || (!!playerName && m.ownerName === playerName);
    if (!mine) return false;
    if (itemName === CREATURES[kind].saddle && !m.saddled) return true;
    return foodPoints(kind, itemName) > 0 && m.health < m.maxHealth;
  }
  if (!m.unconscious) return false;
  return itemName === "narcoberry" || itemName === "narcotic" || foodPoints(kind, itemName) > 0;
}
