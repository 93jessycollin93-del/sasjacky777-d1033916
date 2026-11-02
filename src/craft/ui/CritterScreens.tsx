/**
 * The critter modes' screens: the battle, the party and field guide, the
 * starter (or the Battle Spire's rentals), and a healing station's counter
 * (game/critterPlay.ts runs them; engine/battle.ts is the fight).
 *
 * The battle screen plays a turn's events one at a time — a line of text
 * each, health bars sliding, sparks in the world where a move lands — then
 * offers the next choice. A click hurries it along. The world stays in view
 * above: this is a battle in the world, not a cut to somewhere else.
 *
 * A link battle against another player plays the same way, except that a
 * turn waits for both players' choices: the screen says whom it is waiting
 * for, and plays the turn the moment it comes back.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/game";
import {
  displayName, maxHp, MEDICINE, MOVES, ORBS, SHOP, SPECIES, SPECIES_IDS, STARTERS, STATUS_TAGS, TYPE_COLORS, TYPE_NAMES, xpForLevel,
  type Critter, type CritterType,
} from "../engine/critters";
import { activeOf, type Action, type BattleEvent } from "../engine/battle";
import { BADGES, towerRentals } from "../engine/trainers";
import { itemByName } from "../engine/items";
import { Button, ItemIcon } from "./common";
import { MenuFrame } from "./Menus";

const u = (n: number) => `calc(var(--u) * ${n})`;

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type as CritterType] ?? "#888";
  return (
    <span style={{ background: c, color: "#111", padding: `0 ${u(2)}`, fontSize: u(5), border: `${u(0.5)} solid rgba(0,0,0,0.4)`, marginRight: u(1.5), display: "inline-block" }}>
      {TYPE_NAMES[type as CritterType] ?? type}
    </span>
  );
}

function Bar({ value, max, color, height = 2.5 }: { value: number; max: number; color?: string; height?: number }) {
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const c = color ?? (f > 0.5 ? "#4ad04a" : f > 0.2 ? "#e8c030" : "#e84a3a");
  return (
    <div style={{ background: "rgba(0,0,0,0.6)", height: u(height), border: `${u(0.5)} solid #222`, width: "100%" }}>
      <div style={{ width: `${f * 100}%`, height: "100%", background: c, transition: "width 0.45s ease-out" }} />
    </div>
  );
}

/** A critter's line in a list: name, level, types, health. */
function CritterRow({ c, children, onClick, active, testid }: { c: Critter; children?: ReactNode; onClick?: () => void; active?: boolean; testid?: string }) {
  const s = SPECIES[c.species];
  const max = maxHp(c);
  return (
    <div data-testid={testid} onClick={onClick}
      style={{ display: "flex", gap: u(3), alignItems: "center", padding: u(2.5), background: active ? "rgba(60,90,140,0.7)" : c.hp <= 0 ? "rgba(70,20,20,0.6)" : "rgba(0,0,0,0.55)", border: `${u(0.75)} solid ${active ? "#8ab0ff" : "#333"}`, cursor: onClick ? "pointer" : undefined }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: u(6.5), color: c.shiny ? "#ffe070" : "#fff" }}>
          {c.shiny ? "✦ " : ""}{displayName(c)} <span className="bc-sub">Lv {c.level}{c.nick ? ` · ${s?.name}` : ""}</span>
          {c.status && <span style={{ marginLeft: u(2), color: "#ffb070", fontSize: u(5) }}>{STATUS_TAGS[c.status]}</span>}
        </div>
        <div style={{ margin: `${u(1)} 0` }}>{s?.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
        <Bar value={c.hp} max={max} />
        <div className="bc-sub" style={{ fontSize: u(5) }}>{c.hp}/{max} health</div>
      </div>
      {children}
    </div>
  );
}

// ---- the battle ------------------------------------------------------------------------------------------------

interface Shown { name: string; level: number; hp: number; max: number; status: string | null; shiny?: boolean; types: string[] }

const shownOf = (c: Critter): Shown => ({ name: displayName(c), level: c.level, hp: c.hp, max: maxHp(c), status: c.status, shiny: c.shiny, types: SPECIES[c.species]?.types ?? [] });

