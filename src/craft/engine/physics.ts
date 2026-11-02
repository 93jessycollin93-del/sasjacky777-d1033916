/**
 * Movement and collision for everything that walks, swims, climbs or falls.
 *
 * Runs at 20 ticks a second with the original game's constants — ground
 * friction 0.6, air drag 0.91, gravity 0.08 a tick, a 0.42 jump — so walking
 * speed, jump height and how far a sprint-jump carries all land where a
 * player's muscle memory expects. The renderer interpolates between ticks, so
 * a fixed 20 Hz simulation still looks smooth at any frame rate.
 *
 * Collision is swept one axis at a time against the collision boxes of every
 * block the body could touch, Y first so landing wins over sliding.
 * Unloaded chunks collide as solid: a player who outruns chunk loading stops
 * at the edge rather than falling out of the world.
 */
import { block, collisionBoxes, B, type Box } from "./blocks";
import { WORLD_HEIGHT } from "./constants";

export interface BlockReader {
  /** -1 when not loaded. */
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  width: number; height: number;
  onGround: boolean;
  collidedH: boolean;
  collidedV: boolean;
  inWater: boolean;
  inLava: boolean;
  eyesInWater: boolean;
  onLadder: boolean;
  inWeb: boolean;
  fallDistance: number;
  stepHeight: number;
  noClip: boolean;
  eyeHeight: number;
}

export function newBody(x: number, y: number, z: number, width: number, height: number, eyeHeight: number): Body {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, width, height, onGround: false, collidedH: false, collidedV: false,
    inWater: false, inLava: false, eyesInWater: false, onLadder: false, inWeb: false, fallDistance: 0,
    stepHeight: 0.6, noClip: false, eyeHeight,
  };
}

export function bodyBox(b: Body): AABB {
  const h = b.width / 2;
  return { minX: b.x - h, minY: b.y, minZ: b.z - h, maxX: b.x + h, maxY: b.y + b.height, maxZ: b.z + h };
}

const FULL: Box = [0, 0, 0, 16, 16, 16];

/** Every collision box within `box`, in world space. */
export function collectBoxes(world: BlockReader, box: AABB, out: AABB[] = []): AABB[] {
  out.length = 0;
  const x0 = Math.floor(box.minX), x1 = Math.floor(box.maxX);
  const y0 = Math.floor(box.minY) - 1, y1 = Math.floor(box.maxY);
  const z0 = Math.floor(box.minZ), z1 = Math.floor(box.maxZ);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        let boxes: Box[];
        if (y < 0) boxes = [FULL];
        else if (y >= WORLD_HEIGHT) continue;
        else {
          const id = world.getBlock(x, y, z);
          if (id < 0) boxes = [FULL];
          else if (id === 0) continue;
          else boxes = collisionBoxes(block(id), world.getMeta(x, y, z));
        }
        for (const bx of boxes) {
          const a: AABB = {
            minX: x + bx[0] / 16, minY: y + bx[1] / 16, minZ: z + bx[2] / 16,
            maxX: x + bx[3] / 16, maxY: y + bx[4] / 16, maxZ: z + bx[5] / 16,
          };
          if (a.maxX > box.minX && a.minX < box.maxX && a.maxY > box.minY && a.minY < box.maxY && a.maxZ > box.minZ && a.minZ < box.maxZ) out.push(a);
        }
      }
    }
  }
  return out;
}

const EPS = 1e-7;
const scratchBoxes: AABB[] = [];

function sweep(boxes: AABB[], me: AABB, axis: 0 | 1 | 2, d: number): number {
  for (const b of boxes) {
    if (axis !== 0 && (b.maxX <= me.minX + EPS || b.minX >= me.maxX - EPS)) continue;
    if (axis !== 1 && (b.maxY <= me.minY + EPS || b.minY >= me.maxY - EPS)) continue;
    if (axis !== 2 && (b.maxZ <= me.minZ + EPS || b.minZ >= me.maxZ - EPS)) continue;
    if (axis === 0) {
      if (d > 0 && b.minX >= me.maxX - EPS) d = Math.min(d, b.minX - me.maxX);
      else if (d < 0 && b.maxX <= me.minX + EPS) d = Math.max(d, b.maxX - me.minX);
    } else if (axis === 1) {
      if (d > 0 && b.minY >= me.maxY - EPS) d = Math.min(d, b.minY - me.maxY);
      else if (d < 0 && b.maxY <= me.minY + EPS) d = Math.max(d, b.maxY - me.minY);
    } else {
      if (d > 0 && b.minZ >= me.maxZ - EPS) d = Math.min(d, b.minZ - me.maxZ);
      else if (d < 0 && b.maxZ <= me.minZ + EPS) d = Math.max(d, b.maxZ - me.minZ);
    }
  }
  return d;
}

