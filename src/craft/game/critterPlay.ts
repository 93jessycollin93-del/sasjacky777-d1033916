/**
 * The monster-collecting modes at play: battles, catching, trainers, the
 * party walking at your heels, healing stations, the shop and the box
 * (engine/critters.ts is the data, engine/battle.ts the fighting).
 *
 * A battle is the local player's own. It runs on their machine — the
 * party is theirs, kept in their player save — and the world only has to
 * show it: the wild critter held still where it stands, the player's
 * critter out of its orb in front of them, a trainer's opposite, sparks of
 * each move's colour where it lands. Those few things live on the host, so
 * a guest asks for them ("ck" messages, net/session.ts) and the host does
 * them for everyone alike (the `host…` methods here).
 */
import type { Game } from "./game";
import { Mob } from "../engine/mobs";
import { itemByName, type ItemStack } from "../engine/items";
import { hash4, Rng } from "../engine/rng";
import { biomeDef } from "../engine/biomes";
import { block, isFluid } from "../engine/blocks";
import {
  addCritter, canBattle, displayName, freshCard, makeCritter, maxHp, MEDICINE, MOVES, ORBS, PARTY_MAX, pickWild, restore, SHOP, SPECIES, TYPE_COLORS,
  wildLevelAt, giveMedicine, type Critter, type TrainerCard,
} from "../engine/critters";
import { activeOf, evolveAfter, newBattle, openingEvents, runTurn, type Action, type Battle, type BattleEvent } from "../engine/battle";
import { BADGES, prizeFor, towerTrainer, trainerById, trainerTeam, trainerTitle, type TrainerDef } from "../engine/trainers";
import { mapLayout, type CritterArea, type MapLayout } from "../engine/maps";
import { Generator } from "../engine/worldgen";
import { modeDef } from "../modes/modes";
import { CritterLink, type LinkBattle } from "./critterLink";

/** A battle on the local player's screen, and what in the world it is with. */
export interface BattleSession {
  b: Battle;
  /** The wild critter's entity, for a wild or safari battle. */
  wild: number | null;
  /** The trainer, and their entity (none for a Spire challenger, who is spawned for the battle). */
  trainer: TrainerDef | null;
  trainerEntity: number | null;
  /** The opening lines, for the screen to play first. */
  opening: BattleEvent[];
  /** One-life rules: whether this critter may be caught (the first met in its area only). */
  catchable: boolean;
  area: string | null;
  /** A link battle against another player (game/critterLink.ts). */
  link?: LinkBattle;
}

/** What one "ck" message asks of the host. */
export type CritterOp =
  | ["claim", number, number, number]
  | ["release", number]
  | ["end", number, "caught" | "win" | "fled"]
  | ["out", "mine" | "foe" | "npc", string, string, number, 0 | 1, number, number, number, number, number, 0 | 1]
  | ["in", "mine" | "foe" | "npc"]
  | ["fx", "mine" | "foe", string, 0 | 1]
  | ["fxe", number, string, 0 | 1]
  | ["score", string];

/** A "ck" message from a guest, trusted for nothing: the shape checked, the numbers finite, the strings short. */
export function parseCritterOp(v: unknown): CritterOp | null {
  if (!Array.isArray(v) || typeof v[0] !== "string") return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : NaN);
  const str = (x: unknown) => (typeof x === "string" && x.length <= 64 ? x : null);
  const slot = (x: unknown) => (x === "mine" || x === "foe" || x === "npc" ? x : null);
  switch (v[0]) {
    case "claim": return Number.isInteger(v[1]) && Number.isFinite(n(v[2])) && Number.isFinite(n(v[3])) ? ["claim", v[1], n(v[2]), n(v[3])] : null;
    case "release": return Number.isInteger(v[1]) ? ["release", v[1]] : null;
    case "end": return Number.isInteger(v[1]) && (v[2] === "caught" || v[2] === "win" || v[2] === "fled") ? ["end", v[1], v[2]] : null;
    case "out": {
      const sl = slot(v[1]), uid = str(v[2]), sp = str(v[3]);
      if (!sl || uid === null || sp === null || ![n(v[4]), n(v[6]), n(v[7]), n(v[8])].every(Number.isFinite)) return null;
      return ["out", sl, uid, sp, Math.max(1, Math.min(100, Math.floor(n(v[4])))), v[5] === 1 ? 1 : 0, n(v[6]), n(v[7]), n(v[8]), n(v[9]), n(v[10]), v[11] === 1 ? 1 : 0];
    }
    case "in": { const sl = slot(v[1]); return sl ? ["in", sl] : null; }
    case "fx": { const sl = slot(v[1]); return sl && sl !== "npc" && str(v[2]) ? ["fx", sl, v[2] as string, v[3] === 1 ? 1 : 0] : null; }
    case "fxe": return Number.isInteger(v[1]) && str(v[2]) ? ["fxe", v[1], v[2] as string, v[3] === 1 ? 1 : 0] : null;
    case "score": return str(v[1]) ? ["score", v[1] as string] : null;
  }
  return null;
}

const MAX_CRITTERS = 14;
/** How long a battle may hold a wild critter still, in ticks: long enough for any battle, not forever. */
const BATTLE_HOLD = 20 * 60 * 20;

