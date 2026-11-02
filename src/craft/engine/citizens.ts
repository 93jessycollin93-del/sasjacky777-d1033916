/**
 * The people of the city: they walk the sidewalks, cross at the zebras,
 * scatter at gunfire, and — one in five of them — swing back when struck.
 *
 * A citizen walks a straight line along the sidewalk and turns when the way
 * ahead stops being somewhere to walk: asphalt, water, a wall. That alone
 * sends them round the blocks the way pedestrians go, without a map of the
 * city — they only ever look at the block in front of them. The zebra
 * crossings count as sidewalk, so they cross where they should (and step
 * out in front of whoever is not looking).
 *
 * Their lines are the city's own. Everyone here talks like the internet.
 */
import { block } from "./blocks";
import { ASPHALT, CENTRE_LINE } from "./city";
import type { EntityContext } from "./entities";
import type { Mob } from "./mobs";
import { B } from "./blocks";

/** Said when bumped, shoved or struck. */
export const HURT_QUIPS = [
  "Bruh.", "Ratio.", "Touch grass!", "OK boomer.", "Skill issue.", "L + ratio.", "No cap, that hurt.", "Emotional damage!",
  "I'm literally shaking rn.", "Not the vibe.", "Main character energy, huh?", "Why are you like this?", "Sheesh!",
  "I'd like to speak to your manager!", "It's giving… assault.", "Mom, get the camera!", "Stonks: down.", "This is fine.",
];
/** Said running for their lives. */
export const PANIC_QUIPS = ["AAAAA!", "Not like this!", "I'm too young to get ratioed!", "Nope. Nope. Nope.", "Somebody call the NBPD!", "It's so over.", "We're so back— no we're not!"];
/** Said by somebody whose car you just took. */
export const CARJACK_QUIPS = [
  "My car! I just paid it off!", "Bro stole my whip!", "That's literally theft!", "My Midmobile! It had a full tank!",
  "One star. Would not get robbed again.", "I'm posting this on the group chat!", "Not my ride, fam!",
];
/** Said to nobody in particular, strolling. */
export const IDLE_QUIPS = [
  "Wen lambo?", "Just touched grass. Overrated.", "Is it Friday? It feels like Friday.", "Did you see the Stonks Tower light up?",
  "My horoscope said avoid cars today.", "I'm not lost, I'm exploring.", "Hodl.", "Vibe check: passed.", "Buy high, sell low. That's the way.",
];
/** Said by the ones who fight back. */
export const FIGHT_QUIPS = ["Square up!", "Oh, you wanna go?", "Catch these hands!", "Wrong neighbourhood, pal!", "1v1 me, bro."];

export const pick = <T,>(a: readonly T[], random: () => number): T => a[Math.floor(random() * a.length) % a.length];

/** One in five citizens swings back when struck; the rest run. Decided by who they are, so it holds across saves. */
export const toughCitizen = (m: Mob): boolean => m.id % 5 === 0;

/** Ground a pedestrian will walk on: anything but the road itself (the zebra crossings are theirs) and water. */
function walkable(ctx: EntityContext, x: number, y: number, z: number): boolean {
  const under = ctx.world.blockAt(x, y - 1, z);
  if (under === ASPHALT || under === CENTRE_LINE || under === B.WATER || under === 0) return false;
  const feet = ctx.world.blockAt(x, y, z), head = ctx.world.blockAt(x, y + 1, z);
  return !(feet && block(feet).solid) && !(head && block(head).solid) && feet !== B.WATER;
}

const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export function citizenAi(m: Mob, ctx: EntityContext, move: { forward: number; jump: boolean; yaw: number; speedMul: number }): void {
  const b = m.body;
  if (m.quipTicks > 0) m.quipTicks--;
  // Struck, a tough one turns on whoever did it.
  if (m.anger > 0 && m.chasePlayer(ctx, move, 1.35)) return;
  if (m.panic > 0) {
    m.panic--;
    if (m.panic % 40 === 39 && ctx.random() < 0.5) m.say(pick(PANIC_QUIPS, ctx.random));
    const from = m.scare ?? { x: b.x - Math.sin(m.yaw), z: b.z - Math.cos(m.yaw) };
    const a = Math.atan2(b.z - from.z, b.x - from.x);
    m.steer(ctx, move, b.x + Math.cos(a) * 8, b.z + Math.sin(a) * 8, false);
    move.speedMul = 2.2;
    return;
  }
  const s = (m.stroll ??= { dir: Math.floor(ctx.random() * 4), pause: 0 });
  if (s.pause > 0) {
    s.pause--;
    move.forward = 0;
    return;
  }
  if (ctx.random() < 1 / 900) {
    s.pause = 40 + Math.floor(ctx.random() * 80);
    if (ctx.random() < 0.3) m.say(pick(IDLE_QUIPS, ctx.random));
    return;
  }
  const x = Math.floor(b.x), y = Math.floor(b.y + 0.2), z = Math.floor(b.z);
  let [dx, dz] = DIRS[s.dir];
  const ahead = walkable(ctx, Math.floor(b.x + dx * 0.9), y, Math.floor(b.z + dz * 0.9));
  // At a corner (or now and then, where a side way opens) they turn; at a dead end, about face.
  if (!ahead || (ctx.random() < 1 / 120 && b.collidedH)) {
    const left = (s.dir + 3) % 4, right = (s.dir + 1) % 4;
    const options = [left, right].filter((d) => walkable(ctx, x + DIRS[d][0], y, z + DIRS[d][1]));
    s.dir = options.length ? options[Math.floor(ctx.random() * options.length)] : (s.dir + 2) % 4;
    [dx, dz] = DIRS[s.dir];
  }
  // Keep to the middle of the block row they walk along, so they do not graze the walls.
  const cx = dx === 0 ? x + 0.5 : b.x + dx * 4, cz = dz === 0 ? z + 0.5 : b.z + dz * 4;
  m.steer(ctx, move, cx, cz, false);
  move.speedMul = 0.75;
}
