/**
 * The casino's games, as plain rules and arithmetic: blackjack, European
 * roulette, a slot machine, Jacks or Better video poker, a lucky wheel, and
 * "Stonks" — the crash game, a line that climbs until it doesn't.
 *
 * The rules are the real ones where the games have real ones (blackjack pays
 * 3 to 2 and the dealer stands on soft 17; roulette has one zero; the poker
 * pays the "9/6" table), so they play as a player expects and the house edge
 * is the familiar small one. The slot machine and the wheel are this game's
 * own, their returns worked out exactly in the tests. Nothing here touches
 * the world or the screen: a game is state in, state out, with a random
 * source passed in, so every rule can be tested with loaded dice.
 *
 * Money is play money — the city's dollars — and never anything else.
 */

type Random = () => number;

// ---- cards ---------------------------------------------------------------------------------------------------

export interface Card { rank: number; suit: number }
export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const cardName = (c: Card): string => `${RANKS[c.rank]}${SUITS[c.suit]}`;
export const isRed = (c: Card): boolean => c.suit === 1 || c.suit === 2;

/** `decks` decks, shuffled (Fisher–Yates). */
export function shoe(decks: number, random: Random): Card[] {
  const out: Card[] = [];
  for (let d = 0; d < decks; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) out.push({ rank: r, suit: s });
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---- blackjack ------------------------------------------------------------------------------------------------

export interface BjHand {
  cards: Card[];
  bet: number;
  done: boolean;
  doubled?: boolean;
  /** Came from a split: a split hand of 21 is not a blackjack, and split aces take one card each. */
  split?: boolean;
  result?: "blackjack" | "win" | "push" | "lose" | "bust";
  /** What the hand paid back, stake included. */
  paid?: number;
}

export interface Blackjack {
  shoe: Card[];
  dealer: Card[];
  hands: BjHand[];
  active: number;
  phase: "player" | "done";
}

/** A hand's best total, and whether an ace in it is still counting eleven. */
export function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) { const v = Math.min(10, c.rank); total += v === 1 ? 11 : v; if (v === 1) aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (h: BjHand): boolean => !h.split && h.cards.length === 2 && handValue(h.cards).total === 21;

const SHOE_DECKS = 6;
/** Reshuffle once the shoe runs this low, as a cut card would. */
const CUT = 60;

/** A new round: two cards each, the dealer's second face down. Naturals settle at once. */
export function bjDeal(bet: number, random: Random, prev?: Blackjack): Blackjack {
  const s = prev && prev.shoe.length > CUT ? prev.shoe : shoe(SHOE_DECKS, random);
  const draw = () => s.pop()!;
  const hand: BjHand = { cards: [draw()], bet, done: false };
  const dealer = [draw()];
  hand.cards.push(draw());
  dealer.push(draw());
  const g: Blackjack = { shoe: s, dealer, hands: [hand], active: 0, phase: "player" };
  // A natural on either side ends the round before anyone acts.
  if (isBlackjack(hand) || handValue(dealer).total === 21) { hand.done = true; settle(g); }
  return g;
}

function draw(g: Blackjack): Card {
  return g.shoe.pop() ?? shoe(1, Math.random)[0];
}

/** What the player may do with the hand in play. */
export function bjOptions(g: Blackjack): { hit: boolean; stand: boolean; double: boolean; split: boolean } {
  const h = g.hands[g.active];
  if (g.phase !== "player" || !h || h.done) return { hit: false, stand: false, double: false, split: false };
  const two = h.cards.length === 2;
  return {
    hit: true, stand: true, double: two,
    split: two && g.hands.length < 4 && Math.min(10, h.cards[0].rank) === Math.min(10, h.cards[1].rank),
  };
}

export function bjHit(g: Blackjack): void {
  const h = g.hands[g.active];
  if (!bjOptions(g).hit) return;
  h.cards.push(draw(g));
  if (handValue(h.cards).total >= 21) finishHand(g);
}

export function bjStand(g: Blackjack): void {
  if (!bjOptions(g).stand) return;
  finishHand(g);
}

/** Double the bet for exactly one more card. The caller has already taken the extra stake. */
export function bjDouble(g: Blackjack): void {
  const h = g.hands[g.active];
  if (!bjOptions(g).double) return;
  h.bet *= 2;
  h.doubled = true;
  h.cards.push(draw(g));
  finishHand(g);
}

/** Split a pair into two hands, each with the original bet (the caller takes the second stake). */
export function bjSplit(g: Blackjack): void {
  if (!bjOptions(g).split) return;
  const h = g.hands[g.active];
  const aces = h.cards[0].rank === 1;
  const second: BjHand = { cards: [h.cards.pop()!], bet: h.bet, done: false, split: true };
  h.split = true;
  h.cards.push(draw(g));
  second.cards.push(draw(g));
  g.hands.splice(g.active + 1, 0, second);
  // Split aces take one card each, and that is all.
  if (aces) { h.done = true; second.done = true; advance(g); }
  else if (handValue(h.cards).total === 21) finishHand(g);
}

function finishHand(g: Blackjack): void {
  g.hands[g.active].done = true;
  advance(g);
}

function advance(g: Blackjack): void {
  const next = g.hands.findIndex((h) => !h.done);
  if (next >= 0) { g.active = next; return; }
  // Every hand played: the dealer draws to 17, standing on a soft 17, unless every hand already bust.
  if (g.hands.some((h) => handValue(h.cards).total <= 21)) {
    while (handValue(g.dealer).total < 17) g.dealer.push(draw(g));
  }
  settle(g);
}

function settle(g: Blackjack): void {
  g.phase = "done";
  const d = handValue(g.dealer).total;
  const dealerBj = g.dealer.length === 2 && d === 21;
  for (const h of g.hands) {
    const v = handValue(h.cards).total;
    if (isBlackjack(h) && !dealerBj) { h.result = "blackjack"; h.paid = h.bet * 2.5; }
    else if (isBlackjack(h) && dealerBj) { h.result = "push"; h.paid = h.bet; }
    else if (v > 21) { h.result = "bust"; h.paid = 0; }
    else if (dealerBj) { h.result = "lose"; h.paid = 0; }
    else if (d > 21 || v > d) { h.result = "win"; h.paid = h.bet * 2; }
    else if (v === d) { h.result = "push"; h.paid = h.bet; }
    else { h.result = "lose"; h.paid = 0; }
  }
}

/** What the whole round paid back. */
export const bjPaid = (g: Blackjack): number => g.hands.reduce((t, h) => t + (h.paid ?? 0), 0);

// ---- roulette ----------------------------------------------------------------------------------------------------

/** The single-zero wheel, in order round the wheel (for the animation). */
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26] as const;
export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const pocketColor = (n: number): "red" | "black" | "green" => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");

