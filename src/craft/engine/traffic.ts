/**
 * The traffic: cars the city drives, lane by lane.
 *
 * A traffic car follows its lane by steering at a point a few blocks ahead
 * on the lane's line (pure pursuit, the way a driver looks down the road
 * rather than at the bonnet). Coming up to a junction it decides where it is
 * going — on, left or right, never off the edge of the city — and the path
 * becomes the corner where its lane meets the new one: the look-ahead point
 * slides round that corner, so the car sweeps through a turn instead of
 * pivoting. A right turn's corner is near and tight; a left turn's is across
 * the junction, and wide, as they should be.
 *
 * It brakes for whatever is in front of it in its lane — a car, a person, a
 * player standing in the road — and leans on the horn if a player stays
 * there. Two cars can wait on each other at a junction forever, so a car
 * held up long enough by another car stops waiting and noses through.
 *
 * The brain only decides the pedals and the wheel; the car's own physics
 * (engine/cars.ts) does the driving, the same as for a player.
 */
import type { Car } from "./cars";
import { City, PITCH, ROAD, type Lane } from "./city";
import type { Entity, EntityContext, PlayerRef } from "./entities";

export interface TrafficState {
  lane: Lane;
  /** The lane after the next junction, once decided (null for straight on). */
  next: Lane | null;
  /** The junction (the crossing road's index) that decision was made for; -1 for none yet. */
  at: number;
  /** The speed it likes to drive at. */
  cruise: number;
  /** Ticks it has sat behind something; ticks left of ignoring other cars. */
  stuck: number;
  bold: number;
}

const fwd = (l: Lane): [number, number] => (l.axis === "z" ? [0, l.dir] : [l.dir, 0]);

/** A new brain for a car placed on a lane. */
export function newTraffic(lane: Lane, random: () => number): TrafficState {
  return { lane, next: null, at: -1, cruise: 0.36 + random() * 0.14, stuck: 0, bold: 0 };
}

/** How far along its own road a point is, and where the lane's line is across it. */
function along(l: Lane, x: number, z: number): number {
  return l.axis === "z" ? z : x;
}

/**
 * The next junction ahead on a lane: the crossing road's index, and where
 * (along the lane) the car enters it. Null past the city's last crossing.
 */
export function nextJunction(city: City, l: Lane, x: number, z: number): { road: number; entry: number } | null {
  const other = l.axis === "z" ? "x" : "z";
  const count = l.axis === "z" ? city.spec.rows : city.spec.cols;
  const a = along(l, x, z);
  if (l.dir === 1) {
    for (let m = 0; m <= count; m++) { const e = city.roadStart(other, m) + 2; if (e > a - 0.5) return { road: m, entry: e }; }
  } else {
    for (let m = count; m >= 0; m--) { const e = city.roadStart(other, m) + ROAD - 2; if (e < a + 0.5) return { road: m, entry: e }; }
  }
  return null;
}

/** Where a car on `l` may go at junction `m`: on, or onto the crossing road either way, wherever the road continues. */
export function choices(city: City, l: Lane, m: number): { lane: Lane | null; weight: number }[] {
  const other = l.axis === "z" ? "x" : "z";
  const count = l.axis === "z" ? city.spec.rows : city.spec.cols;
  const crossCount = l.axis === "z" ? city.spec.cols : city.spec.rows;
  const out: { lane: Lane | null; weight: number }[] = [];
  if ((l.dir === 1 && m < count) || (l.dir === -1 && m > 0)) out.push({ lane: null, weight: 5 });
  // Which way along the crossing road is a right turn: heading +z (south), right is -x (west); heading +x (east), right is +z.
  const rightDir = (l.axis === "z" ? -l.dir : l.dir) as 1 | -1;
  for (const dir of [1, -1] as const) {
    const canGo = dir === 1 ? l.road < crossCount : l.road > 0;
    if (canGo) out.push({ lane: { axis: other, road: m, dir }, weight: dir === rightDir ? 3 : 2 });
  }
  return out;
}

