/**
 * Critters between players: link battles and trades (after the link cable of
 * the monster-collecting games, which is how they were always meant to be
 * played — two people, one battle, and a trade to finish the field guide).
 *
 * Neither needs the host. One player asks another ("cv" messages, sent
 * straight to them; net/session.ts), and the rest passes between the two:
 *
 * - A battle runs on the challenger's machine, with copies of both teams at
 *   full health — nothing that happens in a link battle lasts. The other
 *   player sends each turn's choice; the challenger plays the turn with both
 *   and sends back what happened and where everyone now stands, which the
 *   other shows from its own side (engine/battle.ts mirrors it).
 * - A trade is an offer each, then a yes each to the pair on the table. Each
 *   side hands over its own critter only once it has the other's yes to the
 *   same pair, so a changed offer can never be taken on an old agreement.
 *
 * Everything that arrives is checked as if it came from a stranger — every
 * critter through the same sanitiser a save goes through.
 */
import type { Game } from "./game";
import type { CritterPlay } from "./critterPlay";
import { displayName, restore, sanitizeCritter, SPECIES, tradeEvolve, type Critter } from "../engine/critters";
import { applyLinkState, mirrorEvent, newBattle, openingEvents, runTurn, linkState, activeOf, type Action, type BattleEvent, type LinkState } from "../engine/battle";

export type LinkWhat = "battle" | "trade";

/** One "cv" message's body. */
export type LinkMsg =
  | { k: "ask"; what: LinkWhat }
  | { k: "yes"; what: LinkWhat; team?: Critter[] }
  | { k: "no"; why: string }
  | { k: "start"; team: Critter[] }
  | { k: "act"; turn: number; a: Action }
  | { k: "turn"; turn: number; ev: BattleEvent[]; st: LinkState }
  | { k: "offer"; c: Critter | null }
  | { k: "ok"; mine: string; theirs: string };

const EVENT_KINDS = new Set(["text", "move", "hit", "miss", "status", "stage", "heal", "faint", "switch", "end"]);
const WHY = ["declined", "busy", "cancelled", "left", "no critters"];

const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.length <= max ? x : null);
const int = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && Math.abs(x) < 1e6 ? x : null);

function team(v: unknown): Critter[] | null {
  if (!Array.isArray(v) || !v.length || v.length > 6) return null;
  const out = v.map(sanitizeCritter);
  return out.every((c): c is Critter => c !== null) ? out : null;
}

function action(v: unknown): Action | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "run") return { kind: "run" };
  if (o.kind === "move") { const i = int(o.index); return i !== null && i >= -1 && i < 4 ? { kind: "move", index: i } : null; }
  if (o.kind === "switch") { const i = int(o.to); return i !== null && i >= 0 && i < 6 ? { kind: "switch", to: i } : null; }
  return null;
}

function event(v: unknown): BattleEvent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = str(o.text, 200);
  if (typeof o.t !== "string" || !EVENT_KINDS.has(o.t) || text === null) return null;
  const e: BattleEvent = { t: o.t as BattleEvent["t"], text };
  if (o.side === "player" || o.side === "foe") e.side = o.side;
  if (typeof o.hp === "number" && Number.isFinite(o.hp) && typeof o.max === "number" && Number.isFinite(o.max)) {
    e.max = Math.max(1, Math.min(9999, Math.floor(o.max)));
    e.hp = Math.max(0, Math.min(e.max, Math.floor(o.hp)));
  }
  const type = str(o.type, 16);
  if (type) e.type = type;
  const move = str(o.move, 32);
  if (move) e.move = move;
  if (typeof o.eff === "number" && Number.isFinite(o.eff)) e.eff = o.eff;
  if (o.crit === true) e.crit = true;
  if (o.result === "win" || o.result === "lose" || o.result === "ran") e.result = o.result;
  return e;
}

