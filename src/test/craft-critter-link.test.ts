import { describe, expect, it } from "vitest";
import { evolutionFor, freshCard, makeCritter, maxHp, sanitizeCard, SPECIES, tradeEvolve, type Critter, type TrainerCard } from "@/craft/engine/critters";
import { activeOf, applyLinkState, linkState, mirrorEvent, newBattle, openingEvents, runTurn, type Action, type Battle, type BattleEvent } from "@/craft/engine/battle";
import { CLASS_NAMES, regionTrainers, trainerById, trainerTitle } from "@/craft/engine/trainers";
import { CritterLink, linkTeam, parseLinkMsg, type LinkMsg } from "@/craft/game/critterLink";
import type { BattleSession } from "@/craft/game/critterPlay";
import { Rng } from "@/craft/engine/rng";
import { newlyEarned } from "@/craft/engine/advancements";

const MEME = ["dogeling", "wowdoge", "chonklet", "megachonk", "froggo", "vibefrog", "stonkfish", "moonfin", "sussling", "susquatch", "bonkbat", "bonkarang", "rickrock", "neverroll", "copiumite", "hopium"];

const team = (seed: number, ...species: [string, number][]): Critter[] => {
  const rng = new Rng(seed);
  return species.map(([s, l]) => makeCritter(s, l, rng, { shiny: false, ot: "someone" }));
};

describe("the meme critters", () => {
  it("are all here, each evolving into another of them", () => {
    for (const id of MEME) expect(SPECIES[id], id).toBeDefined();
    for (const id of MEME) {
      const e = SPECIES[id].evolves;
      if (e) expect(MEME).toContain(e.to);
    }
  });

  it("evolves a Sussling only by trading it, never by levelling", () => {
    const c = team(1, ["sussling", 100])[0];
    expect(evolutionFor(c)).toBeNull();
    c.hp = Math.floor(maxHp(c) / 2);
    const share = c.hp / maxHp(c);
    expect(tradeEvolve(c)).toBe("susquatch");
    expect(c.species).toBe("susquatch");
    expect(c.hp / maxHp(c)).toBeCloseTo(share, 1);
    // A critter that does not evolve by trade stays itself when traded.
    const doge = team(2, ["dogeling", 50])[0];
    expect(tradeEvolve(doge)).toBeNull();
    expect(doge.species).toBe("dogeling");
  });
});

describe("Team Copium", () => {
  it("has grunts, two execs and a CEO, all on the region's roads, with lines to say", () => {
    const tc = regionTrainers().filter((t) => t.id.startsWith("tc_"));
    expect(tc.filter((t) => t.cls === "grunt")).toHaveLength(3);
    expect(tc.filter((t) => t.cls === "exec").map((t) => t.name).sort()).toEqual(["Doomscroll Dana", "Hodl Hank"]);
    const ceo = tc.find((t) => t.cls === "ceo")!;
    expect(trainerTitle(ceo)).toBe(`${CLASS_NAMES.ceo} Maximus Hype`);
    for (const t of tc) { expect(t.intro.length).toBeGreaterThan(10); expect(t.defeat.length).toBeGreaterThan(10); }
    // The CEO is the strongest of them: the last stop before the League.
    const top = (t: typeof ceo) => Math.max(...t.team.map(([, l]) => l));
    for (const t of tc) if (t !== ceo) expect(top(t)).toBeLessThan(top(ceo));
  });

  it("sends a Copium grunt out of one wanderer in seven or so, the same one every time its id is read", () => {
    const ids = Array.from({ length: 700 }, (_, i) => `w:${i * 7919}:20:Forest`);
    const grunts = ids.filter((id) => trainerById(id)!.cls === "grunt");
    expect(grunts.length).toBeGreaterThan(60);
    expect(grunts.length).toBeLessThan(150);
    for (const id of grunts.slice(0, 20)) expect(trainerById(id)).toEqual(trainerById(id));
  });

  it("gives a win over the CEO its own advancement", () => {
    const state = { inventory: { slots: [], armor: [], offhand: null }, y: 64, level: 0 } as unknown as Parameters<typeof newlyEarned>[1];
    expect(newlyEarned(new Set(), state, { kind: "copium" }).map((a) => a.id)).toEqual(["copium"]);
    expect(newlyEarned(new Set(), state, { kind: "link_win" }).map((a) => a.id)).toEqual(["link_win"]);
    expect(newlyEarned(new Set(), state, { kind: "trade" }).map((a) => a.id)).toEqual(["trade"]);
  });
});

