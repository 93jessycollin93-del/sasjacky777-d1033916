/**
 * The Neon Bay Police Department: wanted stars, and the cops who come for
 * you when you have them.
 *
 * A crime adds heat; the heat is shown as up to five stars, after the
 * crime-sandbox games' wanted meter. A punch in the street is one star, a
 * body is two, a cop's body is three, and a spree climbs to five. The heat
 * holds while the police can see you — a cop on foot within sight, a
 * cruiser within a block or two — and once they cannot, the stars start to
 * flash, and drop one at a time the longer you stay out of sight. A trip
 * through the respray garage wipes them at once.
 *
 * Cops on foot chase whoever they are after, club them up close, and from
 * three stars shoot. Cruisers drive to you the way a driver who knows the
 * grid would: along the road they are on to the cross street nearest you,
 * round it, and straight at you once you are close; beside a suspect on
 * foot they pull up and put two cops on the pavement.
 *
 * Caught — a cop's hand on you for a second and a half while you stand
 * still — you are busted: taken to the station, relieved of your guns and
 * a fine. Killed, you are wasted: patched up at St. Ouchie's for a fee.
 * Either way the stars are gone.
 */
import { block } from "./blocks";
import type { Car } from "./cars";
import { City, ROAD, type Lane } from "./city";
import type { EntityContext, PlayerRef } from "./entities";
import type { Mob } from "./mobs";
import { raycastBlocks } from "./raycast";
import { laneNear } from "./traffic";

/** Heat at which each star lights: one star at 1, five at 700. */
export const STAR_HEAT = [1, 100, 250, 450, 700] as const;
export const MAX_HEAT = 1000;

export function starsFor(heat: number): number {
  let s = 0;
  for (const h of STAR_HEAT) if (heat >= h) s++;
  return s;
}

/** The heat a star count starts at (for dropping a star). */
export const heatFor = (stars: number): number => (stars <= 0 ? 0 : STAR_HEAT[Math.min(5, stars) - 1]);

/** What a crime is worth. */
export const CRIMES = {
  assault: 40,
  murder: 110,
  assaultCop: 120,
  copKiller: 260,
  carjack: 30,
  carBombed: 60,
  gunfire: 3,
} as const;
export type Crime = keyof typeof CRIMES;

/** Adds a crime's heat, capped. */
export function addHeat(heat: number, crime: Crime): number {
  return Math.min(MAX_HEAT, heat + CRIMES[crime]);
}

/** Seconds out of sight before a star is lost: longer the more stars there are. */
export const evadeSeconds = (stars: number): number => 8 + stars * 5;

/** How many cops on foot, and how many cruisers, come after each star count. */
export const COPS_ON_FOOT = [0, 2, 3, 5, 6, 8] as const;
export const CRUISERS = [0, 0, 1, 2, 3, 4] as const;

/** A cop's lines. */
export const COP_QUIPS = ["Freeze! NBPD!", "Stop resisting!", "You have the right to remain cringe!", "Hands where I can see 'em!", "Pull over!", "That's a ticket AND a ratio."];
export const BUSTED_QUIPS = ["Should've touched grass.", "Skill issue, officer's words.", "It's giving… custody.", "Ratio'd by the NBPD."];
export const WASTED_QUIPS = ["St. Ouchie's billed you $100. They take exposure too.", "Respawned. Emotionally damaged.", "You got bonked. Hard.", "The doctor says: skill issue."];

/** Whether a cop at (x, y, z) can see a point: nothing solid in the way. */
export function canSee(ctx: EntityContext, x: number, y: number, z: number, tx: number, ty: number, tz: number): boolean {
  const dx = tx - x, dy = ty - y, dz = tz - z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.5) return true;
  const hit = raycastBlocks(ctx.world, x, y, z, dx / d, dy / d, dz / d, d);
  return !hit || !block(ctx.world.blockAt(hit.x, hit.y, hit.z)).opaque;
}

/**
 * A cop on foot. After someone (targetId), they chase and club them, and
 * from three stars (the mob's `copStars`) shoot from range; after nobody,
 * they walk the beat like anyone else.
 */