function shift(a: AABB, dx: number, dy: number, dz: number): void {
  a.minX += dx; a.maxX += dx; a.minY += dy; a.maxY += dy; a.minZ += dz; a.maxZ += dz;
}

function tryMove(world: BlockReader, box: AABB, dx: number, dy: number, dz: number): [number, number, number] {
  const reach: AABB = {
    minX: Math.min(box.minX, box.minX + dx), minY: Math.min(box.minY, box.minY + dy), minZ: Math.min(box.minZ, box.minZ + dz),
    maxX: Math.max(box.maxX, box.maxX + dx), maxY: Math.max(box.maxY, box.maxY + dy), maxZ: Math.max(box.maxZ, box.maxZ + dz),
  };
  const boxes = collectBoxes(world, reach, scratchBoxes);
  const me = { ...box };
  const ry = sweep(boxes, me, 1, dy); shift(me, 0, ry, 0);
  const rx = sweep(boxes, me, 0, dx); shift(me, rx, 0, 0);
  const rz = sweep(boxes, me, 2, dz);
  return [rx, ry, rz];
}

/** Whether the body standing here would have ground under it (for the sneak edge guard). */
function hasGroundUnder(world: BlockReader, b: Body, x: number, z: number): boolean {
  const h = b.width / 2;
  const probe: AABB = { minX: x - h, minY: b.y - 0.6, minZ: z - h, maxX: x + h, maxY: b.y - 0.001, maxZ: z + h };
  return collectBoxes(world, probe, []).length > 0;
}

/** Moves a body by (dx, dy, dz), stopping at whatever it hits. */
export function moveBody(world: BlockReader, b: Body, dx: number, dy: number, dz: number, sneakGuard = false): void {
  if (b.noClip) {
    b.x += dx; b.y += dy; b.z += dz;
    b.onGround = false; b.collidedH = false; b.collidedV = false;
    return;
  }
  if (b.inWeb) { dx *= 0.25; dy *= 0.05; dz *= 0.25; }
  // Sneaking on the ground never walks you off an edge.
  if (sneakGuard && b.onGround) {
    const step = 0.05;
    while (dx !== 0 && !hasGroundUnder(world, b, b.x + dx, b.z)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
    while (dz !== 0 && !hasGroundUnder(world, b, b.x, b.z + dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    while (dx !== 0 && dz !== 0 && !hasGroundUnder(world, b, b.x + dx, b.z + dz)) {
      dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    }
  }
  const box = bodyBox(b);
  let [rx, ry, rz] = tryMove(world, box, dx, dy, dz);
  let stepped = false;
  const blockedH = rx !== dx || rz !== dz;
  const grounded = b.onGround || (dy !== ry && dy < 0);
  if (blockedH && grounded && b.stepHeight > 0) {
    // Step up: lift, move across, settle back down; keep it if it went further.
    const up = tryMove(world, box, 0, b.stepHeight, 0);
    const lifted = { ...box }; shift(lifted, 0, up[1], 0);
    const across = tryMove(world, lifted, dx, 0, dz);
    shift(lifted, across[0], 0, across[2]);
    const down = tryMove(world, lifted, 0, -up[1] + (dy < 0 ? dy : 0), 0);
    const stepDist = across[0] * across[0] + across[2] * across[2];
    const flatDist = rx * rx + rz * rz;
    if (stepDist > flatDist + 1e-6) {
      rx = across[0]; rz = across[2]; ry = up[1] + down[1];
      stepped = true;
    }
  }
  b.x += rx; b.y += ry; b.z += rz;
  b.collidedH = rx !== dx || rz !== dz;
  b.collidedV = ry !== dy;
  b.onGround = (dy < 0 && ry !== dy) || stepped;
  if (rx !== dx) b.vx = 0;
  if (rz !== dz) b.vz = 0;
  if (ry !== dy) b.vy = 0;
}

/** Recomputes water, lava, ladder and cobweb contact from the blocks the body overlaps. */
export function senseEnvironment(world: BlockReader, b: Body): void {
  const box = bodyBox(b);
  b.inWater = false; b.inLava = false; b.onLadder = false; b.inWeb = false;
  const x0 = Math.floor(box.minX + 0.001), x1 = Math.floor(box.maxX - 0.001);
  const y0 = Math.floor(box.minY + 0.001), y1 = Math.floor(box.maxY - 0.001);
  const z0 = Math.floor(box.minZ + 0.001), z1 = Math.floor(box.maxZ - 0.001);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = world.getBlock(x, y, z);
        if (id <= 0) continue;
        if (id === B.WATER) {
          const surface = y + fluidSurface(world.getMeta(x, y, z), world.getBlock(x, y + 1, z) === B.WATER);
          if (box.minY < surface) b.inWater = true;
        } else if (id === B.LAVA) b.inLava = true;
        else if (id === B.COBWEB) b.inWeb = true;
      }
    }
  }
  const fx = Math.floor(b.x), fz = Math.floor(b.z), fy = Math.floor(b.y + 0.001);
  b.onLadder = block(Math.max(0, world.getBlock(fx, fy, fz))).climbable;
  const ey = b.y + b.eyeHeight;
  const eid = world.getBlock(Math.floor(b.x), Math.floor(ey), Math.floor(b.z));
  b.eyesInWater = eid === B.WATER && ey < Math.floor(ey) + fluidSurface(world.getMeta(Math.floor(b.x), Math.floor(ey), Math.floor(b.z)), world.getBlock(Math.floor(b.x), Math.floor(ey) + 1, Math.floor(b.z)) === B.WATER) + 0.02;
}

