/**
 * A critter battle, turn by turn (engine/critters.ts says who fights).
 *
 * Plain state and a pure step function — no world, no screen — so a battle
 * plays the same in a test, on the host or on a guest, and the screen only
 * has to draw the events a turn returns. Each side has a team and one critter
 * out; each turn both choose (the foe by its own reckoning), the quicker
 * moves first, and whatever faints is replaced or ends it.
 *
 * The arithmetic is the classic shape of the genre: harm from level, power
 * and the ratio of attack to defence, half again for a move of the user's
 * own type, times how the types meet, a one-in-sixteen critical, and a
 * little randomness. The numbers are this game's own.
 *
 * A link battle is two players' teams against each other. One machine (the
 * challenger's) runs it with both players' choices; the other shows the same
 * battle from its own side (game/critterLink.ts). So its lines name both
 * trainers ("Ada's Sussling used Ratio!") and read true from either side.
 */
import {
  catchOdds, displayName, effectiveness, evolve, evolutionFor, gainXp, maxHp, MOVES, ORBS, SPECIES, STATUS_NAMES, statsOf, throwOrb, TYPE_NAMES,
  giveMedicine, xpReward, type Critter, type MoveDef, type Stage, type Status,
} from "./critters";

export type SideId = "player" | "foe";
export type BattleKind = "wild" | "trainer" | "safari" | "link";
export type BattleResult = "win" | "lose" | "caught" | "ran" | "fled";

export interface Side {
  name: string;
  team: Critter[];
  active: number;
  stages: Record<Stage, number>;
}

export interface Battle {
  kind: BattleKind;
  player: Side;
  foe: Side;
  turn: number;
  over: BattleResult | null;
  /** The player's critters that have been out against the current foe: they share its experience. */
  fought: string[];
  /** Escape attempts so far: each makes the next likelier. */
  runs: number;
  /** The player's critter fainted and another must go out before anything else. */
  mustSwitch: boolean;
  /** Safari: turns of the critter eating bait or angry at mud, and orbs left. */
  safari?: { bait: number; anger: number; orbs: number };
  /** The critter caught, once caught. */
  caught?: Critter;
  /** Moves a critter could learn but had no room for: its trainer chooses after the battle. */
  offers: { uid: string; move: string }[];
  /** How the foe decides: a wild critter at random, a trainer with some thought. */
  smart: boolean;
}

export type Action =
  | { kind: "move"; index: number }
  | { kind: "switch"; to: number }
  | { kind: "item"; item: string; target?: number }
  | { kind: "run" }
  | { kind: "bait" }
  | { kind: "mud" };

/** Something that happened, in order, for the screen to show: every one carries its line of text. */
export interface BattleEvent {
  t: "text" | "move" | "hit" | "miss" | "status" | "stage" | "heal" | "faint" | "switch" | "throw" | "shake" | "caught" | "breakout" | "xp" | "level" | "learn" | "evolve" | "end" | "flee";
  text: string;
  side?: SideId;
  /** The side's health after it, for the bar. */
  hp?: number;
  max?: number;
  /** A move's type, for its colour and sparks. */
  type?: string;
  move?: string;
  eff?: number;
  crit?: boolean;
  shakes?: number;
  uid?: string;
  result?: BattleResult;
}

const STRUGGLE: MoveDef = { id: "struggle", name: "Struggle", type: "normal", category: "physical", power: 50, accuracy: 0, pp: 1, recoil: 0.25 };

const freshStages = (): Record<Stage, number> => ({ atk: 0, def: 0, sp: 0, spd: 0, acc: 0 });
const other = (s: SideId): SideId => (s === "player" ? "foe" : "player");

export function activeOf(b: Battle, s: SideId): Critter {
  const side = b[s];
  return side.team[side.active];
}

/** A fresh battle. The player's team is their party itself: what happens here happens to them. */
export function newBattle(kind: BattleKind, playerName: string, party: Critter[], foeName: string, foeTeam: Critter[], opts: { orbs?: number } = {}): Battle {
  const first = Math.max(0, party.findIndex((c) => c.hp > 0));
  const b: Battle = {
    kind,
    player: { name: playerName, team: party, active: first, stages: freshStages() },
    foe: { name: foeName, team: foeTeam, active: 0, stages: freshStages() },
    turn: 0, over: null, fought: party[first] ? [party[first].uid] : [], runs: 0, mustSwitch: false, offers: [],
    smart: kind === "trainer",
  };
  if (kind === "safari") b.safari = { bait: 0, anger: 0, orbs: opts.orbs ?? 30 };
  return b;
}

