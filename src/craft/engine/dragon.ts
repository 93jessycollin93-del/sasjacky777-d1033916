/**
 * The Ender Dragon's fight.
 *
 * The dragon runs the original's phases, simplified: it circles the spikes;
 * now and then it strafes a player with a fireball or charges one; the fewer
 * crystals are left, the likelier it is to come down and perch on the exit
 * portal's pillar, breathing on whoever stands near, before it takes off
 * again. A crystal within reach heals it a point every half second, and
 * blowing up the crystal it is drawing on hurts it. Perched it shrugs off
 * arrows and must be fought hand to hand; in the air arrows find it.
 *
 * It flies through the world rather than colliding with it, breaking
 * whatever it touches except the End's own stone, obsidian, bedrock and iron
 * bars — so pillars built to reach it come down.
 */
import { B, block } from "./blocks";
import { AreaCloud, EndCrystal, Projectile, type DamageSource, type EntityContext, type PlayerRef } from "./entities";
import type { Mob } from "./mobs";

export const DRAGON_PHASES = ["circle", "strafe", "charge", "approach", "perch", "takeoff", "dying"] as const;
export type DragonPhase = (typeof DRAGON_PHASES)[number];

export interface DragonState {
  phase: DragonPhase;
  /** Ticks spent in the phase. */
  timer: number;
  /** Where it is flying to. */
  target: { x: number; y: number; z: number } | null;
  /** Its place on the circling ring (twelve points), and which way round it goes. */
  node: number;
  clockwise: boolean;
  /** The crystal healing it, by entity id. */
  crystal: number | null;
  /** The player it strafes or charges. */
  quarry: string | null;
  fireballCooldown: number;
  /** The exit portal's basin (its pillar tops out three above): where it perches. */
  podiumY: number;
  /** Damage taken since it perched: enough sends it back up. */
  perchDamage: number;
  /** Per player, the tick its head or wings last struck them. */
  struck: Map<string, number>;
}

export function newDragonState(podiumY = 64): DragonState {
  return {
    phase: "circle", timer: 0, target: null, node: 0, clockwise: true, crystal: null, quarry: null,
    fireballCooldown: 0, podiumY, perchDamage: 0, struck: new Map(),
  };
}

const RING = 60;
const TICKS_TO_DIE = 200;

/** Blocks the dragon cannot break. */
export const DRAGON_IMMUNE = new Set<number>([
  B.BEDROCK, B.END_STONE, B.OBSIDIAN, B.IRON_BARS, B.END_PORTAL, B.END_PORTAL_FRAME, B.END_GATEWAY,
]);

/**
 * The dragon's body as the original has it: not one box but a head, a neck,
 * a body, a tail in three and each wing in three, turned with its heading.
 * Only the head takes a blow in full; the rest take a quarter of it and a
 * point — so the fight is won by reaching the head, not by peppering a wing.
 * Each part is a cube (centre and half-width), in world space.
 */
export interface DragonPart { name: "head" | "neck" | "body" | "tail" | "wing"; x: number; y: number; z: number; half: number }

const PART_LAYOUT: [DragonPart["name"], number, number, number, number][] = [
  // name, right, up, back (from the body's centre, in blocks), half-width
  ["head", 0, 1.9, -5, 0.9], ["neck", 0, 1.7, -3.2, 0.75], ["body", 0, 1.3, -0.8, 1.5], ["body", 0, 1.3, 1.4, 1.5],
  ["tail", 0, 1.5, 3.4, 0.6], ["tail", 0, 1.5, 4.6, 0.6], ["tail", 0, 1.5, 5.8, 0.6],
  ["wing", -2.6, 2, -0.6, 0.9], ["wing", -4.4, 2, -0.6, 0.9], ["wing", -6.2, 2, -0.6, 0.9],
  ["wing", 2.6, 2, -0.6, 0.9], ["wing", 4.4, 2, -0.6, 0.9], ["wing", 6.2, 2, -0.6, 0.9],
];

export function dragonParts(m: Mob): DragonPart[] {
  const b = m.body;
  const sin = Math.sin(m.yaw), cos = Math.cos(m.yaw);
  // Forward is -z at yaw 0; right is +x.
  return PART_LAYOUT.map(([name, right, up, back, half]) => ({
    name, half, y: b.y + up,
    x: b.x + right * cos + back * sin,
    z: b.z - right * sin + back * cos,
  }));
}