export class CritterPlay {
  battle: BattleSession | null = null;
  /** A trainer who has spotted the local player, and the ticks until they walk up and challenge. */
  private challenge: { entity: number; ticks: number } | null = null;
  private ticks = 0;
  private walkingSent: string | null = null;
  /** Battles and trades with other players. */
  readonly link: CritterLink;

  constructor(private readonly g: Game) {
    this.link = new CritterLink(g, this);
  }

  /** Whether this world is one of the critter modes. */
  get on(): boolean {
    return modeDef(this.g.meta.mode?.id)?.fauna === "critters";
  }

  get rules(): { nuzlocke?: boolean; safari?: boolean; spire?: boolean } {
    return modeDef(this.g.meta.mode?.id)?.critters ?? {};
  }

  get card(): TrainerCard {
    return this.g.player.card;
  }

  private layoutCache: MapLayout | null | undefined;

  /** The world's map pack, laid out once (a region is thousands of blocks; it is not built twice). */
  layout(): MapLayout | null {
    if (this.layoutCache !== undefined) return this.layoutCache;
    const m = this.g.meta;
    return (this.layoutCache = m.map ? mapLayout(m.map, m.seed, new Generator({ seed: m.seed, type: m.type, dimension: "overworld" })) : null);
  }

  /** The world's critter areas (the region map's routes and towns), or none on open terrain. */
  areas(): CritterArea[] {
    return this.layout()?.areas ?? [];
  }

