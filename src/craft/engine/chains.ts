/**
 * Breaking many blocks as one (after FallingTree and Veinminer): an axe fells
 * a whole tree from its trunk, and a pickaxe held while sneaking follows an
 * ore vein through the rock.
 *
 * Both only look, never break: they return the blocks, nearest first, and the
 * player's own break does the rest — so each block drops, wears the tool and
 * reaches a friend's screen exactly as if it had been mined by hand.
 */
import { B, block, isLeaves, isLog } from "./blocks";

type Get = (x: number, y: number, z: number) => number;
export type Pos = [number, number, number];

/** A tree's wood: overworld logs, and the Nether's stems. */
export const isTrunk = (id: number): boolean => isLog(id) || id === B.CRIMSON_STEM || id === B.WARPED_STEM;
/** What crowns a tree: leaves, or a huge fungus's wart blocks and shroomlights. */
const isCrown = (id: number): boolean => isLeaves(id) || id === B.NETHER_WART_BLOCK || id === B.WARPED_WART_BLOCK || id === B.SHROOMLIGHT;

export const isOre = (id: number): boolean => block(id).name.endsWith("_ore");
/** Iron ore and deepslate iron ore are one vein. */
const oreFamily = (id: number): string => block(id).name.replace(/^deepslate_/, "");

const NEIGHBOURS: Pos[] = [];
for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBOURS.push([dx, dy, dz]);
const FACES: Pos[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Everything connected (corners too) that `joins`, from the cells around x, y, z, nearest first; at most `max`. */
function flood(get: Get, x: number, y: number, z: number, joins: (id: number, p: Pos) => boolean, max: number): Pos[] {
  const seen = new Set<string>([`${x},${y},${z}`]);
  const out: Pos[] = [];
  let frontier: Pos[] = [[x, y, z]];
  while (frontier.length && out.length < max) {
    const next: Pos[] = [];
    for (const [cx, cy, cz] of frontier) {
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const p: Pos = [cx + dx, cy + dy, cz + dz];
        const k = `${p[0]},${p[1]},${p[2]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!joins(get(p[0], p[1], p[2]), p)) continue;
        out.push(p);
        next.push(p);
        if (out.length >= max) break;
      }
      if (out.length >= max) break;
    }
    frontier = next;
  }
  return out;
}

/**
 * The rest of the tree whose trunk was just cut at x, y, z (already air):
 * the same wood, touching, at or above the cut — never down into the roots
 * or across the floor of a log cabin. A tree has a crown; wood with fewer
 * than four leaves around it is a building, and is left standing (empty list).
 */
export function treeLogs(get: Get, x: number, y: number, z: number, wood: number, max = 128): Pos[] {
  const logs = flood(get, x, y, z, (id, p) => id === wood && p[1] >= y, max);
  let crown = 0;
  const counted = new Set<string>();
  for (const [lx, ly, lz] of logs) {
    for (const [dx, dy, dz] of FACES) {
      const k = `${lx + dx},${ly + dy},${lz + dz}`;
      if (counted.has(k)) continue;
      counted.add(k);
      if (isCrown(get(lx + dx, ly + dy, lz + dz))) crown++;
    }
  }
  return crown >= 4 ? logs : [];
}

/** The rest of an ore vein around x, y, z: the same ore (deepslate or not), touching, nearest first. */
export function oreVein(get: Get, x: number, y: number, z: number, ore: number, max = 32): Pos[] {
  const family = oreFamily(ore);
  return flood(get, x, y, z, (id) => id !== B.AIR && isOre(id) && oreFamily(id) === family, max);
}