type Phase = "playing" | "menu" | "fight" | "bag" | "party" | "medicine" | "switch" | "learn" | "end" | "waiting";

export function BattleScreen({ game }: { game: Game }) {
  const cp = game.critters;
  const session = cp.battle;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const queue = useRef<BattleEvent[]>(session ? [...session.opening] : []);
  const [message, setMessage] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("playing");
  const [medicine, setMedicine] = useState<string | null>(null);
  const [learnNote, setLearnNote] = useState<string | null>(null);
  const b = session?.b;
  const [mine, setMine] = useState<Shown | null>(() => (b && b.kind !== "safari" && activeOf(b, "player") ? shownOf(activeOf(b, "player")) : null));
  const [foe, setFoe] = useState<Shown | null>(() => (b ? shownOf(activeOf(b, "foe")) : null));
  const timer = useRef<number | null>(null);
  /** Whether events are being played out now: another player's turn arriving mid-play joins the queue, not a second chain. */
  const playing = useRef(true);

  const settle = () => {
    if (!b) return;
    playing.current = false;
    if (b.kind !== "safari" && activeOf(b, "player")) setMine(shownOf(activeOf(b, "player")));
    setFoe(shownOf(activeOf(b, "foe")));
    if (b.over) setPhase(b.offers.length ? "learn" : "end");
    else if (b.mustSwitch) setPhase("switch");
    else setPhase("menu");
  };

  const step = () => {
    if (!b) return;
    const e = queue.current.shift();
    if (!e) { settle(); return; }
    cp.fx(e);
    if (e.side && typeof e.hp === "number" && typeof e.max === "number") {
      const upd = (s: Shown | null) => (s ? { ...s, hp: e.hp!, max: e.max! } : s);
      if (e.side === "player") setMine(e.t === "switch" ? shownOf(activeOf(b, "player")) : upd);
      else setFoe(e.t === "switch" ? shownOf(activeOf(b, "foe")) : upd);
    }
    if (e.t === "level" && e.side === "player") setMine(shownOf(activeOf(b, "player")));
    if (e.t === "status") { if (e.side === "player") setMine(shownOf(activeOf(b, "player"))); else setFoe(shownOf(activeOf(b, "foe"))); }
    if (e.text) setMessage(e.text);
    // A line with nothing to read goes by at once; the rest stay long enough to read.
    const wait = e.text ? (e.t === "shake" ? 650 : 1050) : 0;
    timer.current = window.setTimeout(step, wait);
  };

  useEffect(() => {
    timer.current = window.setTimeout(step, 250);
    // A link battle: the other player's turn (or their leaving) arrives when it arrives, and is played as it does.
    const poll = session?.link ? window.setInterval(() => {
      const ev = cp.link.takeIncoming();
      if (!ev.length) return;
      queue.current.push(...ev);
      if (!playing.current) { playing.current = true; setPhase("playing"); step(); }
    }, 150) : null;
    return () => { if (timer.current) window.clearTimeout(timer.current); if (poll) window.clearInterval(poll); };
    // Once, on opening: the battle's own opening lines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session || !b) return null;

  const hurry = () => {
    if (phase !== "playing") return;
    if (timer.current) window.clearTimeout(timer.current);
    step();
  };

  const act = (a: Action) => {
    const events = cp.act(a);
    if (!events.length) {
      if (session.link?.mine) { setPhase("waiting"); setMessage(`Waiting for ${session.link.peerName}…`); }
      return;
    }
    queue.current.push(...events);
    playing.current = true;
    setPhase("playing");
    setMedicine(null);
    step();
    refresh();
  };
  const link = b.kind === "link";

  const player = b.kind !== "safari" ? activeOf(b, "player") : null;
  const inBag = (item: string) => cp.count(item);
  const bagItems = [...Object.keys(ORBS), ...Object.keys(MEDICINE)].filter((i) => inBag(i) > 0 && (b.kind === "safari" ? i === "park_orb" : b.kind === "trainer" ? !ORBS[i] : i !== "park_orb"));
  const offer = b.offers[0];
  const offerCritter = offer ? b.player.team.find((c) => c.uid === offer.uid) : undefined;

  const card = (s: Shown | null, side: "player" | "foe") => s && (
    <div data-testid={`battle-${side}`} style={{ background: "rgba(10,10,20,0.78)", border: `${u(0.75)} solid #556`, padding: u(3), width: `min(46%, ${u(110)})` }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: u(6.5), color: s.shiny ? "#ffe070" : "#fff" }}>
        <span>{s.shiny ? "✦ " : ""}{s.name}{s.status && <span style={{ marginLeft: u(2), color: "#ffb070", fontSize: u(5) }}>{STATUS_TAGS[s.status as keyof typeof STATUS_TAGS]}</span>}</span>
        <span className="bc-sub">Lv {s.level}</span>
      </div>
      <div style={{ margin: `${u(1)} 0` }}>{s.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
      <Bar value={s.hp} max={s.max} />
      {side === "player" && <div className="bc-sub" style={{ fontSize: u(5) }}>{Math.max(0, s.hp)}/{s.max}</div>}
      {side === "player" && player && !link && (
        <div style={{ marginTop: u(1) }}>
          <Bar value={player.xp - xpForLevel(player.level)} max={xpForLevel(player.level + 1) - xpForLevel(player.level)} color="#4ab0f0" height={1.2} />
        </div>
      )}
    </div>
  );

  const partyList = (onPick: (i: number) => void, testPrefix: string, filter?: (c: Critter, i: number) => boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 90), 1fr))", gap: u(2) }}>
      {b.player.team.map((c, i) => (filter && !filter(c, i) ? null : (
        <CritterRow key={c.uid} c={c} active={i === b.player.active} testid={`${testPrefix}-${i}`} onClick={() => onPick(i)} />
      )))}
    </div>
  );

  let menu: ReactNode = null;
  switch (phase) {
    case "menu":
      menu = b.kind === "safari" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(3) }} data-testid="battle-menu">
          <Button onClick={() => act({ kind: "item", item: "park_orb" })}>Throw orb ({inBag("park_orb")})</Button>
          <Button onClick={() => act({ kind: "bait" })}>Throw bait</Button>
          <Button onClick={() => act({ kind: "mud" })}>Throw mud</Button>
          <Button onClick={() => act({ kind: "run" })}>Leave it</Button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(3) }} data-testid="battle-menu">
          <Button onClick={() => setPhase("fight")}>Fight</Button>
          <Button onClick={() => setPhase("bag")} disabled={link}>Bag</Button>
          <Button onClick={() => setPhase("party")}>Critters</Button>
          <Button onClick={() => act({ kind: "run" })} disabled={b.kind === "trainer"}><span data-testid="battle-run">{link ? "Forfeit" : "Run"}</span></Button>
        </div>
      );
      break;
    case "fight":
      menu = (
        <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(3) }}>
            {player?.moves.map((m, i) => {
              const d = MOVES[m.id];
              return (
                <button key={m.id} type="button" data-testid={`move-${i}`} className="bc-btn" disabled={m.pp <= 0 && player.moves.some((k) => k.pp > 0)}
                  onClick={() => act({ kind: "move", index: i })}
                  style={{ borderLeft: `${u(2)} solid ${TYPE_COLORS[d.type]}`, textAlign: "left" }}>
                  <div>{d.name}</div>
                  <div className="bc-sub" style={{ fontSize: u(4.5) }}>{TYPE_NAMES[d.type]} · {d.category === "status" ? "status" : `power ${d.power}`} · {m.pp}/{d.pp}</div>
                </button>
              );
            })}
          </div>
          <Button onClick={() => setPhase("menu")}>Back</Button>
        </div>
      );
      break;
    case "bag":
      menu = (
        <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
          {!bagItems.length && <div className="bc-sub">Nothing in your bag that would help here.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 70), 1fr))", gap: u(2) }}>
            {bagItems.map((i) => (
              <button key={i} type="button" className="bc-btn" data-testid={`bag-${i}`}
                onClick={() => (ORBS[i] ? act({ kind: "item", item: i }) : (setMedicine(i), setPhase("medicine")))}
                style={{ display: "flex", alignItems: "center", gap: u(2) }}>
                <ItemIcon id={itemByName(i).id} /> {cp.nameOf(i)} ×{inBag(i)}
              </button>
            ))}
          </div>
          <Button onClick={() => setPhase("menu")}>Back</Button>
        </div>
      );
      break;
    case "medicine":
      menu = (
        <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
          <div className="bc-sub">Give the {medicine ? cp.nameOf(medicine) : ""} to…</div>
          {partyList((i) => medicine && act({ kind: "item", item: medicine, target: i }), "give")}
          <Button onClick={() => setPhase("bag")}>Back</Button>
        </div>
      );
      break;
    case "party": case "switch":
      menu = (
        <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
          <div className="bc-sub">{phase === "switch" ? "Choose the next critter to send out." : "Switch to…"}</div>
          {partyList((i) => act({ kind: "switch", to: i }), "switch")}
          {phase === "party" && <Button onClick={() => setPhase("menu")}>Back</Button>}
        </div>
      );
      break;
    case "learn":
      menu = offer && offerCritter ? (
        <div style={{ display: "flex", flexDirection: "column", gap: u(3) }} data-testid="battle-learn">
          <div>{displayName(offerCritter)} wants to learn {MOVES[offer.move].name}, but already knows four moves. Forget one?</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(3) }}>
            {offerCritter.moves.map((m, i) => (
              <Button key={m.id} onClick={() => { setLearnNote(cp.learn(offer.uid, offer.move, i)); if (!b.offers.length) setPhase("end"); refresh(); }}>Forget {MOVES[m.id].name}</Button>
            ))}
          </div>
          <Button onClick={() => { setLearnNote(cp.learn(offer.uid, offer.move, -1)); if (!b.offers.length) setPhase("end"); refresh(); }}>Don't learn {MOVES[offer.move].name}</Button>
        </div>
      ) : null;
      break;
    case "waiting":
      menu = (
        <div style={{ display: "flex", justifyContent: "flex-end" }} data-testid="battle-waiting">
          <Button onClick={() => act({ kind: "run" })}>Forfeit</Button>
        </div>
      );
      break;
    case "end":
      menu = (
        <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
          {learnNote && <div className="bc-sub">{learnNote}</div>}
          <Button wide onClick={() => cp.finish()}>
            <span data-testid="battle-continue">Continue</span>
          </Button>
        </div>
      );
      break;
  }

  return (
    <div className="absolute inset-0 pointer-events-auto bc-shadow" data-testid="battle-screen" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: u(5) }}
      onClick={hurry}>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>{card(foe, "foe")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: u(3) }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>{b.kind === "safari" ? (
          <div style={{ background: "rgba(10,10,20,0.78)", padding: u(3), border: `${u(0.75)} solid #556` }}>Park Orbs left: {inBag("park_orb")}</div>
        ) : card(mine, "player")}</div>
        <div style={{ background: "rgba(8,8,16,0.86)", border: `${u(0.75)} solid #667`, padding: u(4), display: "flex", flexDirection: "column", gap: u(3) }}
          onClick={(e) => { if (phase !== "playing") e.stopPropagation(); }}>
          <div data-testid="battle-message" style={{ fontSize: u(7), minHeight: u(9), lineHeight: 1.35 }}>{message || "…"}</div>
          {menu}
        </div>
      </div>
    </div>
  );
}