/** What a blow of `amount` does to a part: all of it to the head, a quarter and a point elsewhere. */
export function partDamage(part: DragonPart["name"] | undefined, amount: number): number {
  return part === "head" ? amount : amount / 4 + Math.min(amount, 1);
}

/** Where its head is: five blocks ahead of the body along its heading. */
export function dragonHead(m: Mob): { x: number; y: number; z: number } {
  const b = m.body;
  return { x: b.x - Math.sin(m.yaw) * 5, y: b.y + 1.5, z: b.z - Math.cos(m.yaw) * 5 };
}

const sitting = (s: DragonState) => s.phase === "perch";

/**
 * Damage the dragon actually takes from a hit: arrows glance off it perched,
 * its own crystals' blasts never touch it. Returns 0 to refuse the hit.
 */
export function dragonHurt(m: Mob, amount: number, source: DamageSource, part?: DragonPart["name"]): number {
  const s = m.dragon;
  if (!s || s.phase === "dying") return 0;
  if (sitting(s) && (source === "arrow" || source === "fireball")) return 0;
  // Blows land on a part; magic (a crystal it drew on going up) reaches it whole.
  if (source !== "magic" && source !== "void") amount = partDamage(part, amount);
  if (sitting(s)) {
    s.perchDamage += amount;
    // Hurt enough while down, it gets back into the air.
    if (s.perchDamage > 25) enter(s, "takeoff");
  }
  return amount;
}

function enter(s: DragonState, phase: DragonPhase): void {
  s.phase = phase;
  s.timer = 0;
  s.target = null;
  if (phase === "perch") s.perchDamage = 0;
}

function ringPoint(s: DragonState, node: number): { x: number; y: number; z: number } {
  const a = (node / 12) * Math.PI * 2;
  return { x: Math.cos(a) * RING, y: s.podiumY + 20 + (node % 3) * 5, z: Math.sin(a) * RING };
}

function alivecrystals(ctx: EntityContext, m: Mob): EndCrystal[] {
  return ctx.entitiesNear(0, m.body.y, 0, 160).filter((e): e is EndCrystal => e instanceof EndCrystal && !e.removed);
}

function quarryOf(ctx: EntityContext, s: DragonState): PlayerRef | null {
  return s.quarry ? ctx.players().find((p) => p.id === s.quarry && p.targetable) ?? null : null;
}