/** A "cv" message from another player, trusted for nothing: the shape checked, every critter sanitised, every string short. */
export function parseLinkMsg(v: unknown): LinkMsg | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const what = o.what === "battle" || o.what === "trade" ? o.what : null;
  switch (o.k) {
    case "ask": return what ? { k: "ask", what } : null;
    case "yes": {
      if (!what) return null;
      if (what === "trade") return { k: "yes", what };
      const t = team(o.team);
      return t ? { k: "yes", what, team: t } : null;
    }
    case "no": return { k: "no", why: WHY.includes(o.why as string) ? (o.why as string) : "declined" };
    case "start": { const t = team(o.team); return t ? { k: "start", team: t } : null; }
    case "act": { const turn = int(o.turn), a = action(o.a); return turn !== null && a ? { k: "act", turn, a } : null; }
    case "turn": {
      const turn = int(o.turn);
      if (turn === null || !Array.isArray(o.ev) || o.ev.length > 80 || !o.st || typeof o.st !== "object") return null;
      const ev = o.ev.map(event);
      if (!ev.every((e): e is BattleEvent => e !== null)) return null;
      return { k: "turn", turn, ev, st: o.st as LinkState };
    }
    case "offer": {
      if (o.c === null) return { k: "offer", c: null };
      const c = sanitizeCritter(o.c);
      return c ? { k: "offer", c } : null;
    }
    case "ok": { const mine = str(o.mine, 32), theirs = str(o.theirs, 32); return mine && theirs ? { k: "ok", mine, theirs } : null; }
  }
  return null;
}

/** A link battle's own state, beside the battle itself. */
export interface LinkBattle {
  peer: string;
  peerName: string;
  /** This machine runs the battle (the challenger's), or shows it. */
  sim: boolean;
  mine: Action | null;
  theirs: Action | null;
  /** What happened while the screen was waiting, for it to play. */
  incoming: BattleEvent[];
  /** When the other player was last seen in the world, for noticing that they have gone. */
  seen: number;
}

/** A trade on the table: what each side offers, and the pair each has said yes to. */
export interface TradeState {
  peer: string;
  peerName: string;
  mine: string | null;
  theirs: Critter | null;
  okMine: boolean;
  okTheirs: { mine: string; theirs: string } | null;
  done: boolean;
  note: string;
}

/** How long an ask waits for an answer, and how long a player may vanish before the battle or trade is called off, in ms. */
const ASK_MS = 60_000;
const GONE_MS = 4_000;

/** A copy of the party for a link battle: everyone at full health, the real ones untouched. */
export function linkTeam(party: Critter[]): Critter[] {
  return party.slice(0, 6).map((c) => {
    const k = JSON.parse(JSON.stringify(c)) as Critter;
    restore(k);
    return k;
  });
}

export class CritterLink {
  /** An ask this player sent, waiting for an answer. */
  asking: { to: string; name: string; what: LinkWhat; at: number } | null = null;
  /** An ask this player received, waiting for theirs. */
  invite: { from: string; name: string; what: LinkWhat; at: number } | null = null;
  /** A battle this player said yes to, waiting for the challenger's team. */
  private accepted: { from: string; team: Critter[]; at: number } | null = null;
  trade: TradeState | null = null;

  constructor(private readonly g: Game, private readonly cp: CritterPlay) {}

  private now(): number {
    return performance.now();
  }

  private send(to: string, msg: LinkMsg): void {
    this.g.net?.link?.(to, msg);
  }

  /** The other players in the world, nearest first: who can be asked. */
  players(): { id: string; name: string; dist: number }[] {
    const p = this.g.player.body;
    return [...this.g.remote.values()]
      .map((r) => ({ id: r.id, name: r.name, dist: Math.hypot(r.x - p.x, r.z - p.z) }))
      .sort((a, b) => a.dist - b.dist);
  }

  /** A player by name, as typed in a command (a unique start of the name will do). */
  byName(name: string): { id: string; name: string } | null {
    const n = name.toLowerCase();
    const all = this.players();
    return all.find((r) => r.name.toLowerCase() === n) ?? (all.filter((r) => r.name.toLowerCase().startsWith(n)).length === 1 ? all.find((r) => r.name.toLowerCase().startsWith(n))! : null);
  }

  private get busy(): boolean {
    return !!this.cp.battle || !!this.trade || !!this.accepted;
  }

  /** Asks another player to battle or trade. Returns what to tell the asker. */
  ask(to: string, what: LinkWhat): string {
    const g = this.g, card = this.cp.card;
    const r = g.remote.get(to);
    if (!this.cp.on) return "Link battles and trades are for the critter modes.";
    if (!r) return "That player is not in this world.";
    if (this.busy) return "Finish what you are doing first.";
    if (what === "battle" && !card.party.length) return "You have no critters to battle with.";
    if (what === "trade" && !card.party.length) return "You have no critters to trade.";
    this.asking = { to, name: r.name, what, at: this.now() };
    this.send(to, { k: "ask", what });
    return `You asked ${r.name} to ${what}. Waiting for an answer…`;
  }