// ---- the party and the field guide -------------------------------------------------------------------------------

export function PartyScreen({ game, give, tab: startTab }: { game: Game; give?: string; tab?: "party" | "dex" }) {
  const cp = game.critters, card = game.player.card;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [tab, setTab] = useState<"party" | "dex" | "link">(startTab ?? "party");
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const spire = cp.rules.spire;
  return (
    <MenuFrame title={give ? `Give ${cp.nameOf(give)}` : tab === "party" ? "Your Critters" : tab === "dex" ? "Field Guide" : "Link"} width={300}>
      <div className="bc-sub" style={{ textAlign: "center" }} data-testid="party-summary">
        {card.coins} coins · {card.badges.length}/{BADGES.length} badges · caught {card.caught.length} of {SPECIES_IDS.length}
        {spire ? ` · Spire streak ${card.spire?.streak ?? 0} (best ${card.spireBest ?? 0})` : ""}
      </div>
      {!give && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: u(3) }}>
          <Button disabled={tab === "party"} onClick={() => setTab("party")}>Party</Button>
          <Button disabled={tab === "dex"} onClick={() => setTab("dex")}>Field Guide</Button>
          <Button disabled={tab === "link"} onClick={() => setTab("link")}><span data-testid="party-link-tab">Link</span></Button>
        </div>
      )}
      {note && <div className="bc-sub" style={{ color: "#ffff99", textAlign: "center" }}>{note}</div>}
      {tab === "party" && (
        <div style={{ display: "flex", flexDirection: "column", gap: u(2) }} data-testid="party-list">
          {!card.party.length && <div className="bc-sub" style={{ textAlign: "center" }}>No critters yet.</div>}
          {card.party.map((c, i) => (
            <div key={c.uid}>
              <CritterRow c={c} testid={`party-${i}`} onClick={() => (give ? (setNote(cp.giveItem(c.uid, give)), refresh()) : setOpen(open === c.uid ? null : c.uid))}>
                {!give && (
                  <div style={{ display: "flex", flexDirection: "column", gap: u(1.5) }}>
                    <Button onClick={() => { cp.setWalking(card.walking === c.uid ? null : c.uid); refresh(); }} disabled={c.hp <= 0 || spire}>
                      {card.walking === c.uid ? "Recall" : SPECIES[c.species].ride ? "Walk / ride" : "Walk with me"}
                    </Button>
                    <Button onClick={() => { cp.moveUp(c.uid); refresh(); }} disabled={i === 0}>Lead ↑</Button>
                  </div>
                )}
              </CritterRow>
              {open === c.uid && !give && (
                <div style={{ padding: u(3), background: "rgba(0,0,0,0.45)", fontSize: u(5.5), lineHeight: 1.5 }}>
                  <div>{SPECIES[c.species].note}</div>
                  <div className="bc-sub">Caught by {c.ot ?? "?"}, {c.met ?? "somewhere"}. Next level in {xpForLevel(c.level + 1) - c.xp} experience.</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(1.5), marginTop: u(2) }}>
                    {c.moves.map((m) => (
                      <div key={m.id} style={{ borderLeft: `${u(1.5)} solid ${TYPE_COLORS[MOVES[m.id].type]}`, paddingLeft: u(2) }}>
                        {MOVES[m.id].name} <span className="bc-sub">{m.pp}/{MOVES[m.id].pp}</span>
                      </div>
                    ))}
                  </div>
                  {SPECIES[c.species].evolves && (
                    <div className="bc-sub">
                      Evolves into {SPECIES[SPECIES[c.species].evolves!.to].name} {SPECIES[c.species].evolves!.trade ? "when it is traded" : `at level ${SPECIES[c.species].evolves!.level}`}.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "dex" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 60), 1fr))", gap: u(2) }} data-testid="dex-list">
          {SPECIES_IDS.map((id, i) => {
            const s = SPECIES[id];
            const caught = card.caught.includes(id), seen = caught || card.seen.includes(id);
            return (
              <div key={id} title={caught ? s.note : undefined} style={{ padding: u(2), background: caught ? "rgba(40,70,40,0.6)" : "rgba(0,0,0,0.5)", border: `${u(0.5)} solid ${caught ? "#5a5" : "#333"}` }}>
                <div style={{ fontSize: u(5.5) }}>#{String(i + 1).padStart(3, "0")} {seen ? s.name : "???"}</div>
                <div>{seen ? s.types.map((t) => <TypeBadge key={t} type={t} />) : <span className="bc-sub">Not yet met</span>}</div>
              </div>
            );
          })}
        </div>
      )}
      {tab === "link" && <LinkList game={game} onNote={setNote} />}
      {spire && card.party.length > 0 && !give && (
        <Button wide onClick={() => { game.setScreen(null); cp.startSpire(); }}>Face the next challenger</Button>
      )}
      <Button wide onClick={() => game.setScreen(null)}>Done</Button>
    </MenuFrame>
  );
}

