/**
 * Firearms, for Dead Zone and the zombie modes (after DayZ, Call of Duty's
 * zombies and 7 Days to Die). A shot is instant: a ray from the eye, spread a
 * little (a shotgun's several), stopped by the first block or body in its
 * way, with a head struck taking double. Each shot spends a round from the
 * inventory and makes noise the infected hear a long way off.
 *
 * Numbers are in this game's scale (a player has 20 health): a pistol drops
 * a walker in four shots, or two to the head; a hunting rifle in one or two.
 */
import { block } from "./blocks";
import { rayBox, raycastBlocks, type BlockHit } from "./raycast";
import type { AABB, BlockReader } from "./physics";

export interface Gun {
  item: string;
  ammo: string;
  /** Harm per pellet (most guns fire one). */
  damage: number;
  pellets: number;
  /** How far pellets stray, in radians. */
  spread: number;
  range: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Blocks away the infected hear it. */
  noise: number;
  /** Keeps firing while the button is held. */
  auto: boolean;
  /** How far the muzzle climbs, radians a shot. */
  recoil: number;
  sound: string;
}

export const GUNS: Record<string, Gun> = {
  pistol: { item: "pistol", ammo: "pistol_ammo", damage: 6, pellets: 1, spread: 0.012, range: 48, cooldown: 6, noise: 40, auto: false, recoil: 0.03, sound: "gun_pistol" },
  hunting_rifle: { item: "hunting_rifle", ammo: "rifle_ammo", damage: 18, pellets: 1, spread: 0.002, range: 110, cooldown: 26, noise: 80, auto: false, recoil: 0.07, sound: "gun_rifle" },
  assault_rifle: { item: "assault_rifle", ammo: "rifle_ammo", damage: 5, pellets: 1, spread: 0.025, range: 70, cooldown: 3, noise: 64, auto: true, recoil: 0.018, sound: "gun_assault" },
  shotgun: { item: "shotgun", ammo: "shotgun_shells", damage: 3.5, pellets: 8, spread: 0.09, range: 22, cooldown: 18, noise: 60, auto: false, recoil: 0.08, sound: "gun_shotgun" },
};

export const gunOf = (item: string | undefined): Gun | undefined => (item ? GUNS[item] : undefined);

/** Something a shot can strike: its box, and whose it is. */
export interface Shootable<T> {
  target: T;
  box: AABB;
}

export interface ShotHit<T> {
  target: T;
  distance: number;
  /** The height the pellet struck at, for headshots. */
  y: number;
  headshot: boolean;
}

/**
 * One pellet from (x, y, z) along (dx, dy, dz): the nearest body within range
 * and before any block, or the block it stopped at. A strike in the top 0.45
 * of a body is to the head.
 */
export function tracePellet<T>(
  world: BlockReader, x: number, y: number, z: number, dx: number, dy: number, dz: number, range: number, bodies: Shootable<T>[],
): { hit: ShotHit<T> | null; block: BlockHit | null } {
  // Grass, flowers and the like do not stop a bullet: look past them to the first solid block.
  let wall: BlockHit | null = null, from = 0;
  for (let i = 0; i < 8; i++) {
    const h = raycastBlocks(world, x + dx * from, y + dy * from, z + dz * from, dx, dy, dz, range - from);
    if (!h) break;
    const d = from + h.distance;
    if (block(world.getBlock(h.x, h.y, h.z)).solid) { wall = { ...h, distance: d }; break; }
    from = d + 0.05;
  }
  let best: ShotHit<T> | null = null;
  let limit = wall ? wall.distance : range;
  for (const b of bodies) {
    const r = rayBox(x, y, z, dx, dy, dz, b.box, limit);
    if (!r || r.t >= limit) continue;
    limit = r.t;
    const hy = y + dy * r.t;
    best = { target: b.target, distance: r.t, y: hy, headshot: hy > b.box.maxY - 0.45 };
  }
  return { hit: best, block: best ? null : wall };
}

/** A pellet's direction: the aim, strayed by up to `spread` either way. */
export function stray(dx: number, dy: number, dz: number, spread: number, random: () => number): [number, number, number] {
  const ox = (random() - 0.5) * 2 * spread, oy = (random() - 0.5) * 2 * spread, oz = (random() - 0.5) * 2 * spread;
  const nx = dx + ox, ny = dy + oy, nz = dz + oz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
