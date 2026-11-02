import { describe, expect, it } from "vitest";
import { Rng } from "@/craft/engine/rng";
import {
  bjDeal, bjDouble, bjHit, bjOptions, bjPaid, bjSplit, bjStand, crashMultiplier, crashPoint, crashTimeFor, handValue, linePays, pokerDeal, pokerDraw, pokerHand,
  pokerPays, REELS, rouletteBet, roulettePays, rouletteReturn, shoe, slotResult, slotReturn, WHEEL, WHEEL_MARKS, WHEEL_SEGMENTS, wheelReturn, wheelRTP,
  type Blackjack, type Card,
} from "@/craft/engine/casino";

const c = (rank: number, suit = 0): Card => ({ rank, suit });

/** A blackjack round dealt from a shoe stacked so the cards come off in this order (player, dealer, player, dealer, then draws). */
function stacked(order: Card[], bet = 10): Blackjack {
  // The shoe is dealt from its end; pad it past the cut card so it is not reshuffled.
  const filler = Array.from({ length: 80 }, () => c(2, 3));
  const prev: Blackjack = { shoe: [...filler, ...order.slice().reverse()], dealer: [], hands: [], active: 0, phase: "done" };
  return bjDeal(bet, Math.random, prev);
}

describe("cards", () => {
  it("shuffles a full shoe of every card, once each per deck", () => {
    const s = shoe(2, () => new Rng(1).next());
    expect(s).toHaveLength(104);
    expect(new Set(s.map((k) => `${k.rank}${k.suit}`)).size).toBe(52);
  });

  it("counts an ace as eleven until that would bust the hand", () => {
    expect(handValue([c(1), c(6)])).toEqual({ total: 17, soft: true });
    expect(handValue([c(1), c(6), c(10)])).toEqual({ total: 17, soft: false });
    expect(handValue([c(1), c(1), c(9)])).toEqual({ total: 21, soft: true });
    expect(handValue([c(13), c(12)])).toEqual({ total: 20, soft: false });
  });
});

describe("blackjack", () => {
  it("pays a natural three to two, and settles it before anyone acts", () => {
    const g = stacked([c(1), c(9), c(13), c(7)]);
    expect(g.phase).toBe("done");
    expect(g.hands[0].result).toBe("blackjack");
    expect(bjPaid(g)).toBe(25);
  });

  it("pushes when both have a natural, and loses to the dealer's", () => {
    expect(bjPaid(stacked([c(1), c(1), c(13), c(12)]))).toBe(10);
    const g = stacked([c(10), c(1), c(9), c(13)]);
    expect(g.hands[0].result).toBe("lose");
  });

  it("has the dealer draw to seventeen, and stand on a soft seventeen", () => {
    const g = stacked([c(10), c(1), c(8), c(6), c(5)]);
    bjStand(g);
    // Ace and six is a soft seventeen: the dealer stands, and eighteen wins.
    expect(g.dealer).toHaveLength(2);
    expect(g.hands[0].result).toBe("win");
    expect(bjPaid(g)).toBe(20);
  });

  it("busts a hand over twenty-one without the dealer drawing", () => {
    const g = stacked([c(10), c(10), c(6), c(6), c(9), c(9)]);
    bjHit(g);
    expect(g.hands[0].result).toBe("bust");
    expect(g.dealer).toHaveLength(2);
    expect(bjPaid(g)).toBe(0);
  });

  it("doubles the bet for exactly one card", () => {
    const g = stacked([c(6), c(10), c(5), c(7), c(10), c(2)]);
    expect(bjOptions(g).double).toBe(true);
    bjDouble(g);
    expect(g.hands[0].cards).toHaveLength(3);
    expect(g.hands[0].bet).toBe(20);
    expect(g.phase).toBe("done");
    // 21 against the dealer's seventeen doubles the win.
    expect(bjPaid(g)).toBe(40);
  });

  it("splits a pair into two hands, and split aces take one card each", () => {
    const g = stacked([c(1, 0), c(10), c(1, 1), c(7), c(10), c(9)]);
    expect(bjOptions(g).split).toBe(true);
    bjSplit(g);
    expect(g.hands).toHaveLength(2);
    expect(g.hands.every((h) => h.cards.length === 2)).toBe(true);
    expect(g.phase).toBe("done");
    // A split ace and a ten is twenty-one, but not a blackjack: it pays even money.
    expect(g.hands[0].result).toBe("win");
    expect(g.hands[0].paid).toBe(20);
  });
});

describe("roulette", () => {
  it("pays each bet by how many numbers it covers", () => {
    expect(roulettePays(rouletteBet("straight", 1, 17))).toBe(35);
    expect(roulettePays(rouletteBet("split", 1, 17))).toBe(17);
    expect(roulettePays(rouletteBet("street", 1, 17))).toBe(11);
    expect(roulettePays(rouletteBet("corner", 1, 17))).toBe(8);
    expect(roulettePays(rouletteBet("sixline", 1, 16))).toBe(5);
    expect(roulettePays(rouletteBet("dozen", 1, 2))).toBe(2);
    expect(roulettePays(rouletteBet("column", 1, 3))).toBe(2);
    expect(roulettePays(rouletteBet("red", 1))).toBe(1);
  });

  it("returns the stake with the win, and zero beats every outside bet", () => {
    const bets = [rouletteBet("straight", 10, 7), rouletteBet("red", 10), rouletteBet("odd", 10)];
    expect(rouletteReturn(bets, 7)).toBe(360 + 20 + 20);
    expect(rouletteReturn(bets, 0)).toBe(0);
  });

  it("keeps the single-zero edge on every bet: 36 back for every 37 staked", () => {
    for (const b of [rouletteBet("straight", 1, 5), rouletteBet("corner", 1, 1), rouletteBet("dozen", 1, 3), rouletteBet("black", 1), rouletteBet("high", 1)]) {
      let back = 0;
      for (let n = 0; n <= 36; n++) back += rouletteReturn([b], n);
      expect(back / 37).toBeCloseTo(36 / 37, 10);
    }
    expect(new Set(WHEEL).size).toBe(37);
  });
});