  areaAt(x: number, z: number): CritterArea | null {
    return this.areas().find((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) ?? null;
  }

  // ---- starting a battle -------------------------------------------------------------------------------

  /** A wild critter the player used: battle it (or, in the park, try to catch it). */
  startWild(m: Mob): void {
    const g = this.g, card = this.card;
    if (this.battle || m.kind !== "critter" || m.owner || m.dying) return;
    if (m.battle && m.battle !== g.player.id) { g.showActionbar("Someone else is battling that critter."); return; }
    const safari = !!this.rules.safari;
    if (safari && this.count("park_orb") <= 0) { g.showActionbar("You are out of Park Orbs."); return; }
    if (!safari && !canBattle(card)) {
      g.showActionbar(card.party.length ? "Your critters have all fainted — heal them at a healing station." : "You have no critters to battle with yet.");
      return;
    }
    // The same critter is the same wherever it is read: its stats come from the world's seed and its id.
    const foe = makeCritter(m.species, m.level, new Rng(hash4(g.meta.seed, m.id, 0x5eed)), { shiny: m.shiny });
    const area = this.areaAt(m.x, m.z);
    let catchable = true;
    if (this.rules.nuzlocke) {
      const key = area?.name ?? `wilds ${Math.floor(m.x / 128)},${Math.floor(m.z / 128)}`;
      const used = (card.encounters ??= []);
      catchable = !used.includes(key);
      if (catchable) used.push(key);
    }
    const b = newBattle(safari ? "safari" : "wild", g.player.name, card.party, "", [foe], { orbs: this.count("park_orb") });
    this.battle = { b, wild: m.id, trainer: null, trainerEntity: null, opening: openingEvents(b), catchable, area: area?.name ?? null };
    if (this.rules.nuzlocke && !catchable) this.battle.opening.push({ t: "text", text: "You have already met your one critter here: this one cannot be caught." });
    this.see(foe.species);
    const face = this.inFront(m.x, m.z);
    this.request(["claim", m.id, face.x, face.z]);
    this.look(m.x, m.y + m.body.height * 0.5, m.z);
    if (!safari) this.sendMine(face, m.x, m.z);
    g.sound("battle_start", null, 0, 0, 0.8);
    g.setScreen({ kind: "battle" });
  }

  /** A trainer the player walked into the sight of, or spoke to. */
  startTrainer(m: Mob): void {
    const g = this.g, card = this.card;
    if (this.battle || !m.trainerId) return;
    if (m.trainerId === "professor") { this.professor(); return; }
    const t = trainerById(m.trainerId, card.starter);
    if (!t) return;
    const title = trainerTitle(t);
    if (card.beaten.includes(t.id)) { g.message(`${title}: "${t.defeat}"`, "#dddddd"); return; }
    if (t.cls === "champion" && BADGES.some((badge) => !card.badges.includes(badge))) {
      g.message(`${title}: "Four badges first. Then come and find me."`, "#dddddd");
      return;
    }
    if (!canBattle(card)) { g.message(`${title}: "Your critters are in no state to battle. Heal them first!"`, "#dddddd"); return; }
    this.startWithTrainer(t, m.id, m.x, m.z);
  }

  /** A Battle Spire challenger: spawned for the battle, three rentals against three. */
  startSpire(): void {
    const g = this.g, card = this.card;
    if (this.battle) return;
    const run = card.spire;
    if (!run || !card.party.length) { g.setScreen({ kind: "starter", rentals: true }); return; }
    const t = towerTrainer(run.streak + 1, run.seed);
    // Everyone rests between Spire battles: it is a test of play, not of attrition.
    for (const c of card.party) restore(c);
    const b = g.player.body;
    // The challenger steps up to their spot on the spire's floor — or, anywhere else, six blocks ahead of the player.
    const spot = this.layout()?.pads?.[1];
    const x = spot ? spot[0] + 0.5 : b.x - Math.sin(g.player.yaw) * 6, z = spot ? spot[2] + 0.5 : b.z - Math.cos(g.player.yaw) * 6;
    this.request(["out", "npc", t.id, "", 0, 0, x, spot ? spot[1] : b.y, z, b.x, b.z, 1]);
    this.startWithTrainer(t, null, x, z);
  }

  private startWithTrainer(t: TrainerDef, entity: number | null, tx: number, tz: number): void {
    const g = this.g, card = this.card;
    const b = newBattle("trainer", g.player.name, card.party, trainerTitle(t), trainerTeam(t));
    this.battle = { b, wild: null, trainer: t, trainerEntity: entity, opening: [{ t: "text", text: `${trainerTitle(t)}: "${t.intro}"` }, ...openingEvents(b)], catchable: false, area: null };
    this.see(activeOf(b, "foe").species);
    const face = this.inFront(tx, tz);
    this.sendMine(face, tx, tz);
    this.sendFoe(tx, tz, face);
    if (this.lastFoe) this.look(this.lastFoe.x, this.groundY(this.lastFoe.x, this.lastFoe.z, g.player.body.y) + 0.3, this.lastFoe.z);
    g.sound("battle_start", null, 0, 0, 0.8);
    g.setScreen({ kind: "battle" });
  }

  /** The professor: a starter for a trainer without one, a word of encouragement otherwise. */
  professor(): void {
    const g = this.g, card = this.card;
    if (!card.party.length && !card.box.length) { g.setScreen({ kind: "starter" }); return; }
    g.message(`Professor Wren: "You have caught ${card.caught.length} kind${card.caught.length === 1 ? "" : "s"} of critter and met ${card.seen.length}. Keep going!"`, "#dddddd");
  }

  /** Takes the chosen starter (or, in the Spire, three rentals). */
  chooseStarter(species: string[]): void {
    const g = this.g, card = this.card;
    const rng = new Rng((Math.random() * 0x7fffffff) | 0);
    if (this.rules.spire) {
      card.party = species.slice(0, 3).map((s) => makeCritter(s, 50, rng, { ot: g.player.name, met: "the Battle Spire" }));
      card.spire = { streak: 0, seed: (Math.random() * 0x7fffffff) | 0 };
      g.setScreen(null);
      g.message("Your rentals are ready. Step onto the emerald pad — or use \"Face the next challenger\" in your party — to meet the first challenger.", "#aaffaa");
      return;
    }
    const s = species[0];
    if (!SPECIES[s]?.starter || card.party.length) return;
    const c = makeCritter(s, 5, rng, { ot: g.player.name, met: "a gift from Professor Wren" });
    card.starter = s;
    addCritter(card, c);
    for (const [item, n] of [["capture_orb", 10], ["herbal_tonic", 5]] as const) this.give(item, n);
    card.walking = c.uid;
    g.setScreen(null);
    g.showTitle(`${SPECIES[s].name} joins you!`, "Right-click a wild critter to battle it. P opens your party.");
    g.sound("level_up", null);
  }

  // ---- a turn ------------------------------------------------------------------------------------------------

  /** The player's choice for this turn: what happened, for the screen to play. */
  act(action: Action): BattleEvent[] {
    const s = this.battle;
    if (!s || s.b.over) return [];
    if (s.link) return this.link.act(action);
    if (action.kind === "item") {
      const name = this.nameOf(action.item);
      if (this.count(action.item) <= 0) return [{ t: "text", text: `You have no ${name} left.` }];
      if (ORBS[action.item] && !s.catchable && s.b.kind !== "trainer") return [{ t: "text", text: "One-life rules: only the first critter met in each area may be caught." }];
      if (s.b.kind === "safari" && action.item !== "park_orb") return [{ t: "text", text: "Only Park Orbs work in the park." }];
    }
    const { events, spent } = runTurn(s.b, action, Math.random);
    if (spent && action.kind === "item") this.take(action.item);
    if (s.b.safari) s.b.safari.orbs = this.count("park_orb");
    for (const e of events) {
      if (e.t === "switch" && e.side === "player") this.sendMine(null, 0, 0);
      if (e.t === "switch" && e.side === "foe") { this.see(activeOf(s.b, "foe").species); if (s.trainer) this.sendFoe(null, null, null); }
    }
    return events;
  }

  /** The world's side of one event as the screen plays it: sparks where a move lands, a flinch, the orb's sounds. */
  fx(e: BattleEvent): void {
    const g = this.g, s = this.battle;
    if (!s) return;
    const p = g.player.body;
    switch (e.t) {
      case "move": g.sound("critter_move", p.x, p.y, p.z, 0.6, 0.9 + Math.random() * 0.3); break;
      case "hit":
        // In a link battle each player's machine sparks its own critter: the other's is theirs to show.
        if (s.b.kind === "link" && e.side !== "player") break;
        if (e.type && e.side) {
          if (e.side === "foe" && s.wild !== null) this.request(["fxe", s.wild, e.type, 1]);
          else this.request(["fx", e.side === "player" ? "mine" : "foe", e.type, 1]);
        }
        break;
      case "throw": g.sound("orb_throw", p.x, p.y + 1, p.z, 0.8); break;
      case "shake": g.sound("orb_shake", p.x, p.y, p.z, 0.8, 0.9 + (e.shakes ?? 1) * 0.08); break;
      case "caught": g.sound("orb_catch", p.x, p.y, p.z, 1); break;
      case "level": g.sound("level_up", null, 0, 0, 0.7); break;
      case "faint": g.sound("critter_faint", p.x, p.y, p.z, 0.7, 0.8); break;
    }
  }

  /** A move a critter could learn, in place of one it knows (or -1: not learned). */
  learn(uid: string, move: string, forget: number): string {
    const s = this.battle;
    const c = this.card.party.find((k) => k.uid === uid);
    if (s) s.b.offers = s.b.offers.filter((o) => !(o.uid === uid && o.move === move));
    if (!c || !MOVES[move]) return "";
    if (forget < 0 || forget >= c.moves.length) return `${displayName(c)} did not learn ${MOVES[move].name}.`;
    const old = c.moves[forget];
    c.moves[forget] = { id: move, pp: MOVES[move].pp };
    return `${displayName(c)} forgot ${MOVES[old.id]?.name ?? old.id} and learned ${MOVES[move].name}!`;
  }

  // ---- the end of a battle ---------------------------------------------------------------------------------------

  /** Settles a finished battle: the catch, the prize, the badge, evolutions — or the long walk back. Returns what to tell the player. */
  finish(): string[] {
    const g = this.g, card = this.card, s = this.battle;
    if (!s) return [];
    const b = s.b;
    const result = b.over ?? "ran";
    const lines: string[] = [];
    if (s.link) {
      // Copies fought, so there is nothing to settle but the record.
      this.link.left();
      const rec = (card.link ??= { wins: 0, losses: 0, trades: 0 });
      if (result === "win") { rec.wins++; g.advance({ kind: "link_win" }); lines.push(`You won the link battle against ${s.link.peerName}!`); }
      else if (result === "lose") { rec.losses++; lines.push(`${s.link.peerName} won the link battle. GG.`); }
      lines.push(`Link record: ${rec.wins} won, ${rec.losses} lost.`);
      return this.close(lines);
    }
    if (result === "caught" && b.caught) {
      const c = b.caught;
      c.ot = g.player.name;
      c.met = s.area ? `caught on ${s.area}` : "caught in the wilds";
      const where = addCritter(card, c);
      if (where === "box") lines.push(`${displayName(c)} was sent to your storage box.`);
      if (where === "full") lines.push(`Your party and box are full — ${displayName(c)} was released.`);
      this.request(["score", c.species]);
      g.advance({ kind: "catch" });
    }
    if (s.wild !== null) {
      if (result === "caught" || result === "win" || result === "fled") this.request(["end", s.wild, result]);
      else this.request(["release", s.wild]);
    }
    if (s.trainer && result === "win") {
      const t = s.trainer;
      if (t.cls === "tower" || t.cls === "tycoon") {
        const run = card.spire!;
        run.streak++;
        card.spireBest = Math.max(card.spireBest ?? 0, run.streak);
        lines.push(`Win streak: ${run.streak}.`);
        if (t.cls === "tycoon") this.give("star_orb", 1);
      } else {
        if (!card.beaten.includes(t.id)) card.beaten.push(t.id);
        const prize = prizeFor(t);
        card.coins += prize;
        lines.push(`${trainerTitle(t)}: "${t.defeat}"`, `You got ${prize} coins for winning.`);
        if (t.badge && !card.badges.includes(t.badge)) {
          card.badges.push(t.badge);
          g.showTitle(t.badge, `${card.badges.length} of ${BADGES.length}`);
          g.advance({ kind: "badge" });
        }
        if (t.cls === "champion") {
          g.showTitle("Champion!", `${g.player.name} and ${card.party.map(displayName).join(", ")}`);
          g.advance({ kind: "champion" });
        }
        if (t.cls === "ceo") {
          g.showTitle("Team Copium disbanded", "…and rebranded. It's Team Hopium now.");
          g.advance({ kind: "copium" });
        }
      }
    }
    if (s.trainer && (s.trainer.cls === "tower" || s.trainer.cls === "tycoon") && result === "lose") {
      const streak = card.spire?.streak ?? 0;
      lines.push(`The run ends at ${streak} win${streak === 1 ? "" : "s"}. Best: ${card.spireBest ?? 0}.`);
      card.spire = undefined;
      card.party = [];
    } else if (result === "lose") lines.push(...this.whiteout());
    // One-life rules: a critter that fainted is gone.
    if (this.rules.nuzlocke) {
      const gone = card.party.filter((c) => c.hp <= 0);
      if (gone.length) {
        card.party = card.party.filter((c) => c.hp > 0);
        lines.push(`${gone.map(displayName).join(", ")} fainted, and ${gone.length === 1 ? "is" : "are"} gone for good.`);
      }
      if (!card.party.length && !card.box.some((c) => c.hp > 0)) {
        g.showTitle("Your run is over", `${card.badges.length} badge${card.badges.length === 1 ? "" : "s"}`);
        const best = card.badges.length;
        Object.assign(card, freshCard());
        lines.push(`Every critter is gone. The run ends with ${best} badge${best === 1 ? "" : "s"} — a new starter waits with the professor.`);
      }
    }
    for (const e of evolveAfter(card.party)) { lines.push(e.text); g.showTitle(`${SPECIES[e.to].name}!`, e.text); g.sound("level_up", null); }
    if (s.trainer && s.trainerEntity === null) this.request(["in", "npc"]);
    return this.close(lines);
  }

  /** The world lets go: the critters out for the battle go back, and whoever was walking comes out again. */
  private close(lines: string[]): string[] {
    const g = this.g;
    this.request(["in", "foe"]);
    this.battle = null;
    this.walkingSent = null;
    this.spireReady = this.ticks + 100;
    this.syncWalking(true);
    for (const l of lines) g.message(l, "#ffff99");
    g.setScreen(null);
    g.bumpInv();
    return lines;
  }

  /** Every critter down: half the coins gone, everyone healed, back to the last healing station. */
  private whiteout(): string[] {
    const g = this.g, card = this.card;
    if (this.rules.nuzlocke) return [];
    const lost = Math.floor(card.coins / 2);
    card.coins -= lost;
    for (const c of card.party) restore(c);
    const to = card.center ? { x: card.center[0] + 0.5, y: card.center[1], z: card.center[2] + 1.5 } : g.worldSpawn();
    g.teleportLocal(to.x, to.y, to.z);
    return [`You have no critters left to battle! You dropped ${lost} coins and hurried back to ${card.center ? "the last healing station" : "where you started"}.`];
  }

  // ---- the world ------------------------------------------------------------------------------------------------

  /** Every tick, on every machine, for the local player: trainers spotting them, their partner kept out. */
  tick(): void {
    if (!this.on) return;
    const g = this.g;
    this.ticks++;
    this.link.tick();
    if (this.challenge) {
      if (--this.challenge.ticks <= 0) {
        const e = g.entities.get(this.challenge.entity);
        this.challenge = null;
        if (e instanceof Mob && !this.battle) this.startTrainer(e);
      }
      return;
    }
    if (this.ticks % 20 === 5) this.syncWalking(false);
    if (this.ticks % 4 !== 0 || this.battle || g.screen || g.player.dead || g.player.gameMode === "spectator") return;
    // A starter first, for a new trainer; the Spire wants its rentals.
    if (this.ticks % 40 === 0 && !this.card.party.length && !this.card.box.length && !this.rules.safari && g.spawnReady) {
      g.setScreen({ kind: "starter", rentals: !!this.rules.spire });
      return;
    }
    // The Spire: stepping onto its pad calls the next challenger (a moment after the last battle, not at once).
    if (this.rules.spire && this.card.party.length && this.ticks > this.spireReady) {
      const pad = this.layout()?.pads?.[0];
      const p = g.player.body;
      if (pad && Math.floor(p.x) === pad[0] && Math.floor(p.z) === pad[2] && Math.abs(p.y - (pad[1] + 1)) < 0.6) { this.spireReady = this.ticks + 100; this.startSpire(); return; }
    }
    this.spot();
  }

  private spireReady = 0;

  /** A trainer who can see the player down their road: "!", and they come over to battle. */
  private spot(): void {
    const g = this.g, card = this.card, p = g.player.body;
    if (!canBattle(card)) return;
    for (const e of g.entities.values()) {
      if (!(e instanceof Mob) || e.kind !== "trainer" || !e.trainerId || card.beaten.includes(e.trainerId)) continue;
      const t = trainerById(e.trainerId, card.starter);
      if (!t || t.sight <= 0 || t.cls === "champion") continue;
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
      if (d > t.sight || d < 0.5 || Math.abs(p.y - e.y) > 3) continue;
      // Facing down their road: within a narrow cone ahead of where they watch.
      const fx = -Math.sin(e.homeYaw), fz = -Math.cos(e.homeYaw);
      if ((dx * fx + dz * fz) / d < 0.85) continue;
      this.challenge = { entity: e.id, ticks: 24 };
      g.particles("crit", e.x, e.y + 2.4, e.z, 8);
      g.sound("trainer_spot", e.x, e.y + 1.8, e.z, 1);
      g.showActionbar(`${trainerTitle(t)} wants to battle!`);
      return;
    }
  }

  /** Keeps the critter walking with the player out of its orb (again after a reload, or a battle). */
  syncWalking(force: boolean): void {
    const card = this.card;
    if (this.battle) return;
    const c = card.walking ? card.party.find((k) => k.uid === card.walking && k.hp > 0) : undefined;
    const key = c ? `${c.uid}:${c.species}:${c.level}` : "";
    const g = this.g;
    const present = [...g.entities.values()].some((e) => e instanceof Mob && e.kind === "critter" && e.owner === g.player.id && e.partnerUid === c?.uid);
    if (!force && key === this.walkingSent && (present || !c)) return;
    this.walkingSent = key;
    if (!c) { this.request(["in", "mine"]); return; }
    const p = g.player.body;
    this.request(["out", "mine", c.uid, c.species, c.level, c.shiny ? 1 : 0, p.x + 1, p.y, p.z + 1, NaN, NaN, SPECIES[c.species].ride ? 1 : 0]);
  }

  /** Sends one of the party walking with the player, or none. */
  setWalking(uid: string | null): void {
    const card = this.card;
    card.walking = uid && card.party.some((c) => c.uid === uid) ? uid : undefined;
    this.syncWalking(true);
  }

  // ---- the healing station ------------------------------------------------------------------------------------

  /** Everyone healed, and this station remembered as where to wake if every critter falls. */
  heal(x: number, y: number, z: number): void {
    const g = this.g, card = this.card;
    for (const c of card.party) restore(c);
    card.center = [x, y + 1, z];
    g.sound("heal_jingle", x + 0.5, y + 1, z + 0.5, 1);
    g.particles("heart", x + 0.5, y + 1.3, z + 0.5, 6);
    g.showActionbar("Your critters are fighting fit!");
    g.bumpInv();
  }

  buy(item: string, n = 1): string {
    const card = this.card;
    const price = SHOP.find(([i]) => i === item)?.[1];
    if (price === undefined) return "That is not for sale.";
    if (card.coins < price * n) return "You don't have enough coins.";
    card.coins -= price * n;
    this.give(item, n);
    this.g.bumpInv();
    return `Bought ${n} ${this.nameOf(item)}${n > 1 ? "s" : ""}.`;
  }

  /** Party to box, and box to party: the party always keeps one, and never holds more than six. */
  deposit(uid: string): string {
    const card = this.card;
    const i = card.party.findIndex((c) => c.uid === uid);
    if (i < 0) return "";
    if (card.party.length <= 1) return "You must keep at least one critter with you.";
    const [c] = card.party.splice(i, 1);
    card.box.push(c);
    if (card.walking === uid) this.setWalking(null);
    this.g.bumpInv();
    return `${displayName(c)} went into the box.`;
  }

  withdraw(uid: string): string {
    const card = this.card;
    const i = card.box.findIndex((c) => c.uid === uid);
    if (i < 0) return "";
    if (card.party.length >= PARTY_MAX) return "Your party is full.";
    const [c] = card.box.splice(i, 1);
    card.party.push(c);
    this.g.bumpInv();
    return `${displayName(c)} joined your party.`;
  }

  /** A medicine given from the party screen, out of battle. */
  giveItem(uid: string, item: string): string {
    const c = this.card.party.find((k) => k.uid === uid);
    if (!c || !MEDICINE[item]) return "";
    if (this.count(item) <= 0) return `You have no ${this.nameOf(item)} left.`;
    const r = giveMedicine(c, item);
    if (r.ok) {
      this.take(item);
      for (const e of evolveAfter([c])) { this.g.showTitle(`${SPECIES[e.to].name}!`, e.text); r.text += ` ${e.text}`; }
    }
    this.g.bumpInv();
    return r.text;
  }

  /** Moves a party member one place up (the first goes out first in battle). */
  moveUp(uid: string): void {
    const party = this.card.party;
    const i = party.findIndex((c) => c.uid === uid);
    if (i > 0) [party[i - 1], party[i]] = [party[i], party[i - 1]];
    this.g.bumpInv();
  }

  rename(uid: string, nick: string): void {
    const c = [...this.card.party, ...this.card.box].find((k) => k.uid === uid);
    if (!c) return;
    const n = nick.trim().slice(0, 16);
    if (n && n !== SPECIES[c.species].name) c.nick = n; else delete c.nick;
    this.g.bumpInv();
  }

  // ---- spawning the wild -----------------------------------------------------------------------------------------

  /** Host: a critter or two of the land's own, out of sight but near a player. Returns how many came. */
  trySpawn(origin: { x: number; z: number }, existing: number, players: number): void {
    const g = this.g;
    if (existing >= MAX_CRITTERS * players) return;
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 30;
    const x = Math.floor(origin.x + Math.cos(a) * r), z = Math.floor(origin.z + Math.sin(a) * r);
    const chunk = g.world.chunkAt(x, z);
    if (!chunk) return;
    const top = g.world.topSolid(x, z);
    if (top < 1) return;
    const ground = g.world.blockAt(x, top, z);
    const wet = isFluid(ground) || isFluid(g.world.blockAt(x, top + 1, z));
    if (!block(ground).solid && !wet) return;
    const biome = biomeDef(chunk.biomes[((z & 15) << 4) | (x & 15)]);
    const area = this.areaAt(x, z);
    if (area?.quiet) return;
    const spawn = g.worldSpawn();
    const level = area ? area.levels[0] + Math.floor(Math.random() * (area.levels[1] - area.levels[0] + 1)) : wildLevelAt(Math.hypot(x - spawn.x, z - spawn.z), Math.random);
    const species = pickWild(area?.biome ?? biome.name, level, Math.random);
    if (!species) return;
    const s = SPECIES[species];
    // Swimmers keep to the water's edge; the rest to dry ground.
    if (wet !== (s.moves === "swim") && !(s.moves === "swim" && Math.random() < 0.4)) return;
    const n = s.rarity === "common" && Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const m = new Mob("critter", x + 0.5 + (Math.random() - 0.5) * 3, top + 1 + (s.moves === "fly" ? 2 : 0), z + 0.5 + (Math.random() - 0.5) * 3);
      m.setSpecies(species, Math.max(2, level + (i ? -1 : 0)));
      m.shiny = Math.random() < 1 / 400;
      g.spawn(m);
    }
  }