/** Height of a fluid's surface inside its block, 0..1. */
export function fluidSurface(meta: number, covered: boolean): number {
  if (covered) return 1;
  if (meta & 8) return 0.95;
  const level = meta & 7;
  return level === 0 ? 0.89 : Math.max(0.125, (8 - level) / 9);
}

/** The block under the body's feet, for friction and footstep sounds. */
export function groundBlock(world: BlockReader, b: Body): number {
  const id = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
  return id < 0 ? 0 : id;
}

export interface MoveInput {
  /** -1..1 */
  forward: number;
  strafe: number;
  yaw: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  flying: boolean;
  /** Base movement speed (0.1 for players). */
  speed: number;
  /** Swim upward when jump is held in water (players); mobs always float. */
  floats?: boolean;
  /** Levitation's level plus one (0 for none): gravity gives way to a steady climb. */
  levitation?: number;
}

export interface MoveResult {
  /** Fall distance at the moment of landing, or 0. */
  landedFrom: number;
  jumped: boolean;
  /** Horizontal distance covered, for hunger and footsteps. */
  moved: number;
}

/** One tick of walking, swimming, climbing or flying. */
export function travel(world: BlockReader, b: Body, input: MoveInput): MoveResult {
  senseEnvironment(world, b);
  const result: MoveResult = { landedFrom: 0, jumped: false, moved: 0 };
  let fwd = input.forward, str = input.strafe;
  const len = Math.hypot(fwd, str);
  if (len > 1) { fwd /= len; str /= len; }
  if (input.sneak && !input.flying) { fwd *= 0.3; str *= 0.3; }
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  // Forward is -z at yaw 0, matching the camera.
  const dirX = -sin * fwd + cos * str;
  const dirZ = -cos * fwd - sin * str;

  const startX = b.x, startZ = b.z;
  if (input.flying) {
    const accel = input.sprint ? 0.1 : 0.05;
    b.vx += dirX * accel; b.vz += dirZ * accel;
    if (input.jump) b.vy += 0.15;
    if (input.sneak) b.vy -= 0.15;
    moveBody(world, b, b.vx, b.vy, b.vz);
    b.vx *= 0.91; b.vz *= 0.91; b.vy *= 0.6;
    b.fallDistance = 0;
  } else if (b.inWater || b.inLava) {
    const accel = 0.02 * (input.sprint && b.inWater ? 1.5 : 1);
    b.vx += dirX * accel; b.vz += dirZ * accel;
    if (input.jump || input.floats) b.vy += 0.04;
    const prevY = b.y;
    moveBody(world, b, b.vx, b.vy, b.vz);
    const drag = b.inWater ? 0.8 : 0.5;
    b.vx *= drag; b.vz *= drag; b.vy = b.vy * drag - 0.02;
    // Climb out onto a bank: a nudge up when swimming into a wall at the surface.
    if (b.collidedH && !checkBlocked(world, b, b.vx, b.vy + 0.6 - b.y + prevY, b.vz)) b.vy = 0.3;
    b.fallDistance = 0;
  } else {
    const ground = b.onGround ? groundBlock(world, b) : 0;
    const slip = b.onGround ? block(ground).slipperiness ?? 0.6 : 1;
    const friction = slip * 0.91;
    const speed = input.speed * (input.sprint ? 1.3 : 1) * (block(ground).speedFactor ?? 1);
    // The original divides by slipperiness cubed (not friction): on normal ground
    // that makes acceleration equal the base speed, on ice a fraction of it.
    const accel = b.onGround ? speed * (0.21600002 / (slip * slip * slip)) : input.sprint ? 0.026 : 0.02;
    b.vx += dirX * accel; b.vz += dirZ * accel;
    if (input.jump && b.onGround) {
      b.vy = 0.42;
      result.jumped = true;
      if (input.sprint) { b.vx += -sin * 0.2; b.vz += -cos * 0.2; }
    }
    if (b.onLadder) {
      b.vx = Math.max(-0.15, Math.min(0.15, b.vx));
      b.vz = Math.max(-0.15, Math.min(0.15, b.vz));
      b.fallDistance = 0;
      if (b.vy < -0.15) b.vy = -0.15;
      if (input.sneak && b.vy < 0) b.vy = 0;
    }
    const wasGround = b.onGround;
    const falling = b.vy;
    moveBody(world, b, b.vx, b.vy, b.vz, input.sneak);
    if (b.onLadder && (b.collidedH || input.jump)) b.vy = 0.2;
    // A slime block throws back whatever lands on it, and the landing does not hurt — unless sneaking.
    if (b.onGround && !wasGround && !input.sneak && falling < -0.1 && groundBlock(world, b) === B.SLIME_BLOCK) {
      b.vy = -falling * 0.95;
      b.onGround = false;
      b.fallDistance = 0;
    } else if (b.onGround) {
      if (!wasGround && b.fallDistance > 0) result.landedFrom = b.fallDistance;
      b.fallDistance = 0;
    } else if (b.vy < 0) {
      b.fallDistance -= b.vy;
    }
    // Levitation eases toward a climb of a twentieth of a block a tick per level, as the original's.
    if (input.levitation) { b.vy += (0.05 * input.levitation - b.vy) * 0.2; b.fallDistance = 0; }
    else b.vy = (b.vy - 0.08) * 0.98;
    b.vx *= friction; b.vz *= friction;
  }
  if (b.y < -64) b.fallDistance = 0;
  result.moved = Math.hypot(b.x - startX, b.z - startZ);
  return result;
}

