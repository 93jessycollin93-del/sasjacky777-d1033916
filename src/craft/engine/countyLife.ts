/**
 * Ashgrove County's clock: what still works on a given day, and what the
 * television and the radio are saying about it. Pure functions of the seed
 * and the time, so every player in a world — and every test — agrees on the
 * morning the taps run dry.
 *
 * After the zombie survival sandboxes (Project Zomboid above all): the water
 * and the power stay on for the first days and then go, each on a day of the
 * world's own; the television carries the emergency broadcasts until the
 * power goes, and a battery radio hears the last of them after; food in a
 * fridge keeps while the fridge is cold. Everything said here is this game's
 * own invention.
 */
import { boardsOf, MAX_BOARDS, WINDOW_BROKEN, WINDOW_OPEN, withBoards } from "./countyBlocks";
import { hash4 } from "./rng";
import { PERISHABLE } from "./countyItems";

export const DAY_TICKS = 24000;

/** The day of the outbreak a world time falls on: 0 is the first. */
export const countyDay = (time: number): number => Math.floor(Math.max(0, time) / DAY_TICKS);
/** The hour of the day, 0..24 (time 0 is six in the morning, as the rest of the game has it). */
export const countyHour = (time: number): number => ((((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / 1000 + 6) % 24;

/** The day the water stops and the day the power goes: a week or two in, the water first. */
export function utilities(seed: number): { waterOffDay: number; powerOffDay: number } {
  const h = hash4(seed ^ 0x57a7e, 1, 2, 3) >>> 0;
  const waterOffDay = 6 + (h % 7);
  return { waterOffDay, powerOffDay: waterOffDay + 2 + ((h >>> 8) % 6) };
}

export const hasWater = (seed: number, time: number): boolean => countyDay(time) < utilities(seed).waterOffDay;
export const hasPower = (seed: number, time: number): boolean => countyDay(time) < utilities(seed).powerOffDay;

/** The day and hour a helicopter passes low over the county, drawing every one of the dead that hears it. */
export function helicopter(seed: number): { day: number; hour: number } {
  const h = hash4(seed ^ 0x4e11, 7, 7, 7) >>> 0;
  return { day: 3 + (h % 5), hour: 9 + ((h >>> 4) % 8) };
}

/**
 * Whether food found now has gone bad. A fridge keeps food three times as
 * long, but only while the power is on: from the day it goes, the fridge is
 * a cupboard. Food that does not spoil (tins, dry goods) never does.
 */
export function spoiled(item: string, day: number, inFridge: boolean, powerOffDay: number): boolean {
  const keeps = PERISHABLE[item];
  if (keeps === undefined) return false;
  if (!inFridge) return day >= keeps;
  const coldDays = Math.min(day, powerOffDay);
  return coldDays / 3 + (day - coldDays) >= keeps;
}

// ---- barricades and windows ------------------------------------------------------------------------------

/** A window's meta with the sash thrown up or pulled down; null when boards or broken glass leave nothing to slide. */
export function toggleWindow(meta: number): number | null {
  if (boardsOf(meta) > 0 || meta & WINDOW_BROKEN) return null;
  return meta ^ WINDOW_OPEN;
}

/** One more board nailed across; null when it is already fully boarded. A window is shut behind its boards. */
export function boardUp(meta: number, window: boolean): number | null {
  const n = boardsOf(meta);
  if (n >= MAX_BOARDS) return null;
  return withBoards(window ? meta & ~WINDOW_OPEN : meta, n + 1);
}

/** One board pried off; null when there are none. */
export function pryBoard(meta: number): number | null {
  const n = boardsOf(meta);
  return n > 0 ? withBoards(meta, n - 1) : null;
}

/** Nails a board takes: two, or one for someone who has read up on carpentry. */
export const nailsPerBoard = (carpenter: boolean): number => (carpenter ? 1 : 2);

// ---- broadcasts -------------------------------------------------------------------------------------------

/**
 * The emergency channel, day by day. The first days are the official line,
 * then the official line fraying, then a recording on a loop, then nothing.
 */
const TV: readonly string[][] = [
  [
    "CHANNEL 6 EMERGENCY: Residents of Ashgrove County are asked to remain indoors while health officials respond to an outbreak of a severe illness.",
    "Anyone who has been bitten or scratched in an altercation should report to the Millbrook clinic. Do not attempt to restrain an ill person yourself.",
    "The National Guard has established a perimeter around the county as a precaution. Roads out of the county are closed until further notice.",
  ],
  [
    "CHANNEL 6: The governor has extended the quarantine order. Supplies will be distributed from Camp Hadley. Please wait for instructions.",
    "Officials stress that the perimeter is for your protection. Do not approach the fence. Do not approach the soldiers.",
    "Keep doors and windows closed and locked. Keep noise to a minimum. The sick are drawn to sound.",
  ],
  [
    "CHANNEL 6: Distribution at Camp Hadley has been suspended. We repeat: do not travel to Camp Hadley.",
    "If someone in your household has become ill, you must leave them. We are sorry. You must leave them.",
    "The illness does not respond to antibiotics. There is no treatment. Protect yourself from bites.",
  ],
  [
    "[A test card. A tone. A slide reads: STAY INDOORS. AWAIT INSTRUCTIONS.]",
    "CHANNEL 6: ...cannot confirm reports from Westford. Anyone who can hear this, stay where you are...",
  ],
];

/** The battery radio's frequencies: the county's own emergency channel, and whoever else is still out there. */
const RADIO: readonly string[][] = [
  ["AM 1080, Ashgrove Emergency Radio: The quarantine is in effect. Remain in your homes. This message will repeat."],
  ["AM 1080: ...boil all water. Fill every container you have now. Utility service may be interrupted."],
  ["AM 1080: Service to the county's water and power grid cannot be guaranteed. Conserve fuel. Conserve batteries."],
  ["FM 94.3, a man's voice: \"This is Walt, on the farm off Route 9. If you can hear me, don't go to the camp. There's nobody at the camp.\""],
  ["FM 94.3: \"Walt again. Fence line's still manned on the east side. Don't try it. Board the ground floor, live upstairs, pull the ladder up.\""],
  ["FM 94.3: \"...got a helicopter over the river today. Didn't land. Just went round and round, and every one of them for miles followed it.\""],
  ["FM 94.3: \"Walt. Still here. Still here.\""],
];

/** What a set says, turned on at a given day: a line of it, chosen by the hour so it changes as you listen. */
export function broadcast(kind: "tv" | "radio", day: number, hour: number, powered: boolean): string {
  if (kind === "tv") {
    if (!powered) return "The screen stays black. There is no power.";
    const lines = TV[Math.min(day, TV.length - 1)];
    return lines[Math.floor(hour) % lines.length];
  }
  if (day >= RADIO.length + 3) return "Static, on every frequency.";
  const lines = RADIO[Math.min(day, RADIO.length - 1)];
  return lines[Math.floor(hour) % lines.length];
}

// ---- generators --------------------------------------------------------------------------------------------

/** How far a generator's extension cords reach, in blocks. */
export const GENERATOR_REACH = 12;
/** Seconds of running one full gas can buys, and the most its tank holds. */
export const GENERATOR_CAN = 1200;
export const GENERATOR_TANK = 3600;

// ---- reading -----------------------------------------------------------------------------------------------

/** What a skill's book teaches, in the county's rules: the lesson you come away with. */
export const SKILL_LESSON: Readonly<Record<string, string>> = {
  carpentry: "You can board up a window with one nail a plank now, not two.",
  first_aid: "Bandages and stitches do more in your hands now.",
  cooking: "You know your way round a kitchen.",
  electrical: "You understand wiring well enough to be dangerous.",
  mechanics: "Engines make more sense to you now.",
  farming: "You know what to plant, and when.",
  fishing: "You know where the fish are.",
  trapping: "You know how to set a snare.",
  foraging: "You know which berries not to eat.",
  metalworking: "You could weld, given a torch.",
  tailoring: "You can patch clothes properly now.",
};

/** The magazines that each teach one thing. */
export const READ_TEACHES: Readonly<Record<string, string>> = {
  generator_guide: "The Generator Guide: fuel, cables, and never, ever indoors. You can run a generator now.",
  weekend_builder: "Weekend Builder: a whole article on boarding up for storm season. One nail a plank is plenty.",
  country_cooking: "Country Cooking: canning, preserving, and what keeps without a fridge.",
  rod_and_reel: "Rod & Reel: where the bass hide in a slow river.",
  trappers_almanac: "Trapper's Almanac: snares, and where rabbits run.",
  wiring_made_easy: "Wiring Made Easy: fuses, breakers, and how a house is wired.",
  home_mechanic: "Home Mechanic: what's under a hood, and how to get it started without a key.",
};

/** What the rest of the reading matter is like. */
export const READ_IDLE: Readonly<Record<string, string>> = {
  newspaper: "The Ashgrove Courier, three days old: a school board meeting, the county fair, and on page six, \"Flu Cases Rise in Westford\".",
  comic_book: "A comic about a man who can talk to sharks. You read it twice.",
  paperback_novel: "A paperback thriller. The hero never once runs out of bullets.",
  crossword_book: "You do a crossword. Seven down is \"quarantine\". Of course it is.",
  playing_cards: "A few hands of solitaire. You lose, and deal again.",
  glossy_magazine: "Summer fashion and a celebrity wedding. It all seems very far away.",
};
