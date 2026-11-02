/**
 * Explosions, done the way the original does them: rays cast outward from the
 * centre, each losing strength to every block it passes by that block's blast
 * resistance. That is what makes obsidian and water stop a blast, lets TNT
 * tunnel through dirt but only chip stone, and shapes craters irregularly
 * instead of as perfect spheres.
 */
import { B, block } from "./blocks";
import type { AABB, BlockReader } from "./physics";
import { raycastBlocks } from "./raycast";

export function blastResistance(id: number): number {
  if (id === B.BEDROCK) return 3600000;
  if (id === B.OBSIDIAN) return 1200;
  if (id === B.WATER || id === B.LAVA) return 100;
  const def = block(id);
  if (def.hardness < 0) return 3600000;
  if ((def.material === "stone" || def.material === "metal") && def.hardness >= 1.5) return 6;
  return def.hardness;
}

/** Positions an explosion of this power destroys, given a random source. */
export function explosionBlocks(world: BlockReader, x: number, y: number, z: number, power: number, random: () => number): [number, number, number][] {
  const hit = new Map<string, [number, number, number]>();
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      for (let k = 0; k < 16; k++) {
        if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
        let dx = (i / 15) * 2 - 1, dy = (j / 15) * 2 - 1, dz = (k / 15) * 2 - 1;
        const len = Math.hypot(dx, dy, dz);
        dx /= len; dy /= len; dz /= len;
        let strength = power * (0.7 + random() * 0.6);
        let px = x, py = y, pz = z;
        while (strength > 0) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          const id = world.getBlock(bx, by, bz);
          if (id < 0) break;
          if (id !== 0) {
            strength -= (blastResistance(id) + 0.3) * 0.3;
            if (strength > 0) hit.set(`${bx},${by},${bz}`, [bx, by, bz]);
          }
          px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
          strength -= 0.225;
        }
      }
    }
  }
  return [...hit.values()];
}

/** Fraction of an entity's box that can see the blast centre (0..1). */
export function exposure(world: BlockReader, x: number, y: number, z: number, box: AABB): number {
  let seen = 0, total = 0;
  for (let fx = 0; fx <= 1; fx += 0.5) {
    for (let fy = 0; fy <= 1; fy += 0.5) {
      for (let fz = 0; fz <= 1; fz += 0.5) {
        const tx = box.minX + (box.maxX - box.minX) * fx;
        const ty = box.minY + (box.maxY - box.minY) * fy;
        const tz = box.minZ + (box.maxZ - box.minZ) * fz;
        const d = Math.hypot(tx - x, ty - y, tz - z);
        total++;
        const hit = raycastBlocks(world, x, y, z, tx - x, ty - y, tz - z, d);
        if (!hit || !block(world.getBlock(hit.x, hit.y, hit.z)).opaque) seen++;
      }
    }
  }
  return total ? seen / total : 0;
}

/** Damage and knockback for something `dist` from a blast of `power` with this exposure. */
export function blastImpact(power: number, dist: number, exposed: number): { damage: number; push: number } {
  const radius = power * 2;
  if (dist >= radius) return { damage: 0, push: 0 };
  const impact = (1 - dist / radius) * exposed;
  return { damage: Math.floor(((impact * impact + impact) / 2) * 7 * radius + 1), push: impact };
}
