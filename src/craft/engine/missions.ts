/**
 * Missions: jobs from the city's contacts, after the crime-sandbox games'
 * phone calls and mission markers. Four contacts, three jobs each, played in
 * order; each is one of four kinds:
 *
 *  - a delivery: pick something up here, drop it there, against the clock;
 *  - a boost: steal a particular car and bring it to a garage in one piece
 *    (the buyer pays less for dents);
 *  - a hit: somebody with a name over their head, and friends;
 *  - a race: a line of checkpoints through the streets.
 *
 * Everything a mission needs — where the package is, which lot the car is
 * parked in, the checkpoints — is worked out here from the city and a seed,
 * so the mission is a plan the city runtime (modes/cityModes.ts) can play
 * out, and tests can check without a game.
 */
import { CAR_MODELS, type CarModelId } from "./cars";
import { City, LOT, PITCH, ROAD, STREET, type District, type LandmarkKind } from "./city";
import { hash4 } from "./rng";

export type MissionKind = "delivery" | "boost" | "hit" | "race";

/** Where something is: a landmark's door, or a lot in some district. */
export type Place = { landmark: LandmarkKind } | { district: District };

export interface MissionDef {
  id: string;
  name: string;
  kind: MissionKind;
  /** What the contact says when they hand it over, and when it is done. */
  brief: string[];
  pass: string;
  pay: number;
  /** Seconds allowed; 0 for no clock. */
  seconds: number;
  /** The pick-up (a delivery), where the car waits (a boost), or where the target stands (a hit). */
  from?: Place;
  /** The drop-off (a delivery or a boost). */
  to?: Place;
  /** What is carried, for the objective line. */
  cargo?: string;
  car?: CarModelId;
  target?: string;
  guards?: number;
  checkpoints?: number;
  /** Heat the job starts with (stealing from the police is noticed). */
  heat?: number;
}

export interface Contact {
  id: string;
  name: string;
  color: string;
  /** Who they are, in a line, for the lore. */
  blurb: string;
  /** Where to find them. */
  at: Place;
  missions: MissionDef[];
}

export const CONTACTS: readonly Contact[] = [
  {
    id: "stonks", name: "Big Stonks", color: "#7aff9a", at: { landmark: "tower" },
    blurb: "Crypto bro, loan shark, owner of the Stonks Tower. Number go up is not a slogan to him; it is a religion.",
    missions: [
      { id: "paper_hands", name: "Paper Hands", kind: "hit", target: "Paper Hands Pete", guards: 1, from: { district: "park" }, pay: 800, seconds: 180,
        brief: ["Some clown sold my coin at the bottom.", "Paper Hands Pete. He's touching grass in the park like he's got nothing to worry about.", "Give him something to worry about."],
        pass: "Diamond hands only in this family. Here's your cut." },
      { id: "pump_it", name: "Pump It", kind: "delivery", cargo: "the whitepaper", from: { landmark: "casino" }, to: { district: "docks" }, pay: 1200, seconds: 110,
        brief: ["The whitepaper for my new coin is at the Lucky Doge.", "It's three pages. Two of them are memes.", "Get it to my guy at the docks before the hype dies. Hype dies fast."],
        pass: "Coin's up four thousand percent. Don't ask me what it does." },
      { id: "rug_pull", name: "Rug Pull", kind: "boost", car: "super", from: { district: "villas" }, to: { district: "docks" }, pay: 5000, seconds: 0,
        brief: ["My investors want their money back. Rude.", "One of them parked a Wen Lambo up in Rizz Hills.", "Bring it to the docks. That's what we call a partial refund."],
        pass: "And that, kid, is what the pros call a rug pull. Stonks." },
    ],
  },
  {
    id: "chad", name: "Chad Thunderchin", color: "#ffb03a", at: { district: "beach" },
    blurb: "Gym bro, street racer, jawline you could park on. Has never once skipped leg day, or a red light.",
    missions: [
      { id: "leg_day", name: "Leg Day", kind: "race", checkpoints: 6, pay: 600, seconds: 75,
        brief: ["Bro. BRO. You look like you skip leg day.", "Prove me wrong. Six checkpoints, seventy-five seconds.", "Any car. Pedal to the metal is a leg exercise."],
        pass: "Okay, okay. Respect. Your quads are valid." },
      { id: "protein_run", name: "Protein Run", kind: "delivery", cargo: "a crate of protein shakes", from: { district: "midtown" }, to: { district: "beach" }, pay: 900, seconds: 80,
        brief: ["The gains are MELTING, bro.", "There's a crate of shakes at the warehouse. Get it to the beach before it curdles.", "Every second you waste is a bicep I lose."],
        pass: "*chugs* We're so back." },
      { id: "alpha_race", name: "Alpha Race", kind: "race", checkpoints: 12, pay: 2500, seconds: 160,
        brief: ["Final boss energy, bro. The whole city.", "Twelve checkpoints. The Neon Bay Grand Prix, unofficially.", "Win this and you're a sigma. Lose and you're a beta. No pressure."],
        pass: "Sigma grindset, confirmed. I'm literally crying, bro." },
    ],
  },
  {
    id: "glitch", name: "Grandma Glitch", color: "#c89aff", at: { district: "little" },
    blurb: "Seventy-eight, a hacker since the modem screamed, and the only person in Little Stonkville whose password is not 'password'.",
    missions: [
      { id: "tech_support", name: "Tech Support", kind: "delivery", cargo: "Grandma's USB stick", from: { district: "little" }, to: { landmark: "mall" }, pay: 500, seconds: 120,
        brief: ["Hello dear. Be a sweetheart and run this USB stick to the Mall of Copium.", "Don't plug it into anything. It bites.", "And don't dawdle, the cookies are in the oven."],
        pass: "Wonderful. The mall's wifi is mine now. Have a cookie, and some cash." },
      { id: "scam_likely", name: "Scam Likely", kind: "hit", target: "Kevin from Tech Support", guards: 2, from: { district: "midtown" }, pay: 1100, seconds: 200,
        brief: ["A young man called me about my 'car's extended warranty'.", "I traced the call. He's in Mid Town, with two friends.", "Explain to him, firmly, that Grandma doesn't have a car. She has you."],
        pass: "He won't be calling anyone for a while. Now, who wants tea?" },
      { id: "firewall", name: "Firewall", kind: "boost", car: "police", from: { landmark: "police" }, to: { district: "little" }, heat: 250, pay: 4000, seconds: 0,
        brief: ["The NBPD's cruisers run on software older than me.", "Borrow one from the station and bring it to my garage. I want to read its mind.", "They will notice, dear. Drive like you mean it."],
        pass: "Oh, look at all these files. The Chief has a lot of cat pictures." },
    ],
  },
  {
    id: "doge", name: "Detective Doge", color: "#ffe25a", at: { landmark: "police" },
    blurb: "The NBPD's finest, a very good boy with a badge. Such justice. Very crime. Wow. Asks no questions about who does his legwork.",
    missions: [
      { id: "much_evidence", name: "Much Evidence", kind: "delivery", cargo: "the evidence bag", from: { district: "docks" }, to: { landmark: "police" }, pay: 700, seconds: 120,
        brief: ["Such case. Very evidence. It's in a bag at the docks.", "Bring it here before the lawyers do.", "Wow."],
        pass: "Much justice. Here, a treat. I mean a payment." },
      { id: "very_stolen", name: "Very Stolen", kind: "boost", car: "van", from: { district: "docks" }, to: { landmark: "police" }, pay: 1500, seconds: 0,
        brief: ["Someone stole a van. It is white. It is unmarked. It is very sus.", "It's parked by the docks now. Bring it back to the station.", "Do not look in the back. Such secrets."],
        pass: "Van recovered. We looked in the back. We wish we had not." },
      { id: "wow", name: "Wow", kind: "hit", target: "Mr. Ratio", guards: 4, from: { district: "downtown" }, pay: 6000, seconds: 240,
        brief: ["The kingpin. Mr. Ratio. Runs every scam in Neon Bay.", "Downtown, with four goons. He has more followers than you, but not for long.", "Take him down. This is off the record. Very off. Wow."],
        pass: "Mr. Ratio: ratioed. The city owes you, and so does Doge. Wow." },
    ],
  },
];

