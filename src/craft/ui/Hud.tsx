import { useEffect, useState } from "react";
import type { Hud as HudState } from "../game/types";
import { glyph, textureBackground } from "./icons";
import { ItemIcon, StackView } from "./common";
import { clock, effectName } from "./itemText";
import { itemId } from "../engine/items";
import { MINIMAP_ROOM, MINIMAP_SIZE } from "./MapView";

function Row({ full, max, icon, half, empty, reverse, shake, preview, glow }: {
  full: number; max: number; icon: string; half: string; empty: string; reverse?: boolean; shake?: boolean;
  /** What the bar would reach (AppleSkin): the difference blinks. */
  preview?: number;
  /** A golden rim on the first `glow` halves (saturation). */
  glow?: number;
}) {
  const cells = [];
  for (let i = 0; i < max / 2; i++) {
    const v = full - i * 2;
    const pv = preview !== undefined ? preview - i * 2 : -1;
    const ghost = v < 2 && pv > v;
    const shown = ghost ? pv : v;
    const src = shown >= 2 ? glyph(icon) : shown === 1 ? glyph(half) : glyph(empty);
    const jitter = shake ? (Math.random() * 2 - 1) : 0;
    const rim = glow !== undefined && glow - i * 2 >= 1;
    cells.push(
      <img
        key={i} src={src} className="bc-glyph" alt=""
        style={{
          marginRight: "calc(var(--u) * -0)", transform: `translateY(calc(var(--u) * ${jitter}))`,
          animation: ghost ? "bc-blink 1s ease-in-out infinite" : undefined,
          filter: rim ? "drop-shadow(0 0 calc(var(--u) * 0.6) #ffd84a)" : undefined,
        }}
      />,
    );
  }
  return <div style={{ display: "flex", flexDirection: reverse ? "row-reverse" : "row" }}>{cells}</div>;
}