export function copAi(m: Mob, ctx: EntityContext, move: { forward: number; jump: boolean; yaw: number; speedMul: number }, walk: () => void): void {
  const b = m.body;
  if (m.quipTicks > 0) m.quipTicks--;
  const t = m.targetId ? ctx.players().find((p) => p.id === m.targetId && p.targetable) : undefined;
  if (!t) { walk(); return; }
  const d = Math.hypot(t.x - b.x, t.z - b.z);
  if (d > 72) { m.targetId = null; walk(); return; }
  if (m.age % 160 === 0 && ctx.random() < 0.5) m.say(COP_QUIPS[Math.floor(ctx.random() * COP_QUIPS.length)]);
  const sees = canSee(ctx, b.x, b.y + 1.6, b.z, t.x, t.y + 1.4, t.z);
  // Armed, they stop at a distance and fire; otherwise they close in.
  if (m.copStars >= 3 && sees && d > 4 && d < 22) {
    move.forward = 0;
    move.yaw = Math.atan2(-(t.x - b.x), -(t.z - b.z));
    if (m.attackCooldown <= 0) {
      m.attackCooldown = 22 + Math.floor(ctx.random() * 10);
      ctx.sound("gun_pistol", b.x, b.y + 1.5, b.z, 1, 1.05);
      ctx.particles("smoke", b.x - Math.sin(move.yaw) * 0.6, b.y + 1.4, b.z - Math.cos(move.yaw) * 0.6, 2);
      // Aimed fire: better up close, and a moving car is hard to hit.
      const chance = Math.max(0.15, 0.7 - d * 0.025) * (t.riding ? 0.6 : 1);
      if (ctx.random() < chance) ctx.hurtPlayer(t.id, m.copStars >= 5 ? 4 : 3, "arrow", b.x, b.z, 0.1, m.id);
    }
    return;
  }
  m.steer(ctx, move, t.x, t.z, false);
  move.speedMul = 1.45;
  const reach = (b.width + t.width) / 2 + 0.7;
  if (d < reach && Math.abs(t.y - b.y) < 2 && m.attackCooldown <= 0 && !t.riding) {
    m.attackCooldown = 24;
    ctx.hurtPlayer(t.id, 2, "mob", b.x, b.z, 0.3, m.id);
  }
}

/** What a cruiser is doing: whom it is after, and how long it has been stuck. */
export interface ChaseState {
  target: string;
  stuck: number;
  /** Ticks left of backing out of whatever it is stuck against. */
  reverse: number;
}

/**
 * Where a cruiser steers: straight at its quarry when close; otherwise to
 * the junction of the road it is on and the cross street nearest the quarry
 * — so it drives the grid instead of into the buildings between.
 */
export function chaseWaypoint(city: City, car: Car, tx: number, tz: number): [number, number] {
  if (Math.hypot(tx - car.x, tz - car.z) < 26) return [tx, tz];
  const lane: Lane = laneNear(city, car.x, car.z, car.yaw);
  // The centre of the road it is on, and the nearest cross road to the quarry.
  const along = city.roadStart(lane.axis, lane.road) + ROAD / 2;
  const cross = lane.axis === "z" ? "x" : "z";
  const count = cross === "z" ? city.spec.cols : city.spec.rows;
  const target = cross === "x" ? tz : tx;
  let best = 0, bestD = Infinity;
  for (let k = 0; k <= count; k++) {
    const c = city.roadStart(cross, k) + ROAD / 2;
    const dd = Math.abs(c - target);
    if (dd < bestD) { bestD = dd; best = k; }
  }
  const crossAt = city.roadStart(cross, best) + ROAD / 2;
  const [jx, jz] = lane.axis === "z" ? [along, crossAt] : [crossAt, along];
  // At the junction already: down the cross road toward the quarry.
  if (Math.hypot(jx - car.x, jz - car.z) < 7) return lane.axis === "z" ? [tx, crossAt] : [crossAt, tz];
  return [jx, jz];
}

/** Sets a cruiser's pedals and wheel for this tick: flat out at the waypoint, backing out when stuck. */
export function chaseDrive(city: City, car: Car, st: ChaseState, target: PlayerRef, ctx: EntityContext): void {
  const [wx, wz] = chaseWaypoint(city, car, target.x, target.z);
  const want = Math.atan2(-(wx - car.x), -(wz - car.z));
  let diff = want - car.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const speed = car.speed;
  if (st.reverse > 0) {
    st.reverse--;
    car.input = { forward: -1, strafe: Math.sign(diff) || 1, yaw: car.yaw, jump: false };
    return;
  }
  if (Math.abs(speed) < 0.04) { if (++st.stuck > 30) { st.stuck = 0; st.reverse = 18; } } else st.stuck = 0;
  // Brake into the sharp turns; handbrake round the sharpest.
  const sharp = Math.abs(diff);
  const forward = sharp > 1.2 && speed > 0.45 ? -1 : 1;
  car.input = { forward, strafe: Math.max(-1, Math.min(1, -diff * 2.2)), yaw: car.yaw, jump: sharp > 1.4 && speed > 0.5 };
  if (ctx.random() < 0.01) car.honk(ctx);
}