/** The opening lines. */
export function openingEvents(b: Battle): BattleEvent[] {
  const foe = activeOf(b, "foe");
  const out: BattleEvent[] = [];
  if (b.kind === "link") {
    const mine = activeOf(b, "player");
    out.push({ t: "text", text: `${b.player.name} and ${b.foe.name} begin a link battle!` });
    out.push({ t: "switch", side: "foe", text: `${b.foe.name} sends out ${displayName(foe)}!`, hp: foe.hp, max: maxHp(foe) });
    out.push({ t: "switch", side: "player", text: `${b.player.name} sends out ${displayName(mine)}!`, hp: mine.hp, max: maxHp(mine) });
    return out;
  }
  if (b.kind === "trainer") out.push({ t: "switch", side: "foe", text: `${b.foe.name} wants to battle! They send out ${displayName(foe)}.`, hp: foe.hp, max: maxHp(foe) });
  else out.push({ t: "switch", side: "foe", text: `A wild ${displayName(foe)} appeared!`, hp: foe.hp, max: maxHp(foe) });
  if (b.kind !== "safari") {
    const mine = activeOf(b, "player");
    out.push({ t: "switch", side: "player", text: `Go, ${displayName(mine)}!`, hp: mine.hp, max: maxHp(mine) });
  }
  return out;
}

// ---- arithmetic --------------------------------------------------------------------------------------

/** A stat stage as a multiplier: +1 is half again, -1 two thirds, out to four times either way. */
export function stageMult(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function stat(b: Battle, s: SideId, k: "atk" | "def" | "sp" | "spd"): number {
  const c = activeOf(b, s);
  let v = statsOf(c.species, c.level, c.iv)[k] * stageMult(b[s].stages[k]);
  if (k === "spd" && c.status === "paralysis") v /= 2;
  return Math.max(1, v);
}

/** The harm a move does, before it is dealt: exposed for the tests and the foe's reckoning. */
export function damageRoll(level: number, power: number, attack: number, defence: number, modifier: number): number {
  const base = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * power * attack) / defence) / 50) + 2;
  return Math.max(1, Math.floor(base * modifier));
}

function moveOf(id: string): MoveDef {
  return id === "struggle" ? STRUGGLE : MOVES[id];
}

/**
 * A critter as the lines name it. In a link battle every critter carries its
 * trainer's name, since both players read the same words and may well have
 * the same species out; otherwise the classic "The wild…" and "Brom's…".
 */
function nameIn(b: Battle, s: SideId, c: Critter = activeOf(b, s), classic = false): string {
  if (b.kind === "link") return `${b[s].name}'s ${displayName(c)}`;
  if (!classic) return displayName(c);
  return s === "foe" && b.kind !== "trainer" ? `The wild ${displayName(c)}` : s === "foe" ? `${b.foe.name}'s ${displayName(c)}` : displayName(c);
}

/** A move a side may use: the one chosen if it has uses left, the first that has otherwise, or none (it struggles). */
function usableMove(c: Critter, index: number): number {
  if (index >= 0 && c.moves[index]?.pp > 0) return index;
  return c.moves.findIndex((m) => m.pp > 0);
}

// ---- the foe's choice ------------------------------------------------------------------------------------

