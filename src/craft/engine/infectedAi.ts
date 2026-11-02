/**
 * How the infected behave (Dead Zone and the zombie modes), on top of the
 * ordinary monster's chase-and-strike (Mob.hostileAi).
 *
 * A walker shambles until it has a target, then runs at it (DayZ's infected
 * run). A runner is faster still. A brute is slow, hits like a truck and
 * batters its way through walls. A spitter keeps its distance and spits acid.
 * A screamer, seeing you, screams — every infected within earshot comes, and
 * more crawl out of the ground. A bloater staggers close and bursts in a
 * cloud of bile.
 *
 * Every one of them hears: a gunshot, a sprint, an explosion (Game.makeNoise)
 * alerts them to where it came from, whether or not they can see it. During a
 * blood moon they all dig.
 */
import type { EntityContext, PlayerRef } from "./entities";
import type { Mob } from "./mobs";
import { B, block, isDoor, isTrapdoor } from "./blocks";
import { boardsOf, COUNTY_BLOCKS as C, WINDOW_BROKEN, WINDOW_OPEN, withBoards } from "./countyBlocks";

type Move = { forward: number; jump: boolean; yaw: number; speedMul: number };

/** Runs before the ordinary monster behaviour; returns true when it has handled the tick itself. */
export function infectedAi(m: Mob, ctx: EntityContext, move: Move): boolean {
  if (m.alert > 0) m.alert--;
  const b = m.body;
  const target = m.targetId ? ctx.players().find((p) => p.id === m.targetId && p.targetable) ?? null : null;
  if (m.kind === "screamer" && target && m.fuse <= 0 && m.canSee(ctx, target)) {
    scream(m, ctx, target);
    return false;
  }
  if (m.fuse > 0) m.fuse--;
  if (m.kind === "spitter" && target) {
    const d = Math.hypot(target.x - b.x, target.z - b.z);
    if (d > 3.5 && d < 14 && m.canSee(ctx, target)) {
      move.yaw = m.faceTo(target.x, target.z);
      // It holds its distance rather than closing in, and spits when ready.
      if (d < 7) { m.steer(ctx, move, b.x - (target.x - b.x), b.z - (target.z - b.z), true); move.yaw = m.faceTo(target.x, target.z); move.forward = -0.6; }
      if (m.attackCooldown <= 0) spit(m, ctx, target);
      return true;
    }
  }
  if (m.kind === "bloater" && target && Math.hypot(target.x - b.x, target.z - b.z) < 2.2 && Math.abs(target.y - b.y) < 2) {
    // Close enough: it bursts where it stands.
    m.health = 0;
    m.deathTime = 1;
    return true;
  }
  return false;
}

/** After the chase has steered: how fast each kind runs, and (a brute, or anyone under a blood moon) digging through what is in the way. */
export function infectedAfter(m: Mob, ctx: EntityContext, move: Move): void {
  const chasing = !!m.targetId;
  // Ashgrove's dead never run: a shambler hurries a little once it has you, a crawler cannot.
  if (m.kind === "shambler" || m.kind === "crawler") {
    move.speedMul *= chasing ? (m.kind === "shambler" ? 1.25 : 1) : 0.6;
    if (chasing && ctx.mobGriefing !== false) thump(m, ctx, move);
    return;
  }
  if (chasing) move.speedMul *= m.kind === "runner" ? 2.1 : m.kind === "brute" ? 1.25 : m.kind === "bloater" ? 1 : 1.7;
  else move.speedMul *= 0.7;
  if (chasing && (m.kind === "brute" || ctx.bloodMoon) && ctx.mobGriefing !== false) dig(m, ctx, move);
}

/**
 * How long, in ticks, one of the county's dead takes to get through what is
 * in its way. They cannot dig through a wall, as a brute can — what they do
 * is beat on the weak places, the doors, the windows and the boards across
 * them, until those give. A pane goes in seconds, a board in a quarter of a
 * minute, a front door in half a minute; a crowd at the same door is each
 * beating on it, so a crowd is how a house falls.
 */