/** A link battle's two views: the challenger's, which runs it, and the other's, which shows it. */
function linkPair(a: Critter[], b: Critter[]): { sim: Battle; view: Battle } {
  return {
    sim: newBattle("link", "Ada", linkTeam(a), "Bo", linkTeam(b)),
    view: newBattle("link", "Bo", linkTeam(b), "Ada", linkTeam(a)),
  };
}

function playTurn(p: { sim: Battle; view: Battle }, ada: Action, bo: Action, random: () => number): { sim: BattleEvent[]; view: BattleEvent[] } {
  const { events } = runTurn(p.sim, ada, random, bo);
  applyLinkState(p.view, JSON.parse(JSON.stringify(linkState(p.sim))));
  return { sim: events, view: events.map(mirrorEvent) };
}

describe("a link battle", () => {
  const A = () => team(10, ["emberkit", 20], ["dogeling", 18]);
  const B = () => team(20, ["axolittle", 19], ["sussling", 20]);

  it("names both trainers from the first line, so each player reads it true", () => {
    const { sim } = linkPair(A(), B());
    const lines = openingEvents(sim).map((e) => e.text);
    expect(lines.join(" ")).toContain("Ada");
    expect(lines.join(" ")).toContain("Bo sends out");
    const r = runTurn(sim, { kind: "move", index: 0 }, new Rng(4).next.bind(new Rng(4)), { kind: "move", index: 0 });
    for (const e of r.events.filter((x) => x.t === "move")) expect(e.text).toMatch(/^(Ada|Bo)'s /);
  });

  it("plays to a winner from both players' choices, sending out the next in line and giving no experience", () => {
    const p = linkPair(A(), B());
    const rng = new Rng(7);
    const all: BattleEvent[] = [];
    for (let i = 0; i < 200 && !p.sim.over; i++) all.push(...playTurn(p, { kind: "move", index: 0 }, { kind: "move", index: 0 }, () => rng.next()).sim);
    expect(["win", "lose"]).toContain(p.sim.over);
    expect(all.some((e) => e.t === "xp" || e.t === "level")).toBe(false);
    // Whoever lost had every critter knocked out, and nobody was asked to choose a replacement.
    const loser = p.sim.over === "win" ? p.sim.foe : p.sim.player;
    expect(loser.team.every((c) => c.hp <= 0)).toBe(true);
    expect(p.sim.mustSwitch).toBe(false);
    expect(all.filter((e) => e.t === "switch").length).toBeGreaterThan(0);
  });

  it("shows the other player the same battle from their side, down to the health bars and the result", () => {
    const p = linkPair(A(), B());
    const rng = new Rng(3);
    while (!p.sim.over) {
      const { view } = playTurn(p, { kind: "move", index: 0 }, { kind: "move", index: 1 }, () => rng.next());
      expect(activeOf(p.view, "player").hp).toBe(activeOf(p.sim, "foe").hp);
      expect(activeOf(p.view, "foe").hp).toBe(activeOf(p.sim, "player").hp);
      expect(p.view.player.active).toBe(p.sim.foe.active);
      expect(p.view.turn).toBe(p.sim.turn);
      // A hit on the challenger's critter is a hit on the other's "foe".
      for (const e of view) if (e.t === "hit" && e.side === "foe") expect(typeof e.hp).toBe("number");
      if (p.sim.over) {
        expect(p.view.over).toBe(p.sim.over === "win" ? "lose" : "win");
        expect(view.at(-1)!.result).toBe(p.view.over);
      }
    }
  });

  it("lets either player forfeit at once, and the other win", () => {
    const p = linkPair(A(), B());
    const r = playTurn(p, { kind: "move", index: 0 }, { kind: "run" }, () => 0.5);
    expect(p.sim.over).toBe("win");
    expect(p.view.over).toBe("lose");
    expect(r.sim.at(-1)!.text).toBe("Bo forfeits! Ada wins the battle.");
    const q = linkPair(A(), B());
    playTurn(q, { kind: "run" }, { kind: "move", index: 0 }, () => 0.5);
    expect(q.sim.over).toBe("lose");
  });

  it("switches before anyone moves, and a switch to a fainted critter is no switch at all", () => {
    const p = linkPair(A(), B());
    const r = playTurn(p, { kind: "switch", to: 1 }, { kind: "move", index: 0 }, () => 0.5);
    expect(r.sim.findIndex((e) => e.t === "switch")).toBeLessThan(r.sim.findIndex((e) => e.t === "move"));
    expect(p.sim.player.active).toBe(1);
    p.sim.foe.team[1].hp = 0;
    playTurn(p, { kind: "move", index: 0 }, { kind: "switch", to: 1 }, () => 0.5);
    expect(p.sim.foe.active).toBe(0);
  });

  it("fights with copies healed for the battle, and leaves the real party as it was", () => {
    const party = A();
    party[0].hp = 3;
    const copy = linkTeam(party);
    expect(copy[0].hp).toBe(maxHp(copy[0]));
    copy[0].hp = 0;
    expect(party[0].hp).toBe(3);
  });

  it("clamps what the other player says about the battle to what could be true", () => {
    const p = linkPair(A(), B());
    const st = linkState(p.sim);
    st.foe.team[0].hp = 99999;
    st.foe.team[0].pp = [999, -5];
    st.foe.active = 42;
    applyLinkState(p.view, st);
    const mine = p.view.player.team[0];
    expect(mine.hp).toBe(maxHp(mine));
    expect(mine.moves[0].pp).toBeLessThanOrEqual(40);
    expect(mine.moves[1].pp).toBe(0);
    expect(p.view.player.active).toBe(0);
  });
});

describe("link messages", () => {
  it("are taken only in the shapes expected, with every critter sanitised", () => {
    expect(parseLinkMsg(null)).toBeNull();
    expect(parseLinkMsg({ k: "ask", what: "duel" })).toBeNull();
    expect(parseLinkMsg({ k: "ask", what: "battle" })).toEqual({ k: "ask", what: "battle" });
    expect(parseLinkMsg({ k: "yes", what: "battle", team: [] })).toBeNull();
    expect(parseLinkMsg({ k: "yes", what: "battle", team: [{ species: "not_a_critter" }] })).toBeNull();
    const big = parseLinkMsg({ k: "start", team: [{ species: "sussling", level: 900, hp: 1e9, moves: [{ id: "ratio", pp: 999 }] }] });
    expect(big?.k).toBe("start");
    const c = (big as { team: Critter[] }).team[0];
    expect(c.level).toBe(100);
    expect(c.hp).toBe(maxHp(c));
    expect(c.moves[0].pp).toBe(15);
    expect(parseLinkMsg({ k: "start", team: new Array(7).fill({ species: "nibbit" }) })).toBeNull();
    expect(parseLinkMsg({ k: "act", turn: 3, a: { kind: "item", item: "star_orb" } })).toBeNull();
    expect(parseLinkMsg({ k: "act", turn: 3, a: { kind: "move", index: 9 } })).toBeNull();
    expect(parseLinkMsg({ k: "act", turn: 3, a: { kind: "switch", to: 2 } })).toEqual({ k: "act", turn: 3, a: { kind: "switch", to: 2 } });
    expect(parseLinkMsg({ k: "turn", turn: 1, ev: [{ t: "caught", text: "Gotcha!" }], st: {} })).toBeNull();
    expect(parseLinkMsg({ k: "turn", turn: 1, ev: [{ t: "hit", text: "x".repeat(300) }], st: {} })).toBeNull();
    expect(parseLinkMsg({ k: "no", why: "<script>" })).toEqual({ k: "no", why: "declined" });
    expect(parseLinkMsg({ k: "ok", mine: "a", theirs: "b".repeat(40) })).toBeNull();
  });
});

// ---- two players, wired together --------------------------------------------------------------------------------

interface Fake { link: CritterLink; card: TrainerCard; said: string[]; screen: { kind: string } | null; session: { battle: BattleSession | null } }

/** Two players' link machinery with a wire between them that delivers when told to, as a network would. */
function twoPlayers(): { ada: Fake; bo: Fake; flush: () => void; drop: (n: number) => void } {
  const wire: [string, string, LinkMsg][] = [];
  const make = (id: string, name: string, other: { id: string; name: string }): Fake => {
    const card = freshCard();
    const said: string[] = [];
    const f = { card, said, screen: null, session: { battle: null } } as unknown as Fake;
    const game = {
      player: { id, name, body: { x: 0, y: 64, z: 0 }, card },
      remote: new Map([[other.id, { id: other.id, name: other.name, x: 5, y: 64, z: 0 }]]),
      net: { link: (to: string, msg: LinkMsg) => wire.push([id, to, JSON.parse(JSON.stringify(msg))]) },
      message: (t: string) => said.push(t), sound: () => {}, showTitle: (t: string) => said.push(t), advance: () => {}, bumpInv: () => {},
      get screen() { return f.screen; }, setScreen: (s: { kind: string } | null) => { f.screen = s; },
    };
    const cp = {
      card, on: true, see: () => {}, setWalking: () => {}, linkStart: () => {}, linkWorld: () => {},
      get battle() { return f.session.battle; }, set battle(v: BattleSession | null) { f.session.battle = v; },
    };
    f.link = new CritterLink(game as never, cp as never);
    return f;
  };
  const ada = make("A", "Ada", { id: "B", name: "Bo" });
  const bo = make("B", "Bo", { id: "A", name: "Ada" });
  const byId: Record<string, Fake> = { A: ada, B: bo };
  const flush = () => {
    for (let i = 0; i < 100 && wire.length; i++) {
      const [from, to, msg] = wire.shift()!;
      const m = parseLinkMsg(msg);
      if (m) byId[to].link.receive(from, m);
    }
  };
  return { ada, bo, flush, drop: (n) => { wire.splice(0, n); } };
}

describe("a trade between two players", () => {
  it("swaps the two critters on the table once both say yes, and evolves a Sussling on arrival", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["dogeling", 12], ["chonklet", 10]);
    bo.card.party = team(2, ["sussling", 15]);
    ada.link.ask("B", "trade");
    flush();
    expect(bo.screen?.kind).toBe("link");
    bo.link.accept();
    flush();
    expect(ada.link.trade && bo.link.trade).toBeTruthy();
    ada.link.offer(ada.card.party[0].uid);
    bo.link.offer(bo.card.party[0].uid);
    flush();
    expect(ada.link.trade!.theirs?.species).toBe("sussling");
    ada.link.agree();
    flush();
    // One yes is not a trade.
    expect(ada.card.party.map((c) => c.species)).toEqual(["dogeling", "chonklet"]);
    bo.link.agree();
    flush();
    expect(ada.card.party.map((c) => c.species).sort()).toEqual(["chonklet", "susquatch"]);
    expect(bo.card.party.map((c) => c.species)).toEqual(["dogeling"]);
    expect(ada.card.caught).toContain("susquatch");
    expect(ada.card.link?.trades).toBe(1);
    expect(bo.card.link?.trades).toBe(1);
    // The critter keeps who caught it.
    expect(bo.card.party[0].ot).toBe("someone");
  });

  it("takes no yes to an offer that has since changed", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["dogeling", 12], ["chonklet", 10]);
    bo.card.party = team(2, ["froggo", 15]);
    ada.link.ask("B", "trade"); flush(); bo.link.accept(); flush();
    ada.link.offer(ada.card.party[0].uid);
    bo.link.offer(bo.card.party[0].uid);
    flush();
    bo.link.agree();
    // Ada swaps her offer before Bo's yes reaches her: his yes was to the dogeling, not the chonklet.
    ada.link.offer(ada.card.party[1].uid);
    flush();
    ada.link.agree();
    flush();
    expect(ada.card.party.map((c) => c.species)).toEqual(["dogeling", "chonklet"]);
    expect(bo.card.party.map((c) => c.species)).toEqual(["froggo"]);
    // Bo sees the new offer and says yes to it: now it goes through.
    bo.link.agree();
    flush();
    expect(ada.card.party.map((c) => c.species).sort()).toEqual(["dogeling", "froggo"]);
    expect(bo.card.party.map((c) => c.species)).toEqual(["chonklet"]);
  });

  it("tells the other player when a trade is called off, and closes theirs", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["dogeling", 12]);
    bo.card.party = team(2, ["froggo", 15]);
    ada.link.ask("B", "trade"); flush(); bo.link.accept(); flush();
    bo.link.endTrade();
    flush();
    expect(ada.link.trade).toBeNull();
    expect(ada.said.some((t) => t.includes("called off"))).toBe(true);
  });

  it("answers an ask from someone busy with a no, and says so", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["dogeling", 12]);
    bo.card.party = team(2, ["froggo", 15]);
    bo.session.battle = { b: newBattle("wild", "Bo", bo.card.party, "", team(3, ["nibbit", 3])) } as BattleSession;
    ada.link.ask("B", "battle");
    flush();
    expect(ada.link.asking).toBeNull();
    expect(ada.said.at(-1)).toContain("busy");
  });
});