/**
 * A tick of elytra flight, the original's formula: gravity eased by how level
 * the glider is held, a dive turned into speed, a climb paid for with it, and
 * the heading swung toward the look. `boost` is a firework rocket pushing.
 * Returns the move, plus how hard a wall was hit (damage, 0 for none).
 * Pitch here is positive looking up — the original's is the other way round.
 */
export function glide(world: BlockReader, b: Body, yaw: number, pitch: number, boost: boolean): MoveResult & { wallHit: number } {
  senseEnvironment(world, b);
  const lx = -Math.sin(yaw) * Math.cos(pitch), ly = Math.sin(pitch), lz = -Math.cos(yaw) * Math.cos(pitch);
  if (boost) {
    b.vx += lx * 0.1 + (lx * 1.5 - b.vx) * 0.5;
    b.vy += ly * 0.1 + (ly * 1.5 - b.vy) * 0.5;
    b.vz += lz * 0.1 + (lz * 1.5 - b.vz) * 0.5;
  }
  const down = -pitch;
  const horiz = Math.hypot(lx, lz);
  const speedH = Math.hypot(b.vx, b.vz);
  let lift = Math.cos(down);
  lift = lift * lift * Math.min(1, Math.hypot(lx, ly, lz) / 0.4);
  b.vy += 0.08 * (-1 + lift * 0.75);
  if (b.vy < 0 && horiz > 0) {
    const d = b.vy * -0.1 * lift;
    b.vx += (lx * d) / horiz; b.vy += d; b.vz += (lz * d) / horiz;
  }
  if (down < 0 && horiz > 0) {
    const d = speedH * -Math.sin(down) * 0.04;
    b.vx -= (lx * d) / horiz; b.vy += d * 3.2; b.vz -= (lz * d) / horiz;
  }
  if (horiz > 0) {
    b.vx += ((lx / horiz) * speedH - b.vx) * 0.1;
    b.vz += ((lz / horiz) * speedH - b.vz) * 0.1;
  }
  b.vx *= 0.99; b.vy *= 0.98; b.vz *= 0.99;
  const before = Math.hypot(b.vx, b.vz);
  const startX = b.x, startZ = b.z;
  const wasGround = b.onGround;
  moveBody(world, b, b.vx, b.vy, b.vz);
  const result = { landedFrom: 0, jumped: false, moved: Math.hypot(b.x - startX, b.z - startZ), wallHit: 0 };
  if (b.collidedH) result.wallHit = Math.max(0, (before - Math.hypot(b.vx, b.vz)) * 10 - 3);
  // Fall distance only counts while dropping fast: a steady glide lands softly.
  if (b.vy > -0.5) b.fallDistance = Math.min(b.fallDistance, 1);
  else b.fallDistance -= b.vy;
  if (b.onGround && !wasGround) { result.landedFrom = b.fallDistance; b.fallDistance = 0; }
  return result;
}

function checkBlocked(world: BlockReader, b: Body, dx: number, dy: number, dz: number): boolean {
  const box = bodyBox(b);
  shift(box, dx, dy, dz);
  return collectBoxes(world, box, []).length > 0;
}

/** Whether an entity-sized box at this spot would overlap a solid block. */
export function boxBlocked(world: BlockReader, box: AABB): boolean {
  return collectBoxes(world, box, []).length > 0;
}

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

