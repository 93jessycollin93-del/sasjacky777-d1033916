/**
 * The ship's screen, laid out the way EVE Online lays out a pilot's: the
 * overview on the right (everything out there, nearest first, in tabs), the
 * selected item above it with its orders, the ship's speed at the bottom, and
 * the clock at the top left. The space itself is the canvas behind: drag to
 * turn the camera, scroll to zoom, click a bracket to select it, double-click
 * empty space to fly that way.
 *
 * Keys (EVE's, with a target selected): Q approach, W orbit, E keep at range,
 * A align to, S warp to, D land (over the Earth), F look at, I show info,
 * Space stop (under real physics: engine off), M microwarpdrive, comma and
 * full stop slow and speed the clock. Under real physics the ship panel adds
 * the orbit's numbers and the burns a pilot makes by hand.
 */
import { Fragment, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/game";
import { latLonText } from "../game/game";
import { AU, dateString, len, sub } from "../space/kepler";
import { SOL } from "../space/galaxy";
import { WORLD_LABEL } from "../space/worlds";
import { distanceText, kindColor, speedText } from "../space/spaceView";
import { aligned, topSpeed, type BurnDir } from "../space/flight";
import { JUMP_SPOOL, jumpTunnel, periodText, TIME_SCALES, type OverviewTab } from "../space/session";
import { GalaxyScreen } from "./GalaxyScreen";

const u = (n: number) => `calc(var(--u) * ${n})`;

const PANEL: React.CSSProperties = {
  background: "rgba(8, 12, 18, 0.78)", border: "1px solid rgba(150, 190, 220, 0.35)", boxShadow: "0 0 12px rgba(0,0,0,0.6)",
  color: "#cfe2f0", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: u(5), pointerEvents: "auto",
};

function Btn({ children, onClick, disabled, title, active, testid }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; active?: boolean; testid?: string }) {
  return (
    <button type="button" data-testid={testid} title={title} disabled={disabled} onClick={onClick}
      style={{
        background: active ? "rgba(90, 150, 200, 0.45)" : "rgba(40, 60, 80, 0.55)", border: "1px solid rgba(150,190,220,0.4)", color: disabled ? "#5d6d7a" : "#e4f0f8",
        padding: `${u(1)} ${u(2.2)}`, fontFamily: "inherit", fontSize: u(4.6), cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
      }}>
      {children}
    </button>
  );
}

const ORBIT_RANGES = [5, 20, 100, 1000];
const WARP_RANGES = [0, 10, 100, 1000];