describe("a link battle between two players", () => {
  it("runs on the challenger's machine, waits for both choices, and shows the other the same turn", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["emberkit", 20]);
    bo.card.party = team(2, ["axolittle", 20]);
    ada.card.party[0].hp = 1;
    ada.link.ask("B", "battle"); flush();
    bo.link.accept(); flush();
    const sa = ada.session.battle!, sb = bo.session.battle!;
    expect(sa.link?.sim).toBe(true);
    expect(sb.link?.sim).toBe(false);
    // Hurt going in, healed for the battle — and still hurt after it.
    expect(activeOf(sa.b, "player").hp).toBe(maxHp(activeOf(sa.b, "player")));
    expect(ada.card.party[0].hp).toBe(1);
    // Ada chooses first: nothing happens until Bo does.
    expect(ada.link.act({ kind: "move", index: 0 })).toEqual([]);
    expect(sa.b.turn).toBe(0);
    expect(bo.link.act({ kind: "move", index: 0 })).toEqual([]);
    flush();
    expect(sa.b.turn).toBe(1);
    const seenA = ada.link.takeIncoming(), seenB = bo.link.takeIncoming();
    expect(seenA.length).toBeGreaterThan(0);
    expect(seenB.map((e) => e.text)).toEqual(seenA.map((e) => e.text));
    expect(activeOf(sb.b, "foe").hp).toBe(activeOf(sa.b, "player").hp);
    expect(sb.b.turn).toBe(1);
  });

  it("refuses items and dead switches before they cost the other player a wait", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["emberkit", 20], ["dogeling", 20]);
    bo.card.party = team(2, ["axolittle", 20]);
    ada.link.ask("B", "battle"); flush(); bo.link.accept(); flush();
    const s = ada.session.battle!;
    expect(ada.link.act({ kind: "item", item: "herbal_tonic" })[0].text).toContain("No items");
    s.b.player.team[1].hp = 0;
    expect(ada.link.act({ kind: "switch", to: 1 })[0].text).toContain("fainted");
    expect(s.link!.mine).toBeNull();
  });

  it("ends the battle with nobody winning when the other player leaves", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["emberkit", 20]);
    bo.card.party = team(2, ["axolittle", 20]);
    ada.link.ask("B", "battle"); flush(); bo.link.accept(); flush();
    bo.link.left();
    flush();
    expect(ada.session.battle!.b.over).toBe("ran");
    expect(ada.link.takeIncoming().at(-1)!.text).toBe("Bo left the link battle.");
  });

  it("lets the other player forfeit while the challenger is still choosing", () => {
    const { ada, bo, flush } = twoPlayers();
    ada.card.party = team(1, ["emberkit", 20]);
    bo.card.party = team(2, ["axolittle", 20]);
    ada.link.ask("B", "battle"); flush(); bo.link.accept(); flush();
    bo.link.act({ kind: "run" });
    flush();
    expect(ada.session.battle!.b.over).toBe("win");
    expect(bo.session.battle!.b.over).toBe("lose");
  });
});

describe("a trainer's link record", () => {
  it("survives a save, clamped", () => {
    const c = sanitizeCard({ link: { wins: 3, losses: -2, trades: 1e12 } });
    expect(c.link).toEqual({ wins: 3, losses: 0, trades: 999_999 });
    expect(sanitizeCard({}).link).toBeUndefined();
  });
});