export function thumpTicks(id: number, meta: number): number {
  if (id === C.HOUSE_WINDOW) return boardsOf(meta) > 0 ? 300 : meta & (WINDOW_BROKEN | WINDOW_OPEN) ? 0 : 60;
  if (isDoor(id)) return boardsOf(meta) > 0 ? 300 : Math.round(block(id).hardness * 150 + 100);
  if (id === C.BARRICADE) return 300;
  if (id === C.GARAGE_DOOR) return 1000;
  // Glass anywhere else — a shop front — goes as a window's does.
  if (id === B.GLASS || id === B.GLASS_PANE) return 80;
  return 0;
}

/** Batters at the door, window or boards in front of it until they give — never at a plain wall. */
function thump(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  if (!b.collidedH || move.forward <= 0) { m.dig = null; return; }
  const ax = Math.floor(b.x - Math.sin(move.yaw) * (b.width / 2 + 0.5)), az = Math.floor(b.z - Math.cos(move.yaw) * (b.width / 2 + 0.5));
  const fy = Math.floor(b.y + 0.01);
  // A window's sill is a wall block, so its pane is one up: the head's height, and a crawler's reach stops at the floor.
  for (const y of m.kind === "crawler" ? [fy] : [fy, fy + 1]) {
    const id = ctx.world.blockAt(ax, y, az);
    if (isTrapdoor(id)) continue;
    const meta = ctx.world.getMeta(ax, y, az);
    const ticks = thumpTicks(id, meta);
    if (ticks <= 0) continue;
    if (!m.dig || m.dig.x !== ax || m.dig.y !== y || m.dig.z !== az) m.dig = { x: ax, y, z: az, progress: 0 };
    m.dig.progress += 1 / ticks;
    if (m.age % 15 === 0) ctx.sound("zombie_break", ax + 0.5, y + 0.5, az + 0.5, 0.9, 0.7 + ctx.random() * 0.2);
    if (m.dig.progress >= 1) { give(ctx, ax, y, az, id, meta); m.dig = null; }
    return;
  }
}

/** What happens when a door, window or board gives: a board comes off, glass smashes, a door splinters. */
export function give(ctx: Pick<EntityContext, "world" | "particles" | "sound">, x: number, y: number, z: number, id: number, meta: number): void {
  const w = ctx.world;
  // Both halves of a two-high door or window go together.
  const pair = isDoor(id) ? (meta & 8 ? y - 1 : y + 1) : id === C.HOUSE_WINDOW ? (w.blockAt(x, y + 1, z) === id ? y + 1 : w.blockAt(x, y - 1, z) === id ? y - 1 : null) : null;
  const both = (f: (m: number) => number | null) => {
    for (const yy of pair === null ? [y] : [y, pair]) {
      if (w.blockAt(x, yy, z) !== id) continue;
      const next = f(w.getMeta(x, yy, z));
      w.setBlock(x, yy, z, next === null ? B.AIR : id, next ?? 0, "world");
    }
  };
  ctx.particles("block", x + 0.5, y + 0.5, z + 0.5, 12, boardsOf(meta) > 0 || id === C.BARRICADE ? C.BARRICADE : id);
  if ((isDoor(id) || id === C.HOUSE_WINDOW) && boardsOf(meta) > 0) {
    both((m) => withBoards(m, boardsOf(m) - 1));
    ctx.sound("zombie_break", x + 0.5, y + 0.5, z + 0.5, 1.2, 0.6);
  } else if (id === C.HOUSE_WINDOW) {
    both((m) => m | WINDOW_BROKEN);
    ctx.sound("glass_break", x + 0.5, y + 0.5, z + 0.5, 1, 1);
  } else {
    both(() => null);
    ctx.sound(block(id).material === "glass" ? "glass_break" : "zombie_break", x + 0.5, y + 0.5, z + 0.5, 1.2, 0.5);
  }
}