describe("the slot machine", () => {
  it("pays three of a kind, lets the wild stand in, and counts cherries from the left", () => {
    expect(linePays(["bell", "bell", "bell"])).toBe(18);
    expect(linePays(["bell", "stonks", "bell"])).toBe(18);
    expect(linePays(["stonks", "stonks", "stonks"])).toBe(777);
    expect(linePays(["cherry", "cherry", "lemon"])).toBe(3);
    expect(linePays(["cherry", "lemon", "lemon"])).toBe(1);
    expect(linePays(["lemon", "cherry", "cherry"])).toBe(0);
  });

  it("returns a little under what it takes, as a fair machine does", () => {
    const rtp = slotReturn(1);
    expect(rtp).toBeGreaterThan(0.93);
    expect(rtp).toBeLessThan(0.97);
  });

  it("reads each line across the window and adds up every win", () => {
    const r = slotResult(REELS.map(() => 0), 1, 5);
    expect(r.window).toHaveLength(3);
    expect(r.paid).toBe(r.wins.reduce((t, w) => t + w.pays, 0));
  });
});

describe("video poker", () => {
  const hand = (...cs: [number, number][]) => cs.map(([r, s]) => c(r, s));
  it("names every hand of the 9/6 table", () => {
    expect(pokerHand(hand([1, 0], [13, 0], [12, 0], [11, 0], [10, 0]))).toBe("royal");
    expect(pokerHand(hand([5, 1], [6, 1], [7, 1], [8, 1], [9, 1]))).toBe("straight_flush");
    expect(pokerHand(hand([9, 0], [9, 1], [9, 2], [9, 3], [2, 0]))).toBe("four");
    expect(pokerHand(hand([9, 0], [9, 1], [9, 2], [4, 3], [4, 0]))).toBe("full_house");
    expect(pokerHand(hand([2, 2], [6, 2], [9, 2], [11, 2], [13, 2]))).toBe("flush");
    expect(pokerHand(hand([1, 0], [2, 1], [3, 2], [4, 3], [5, 0]))).toBe("straight");
    expect(pokerHand(hand([7, 0], [7, 1], [7, 2], [2, 3], [9, 0]))).toBe("three");
    expect(pokerHand(hand([7, 0], [7, 1], [3, 2], [3, 3], [9, 0]))).toBe("two_pair");
    expect(pokerHand(hand([12, 0], [12, 1], [3, 2], [5, 3], [9, 0]))).toBe("jacks");
    expect(pokerHand(hand([10, 0], [10, 1], [3, 2], [5, 3], [9, 0]))).toBe("nothing");
  });

  it("pays the royal eight hundred a coin only on five coins", () => {
    expect(pokerPays("royal", 5)).toBe(4000);
    expect(pokerPays("royal", 4)).toBe(1000);
    expect(pokerPays("full_house", 1)).toBe(9);
    expect(pokerPays("flush", 1)).toBe(6);
  });

  it("keeps the held cards and draws new ones for the rest", () => {
    const v = pokerDeal(1, () => new Rng(3).next());
    const kept = v.cards[0];
    v.held[0] = true;
    pokerDraw(v);
    expect(v.cards[0]).toEqual(kept);
    expect(v.phase).toBe("done");
    expect(v.hand).toBeDefined();
  });
});

describe("the lucky wheel", () => {
  it("has fifty-four slots, and every mark returns less than it takes", () => {
    expect(WHEEL_SEGMENTS).toHaveLength(54);
    for (const m of WHEEL_MARKS) { expect(wheelRTP(m), `mark ${m}`).toBeLessThan(1); expect(wheelRTP(m)).toBeGreaterThan(0.7); }
    const slot = WHEEL_SEGMENTS.indexOf(20);
    expect(wheelReturn(20, 5, slot)).toBe(105);
  });
});

describe("Stonks, the crash game", () => {
  it("never crashes below one times, and climbs steadily", () => {
    const rng = new Rng(4);
    for (let i = 0; i < 1000; i++) expect(crashPoint(() => rng.next())).toBeGreaterThanOrEqual(1);
    expect(crashMultiplier(0)).toBe(1);
    expect(crashMultiplier(10)).toBeGreaterThan(crashMultiplier(5));
    expect(crashMultiplier(crashTimeFor(2))).toBeCloseTo(2, 1);
  });

  it("returns about 97% whatever the player aims to cash out at", () => {
    const rng = new Rng(5);
    for (const target of [1.5, 2, 5]) {
      let back = 0;
      const n = 60000;
      for (let i = 0; i < n; i++) if (crashPoint(() => rng.next()) >= target) back += target;
      expect(back / n, `cash out at ${target}x`).toBeGreaterThan(0.93);
      expect(back / n).toBeLessThan(1.01);
    }
  });
});