/** The other players in the world, each with a challenge and a trade to offer them, and this trainer's record. */
function LinkList({ game, onNote }: { game: Game; onNote: (t: string) => void }) {
  const link = game.critters.link, rec = game.player.card.link;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { const id = window.setInterval(refresh, 1000); return () => window.clearInterval(id); }, []);
  const players = link.players();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: u(2) }} data-testid="link-list">
      <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }}>
        Link battles use copies of both teams at full health: nothing that happens in one lasts. A trade is for keeps —
        and some critters only evolve when they change hands.
      </div>
      <div className="bc-sub" style={{ textAlign: "center" }}>Record: {rec?.wins ?? 0} won · {rec?.losses ?? 0} lost · {rec?.trades ?? 0} traded</div>
      {!players.length && <div className="bc-sub" style={{ textAlign: "center" }}>Nobody else is in this world. Open it to friends to battle and trade.</div>}
      {link.invite && (
        <div style={{ display: "flex", gap: u(2), alignItems: "center", padding: u(2), background: "rgba(40,60,100,0.6)" }}>
          <div style={{ flex: 1 }}>{link.invite.name} wants to {link.invite.what === "battle" ? "battle" : "trade"}!</div>
          <Button onClick={() => { onNote(link.accept()); refresh(); }}>Accept</Button>
          <Button onClick={() => { onNote(link.decline()); refresh(); }}>Decline</Button>
        </div>
      )}
      {players.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: u(2), alignItems: "center", padding: u(2), background: "rgba(0,0,0,0.5)" }}>
          <div style={{ flex: 1 }}>{r.name} <span className="bc-sub">{Math.round(r.dist)} blocks away</span></div>
          <Button disabled={!!link.asking} onClick={() => { onNote(link.ask(r.id, "battle")); refresh(); }}><span data-testid={`link-battle-${r.name}`}>Battle</span></Button>
          <Button disabled={!!link.asking} onClick={() => { onNote(link.ask(r.id, "trade")); refresh(); }}><span data-testid={`link-trade-${r.name}`}>Trade</span></Button>
        </div>
      ))}
    </div>
  );
}