  /** Says yes to the ask waiting for this player. */
  accept(): string {
    const inv = this.invite;
    if (!inv) return "Nobody is asking you anything.";
    this.invite = null;
    if (!this.g.remote.has(inv.from)) return `${inv.name} is no longer here.`;
    if (this.busy) { this.send(inv.from, { k: "no", why: "busy" }); return "Finish what you are doing first."; }
    const card = this.cp.card;
    if (!card.party.length) { this.send(inv.from, { k: "no", why: "no critters" }); return "You have no critters."; }
    if (inv.what === "battle") {
      const t = linkTeam(card.party);
      this.accepted = { from: inv.from, team: t, at: this.now() };
      this.send(inv.from, { k: "yes", what: "battle", team: t });
      return `You accepted ${inv.name}'s challenge!`;
    }
    this.send(inv.from, { k: "yes", what: "trade" });
    this.openTrade(inv.from, inv.name);
    return `Trading with ${inv.name}.`;
  }

  decline(): string {
    const inv = this.invite;
    if (!inv) return "Nobody is asking you anything.";
    this.invite = null;
    this.send(inv.from, { k: "no", why: "declined" });
    if (this.g.screen?.kind === "link") this.g.setScreen(null);
    return `You turned down ${inv.name}.`;
  }

  /** A message from another player. */
  receive(from: string, msg: LinkMsg): void {
    const g = this.g;
    const name = g.remote.get(from)?.name ?? "Someone";
    switch (msg.k) {
      case "ask": {
        if (!this.cp.on || this.busy || (this.invite && this.invite.from !== from) || this.asking) { this.send(from, { k: "no", why: "busy" }); return; }
        this.invite = { from, name, what: msg.what, at: this.now() };
        g.message(`${name} wants to ${msg.what === "battle" ? "have a link battle" : "trade critters"} with you! Type /accept or /decline.`, "#aaddff");
        g.sound("trainer_spot", null, 0, 0, 0.8);
        // Over the world or the pause menu (which a tab in the background falls into), not over a chest or a battle.
        if (!g.screen || g.screen.kind === "pause") g.setScreen({ kind: "link" });
        return;
      }
      case "yes": {
        const a = this.asking;
        if (!a || a.to !== from || a.what !== msg.what) return;
        this.asking = null;
        if (this.busy) { this.send(from, { k: "no", why: "busy" }); return; }
        if (msg.what === "trade") { this.openTrade(from, name); return; }
        const mine = linkTeam(this.cp.card.party);
        if (!mine.length) { this.send(from, { k: "no", why: "no critters" }); return; }
        this.send(from, { k: "start", team: mine });
        this.begin(from, name, mine, msg.team!, true);
        return;
      }
      case "start": {
        const acc = this.accepted;
        if (!acc || acc.from !== from) return;
        this.accepted = null;
        this.begin(from, name, acc.team, msg.team, false);
        return;
      }
      case "no": {
        if (this.asking?.to === from) {
          this.asking = null;
          g.message(msg.why === "busy" ? `${name} is busy right now.` : msg.why === "no critters" ? `${name} has no critters.` : `${name} said no.`, "#ffcc88");
        }
        if (this.invite?.from === from) { this.invite = null; if (g.screen?.kind === "link") g.setScreen(null); }
        if (this.accepted?.from === from) this.accepted = null;
        if (this.trade?.peer === from && !this.trade.done) this.endTrade(`${name} ${msg.why === "left" ? "left" : "called off"} the trade.`);
        const lb = this.cp.battle?.link;
        if (lb && lb.peer === from && !this.cp.battle!.b.over) this.walkOut(`${name} left the link battle.`);
        return;
      }
      case "act": {
        const s = this.cp.battle, lb = s?.link;
        if (!s || !lb || !lb.sim || lb.peer !== from || s.b.over || msg.turn !== s.b.turn) return;
        lb.theirs = msg.a;
        const ev = this.resolve();
        if (ev.length) lb.incoming.push(...ev);
        return;
      }
      case "turn": {
        const s = this.cp.battle, lb = s?.link;
        if (!s || !lb || lb.sim || lb.peer !== from) return;
        applyLinkState(s.b, msg.st);
        lb.mine = null;
        const ev = msg.ev.map(mirrorEvent);
        this.cp.linkWorld(ev);
        lb.incoming.push(...ev);
        return;
      }
      case "offer": {
        const t = this.trade;
        if (!t || t.peer !== from || t.done) return;
        t.theirs = msg.c;
        // A changed offer undoes both yeses: nobody agrees to a deal that is no longer on the table.
        t.okMine = false; t.okTheirs = null;
        t.note = msg.c ? `${name} offers ${displayName(msg.c)} (level ${msg.c.level}).` : `${name} took their offer back.`;
        g.bumpInv();
        return;
      }
      case "ok": {
        const t = this.trade;
        if (!t || t.peer !== from || t.done) return;
        t.okTheirs = { mine: msg.mine, theirs: msg.theirs };
        t.note = `${name} said yes.`;
        this.tryCommit();
        g.bumpInv();
        return;
      }
    }
  }

