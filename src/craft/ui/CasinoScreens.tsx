/**
 * The casino's screens (engine/casino.ts is the rules): a lobby, and each
 * game at its own table — reels that spin and thunk to a stop one by one,
 * cards dealt onto felt, a roulette wheel that turns and slows, a lucky wheel,
 * video poker's five cards, and Stonks, a line that climbs until you sell or
 * it crashes. Winnings come with a fanfare to match their size.
 *
 * Money is the player's dollars (Player.cash): play money, won and lost here
 * and on the city's streets. Everything is local to the player at the table.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/game";
import {
  bjDeal, bjDouble, bjHit, bjOptions, bjPaid, bjSplit, bjStand, cardName, CASINO_GAMES, crashMultiplier, crashPoint, handValue, isRed, PAYLINES,
  POKER_NAMES, POKER_PAYS, pokerDeal, pokerDraw, pokerPays, pocketColor, REELS, rouletteBet, rouletteReturn, spinLuckyWheel, spinSlots, spinWheel,
  WHEEL, WHEEL_MARKS, WHEEL_SEGMENTS, wheelReturn, type Blackjack, type Card, type CasinoGame, type PokerHand, type RouletteBet, type RouletteKind,
  type SlotResult, type SlotSymbol, type VideoPoker,
} from "../engine/casino";
import { Button } from "./common";

const u = (n: number) => `calc(var(--u) * ${n})`;
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.floor(Math.abs(n)).toLocaleString("en-US")}`;
const CHIPS = [1, 5, 25, 100, 500, 1000, 5000];
const CHIP_COLORS: Record<number, string> = { 1: "#e8e8e8", 5: "#d83a3a", 25: "#2a9a4a", 100: "#2a2a2a", 500: "#8a3ad8", 1000: "#e8b020", 5000: "#e87020" };

/** What the dealer says. The house has a sense of humour; the house also always wins. */
const WIN_QUIPS = ["Stonks!", "Diamond hands!", "To the moon!", "Big if true.", "Number go up.", "Absolute legend.", "GG, no re.", "Main character energy."];
const LOSE_QUIPS = ["Not stonks.", "Skill issue.", "The house always wins.", "Paper hands.", "This is fine.", "F in the chat.", "Rip bozo (lovingly).", "Touch grass, maybe?"];
const quip = (win: boolean) => (win ? WIN_QUIPS : LOSE_QUIPS)[Math.floor(Math.random() * (win ? WIN_QUIPS : LOSE_QUIPS).length)];

/** The player's wallet, and the sounds of money moving. */
function useWallet(game: Game) {
  const [, setN] = useState(0);
  const refresh = () => setN((n) => n + 1);
  return {
    cash: game.player.cash,
    take(n: number): boolean {
      if (n <= 0) return false;
      if (game.player.cash < n) { game.sound("lose", null, 0, 0, 0.4, 1.4); return false; }
      game.player.cash -= n;
      game.sound("chip", null, 0, 0, 0.6);
      game.bumpInv();
      refresh();
      return true;
    },
    pay(n: number, stake: number): void {
      if (n > 0) game.player.cash += n;
      game.casinoResult(n, stake);
      game.sound(n >= stake * 20 && n > 0 ? "jackpot" : n >= stake * 3 && n > 0 ? "win_big" : n > stake ? "win_small" : n > 0 ? "chip" : "lose", null, 0, 0, 0.8);
      game.bumpInv();
      refresh();
    },
    refresh,
  };
}

function ChipRow({ value, onPick }: { value: number; onPick: (v: number) => void }) {
  return (
    <div style={{ display: "flex", gap: u(2), flexWrap: "wrap", justifyContent: "center" }}>
      {CHIPS.map((c) => (
        <button key={c} type="button" data-testid={`chip-${c}`} onClick={() => onPick(c)}
          style={{
            width: u(16), height: u(16), borderRadius: "50%", background: CHIP_COLORS[c], color: c === 1 ? "#222" : "#fff", fontSize: u(4.2), fontWeight: 700,
            border: `${u(1)} dashed ${value === c ? "#fff" : "rgba(255,255,255,0.45)"}`, boxShadow: value === c ? "0 0 calc(var(--u) * 4) #ffe070" : "none", cursor: "pointer",
          }}>
          {c >= 1000 ? `${c / 1000}K` : c}
        </button>
      ))}
    </div>
  );
}