export function dragonTick(m: Mob, ctx: EntityContext): void {
  const s = m.dragon!;
  const b = m.body;
  s.timer++;
  if (s.fireballCooldown > 0) s.fireballCooldown--;
  if (m.dying && s.phase !== "dying") enter(s, "dying");

  if (s.phase === "dying") {
    // It rises, bursting with light, and after ten seconds is gone.
    m.deathTime++;
    b.vx = b.vz = 0;
    b.y += 0.1;
    if (m.deathTime % 5 === 0) ctx.particles("explosion", b.x + (ctx.random() - 0.5) * 8, b.y + 2 + (ctx.random() - 0.5) * 4, b.z + (ctx.random() - 0.5) * 8, 3);
    if (m.deathTime % 40 === 0) ctx.sound("ender_dragon_growl", b.x, b.y, b.z, 2, 0.6);
    if (m.deathTime >= TICKS_TO_DIE) {
      m.removed = true;
      ctx.dragonDefeated?.(m);
    }
    return;
  }

  heal(m, ctx, s);

  const players = ctx.players().filter((p) => p.targetable);
  switch (s.phase) {
    case "circle": {
      if (!s.target) s.target = ringPoint(s, s.node);
      if (Math.hypot(s.target.x - b.x, s.target.y - b.y, s.target.z - b.z) < 12) {
        s.node = (s.node + (s.clockwise ? 1 : 11)) % 12;
        s.target = ringPoint(s, s.node);
        if (ctx.random() < 1 / 8) s.clockwise = !s.clockwise;
        const crystals = alivecrystals(ctx, m).length;
        const near = players.filter((p) => Math.hypot(p.x, p.z) < 150);
        if (Math.floor(ctx.random() * (crystals + 3)) === 0) enter(s, "approach");
        else if (near.length && ctx.random() < 0.3) {
          s.quarry = near[Math.floor(ctx.random() * near.length)].id;
          enter(s, ctx.random() < 0.7 ? "strafe" : "charge");
        }
      }
      break;
    }
    case "strafe": {
      const q = quarryOf(ctx, s);
      if (!q || s.timer > 300) { enter(s, "circle"); break; }
      s.target = { x: q.x, y: q.y + 12, z: q.z };
      const head = dragonHead(m);
      const dx = q.x - head.x, dy = q.y + 1 - head.y, dz = q.z - head.z, d = Math.hypot(dx, dy, dz);
      const facing = (-Math.sin(m.yaw) * dx - Math.cos(m.yaw) * dz) / (Math.hypot(dx, dz) || 1);
      if (d < 64 && d > 12 && facing > 0.85 && s.fireballCooldown <= 0 && ctx.difficulty > 0) {
        s.fireballCooldown = 60;
        const speed = 0.8;
        ctx.spawn(new Projectile("dragon_fireball", head.x, head.y, head.z, (dx / d) * speed, (dy / d) * speed, (dz / d) * speed, `mob:${m.id}`));
        ctx.sound("ender_dragon_shoot", head.x, head.y, head.z, 2);
        enter(s, "circle");
      }
      break;
    }
    case "charge": {
      const q = quarryOf(ctx, s);
      if (!q || s.timer > 120) { enter(s, "circle"); break; }
      s.target = { x: q.x, y: q.y + 1, z: q.z };
      if (Math.hypot(q.x - b.x, q.z - b.z) < 4) enter(s, "circle");
      break;
    }
    case "approach": {
      // In over the portal, then straight down onto the pillar.
      const above = { x: 0, y: s.podiumY + 14, z: 0 };
      if (!s.target || s.target.y > s.podiumY + 10) s.target = above;
      if (Math.hypot(b.x, b.z) < 6 && Math.abs(b.y - above.y) < 6) s.target = { x: 0, y: s.podiumY + 4, z: 0 };
      if (Math.hypot(b.x, b.y - (s.podiumY + 4), b.z) < 1.5) {
        b.x = 0.5; b.z = 0.5; b.y = s.podiumY + 4;
        enter(s, "perch");
      }
      if (s.timer > 600) enter(s, "circle");
      break;
    }
    case "perch": {
      b.vx = b.vy = b.vz = 0;
      const nearest = players.reduce<PlayerRef | null>((best, p) => (!best || Math.hypot(p.x - b.x, p.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z) ? p : best), null);
      if (nearest) m.yaw = turn(m.yaw, Math.atan2(-(nearest.x - b.x), -(nearest.z - b.z)), 0.08);
      // Every second and a half, a breath of fire along the ground before its head.
      if (s.timer % 30 === 15 && nearest && Math.hypot(nearest.x - b.x, nearest.z - b.z) < 20) {
        const head = dragonHead(m);
        ctx.spawn(new AreaCloud(head.x, s.podiumY + 1, head.z, 2.5, 200, `mob:${m.id}`));
        ctx.sound("ender_dragon_growl", head.x, head.y, head.z, 2, 1);
      }
      if (s.timer > 200 + (players.length ? 0 : -100)) enter(s, "takeoff");
      break;
    }
    case "takeoff": {
      s.target = { x: 0, y: s.podiumY + 30, z: 0 };
      if (b.y > s.podiumY + 22 || s.timer > 200) {
        // Back onto the ring at its nearest point.
        s.node = Math.round((Math.atan2(b.z, b.x) / (Math.PI * 2)) * 12 + 12) % 12;
        enter(s, "circle");
      }
      break;
    }
  }

  if (!sitting(s) && s.target) fly(m, s);
  contact(m, ctx, s, players);
  if (!sitting(s) && ctx.mobGriefing !== false && m.age % 2 === 0) breakThrough(m, ctx);
  if (ctx.random() < 1 / 160) ctx.sound("ender_dragon_growl", b.x, b.y, b.z, 3, 0.8 + ctx.random() * 0.3);
  m.walkDist += 0.35;
}

function turn(from: number, to: number, max: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-max, Math.min(max, d));
}