/** Batters at the block in front of it — the one at its feet, then its head — until it gives. */
function dig(m: Mob, ctx: EntityContext, move: Move): void {
  const b = m.body;
  if (!b.collidedH || move.forward <= 0) { m.dig = null; return; }
  const ax = Math.floor(b.x - Math.sin(move.yaw) * (b.width / 2 + 0.5)), az = Math.floor(b.z - Math.cos(move.yaw) * (b.width / 2 + 0.5));
  const fy = Math.floor(b.y + 0.01);
  for (const y of [fy, fy + 1]) {
    const id = ctx.world.blockAt(ax, y, az);
    const def = block(id);
    if (!def.solid || def.hardness < 0 || id === B.OBSIDIAN || id === B.BEDROCK) continue;
    if (!m.dig || m.dig.x !== ax || m.dig.y !== y || m.dig.z !== az) m.dig = { x: ax, y, z: az, progress: 0 };
    m.dig.progress += (m.kind === "brute" ? 3 : 1) / (def.hardness * 30 + 20);
    if (m.age % 10 === 0) ctx.sound("zombie_break", ax + 0.5, y + 0.5, az + 0.5, 0.8, 0.8 + ctx.random() * 0.3);
    if (m.dig.progress >= 1) {
      ctx.world.setBlock(ax, y, az, B.AIR, 0, "world");
      ctx.particles("block", ax + 0.5, y + 0.5, az + 0.5, 12, id);
      m.dig = null;
    }
    return;
  }
}

/** A screamer's cry: every infected in earshot turns toward it, and a few more rise. */
function scream(m: Mob, ctx: EntityContext, target: PlayerRef): void {
  const b = m.body;
  m.fuse = 400;
  ctx.sound("screamer_scream", b.x, b.y + 1.6, b.z, 2);
  for (const e of ctx.entitiesNear(b.x, b.y, b.z, 40)) {
    const o = m.asMob(e);
    if (!o || o === m || !o.spec.hostile || o.dying) continue;
    if (o.infected) { o.targetId = target.id; o.alert = 400; }
  }
  const n = 2 + Math.floor(ctx.random() * 2);
  for (let i = 0; i < n; i++) {
    const a = ctx.random() * Math.PI * 2, r = 6 + ctx.random() * 6;
    const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
    const top = ctx.world.topSolid(Math.floor(x), Math.floor(z));
    if (top < 1) continue;
    const s = m.summon(ctx.random() < 0.25 ? "runner" : "infected", x, top + 1, z);
    s.targetId = target.id;
    s.alert = 400;
    ctx.spawn(s);
  }
}

/** A spitter's acid: it strikes, burns a little, and poisons. */
function spit(m: Mob, ctx: EntityContext, t: PlayerRef): void {
  const b = m.body;
  m.attackCooldown = 60;
  ctx.sound("spitter_spit", b.x, b.y + 1.5, b.z, 1);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    ctx.particles("slime", b.x + (t.x - b.x) * k, b.y + 1.5 + (t.y + 1.2 - b.y - 1.5) * k, b.z + (t.z - b.z) * k, 1);
  }
  if (ctx.difficulty > 0) {
    ctx.hurtPlayer(t.id, ctx.difficulty === 3 ? 4 : 3, "magic", b.x, b.z, 0.2, m.id);
    ctx.effectPlayer?.(t.id, "poison", 4, 0);
  }
}

/** A bloater bursting: bile over everyone near — blinding, sickening, and a blow. */
export function burst(m: Mob, ctx: EntityContext): void {
  const b = m.body;
  ctx.sound("bloater_burst", b.x, b.y + 1, b.z, 1.5);
  ctx.particles("slime", b.x, b.y + 1.2, b.z, 30);
  ctx.particles("poof", b.x, b.y + 1.2, b.z, 14);
  for (const p of ctx.players()) {
    if (!p.targetable || Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) > 3.5) continue;
    ctx.hurtPlayer(p.id, 4, "magic", b.x, b.z, 0.6, m.id);
    ctx.effectPlayer?.(p.id, "blindness", 6, 0);
    ctx.effectPlayer?.(p.id, "poison", 5, 0);
  }
}