// ---- another player's ask, and a trade ------------------------------------------------------------------------------

export function LinkScreen({ game }: { game: Game }) {
  const link = game.critters.link, inv = link.invite;
  const answer = (yes: boolean) => {
    const text = yes ? link.accept() : link.decline();
    if (game.screen?.kind === "link") game.setScreen(null);
    game.message(text, "#aaddff");
  };
  return (
    <MenuFrame title={inv ? (inv.what === "battle" ? "A challenge!" : "A trade offer") : "Link"} width={240}>
      {inv ? (
        <>
          <div style={{ textAlign: "center", fontSize: u(7) }} data-testid="link-invite">
            {inv.name} wants to {inv.what === "battle" ? "have a link battle" : "trade critters"} with you.
          </div>
          <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }}>
            {inv.what === "battle"
              ? "Both teams fight as copies at full health: win or lose, your critters come home as they left."
              : "You each put one critter on the table, and trade only when you both say yes to the same pair."}
          </div>
          <Button wide onClick={() => answer(true)}><span data-testid="link-accept">Accept</span></Button>
          <Button wide onClick={() => answer(false)}>Decline</Button>
        </>
      ) : (
        <>
          <div className="bc-sub" style={{ textAlign: "center" }}>Nobody is asking you anything right now.</div>
          <Button wide onClick={() => game.setScreen(null)}>Done</Button>
        </>
      )}
    </MenuFrame>
  );
}