/** The corner where a lane's line meets the next lane's. */
function corner(city: City, from: Lane, to: Lane): [number, number] {
  const a = city.laneLine(from), b = city.laneLine(to);
  return from.axis === "z" ? [a, b] : [b, a];
}

/** Sets the car's pedals and wheel for this tick. */
export function trafficDrive(city: City, car: Car, st: TrafficState, ctx: EntityContext, near: readonly Entity[], players: readonly PlayerRef[]): void {
  const b = car.body;
  const speed = car.speed;
  const look = 3.5 + Math.abs(speed) * 7;
  let [dx, dz] = fwd(st.lane);

  // Decide the next junction's turn once it is near.
  const j = nextJunction(city, st.lane, b.x, b.z);
  if (j && j.road !== st.at && Math.abs(j.entry - along(st.lane, b.x, b.z)) < 16) {
    const opts = choices(city, st.lane, j.road);
    const total = opts.reduce((t, o) => t + o.weight, 0);
    let roll = ctx.random() * total;
    const pickd = opts.find((o) => (roll -= o.weight) < 0) ?? opts[0];
    st.next = pickd?.lane ?? null;
    st.at = j.road;
  }

  let tx: number, tz: number;
  let turning = false;
  if (st.next) {
    const [cx, cz] = corner(city, st.lane, st.next);
    const toCorner = (cx - b.x) * dx + (cz - b.z) * dz;
    if (toCorner <= 0.4) {
      // Round the corner: this is the lane now.
      st.lane = st.next;
      st.next = null;
      [dx, dz] = fwd(st.lane);
    } else {
      turning = toCorner < 12;
      if (toCorner > look) {
        const line = city.laneLine(st.lane);
        tx = st.lane.axis === "z" ? line : b.x + dx * look;
        tz = st.lane.axis === "z" ? b.z + dz * look : line;
      } else {
        const [ox, oz] = fwd(st.next);
        tx = cx + ox * (look - toCorner);
        tz = cz + oz * (look - toCorner);
      }
    }
  }
  if (tx! === undefined) {
    const line = city.laneLine(st.lane);
    tx = st.lane.axis === "z" ? line : b.x + dx * look;
    tz = st.lane.axis === "z" ? b.z + dz * look : line;
  }

  // The wheel: toward the look-ahead point.
  const want = Math.atan2(-(tx - b.x), -(tz - b.z));
  let diff = want - car.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const strafe = Math.max(-1, Math.min(1, -diff * 2.6));

  // The pedals: cruise, slower through a turn, and stop for what is ahead.
  let target = turning ? Math.min(st.cruise, 0.24) : st.cruise;
  const hx = -Math.sin(car.yaw), hz = -Math.cos(car.yaw);
  const reach = car.spec.l / 2 + 1.5 + Math.abs(speed) * 14;
  let blockedBy: "car" | "player" | "other" | null = null;
  const check = (x: number, z: number, y: number, w: number, what: "car" | "player" | "other") => {
    if (Math.abs(y - b.y) > 2) return;
    const rx = x - b.x, rz = z - b.z;
    const f = rx * hx + rz * hz, side = rx * -hz + rz * hx;
    if (f <= 0 || f > reach || Math.abs(side) > 1.2 + w / 2) return;
    const room = f - car.spec.l / 2 - w / 2 - 1;
    target = Math.min(target, Math.max(0, room / 14));
    if (room < 2 && (!blockedBy || what === "player")) blockedBy = what;
  };
  for (const e of near) {
    if (e === car || e.removed) continue;
    const isCar = e.kind === "car";
    if (isCar && st.bold > 0) continue;
    check(e.x, e.z, e.y, isCar ? 2 : e.body.width, isCar ? "car" : "other");
  }
  for (const p of players) if (!p.riding) check(p.x, p.z, p.y, p.width, "player");
  if (st.bold > 0) st.bold--;

  if (blockedBy && Math.abs(speed) < 0.05) {
    st.stuck++;
    if (blockedBy === "player" && st.stuck > 40 && st.stuck % 30 === 0) car.honk(ctx);
    if (blockedBy === "car" && st.stuck > 100) { st.bold = 40; st.stuck = 0; car.honk(ctx); }
  } else st.stuck = 0;

  const forward = speed < target - 0.03 ? 1 : speed > target + 0.06 ? -1 : 0;
  car.input = { forward, strafe: Math.abs(speed) < 0.02 && forward === 0 ? 0 : strafe, yaw: car.yaw, jump: false };
}

