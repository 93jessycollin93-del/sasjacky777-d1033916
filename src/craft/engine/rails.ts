/**
 * Rails: their shapes, where each shape leads, how a newly placed rail joins
 * the track around it, and how power runs along powered and activator rails.
 *
 * Shapes are the original's ten: two straights, four slopes (rising toward
 * the named side) and four curves (joining the two named sides). Powered,
 * detector and activator rails cannot curve and keep their shape in meta bits
 * 0-2 with bit 3 as "powered" (or "a cart is on me" for the detector).
 */
import { B } from "./blocks";

export const RailShape = {
  NorthSouth: 0,
  EastWest: 1,
  AscendingEast: 2,
  AscendingWest: 3,
  AscendingNorth: 4,
  AscendingSouth: 5,
  SouthEast: 6,
  SouthWest: 7,
  NorthWest: 8,
  NorthEast: 9,
} as const;

export const isRail = (id: number): boolean =>
  id === B.RAIL || id === B.POWERED_RAIL || id === B.DETECTOR_RAIL || id === B.ACTIVATOR_RAIL;

/** Plain rails curve; the others only run straight or up a slope. */
export const canCurve = (id: number): boolean => id === B.RAIL;

export function railShape(id: number, meta: number): number {
  return canCurve(id) ? meta & 15 : meta & 7;
}

/**
 * The two ends of each shape, as [dx, dy, dz] from the rail's own block: a
 * slope's high end is one up. The cart runs along the straight line between
 * them — curves included, which the original also takes as a diagonal.
 */
export const RAIL_EXITS: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [
  [[0, 0, -1], [0, 0, 1]],
  [[-1, 0, 0], [1, 0, 0]],
  [[-1, 0, 0], [1, 1, 0]],
  [[-1, 1, 0], [1, 0, 0]],
  [[0, 0, 1], [0, 1, -1]],
  [[0, 0, -1], [0, 1, 1]],
  [[0, 0, 1], [1, 0, 0]],
  [[0, 0, 1], [-1, 0, 0]],
  [[0, 0, -1], [-1, 0, 0]],
  [[0, 0, -1], [1, 0, 0]],
];

export const isSlope = (shape: number): boolean => shape >= 2 && shape <= 5;

/** Horizontal directions as [dx, dz]: north, south, west, east. */
const DIRS: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

type Get = (x: number, y: number, z: number) => number;

/** Which horizontal directions a rail at x,y,z currently leads toward. */
export function railEnds(id: number, meta: number): [number, number][] {
  const shape = railShape(id, meta);
  return (RAIL_EXITS[shape] ?? RAIL_EXITS[0]).map(([dx, , dz]) => [dx, dz]);
}

/** The shape that joins two horizontal directions (and climbs toward any that are raised). */
function shapeFor(a: readonly [number, number], b: readonly [number, number] | null, up: (d: readonly [number, number]) => boolean, curve: boolean): number {
  const [ax, az] = a;
  if (!b) {
    // A single neighbour: run straight at it, and up it if it sits a block higher.
    if (ax !== 0) return up(a) ? (ax > 0 ? RailShape.AscendingEast : RailShape.AscendingWest) : RailShape.EastWest;
    return up(a) ? (az < 0 ? RailShape.AscendingNorth : RailShape.AscendingSouth) : RailShape.NorthSouth;
  }
  const [bx, bz] = b;
  if (ax !== 0 && bx !== 0) {
    if (up(a)) return ax > 0 ? RailShape.AscendingEast : RailShape.AscendingWest;
    if (up(b)) return bx > 0 ? RailShape.AscendingEast : RailShape.AscendingWest;
    return RailShape.EastWest;
  }
  if (az !== 0 && bz !== 0) {
    if (up(a)) return az < 0 ? RailShape.AscendingNorth : RailShape.AscendingSouth;
    if (up(b)) return bz < 0 ? RailShape.AscendingNorth : RailShape.AscendingSouth;
    return RailShape.NorthSouth;
  }
  if (!curve) return shapeFor(a, null, up, curve);
  const ns = az !== 0 ? az : bz, ew = ax !== 0 ? ax : bx;
  if (ns > 0) return ew > 0 ? RailShape.SouthEast : RailShape.SouthWest;
  return ew > 0 ? RailShape.NorthEast : RailShape.NorthWest;
}

/** The rail beside x,y,z in a direction: on the same level, one up, or one down. */
function neighbour(get: Get, x: number, y: number, z: number, [dx, dz]: readonly [number, number]): { y: number } | null {
  for (const dy of [0, 1, -1]) if (isRail(get(x + dx, y + dy, z + dz))) return { y: y + dy };
  return null;
}