export function CritterTradeScreen({ game }: { game: Game }) {
  const link = game.critters.link, card = game.player.card;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [note, setNote] = useState<string | null>(null);
  // The other player's offer and their yes arrive over the network: look again a few times a second.
  useEffect(() => { const id = window.setInterval(refresh, 250); return () => window.clearInterval(id); }, []);
  const t = link.trade;
  if (!t) return null;
  const theirs = t.theirs;
  const evolvesOnArrival = theirs ? SPECIES[theirs.species].evolves?.trade : false;
  return (
    <MenuFrame title={`Trade with ${t.peerName}`} width={320}>
      <div className="bc-sub" style={{ textAlign: "center", color: "#ffff99" }} data-testid="trade-note">{t.done ? t.note : note ?? t.note}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(3) }}>
        <div style={{ display: "flex", flexDirection: "column", gap: u(2) }}>
          <div className="bc-sub">Your offer — tap one of your party</div>
          {card.party.map((c, i) => (
            <CritterRow key={c.uid} c={c} testid={`trade-mine-${i}`} active={t.mine === c.uid}
              onClick={t.done ? undefined : () => { setNote(null); link.offer(t.mine === c.uid ? null : c.uid); refresh(); }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: u(2) }}>
          <div className="bc-sub">{t.peerName}'s offer</div>
          {theirs ? (
            <>
              <CritterRow c={theirs} testid="trade-theirs" />
              <div style={{ padding: u(2), background: "rgba(0,0,0,0.45)", fontSize: u(5), lineHeight: 1.5 }}>
                <div>{SPECIES[theirs.species].note}</div>
                <div className="bc-sub">Caught by {theirs.ot ?? "?"}. Knows {theirs.moves.map((m) => MOVES[m.id].name).join(", ")}.</div>
                {evolvesOnArrival && !t.done && <div style={{ color: "#aaffaa" }}>It will evolve when it arrives!</div>}
              </div>
              {t.okTheirs && !t.done && <div style={{ color: "#aaffaa" }}>✓ {t.peerName} said yes</div>}
            </>
          ) : <div className="bc-sub">Nothing on the table yet.</div>}
        </div>
      </div>
      {t.done ? (
        <Button wide onClick={() => link.endTrade()}><span data-testid="trade-done">Done</span></Button>
      ) : (
        <>
          <Button wide disabled={!t.mine || !theirs || t.okMine} onClick={() => { const n = link.agree(); if (n) setNote(n); refresh(); }}>
            <span data-testid="trade-agree">{t.okMine ? `Waiting for ${t.peerName}…` : "Trade!"}</span>
          </Button>
          <Button wide onClick={() => link.endTrade("You called off the trade.")}>Cancel</Button>
        </>
      )}
    </MenuFrame>
  );
}