/** What the foe does this turn: a wild critter picks any move it can; a trainer's, the one likeliest to hurt. */
export function foeChoice(b: Battle, random: () => number): Action {
  const me = activeOf(b, "foe");
  const usable = me.moves.map((m, i) => ({ m, i })).filter(({ m }) => m.pp > 0);
  if (!usable.length) return { kind: "move", index: -1 };
  if (!b.smart) return { kind: "move", index: usable[Math.floor(random() * usable.length)].i };
  const them = activeOf(b, "player");
  let best = usable[0].i, bestScore = -1;
  for (const { m, i } of usable) {
    const d = MOVES[m.id];
    let score: number;
    if (d.category === "status") {
      // A status move is worth it once: not on a critter already suffering, nor a stage already raised high.
      const useful = (d.status && !them.status && random() < 0.35) || (d.self && Object.keys(d.self).some((k) => b.foe.stages[k as Stage] < 2) && random() < 0.25)
        || (d.foe && random() < 0.15) || (d.heal && me.hp < maxHp(me) / 2);
      score = useful ? 60 : 0;
    } else {
      const stab = SPECIES[me.species].types.includes(d.type) ? 1.5 : 1;
      score = d.power * stab * effectiveness(d.type, SPECIES[them.species].types) * (d.accuracy ? d.accuracy / 100 : 1);
    }
    score *= 0.85 + random() * 0.3;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return { kind: "move", index: best };
}

// ---- a turn -----------------------------------------------------------------------------------------------

/**
 * One turn: the player's action and the foe's reply. Returns what happened,
 * and whether the action was taken at all — a medicine that would do nothing,
 * or a switch to a fainted critter, costs no turn and changes nothing.
 */
export function runTurn(b: Battle, action: Action, random: () => number, foeAction?: Action): { events: BattleEvent[]; spent: boolean } {
  const forced = b.mustSwitch;
  const r = step(b, action, random, foeAction);
  // A refused action is no turn at all; nor is sending out a replacement for a fainted critter.
  if (r.spent && !forced) b.turn++;
  return r;
}

function step(b: Battle, action: Action, random: () => number, foeAct?: Action): { events: BattleEvent[]; spent: boolean } {
  const ev: BattleEvent[] = [];
  if (b.over) return { events: ev, spent: false };

  // A fainted critter must be replaced before anything else; the foe waits.
  if (b.mustSwitch) {
    if (action.kind !== "switch") return { events: [{ t: "text", text: "Choose a critter to send out." }], spent: false };
    if (!switchIn(b, "player", action.to, ev)) return { events: ev, spent: false };
    b.mustSwitch = false;
    return { events: ev, spent: true };
  }

  if (b.kind === "safari") return { events: safariTurn(b, action, random, ev), spent: true };
  if (b.kind === "link") return { events: linkTurn(b, action, foeAct ?? { kind: "move", index: -1 }, random, ev), spent: true };

  // What goes before any move: running, switching, items.
  if (action.kind === "run") {
    if (b.kind === "trainer") return { events: [{ t: "text", text: "There is no running from a trainer battle!" }], spent: false };
    b.runs++;
    const a = stat(b, "player", "spd"), f = stat(b, "foe", "spd");
    const odds = (a * 128) / f + 30 * b.runs;
    if (odds >= 255 || random() * 256 < odds) {
      ev.push({ t: "end", text: "Got away safely!", result: "ran" });
      b.over = "ran";
      return { events: ev, spent: true };
    }
    ev.push({ t: "text", text: "Couldn't get away!" });
  } else if (action.kind === "switch") {
    if (!switchIn(b, "player", action.to, ev)) return { events: ev, spent: false };
  } else if (action.kind === "item") {
    const used = applyItem(b, action, random, ev);
    if (used === null) return { events: ev, spent: false };
    if (b.over) return { events: ev, spent: true };
  }

  const foeAction = foeChoice(b, random);
  if (action.kind === "move") {
    const mine = activeOf(b, "player");
    if (action.index >= 0 && !(mine.moves[action.index]?.pp > 0) && mine.moves.some((m) => m.pp > 0)) {
      return { events: [{ t: "text", text: "That move has no uses left!" }], spent: false };
    }
    // Priority first, then speed; a tie is a coin toss.
    const pm = moveOf(action.index >= 0 && mine.moves[action.index] ? mine.moves[action.index].id : "struggle");
    const fm = moveOf(foeAction.kind === "move" && foeAction.index >= 0 ? activeOf(b, "foe").moves[foeAction.index].id : "struggle");
    const pp = pm.priority ?? 0, fp = fm.priority ?? 0;
    const ps = stat(b, "player", "spd"), fs = stat(b, "foe", "spd");
    const playerFirst = pp !== fp ? pp > fp : ps !== fs ? ps > fs : random() < 0.5;
    const order: [SideId, number][] = playerFirst
      ? [["player", action.index], ["foe", foeAction.kind === "move" ? foeAction.index : -1]]
      : [["foe", foeAction.kind === "move" ? foeAction.index : -1], ["player", action.index]];
    for (const [side, index] of order) {
      if (b.over || activeOf(b, side).hp <= 0 || activeOf(b, other(side)).hp <= 0) continue;
      performMove(b, side, index, random, ev);
      if (checkFaints(b, ev)) break;
    }
  } else if (!b.over) {
    performMove(b, "foe", foeAction.kind === "move" ? foeAction.index : -1, random, ev);
    checkFaints(b, ev);
  }
  if (!b.over) endOfTurn(b, ev);
  return { events: ev, spent: true };
}

function switchIn(b: Battle, s: SideId, to: number, ev: BattleEvent[]): boolean {
  const side = b[s];
  const c = side.team[to];
  if (!c) return false;
  if (c.hp <= 0) { ev.push({ t: "text", text: `${displayName(c)} has fainted and cannot battle!` }); return false; }
  if (to === side.active && activeOf(b, s).hp > 0) { ev.push({ t: "text", text: `${displayName(c)} is already out!` }); return false; }
  const was = activeOf(b, s);
  side.active = to;
  side.stages = freshStages();
  if (b.kind === "link") {
    if (was.hp > 0) ev.push({ t: "text", text: `${side.name} withdrew ${displayName(was)}.` });
    ev.push({ t: "switch", side: s, text: `${side.name} sends out ${displayName(c)}!`, hp: c.hp, max: maxHp(c), uid: c.uid });
  } else if (s === "player") {
    if (was.hp > 0) ev.push({ t: "text", text: `Come back, ${displayName(was)}!` });
    if (!b.fought.includes(c.uid)) b.fought.push(c.uid);
    ev.push({ t: "switch", side: s, text: `Go, ${displayName(c)}!`, hp: c.hp, max: maxHp(c), uid: c.uid });
  } else ev.push({ t: "switch", side: s, text: `${b.foe.name} sends out ${displayName(c)}!`, hp: c.hp, max: maxHp(c) });
  return true;
}

/** A medicine on one of the party, or an orb at a wild critter. Null when it would do nothing (and is kept). */
function applyItem(b: Battle, action: { item: string; target?: number }, random: () => number, ev: BattleEvent[]): boolean | null {
  const orb = ORBS[action.item];
  if (orb) {
    if (b.kind === "trainer") { ev.push({ t: "text", text: "You can't catch another trainer's critter!" }); return null; }
    throwAt(b, action.item, 1, random, ev);
    return true;
  }
  const target = b.player.team[action.target ?? b.player.active];
  if (!target) return null;
  const r = giveMedicine(target, action.item);
  if (!r.ok) { ev.push({ t: "text", text: r.text }); return null; }
  const isActive = target === activeOf(b, "player");
  ev.push({ t: "heal", side: isActive ? "player" : undefined, text: r.text, hp: target.hp, max: maxHp(target), uid: target.uid });
  return true;
}

function throwAt(b: Battle, orbId: string, extra: number, random: () => number, ev: BattleEvent[]): void {
  const foe = activeOf(b, "foe");
  const odds = catchOdds(foe.species, foe.hp, maxHp(foe), foe.status, ORBS[orbId].bonus, extra);
  const { shakes, caught } = throwOrb(odds, random);
  ev.push({ t: "throw", text: `You threw a ${ORBS[orbId].name}!` });
  for (let i = 1; i <= shakes; i++) ev.push({ t: "shake", text: "…".repeat(i), shakes: i });
  if (caught) {
    ev.push({ t: "caught", text: `Gotcha! ${displayName(foe)} was caught!`, result: "caught" });
    b.over = "caught";
    b.caught = foe;
    // A catch earns what a win would, as it does in the games this follows.
    awardXp(b, foe, ev);
    return;
  }
  ev.push({ t: "breakout", text: ["Oh no! It broke free!", "Aww! It appeared to be caught!", "Argh! Almost had it!", "Shoot! It was so close, too!"][shakes] });
}

function performMove(b: Battle, s: SideId, index: number, random: () => number, ev: BattleEvent[]): void {
  const me = activeOf(b, s), them = activeOf(b, other(s));
  const known = index >= 0 ? me.moves[index] : undefined;
  const move = known && known.pp > 0 ? MOVES[known.id] : STRUGGLE;
  const who = nameIn(b, s, me, true);

  // Asleep or paralysed, it may not act at all.
  if (me.status === "sleep") {
    me.sleep = Math.max(0, (me.sleep ?? 1) - 1);
    if (me.sleep > 0) { ev.push({ t: "text", text: `${who} is fast asleep.` }); return; }
    me.status = null;
    delete me.sleep;
    ev.push({ t: "status", side: s, text: `${who} woke up!` });
  }
  if (me.status === "paralysis" && random() < 0.25) { ev.push({ t: "text", text: `${who} is paralysed! It can't move!` }); return; }

  if (known && move !== STRUGGLE) known.pp--;
  ev.push({ t: "move", side: s, text: move === STRUGGLE ? `${who} has no moves left, and struggles!` : `${who} used ${move.name}!`, type: move.type, move: move.id });

  // Accuracy stages run in thirds (+1 is four thirds, -1 three quarters); a move that never misses ignores them.
  const acc = b[s].stages.acc;
  const accuracy = move.accuracy === 0 ? Infinity : move.accuracy * (acc >= 0 ? (3 + acc) / 3 : 3 / (3 - acc));
  // Only what is aimed at the foe can miss: a critter never fails to brace itself or mend.
  const targetsFoe = move.category !== "status" || !!move.foe || !!move.status;
  if (targetsFoe && random() * 100 >= accuracy) { ev.push({ t: "miss", side: s, text: `${who}'s attack missed!` }); return; }

  if (move.category !== "status") {
    const types = SPECIES[them.species].types;
    const eff = effectiveness(move.type, types);
    if (eff === 0) { ev.push({ t: "text", text: `It doesn't affect ${nameIn(b, other(s), them)}…` }); return; }
    const physical = move.category === "physical";
    const crit = random() < (move.highCrit ? 1 / 4 : 1 / 16);
    const a = stat(b, s, physical ? "atk" : "sp"), d = stat(b, other(s), physical ? "def" : "sp");
    const stab = move !== STRUGGLE && SPECIES[me.species].types.includes(move.type) ? 1.5 : 1;
    const burn = physical && me.status === "burn" ? 0.5 : 1;
    const mod = stab * (move === STRUGGLE ? 1 : eff) * (crit ? 1.5 : 1) * (0.85 + random() * 0.15) * burn;
    const dmg = Math.min(them.hp, damageRoll(me.level, move.power, a, d, mod));
    them.hp -= dmg;
    const note = crit ? "A critical hit! " : "";
    const effText = move === STRUGGLE ? "" : eff > 1 ? "It's super effective!" : eff < 1 ? "It's not very effective…" : "";
    ev.push({ t: "hit", side: other(s), text: `${note}${effText}`.trim(), hp: them.hp, max: maxHp(them), eff, crit, type: move.type, move: move.id });
    if (move.drain && dmg > 0 && me.hp > 0) {
      me.hp = Math.min(maxHp(me), me.hp + Math.max(1, Math.floor(dmg * move.drain)));
      ev.push({ t: "heal", side: s, text: `${nameIn(b, other(s), them)} had its energy drained!`, hp: me.hp, max: maxHp(me) });
    }
    if (move.recoil && dmg > 0) {
      me.hp = Math.max(0, me.hp - Math.max(1, Math.floor(dmg * move.recoil)));
      ev.push({ t: "hit", side: s, text: `${who} is hit with recoil!`, hp: me.hp, max: maxHp(me) });
    }
    if (them.hp > 0) sideEffects(b, s, move, random, ev);
    return;
  }
  // Status moves.
  if (move.heal) {
    if (me.hp >= maxHp(me)) { ev.push({ t: "text", text: "But its health is already full!" }); return; }
    me.hp = Math.min(maxHp(me), me.hp + Math.floor(maxHp(me) * move.heal));
    ev.push({ t: "heal", side: s, text: `${who} restored its health.`, hp: me.hp, max: maxHp(me) });
    return;
  }
  const before = ev.length;
  sideEffects(b, s, move, random, ev);
  if (ev.length === before) ev.push({ t: "text", text: "But nothing happened!" });
}

const STAGE_NAMES: Record<Stage, string> = { atk: "attack", def: "defence", sp: "special", spd: "speed", acc: "accuracy" };

/** A move's extra effects: a status on the target, stages up on the user or down on the target. */
function sideEffects(b: Battle, s: SideId, move: MoveDef, random: () => number, ev: BattleEvent[]): void {
  const t = other(s);
  const them = activeOf(b, t);
  const damaging = move.category !== "status";
  const chance = move.chance ?? 100;
  if (move.status && random() * 100 < chance) inflict(b, t, move.status, random, ev, !damaging);
  const stages = (side: SideId, changes: Partial<Record<Stage, number>>) => {
    for (const [k, by] of Object.entries(changes) as [Stage, number][]) {
      const cur = b[side].stages[k];
      const next = Math.max(-6, Math.min(6, cur + by));
      const name = b.kind === "link" ? nameIn(b, side) : side === "foe" && b.kind !== "trainer" ? `The wild ${displayName(activeOf(b, side))}` : displayName(activeOf(b, side));
      if (next === cur) { if (!damaging) ev.push({ t: "text", text: `${name}'s ${STAGE_NAMES[k]} won't go any ${by > 0 ? "higher" : "lower"}!` }); continue; }
      b[side].stages[k] = next;
      ev.push({ t: "stage", side, text: `${name}'s ${STAGE_NAMES[k]} ${by > 0 ? (by > 1 ? "rose sharply" : "rose") : by < -1 ? "harshly fell" : "fell"}!` });
    }
  };
  if (move.self && (!damaging || random() * 100 < chance)) stages(s, move.self);
  if (move.foe && them.hp > 0 && (!damaging || random() * 100 < chance)) stages(t, move.foe);
}

function inflict(b: Battle, s: SideId, status: Status, random: () => number, ev: BattleEvent[], loud: boolean): void {
  const c = activeOf(b, s);
  const types = SPECIES[c.species].types;
  // Fire does not burn, lightning does not stun its own kind.
  const immune = (status === "burn" && types.includes("fire")) || (status === "paralysis" && types.includes("electric"));
  if (c.status || immune) {
    if (loud) ev.push({ t: "text", text: c.status ? `${nameIn(b, s, c)} is already ${STATUS_NAMES[c.status]}.` : `It doesn't affect ${nameIn(b, s, c)}…` });
    return;
  }
  c.status = status;
  if (status === "sleep") c.sleep = 1 + Math.floor(random() * 3);
  ev.push({ t: "status", side: s, text: `${nameIn(b, s, c)} is ${STATUS_NAMES[status]}!` });
}

/** Burns and poison bite at the end of the turn. */
function endOfTurn(b: Battle, ev: BattleEvent[]): void {
  for (const s of ["player", "foe"] as SideId[]) {
    const c = activeOf(b, s);
    if (c.hp <= 0 || (c.status !== "burn" && c.status !== "poison")) continue;
    const dmg = Math.min(c.hp, Math.max(1, Math.floor(maxHp(c) / (c.status === "burn" ? 16 : 8))));
    c.hp -= dmg;
    ev.push({ t: "hit", side: s, text: `${nameIn(b, s, c)} is hurt by its ${c.status === "burn" ? "burn" : "poison"}!`, hp: c.hp, max: maxHp(c) });
    if (checkFaints(b, ev)) return;
  }
}

/** Whoever fainted: experience for the winner, the next critter out (or the end). True when anything fainted. */
function checkFaints(b: Battle, ev: BattleEvent[]): boolean {
  let any = false;
  if (b.kind === "link") return linkFaints(b, ev);
  const foe = activeOf(b, "foe");
  if (foe.hp <= 0 && !b.over) {
    any = true;
    ev.push({ t: "faint", side: "foe", text: `${b.kind === "trainer" ? `${b.foe.name}'s ${displayName(foe)}` : `The wild ${displayName(foe)}`} fainted!` });
    awardXp(b, foe, ev);
    const next = b.foe.team.findIndex((c) => c.hp > 0);
    if (next >= 0) {
      switchIn(b, "foe", next, ev);
      // Whoever is out now faces the newcomer; only they share its experience.
      b.fought = activeOf(b, "player").hp > 0 ? [activeOf(b, "player").uid] : [];
    } else {
      b.over = "win";
      ev.push({ t: "end", text: b.kind === "trainer" ? `You defeated ${b.foe.name}!` : "", result: "win" });
    }
  }
  const mine = activeOf(b, "player");
  if (mine.hp <= 0 && !b.over) {
    any = true;
    ev.push({ t: "faint", side: "player", text: `${displayName(mine)} fainted!`, uid: mine.uid });
    b.fought = b.fought.filter((u) => u !== mine.uid);
    if (b.player.team.some((c) => c.hp > 0)) b.mustSwitch = true;
    else {
      b.over = "lose";
      ev.push({ t: "end", text: `${b.player.name} is out of usable critters!`, result: "lose" });
    }
  }
  return any;
}

/** Experience for beating (or catching) a critter, split between the player's that fought it and are still standing. */
function awardXp(b: Battle, foe: Critter, ev: BattleEvent[]): void {
  const takers = b.player.team.filter((c) => b.fought.includes(c.uid) && c.hp > 0);
  if (!takers.length) return;
  const each = Math.max(1, Math.floor(xpReward(foe.species, foe.level, b.kind === "trainer") / takers.length));
  for (const c of takers) {
    // A critter that came in a trade learns faster, as it does in the games this follows: it has something to prove.
    const traded = !!c.ot && c.ot !== b.player.name;
    const gain = traded ? Math.floor(each * 1.5) : each;
    const r = gainXp(c, gain);
    ev.push({ t: "xp", text: `${displayName(c)} gained ${traded ? "a boosted " : ""}${gain} experience.`, uid: c.uid });
    for (const l of r.levels) ev.push({ t: "level", text: `${displayName(c)} grew to level ${l}!`, uid: c.uid, side: c === activeOf(b, "player") ? "player" : undefined, hp: c.hp, max: maxHp(c) });
    for (const m of r.learned) ev.push({ t: "learn", text: `${displayName(c)} learned ${MOVES[m].name}!`, uid: c.uid });
    for (const m of r.offered) b.offers.push({ uid: c.uid, move: m });
  }
}

// ---- a link battle -----------------------------------------------------------------------------------------

/**
 * A link battle's turn: both players' choices at once. Forfeits first, then
 * switches, then the moves in priority and speed order. There are no items
 * and no experience: the teams are copies, healed for the battle, and nothing
 * that happens to them lasts. A critter that faints is replaced by the next in
 * line, so a turn never waits on a third message.
 */
function linkTurn(b: Battle, mine: Action, theirs: Action, random: () => number, ev: BattleEvent[]): BattleEvent[] {
  if (mine.kind === "run") { forfeit(b, "player", ev); return ev; }
  if (theirs.kind === "run") { forfeit(b, "foe", ev); return ev; }
  const picks: [SideId, Action][] = [["player", mine], ["foe", theirs]];
  // A switch to a fainted or missing critter is no switch: the critter out stays and fights.
  const moves: [SideId, number][] = [];
  for (const [side, a] of picks) {
    if (a.kind === "switch" && switchIn(b, side, a.to, ev)) continue;
    moves.push([side, usableMove(activeOf(b, side), a.kind === "move" ? a.index : -1)]);
  }
  if (moves.length === 2) {
    const [pm, fm] = moves.map(([side, i]) => moveOf(i >= 0 ? activeOf(b, side).moves[i].id : "struggle"));
    const pp = pm.priority ?? 0, fp = fm.priority ?? 0;
    const ps = stat(b, "player", "spd"), fs = stat(b, "foe", "spd");
    if (!(pp !== fp ? pp > fp : ps !== fs ? ps > fs : random() < 0.5)) moves.reverse();
  }
  for (const [side, index] of moves) {
    if (b.over || activeOf(b, side).hp <= 0 || activeOf(b, other(side)).hp <= 0) continue;
    performMove(b, side, index, random, ev);
    if (linkFaints(b, ev, side)) break;
  }
  if (!b.over) endOfTurn(b, ev);
  return ev;
}

function forfeit(b: Battle, s: SideId, ev: BattleEvent[]): void {
  b.over = s === "player" ? "lose" : "win";
  ev.push({ t: "end", text: `${b[s].name} forfeits! ${b[other(s)].name} wins the battle.`, result: b.over });
}

/**
 * A link battle's faints: the next in line goes out, or that trainer has lost.
 * Both last critters down at once (the finishing blow's recoil) goes to the
 * attacker, as the newer games rule it: the one that was hit fell first.
 */
function linkFaints(b: Battle, ev: BattleEvent[], attacker: SideId = "player"): boolean {
  let any = false;
  const down: SideId[] = [];
  for (const s of [other(attacker), attacker]) {
    const c = activeOf(b, s);
    if (c.hp > 0 || b.over) continue;
    any = true;
    ev.push({ t: "faint", side: s, text: `${nameIn(b, s, c)} fainted!`, uid: c.uid });
    down.push(s);
  }
  for (const s of down) {
    if (b.over) break;
    const next = b[s].team.findIndex((c) => c.hp > 0);
    if (next >= 0) { switchIn(b, s, next, ev); continue; }
    b.over = s === "player" ? "lose" : "win";
    ev.push({ t: "end", text: `${b[s].name} is out of usable critters! ${b[other(s)].name} wins the battle.`, result: b.over });
  }
  return any;
}

/** One side of a link battle, as the challenger's machine tells the other what it now looks like. */
export interface LinkSideState { active: number; team: { hp: number; status: Status | null; sleep?: number; pp: number[] }[] }
export interface LinkState { player: LinkSideState; foe: LinkSideState; over: BattleResult | null; turn: number }

const sideState = (s: Side): LinkSideState => ({
  active: s.active,
  team: s.team.map((c) => ({ hp: c.hp, status: c.status, ...(c.sleep ? { sleep: c.sleep } : {}), pp: c.moves.map((m) => m.pp) })),
});

export function linkState(b: Battle): LinkState {
  return { player: sideState(b.player), foe: sideState(b.foe), over: b.over, turn: b.turn };
}

const flipResult = (r: BattleResult | null | undefined): BattleResult | null =>
  r === "win" ? "lose" : r === "lose" ? "win" : r ?? null;

/**
 * The other player's copy of the battle brought up to date: the challenger's
 * "player" is this machine's "foe". Every number is clamped to what the
 * critter could have, so a bad message can move a health bar and no more.
 */
export function applyLinkState(b: Battle, st: LinkState): void {
  const put = (side: Side, s: LinkSideState | undefined) => {
    if (!s || !Array.isArray(s.team)) return;
    side.team.forEach((c, i) => {
      const t = s.team[i];
      if (!t) return;
      c.hp = Math.max(0, Math.min(maxHp(c), Math.floor(Number(t.hp) || 0)));
      c.status = t.status === "burn" || t.status === "poison" || t.status === "paralysis" || t.status === "sleep" ? t.status : null;
      if (c.status === "sleep") c.sleep = Math.max(0, Math.min(3, Math.floor(Number(t.sleep) || 0))); else delete c.sleep;
      c.moves.forEach((m, k) => { m.pp = Math.max(0, Math.min(MOVES[m.id]?.pp ?? 0, Math.floor(Number(t.pp?.[k]) || 0))); });
    });
    const a = Math.floor(Number(s.active));
    if (a >= 0 && a < side.team.length) side.active = a;
  };
  put(b.player, st.foe);
  put(b.foe, st.player);
  b.over = flipResult(st.over);
  if (Number.isFinite(st.turn)) b.turn = Math.max(0, Math.floor(st.turn));
}

/** The challenger's events as the other player sees them: their "player" is our "foe", their win our loss. */
export function mirrorEvent(e: BattleEvent): BattleEvent {
  const out: BattleEvent = { ...e };
  if (e.side) out.side = other(e.side);
  if (e.result) out.result = flipResult(e.result)!;
  return out;
}

// ---- the safari --------------------------------------------------------------------------------------------

/** A safari turn: no critter of yours comes out. Throw an orb, some bait, or mud — or leave — and it may bolt. */
function safariTurn(b: Battle, action: Action, random: () => number, ev: BattleEvent[]): BattleEvent[] {
  const sf = b.safari!;
  const foe = activeOf(b, "foe");
  const name = `The wild ${displayName(foe)}`;
  if (action.kind === "run") {
    ev.push({ t: "end", text: "You left it in peace.", result: "ran" });
    b.over = "ran";
    return ev;
  }
  if (action.kind === "bait") {
    sf.bait = Math.min(6, sf.bait + 2 + Math.floor(random() * 4)); sf.anger = 0;
    ev.push({ t: "text", text: `You threw some bait. ${name} is eating!` });
  } else if (action.kind === "mud") {
    sf.anger = Math.min(6, sf.anger + 2 + Math.floor(random() * 4)); sf.bait = 0;
    ev.push({ t: "text", text: `You threw mud. ${name} is angry!` });
  } else if (action.kind === "item" && ORBS[action.item]) {
    if (sf.orbs <= 0) { ev.push({ t: "text", text: "You have no orbs left." }); return ev; }
    sf.orbs--;
    // Anger makes it easier to catch (it stops dodging); bait makes it harder (it is not paying attention to you).
    throwAt(b, action.item, sf.anger > 0 ? 2 : sf.bait > 0 ? 0.5 : 1, random, ev);
    if (b.over) return ev;
  } else {
    ev.push({ t: "text", text: "You can only throw orbs, bait or mud in the park." });
    return ev;
  }
  // Will it stay? Quick critters bolt sooner; bait settles them, anger unsettles them.
  const s = SPECIES[foe.species];
  let flee = Math.min(0.6, 0.08 + s.base.spd / 400);
  if (sf.bait > 0) { flee *= 0.4; sf.bait--; }
  if (sf.anger > 0) { flee *= 2; sf.anger--; }
  if (random() < flee) {
    ev.push({ t: "flee", text: `${name} ran away!`, result: "fled" });
    b.over = "fled";
  } else if (sf.orbs <= 0) {
    ev.push({ t: "end", text: "You are out of orbs!", result: "ran" });
    b.over = "ran";
  } else ev.push({ t: "text", text: `${name} is watching carefully.` });
  return ev;
}

// ---- afterwards -------------------------------------------------------------------------------------------

/**
 * After the battle: every standing critter whose level has reached its
 * evolution evolves. Returns what each became, in words.
 */
export function evolveAfter(party: Critter[]): { uid: string; from: string; to: string; text: string }[] {
  const out: { uid: string; from: string; to: string; text: string }[] = [];
  for (const c of party) {
    if (c.hp <= 0) continue;
    // A critter may skip a stage if it levelled past two at once: evolve again while it can.
    while (evolutionFor(c)) {
      const was = displayName(c), from = c.species;
      const to = evolve(c)!;
      out.push({ uid: c.uid, from, to, text: `${was} evolved into ${SPECIES[to].name}!` });
    }
  }
  return out;
}

/** A type's name, for the move list. */
export const typeName = (t: string): string => TYPE_NAMES[t as keyof typeof TYPE_NAMES] ?? t;
