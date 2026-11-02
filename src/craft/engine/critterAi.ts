/**
 * How critters and their trainers behave in the world (engine/critters.ts
 * says who critters are; engine/battle.ts is how they fight).
 *
 * In the world a critter never fights: battles are turn by turn, on the
 * battle screen, and in the meantime the two critters in one stand facing
 * each other. A wild critter wanders — a flyer hovers low, a rare one shies
 * away from anyone who comes running — and waits to be battled. A trainer's
 * partner follows them about, and one big enough carries them. Trainers stand
 * their ground and watch the road.
 */
import type { EntityContext, PlayerRef } from "./entities";
import type { Mob } from "./mobs";
import { SPECIES } from "./critters";
import { rideTick } from "./dinoAi";
import { travel, moveBody, senseEnvironment } from "./physics";

type Move = { forward: number; jump: boolean; yaw: number; speedMul: number };

/**
 * Before any behaviour: a ridden critter goes where its rider steers, and one
 * in a battle holds still and faces its foe. Returns true when that was the
 * whole tick.
 */
export function critterTick(m: Mob, ctx: EntityContext): boolean {
  if (m.rider) {
    if (!ctx.players().some((p) => p.id === m.rider)) m.rider = null;
    else { rideTick(m, ctx); return true; }
  }
  if (!m.battle) return false;
  const b = m.body;
  const foe = m.battleFace;
  if (foe) m.yaw = m.faceTo(foe.x, foe.z);
  b.vx *= 0.5; b.vz *= 0.5;
  if (m.spec.flies) {
    // Hovering where it was when the battle began, bobbing a little.
    b.vy = Math.sin(m.age / 10) * 0.02;
    senseEnvironment(ctx.world, b);
    moveBody(ctx.world, b, b.vx, b.vy, b.vz);
  } else travel(ctx.world, b, { forward: 0, strafe: 0, yaw: m.yaw, jump: false, sneak: false, sprint: false, flying: false, speed: 0, floats: true });
  // A battle abandoned (its player gone) must not leave the critter frozen for good.
  if (--m.battleTicks <= 0 || !ctx.players().some((p) => p.id === m.battle)) { m.battle = null; m.battleFace = null; }
  m.environment(ctx);
  return true;
}

export function critterAi(m: Mob, ctx: EntityContext, move: Move): void {
  const s = SPECIES[m.species];
  if (m.owner) { partner(m, ctx, move); return; }
  if (s?.moves === "fly") { hover(m, ctx, move); return; }
  const b = m.body;
  // Rare critters are shy: anyone who comes at them without creeping sends them off.
  if ((s?.rarity === "rare" || s?.rarity === "uncommon") && m.panic <= 0 && m.age % 10 === 0) {
    const threat = m.nearestPlayer(ctx, s.rarity === "rare" ? 9 : 5, (p) => p.targetable && !p.sneaking && !p.invisible);
    if (threat) {
      const a = Math.atan2(b.z - threat.z, b.x - threat.x) + (ctx.random() - 0.5) * 0.8;
      m.wander = { x: b.x + Math.cos(a) * 10, z: b.z + Math.sin(a) * 10, ticks: 40 };
      m.panic = 30;
    }
  }
  if (m.panic > 0) {
    m.panic--;
    if (m.wander) m.steer(ctx, move, m.wander.x, m.wander.z, true);
    move.speedMul = 1.8;
    return;
  }
  m.wanderAi(ctx, move, 1 / 90);
  if (ctx.random() < 1 / 700) ctx.sound("critter_cry", b.x, b.y + b.height, b.z, 0.6, cryPitch(m.species));
}

/** A flyer: short drifts a couple of blocks above the ground, never far from where it spawned. */
function hover(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  const ground = ctx.world.topSolid(Math.floor(b.x), Math.floor(b.z));
  if (!m.flyTo || ctx.random() < 1 / 160 || Math.hypot(m.flyTo.x - b.x, m.flyTo.y - b.y, m.flyTo.z - b.z) < 1.5) {
    const alt = Math.max(ground, 62) + 1.5 + ctx.random() * 3;
    m.pickFlyTo(ctx, b.x, alt, b.z, 6);
    m.flyTo!.y = alt;
  }
  m.flyToward(m.flyTo!.x, m.flyTo!.y, m.flyTo!.z, 0.01, 0.12);
  move.yaw = Math.atan2(-b.vx, -b.vz);
  if (ctx.random() < 1 / 700) ctx.sound("critter_cry", b.x, b.y, b.z, 0.6, cryPitch(m.species));
}

/** A trainer's partner, out of its orb: at their heels, and back at their side if left behind. */
function partner(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  const owner = ctx.players().find((p) => p.id === m.owner) ?? null;
  if (!owner) { m.wanderAi(ctx, move, 1 / 300); return; }
  const d = Math.hypot(owner.x - b.x, owner.z - b.z);
  if (d > 24 || Math.abs(owner.y - b.y) > 12) {
    b.x = owner.x + (ctx.random() - 0.5) * 2; b.y = owner.y + (m.spec.flies ? 2 : 0); b.z = owner.z + (ctx.random() - 0.5) * 2;
    b.vx = b.vy = b.vz = 0; b.fallDistance = 0;
    return;
  }
  if (m.spec.flies) {
    // Over its trainer's shoulder.
    const a = -(owner.yaw ?? 0) + Math.PI * 0.75;
    m.flyToward(owner.x + Math.sin(a) * 1.5, owner.y + 2.2, owner.z + Math.cos(a) * 1.5, 0.02, d > 6 ? 0.35 : 0.15);
    move.yaw = d > 2 ? Math.atan2(-b.vx, -b.vz) : m.faceTo(owner.x, owner.z);
    return;
  }
  if (d > 3.5) { m.steer(ctx, move, owner.x, owner.z, false); move.speedMul = d > 8 ? 1.8 : 1.2; return; }
  move.yaw = m.faceTo(owner.x, owner.z);
}

/** A trainer keeps to their spot, watching the road, and turns to look at anyone who comes near. */
export function trainerAi(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  const home = m.home;
  if (home && Math.hypot(home.x - b.x, home.z - b.z) > 1.5) { m.steer(ctx, move, home.x, home.z, false); return; }
  const near: PlayerRef | null = m.nearestPlayer(ctx, 6, (p) => p.targetable);
  move.yaw = near ? m.faceTo(near.x, near.z) : m.homeYaw;
}

/** A species' voice: small ones squeak, big ones rumble. */
export function cryPitch(species: string): number {
  const s = SPECIES[species];
  return s ? Math.max(0.5, Math.min(1.8, 1.5 - s.height * 0.35)) : 1;
}