/** Whether the rail at x,y,z already leads toward (fromX, fromZ), or is free to (it has an open end). */
function willJoin(get: Get, getMeta: Get, x: number, y: number, z: number, fromX: number, fromZ: number): boolean {
  const id = get(x, y, z);
  const ends = railEnds(id, getMeta(x, y, z));
  if (ends.some(([dx, dz]) => x + dx === fromX && z + dz === fromZ)) return true;
  // An end that points at no rail is open, so this rail can swing round to meet us.
  const open = ends.filter(([dx, dz]) => !neighbour(get, x, y, z, [dx, dz]));
  return open.length > 0;
}

/**
 * The shape for a rail placed at x,y,z: toward the rails around it that can
 * take another connection, preferring ones already pointing here, climbing
 * toward any a block higher.
 */
export function placedShape(get: Get, getMeta: Get, id: number, x: number, y: number, z: number, lookEastWest = false): number {
  const found: (readonly [number, number])[] = [];
  const raised = new Set<number>();
  DIRS.forEach((d, i) => {
    const n = neighbour(get, x, y, z, d);
    if (!n || n.y < y - 1) return;
    if (!willJoin(get, getMeta, x + d[0], n.y, z + d[1], x, z)) return;
    found.push(d);
    if (n.y > y) raised.add(i);
  });
  // Nothing to join: lie along the way the player is facing.
  if (!found.length) return lookEastWest ? RailShape.EastWest : RailShape.NorthSouth;
  const up = (d: readonly [number, number]) => raised.has(DIRS.findIndex((e) => e[0] === d[0] && e[1] === d[1]));
  // Prefer a straight pair, then a curve, then a lone end.
  const xs = found.filter((d) => d[0] !== 0), zs = found.filter((d) => d[1] !== 0);
  if (zs.length === 2) return shapeFor(zs[0], zs[1], up, false);
  if (xs.length === 2) return shapeFor(xs[0], xs[1], up, false);
  return shapeFor(found[0], found[1] ?? null, up, canCurve(id));
}

/**
 * After a rail is placed at x,y,z, the rails beside it that had a free end
 * turn to meet it. Returns [x, y, z, newMeta] for each that should change.
 */
export function neighboursToReshape(get: Get, getMeta: Get, x: number, y: number, z: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const d of DIRS) {
    const n = neighbour(get, x, y, z, d);
    if (!n) continue;
    const nx = x + d[0], nz = z + d[1];
    const nid = get(nx, n.y, nz);
    const nm = getMeta(nx, n.y, nz);
    const ends = railEnds(nid, nm);
    if (ends.some(([dx, dz]) => nx + dx === x && nz + dz === z)) continue;
    // Its ends that lead to real track stay; one open end swings to us.
    const kept = ends.filter(([dx, dz]) => neighbour(get, nx, n.y, nz, [dx, dz]));
    if (kept.length >= 2) continue;
    const toUs: readonly [number, number] = [-d[0], -d[1]];
    const other = kept[0] ?? null;
    const up = (e: readonly [number, number]) => {
      const m = neighbour(get, nx, n.y, nz, e);
      return !!m && m.y > n.y;
    };
    let shape = shapeFor(toUs, other, up, canCurve(nid));
    // A rail that cannot curve keeps its old line rather than turning away from its only track.
    if (!canCurve(nid) && other && (other[0] !== 0) !== (toUs[0] !== 0)) continue;
    if (shape === railShape(nid, nm)) continue;
    const extra = canCurve(nid) ? 0 : nm & 8;
    shape = shape | extra;
    out.push([nx, n.y, nz, shape]);
  }
  return out;
}

/**
 * Whether a powered or activator rail receives power: straight from redstone,
 * or passed along a line of its own kind, up to eight rails from the source.
 */
export function railChainPowered(
  get: Get, getMeta: Get, direct: (x: number, y: number, z: number) => boolean, x: number, y: number, z: number,
): boolean {
  const id = get(x, y, z);
  if (direct(x, y, z)) return true;
  const shape = getMeta(x, y, z) & 7;
  for (const end of RAIL_EXITS[shape] ?? RAIL_EXITS[0]) {
    let cx = x, cy = y, cz = z, cshape = shape;
    let [dx, dy, dz] = end;
    for (let step = 0; step < 8; step++) {
      // The next rail along: the exit's block, or one lower where the line runs down a slope.
      const nx = cx + dx, nz = cz + dz;
      let ny = cy + dy;
      if (get(nx, ny, nz) !== id && get(nx, ny - 1, nz) === id) ny--;
      if (get(nx, ny, nz) !== id) break;
      const nshape = getMeta(nx, ny, nz) & 7;
      const axisOf = (s: number) => (s === 0 || s === 4 || s === 5 ? "z" : "x");
      if (axisOf(nshape) !== axisOf(cshape)) break;
      if (direct(nx, ny, nz)) return true;
      cx = nx; cy = ny; cz = nz; cshape = nshape;
      // Keep going the same way along the new rail.
      const exits = RAIL_EXITS[nshape];
      const onward = exits.find(([ex, , ez]) => ex === dx && ez === dz) ?? exits[1];
      [dx, dy, dz] = onward;
    }
  }
  return false;
}