// ---- the starter, or the Spire's rentals ----------------------------------------------------------------------------

export function StarterScreen({ game, rentals }: { game: Game; rentals?: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [seed] = useState(() => (Math.random() * 0x7fffffff) | 0);
  const options = rentals ? towerRentals(seed) : STARTERS;
  const need = rentals ? 3 : 1;
  const toggle = (s: string) => setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : p.length < need ? [...p, s] : p));
  return (
    <MenuFrame title={rentals ? "Choose three rentals" : "Choose your first critter"} width={300}>
      <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }}>
        {rentals
          ? "The Spire lends you critters at level 50. Pick three — and win as many battles in a row as you can."
          : "Professor Wren has three critters looking for a trainer. Pick one: it will be with you from the first battle to the last."}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(calc(var(--u) * ${rentals ? 80 : 88}), 1fr))`, gap: u(3) }}>
        {options.map((s) => {
          const d = SPECIES[s];
          const on = picked.includes(s);
          return (
            <div key={s} data-testid={`starter-${s}`} onClick={() => toggle(s)}
              style={{ padding: u(3), cursor: "pointer", background: on ? "rgba(60,90,140,0.75)" : "rgba(0,0,0,0.55)", border: `${u(0.75)} solid ${on ? "#8ab0ff" : "#444"}` }}>
              <div style={{ fontSize: u(7) }}>{d.name}</div>
              <div style={{ margin: `${u(1.5)} 0` }}>{d.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
              <div className="bc-sub" style={{ fontSize: u(5), lineHeight: 1.4 }}>{d.note}</div>
            </div>
          );
        })}
      </div>
      <Button wide disabled={picked.length !== need} onClick={() => game.critters.chooseStarter(picked)}>
        <span data-testid="starter-confirm">{picked.length === need ? (rentals ? "Take these three" : `Choose ${SPECIES[picked[0]].name}`) : rentals ? `Pick ${need - picked.length} more` : "Pick one"}</span>
      </Button>
    </MenuFrame>
  );
}

// ---- a healing station ------------------------------------------------------------------------------------------------

export function CenterScreen({ game, x, y, z }: { game: Game; x: number; y: number; z: number }) {
  const cp = game.critters, card = game.player.card;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [tab, setTab] = useState<"heal" | "shop" | "box">("heal");
  const [note, setNote] = useState<string | null>(null);
  const say = (t: string) => { setNote(t); refresh(); };
  return (
    <MenuFrame title="Healing Station" width={300}>
      <div className="bc-sub" style={{ textAlign: "center" }}>{card.coins} coins</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: u(3) }}>
        <Button disabled={tab === "heal"} onClick={() => setTab("heal")}>Heal</Button>
        <Button disabled={tab === "shop"} onClick={() => setTab("shop")}>Shop</Button>
        <Button disabled={tab === "box"} onClick={() => setTab("box")}>Box</Button>
      </div>
      {note && <div className="bc-sub" style={{ color: "#ffff99", textAlign: "center" }}>{note}</div>}
      {tab === "heal" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: u(2) }}>{card.party.map((c) => <CritterRow key={c.uid} c={c} />)}</div>
          <Button wide onClick={() => { cp.heal(x, y, z); say("Your critters are fighting fit! This station will remember you."); }}>
            <span data-testid="center-heal">Heal my critters</span>
          </Button>
        </>
      )}
      {tab === "shop" && (
        <div style={{ display: "flex", flexDirection: "column", gap: u(2) }}>
          {SHOP.map(([item, price]) => (
            <div key={item} style={{ display: "flex", gap: u(3), alignItems: "center", padding: u(2), background: "rgba(0,0,0,0.5)" }}>
              <ItemIcon id={itemByName(item).id} />
              <div style={{ flex: 1 }}>{cp.nameOf(item)} <span className="bc-sub">{price} coins · you have {cp.count(item)}</span></div>
              <Button onClick={() => say(cp.buy(item, 1))} disabled={card.coins < price}><span data-testid={`buy-${item}`}>Buy 1</span></Button>
              <Button onClick={() => say(cp.buy(item, 5))} disabled={card.coins < price * 5}>Buy 5</Button>
            </div>
          ))}
        </div>
      )}
      {tab === "box" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(3) }}>
          <div style={{ display: "flex", flexDirection: "column", gap: u(2) }}>
            <div className="bc-sub">Party ({card.party.length}/6) — tap to store</div>
            {card.party.map((c) => <CritterRow key={c.uid} c={c} onClick={() => say(cp.deposit(c.uid))} />)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: u(2), maxHeight: u(160), overflowY: "auto" }}>
            <div className="bc-sub">Box ({card.box.length}) — tap to take</div>
            {card.box.map((c) => <CritterRow key={c.uid} c={c} onClick={() => say(cp.withdraw(c.uid))} />)}
          </div>
        </div>
      )}
      <Button wide onClick={() => game.setScreen(null)}>Done</Button>
    </MenuFrame>
  );
}

/** The party at a glance, in the corner: a name and a health bar each. */
export function PartyStrip({ party }: { party: { name: string; level: number; hp: number; max: number; status: string | null }[] }) {
  if (!party.length) return null;
  return (
    <div className="absolute pointer-events-none bc-shadow" data-testid="party-strip" style={{ left: u(4), top: "40%", display: "flex", flexDirection: "column", gap: u(1.5), width: u(60) }}>
      {party.map((c, i) => (
        <div key={i} style={{ background: "rgba(0,0,0,0.45)", padding: `${u(1)} ${u(2)}` }}>
          <div style={{ fontSize: u(4.5), display: "flex", justifyContent: "space-between" }}>
            <span>{c.name}</span><span className="bc-sub">Lv {c.level}{c.status ? ` ${STATUS_TAGS[c.status as keyof typeof STATUS_TAGS]}` : ""}</span>
          </div>
          <Bar value={c.hp} max={c.max} height={1.5} />
        </div>
      ))}
    </div>
  );
}