/** A win announced as big as it is: a banner that bounces, and coins raining for the big ones. */
function Banner({ text, big }: { text: string | null; big?: boolean }) {
  if (!text) return null;
  return (
    <div style={{ position: "relative", textAlign: "center", pointerEvents: "none" }}>
      <div className="bc-shadow" style={{ fontSize: u(big ? 13 : 8), color: big ? "#ffe070" : "#fff", animation: "bc-bounce 0.6s ease-out", textShadow: big ? "0 0 calc(var(--u) * 6) #ffb020" : undefined }}>{text}</div>
      {big && (
        <div style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} style={{ position: "absolute", left: `${(i * 53) % 100}%`, top: 0, fontSize: u(6), animation: `bc-coin ${1 + (i % 5) * 0.2}s ${(i % 7) * 0.1}s ease-in forwards`, color: "#ffd040" }}>●</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A table's surroundings: felt, a gold rim, the game's name in lights. */
function Table({ title, children, felt = "#0f5a32" }: { title: string; children: ReactNode; felt?: string }) {
  return (
    <div style={{ background: `radial-gradient(ellipse at center, ${felt} 0%, #062414 100%)`, border: `${u(1.5)} solid #c8a040`, borderRadius: u(6), padding: u(5), display: "flex", flexDirection: "column", gap: u(4), boxShadow: "inset 0 0 calc(var(--u) * 12) rgba(0,0,0,0.6)" }}>
      <div style={{ textAlign: "center", fontSize: u(9), color: "#ffe070", letterSpacing: u(0.6), textShadow: "0 0 calc(var(--u) * 4) #ff60c0, 0 0 calc(var(--u) * 8) #ff30a0" }}>{title}</div>
      {children}
    </div>
  );
}

// ---- the slot machine --------------------------------------------------------------------------------------------

/** Each reel symbol, drawn crisp as vector art (no font or emoji needed). */
function SlotIcon({ s, size = 14 }: { s: SlotSymbol; size?: number }) {
  const px = `calc(var(--u) * ${size})`;
  // Sized by style, not attributes: an SVG attribute cannot take the calc() the UI's units are.
  const svg = (children: ReactNode) => <svg viewBox="0 0 32 32" style={{ display: "block", width: px, height: px }}>{children}</svg>;
  switch (s) {
    case "cherry": return svg(<><path d="M16 4 Q20 10 11 20 M16 4 Q18 12 22 21" stroke="#3a8a2a" strokeWidth="2" fill="none" /><circle cx="10" cy="22" r="6" fill="#d8202a" /><circle cx="22" cy="23" r="6" fill="#c8101a" /><circle cx="8" cy="20" r="1.6" fill="#fff" opacity="0.7" /></>);
    case "lemon": return svg(<><ellipse cx="16" cy="17" rx="12" ry="9" fill="#f8e040" stroke="#c8a010" strokeWidth="1.5" /><ellipse cx="11" cy="14" rx="3" ry="1.5" fill="#fff8b0" /></>);
    case "melon": return svg(<><path d="M3 12 A13 13 0 0 0 29 12 Z" fill="#3a9a3a" /><path d="M5 12 A11 11 0 0 0 27 12 Z" fill="#e8384a" />{[10, 16, 22].map((x) => <circle key={x} cx={x} cy="16" r="1.2" fill="#222" />)}</>);
    case "bell": return svg(<><path d="M8 24 Q8 8 16 7 Q24 8 24 24 Z" fill="#f0c030" stroke="#a87810" strokeWidth="1.5" /><rect x="6" y="23" width="20" height="3" rx="1.5" fill="#d8a020" /><circle cx="16" cy="28" r="2.2" fill="#a87810" /></>);
    case "bar": return svg(<><rect x="3" y="10" width="26" height="12" rx="2" fill="#1a1a22" stroke="#e8e8e8" strokeWidth="1.5" /><text x="16" y="20" textAnchor="middle" fontSize="9" fontWeight="900" fill="#e8e8e8" fontFamily="sans-serif">BAR</text></>);
    case "seven": return svg(<text x="16" y="27" textAnchor="middle" fontSize="28" fontWeight="900" fill="#e8202a" stroke="#7a0a10" strokeWidth="1" fontFamily="serif">7</text>);
    case "diamond": return svg(<><path d="M6 12 L11 5 H21 L26 12 L16 28 Z" fill="#4ce2e0" stroke="#1a8a9a" strokeWidth="1.5" /><path d="M6 12 H26 M11 5 L16 12 L21 5 M16 12 V28" stroke="#1a8a9a" strokeWidth="1" fill="none" /></>);
    case "stonks": return svg(<><rect x="2" y="2" width="28" height="28" rx="3" fill="#0a1a10" /><path d="M5 25 L12 17 L17 21 L27 7" stroke="#30e060" strokeWidth="3" fill="none" /><path d="M21 7 H27 V13" stroke="#30e060" strokeWidth="3" fill="none" /></>);
  }
}

function SlotsTable({ game }: { game: Game }) {
  const w = useWallet(game);
  const [coin, setCoin] = useState(5);
  const [lines, setLines] = useState(5);
  const [offsets, setOffsets] = useState<number[]>([0, 7, 14]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SlotResult | null>(null);
  const [banner, setBanner] = useState<{ text: string; big: boolean } | null>(null);
  const [auto, setAuto] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearInterval(t)), []);

  const spin = () => {
    if (spinning) return;
    const stake = coin * lines;
    if (!w.take(stake)) { setBanner({ text: "Insufficient funds. Skill issue.", big: false }); setAuto(0); return; }
    const r = spinSlots(coin, lines, Math.random);
    setSpinning(true); setResult(null); setBanner(null);
    game.sound("reel_spin", null, 0, 0, 0.5);
    const cur = [...offsets];
    const done = [false, false, false];
    const tick = window.setInterval(() => {
      for (let i = 0; i < 3; i++) if (!done[i]) cur[i] = (cur[i] + 1) % REELS[i].length;
      setOffsets([...cur]);
    }, 55);
    timers.current.push(tick);
    [650, 1050, 1450].forEach((ms, i) => {
      const t = window.setTimeout(() => {
        done[i] = true; cur[i] = r.stops[i]; setOffsets([...cur]);
        game.sound("reel_stop", null, 0, 0, 0.7, 0.9 + i * 0.1);
        if (i === 2) {
          window.clearInterval(tick);
          setSpinning(false); setResult(r);
          w.pay(r.paid, stake);
          const big = r.paid >= stake * 10;
          setBanner(r.paid > 0 ? { text: `${big ? "BIG WIN " : "WIN "}${money(r.paid)} — ${quip(true)}`, big } : { text: quip(false), big: false });
          if (auto > 1) { setAuto((a) => a - 1); window.setTimeout(() => document.querySelector<HTMLButtonElement>("[data-testid=slots-spin]")?.click(), 700); }
          else setAuto(0);
        }
      }, ms);
      timers.current.push(t);
    });
  };

  const winCells = new Set<string>();
  for (const wn of result?.wins ?? []) PAYLINES[wn.line].forEach((row, reel) => winCells.add(`${reel},${row}`));
  return (
    <Table title="STONKS SLOTS" felt="#3a0a4a">
      <div style={{ display: "flex", justifyContent: "center", gap: u(3) }} data-testid="slot-reels">
        {[0, 1, 2].map((reel) => (
          <div key={reel} style={{ background: "linear-gradient(#fff, #d8d8e0 50%, #fff)", border: `${u(1)} solid #1a1a1a`, borderRadius: u(3), padding: u(2), display: "flex", flexDirection: "column", gap: u(1.5) }}>
            {[0, 1, 2].map((row) => {
              const s = REELS[reel][(offsets[reel] + row) % REELS[reel].length];
              const hit = winCells.has(`${reel},${row}`);
              return (
                <div key={row} style={{ padding: u(1.5), borderRadius: u(2), background: hit ? "rgba(255,220,60,0.8)" : "transparent", filter: spinning ? "blur(calc(var(--u) * 0.4))" : undefined, boxShadow: hit ? "0 0 calc(var(--u) * 4) #ffd040" : undefined }}>
                  <SlotIcon s={s} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Banner text={banner?.text ?? null} big={banner?.big} />
      <div className="bc-sub" style={{ textAlign: "center" }}>
        3 × Stonks pays 777 · Diamonds 150 · Sevens 75 · Bars 30 · Bells 18 · Melons 12 · Lemons 10 · Cherries 8 (two pay 3, one pays 1) · Stonks is wild
      </div>
      <div style={{ display: "flex", gap: u(3), justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
        <span>Coin</span>
        {[1, 5, 25, 100].map((c) => <Button key={c} disabled={spinning || coin === c} onClick={() => setCoin(c)}>{money(c)}</Button>)}
        <span>Lines</span>
        {[1, 3, 5].map((l) => <Button key={l} disabled={spinning || lines === l} onClick={() => setLines(l)}>{l}</Button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: u(3) }}>
        <Button onClick={spin} disabled={spinning}><span data-testid="slots-spin">SPIN — {money(coin * lines)}</span></Button>
        <Button onClick={() => { setAuto(10); spin(); }} disabled={spinning}>Auto ×10</Button>
      </div>
    </Table>
  );
}

// ---- blackjack ---------------------------------------------------------------------------------------------------

function CardView({ c, hidden, i = 0 }: { c: Card; hidden?: boolean; i?: number }) {
  return (
    <div style={{
      width: u(20), height: u(28), borderRadius: u(2), background: hidden ? "repeating-linear-gradient(45deg, #8a1a3a, #8a1a3a 6px, #c82a5a 6px, #c82a5a 12px)" : "#fdfdf8",
      border: `${u(0.6)} solid #333`, color: isRed(c) ? "#c8101a" : "#111", fontSize: u(7), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 calc(var(--u) * 1) calc(var(--u) * 2) rgba(0,0,0,0.5)", animation: `bc-deal 0.35s ${i * 0.08}s ease-out both`, fontFamily: "serif",
    }}>
      {hidden ? "" : cardName(c)}
    </div>
  );
}

function BlackjackTable({ game }: { game: Game }) {
  const w = useWallet(game);
  const [chip, setChip] = useState(25);
  const [bet, setBet] = useState(0);
  const [round, setRound] = useState<Blackjack | null>(null);
  const [, bump] = useState(0);
  const [banner, setBanner] = useState<{ text: string; big: boolean } | null>(null);
  const prev = useRef<Blackjack | undefined>(undefined);
  const stake = useRef(0);

  const finish = (g: Blackjack) => {
    const paid = bjPaid(g);
    w.pay(paid, stake.current);
    const net = paid - stake.current;
    setBanner({ text: net > 0 ? `+${money(net)} — ${quip(true)}` : net === 0 ? "Push. Nobody wins. Very balanced." : `${money(net)} — ${quip(false)}`, big: g.hands.some((h) => h.result === "blackjack") });
  };
  const deal = () => {
    if (bet <= 0 || (round && round.phase !== "done")) return;
    if (!w.take(bet)) { setBanner({ text: "You can't afford that bet.", big: false }); return; }
    stake.current = bet;
    const g = bjDeal(bet, Math.random, prev.current);
    prev.current = g;
    setRound(g); setBanner(null);
    game.sound("card", null, 0, 0, 0.7);
    if (g.phase === "done") finish(g);
  };
  const act = (f: (g: Blackjack) => void, extra = 0) => {
    if (!round) return;
    if (extra > 0 && !w.take(extra)) { setBanner({ text: "Not enough for that.", big: false }); return; }
    stake.current += extra;
    f(round);
    game.sound("card", null, 0, 0, 0.6);
    bump((n) => n + 1);
    if (round.phase === "done") finish(round);
  };
  const o = round ? bjOptions(round) : null;
  const h = round?.hands[round.active];
  const dv = round ? handValue(round.phase === "done" ? round.dealer : round.dealer.slice(0, 1)).total : 0;
  return (
    <Table title="BLACKJACK · PAYS 3 TO 2">
      <div className="bc-sub" style={{ textAlign: "center" }}>Dealer stands on soft 17 · Double on any two · Split pairs up to four hands</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u(2) }} data-testid="bj-dealer">
        <div>Dealer {round ? `(${dv}${round.phase === "player" ? "+?" : ""})` : ""}</div>
        <div style={{ display: "flex", gap: u(2) }}>{round?.dealer.map((c, i) => <CardView key={i} c={c} i={i} hidden={round.phase === "player" && i === 1} />)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: u(6), flexWrap: "wrap" }} data-testid="bj-hands">
        {round?.hands.map((hd, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u(1.5), padding: u(2), border: `${u(0.6)} solid ${i === round.active && round.phase === "player" ? "#ffe070" : "transparent"}`, borderRadius: u(2) }}>
            <div style={{ display: "flex", gap: u(1.5) }}>{hd.cards.map((c, j) => <CardView key={j} c={c} i={j} />)}</div>
            <div className="bc-sub">{handValue(hd.cards).total}{hd.doubled ? " · doubled" : ""} · {money(hd.bet)}{hd.result ? ` · ${hd.result.toUpperCase()}` : ""}</div>
          </div>
        ))}
      </div>
      <Banner text={banner?.text ?? null} big={banner?.big} />
      {(!round || round.phase === "done") ? (
        <>
          <ChipRow value={chip} onPick={(c) => { setChip(c); setBet((b) => b + c); game.sound("chip", null, 0, 0, 0.5); }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: u(3) }}>
            <Button onClick={() => setBet(0)}>Clear bet</Button>
            <Button onClick={deal} disabled={bet <= 0}><span data-testid="bj-deal">DEAL — {money(bet)}</span></Button>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: u(3) }}>
          <Button onClick={() => act(bjHit)} disabled={!o?.hit}><span data-testid="bj-hit">Hit</span></Button>
          <Button onClick={() => act(bjStand)} disabled={!o?.stand}><span data-testid="bj-stand">Stand</span></Button>
          <Button onClick={() => act(bjDouble, h?.bet ?? 0)} disabled={!o?.double}>Double</Button>
          <Button onClick={() => act(bjSplit, h?.bet ?? 0)} disabled={!o?.split}>Split</Button>
        </div>
      )}
    </Table>
  );
}

// ---- roulette ----------------------------------------------------------------------------------------------------

function RouletteWheel({ angle, spinning }: { angle: number; spinning: boolean }) {
  const n = WHEEL.length;
  return (
    <div style={{ position: "relative", width: u(90), height: u(90), margin: "0 auto" }}>
      <svg viewBox="-50 -50 100 100" style={{ width: "100%", height: "100%", transform: `rotate(${angle}deg)`, transition: spinning ? "transform 4.6s cubic-bezier(0.12, 0.6, 0.15, 1)" : "none" }}>
        <circle r="49" fill="#5a3a1a" />
        {WHEEL.map((num, i) => {
          const a0 = ((i - 0.5) / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
          const col = pocketColor(num) === "red" ? "#c8202a" : pocketColor(num) === "black" ? "#161616" : "#1a8a3a";
          const p = (r: number, a: number) => `${r * Math.cos(a)} ${r * Math.sin(a)}`;
          const mid = (a0 + a1) / 2;
          return (
            <g key={num}>
              <path d={`M ${p(20, a0)} L ${p(46, a0)} A 46 46 0 0 1 ${p(46, a1)} L ${p(20, a1)} A 20 20 0 0 0 ${p(20, a0)} Z`} fill={col} stroke="#c8a040" strokeWidth="0.4" />
              <text x={40 * Math.cos(mid)} y={40 * Math.sin(mid)} fontSize="4" fill="#fff" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${(mid * 180) / Math.PI + 90} ${40 * Math.cos(mid)} ${40 * Math.sin(mid)})`}>{num}</text>
            </g>
          );
        })}
        <circle r="20" fill="#8a6a2a" stroke="#c8a040" strokeWidth="1" />
        <circle r="6" fill="#c8a040" />
      </svg>
      {/* The pointer: the pocket under it is the result. */}
      <div style={{ position: "absolute", left: "50%", top: `calc(var(--u) * -1)`, transform: "translateX(-50%)", width: 0, height: 0, borderLeft: `${u(3)} solid transparent`, borderRight: `${u(3)} solid transparent`, borderTop: `${u(6)} solid #fff` }} />
    </div>
  );
}

function RouletteTable({ game }: { game: Game }) {
  const w = useWallet(game);
  const [chip, setChip] = useState(25);
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [last, setLast] = useState<RouletteBet[]>([]);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [banner, setBanner] = useState<{ text: string; big: boolean } | null>(null);
  const total = bets.reduce((t, b) => t + b.amount, 0);

  const place = (kind: RouletteKind, at = 0) => {
    if (spinning) return;
    game.sound("chip", null, 0, 0, 0.5);
    setBets((bs) => {
      const nb = rouletteBet(kind, chip, at);
      const same = bs.find((b) => b.label === nb.label);
      return same ? bs.map((b) => (b === same ? { ...b, amount: b.amount + chip } : b)) : [...bs, nb];
    });
  };
  const staked = (label: string) => bets.find((b) => b.label === label)?.amount ?? 0;
  const spin = () => {
    if (spinning || total <= 0) return;
    if (!w.take(total)) { setBanner({ text: "Your chips don't cover that.", big: false }); return; }
    const n = spinWheel(Math.random);
    const idx = WHEEL.indexOf(n as (typeof WHEEL)[number]);
    // Several turns, then the winning pocket comes to rest under the pointer at the top.
    const target = angle - (angle % 360) + 360 * 6 - (idx / WHEEL.length) * 360;
    setSpinning(true); setBanner(null); setAngle(target);
    game.sound("ball", null, 0, 0, 0.8);
    window.setTimeout(() => {
      const back = rouletteReturn(bets, n);
      w.pay(back, total);
      setHistory((h) => [n, ...h].slice(0, 12));
      setBanner({ text: `${n} ${pocketColor(n).toUpperCase()} — ${back > 0 ? `you win ${money(back)}! ${quip(true)}` : quip(false)}`, big: back >= total * 10 });
      setLast(bets); setBets([]); setSpinning(false);
    }, 4800);
  };

  const numCell = (n: number) => (
    <div key={n} data-testid={`rl-${n}`} onClick={() => place("straight", n)}
      style={{ position: "relative", background: pocketColor(n) === "red" ? "#b81a24" : "#161616", color: "#fff", border: "1px solid #c8a040", textAlign: "center", padding: `${u(1.5)} 0`, cursor: "pointer", fontSize: u(5) }}>
      {n}{staked(`${n}`) > 0 && <ChipMark v={staked(`${n}`)} />}
    </div>
  );
  const outside = (kind: RouletteKind, label: string, at = 0, key = label) => {
    const lbl = rouletteBet(kind, 1, at).label;
    return (
      <div key={key} onClick={() => place(kind, at)} data-testid={`rl-${kind}${at || ""}`}
        style={{ position: "relative", background: kind === "red" ? "#b81a24" : kind === "black" ? "#161616" : "transparent", border: "1px solid #c8a040", textAlign: "center", padding: `${u(1.5)} 0`, cursor: "pointer", fontSize: u(4.5) }}>
        {label}{staked(lbl) > 0 && <ChipMark v={staked(lbl)} />}
      </div>
    );
  };
  return (
    <Table title="ROULETTE · SINGLE ZERO">
      <div style={{ display: "flex", gap: u(6), alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
        <RouletteWheel angle={angle} spinning={spinning} />
        <div style={{ display: "flex", flexDirection: "column", gap: u(2), minWidth: u(60) }}>
          <div className="bc-sub">Last numbers</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: u(1) }} data-testid="rl-history">
            {history.map((n, i) => <span key={i} style={{ background: pocketColor(n) === "red" ? "#b81a24" : pocketColor(n) === "black" ? "#222" : "#1a8a3a", padding: `0 ${u(1.5)}`, borderRadius: u(1) }}>{n}</span>)}
          </div>
          <div>Bets on the table: {money(total)}</div>
        </div>
      </div>
      <Banner text={banner?.text ?? null} big={banner?.big} />
      <div style={{ display: "grid", gridTemplateColumns: "auto repeat(12, 1fr) auto", gap: 0 }}>
        <div onClick={() => place("straight", 0)} data-testid="rl-0" style={{ position: "relative", gridRow: "span 3", background: "#1a8a3a", border: "1px solid #c8a040", display: "flex", alignItems: "center", padding: `0 ${u(2)}`, cursor: "pointer" }}>0{staked("0") > 0 && <ChipMark v={staked("0")} />}</div>
        {[3, 2, 1].map((row) => (
          <FragmentRow key={row}>
            {Array.from({ length: 12 }, (_, col) => numCell(col * 3 + row))}
            {outside("column", "2:1", row === 3 ? 3 : row === 2 ? 2 : 1, `col${row}`)}
          </FragmentRow>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {outside("dozen", "1st 12", 1)}{outside("dozen", "2nd 12", 2)}{outside("dozen", "3rd 12", 3)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)" }}>
        {outside("low", "1–18")}{outside("even", "EVEN")}{outside("red", "RED")}{outside("black", "BLACK")}{outside("odd", "ODD")}{outside("high", "19–36")}
      </div>
      <ChipRow value={chip} onPick={setChip} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: u(3) }}>
        <Button onClick={() => setBets([])} disabled={spinning}>Clear</Button>
        <Button onClick={() => setBets(last)} disabled={spinning || !last.length}>Rebet</Button>
        <Button onClick={spin} disabled={spinning || total <= 0}><span data-testid="rl-spin">SPIN — {money(total)}</span></Button>
      </div>
    </Table>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function ChipMark({ v }: { v: number }) {
  const c = [...CHIPS].reverse().find((k) => v >= k) ?? 1;
  return (
    <span style={{ position: "absolute", right: 1, top: 1, width: u(7), height: u(7), borderRadius: "50%", background: CHIP_COLORS[c], color: c === 1 ? "#222" : "#fff", fontSize: u(3), lineHeight: u(7), textAlign: "center", border: "1px dashed #fff" }}>
      {v >= 1000 ? `${Math.floor(v / 1000)}K` : v}
    </span>
  );
}

// ---- video poker -----------------------------------------------------------------------------------------------

function PokerTable({ game }: { game: Game }) {
  const w = useWallet(game);
  const [denom, setDenom] = useState(5);
  const [coins, setCoins] = useState(5);
  const [v, setV] = useState<VideoPoker | null>(null);
  const [, bump] = useState(0);
  const [banner, setBanner] = useState<{ text: string; big: boolean } | null>(null);
  const deal = () => {
    if (!w.take(denom * coins)) { setBanner({ text: "Insert more coins. (You're broke.)", big: false }); return; }
    setV(pokerDeal(coins, Math.random)); setBanner(null);
    game.sound("card", null, 0, 0, 0.7);
  };
  const draw = () => {
    if (!v) return;
    pokerDraw(v);
    game.sound("card", null, 0, 0, 0.7);
    const paid = (v.paid ?? 0) * denom;
    w.pay(paid, denom * coins);
    setBanner(paid > 0 ? { text: `${POKER_NAMES[v.hand!]}! ${money(paid)}`, big: v.hand === "royal" || v.hand === "straight_flush" || v.hand === "four" } : { text: quip(false), big: false });
    bump((n) => n + 1);
  };
  const hands: PokerHand[] = ["royal", "straight_flush", "four", "full_house", "flush", "straight", "three", "two_pair", "jacks"];
  return (
    <Table title="JACKS OR BETTER" felt="#0a2a5a">
      <table style={{ width: "100%", fontSize: u(4.5), borderCollapse: "collapse" }} data-testid="poker-paytable">
        <tbody>
          {hands.map((h) => (
            <tr key={h} style={{ background: v?.phase === "done" && v.hand === h ? "rgba(255,220,60,0.4)" : undefined }}>
              <td style={{ color: "#ffe070" }}>{POKER_NAMES[h]}</td>
              {[1, 2, 3, 4, 5].map((c) => <td key={c} style={{ textAlign: "right", color: c === coins ? "#fff" : "#8a8aa8" }}>{pokerPays(h, c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: u(3), justifyContent: "center" }}>
        {(v?.cards ?? []).map((c, i) => (
          <div key={`${i}${c.rank}${c.suit}`} onClick={() => { if (v?.phase === "hold") { v.held[i] = !v.held[i]; bump((n) => n + 1); game.sound("chip", null, 0, 0, 0.3, 1.5); } }} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: u(1) }} data-testid={`poker-card-${i}`}>
            <CardView c={c} i={i} />
            <span style={{ color: v?.held[i] ? "#ffe070" : "transparent", fontSize: u(4.5) }}>HELD</span>
          </div>
        ))}
      </div>
      <Banner text={banner?.text ?? null} big={banner?.big} />
      <div style={{ display: "flex", gap: u(3), justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
        <span>Coin</span>{[1, 5, 25, 100].map((d) => <Button key={d} disabled={v?.phase === "hold" || denom === d} onClick={() => setDenom(d)}>{money(d)}</Button>)}
        <span>Coins</span>{[1, 2, 3, 4, 5].map((c) => <Button key={c} disabled={v?.phase === "hold" || coins === c} onClick={() => setCoins(c)}>{c}</Button>)}
      </div>
      {v?.phase === "hold"
        ? <Button wide onClick={draw}><span data-testid="poker-draw">DRAW</span></Button>
        : <Button wide onClick={deal}><span data-testid="poker-deal">DEAL — {money(denom * coins)}</span></Button>}
    </Table>
  );
}

// ---- the lucky wheel -------------------------------------------------------------------------------------------

const MARK_COLORS: Record<number, string> = { 0: "#1a1a1a", 1: "#e8e8e8", 2: "#3a8ae8", 5: "#e8c020", 10: "#3ac860", 20: "#d83aa8", 45: "#e8402a" };

function WheelTable({ game }: { game: Game }) {
  const w = useWallet(game);
  const [chip, setChip] = useState(25);
  const [bets, setBets] = useState<Record<number, number>>({});
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [banner, setBanner] = useState<{ text: string; big: boolean } | null>(null);
  const total = Object.values(bets).reduce((t, b) => t + b, 0);
  const n = WHEEL_SEGMENTS.length;
  const spin = () => {
    if (spinning || total <= 0) return;
    if (!w.take(total)) { setBanner({ text: "Not enough on you for that.", big: false }); return; }
    const slot = spinLuckyWheel(Math.random);
    setSpinning(true); setBanner(null);
    setAngle(angle - (angle % 360) + 360 * 5 - (slot / n) * 360);
    game.sound("ball", null, 0, 0, 0.7, 0.6);
    window.setTimeout(() => {
      const mark = WHEEL_SEGMENTS[slot];
      const back = WHEEL_MARKS.reduce((t, m) => t + wheelReturn(m, bets[m] ?? 0, slot), 0);
      w.pay(back, total);
      setBanner({ text: mark === 0 ? "HOUSE! Everyone loses. The house thanks you." : `${mark} to 1! ${back > 0 ? `You win ${money(back)}.` : quip(false)}`, big: back >= total * 10 });
      setBets({}); setSpinning(false);
    }, 4800);
  };
  return (
    <Table title="THE WHEEL OF STONKS" felt="#4a2a0a">
      <div style={{ position: "relative", width: u(100), height: u(100), margin: "0 auto" }}>
        <svg viewBox="-50 -50 100 100" style={{ width: "100%", height: "100%", transform: `rotate(${angle}deg)`, transition: spinning ? "transform 4.6s cubic-bezier(0.1, 0.6, 0.15, 1)" : "none" }}>
          {WHEEL_SEGMENTS.map((m, i) => {
            const a0 = ((i - 0.5) / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2, mid = (a0 + a1) / 2;
            const p = (r: number, a: number) => `${r * Math.cos(a)} ${r * Math.sin(a)}`;
            return (
              <g key={i}>
                <path d={`M 0 0 L ${p(48, a0)} A 48 48 0 0 1 ${p(48, a1)} Z`} fill={MARK_COLORS[m]} stroke="#6a4a1a" strokeWidth="0.3" />
                <text x={40 * Math.cos(mid)} y={40 * Math.sin(mid)} fontSize="3.4" fontWeight="700" fill={m === 1 ? "#222" : "#fff"} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${(mid * 180) / Math.PI + 90} ${40 * Math.cos(mid)} ${40 * Math.sin(mid)})`}>{m === 0 ? "🏠" : m}</text>
              </g>
            );
          })}
          <circle r="9" fill="#c8a040" stroke="#6a4a1a" />
        </svg>
        <div style={{ position: "absolute", left: "50%", top: `calc(var(--u) * -1)`, transform: "translateX(-50%)", borderLeft: `${u(3)} solid transparent`, borderRight: `${u(3)} solid transparent`, borderTop: `${u(7)} solid #fff` }} />
      </div>
      <Banner text={banner?.text ?? null} big={banner?.big} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: u(2) }}>
        {WHEEL_MARKS.map((m) => (
          <button key={m} type="button" className="bc-btn" data-testid={`wheel-${m}`} disabled={spinning}
            onClick={() => { setBets((b) => ({ ...b, [m]: (b[m] ?? 0) + chip })); game.sound("chip", null, 0, 0, 0.5); }}
            style={{ borderTop: `${u(2)} solid ${MARK_COLORS[m]}` }}>
            {m} to 1<div className="bc-sub">{bets[m] ? money(bets[m]) : "—"}</div>
          </button>
        ))}
      </div>
      <ChipRow value={chip} onPick={setChip} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: u(3) }}>
        <Button onClick={() => setBets({})} disabled={spinning}>Clear</Button>
        <Button onClick={spin} disabled={spinning || total <= 0}><span data-testid="wheel-spin">SPIN — {money(total)}</span></Button>
      </div>
    </Table>
  );
}

// ---- Stonks (the crash game) -----------------------------------------------------------------------------------

function CrashTable({ game }: { game: Game }) {
  const w = useWallet(game);
  const [chip, setChip] = useState(25);
  const [bet, setBet] = useState(25);
  const [phase, setPhase] = useState<"idle" | "running" | "crashed" | "sold">("idle");
  const [mult, setMult] = useState(1);
  const [points, setPoints] = useState<number[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const [banner, setBanner] = useState<{ text: string; big: boolean } | null>(null);
  const run = useRef<{ crash: number; start: number; sold: number | null; raf: number; lastTick: number } | null>(null);
  useEffect(() => () => { if (run.current) cancelAnimationFrame(run.current.raf); }, []);

  const buy = () => {
    if (phase === "running") return;
    if (!w.take(bet)) { setBanner({ text: "Can't buy the dip with no money.", big: false }); return; }
    const crash = crashPoint(Math.random);
    run.current = { crash, start: performance.now(), sold: null, raf: 0, lastTick: 1 };
    setPhase("running"); setBanner(null); setPoints([1]); setMult(1);
    const frame = () => {
      const r = run.current!;
      const t = (performance.now() - r.start) / 1000;
      const m = Math.min(crashMultiplier(t), r.crash);
      setMult(m);
      setPoints((p) => (p.length > 300 ? [...p.filter((_, i) => i % 2 === 0), m] : [...p, m]));
      if (m >= r.lastTick + 0.25) { r.lastTick = m; game.sound("chip", null, 0, 0, 0.25, 0.8 + Math.min(1.5, m / 5)); }
      if (m >= r.crash) {
        setPhase(r.sold ? "sold" : "crashed");
        setHistory((h) => [r.crash, ...h].slice(0, 14));
        if (!r.sold) {
          game.sound("crash_boom", null, 0, 0, 0.8);
          w.pay(0, bet);
          setBanner({ text: `📉 CRASHED at ${r.crash.toFixed(2)}× — ${quip(false)}`, big: false });
        }
        return;
      }
      r.raf = requestAnimationFrame(frame);
    };
    run.current.raf = requestAnimationFrame(frame);
  };
  const sell = () => {
    const r = run.current;
    if (!r || phase !== "running" || r.sold) return;
    r.sold = mult;
    const back = Math.floor(bet * mult);
    game.sound("cashout", null, 0, 0, 0.8);
    w.pay(back, bet);
    setBanner({ text: `📈 SOLD at ${mult.toFixed(2)}× for ${money(back)} — ${quip(true)}`, big: mult >= 10 });
    // The line keeps going without you, so you can see what you missed (or dodged).
  };
  const max = Math.max(2, ...points);
  const path = points.map((m, i) => `${(i / Math.max(1, points.length - 1)) * 100} ${60 - ((m - 1) / (max - 1)) * 55}`).join(" L ");
  return (
    <Table title="STONKS · BUY LOW, SELL BEFORE IT CRASHES" felt="#08140c">
      <div style={{ position: "relative" }}>
        <svg viewBox="0 0 100 62" style={{ width: "100%", height: u(70), background: "#050a06", border: `${u(0.6)} solid #1a3a2a` }} data-testid="crash-chart">
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2="100" y1={62 * f} y2={62 * f} stroke="#123" strokeWidth="0.3" />)}
          {points.length > 1 && <path d={`M ${path}`} stroke={phase === "crashed" ? "#e83a3a" : "#30e060"} strokeWidth="1.2" fill="none" />}
        </svg>
        <div data-testid="crash-mult" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: u(16), color: phase === "crashed" ? "#ff5050" : "#60ff90", textShadow: "0 0 calc(var(--u) * 5) currentColor", pointerEvents: "none" }}>
          {mult.toFixed(2)}×
        </div>
      </div>
      <div style={{ display: "flex", gap: u(1.5), flexWrap: "wrap", justifyContent: "center" }}>
        {history.map((x, i) => <span key={i} style={{ padding: `0 ${u(1.5)}`, borderRadius: u(1), background: x >= 2 ? "#1a5a2a" : "#5a1a1a" }}>{x.toFixed(2)}×</span>)}
      </div>
      <Banner text={banner?.text ?? null} big={banner?.big} />
      {phase === "running" ? (
        <Button wide onClick={sell} disabled={!!run.current?.sold}><span data-testid="crash-sell">SELL — {money(bet * mult)}</span></Button>
      ) : (
        <>
          <ChipRow value={chip} onPick={(c) => { setChip(c); setBet(c); }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: u(3) }}>
            <Button onClick={() => setBet((b) => Math.max(1, Math.floor(b / 2)))}>½</Button>
            <Button onClick={() => setBet((b) => b * 2)}>2×</Button>
            <Button onClick={buy}><span data-testid="crash-buy">BUY — {money(bet)}</span></Button>
          </div>
        </>
      )}
    </Table>
  );
}

// ---- the lobby and the frame ------------------------------------------------------------------------------------

const TABLES: Record<Exclude<CasinoGame, "lobby">, (p: { game: Game }) => JSX.Element> = {
  slots: SlotsTable, blackjack: BlackjackTable, roulette: RouletteTable, poker: PokerTable, wheel: WheelTable, crash: CrashTable,
};

export function CasinoScreen({ game, which }: { game: Game; which: CasinoGame }) {
  const [at, setAt] = useState<CasinoGame>(which);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 250); return () => window.clearInterval(t); }, []);
  const Tbl = at === "lobby" ? null : TABLES[at];
  return (
    <div className="absolute inset-0 pointer-events-auto bc-shadow" data-testid="casino-screen"
      style={{ background: "rgba(10,4,16,0.82)", overflowY: "auto", padding: u(5), display: "flex", justifyContent: "center" }}>
      <style>{`
        @keyframes bc-bounce { 0% { transform: scale(0.3); opacity: 0 } 60% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes bc-coin { 0% { transform: translateY(0) rotate(0); opacity: 1 } 100% { transform: translateY(calc(var(--u) * 80)) rotate(540deg); opacity: 0 } }
        @keyframes bc-deal { 0% { transform: translate(calc(var(--u) * 40), calc(var(--u) * -30)) rotate(-20deg); opacity: 0 } 100% { transform: none; opacity: 1 } }
      `}</style>
      <div style={{ width: `min(100%, calc(var(--u) * 300))`, display: "flex", flexDirection: "column", gap: u(4) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: u(3) }}>
          <div style={{ fontSize: u(10), color: "#ff70d0", textShadow: "0 0 calc(var(--u) * 5) #ff30a0" }}>THE GOLDEN STONK</div>
          <div data-testid="casino-cash" style={{ fontSize: u(9), color: "#7aff9a", fontFamily: "monospace" }}>{money(game.player.cash)}</div>
        </div>
        {at === "lobby" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 90), 1fr))", gap: u(4) }}>
            {CASINO_GAMES.map((g) => (
              <button key={g.id} type="button" className="bc-btn" data-testid={`casino-${g.id}`} onClick={() => setAt(g.id)} style={{ padding: u(5), textAlign: "left" }}>
                <div style={{ fontSize: u(8), color: "#ffe070" }}>{g.name}</div>
                <div className="bc-sub" style={{ lineHeight: 1.4 }}>{g.blurb}</div>
              </button>
            ))}
          </div>
        ) : Tbl && <Tbl game={game} />}
        <div style={{ display: "grid", gridTemplateColumns: at === "lobby" ? "1fr" : "1fr 1fr", gap: u(3) }}>
          {at !== "lobby" && <Button onClick={() => setAt("lobby")}>All games</Button>}
          <Button onClick={() => game.setScreen(null)}><span data-testid="casino-leave">Leave the table</span></Button>
        </div>
        <div className="bc-sub" style={{ textAlign: "center" }}>Play money only. The odds are the real ones: the house keeps a little of every bet, in the long run.</div>
      </div>
    </div>
  );
}