  // ---- battles ------------------------------------------------------------------------------------------------

  private begin(peer: string, peerName: string, mine: Critter[], theirs: Critter[], sim: boolean): void {
    const g = this.g;
    const b = newBattle("link", g.player.name, mine, peerName, theirs);
    const link: LinkBattle = { peer, peerName, sim, mine: null, theirs: null, incoming: [], seen: this.now() };
    this.cp.battle = { b, wild: null, trainer: null, trainerEntity: null, opening: openingEvents(b), catchable: false, area: null, link };
    for (const c of theirs) this.cp.see(c.species);
    const r = g.remote.get(peer);
    this.cp.linkStart(r ? r.x : g.player.body.x, r ? r.z : g.player.body.z - 6);
    g.sound("battle_start", null, 0, 0, 0.8);
    g.setScreen({ kind: "battle" });
  }

  /**
   * This player's choice for the turn. The challenger plays the turn once it
   * has both (and returns what happened); the other sends its choice and
   * waits. Either way a choice the battle would refuse is refused here, before
   * it costs the other player a wait.
   */
  act(a: Action): BattleEvent[] {
    const s = this.cp.battle, lb = s?.link;
    if (!s || !lb || s.b.over || lb.mine) return [];
    const me = activeOf(s.b, "player");
    if (a.kind === "item") return [{ t: "text", text: "No items in a link battle: it is the critters' fight." }];
    if (a.kind === "switch") {
      const c = s.b.player.team[a.to];
      if (!c || c.hp <= 0) return [{ t: "text", text: c ? `${displayName(c)} has fainted and cannot battle!` : "There is no critter there." }];
      if (a.to === s.b.player.active) return [{ t: "text", text: `${displayName(c)} is already out!` }];
    }
    if (a.kind === "move" && a.index >= 0 && !(me.moves[a.index]?.pp > 0) && me.moves.some((m) => m.pp > 0)) return [{ t: "text", text: "That move has no uses left!" }];
    if (a.kind !== "move" && a.kind !== "switch" && a.kind !== "run") return [];
    lb.mine = a;
    if (!lb.sim) { this.send(lb.peer, { k: "act", turn: s.b.turn, a }); return []; }
    return this.resolve();
  }

  /** The challenger: plays the turn if both choices are in (or either forfeits), and sends the other what happened. */
  private resolve(): BattleEvent[] {
    const s = this.cp.battle, lb = s?.link;
    if (!s || !lb || !lb.sim) return [];
    const forfeit = lb.mine?.kind === "run" || lb.theirs?.kind === "run";
    if (!forfeit && (!lb.mine || !lb.theirs)) return [];
    const { events } = runTurn(s.b, lb.mine ?? { kind: "move", index: -1 }, Math.random, lb.theirs ?? { kind: "move", index: -1 });
    lb.mine = lb.theirs = null;
    this.send(lb.peer, { k: "turn", turn: s.b.turn, ev: events, st: linkState(s.b) });
    this.cp.linkWorld(events);
    return events;
  }

  /** Whatever has happened since the screen last looked: it plays these as they come. */
  takeIncoming(): BattleEvent[] {
    const lb = this.cp.battle?.link;
    if (!lb || !lb.incoming.length) return [];
    return lb.incoming.splice(0);
  }

  /** The battle ends without a winner: the other player has gone. */
  private walkOut(text: string): void {
    const s = this.cp.battle;
    if (!s?.link || s.b.over) return;
    s.b.over = "ran";
    s.link.mine = s.link.theirs = null;
    s.link.incoming.push({ t: "end", text, result: "ran" });
  }

  /** Called when a link battle's screen closes: the other player is told if it ended early. */
  left(): void {
    const s = this.cp.battle;
    if (s?.link && !s.b.over) this.send(s.link.peer, { k: "no", why: "left" });
  }

  // ---- trades ----------------------------------------------------------------------------------------------------

  private openTrade(peer: string, peerName: string): void {
    this.trade = { peer, peerName, mine: null, theirs: null, okMine: false, okTheirs: null, done: false, note: `Trading with ${peerName}. Choose a critter to offer.` };
    this.g.setScreen({ kind: "critter_trade" });
  }