export const ALL_MISSIONS = CONTACTS.flatMap((c) => c.missions.map((m) => ({ contact: c, mission: m })));

/** A lot's front door: the middle of its south side, on the sidewalk. */
export function lotDoor(city: City, i: number, j: number): [number, number, number] {
  const lot = city.lot(i, j);
  return [lot.x0 + Math.floor(LOT / 2) + 0.5, STREET, lot.z0 + LOT + 0.5];
}

/** Where a place is, picked by `salt` among the lots it could be (a district has many). */
export function placeSpot(city: City, place: Place, salt: number): [number, number, number] {
  if ("landmark" in place) {
    const d = city.landmarkDoor(place.landmark);
    if (d) return d;
  }
  const s = city.spec;
  const lots: [number, number][] = [];
  for (let i = 0; i < s.cols; i++) for (let j = 0; j < s.rows; j++) {
    if ("district" in place && s.district(i, j) === place.district && !s.landmarks.some((m) => m.i === i && m.j === j)) lots.push([i, j]);
  }
  if (!lots.length) return lotDoor(city, Math.floor(s.cols / 2), Math.floor(s.rows / 2));
  const [i, j] = lots[hash4(city.seed, salt, 71) % lots.length];
  return lotDoor(city, i, j);
}

/** Where a contact waits for you. */
export function contactSpot(city: City, c: Contact): [number, number, number] {
  return placeSpot(city, c.at, c.id.length * 1009 + c.id.charCodeAt(0));
}

/**
 * A street race: junction to neighbouring junction, never back the way it
 * came, starting at the one nearest the start. Each checkpoint is the middle
 * of a junction, where every car can reach it.
 */
export function raceRoute(city: City, x: number, z: number, count: number, random: () => number): [number, number, number][] {
  const s = city.spec;
  const clamp = (v: number, n: number) => Math.max(0, Math.min(n, v));
  let i = clamp(Math.round((x - s.x0 - ROAD / 2) / PITCH), s.cols), j = clamp(Math.round((z - s.z0 - ROAD / 2) / PITCH), s.rows);
  const out: [number, number, number][] = [];
  let pi = -1, pj = -1;
  for (let n = 0; n < count; n++) {
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => [i + di, j + dj]).filter(([a, b]) => a >= 0 && b >= 0 && a <= s.cols && b <= s.rows && !(a === pi && b === pj));
    const [ni, nj] = steps[Math.floor(random() * steps.length) % steps.length];
    pi = i; pj = j; i = ni; j = nj;
    out.push([s.x0 + i * PITCH + ROAD / 2, STREET, s.z0 + j * PITCH + ROAD / 2]);
  }
  return out;
}

/** What a boosted car pays, dented: the full rate for a clean car, a quarter for a smoking one. */
export function boostPay(pay: number, car: CarModelId, health: number): number {
  const f = Math.max(0, Math.min(1, health / CAR_MODELS[car].health));
  return Math.round(pay * (0.25 + 0.75 * f));
}

/** A contact's next job, given how many of theirs a player has done. */
export function nextMission(c: Contact, done: number): MissionDef | null {
  return c.missions[done] ?? null;
}