  // ---- asking the host --------------------------------------------------------------------------------------------

  /** Does it here, when this is the host (or alone); asks the host otherwise. */
  private request(op: CritterOp): void {
    const g = this.g;
    if (g.simulates) this.host(g.player.id, g.player.name, op);
    else g.net?.critter?.(op);
  }

  /** Host: one player's request, checked. Guests' come here from the session; the local player's, directly. */
  host(from: string, name: string, op: CritterOp): void {
    const g = this.g;
    const mob = (id: number) => { const e = g.entities.get(id); return e instanceof Mob && e.kind === "critter" && !e.owner ? e : null; };
    switch (op[0]) {
      case "claim": {
        const m = mob(op[1]);
        if (!m || (m.battle && m.battle !== from)) return;
        m.battle = from; m.battleTicks = BATTLE_HOLD; m.battleFace = { x: op[2], z: op[3] }; m.persistent = true;
        return;
      }
      case "release": {
        const m = mob(op[1]);
        if (m && m.battle === from) { m.battle = null; m.battleFace = null; m.persistent = false; }
        return;
      }
      case "end": {
        const m = mob(op[1]);
        if (!m || (m.battle !== from && m.battle !== null)) return;
        if (op[2] === "caught") {
          g.particles("poof", m.x, m.y + 0.4, m.z, 10);
          m.removed = true;
        } else if (op[2] === "fled") {
          g.particles("poof", m.x, m.y + 0.4, m.z, 6);
          m.removed = true;
        } else {
          // Fainted: it lies down and fades, as a beaten critter goes home to rest.
          m.deathTime = 1;
          m.battle = null;
        }
        return;
      }
      case "out": {
        const [, slot, uid, species, level, shiny, x, y, z, fx, fz, ride] = op;
        const mine = this.battleEntity(from, slot);
        if (slot === "npc") {
          if (!trainerById(uid)) return;
          const t = mine ?? new Mob("trainer", x, y, z);
          t.trainerId = uid; t.owner = from; t.partnerUid = "npc";
          t.home = { x, z }; t.homeYaw = Math.atan2(-(fx - x), -(fz - z));
          if (!mine) g.spawn(t);
          return;
        }
        if (!SPECIES[species]) return;
        const m = mine ?? new Mob("critter", x, y, z);
        m.setSpecies(species, level);
        m.shiny = shiny === 1;
        m.owner = from; m.ownerName = name; m.partnerUid = slot === "foe" ? "foe" : uid; m.persistent = true;
        m.saddled = slot === "mine" && ride === 1;
        const battling = Number.isFinite(fx) && Number.isFinite(fz);
        m.battle = battling ? from : null; m.battleTicks = BATTLE_HOLD; m.battleFace = battling ? { x: fx, z: fz } : null;
        if (!mine || battling) { m.body.x = x; m.body.y = y; m.body.z = z; m.body.vx = m.body.vy = m.body.vz = 0; }
        if (!mine) { g.spawn(m); g.particles("poof", x, y + 0.5, z, 6); g.sound("orb_open", x, y, z, 0.7); }
        return;
      }
      case "in": {
        const m = this.battleEntity(from, op[1]);
        if (!m) return;
        if (op[1] !== "npc") g.particles("poof", m.x, m.y + 0.5, m.z, 4);
        m.removed = true;
        return;
      }
      case "fx": case "fxe": {
        const m = op[0] === "fx" ? this.battleEntity(from, op[1]) : mob(op[1]);
        const color = TYPE_COLORS[op[2] as keyof typeof TYPE_COLORS];
        if (!m || !color) return;
        g.particles("potion", m.x, m.y + m.body.height * 0.6, m.z, 14, parseInt(color.slice(1), 16));
        if (op[3]) { m.hurtTime = 10; g.sound("critter_hit", m.x, m.y + 0.5, m.z, 0.8, 0.8 + Math.random() * 0.4); }
        return;
      }
      case "score":
        if (SPECIES[op[1]]) g.mode?.onCritterCaught(from, op[1]);
        return;
    }
  }