/** Steers toward the target: a wide, banking turn at speed, slower coming in to land. */
function fly(m: Mob, s: DragonState): void {
  const b = m.body, t = s.target!;
  const speed = s.phase === "charge" ? 0.9 : s.phase === "approach" ? 0.4 : s.phase === "takeoff" ? 0.45 : 0.6;
  const dx = t.x - b.x, dy = t.y - b.y, dz = t.z - b.z, d = Math.hypot(dx, dy, dz) || 1;
  const want = Math.min(speed, d * 0.25);
  const steer = s.phase === "approach" ? 0.12 : 0.06;
  b.vx += ((dx / d) * want - b.vx) * steer;
  b.vy += ((dy / d) * want - b.vy) * steer;
  b.vz += ((dz / d) * want - b.vz) * steer;
  b.x += b.vx; b.y += b.vy; b.z += b.vz;
  if (Math.hypot(b.vx, b.vz) > 0.05) m.yaw = turn(m.yaw, Math.atan2(-b.vx, -b.vz), 0.12);
}

/** Draws on the nearest crystal within 32 blocks: a point of health every half second. */
function heal(m: Mob, ctx: EntityContext, s: DragonState): void {
  const b = m.body;
  let crystal: EndCrystal | null = null;
  if (s.crystal !== null) {
    const c = ctx.entitiesNear(b.x, b.y, b.z, 40).find((e): e is EndCrystal => e instanceof EndCrystal && e.id === s.crystal);
    if (c && !c.removed && Math.hypot(c.x - b.x, c.y - b.y, c.z - b.z) <= 32) crystal = c;
    else s.crystal = null;
  }
  if (!crystal && ctx.random() < 0.1) {
    let best = 32;
    for (const e of ctx.entitiesNear(b.x, b.y, b.z, 32)) {
      if (!(e instanceof EndCrystal) || e.removed) continue;
      const d = Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z);
      if (d < best) { best = d; crystal = e; }
    }
    s.crystal = crystal ? crystal.id : null;
  }
  for (const e of ctx.entitiesNear(b.x, b.y, b.z, 64)) {
    if (e instanceof EndCrystal) e.beam = e === crystal ? { x: b.x, y: b.y + 1.5, z: b.z } : null;
  }
  if (crystal && m.age % 10 === 0) m.heal(1);
}

/** Its head bites and its wings bat away whoever they meet (not while perched: then only the head). */
function contact(m: Mob, ctx: EntityContext, s: DragonState, players: PlayerRef[]): void {
  const b = m.body;
  const head = dragonHead(m);
  for (const p of players) {
    if (ctx.tick - (s.struck.get(p.id) ?? -100) < 20) continue;
    const pcy = p.y + p.height / 2;
    const toHead = Math.hypot(p.x - head.x, pcy - head.y, p.z - head.z);
    const toBody = Math.hypot(p.x - b.x, p.z - b.z);
    if (toHead < 2.5) {
      s.struck.set(p.id, ctx.tick);
      if (ctx.difficulty > 0) ctx.hurtPlayer(p.id, 10, "mob", head.x, head.z, 1, m.id);
    } else if (!sitting(s) && toBody < 5 && Math.abs(pcy - (b.y + 1.5)) < 3) {
      s.struck.set(p.id, ctx.tick);
      ctx.hurtPlayer(p.id, ctx.difficulty > 0 && m.hurtTime === 0 ? 5 : 0.001, "mob", b.x, b.z, 1.6, m.id);
    }
  }
}

/** Clears every breakable block its body and head pass through. */
function breakThrough(m: Mob, ctx: EntityContext): void {
  const b = m.body, w = ctx.world;
  const head = dragonHead(m);
  const boxes: [number, number, number, number][] = [[b.x, b.y, b.z, 3], [head.x, head.y - 1, head.z, 1]];
  let broke = false;
  for (const [cx, cy, cz, r] of boxes) {
    for (let y = Math.floor(cy); y <= Math.floor(cy + 3); y++) {
      for (let z = Math.floor(cz - r); z <= Math.floor(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) {
        const id = w.getBlock(x, y, z);
        if (id <= 0 || DRAGON_IMMUNE.has(id) || block(id).hardness < 0) continue;
        w.setBlock(x, y, z, B.AIR, 0, "world");
        broke = true;
      }
    }
  }
  if (broke) {
    ctx.particles("explosion", b.x, b.y + 1.5, b.z, 2);
    if (ctx.random() < 0.3) ctx.sound("explode", b.x, b.y, b.z, 0.6, 1.2);
  }
}