  /** Puts one of the party on the table (or takes the offer back). */
  offer(uid: string | null): void {
    const t = this.trade;
    if (!t || t.done) return;
    const c = uid ? this.cp.card.party.find((k) => k.uid === uid) : undefined;
    t.mine = c ? c.uid : null;
    t.okMine = false; t.okTheirs = null;
    this.send(t.peer, { k: "offer", c: c ? JSON.parse(JSON.stringify(c)) : null });
    this.g.bumpInv();
  }

  /** Yes to the pair on the table: this critter for theirs. */
  agree(): string {
    const t = this.trade;
    if (!t || t.done) return "";
    if (!t.mine || !t.theirs) return "Both of you need to offer a critter first.";
    const card = this.cp.card;
    if (!card.party.some((c) => c.uid === t.mine)) return "That critter is no longer in your party.";
    t.okMine = true;
    this.send(t.peer, { k: "ok", mine: t.mine, theirs: t.theirs.uid });
    this.tryCommit();
    this.g.bumpInv();
    return t.done ? "" : `Waiting for ${t.peerName} to say yes…`;
  }

  /**
   * Hands over this side's critter once both have said yes to the same pair.
   * Their yes names their critter and ours; if either is not what is on the
   * table here, it was a yes to an older offer and counts for nothing.
   */
  private tryCommit(): void {
    const t = this.trade, g = this.g, card = this.cp.card;
    if (!t || t.done || !t.okMine || !t.okTheirs || !t.mine || !t.theirs) return;
    if (t.okTheirs.mine !== t.theirs.uid || t.okTheirs.theirs !== t.mine) return;
    const i = card.party.findIndex((c) => c.uid === t.mine);
    if (i < 0) return;
    const [gone] = card.party.splice(i, 1);
    if (card.walking === gone.uid) this.cp.setWalking(null);
    const got = sanitizeCritter(t.theirs)!;
    // Two trainers' critters can share an id by chance; a new one keeps the walking critter and the box straight.
    if ([...card.party, ...card.box].some((c) => c.uid === got.uid)) got.uid = `${got.uid.slice(0, 24)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const lines = [`You traded ${displayName(gone)} for ${displayName(got)}!`];
    const was = displayName(got);
    const to = tradeEvolve(got);
    if (to) {
      lines.push(`${was} evolved into ${SPECIES[to].name}!`);
      g.showTitle(`${SPECIES[to].name}!`, `${was} evolved on the way over.`);
    }
    if (!card.caught.includes(got.species)) card.caught.push(got.species);
    this.cp.see(got.species);
    card.party.push(got);
    card.link = { wins: card.link?.wins ?? 0, losses: card.link?.losses ?? 0, trades: (card.link?.trades ?? 0) + 1 };
    t.done = true;
    // The screen shows what arrived, evolved if it did, rather than what was offered.
    t.theirs = got;
    t.note = lines.join(" ");
    for (const l of lines) g.message(l, "#aaffaa");
    g.sound("level_up", null);
    g.advance({ kind: "trade" });
    g.bumpInv();
  }

  /** Closes the trade (done, or walked away from). */
  endTrade(note?: string): void {
    const t = this.trade;
    if (!t) return;
    if (!t.done) this.send(t.peer, { k: "no", why: "cancelled" });
    this.trade = null;
    if (note) this.g.message(note, "#ffcc88");
    if (this.g.screen?.kind === "critter_trade") this.g.setScreen(null);
  }

  // ---- every tick ----------------------------------------------------------------------------------------------------

  /** Asks run out; a player who has left is noticed, and whatever was going on with them ends. */
  tick(): void {
    const g = this.g, now = this.now();
    if (this.asking && now - this.asking.at > ASK_MS) { g.message(`${this.asking.name} did not answer.`, "#ffcc88"); this.asking = null; }
    if (this.invite && (now - this.invite.at > ASK_MS || !g.remote.has(this.invite.from))) {
      this.invite = null;
      if (g.screen?.kind === "link") g.setScreen(null);
    }
    // A yes the challenger never followed up (they went into another battle, or their message was lost) lapses.
    if (this.accepted && (!g.remote.has(this.accepted.from) || now - this.accepted.at > 15_000)) this.accepted = null;
    const lb = this.cp.battle?.link;
    if (lb) {
      if (g.remote.has(lb.peer)) lb.seen = now;
      else if (now - lb.seen > GONE_MS) this.walkOut(`${lb.peerName} left the link battle.`);
    }
    if (this.trade && !this.trade.done && !g.remote.has(this.trade.peer)) this.endTrade(`${this.trade.peerName} left, and the trade with them.`);
  }
}