export type RouletteKind = "straight" | "split" | "street" | "corner" | "sixline" | "dozen" | "column" | "red" | "black" | "odd" | "even" | "low" | "high";

export interface RouletteBet { kind: RouletteKind; numbers: number[]; amount: number; label: string }

/** A bet on these numbers: the payout follows from how many it covers (a straight 35 to 1 … an even chance 1 to 1). */
export function rouletteBet(kind: RouletteKind, amount: number, at = 0): RouletteBet {
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  let numbers: number[];
  let label: string;
  switch (kind) {
    case "straight": numbers = [at]; label = `${at}`; break;
    case "split": numbers = [at, at + 1]; label = `${at}/${at + 1}`; break;
    case "street": { const s = Math.floor((at - 1) / 3) * 3 + 1; numbers = range(s, s + 2); label = `Street ${s}–${s + 2}`; break; }
    case "corner": numbers = [at, at + 1, at + 3, at + 4]; label = `Corner ${at}`; break;
    case "sixline": { const s = Math.floor((at - 1) / 3) * 3 + 1; numbers = range(s, s + 5); label = `Six line ${s}–${s + 5}`; break; }
    case "dozen": numbers = range((at - 1) * 12 + 1, at * 12); label = `${["1st", "2nd", "3rd"][at - 1]} 12`; break;
    case "column": numbers = range(1, 36).filter((n) => (n - 1) % 3 === at - 1); label = `Column ${at}`; break;
    case "red": numbers = range(1, 36).filter((n) => REDS.has(n)); label = "Red"; break;
    case "black": numbers = range(1, 36).filter((n) => !REDS.has(n)); label = "Black"; break;
    case "odd": numbers = range(1, 36).filter((n) => n % 2 === 1); label = "Odd"; break;
    case "even": numbers = range(1, 36).filter((n) => n % 2 === 0); label = "Even"; break;
    case "low": numbers = range(1, 18); label = "1–18"; break;
    case "high": numbers = range(19, 36); label = "19–36"; break;
  }
  return { kind, numbers, amount, label };
}

