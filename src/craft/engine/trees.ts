/**
 * Tree and plant builders.
 *
 * A builder never writes a block directly; it calls `place`, which the
 * generator clips to the chunk being built and which refuses to overwrite
 * anything solid. That is what lets a tree whose trunk stands in one chunk put
 * its leaves into the next: each chunk replays the trees of its eight
 * neighbours and keeps only the blocks that land inside itself, so the two
 * halves agree without either chunk having to wait for the other.
 */
import { B } from "./blocks";
import type { TreeKind } from "./biomes";
import type { Rng } from "./rng";

/** Places a block if the target is replaceable. `force` lets trunks cut through leaves. */
export type Place = (x: number, y: number, z: number, id: number, meta?: number, force?: boolean) => void;

function blob(place: Place, cx: number, cy: number, cz: number, radius: number, leaves: number, rng: Rng, fuzz = 0.35): void {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy * 1.4 + dz * dz);
        if (d <= radius - rng.next() * fuzz) place(cx + dx, cy + dy, cz + dz, leaves);
      }
    }
  }
}

function classicCanopy(place: Place, x: number, top: number, z: number, leaves: number, rng: Rng): void {
  for (let y = top - 3; y <= top + 1; y++) {
    const layer = y - top;
    const radius = layer >= 0 ? 1 : 2;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        // Corners are dropped at random on the lower layers and always on the top,
        // which is what gives the classic tree its rounded look.
        if (corner && (layer >= 0 || rng.next() < 0.5)) continue;
        place(x + dx, y, z + dz, leaves);
      }
    }
  }
}

export function buildTree(kind: TreeKind, place: Place, x: number, y: number, z: number, rng: Rng): void {
  switch (kind) {
    case "oak":
    case "birch": {
      const log = kind === "oak" ? B.OAK_LOG : B.BIRCH_LOG;
      const leaves = kind === "oak" ? B.OAK_LEAVES : B.BIRCH_LEAVES;
      const h = (kind === "birch" ? 5 : 4) + rng.int(3);
      place(x, y - 1, z, B.DIRT, 0, true);
      classicCanopy(place, x, y + h - 1, z, leaves, rng);
      for (let i = 0; i < h; i++) place(x, y + i, z, log, 0, true);
      return;
    }
    case "big_oak": {
      const h = 7 + rng.int(4);
      place(x, y - 1, z, B.DIRT, 0, true);
      const branches = 2 + rng.int(3);
      for (let b = 0; b < branches; b++) {
        const by = y + 4 + rng.int(h - 4);
        const angle = rng.next() * Math.PI * 2;
        const len = 2 + rng.int(3);
        let bx = x, bz = z;
        for (let i = 1; i <= len; i++) {
          bx = Math.round(x + Math.cos(angle) * i);
          bz = Math.round(z + Math.sin(angle) * i);
          place(bx, by + Math.floor(i / 2), bz, B.OAK_LOG, Math.abs(Math.cos(angle)) > 0.7 ? 1 : 2, true);
        }
        blob(place, bx, by + Math.floor(len / 2) + 1, bz, 2.6, B.OAK_LEAVES, rng);
      }
      blob(place, x, y + h, z, 3.2, B.OAK_LEAVES, rng);
      for (let i = 0; i < h; i++) place(x, y + i, z, B.OAK_LOG, 0, true);
      return;
    }
    case "dark_oak": {
      const h = 6 + rng.int(3);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) place(x + dx, y - 1, z + dz, B.DIRT, 0, true);
      for (let dy = -1; dy <= 1; dy++) {
        const r = dy === 1 ? 2 : 3;
        for (let dz = -r; dz <= r + 1; dz++) {
          for (let dx = -r; dx <= r + 1; dx++) {
            if ((Math.abs(dx - 0.5) > r - 0.2 && Math.abs(dz - 0.5) > r - 0.2) && rng.next() < 0.7) continue;
            place(x + dx, y + h + dy, z + dz, B.OAK_LEAVES);
          }
        }
      }
      for (let i = 0; i < h; i++) {
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) place(x + dx, y + i, z + dz, B.OAK_LOG, 0, true);
      }
      return;
    }
    case "spruce": {
      const h = 6 + rng.int(4);
      place(x, y - 1, z, B.DIRT, 0, true);
      const bottom = 2 + rng.int(2);
      let radius = 0;
      for (let yy = y + h; yy >= y + bottom; yy--) {
        const fromTop = y + h - yy;
        radius = fromTop === 0 ? 0 : fromTop % 2 === 1 ? Math.min(3, 1 + Math.floor(fromTop / 3)) : Math.max(1, radius - 1);
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (radius > 0 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
            place(x + dx, yy, z + dz, B.SPRUCE_LEAVES);
          }
        }
      }
      place(x, y + h + 1, z, B.SPRUCE_LEAVES);
      for (let i = 0; i < h; i++) place(x, y + i, z, B.SPRUCE_LOG, 0, true);
      return;
    }
    case "jungle": {
      const h = 8 + rng.int(6);
      place(x, y - 1, z, B.DIRT, 0, true);
      blob(place, x, y + h, z, 3.4, B.JUNGLE_LEAVES, rng, 0.5);
      for (let i = 0; i < 2; i++) {
        const by = y + h - 3 - rng.int(3);
        const dx = rng.next() < 0.5 ? -1 : 1, dz = rng.next() < 0.5 ? -1 : 1;
        place(x + dx, by, z + dz, B.JUNGLE_LOG, 1, true);
        blob(place, x + dx * 2, by + 1, z + dz * 2, 2, B.JUNGLE_LEAVES, rng);
      }
      for (let i = 0; i < h; i++) place(x, y + i, z, B.JUNGLE_LOG, 0, true);
      return;
    }
    case "bush": {
      place(x, y, z, B.JUNGLE_LOG, 0, true);
      blob(place, x, y + 1, z, 2.1, B.OAK_LEAVES, rng, 0.6);
      return;
    }
    case "acacia": {
      const h = 5 + rng.int(3);
      place(x, y - 1, z, B.DIRT, 0, true);
      const lean = rng.int(4);
      const [lx, lz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][lean];
      let tx = x, tz = z;
      const bend = 2 + rng.int(2);
      for (let i = 0; i < h; i++) {
        if (i >= bend) { tx += lx; tz += lz; }
        place(tx, y + i, tz, B.ACACIA_LOG, 0, true);
      }
      const top = y + h;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 4) continue;
          place(tx + dx, top, tz + dz, B.ACACIA_LEAVES);
          if (Math.abs(dx) + Math.abs(dz) <= 1) place(tx + dx, top + 1, tz + dz, B.ACACIA_LEAVES);
        }
      }
      return;
    }
  }
}

/** Grows a sapling into its tree in a live world. Returns the kind grown. */
export function saplingTree(saplingId: number, rng: Rng): TreeKind {
  switch (saplingId) {
    case B.BIRCH_SAPLING: return "birch";
    case B.SPRUCE_SAPLING: return "spruce";
    case B.JUNGLE_SAPLING: return "jungle";
    case B.ACACIA_SAPLING: return "acacia";
    default: return rng.next() < 0.1 ? "big_oak" : "oak";
  }
}