/** A lane and a point on it, somewhere a car can be dropped: between junctions, on a straight. */
export function laneSpot(city: City, random: () => number, near: { x: number; z: number }, minD: number, maxD: number): { lane: Lane; x: number; z: number; yaw: number } | null {
  for (let tries = 0; tries < 12; tries++) {
    const axis = random() < 0.5 ? "x" : "z";
    const count = axis === "z" ? city.spec.cols : city.spec.rows;
    const road = Math.floor(random() * (count + 1));
    const dir = (random() < 0.5 ? 1 : -1) as 1 | -1;
    const lane: Lane = { axis, road, dir };
    const line = city.laneLine(lane);
    const a = near[axis === "z" ? "z" : "x"] + (random() - 0.5) * 2 * maxD;
    // Keep off the junctions: mid-block only.
    const crossStart = axis === "z" ? city.spec.z0 : city.spec.x0;
    const t = ((a - crossStart) % PITCH + PITCH) % PITCH;
    if (t < ROAD + 3 || t > PITCH - 4) continue;
    const x = axis === "z" ? line : a, z = axis === "z" ? a : line;
    if (!city.inside(x, z)) continue;
    const d = Math.hypot(x - near.x, z - near.z);
    if (d < minD || d > maxD) continue;
    const yaw = axis === "z" ? (dir === 1 ? Math.PI : 0) : (dir === 1 ? -Math.PI / 2 : Math.PI / 2);
    return { lane, x, z, yaw };
  }
  return null;
}

/** A sidewalk point for a pedestrian: the middle of a sidewalk, somewhere between near and far. */
export function sidewalkSpot(city: City, random: () => number, near: { x: number; z: number }, minD: number, maxD: number): { x: number; z: number } | null {
  for (let tries = 0; tries < 12; tries++) {
    const a = random() * Math.PI * 2, d = minD + random() * (maxD - minD);
    const x = Math.floor(near.x + Math.cos(a) * d), z = Math.floor(near.z + Math.sin(a) * d);
    if (!city.inside(x, z)) continue;
    const ax = city.across(x, true), az = city.across(z, false);
    const onSide = (c: typeof ax) => !!c && "road" in c && (c.o === 0 || c.o === ROAD - 1);
    if (onSide(ax) || onSide(az)) return { x: x + 0.5, z: z + 0.5 };
  }
  return null;
}

/** The lane nearest a point, going the way a car there faces. */
export function laneNear(city: City, x: number, z: number, yaw: number): Lane {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const axis: "x" | "z" = Math.abs(fz) >= Math.abs(fx) ? "z" : "x";
  const dir = (axis === "z" ? (fz >= 0 ? 1 : -1) : (fx >= 0 ? 1 : -1)) as 1 | -1;
  const count = axis === "z" ? city.spec.cols : city.spec.rows;
  const across = axis === "z" ? x : z;
  let best = 0, bestD = Infinity;
  for (let k = 0; k <= count; k++) {
    const d = Math.abs(city.laneLine({ axis, road: k, dir }) - across);
    if (d < bestD) { bestD = d; best = k; }
  }
  return { axis, road: best, dir };
}