/** Pays this many to one: 36 over the numbers covered, less the stake. */
export const roulettePays = (b: RouletteBet): number => 36 / b.numbers.length - 1;

export const spinWheel = (random: Random): number => Math.floor(random() * 37);

/** What a set of bets returns on a number, stakes included. */
export function rouletteReturn(bets: RouletteBet[], n: number): number {
  return bets.reduce((t, b) => t + (b.numbers.includes(n) ? b.amount * (roulettePays(b) + 1) : 0), 0);
}

// ---- the slot machine ----------------------------------------------------------------------------------------------

/** The reels' symbols. "stonks" is wild: it stands for anything, and three of it is the jackpot. */
export const SLOT_SYMBOLS = ["cherry", "lemon", "melon", "bell", "bar", "seven", "diamond", "stonks"] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** What three of a kind on a line pays, per coin on the line. */
export const SLOT_PAYS: Record<SlotSymbol, number> = { cherry: 8, lemon: 10, melon: 12, bell: 18, bar: 30, seven: 75, diamond: 150, stonks: 777 };
/** Cherries pay even alone or in a pair from the left. Tuned with the reels for a return of about 94.6%. */
export const CHERRY_PAYS = [0, 1, 3];

/** How often each symbol appears on a reel: common fruit, rare sevens, rarer diamonds, one wild. */
const REEL_WEIGHTS: Record<SlotSymbol, number> = { cherry: 5, lemon: 7, melon: 6, bell: 5, bar: 4, seven: 2, diamond: 1, stonks: 1 };

/** Each reel's strip, the same for all three but spread differently, so a line reads differently on each. */
export const REELS: SlotSymbol[][] = [0, 1, 2].map((r) => {
  const strip: SlotSymbol[] = [];
  for (const s of SLOT_SYMBOLS) for (let i = 0; i < REEL_WEIGHTS[s]; i++) strip.push(s);
  // Interleave deterministically so like symbols are not bunched (and each reel's order differs).
  const out: SlotSymbol[] = [];
  const step = [7, 11, 13][r];
  for (let i = 0; i < strip.length; i++) out.push(strip[(i * step) % strip.length]);
  return out;
});

/** The five lines: three rows, and the two diagonals — as the row each reel's symbol is read from. */
export const PAYLINES: [number, number, number][] = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];

/** What one line pays, per coin: three of a kind (wilds standing in), or cherries from the left. */
export function linePays(line: [SlotSymbol, SlotSymbol, SlotSymbol]): number {
  const [a, b, c] = line;
  if (a === "stonks" && b === "stonks" && c === "stonks") return SLOT_PAYS.stonks;
  const base = [a, b, c].find((s) => s !== "stonks");
  if (base && line.every((s) => s === base || s === "stonks")) return SLOT_PAYS[base];
  // Cherries count from the left only, and a wild does not make one.
  const cherries = a === "cherry" ? (b === "cherry" ? 2 : 1) : 0;
  return CHERRY_PAYS[cherries];
}

/** The window after a spin: for each reel, where it stopped; the three rows visible are that stop and the two after. */
export function slotWindow(stops: number[]): SlotSymbol[][] {
  return stops.map((s, r) => [0, 1, 2].map((row) => REELS[r][(s + row) % REELS[r].length]));
}