export function Hud({ hud, mobile, crosshair }: { hud: HudState; mobile: boolean; crosshair: boolean }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const now = performance.now();
  const survival = hud.gameMode === "survival" || hud.gameMode === "adventure";
  const hurtFlash = now - hud.hurtAt < 350;
  const heldNameVisible = hud.heldName && now - hud.heldNameAt < 2200;

  if (hud.hudHidden) return null;
  // Room under the minimap (MapView.tsx), which takes the top right corner when it is on.
  const corner = hud.minimap ? MINIMAP_ROOM : 0;
  return (
    <div className="absolute inset-0 pointer-events-none bc-shadow">
      {hurtFlash && <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 120px 40px rgba(200,0,0,0.45)" }} />}
      {hud.onFire && survival && <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ background: "linear-gradient(transparent, rgba(255,110,0,0.35))" }} />}
      {hud.portal > 0 && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(circle, rgba(150,60,255,${hud.portal * 0.35}) 0%, rgba(90,20,200,${hud.portal * 0.75}) 100%)` }} />
      )}
      {hud.sleeping > 0 && <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${hud.sleeping * 0.8})` }} />}

      {crosshair && hud.gameMode !== "spectator" && !hud.screen && (
        <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%)", mixBlendMode: "difference" }}>
          <div style={{ position: "absolute", width: "calc(var(--u) * 9)", height: "calc(var(--u) * 1)", left: "calc(var(--u) * -4.5)", top: "calc(var(--u) * -0.5)", background: "#fff" }} />
          <div style={{ position: "absolute", width: "calc(var(--u) * 1)", height: "calc(var(--u) * 9)", left: "calc(var(--u) * -0.5)", top: "calc(var(--u) * -4.5)", background: "#fff" }} />
          {survival && hud.attackCharge < 1 && (
            <div style={{ position: "absolute", top: "calc(var(--u) * 7)", left: "calc(var(--u) * -8)", width: "calc(var(--u) * 16)", height: "calc(var(--u) * 2)", background: "#333" }}>
              <div style={{ width: `${hud.attackCharge * 100}%`, height: "100%", background: "#ddd" }} />
            </div>
          )}
        </div>
      )}

      {hud.inspect && !hud.screen && (
        // Primal: the creature under the crosshair — its level, torpor and how a tame is going.
        <div data-testid="inspect" className="absolute left-1/2" style={{ top: "calc(50% + var(--u) * 12)", transform: "translateX(-50%)", fontSize: "calc(var(--u) * 6)", background: "rgba(0,0,0,0.45)", padding: "calc(var(--u) * 1) calc(var(--u) * 3)", whiteSpace: "nowrap" }}>
          {hud.inspect}
        </div>
      )}

      {hud.boss && !hud.screen && (
        // The boss bar: the dragon's name over its health, purple as the original's.
        <div className="absolute left-1/2 flex flex-col items-center" style={{ top: "calc(var(--u) * 3)", transform: "translateX(-50%)" }}>
          <div style={{ fontSize: "calc(var(--u) * 6)", marginBottom: "calc(var(--u) * 1)" }}>{hud.boss.name}</div>
          <div style={{ width: "calc(var(--u) * 182)", height: "calc(var(--u) * 5)", background: "#3a1446", border: "calc(var(--u) * 1) solid #14051a" }}>
            <div data-testid="boss-health" style={{ width: `${hud.boss.health * 100}%`, height: "100%", background: "linear-gradient(#f07cff, #b02ad0)" }} />
          </div>
        </div>
      )}

      {/* The survivor picker is the whole screen: the day's title waits until someone has been chosen to read it. */}
      {hud.title && hud.screen?.kind !== "survivor" && (
        <div className="absolute left-0 right-0 text-center" style={{ top: "30%", animation: "bc-fadeout 4s forwards" }}>
          <div style={{ fontSize: "calc(var(--u) * 20)" }}>{hud.title.text}</div>
          {hud.title.sub && <div style={{ fontSize: "calc(var(--u) * 9)", color: "#ddd" }}>{hud.title.sub}</div>}
        </div>
      )}

      {hud.effects.length > 0 && !hud.screen && (
        <div className="absolute flex flex-col items-end" style={{ right: "calc(var(--u) * 3)", top: `calc(var(--u) * ${(mobile ? 26 : 3) + corner + (hud.net ? 18 : 0) + (hud.cash !== null && !hud.minimap ? 16 : 0)})`, gap: "calc(var(--u) * 1)" }}>
          {hud.effects.map((e) => (
            <div key={e.kind} style={{ background: "rgba(0,0,0,0.45)", padding: "calc(var(--u) * 1) calc(var(--u) * 3)", fontSize: "calc(var(--u) * 5.5)" }}>
              {effectName(e.kind, e.amp)} <span style={{ color: e.seconds <= 10 ? "#ff8080" : "#c0c0c0" }}>{clock(e.seconds)}</span>
            </div>
          ))}
        </div>
      )}

      {hud.cash !== null && !hud.screen && (
        // The city's money, where the city shows it: top right, green, eight
        // digits. Beside the minimap rather than under it, where the sidebar
        // scoreboard starts on a short screen.
        <div data-testid="hud-cash" className="absolute" style={{ right: `calc(var(--u) * ${hud.minimap ? MINIMAP_SIZE + 8 : 3})`, top: `calc(var(--u) * ${(mobile ? 22 : 3) + (hud.minimap ? 0 : hud.net ? 18 : 0)})`, fontFamily: "monospace", fontSize: "calc(var(--u) * 11)", color: "#7aff9a", WebkitTextStroke: "1px #0a2a12", letterSpacing: "calc(var(--u) * 0.5)" }}>
          ${String(Math.floor(hud.cash)).padStart(8, "0")}
        </div>
      )}

      {hud.wanted !== null && hud.wanted > 0 && !hud.screen && (
        // Wanted stars, under the money: lit for each star, hollow for the rest.
        <div data-testid="hud-wanted" className="absolute" style={{
          right: `calc(var(--u) * ${hud.minimap ? MINIMAP_SIZE + 8 : 3})`, top: `calc(var(--u) * ${(mobile ? 22 : 3) + (hud.minimap ? 0 : hud.net ? 18 : 0) + 14})`,
          fontSize: "calc(var(--u) * 10)", letterSpacing: "calc(var(--u) * 0.5)",
        }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} style={{ color: i < hud.wanted! ? "#ffd83a" : "rgba(255,255,255,0.25)", WebkitTextStroke: i < hud.wanted! ? "1px #5a3a00" : undefined }}>{i < hud.wanted! ? "★" : "☆"}</span>
          ))}
        </div>
      )}

      {hud.caption && !hud.screen && (
        // Dialogue across the bottom, over the hotbar: who is talking, in their colour, then what they say.
        <div data-testid="hud-caption" className="absolute" style={{
          left: "50%", transform: "translateX(-50%)", bottom: `calc(var(--u) * ${mobile ? 70 : 48})`, maxWidth: "min(90%, calc(var(--u) * 220))",
          textAlign: "center", fontSize: "calc(var(--u) * 6.5)", lineHeight: 1.35, background: "rgba(0,0,0,0.45)", padding: "calc(var(--u) * 1.5) calc(var(--u) * 4)",
        }}>
          <span style={{ color: hud.caption.color }}>{hud.caption.who}: </span>{hud.caption.text}
        </div>
      )}

      {hud.zone?.fresh && !hud.screen && (
        // The district, announced on the way in, the way the city games do: big, slanted, bottom right.
        <div data-testid="hud-zone" className="absolute" style={{
          right: "calc(var(--u) * 4)", ...(mobile ? { top: "calc(var(--u) * 40)" } : { bottom: `calc(var(--u) * ${hud.vehicle ? 44 : 14})` }),
          fontSize: "calc(var(--u) * 13)", fontStyle: "italic", fontWeight: 700, color: "#ffe25a", letterSpacing: "calc(var(--u) * 0.4)", whiteSpace: "nowrap",
          WebkitTextStroke: "1px #3a1a00", textShadow: "calc(var(--u) * 0.8) calc(var(--u) * 0.8) 0 #ff3aa8",
        }}>{hud.zone.name}</div>
      )}

      {hud.vehicle && !hud.screen && (
        // The speedometer: the car's name, its speed, and how much of it is left.
        <div data-testid="hud-vehicle" className="absolute" style={{
          right: "calc(var(--u) * 4)", ...(mobile ? { top: "calc(var(--u) * 58)" } : { bottom: "calc(var(--u) * 12)" }),
          minWidth: "calc(var(--u) * 64)", padding: "calc(var(--u) * 2) calc(var(--u) * 3)", background: "rgba(10,6,24,0.55)",
          borderLeft: "calc(var(--u) * 1) solid #ff3aa8", textAlign: "right",
        }}>
          <div style={{ fontSize: "calc(var(--u) * 5.5)", color: "#9ad8ff", letterSpacing: "calc(var(--u) * 0.6)", textTransform: "uppercase" }}>{hud.vehicle.name}</div>
          <div style={{ fontFamily: "monospace", fontSize: "calc(var(--u) * 16)", fontStyle: "italic", color: "#ffffff", lineHeight: 1 }}>
            {hud.vehicle.kmh}<span style={{ fontSize: "calc(var(--u) * 6)", color: "#c0c0d0" }}> km/h</span>
          </div>
          <div style={{ marginTop: "calc(var(--u) * 1.5)", height: "calc(var(--u) * 2)", background: "rgba(255,255,255,0.15)" }}>
            <div style={{ width: `${Math.round(hud.vehicle.health * 100)}%`, height: "100%", background: hud.vehicle.health < 0.25 ? "#ff3a2a" : hud.vehicle.health < 0.45 ? "#ffb02a" : "#5aff7a" }} />
          </div>
          {hud.zone?.street && <div style={{ fontSize: "calc(var(--u) * 5)", color: "#d0d0e0", marginTop: "calc(var(--u) * 1)" }}>{hud.zone.street}</div>}
          {hud.vehicle.police && <div style={{ fontSize: "calc(var(--u) * 4.5)", color: hud.vehicle.siren ? "#ff6a6a" : "#8a8a9a" }}>Siren {hud.vehicle.siren ? "on" : "off"}</div>}
        </div>
      )}

      {hud.objective && !hud.screen && (
        // The sidebar scoreboard, where servers have always put a minigame's state: right edge, middle.
        <div data-testid="objective" className="absolute" style={{ right: "calc(var(--u) * 2)", top: "50%", transform: "translateY(-50%)", minWidth: "calc(var(--u) * 70)", maxWidth: "calc(var(--u) * 110)", background: "rgba(0,0,0,0.45)", fontSize: "calc(var(--u) * 6)", lineHeight: 1.35 }}>
          <div style={{ textAlign: "center", color: "#ffff55", background: "rgba(0,0,0,0.25)", padding: "calc(var(--u) * 1) calc(var(--u) * 3)" }}>{hud.objective.title}</div>
          <div style={{ padding: "calc(var(--u) * 1) calc(var(--u) * 3)" }}>
            {hud.objective.lines.map(([k, v], i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "calc(var(--u) * 5)" }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
                <span style={{ color: "#ff5555", whiteSpace: "nowrap" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom cluster: status bars, XP, hotbar. */}
      <div className="absolute left-1/2 flex flex-col items-center" style={{ bottom: mobile ? "calc(var(--u) * 2)" : "calc(var(--u) * 1)", transform: "translateX(-50%)" }}>
        {hud.actionbar && <div style={{ fontSize: "calc(var(--u) * 7)", marginBottom: "calc(var(--u) * 4)" }}>{hud.actionbar.text}</div>}
        {survival && hud.vitals.length > 0 && (
          // Body temperature and anything wrong, in words: the vitals a mode keeps (engine/vitals.ts).
          <div data-testid="vitals" style={{ display: "flex", gap: "calc(var(--u) * 3)", marginBottom: "calc(var(--u) * 2)", fontSize: "calc(var(--u) * 5.5)" }}>
            {hud.vitals.map((v) => (
              <span key={v} style={{ background: "rgba(0,0,0,0.45)", padding: "0 calc(var(--u) * 2)", color: /Bleeding|Sick|Broken|Freezing|Overheating|Nauseous|Feverish|Failing|Parched/.test(v) ? "#ff7070" : /Queasy|thirsty|Thirsty/.test(v) ? "#ffd070" : /Cold/.test(v) ? "#8fd0ff" : /Hot/.test(v) ? "#ffc070" : "#e0e0e0" }}>{v}</span>
            ))}
          </div>
        )}
        {heldNameVisible && !hud.actionbar && <div style={{ fontSize: "calc(var(--u) * 7)", marginBottom: "calc(var(--u) * 4)" }}>{hud.heldName}</div>}
        {survival && (
          <div style={{ display: "flex", justifyContent: "space-between", width: "calc(var(--u) * 182)", alignItems: "flex-end" }}>
            <div>
              {hud.armor > 0 && <Row full={hud.armor} max={20} icon="armor" half="armorHalf" empty="heartEmpty" />}
              {hud.absorption > 0 && <Row full={hud.absorption} max={hud.absorption} icon="heartGold" half="heartGold" empty="heartGold" />}
              <Row full={Math.ceil(hud.health)} max={20} icon="heart" half="heartHalf" empty="heartEmpty" shake={hud.health <= 4} />
            </div>
            <div>
              {hud.underwater && hud.air < 300 && (
                <div style={{ display: "flex", flexDirection: "row-reverse" }}>
                  {Array.from({ length: Math.ceil(Math.max(0, hud.air) / 30) }, (_, i) => <img key={i} src={glyph("bubble")} className="bc-glyph" alt="" />)}
                </div>
              )}
              {hud.water !== null && (
                <div data-testid="water-bar"><Row full={Math.ceil(hud.water)} max={20} icon="water" half="waterHalf" empty="waterEmpty" reverse shake={hud.water <= 3} /></div>
              )}
              <Row
                full={hud.food} max={20} icon="food" half="foodHalf" empty="foodEmpty" reverse
                preview={hud.foodPreview?.food} glow={hud.foodPreview ? hud.foodPreview.saturation : hud.saturation ?? undefined}
              />
            </div>
          </div>
        )}
        {survival && (
          <div style={{ position: "relative", width: "calc(var(--u) * 182)", height: "calc(var(--u) * 5)", margin: "calc(var(--u) * 1) 0", background: "#1a1a1a", border: "calc(var(--u) * 0.5) solid #000" }}>
            <div style={{ width: `${hud.xpProgress * 100}%`, height: "100%", background: "linear-gradient(#b4ff5a, #6ab21c)" }} />
            {hud.xpLevel > 0 && (
              <div style={{ position: "absolute", left: "50%", top: "calc(var(--u) * -8)", transform: "translateX(-50%)", color: "#80ff20", fontSize: "calc(var(--u) * 8)", textShadow: "calc(var(--u)*0.6) calc(var(--u)*0.6) 0 #000" }}>{hud.xpLevel}</div>
            )}
          </div>
        )}
        {hud.gameMode !== "spectator" && (
          <div className="bc-hotbar">
            {hud.hotbar.map((s, i) => (
              <div key={i} className={`bc-hslot ${i === hud.selected ? "sel" : ""}`}>
                <StackView stack={s} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat. */}
      <div className="absolute left-0" style={{ bottom: mobile ? "calc(var(--u) * 70)" : "calc(var(--u) * 48)", maxWidth: "min(90vw, calc(var(--u) * 240))", padding: "0 calc(var(--u) * 2)" }}>
        {/* A battle has its own line of text: the chat keeps out of its way. */}
        {hud.screen?.kind !== "battle" && hud.screen?.kind !== "survivor" && hud.chat.filter((l) => hud.screen?.kind === "chat" || now - l.at < 10000).slice(-10).map((l) => (
          <div key={l.id} style={{ fontSize: "calc(var(--u) * 6.5)", color: l.color ?? "#fff", background: "rgba(0,0,0,0.4)", padding: "calc(var(--u) * 0.5) calc(var(--u) * 2)", opacity: hud.screen?.kind === "chat" ? 1 : Math.min(1, (10000 - (now - l.at)) / 1500) }}>
            {l.text}
          </div>
        ))}
      </div>

      {/* Corners. */}
      {!hud.debug && (hud.coords || hud.fps > 0) && (
        <div className="absolute" style={{ left: "calc(var(--u) * 3)", top: mobile ? "calc(var(--u) * 22)" : "calc(var(--u) * 3)", fontSize: "calc(var(--u) * 6)", lineHeight: 1.4 }}>
          {hud.coords && <div style={{ background: "rgba(0,0,0,0.35)", padding: "0 calc(var(--u) * 2)" }}>XYZ: {hud.coords}</div>}
        </div>
      )}
      {hud.debug && (
        <div className="absolute" style={{ left: "calc(var(--u) * 2)", top: "calc(var(--u) * 2)", fontSize: "calc(var(--u) * 5.5)", lineHeight: 1.35 }}>
          {hud.debug.map((l, i) => <div key={i} style={{ background: "rgba(80,80,80,0.55)", padding: "0 calc(var(--u) * 1.5)", width: "fit-content" }}>{l}</div>)}
        </div>
      )}
      {hud.net && (
        <div className="absolute" style={{ right: "calc(var(--u) * 3)", top: `calc(var(--u) * ${(mobile ? 22 : 3) + corner})`, fontSize: "calc(var(--u) * 6)", textAlign: "right", background: "rgba(0,0,0,0.35)", padding: "calc(var(--u) * 1) calc(var(--u) * 3)" }}>
          <div>{hud.net.role === "host" ? "Hosting" : "Joined"} · {hud.net.kind === "online" ? "online" : hud.net.kind === "lan" ? "LAN" : "this device"} · room <span style={{ color: "#ffff80" }}>{hud.net.room}</span></div>
          <div style={{ color: hud.net.status === "connected" ? "#9f9" : "#fc6" }}>{hud.net.players.length} player{hud.net.players.length === 1 ? "" : "s"} · {hud.net.status}</div>
        </div>
      )}
      {hud.toasts.length > 0 && (
        <div className="absolute" style={{ right: "calc(var(--u) * 2)", top: mobile ? "calc(var(--u) * 40)" : "calc(var(--u) * 2)", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
          {hud.toasts.map((t) => (
            <div key={t.id} style={{
              width: "calc(var(--u) * 160)", display: "flex", gap: "calc(var(--u) * 4)", alignItems: "center", padding: "calc(var(--u) * 4)",
              background: "#212121", border: "calc(var(--u) * 1) solid #000", boxShadow: "inset 0 0 0 calc(var(--u) * 1) #555",
              animation: "bc-toast 5s ease-in-out forwards",
            }}>
              <ItemIcon id={itemId(t.icon)} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#ffff55", fontSize: "calc(var(--u) * 6.5)" }}>Advancement Made!</div>
                <div style={{ color: "#fff", fontSize: "calc(var(--u) * 6.5)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {hud.saving && <div className="absolute" style={{ right: "calc(var(--u) * 3)", bottom: "calc(var(--u) * 3)", fontSize: "calc(var(--u) * 6)", color: "#ddd" }}>Saving world…</div>}

      {hud.loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto" style={{ backgroundImage: `url(${textureBackground("dirt", 0.55)})`, backgroundSize: "calc(var(--u) * 32)", imageRendering: "pixelated" }}>
          <div style={{ fontSize: "calc(var(--u) * 9)", marginBottom: "calc(var(--u) * 6)" }}>{hud.loading.message}…</div>
          <div style={{ width: "calc(var(--u) * 120)", height: "calc(var(--u) * 4)", background: "#1a1a1a", border: "calc(var(--u) * 0.5) solid #000" }}>
            <div style={{ width: `${hud.loading.total ? (hud.loading.done / hud.loading.total) * 100 : 5}%`, height: "100%", background: "#80ff20", transition: "width 0.2s" }} />
          </div>
          <div className="bc-sub" style={{ marginTop: "calc(var(--u) * 4)" }}>{hud.loading.done} / {hud.loading.total} chunks</div>
        </div>
      )}
    </div>
  );
}
