/**
 * What the crosshair is on: a voxel walk (Amanatides–Woo) along the view ray,
 * testing each cell's actual model boxes so a slab, a torch or a flower is
 * hit where it is drawn rather than as a full cube around it.
 */
import { block, modelBoxes, B, type Box } from "./blocks";
import type { AABB, BlockReader } from "./physics";

export interface BlockHit {
  x: number;
  y: number;
  z: number;
  /** Face index (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z). */
  face: number;
  /** Exact hit point in world space. */
  px: number;
  py: number;
  pz: number;
  distance: number;
}

const PLANT: Box[] = [[2, 0, 2, 14, 13, 14]];

/** Boxes the crosshair can hit; plants use a smaller box than their model, water none. */
export function selectionBoxes(id: number, meta: number): Box[] {
  const def = block(id);
  if (def.shape === "none" || def.shape === "fluid") return [];
  if (def.shape === "cross" || def.shape === "crop") return id === B.SUGAR_CANE ? [[2, 0, 2, 14, 16, 14]] : PLANT;
  return modelBoxes(def, meta);
}

/** Ray vs box slab test; returns the entry distance and face, or null. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB, maxT: number): { t: number; face: number } | null {
  let tmin = 0, tmax = maxT, face = -1;
  const axes: [number, number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX, 0], [oy, dy, b.minY, b.maxY, 2], [oz, dz, b.minZ, b.maxZ, 4],
  ];
  for (const [o, d, lo, hi, base] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    // Entering through the low side means the face pointing toward -axis.
    let f = base + 1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; f = base; }
    if (t1 > tmin) { tmin = t1; face = f; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return face < 0 ? null : { t: tmin, face };
}

export function raycastBlocks(
  world: BlockReader, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number,
  hitFluids = false,
): BlockHit | null {
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tx = dx !== 0 ? ((sx > 0 ? x + 1 - ox : ox - x) * tdx) : Infinity;
  let ty = dy !== 0 ? ((sy > 0 ? y + 1 - oy : oy - y) * tdy) : Infinity;
  let tz = dz !== 0 ? ((sz > 0 ? z + 1 - oz : oz - z) * tdz) : Infinity;
  for (let steps = 0; steps < 256; steps++) {
    const id = world.getBlock(x, y, z);
    if (id > 0) {
      const meta = world.getMeta(x, y, z);
      const boxes = hitFluids && (id === B.WATER || id === B.LAVA) ? [[0, 0, 0, 16, 14, 16] as Box] : selectionBoxes(id, meta);
      let best: { t: number; face: number } | null = null;
      for (const bx of boxes) {
        const hit = rayBox(ox, oy, oz, dx, dy, dz, {
          minX: x + bx[0] / 16, minY: y + bx[1] / 16, minZ: z + bx[2] / 16,
          maxX: x + bx[3] / 16, maxY: y + bx[4] / 16, maxZ: z + bx[5] / 16,
        }, maxDist);
        if (hit && (!best || hit.t < best.t)) best = hit;
      }
      if (best) {
        return { x, y, z, face: best.face, px: ox + dx * best.t, py: oy + dy * best.t, pz: oz + dz * best.t, distance: best.t };
      }
    }
    const tNext = Math.min(tx, ty, tz);
    if (tNext > maxDist) return null;
    if (tx <= ty && tx <= tz) { x += sx; tx += tdx; }
    else if (ty <= tz) { y += sy; ty += tdy; }
    else { z += sz; tz += tdz; }
  }
  return null;
}