export interface SlotResult { stops: number[]; window: SlotSymbol[][]; wins: { line: number; pays: number }[]; paid: number }

/** One pull: `lines` lines played at `coin` each. */
export function spinSlots(coin: number, lines: number, random: Random): SlotResult {
  const stops = REELS.map((r) => Math.floor(random() * r.length));
  return slotResult(stops, coin, lines);
}

export function slotResult(stops: number[], coin: number, lines: number): SlotResult {
  const window = slotWindow(stops);
  const wins: { line: number; pays: number }[] = [];
  for (let l = 0; l < Math.min(lines, PAYLINES.length); l++) {
    const rows = PAYLINES[l];
    const pays = linePays([window[0][rows[0]], window[1][rows[1]], window[2][rows[2]]]);
    if (pays > 0) wins.push({ line: l, pays: pays * coin });
  }
  return { stops, window, wins, paid: wins.reduce((t, w) => t + w.pays, 0) };
}

/** The machine's exact long-run return on the middle line, every stop of every reel counted. */
export function slotReturn(lines = 1): number {
  let paid = 0, n = 0;
  const [a, b, c] = REELS;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) for (let k = 0; k < c.length; k++) {
    paid += slotResult([i, j, k], 1, lines).paid;
    n++;
  }
  return paid / (n * lines);
}

// ---- video poker (Jacks or Better, the "9/6" table) ------------------------------------------------------------------

export type PokerHand = "royal" | "straight_flush" | "four" | "full_house" | "flush" | "straight" | "three" | "two_pair" | "jacks" | "nothing";

export const POKER_NAMES: Record<PokerHand, string> = {
  royal: "Royal Flush", straight_flush: "Straight Flush", four: "Four of a Kind", full_house: "Full House", flush: "Flush",
  straight: "Straight", three: "Three of a Kind", two_pair: "Two Pair", jacks: "Jacks or Better", nothing: "",
};

/** Per coin bet; the royal's 800 is only at five coins (250 otherwise), as on a real machine. */
export const POKER_PAYS: Record<PokerHand, number> = {
  royal: 250, straight_flush: 50, four: 25, full_house: 9, flush: 6, straight: 4, three: 3, two_pair: 2, jacks: 1, nothing: 0,
};

export function pokerHand(cards: Card[]): PokerHand {
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.values()].sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = counts.size === 5;
  const wheel = unique && ranks.join() === "1,2,3,4,5";
  const broadway = unique && ranks.join() === "1,10,11,12,13";
  const straight = unique && (ranks[4] - ranks[0] === 4 || wheel || broadway);
  if (straight && flush) return broadway ? "royal" : "straight_flush";
  if (groups[0] === 4) return "four";
  if (groups[0] === 3 && groups[1] === 2) return "full_house";
  if (flush) return "flush";
  if (straight) return "straight";
  if (groups[0] === 3) return "three";
  if (groups[0] === 2 && groups[1] === 2) return "two_pair";
  if (groups[0] === 2) {
    const pair = [...counts.entries()].find(([, n]) => n === 2)![0];
    if (pair === 1 || pair >= 11) return "jacks";
  }
  return "nothing";
}

export function pokerPays(hand: PokerHand, coins: number): number {
  return hand === "royal" && coins >= 5 ? 800 * coins : POKER_PAYS[hand] * coins;
}

export interface VideoPoker { deck: Card[]; cards: Card[]; held: boolean[]; coins: number; phase: "hold" | "done"; hand?: PokerHand; paid?: number }

export function pokerDeal(coins: number, random: Random): VideoPoker {
  const deck = shoe(1, random);
  const cards = [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!];
  return { deck, cards, held: [false, false, false, false, false], coins, phase: "hold" };
}

/** Replaces every card not held, and settles. */
export function pokerDraw(v: VideoPoker): void {
  if (v.phase !== "hold") return;
  v.cards = v.cards.map((c, i) => (v.held[i] ? c : v.deck.pop()!));
  v.hand = pokerHand(v.cards);
  v.paid = pokerPays(v.hand, v.coins);
  v.phase = "done";
}