  /** A player's critter out of its orb ("mine", which may be walking with them or battling), a trainer's ("foe"), or a Spire challenger ("npc"). */
  private battleEntity(player: string, slot: "mine" | "foe" | "npc"): Mob | null {
    for (const e of this.g.entities.values()) {
      if (!(e instanceof Mob) || e.owner !== player || e.removed) continue;
      if (slot === "npc" && e.kind === "trainer" && e.partnerUid === "npc") return e;
      if (e.kind !== "critter") continue;
      if (slot === "foe" ? e.partnerUid === "foe" : e.partnerUid !== "foe") return e;
    }
    return null;
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  /**
   * Where the player's critter stands for a battle: a couple of blocks toward the foe and a little to the
   * right, so it is in the picture beside its foe rather than filling the view in front of the trainer.
   */
  private inFront(fx: number, fz: number): { x: number; z: number } {
    const p = this.g.player.body;
    const dx = fx - p.x, dz = fz - p.z, d = Math.hypot(dx, dz) || 1;
    const k = Math.min(2.2, d * 0.45);
    const rx = -dz / d, rz = dx / d;
    return { x: p.x + (dx / d) * k + rx * 1.4, z: p.z + (dz / d) * k + rz * 1.4 };
  }

  private sendMine(at: { x: number; z: number } | null, fx: number, fz: number): void {
    const s = this.battle;
    if (!s || s.b.kind === "safari") return;
    const c = activeOf(s.b, "player");
    if (!c) return;
    const p = this.g.player.body;
    // What it faces: the wild critter, the spot it was sent toward, or (a switch mid-battle) the foe's critter —
    // not (0, 0), which a switch once turned it to face, sending it out toward the world's centre.
    const wild = s.wild !== null ? this.g.entities.get(s.wild) : null;
    const face = wild ? { x: wild.x, z: wild.z } : at ? { x: fx, z: fz } : this.lastFoe ? { x: this.lastFoe.x, z: this.lastFoe.z } : { x: fx || p.x, z: fz || p.z };
    const pos = at ?? this.inFront(face.x, face.z);
    this.request(["out", "mine", c.uid, c.species, c.level, c.shiny ? 1 : 0, pos.x, this.groundY(pos.x, pos.z, p.y), pos.z, face.x, face.z, 0]);
  }

  /** A link battle begins: this player's critter comes out facing the other player, and the view turns to them. */
  linkStart(px: number, pz: number): void {
    this.lastFoe = { x: px, z: pz, face: { x: px, z: pz } };
    this.sendMine(this.inFront(px, pz), px, pz);
    this.look(px, this.g.player.body.y + 0.6, pz);
  }

  /** The world's side of a link battle's turn: this player's critter switched out, if it was. */
  linkWorld(events: BattleEvent[]): void {
    if (events.some((e) => e.t === "switch" && e.side === "player")) this.sendMine(null, 0, 0);
  }

  private lastFoe: { x: number; z: number; face: { x: number; z: number } } | null = null;

  private sendFoe(tx: number | null, tz: number | null, face: { x: number; z: number } | null): void {
    const s = this.battle;
    if (!s) return;
    if (tx !== null && tz !== null && face) {
      const p = this.g.player.body;
      const dx = p.x - tx, dz = p.z - tz, d = Math.hypot(dx, dz) || 1;
      this.lastFoe = { x: tx + (dx / d) * 1.6, z: tz + (dz / d) * 1.6, face };
    }
    const f = this.lastFoe;
    if (!f) return;
    const c = activeOf(s.b, "foe");
    this.request(["out", "foe", c.uid, c.species, c.level, 0, f.x, this.groundY(f.x, f.z, this.g.player.body.y), f.z, f.face.x, f.face.z, 0]);
  }

  /** Turns the player to look at the foe, so it stands in the middle of the view above the battle panel. */
  private look(x: number, y: number, z: number): void {
    const p = this.g.player, b = p.body;
    const dx = x - b.x, dz = z - b.z, eye = b.y + b.eyeHeight;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.max(-0.9, Math.min(0.3, Math.atan2(y - eye, Math.hypot(dx, dz))));
  }

  /** The standing height nearest `near` at (x, z): on top of the ground, with room above — not inside a ledge. */
  private groundY(x: number, z: number, near: number): number {
    const w = this.g.world, bx = Math.floor(x), bz = Math.floor(z), y0 = Math.floor(near);
    const free = (y: number) => !block(w.blockAt(bx, y, bz)).solid;
    for (const d of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const y = y0 + d;
      if (block(w.blockAt(bx, y - 1, bz)).solid && free(y) && free(y + 1)) return y;
    }
    return near;
  }

  see(species: string): void {
    const card = this.card;
    if (!card.seen.includes(species)) card.seen.push(species);
  }

  count(item: string): number {
    let id: number;
    try { id = itemByName(item).id; } catch { return 0; }
    return this.g.player.inventory.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
  }

  private take(item: string): void {
    const g = this.g;
    if (g.player.gameMode === "creative") return;
    const id = itemByName(item).id;
    const slots = g.player.inventory.slots;
    const i = slots.findIndex((s) => s && s.id === id);
    if (i < 0) return;
    const s = slots[i]!;
    if (--s.count <= 0) slots[i] = null;
    g.bumpInv();
  }

  give(item: string, n: number): void {
    const g = this.g;
    const stack: ItemStack = { id: itemByName(item).id, count: n };
    const left = g.player.inventory.add(stack);
    if (left > 0) g.dropItem(g.player.body.x, g.player.body.y + 1, g.player.body.z, { ...stack, count: left });
    g.bumpInv();
  }

  nameOf(item: string): string {
    try { return itemByName(item).displayName; } catch { return item; }
  }

  /** For the HUD: the party's health at a glance, the coins, the badges. */
  hud(): { party: { name: string; species: string; level: number; hp: number; max: number; status: string | null }[]; coins: number; badges: number } | null {
    if (!this.on) return null;
    const card = this.card;
    return {
      party: card.party.map((c: Critter) => ({ name: displayName(c), species: c.species, level: c.level, hp: c.hp, max: maxHp(c), status: c.status })),
      coins: card.coins, badges: card.badges.length,
    };
  }
}