export function SpaceScreen({ game }: { game: Game }) {
  const s = game.space;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const overlay = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pinch?: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [info, setInfo] = useState<string | null>(null);
  const [orbitRange, setOrbitRange] = useState(20);
  const [warpRange, setWarpRange] = useState(0);

  useEffect(() => {
    const id = window.setInterval(refresh, 120);
    return () => window.clearInterval(id);
  }, []);

  // The overlay canvas, kept the size of the screen at the device's pixel density — set up again when the galaxy map
  // closes, because the canvas it drew on went away while the map was open.
  const galaxyOpen = !!s?.galaxy;
  useEffect(() => {
    const c = overlay.current;
    if (!c || galaxyOpen) return;
    const fit = () => { const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); };
    fit();
    game.setSpaceOverlay(c);
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => { ro.disconnect(); game.setSpaceOverlay(null); };
  }, [game, galaxyOpen]);

  const sel = s?.selected ? s.body(s.selected) ?? null : null;

  // EVE's keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!s || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (game.screen?.kind !== "space") return;
      if (e.code === "KeyG") { s.toggleGalaxy(); e.preventDefault(); refresh(); return; }
      // The galaxy map has its own keys; the ship's wait until it is closed.
      if (s.galaxy) return;
      const target = s.selected;
      let used = true;
      switch (e.code) {
        case "KeyQ": if (target) s.give({ kind: "approach", target }); break;
        case "KeyW": if (target) s.give({ kind: "orbit", target, range: orbitRange }); break;
        case "KeyE": if (target) s.give({ kind: "keep", target, range: orbitRange }); break;
        case "KeyA": if (target) s.give({ kind: "align", target }); break;
        case "KeyS": if (target) s.warpTo(target, warpRange); break;
        case "KeyD":
          if (s.ship.physics === "newton") s.give({ kind: "land" });
          else if (s.landingSite()) s.landing = 2.5;
          else s.say("Land from low over the Earth: warp to it, then press D.");
          break;
        case "KeyF": s.lookAt(s.camera.target === "ship" && target ? target : null); break;
        case "KeyI": setInfo(target ?? s.ship.frame); break;
        case "Space": s.give(s.ship.physics === "newton" ? { kind: "coast" } : { kind: "stop" }); break;
        case "KeyM": s.ship.mwd = !s.ship.mwd; s.say(s.ship.mwd ? "Microwarpdrive on: five times the speed" : "Microwarpdrive off"); break;
        case "Comma": s.slower(); break;
        case "Period": s.faster(); break;
        case "KeyO": if (s.orbits.has("comet")) { s.orbits.delete("comet"); s.orbits.delete("asteroid"); } else { s.orbits.add("comet"); s.orbits.add("asteroid"); } break;
        default: used = false;
      }
      if (used) { e.preventDefault(); refresh(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, game, orbitRange, warpRange]);

  if (!s) return null;
  if (s.galaxy) return <GalaxyScreen game={game} />;
  const ship = s.ship;
  const rows = s.rows();
  const airSpeed = s.airSpeed();
  const speed = ship.warp ? ship.warp.speed : airSpeed ?? len(ship.vel);
  const frameName = s.body(ship.frame)?.name ?? "deep space";
  const note = s.noteText();
  const site = s.landingSite();
  const order = ship.order;
  const real = ship.physics === "newton";
  const orbit = s.orbitInfo();
  const status = s.jump ? (s.jump.phase === "spool" ? `Jump drive spooling — ${Math.max(0, Math.ceil(JUMP_SPOOL - s.jump.t))} s` : `In hyperspace — ${Math.max(0, Math.ceil(jumpTunnel(s.jump.ly) - s.jump.t))} s to ${s.jump.target.name}`)
    : ship.warp ? `Warping to ${s.body(ship.warp.target)?.name} — ${distanceText(ship.warp.left)} to go`
    : ship.landed ? "Landed"
    : real ? newtonStatus(ship, orbit, frameName)
    : order.kind === "warp" ? `Aligning to ${s.body(order.target)?.name}${aligned(ship, s.surroundings, order.target) ? "" : "…"}`
    : order.kind === "approach" ? `Approaching ${s.body(order.target)?.name}`
    : order.kind === "orbit" ? `Orbiting ${s.body(order.target)?.name} at ${order.range} km`
    : order.kind === "keep" ? `Keeping ${order.range} km from ${s.body(order.target)?.name}`
    : order.kind === "align" ? `Aligned to ${s.body(order.target)?.name}`
    : order.kind === "heading" ? "Flying" : len(ship.vel) > 0.001 ? "Stopping" : "Stopped";

  // ---- the mouse on the space ----
  const pos = (e: React.PointerEvent) => { const r = (e.target as HTMLElement).getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, pos(e));
    const p = pos(e);
    drag.current = { x: p.x, y: p.y, moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pos(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const d = drag.current;
    if (!d) { s.hovered = game.spacePick(p.x, p.y); return; }
    if (pointers.current.size === 2 && d.pinch) {
      const [a, b] = [...pointers.current.values()];
      const now = Math.hypot(a.x - b.x, a.y - b.y);
      s.zoom(d.pinch / Math.max(1, now));
      d.pinch = now;
      d.moved = true;
      return;
    }
    const dx = p.x - d.x, dy = p.y - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) s.turn(-dx * 0.006, dy * 0.006);
    d.x = p.x; d.y = p.y;
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size === 0) drag.current = null;
    if (d && !d.moved && pointers.current.size === 0) {
      const p = pos(e);
      const hit = game.spacePick(p.x, p.y);
      if (hit) s.select(hit);
      refresh();
    }
  };
  const onDouble = (e: React.MouseEvent) => {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = game.spacePick(x, y);
    if (hit) { s.select(hit); if (!s.warpTo(hit, warpRange)) s.give({ kind: "approach", target: hit }); return; }
    const dir = game.spaceDirection(x, y);
    if (dir) s.give({ kind: "heading", dir });
  };

  // Round another star the planets are "TRAPPIST-1 e" and the like: the tab says "Moons of e", as the full name wrapped to three lines.
  const home = s.body(s.homePlanet())?.name ?? "…";
  const homeShort = !s.system.solar && home.startsWith(`${s.system.star.name} `) ? home.slice(s.system.star.name.length + 1) : home;
  const tabs: [OverviewTab, string][] = [["planets", "Planets"], ["moons", `Moons of ${homeShort}`], ["small", "Small bodies"], ["all", "All"]];
  const speedFrac = ship.warp ? 1 : real ? ship.engine : Math.min(1, len(ship.vel) / topSpeed(ship));
  const clockText = s.autoScale !== null && !ship.warp ? `×${Math.round(s.shownScale).toLocaleString("en")} autopilot`
    : s.held ? `×${Math.round(s.shownScale).toLocaleString("en")} (held ${s.held})`
    : s.timeScale === 1 ? "real time" : `×${s.timeScale.toLocaleString("en")}`;
  const burn = (dir: BurnDir) => {
    if (order.kind === "burn" && order.dir === dir) s.give({ kind: "coast" }); else s.give({ kind: "burn", dir });
    refresh();
  };

  return (
    <div className="absolute inset-0" data-testid="space-screen" style={{ pointerEvents: "none" }}>
      <canvas ref={overlay} className="absolute inset-0" style={{ width: "100%", height: "100%", pointerEvents: "auto", touchAction: "none", cursor: "crosshair" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}
        onWheel={(e) => { s.zoom(Math.pow(1.0018, e.deltaY)); }} onContextMenu={(e) => e.preventDefault()} />

      {/* The clock and where the ship is. */}
      <div style={{ ...PANEL, position: "absolute", left: u(4), top: u(4), padding: u(3), display: "flex", flexDirection: "column", gap: u(1.5), minWidth: u(95) }} data-testid="space-clock">
        <div style={{ fontSize: u(4.4), color: "#9fc4dc" }} data-testid="space-system">{s.system.solar ? "The Solar System" : `The ${s.system.star.name} system · ${s.system.star.spectral}`}</div>
        <div style={{ fontSize: u(6), color: "#ffffff" }}>{ship.frame === "sun" ? (s.system.solar ? "Interplanetary space" : `Round ${s.system.star.name}`) : `Near ${frameName}`}</div>
        <div>{dateString(s.jd)}</div>
        <div style={{ display: "flex", gap: u(1.5), alignItems: "center" }}>
          <Btn onClick={() => { s.slower(); refresh(); }} title="Slower (,)">◀</Btn>
          <span style={{ minWidth: u(30), textAlign: "center" }} data-testid="space-timescale">{clockText}</span>
          <Btn onClick={() => { s.faster(); refresh(); }} title="Faster (.)" disabled={s.timeScale >= TIME_SCALES[TIME_SCALES.length - 1]}>▶</Btn>
          <Btn onClick={() => { s.now(); refresh(); }} title="Back to the real date">Now</Btn>
          <Btn testid="open-galaxy" onClick={() => { s.toggleGalaxy(); refresh(); }} title="The galaxy map (G)">Galaxy map</Btn>
        </div>
        <div style={{ display: "flex", gap: u(1), flexWrap: "wrap" }}>
          {([["planet", "Planets"], ["moon", "Moons"], ["dwarf", "Dwarfs"], ["comet", "Comets"], ["asteroid", "Asteroids"]] as const).map(([k, label]) => (
            <Btn key={k} active={s.orbits.has(k)} onClick={() => { if (s.orbits.has(k)) s.orbits.delete(k); else s.orbits.add(k); refresh(); }}>{label}</Btn>
          ))}
        </div>
        {site && (
          <div style={{ color: "#9fe0a8" }}>
            Over {latLonText(site.lat, site.lon)}, {Math.round(site.altitude).toLocaleString("en")} km up
          </div>
        )}
      </div>

      {note && (
        // Kept clear of the panels either side: a jump's notices are long enough to run under the selection panel.
        <div style={{ ...PANEL, position: "absolute", left: "50%", top: u(6), transform: "translateX(-50%)", maxWidth: `max(calc(100% - var(--u) * 256), ${u(100)})`, padding: `${u(2)} ${u(5)}`, fontSize: u(5.5), color: "#fff", textAlign: "center" }} data-testid="space-note">
          {note}
        </div>
      )}

      <div style={{ position: "absolute", right: u(4), top: u(4), bottom: u(4), width: u(120), display: "flex", flexDirection: "column", gap: u(3), pointerEvents: "none" }}>
      {/* The selected item and its orders. */}
      <div style={{ ...PANEL, padding: u(3), display: "flex", flexDirection: "column", gap: u(1.5) }} data-testid="space-selected">
        {sel ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: u(6.5), color: kindColor(sel.kind) }}>{sel.name}</span>
              <span>{distanceText(s.distanceTo(sel.id))}</span>
            </div>
            <div style={{ color: "#8fa6b8" }}>{s.system.kindLabel(sel)}</div>
            <div style={{ display: "flex", gap: u(1), flexWrap: "wrap" }}>
              <Btn testid="order-approach" title="Approach (Q)" onClick={() => s.give({ kind: "approach", target: sel.id })}>Approach</Btn>
              <Btn testid="order-orbit" title="Orbit (W)" onClick={() => s.give({ kind: "orbit", target: sel.id, range: orbitRange })}>Orbit</Btn>
              <Btn title="Keep at range (E)" onClick={() => s.give({ kind: "keep", target: sel.id, range: orbitRange })}>Keep at range</Btn>
              <Btn title="Align to (A)" onClick={() => s.give({ kind: "align", target: sel.id })}>Align</Btn>
              <Btn testid="order-warp" title="Warp to (S)" disabled={!s.canWarp(sel.id) || !!ship.warp} onClick={() => s.warpTo(sel.id, warpRange)}>Warp to</Btn>
              <Btn testid="order-look" title="Look at (F)" active={s.camera.target === sel.id} onClick={() => { s.lookAt(s.camera.target === sel.id ? null : sel.id); refresh(); }}>Look at</Btn>
              <Btn testid="order-info" title="Show info (I)" onClick={() => setInfo(sel.id)}>Info</Btn>
            </div>
            <div style={{ display: "flex", gap: u(1), alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#8fa6b8" }}>Orbit/range</span>
              {ORBIT_RANGES.map((r) => <Btn key={r} active={orbitRange === r} onClick={() => setOrbitRange(r)}>{r} km</Btn>)}
            </div>
            <div style={{ display: "flex", gap: u(1), alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#8fa6b8" }}>Warp to within</span>
              {WARP_RANGES.map((r) => <Btn key={r} active={warpRange === r} onClick={() => setWarpRange(r)}>{r} km</Btn>)}
            </div>
          </>
        ) : <div style={{ color: "#8fa6b8" }}>Select something in the overview or in space.</div>}
      </div>

      {/* The overview. */}
      <div style={{ ...PANEL, flex: 1, minHeight: 0, maxHeight: "55vh", display: "flex", flexDirection: "column" }} data-testid="space-overview">
        <div style={{ display: "flex", borderBottom: "1px solid rgba(150,190,220,0.3)" }}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" data-testid={`overview-tab-${k}`} onClick={() => { s.tab = k; refresh(); }}
              style={{ flex: 1, padding: u(1.5), background: s.tab === k ? "rgba(90,150,200,0.35)" : "transparent", color: "#dbe9f4", border: "none", fontFamily: "inherit", fontSize: u(4.2), cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {rows.map((r) => (
            <div key={r.id} data-testid={`overview-${r.id}`} onClick={() => { s.select(r.id); refresh(); }} onDoubleClick={() => { s.select(r.id); if (!s.warpTo(r.id, warpRange)) s.give({ kind: "approach", target: r.id }); }}
              onMouseEnter={() => { s.hovered = r.id; }} onMouseLeave={() => { if (s.hovered === r.id) s.hovered = null; }}
              style={{ display: "flex", gap: u(2), padding: `${u(0.8)} ${u(2)}`, cursor: "pointer", background: s.selected === r.id ? "rgba(90,150,200,0.3)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ color: kindColor(r.kind), width: u(4) }}>{r.kind === "asteroid" ? "◇" : r.kind === "comet" || r.kind === "interstellar" ? "△" : r.kind === "probe" ? "□" : r.kind === "star" ? "✹" : "○"}</span>
              <span style={{ width: u(34), textAlign: "right", color: "#a8c4d8", whiteSpace: "nowrap" }}>{distanceText(r.distance, true)}</span>
              <span style={{ flex: 1, color: "#eaf4fb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
              <span style={{ color: "#7890a2", overflow: "hidden", whiteSpace: "nowrap", maxWidth: u(34), textOverflow: "ellipsis" }}>{r.type}</span>
            </div>
          ))}
        </div>
      </div>
      </div>

      {/* The ship. */}
      <div style={{ ...PANEL, position: "absolute", left: "50%", bottom: u(4), transform: "translateX(-50%)", padding: u(3), display: "flex", flexDirection: "column", alignItems: "center", gap: u(1.5), minWidth: u(130) }} data-testid="space-ship">
        <div style={{ fontSize: u(4.5), color: "#8fa6b8" }}>{ship.cls.name}</div>
        {/* The bar: the throttle under real physics, the speed in the arcade; the heat of the air under it. */}
        <div style={{ width: "100%", height: u(2.2), background: "rgba(255,255,255,0.08)", border: "1px solid rgba(150,190,220,0.3)" }} title={real ? "Throttle" : "Speed"}>
          <div style={{ width: `${speedFrac * 100}%`, height: "100%", background: ship.warp ? "linear-gradient(90deg,#4aa8ff,#bfe6ff)" : real ? "linear-gradient(90deg,#ff9a3c,#ffe08a)" : ship.mwd ? "#f0a040" : "#6fd0ff" }} />
        </div>
        {ship.heat > 0.02 && (
          <div style={{ width: "100%", height: u(1.2), background: "rgba(255,255,255,0.05)" }} title="Heat">
            <div style={{ width: `${ship.heat * 100}%`, height: "100%", background: "linear-gradient(90deg,#ff5a1f,#ffd27a)" }} />
          </div>
        )}
        <div style={{ fontSize: u(7), color: "#fff" }} data-testid="space-speed">{speedText(speed)}{real && !ship.warp ? <span style={{ fontSize: u(4.2), color: "#8fa6b8" }}> {airSpeed !== null ? "through the air" : `relative to ${frameName}`}</span> : null}</div>
        <div style={{ color: ship.warp ? "#9fd8ff" : "#cfe2f0" }} data-testid="space-status">{status}</div>
        {real && orbit && !ship.warp && (
          <div style={{ color: "#a8d8f0", fontSize: u(4.4), textAlign: "center" }} data-testid="space-orbit">
            {orbitLine(orbit)}{ship.dv > 0.0005 ? ` · Δv spent ${ship.dv.toFixed(2)} km/s` : ""}
          </div>
        )}
        {real && !ship.warp && !ship.landed && (
          <div style={{ display: "flex", gap: u(1), flexWrap: "wrap", justifyContent: "center" }}>
            {([["prograde", "Prograde", "Burn along the orbit: higher on the far side"], ["retrograde", "Retrograde", "Burn against the orbit: lower on the far side"],
              ["normal", "Normal", "Burn across the orbit: tilt it"], ["antinormal", "Anti-normal", "Burn across the orbit the other way"],
              ["radial", "Radial out", "Burn away from the body"], ["antiradial", "Radial in", "Burn toward the body"]] as const).map(([d, label, title]) => (
              <Btn key={d} testid={`burn-${d}`} active={order.kind === "burn" && order.dir === d} title={title} onClick={() => burn(d)}>{label}</Btn>
            ))}
            <Btn testid="burn-circularize" active={order.kind === "circularize"} title="Round the orbit off where the ship is now" onClick={() => { s.give({ kind: "circularize" }); refresh(); }}>Circularize</Btn>
          </div>
        )}
        <div style={{ display: "flex", gap: u(1.5), flexWrap: "wrap", justifyContent: "center" }}>
          {real
            ? <Btn onClick={() => { s.give({ kind: "coast" }); refresh(); }} active={order.kind === "coast"} title="Engine off (Space)">Coast</Btn>
            : <Btn onClick={() => s.give({ kind: "stop" })} title="Stop (Space)">Stop</Btn>}
          {real && <Btn onClick={() => { s.give({ kind: "stop" }); refresh(); }} active={order.kind === "stop"} title="Hold position: the engine holds the ship up against gravity">Hold</Btn>}
          <Btn active={ship.mwd} onClick={() => { ship.mwd = !ship.mwd; refresh(); }} title="Microwarpdrive (M): five times the speed, or the thrust">MWD</Btn>
          <Btn onClick={() => { s.lookAt(null); refresh(); }} active={s.camera.target === "ship"} title="Camera on the ship">Ship</Btn>
          <Btn testid="space-land" disabled={!site || ship.landed} active={order.kind === "land"}
            onClick={() => { if (real) { s.give({ kind: "land" }); refresh(); } else s.landing = 2.5; }}
            title={real ? "Land (D): a burn to bring the orbit into the air, then re-entry and a parachute — you come down where the physics takes you" : "Land (D): only from low over the Earth"}>Land</Btn>
          {s.home
            ? <Btn onClick={() => game.land(true)} title="Fly straight home to where you launched">Return home</Btn>
            : <Btn testid="space-jump-home" disabled={!!s.jump} onClick={() => { s.startJump(SOL); refresh(); }} title="Jump back to the Solar System">Jump home</Btn>}
          <Btn testid="space-physics" active={real} onClick={() => { const next = real ? "arcade" : "newton"; s.setPhysics(next); game.spacePhysics = next; refresh(); }}
            title={real ? "Real physics: gravity, orbits and a 5 g engine. Click for arcade flight (EVE's rules, no gravity)." : "Arcade flight. Click for real physics."}>{real ? "Real physics" : "Arcade"}</Btn>
        </div>
      </div>

      {s.landing !== null && (
        <div className="absolute inset-0" style={{ background: `rgba(255, 170, 90, ${Math.min(0.85, (2.5 - s.landing) / 2.5)})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: u(9), fontFamily: "inherit" }}>
          Re-entry…
        </div>
      )}

      {info && s.body(info) && <InfoWindow id={info} game={game} onClose={() => setInfo(null)} />}
    </div>
  );
}

/** EVE's "show info": what a body is, and its numbers. */
function InfoWindow({ id, game, onClose }: { id: string; game: Game; onClose: () => void }) {
  const s = game.space!;
  const sys = s.system;
  const b = sys.body(id)!;
  const p = s.positions.get(id);
  const fromSun = p ? len(p) : 0;
  const G = 6.6743e-20;
  const rows: [string, string][] = [];
  rows.push(["Type", sys.kindLabel(b)]);
  rows.push(["Radius", `${b.radius < 10 ? b.radius.toFixed(2) : Math.round(b.radius).toLocaleString("en")} km${b.flattening ? ` (flattened ${(b.flattening * 100).toFixed(1)}%)` : ""}`]);
  if (b.gm) {
    rows.push(["Mass", `${(b.gm / G).toExponential(3).replace("e+", " × 10^")} kg`]);
    rows.push(["Surface gravity", `${((b.gm / (b.radius * b.radius)) * 1000).toFixed(2)} m/s² (${((b.gm / (b.radius * b.radius)) * 1000 / 9.80665).toFixed(2)} g)`]);
    rows.push(["Escape velocity", `${Math.sqrt((2 * b.gm) / b.radius).toFixed(2)} km/s`]);
  }
  if (b.rotation) rows.push(["Day (sidereal)", `${Math.abs(b.rotation) < 48 ? `${Math.abs(b.rotation).toFixed(2)} hours` : `${(Math.abs(b.rotation) / 24).toFixed(1)} days`}${b.rotation < 0 ? ", turning backwards" : ""}`]);
  if (b.locked) rows.push(["Day", "Tidally locked: one face always toward " + (sys.body(b.parent!)?.name ?? "its planet")]);
  if (b.kind !== "star" && p) rows.push([sys.solar ? "From the Sun now" : `From ${sys.star.name} now`, distanceText(fromSun)]);
  if (b.orbit.kind === "kepler") {
    const o = b.orbit;
    rows.push(["Orbit", `${b.kind === "moon" ? `${Math.round(o.a).toLocaleString("en")} km` : `${(o.a / AU).toFixed(o.a / AU < 0.1 ? 4 : 3)} AU`}, eccentricity ${o.e.toFixed(3)}, every ${periodText(o.period * 86400)}`]);
  }
  if (b.orbit.kind === "equatorial") rows.push(["Orbit", `${Math.round(b.orbit.a).toLocaleString("en")} km, every ${b.orbit.period < 2 ? `${(b.orbit.period * 24).toFixed(1)} hours` : `${b.orbit.period.toFixed(2)} days`}${b.orbit.i > 90 ? ", backwards" : ""}`]);
  if (b.orbit.kind === "conic") {
    const c = b.orbit.conic;
    if (c.e < 1) {
      const a = c.q / (1 - c.e);
      rows.push(["Orbit", `${c.q.toFixed(2)}–${(a * (1 + c.e)).toFixed(1)} AU, tilted ${c.i.toFixed(1)}°, eccentricity ${c.e.toFixed(3)}`]);
      if (c.n) rows.push(["Year", `${(360 / c.n / 365.25).toFixed(1)} years`]);
    } else rows.push(["Orbit", `Open (eccentricity ${c.e.toFixed(3)}): passing through, never to return`]);
  }
  const moons = sys.moonsOf(id);
  if (moons.length) rows.push(["Moons shown", moons.map((m) => m.name).join(", ")]);
  const w = sys.world(id) ?? b.world;
  if (w) {
    rows.push(["World", WORLD_LABEL[w.type]]);
    rows.push(["Temperature", `${Math.round(w.temp - 273.15)} °C${w.surface ? " at the surface" : " at the cloud tops"}`]);
    rows.push(["Air", !w.air ? "None: vacuum" : `${w.air.pressure < 0.01 ? w.air.pressure.toFixed(4) : w.air.pressure.toFixed(2)} bar${w.air.breathable ? " — breathable" : ""}`]);
    if (w.liquid) rows.push(["Lakes and seas", w.liquid === "water" ? "Water" : w.liquid === "lava" ? "Lava" : "Liquid methane"]);
    if (w.surface) rows.push(["Life", w.life === "none" ? "None known" : w.life === "microbial" ? "Microbial" : w.life === "plants" ? "Plants" : "Plants and animals"]);
    rows.push(["Ground", w.surface ? "Solid: somewhere to stand" : "None: no surface to stand on"]);
    rows.push(["Source", w.status === "solar" ? "Probes and telescopes" : w.status === "known" ? "A catalogued planet; its surface is the game's imagining" : w.status === "approx" ? "A real planet, details estimated" : w.status === "hypothetical" ? "The game's invention: none is known here" : "Charted by the game's survey of this star"]);
  }
  if (sys.solar && p && b.kind !== "star") rows.push(["Light from here to Earth", lightTime(len(sub(p, s.positions.get("earth") ?? [0, 0, 0])))]);
  return (
    <div style={{ ...PANEL, position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: `min(92vw, ${u(190)})`, maxHeight: "80vh", overflowY: "auto", padding: u(5), display: "flex", flexDirection: "column", gap: u(2.5) }} data-testid="space-info">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: u(8), color: kindColor(b.kind) }}>{b.name}</span>
        <Btn onClick={onClose}>Close</Btn>
      </div>
      <div style={{ lineHeight: 1.55, fontSize: u(5.2) }}>{b.facts}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: `${u(1)} ${u(4)}` }}>
        {rows.map(([k, v]) => (<Fragment key={k}><span style={{ color: "#8fa6b8" }}>{k}</span><span>{v}</span></Fragment>))}
      </div>
      <div style={{ color: "#6f8494", fontSize: u(4) }}>
        {sys.solar
          ? "Positions from JPL's planetary elements and a lunar theory after Meeus; small bodies from the Minor Planet Center and JPL. Stars: XHIP via d3-celestial (BSD licence). Earth's coastlines: Natural Earth."
          : "Catalogued planets: published periods, masses and radii (NASA Exoplanet Archive and the discovery papers), rounded. Everything else in this system the game works out from its star, the same way every time."}
      </div>
    </div>
  );
}

function lightTime(km: number): string {
  const s = km / 299_792.458;
  if (s < 90) return `${s.toFixed(1)} seconds`;
  if (s < 5400) return `${(s / 60).toFixed(1)} minutes`;
  return `${(s / 3600).toFixed(1)} hours`;
}


/** What the ship is doing, under real physics. */
function newtonStatus(ship: import("../space/flight").Ship, orbit: { periapsis: number; apoapsis: number; e: number; altitude: number } | null, frameName: string): string {
  const o = ship.order;
  switch (o.kind) {
    case "coast":
      if (!orbit) return "Coasting";
      if (orbit.e >= 1) return `Coasting — on an escape path from ${frameName}`;
      if (orbit.periapsis < 0) return `Coasting — falling toward ${frameName}`;
      return `Coasting — in orbit round ${frameName}`;
    case "burn": return `Burning ${o.dir === "antinormal" ? "anti-normal" : o.dir === "antiradial" ? "radial in" : o.dir === "radial" ? "radial out" : o.dir}`;
    case "circularize": return "Circularizing";
    case "stop": return ship.engine > 0.01 ? `Holding position — the engine holding the ship up against ${frameName}'s pull` : "Holding position";
    case "land":
      if (ship.chute > 0) return `Under the parachute — ${Math.max(0, Math.round((orbit?.altitude ?? 0) * 10) / 10)} km up`;
      if (ship.heat > 0.02) return "Re-entry";
      return o.phase === "entry" ? `Falling into the air — ${Math.round(orbit?.altitude ?? 0).toLocaleString("en")} km up` : "Deorbit burn";
    case "orbit":
      if (o.target !== ship.frame || !orbit) return `Orbiting ${frameName}`;
      return o.phase === "burn" ? "Transfer burn" : o.phase === "coast" ? "Coasting to the new height" : "Rounding the orbit off";
    case "warp": return ship.spool > 0 ? "Warp drive spooling up…" : "Turning to align…";
    case "approach": return "Approaching";
    case "keep": return "Keeping at range";
    case "align": return "Aligning";
    case "heading": return "Flying";
  }
}

/** "Pe 398 km · Ap 402 km · 92 minutes · 51.6°": the orbit, the way a flight controller reads it. */
function orbitLine(o: { periapsis: number; apoapsis: number; period: number; incl: number; e: number; altitude: number }): string {
  const km = (n: number) => `${Math.round(n).toLocaleString("en")} km`;
  if (o.e >= 1) return `Escape trajectory · closest ${km(o.periapsis)} · ${km(o.altitude)} up`;
  if (o.periapsis < 0) return `Suborbital · top ${km(o.apoapsis)} · ${km(o.altitude)} up`;
  return `Pe ${km(o.periapsis)} · Ap ${km(o.apoapsis)} · ${periodText(o.period)} · ${o.incl.toFixed(1)}°`;
}
