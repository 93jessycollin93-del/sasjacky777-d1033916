/**
 * Nether portals: recognising a lit obsidian frame, keeping a portal whole,
 * and choosing where a new one goes on the far side.
 *
 * Pure functions over a block getter, so the rules, the game and the tests
 * share one answer to "is this a portal?".
 */
import { B, block } from "./blocks";

type Get = (x: number, y: number, z: number) => number;

/** Axis 0: the sheet spans x (a player walks through it along z). Axis 1: it spans z. */
export type PortalAxis = 0 | 1;

export interface PortalFrame {
  axis: PortalAxis;
  /** The inside of the frame, which fills with portal. */
  cells: [number, number, number][];
}

const MAX = 21;
const fillable = (id: number) => id === B.AIR || id === B.FIRE;

/**
 * The frame around x,y,z, if the cell is the inside of a complete obsidian
 * frame: two to twenty-one wide, three to twenty-one tall, corners optional,
 * as in the original. Tries both axes.
 */
export function findPortalFrame(get: Get, x: number, y: number, z: number): PortalFrame | null {
  if (!fillable(get(x, y, z))) return null;
  for (const axis of [0, 1] as PortalAxis[]) {
    const f = frameOnAxis(get, x, y, z, axis);
    if (f) return f;
  }
  return null;
}

function frameOnAxis(get: Get, x: number, y: number, z: number, axis: PortalAxis): PortalFrame | null {
  const [dx, dz] = axis === 0 ? [1, 0] : [0, 1];
  const at = (i: number, h: number, by: number, ox: number, oz: number) => get(ox + dx * i, by + h, oz + dz * i);
  // Down to the frame's floor.
  let by = y;
  for (let n = 0; n < MAX && fillable(get(x, by - 1, z)); n++) by--;
  if (get(x, by - 1, z) !== B.OBSIDIAN) return null;
  // Out to both sides.
  let left = 0;
  while (left < MAX && fillable(at(-left - 1, 0, by, x, z))) left++;
  let right = 0;
  while (right < MAX && fillable(at(right + 1, 0, by, x, z))) right++;
  const width = left + right + 1;
  if (width < 2 || width > MAX) return null;
  const ox = x - dx * left, oz = z - dz * left;
  if (at(-1, 0, by, ox, oz) !== B.OBSIDIAN || at(width, 0, by, ox, oz) !== B.OBSIDIAN) return null;
  for (let i = 0; i < width; i++) if (at(i, -1, by, ox, oz) !== B.OBSIDIAN) return null;
  // Up, a row at a time, until a row of obsidian closes the top.
  let height = 0;
  for (; height <= MAX; height++) {
    const closed = [...Array(width).keys()].every((i) => at(i, height, by, ox, oz) === B.OBSIDIAN);
    if (closed) break;
    for (let i = 0; i < width; i++) if (!fillable(at(i, height, by, ox, oz))) return null;
    if (at(-1, height, by, ox, oz) !== B.OBSIDIAN || at(width, height, by, ox, oz) !== B.OBSIDIAN) return null;
  }
  if (height < 3 || height > MAX) return null;
  const cells: [number, number, number][] = [];
  for (let h = 0; h < height; h++) for (let i = 0; i < width; i++) cells.push([ox + dx * i, by + h, oz + dz * i]);
  return { axis, cells };
}

/** Whether a portal block still has portal or obsidian on all four sides of its sheet. */
export function portalHolds(get: Get, x: number, y: number, z: number, axis: PortalAxis): boolean {
  const [dx, dz] = axis === 0 ? [1, 0] : [0, 1];
  const ok = (id: number) => id === B.NETHER_PORTAL || id === B.OBSIDIAN || id < 0;
  return ok(get(x, y + 1, z)) && ok(get(x, y - 1, z)) && ok(get(x + dx, y, z + dz)) && ok(get(x - dx, y, z - dz));
}

export interface PortalPlan {
  /** The bottom-left inner cell; the portal is two wide and three tall from here. */
  x: number; y: number; z: number;
  axis: PortalAxis;
  /** Every block to set, frame and all. */
  blocks: [number, number, number, number, number][];
}

/**
 * Where a new portal goes near (x, y, z): the nearest spot, spiralling out
 * over `radius`, with solid ground under a four-wide frame and room for it.
 * With none, it is forced in at the target — standing on an obsidian ledge,
 * cut out of whatever was there — so arriving never fails.
 */
export function planPortal(
  get: Get, x: number, y: number, z: number, axis: PortalAxis, radius: number, yMin: number, yMax: number,
): PortalPlan {
  const [dx, dz] = axis === 0 ? [1, 0] : [0, 1];
  const [px, pz] = axis === 0 ? [0, 1] : [1, 0];
  const air = (id: number) => id === 0 || (id > 0 && block(id).replaceable && id !== B.WATER && id !== B.LAVA);
  const fits = (bx: number, by: number, bz: number) => {
    for (let i = -1; i <= 2; i++) {
      const cx = bx + dx * i, cz = bz + dz * i;
      if (!block(get(cx, by - 1, cz)).solid) return false;
      for (let h = 0; h <= 4; h++) if (!air(get(cx, by + h, cz))) return false;
    }
    // Room to step out on at least one side.
    const side = (s: number) => [0, 1].every((i) => air(get(bx + dx * i + px * s, by, bz + dz * i + pz * s)) && air(get(bx + dx * i + px * s, by + 1, bz + dz * i + pz * s)));
    return side(1) || side(-1);
  };
  const cy = Math.max(yMin, Math.min(yMax, Math.floor(y)));
  for (let r = 0; r <= radius; r++) {
    for (let oz = -r; oz <= r; oz++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
      for (let k = 0; k <= yMax - yMin; k++) {
        const by = cy + (k % 2 === 0 ? k / 2 : -(k + 1) / 2);
        if (by < yMin || by > yMax) continue;
        if (get(x + ox, by, z + oz) < 0) continue;
        if (fits(x + ox, by, z + oz)) return plan(x + ox, by, z + oz, axis, false);
      }
    }
  }
  return plan(Math.floor(x), cy, Math.floor(z), axis, true);
}

function plan(x: number, y: number, z: number, axis: PortalAxis, forced: boolean): PortalPlan {
  const [dx, dz] = axis === 0 ? [1, 0] : [0, 1];
  const [px, pz] = axis === 0 ? [0, 1] : [1, 0];
  const out: [number, number, number, number, number][] = [];
  if (forced) {
    // Clear the space and lay a ledge either side to stand on.
    for (let i = -1; i <= 2; i++) for (const s of [-1, 0, 1]) {
      const cx = x + dx * i + px * s, cz = z + dz * i + pz * s;
      out.push([cx, y - 1, cz, B.OBSIDIAN, 0]);
      for (let h = 0; h <= 4; h++) out.push([cx, y + h, cz, B.AIR, 0]);
    }
  }
  for (let i = -1; i <= 2; i++) {
    for (let h = -1; h <= 3; h++) {
      const frame = i === -1 || i === 2 || h === -1 || h === 3;
      out.push([x + dx * i, y + h, z + dz * i, frame ? B.OBSIDIAN : B.NETHER_PORTAL, frame ? 0 : axis]);
    }
  }
  return { x, y, z, axis, blocks: out };
}