// ---- the lucky wheel -----------------------------------------------------------------------------------------------

/**
 * The lucky wheel: fifty-four slots marked with what they pay to one, like a
 * carnival "big six" — twenty-four ones down to a single 45, and one slot for
 * the house (0) that no bet covers. Bet on a mark; if the wheel stops on it,
 * you win that many times your stake (and keep the stake).
 */
export const WHEEL_SEGMENTS: number[] = (() => {
  const counts: [number, number][] = [[1, 24], [2, 15], [5, 7], [10, 4], [20, 2], [45, 1], [0, 1]];
  const out: number[] = [];
  for (const [v, n] of counts) for (let i = 0; i < n; i++) out.push(v);
  // Spread them round the rim, the big ones apart.
  const spread: number[] = [];
  const step = 23;
  for (let i = 0; i < out.length; i++) spread.push(out[(i * step) % out.length]);
  return spread;
})();

export const WHEEL_MARKS = [1, 2, 5, 10, 20, 45];

export function spinLuckyWheel(random: Random): number {
  return Math.floor(random() * WHEEL_SEGMENTS.length);
}

/** What a bet on a mark returns when the wheel stops at a slot, stake included. */
export function wheelReturn(mark: number, amount: number, slot: number): number {
  return WHEEL_SEGMENTS[slot] === mark ? amount * (mark + 1) : 0;
}

/** The exact return of betting on one mark, per unit staked. */
export function wheelRTP(mark: number): number {
  const hits = WHEEL_SEGMENTS.filter((v) => v === mark).length;
  return (hits * (mark + 1)) / WHEEL_SEGMENTS.length;
}

// ---- Stonks (the crash game) ---------------------------------------------------------------------------------------

/** The house's cut: one run in thirty-three crashes at once, and the rest are scaled to match. */
export const CRASH_EDGE = 0.03;

/**
 * Where a run crashes: a multiplier of at least 1, heavy-tailed — a fair
 * 1/(1-u) curve, scaled by the house edge. Cashing out at any target x wins
 * with probability (1 - edge) / x, so every target returns the same 97%.
 */
export function crashPoint(random: Random): number {
  const u = random();
  const x = (1 - CRASH_EDGE) / (1 - u);
  return Math.max(1, Math.floor(x * 100) / 100);
}

/** The multiplier `t` seconds into a run: slow at first, then away (doubling every ~6.6s). */
export const crashMultiplier = (t: number): number => Math.floor(Math.exp(0.105 * t) * 100) / 100;

/** Seconds until the multiplier reaches x. */
export const crashTimeFor = (x: number): number => Math.log(x) / 0.105;

// ---- the floor ---------------------------------------------------------------------------------------------------

export type CasinoGame = "lobby" | "slots" | "blackjack" | "roulette" | "poker" | "wheel" | "crash";

export const CASINO_GAMES: { id: Exclude<CasinoGame, "lobby">; name: string; blurb: string }[] = [
  { id: "slots", name: "Stonks Slots", blurb: "Three reels, five lines. Three Stonks pay 777 to one. The wild stands in for anything." },
  { id: "blackjack", name: "Blackjack", blurb: "Beat the dealer to 21. Naturals pay 3 to 2; double down, split pairs." },
  { id: "roulette", name: "Roulette", blurb: "One zero. Straight up pays 35 to 1; red or black, even money." },
  { id: "poker", name: "Jacks or Better", blurb: "Video poker, full-pay 9/6. Hold what you like and draw the rest." },
  { id: "wheel", name: "Wheel of Stonks", blurb: "Bet on a mark; if the wheel stops there, it pays up to 45 to 1." },
  { id: "crash", name: "Stonks", blurb: "Buy in and watch the line climb. Sell before it crashes. Or don't. Diamond hands." },
];

export const isCasinoGame = (v: unknown): v is CasinoGame => v === "lobby" || CASINO_GAMES.some((g) => g.id === v);
