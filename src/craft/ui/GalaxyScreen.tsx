/**
 * The galaxy map's screen: the Milky Way behind, where the map is looking at
 * the top left with a search, the selected star's card on the right, and the
 * colours' key at the bottom. Drag to turn, scroll or pinch to zoom from a
 * single star out to the whole disk, click a star to select it, double-click
 * to fly the map to it. G (or Close) goes back to the ship.
 */
import { Fragment, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Game } from "../game/game";
import { CLASS, distance, LY_PER_PC, regionAt, seenFromSun, SGR_A, SOL, SUN_POS, systemOutlook, tempColor, totalStars, type Star } from "../space/galaxy";
import { systemOf, systemSummary } from "../space/systems";
import { WORLD_LABEL } from "../space/worlds";

const u = (n: number) => `calc(var(--u) * ${n})`;

const PANEL: React.CSSProperties = {
  background: "rgba(6, 9, 16, 0.8)", border: "1px solid rgba(150, 190, 220, 0.35)", boxShadow: "0 0 12px rgba(0,0,0,0.6)",
  color: "#cfe2f0", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: u(5), pointerEvents: "auto",
};

function Btn({ children, onClick, title, testid }: { children: ReactNode; onClick: () => void; title?: string; testid?: string }) {
  return (
    <button type="button" data-testid={testid} title={title} onClick={onClick}
      style={{ background: "rgba(40, 60, 80, 0.55)", border: "1px solid rgba(150,190,220,0.4)", color: "#e4f0f8", padding: `${u(1)} ${u(2.2)}`, fontFamily: "inherit", fontSize: u(4.6), cursor: "pointer", whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

let STARS_IN_GALAXY: number | null = null;

const css = (c: [number, number, number]) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

export function GalaxyScreen({ game }: { game: Game }) {
  const s = game.space;
  const map = s?.galaxy ?? null;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const overlay = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pinch?: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [query, setQuery] = useState("");
  STARS_IN_GALAXY ??= totalStars();

  useEffect(() => {
    const id = window.setInterval(refresh, 150);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const c = overlay.current;
    if (!c) return;
    const fit = () => { const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); };
    fit();
    game.setGalaxyOverlay(c);
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => { ro.disconnect(); game.setGalaxyOverlay(null); };
  }, [game]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!map || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.code === "KeyF" && map.selected) { map.goTo(map.selected.pos); refresh(); e.preventDefault(); }
      if (e.code === "KeyH") { map.goTo(SUN_POS, 40); map.select(SOL); refresh(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);

  if (!s || !map) return null;

  const pos = (e: React.PointerEvent) => { const r = (e.target as HTMLElement).getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos(e);
    pointers.current.set(e.pointerId, p);
    drag.current = { x: p.x, y: p.y, moved: false };
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = pos(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const d = drag.current;
    if (!d) return;
    if (pointers.current.size === 2 && d.pinch) {
      const [a, b] = [...pointers.current.values()];
      const now = Math.hypot(a.x - b.x, a.y - b.y);
      map.zoom(d.pinch / Math.max(1, now));
      d.pinch = now; d.moved = true;
      return;
    }
    const dx = p.x - d.x, dy = p.y - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) map.turn(-dx * 0.006, dy * 0.006);
    d.x = p.x; d.y = p.y;
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size === 0) drag.current = null;
    if (d && !d.moved && pointers.current.size === 0) {
      const p = pos(e);
      const hit = game.galaxyPick(p.x, p.y);
      if (hit) map.select(hit);
      refresh();
    }
  };
  const onDouble = (e: React.MouseEvent) => {
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const hit = game.galaxyPick(e.clientX - r.left, e.clientY - r.top);
    if (hit) { map.select(hit); map.goTo(hit.pos, Math.min(map.camera.dist, 40)); refresh(); }
  };

  const results = map.search(query);
  const sel = map.selected;

  return (
    <div className="absolute inset-0" data-testid="galaxy-screen" style={{ pointerEvents: "none" }}>
      <canvas ref={overlay} className="absolute inset-0" style={{ width: "100%", height: "100%", pointerEvents: "auto", touchAction: "none", cursor: "crosshair" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}
        onWheel={(e) => map.zoom(Math.pow(1.0018, e.deltaY))} onContextMenu={(e) => e.preventDefault()} />

      <div style={{ ...PANEL, position: "absolute", left: u(4), top: u(4), padding: u(3), display: "flex", flexDirection: "column", gap: u(1.6), width: u(120) }} data-testid="galaxy-panel">
        <div style={{ fontSize: u(7), color: "#fff" }}>The Milky Way</div>
        <div style={{ color: "#a8c8e0" }} data-testid="galaxy-focus">{map.describeFocus()}</div>
        <div style={{ color: "#7890a2", fontSize: u(4.2) }}>
          About {(STARS_IN_GALAXY / 1e9).toFixed(0)} billion stars; {map.stars.length.toLocaleString("en")} charted round here{map.busy ? " (charting…)" : ""}.
        </div>
        <div style={{ display: "flex", gap: u(1), flexWrap: "wrap" }}>
          <Btn testid="galaxy-sol" title="Home (H)" onClick={() => { map.goTo(SUN_POS, 40); map.select(SOL); refresh(); }}>Sol</Btn>
          {map.here !== SOL && <Btn testid="galaxy-here" title="Where the ship is" onClick={() => { map.goTo(map.here.pos, 40); map.select(map.here); refresh(); }}>Here</Btn>}
          <Btn testid="galaxy-core" title="The black hole at the centre" onClick={() => { map.goTo(SGR_A.pos, 1500); refresh(); }}>Galactic centre</Btn>
          <Btn testid="galaxy-whole" title="Pull back to see the whole galaxy" onClick={() => { map.goTo([0, 0, 0], 42000); map.camera.pitch = 1.05; refresh(); }}>Whole galaxy</Btn>
          {sel && <Btn testid="galaxy-centre-on" title="Centre on the selection (F)" onClick={() => { map.goTo(sel.pos); refresh(); }}>Centre on selected</Btn>}
          <Btn testid="galaxy-close" title="Back to the ship (G)" onClick={() => { s.galaxy = null; refresh(); }}>Close map</Btn>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a star, cluster or nebula…" data-testid="galaxy-search"
          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(150,190,220,0.4)", color: "#e4f0f8", padding: u(1.5), fontFamily: "inherit", fontSize: u(4.6) }} />
        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", maxHeight: u(70), overflowY: "auto" }}>
            {results.map((r) => (
              <div key={r.name} data-testid={`galaxy-result-${r.name}`} style={{ padding: `${u(0.8)} ${u(1)}`, cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                onClick={() => { if (r.star) map.select(r.star); map.goTo(r.pos, r.star ? 25 : 300); setQuery(""); refresh(); }}>
                {r.name} <span style={{ color: "#7890a2" }}>{Math.round(distance(r.pos, SUN_POS) * LY_PER_PC).toLocaleString("en")} ly</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {sel && <StarCard star={sel} game={game} onJump={refresh} />}

      <div style={{ ...PANEL, position: "absolute", right: u(4), bottom: u(4), padding: u(2.5), display: "flex", gap: u(3), flexWrap: "wrap", fontSize: u(4.2), maxWidth: u(150) }}>
        {([[40000, "O/B"], [9000, "A"], [6500, "F"], [5700, "G"], [4600, "K"], [3200, "M"], [3500, "giants"]] as const).map(([t, name]) => (
          <span key={name} style={{ display: "flex", alignItems: "center", gap: u(1) }}>
            <span style={{ width: u(3), height: u(3), borderRadius: "50%", background: css(tempColor(t)), display: "inline-block" }} />{name}
          </span>
        ))}
      </div>
    </div>
  );
}

function StarCard({ star, game, onJump }: { star: Star; game: Game; onJump: () => void }) {
  const s = game.space!;
  const fromSun = distance(star.pos, SUN_POS) * LY_PER_PC;
  const fromHere = distance(star.pos, s.system.star.pos) * LY_PER_PC;
  const here = s.system.star.id === star.id;
  const sys = star.id === SOL.id ? null : systemOf(star);
  const sum = sys ? systemSummary(sys) : null;
  const sky = seenFromSun(star.pos);
  const outlook = systemOutlook(star);
  const num = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en") : n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toPrecision(2));
  const rows: [string, string][] = [
    ["Type", `${star.spectral} — ${CLASS[star.cls]?.label ?? star.cls}`],
    ["Surface", `${Math.round(star.temp).toLocaleString("en")} K`],
    ["Luminosity", `${num(star.lum)} Suns`],
    ["Mass", `${num(star.mass)} Suns`],
    ["Radius", `${num(star.radius)} Suns`],
    ["From Sol", star === SOL ? "—" : `${fromSun < 100 ? fromSun.toFixed(2) : Math.round(fromSun).toLocaleString("en")} light-years`],
    ["In our sky", star === SOL ? "—" : `galactic longitude ${sky.l.toFixed(1)}°, latitude ${sky.b.toFixed(1)}°`],
    ["Where", regionAt(star.pos)],
    // A real star with no planets on record says so, rather than passing a guess off as the catalogue.
    ["Planets", star.id === SOL.id ? "8, and the dwarfs, moons and comets" : star.real ? (star.planets !== undefined ? `${star.planets} known` : `none confirmed${sum?.planets ? ` (the game imagines ${sum.planets})` : ""}`) : `${outlook.planets} charted`],
  ];
  if (!here && s.system.star.id !== SOL.id) rows.splice(6, 0, ["From here", `${fromHere < 100 ? fromHere.toFixed(2) : Math.round(fromHere).toLocaleString("en")} light-years`]);
  if (sum && sum.moons) rows.push(["Moons", String(sum.moons)]);
  if (outlook.habitable) rows.push(["Habitable zone", `${outlook.habitable[0].toFixed(2)}–${outlook.habitable[1].toFixed(2)} AU`]);
  return (
    <div style={{ ...PANEL, position: "absolute", right: u(4), top: u(4), width: u(118), maxHeight: `calc(100% - ${u(30)})`, overflowY: "auto", padding: u(3), display: "flex", flexDirection: "column", gap: u(1.8) }} data-testid="galaxy-star">
      <div style={{ fontSize: u(6.5), color: css(tempColor(star.temp)) }}>{star.name}</div>
      <div style={{ color: "#7890a2" }}>{star.real ? "A real star" : "Charted by the survey: not yet visited"}</div>
      {here
        ? <div style={{ color: "#7dff9a" }} data-testid="galaxy-here-note">You are here.</div>
        : <button type="button" data-testid="galaxy-jump" disabled={!!s.jump} onClick={() => { if (s.startJump(star)) onJump(); }}
            style={{ background: "rgba(60, 120, 90, 0.6)", border: "1px solid rgba(140, 230, 170, 0.6)", color: "#eafff0", padding: u(1.8), fontFamily: "inherit", fontSize: u(5), cursor: "pointer" }}>
            Jump to {star.name} — {fromHere < 100 ? fromHere.toFixed(1) : Math.round(fromHere).toLocaleString("en")} ly
          </button>}

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: `${u(0.8)} ${u(3)}` }}>
        {rows.map(([k, v]) => (<Fragment key={k}><span style={{ color: "#8fa6b8" }}>{k}</span><span>{v}</span></Fragment>))}
      </div>
      {star.note && <div style={{ lineHeight: 1.5, color: "#dbe9f4" }}>{star.note}</div>}
      {sys && sys.bodies.some((b) => b.kind === "planet") && (
        <div style={{ display: "flex", flexDirection: "column", gap: u(0.6), maxHeight: u(60), overflowY: "auto" }} data-testid="galaxy-planets">
          {sys.bodies.filter((b) => b.kind === "planet").map((b) => (
            <div key={b.id} style={{ display: "flex", gap: u(2), fontSize: u(4.2) }}>
              <span style={{ width: u(5), color: b.color }}>●</span>
              <span style={{ flex: 1 }}>{b.name.slice(star.name.length + 1)} · {WORLD_LABEL[b.world!.type]}</span>
              {b.world!.habitable && <span style={{ color: "#7ac8ff" }}>seas</span>}
              {(b.world!.life === "plants" || b.world!.life === "animals") && <span style={{ color: "#8fe08f" }}>life</span>}
              {b.world!.status === "known" && <span style={{ color: "#ffd98a" }}>known</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
