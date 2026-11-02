/**
 * The maps (after Xaero's Minimap and World Map, and JourneyMap): a minimap
 * in the top right corner, a full map of everywhere this world has been seen
 * (M), and waypoints — on both maps, and floating over their spot in the
 * world with how far away they are.
 *
 * Everything here draws from game.worldMap's region tiles (game/worldMap.ts),
 * turned into canvases once a change, so a frame is a few image copies rather
 * than tens of thousands of pixels.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import type { Game } from "../game/game";
import { REGION_PX, regionKey } from "../game/worldMap";
import { seasonLabel } from "../engine/seasons";
import {
  MAX_WAYPOINTS, nextWaypointName, WAYPOINT_COLORS, WAYPOINT_NAME_MAX, waypointDistance, type Waypoint,
} from "../engine/waypoints";
import { Button } from "./common";

/** How far down (in GUI units) the minimap reaches, so the HUD can stack what else is in that corner below it. */
export const MINIMAP_ROOM = 80;
export const MINIMAP_SIZE = 64;

const DIMENSION_NAMES = { overworld: "Overworld", nether: "The Nether", end: "The End" } as const;

/** Region canvases, rebuilt only when their region changed. */
class TileCache {
  private tiles = new Map<string, { canvas: HTMLCanvasElement; version: number }>();

  get(game: Game, key: string): HTMLCanvasElement | null {
    const data = game.worldMap.regions.get(key);
    if (!data) return null;
    const version = game.worldMap.versions.get(key) ?? 0;
    let t = this.tiles.get(key);
    if (!t || t.version !== version) {
      const canvas = t?.canvas ?? document.createElement("canvas");
      canvas.width = canvas.height = REGION_PX;
      const img = new ImageData(REGION_PX, REGION_PX);
      img.data.set(data);
      canvas.getContext("2d")?.putImageData(img, 0, 0);
      t = { canvas, version };
      this.tiles.set(key, t);
    }
    return t.canvas;
  }
}

interface View {
  /** The world point at the canvas's centre. */
  x: number;
  z: number;
  /** Canvas pixels a block. */
  scale: number;
  width: number;
  height: number;
}

const toScreen = (v: View, x: number, z: number): [number, number] => [(x - v.x) * v.scale + v.width / 2, (z - v.z) * v.scale + v.height / 2];

/** The explored ground in view, unexplored left dark. */
function drawTiles(ctx: CanvasRenderingContext2D, game: Game, cache: TileCache, v: View): void {
  ctx.fillStyle = "#15151c";
  ctx.fillRect(0, 0, v.width, v.height);
  ctx.imageSmoothingEnabled = false;
  const left = v.x - v.width / 2 / v.scale, top = v.z - v.height / 2 / v.scale;
  const right = v.x + v.width / 2 / v.scale, bottom = v.z + v.height / 2 / v.scale;
  for (let rz = Math.floor(top / REGION_PX); rz <= Math.floor(bottom / REGION_PX); rz++) {
    for (let rx = Math.floor(left / REGION_PX); rx <= Math.floor(right / REGION_PX); rx++) {
      const tile = cache.get(game, regionKey(game.dimension, rx, rz));
      if (!tile) continue;
      const [sx, sy] = toScreen(v, rx * REGION_PX, rz * REGION_PX);
      ctx.drawImage(tile, Math.floor(sx), Math.floor(sy), Math.ceil(REGION_PX * v.scale), Math.ceil(REGION_PX * v.scale));
    }
  }
}

/** An arrow for a player, pointing the way they face (north is up). */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, yaw: number, size: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  // Facing (-sin yaw, -cos yaw) in x,z is a clockwise turn of -yaw from north.
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.8);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, size / 5);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawWaypoint(ctx: CanvasRenderingContext2D, x: number, y: number, w: Waypoint, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = WAYPOINT_COLORS[w.color];
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, size / 4);
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

/** Players and waypoints over the tiles; a waypoint off the edge sits on the edge, pointing the way. */
function drawMarkers(ctx: CanvasRenderingContext2D, game: Game, v: View, size: number, clampToEdge: boolean, labels: boolean): void {
  const dim = game.dimension;
  const margin = size;
  for (const w of game.player.waypoints) {
    if (w.dim !== dim || w.hidden) continue;
    let [sx, sy] = toScreen(v, w.x + 0.5, w.z + 0.5);
    const inside = sx >= margin && sy >= margin && sx <= v.width - margin && sy <= v.height - margin;
    if (!inside && !clampToEdge) continue;
    if (!inside) {
      sx = Math.max(margin, Math.min(v.width - margin, sx));
      sy = Math.max(margin, Math.min(v.height - margin, sy));
    }
    drawWaypoint(ctx, sx, sy, w, size);
    if (labels && inside) {
      ctx.font = `${Math.round(size * 1.3)}px monospace`;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3;
      ctx.textAlign = "center";
      ctx.strokeText(w.name, sx, sy - size * 1.2);
      ctx.fillText(w.name, sx, sy - size * 1.2);
    }
  }
  // A mission's marks: dots, held at the edge when off it, like the waypoints.
  if (dim === "overworld") for (const m of game.markers) {
    let [sx, sy] = toScreen(v, m.x, m.z);
    const inside = sx >= margin && sy >= margin && sx <= v.width - margin && sy <= v.height - margin;
    if (!inside && !clampToEdge) continue;
    if (!inside) { sx = Math.max(margin, Math.min(v.width - margin, sx)); sy = Math.max(margin, Math.min(v.height - margin, sy)); }
    ctx.beginPath();
    ctx.arc(sx, sy, size * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = m.color;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(1, size / 4);
    ctx.fill();
    ctx.stroke();
  }
  for (const r of game.remote.values()) {
    if (r.dead) continue;
    const [sx, sy] = toScreen(v, r.x, r.z);
    if (sx < 0 || sy < 0 || sx > v.width || sy > v.height) continue;
    drawArrow(ctx, sx, sy, r.yaw, size * 1.1, "#7fd0ff");
    if (labels) {
      ctx.font = `${Math.round(size * 1.2)}px monospace`;
      ctx.fillStyle = "#cfefff";
      ctx.textAlign = "center";
      ctx.fillText(r.name, sx, sy + size * 2.4);
    }
  }
  const b = game.player.body;
  const [px, py] = toScreen(v, b.x, b.z);
  drawArrow(ctx, px, py, game.player.yaw, size * 1.3, "#ffffff");
}

/** Redraws on animation frames, at most `fps` a second. */
function useFrames(draw: () => void, fps: number): void {
  const ref = useRef(draw);
  ref.current = draw;
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 1000 / fps) return;
      last = t;
      ref.current();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
}

// ---- the minimap ----------------------------------------------------------------------------

export function Minimap({ game }: { game: Game }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useMemo(() => new TileCache(), []);
  const [label, setLabel] = useState({ coords: "", season: "" });
  useFrames(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const b = game.player.body;
    // Two canvas pixels a block: 128 blocks across, sharp at any GUI scale.
    const v: View = { x: b.x, z: b.z, scale: 2, width: c.width, height: c.height };
    drawTiles(ctx, game, cache, v);
    drawMarkers(ctx, game, v, 7, true, false);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px monospace";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.strokeText("N", c.width / 2, 20);
    ctx.fillText("N", c.width / 2, 20);
    const coords = `${Math.floor(b.x)}, ${Math.floor(b.y)}, ${Math.floor(b.z)}`;
    const season = game.season() ? seasonLabel(game.time) : "";
    if (coords !== label.coords || season !== label.season) setLabel({ coords, season });
  }, 15);
  return (
    <div
      className="absolute pointer-events-none"
      data-testid="minimap"
      style={{ right: "calc(var(--u) * 3)", top: "calc(var(--u) * 3)", width: `calc(var(--u) * ${MINIMAP_SIZE})`, textAlign: "center" }}
    >
      <canvas
        ref={canvas} width={256} height={256}
        style={{ width: "100%", aspectRatio: "1", display: "block", imageRendering: "pixelated", border: "calc(var(--u) * 1) solid #111", boxShadow: "0 0 0 calc(var(--u) * 0.5) #777" }}
      />
      <div style={{ fontSize: "calc(var(--u) * 5.5)", background: "rgba(0,0,0,0.4)", marginTop: "calc(var(--u) * 1)", padding: "0 calc(var(--u) * 1)" }}>{label.coords}</div>
      {label.season && <div style={{ fontSize: "calc(var(--u) * 5)", color: "#cfe8a8", background: "rgba(0,0,0,0.4)" }}>{label.season}</div>}
    </div>
  );
}

// ---- waypoints in the world ---------------------------------------------------------------

/** The waypoints of this dimension, floated over their spots with their distance, drawn in step with the camera. */
export function WaypointLabels({ game }: { game: Game }) {
  const [labels, setLabels] = useState<{ key: string; name: string; color: string; left: number; top: number; dist: number }[]>([]);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrames(() => {
    const cam = game.renderer.camera;
    const b = game.player.body;
    const out: typeof labels = [];
    game.player.waypoints.forEach((w, i) => {
      if (w.dim !== game.dimension || w.hidden) return;
      const dist = waypointDistance(w, b.x, b.y, b.z);
      if (dist < 2) return;
      v.set(w.x + 0.5, w.y + 1.5, w.z + 0.5).project(cam);
      if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
      out.push({ key: `${i}:${w.name}`, name: w.name, color: WAYPOINT_COLORS[w.color], left: (v.x + 1) * 50, top: (1 - v.y) * 50, dist });
    });
    setLabels((old) => (old.length === 0 && out.length === 0 ? old : out));
  }, 30);
  return (
    <div className="absolute inset-0 pointer-events-none bc-shadow" style={{ overflow: "hidden" }}>
      {labels.map((l) => (
        <div
          key={l.key}
          style={{
            position: "absolute", left: `${l.left}%`, top: `${l.top}%`, transform: "translate(-50%, -100%)", textAlign: "center",
            fontSize: "calc(var(--u) * 5.5)", whiteSpace: "nowrap", opacity: l.dist > 400 ? 0.7 : 1,
          }}
        >
          <div style={{ background: "rgba(0,0,0,0.45)", padding: "0 calc(var(--u) * 2)" }}>
            {l.name} <span style={{ color: "#bbb" }}>{l.dist} m</span>
          </div>
          <div style={{ width: "calc(var(--u) * 4)", height: "calc(var(--u) * 4)", margin: "calc(var(--u) * 1) auto 0", background: l.color, transform: "rotate(45deg)", border: "calc(var(--u) * 0.6) solid #000" }} />
        </div>
      ))}
    </div>
  );
}

// ---- the world map (M) ----------------------------------------------------------------------

export function WorldMapScreen({ game, mobile, onClose }: { game: Game; mobile: boolean; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useMemo(() => new TileCache(), []);
  const b = game.player.body;
  const view = useRef({ x: b.x, z: b.z, scale: 2 });
  const [picked, setPicked] = useState<{ x: number; z: number } | null>(null);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((n) => n + 1);
  const drag = useRef<{ x: number; y: number; vx: number; vz: number; moved: boolean } | null>(null);
  const cheats = game.cheatsAllowed();
  const dim = game.dimension;
  const waypoints = game.player.waypoints;

  useFrames(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const v: View = { ...view.current, scale: view.current.scale * dpr, width: w, height: h };
    drawTiles(ctx, game, cache, v);
    drawMarkers(ctx, game, v, 7 * dpr, false, true);
    if (picked) {
      const [sx, sy] = toScreen(v, picked.x + 0.5, picked.z + 0.5);
      ctx.strokeStyle = "#ffff55";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(sx, sy, 8 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, 30);

  const worldAt = (clientX: number, clientY: number): { x: number; z: number } => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const v = view.current;
    return { x: Math.floor(v.x + (clientX - r.left - r.width / 2) / v.scale), z: Math.floor(v.z + (clientY - r.top - r.height / 2) / v.scale) };
  };
  const zoom = (factor: number, clientX?: number, clientY?: number) => {
    const v = view.current;
    const next = Math.max(0.25, Math.min(16, v.scale * factor));
    if (clientX !== undefined && clientY !== undefined) {
      // Zoom about the pointer: the block under it stays under it.
      const before = worldAt(clientX, clientY);
      v.scale = next;
      const after = worldAt(clientX, clientY);
      v.x += before.x - after.x; v.z += before.z - after.z;
    } else v.scale = next;
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vz: view.current.z, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    view.current.x = d.vx - dx / view.current.scale;
    view.current.z = d.vz - dy / view.current.scale;
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setPicked(worldAt(e.clientX, e.clientY));
  };
  const setWaypoints = (list: Waypoint[]) => { game.player.waypoints = list; refresh(); };
  const add = (x: number, y: number, z: number) => {
    if (waypoints.length >= MAX_WAYPOINTS) { game.message(`You can keep ${MAX_WAYPOINTS} waypoints; delete one first.`, "#ff8888"); return; }
    setWaypoints([...waypoints, { name: nextWaypointName(waypoints), x, y, z, dim, color: (waypoints.length + 1) % WAYPOINT_COLORS.length }]);
  };
  const update = (i: number, patch: Partial<Waypoint>) => setWaypoints(waypoints.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const travel = (x: number, y: number | null, z: number) => { game.travelTo(x + 0.5, y, z + 0.5); onClose(); };
  const pickedSurface = (p: { x: number; z: number }) => {
    const y = game.world.topSolid(p.x, p.z);
    return y >= 0 ? y + 1 : null;
  };

  const u = (n: number) => `calc(var(--u) * ${n})`;
  return (
    <div className="absolute inset-0 pointer-events-auto bc-shadow" style={{ background: "rgba(10,10,16,0.92)", display: "flex", flexDirection: mobile ? "column" : "row" }}>
      <div style={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0 }}>
        <canvas
          ref={canvas} data-testid="world-map"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: "grab", imageRendering: "pixelated" }}
        />
        <div style={{ position: "absolute", left: u(4), top: u(4), fontSize: u(7) }}>
          {DIMENSION_NAMES[dim]}{game.season() ? <span style={{ color: "#cfe8a8" }}> · {seasonLabel(game.time)}</span> : null}
          <div className="bc-sub">Drag to move · scroll to zoom · click to pick a spot · M or Esc to close</div>
        </div>
        <div style={{ position: "absolute", left: u(4), bottom: u(4), display: "flex", gap: u(2) }}>
          <Button onClick={() => zoom(1.5)} title="Zoom in">+</Button>
          <Button onClick={() => zoom(1 / 1.5)} title="Zoom out">−</Button>
          <Button onClick={() => { view.current.x = game.player.body.x; view.current.z = game.player.body.z; }}>Me</Button>
        </div>
        {picked && (
          <div style={{ position: "absolute", right: u(4), bottom: u(4), background: "rgba(0,0,0,0.7)", padding: u(4), display: "flex", flexDirection: "column", gap: u(2), fontSize: u(6) }}>
            <div>{picked.x}, {picked.z}</div>
            <Button onClick={() => { add(picked.x, pickedSurface(picked) ?? Math.floor(game.player.body.y), picked.z); setPicked(null); }}>Add waypoint here</Button>
            {cheats && <Button onClick={() => travel(picked.x, null, picked.z)}>Teleport here</Button>}
            <Button onClick={() => setPicked(null)}>Cancel</Button>
          </div>
        )}
      </div>
      <div
        className="bc-scroll"
        style={{ width: mobile ? "100%" : u(150), maxHeight: mobile ? "40%" : "100%", padding: u(4), background: "rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: u(2) }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: u(8) }}>Waypoints</div>
          <Button onClick={onClose}>Done</Button>
        </div>
        <Button wide onClick={() => add(Math.floor(game.player.body.x), Math.floor(game.player.body.y), Math.floor(game.player.body.z))}>
          Add one here
        </Button>
        {waypoints.length === 0 && <div className="bc-sub">None yet. Add one where you stand, or pick a spot on the map. Dying leaves one where you fell.</div>}
        {waypoints.map((w, i) => {
          const here = w.dim === dim;
          return (
            <div key={i} style={{ background: "rgba(255,255,255,0.06)", padding: u(2), opacity: w.hidden ? 0.55 : 1, display: "flex", flexDirection: "column", gap: u(1) }}>
              <div style={{ display: "flex", gap: u(2), alignItems: "center" }}>
                <button
                  type="button" title="Colour" aria-label="Change colour"
                  onClick={() => update(i, { color: (w.color + 1) % WAYPOINT_COLORS.length })}
                  style={{ width: u(8), height: u(8), flex: "none", background: WAYPOINT_COLORS[w.color], border: `${u(0.8)} solid #000`, transform: "rotate(45deg)", cursor: "pointer" }}
                />
                <input
                  className="bc-input" value={w.name} maxLength={WAYPOINT_NAME_MAX} aria-label="Waypoint name"
                  onChange={(e) => update(i, { name: e.target.value })}
                  onBlur={(e) => { if (!e.target.value.trim()) update(i, { name: nextWaypointName(waypoints) }); }}
                  style={{ flex: 1, minWidth: 0, fontSize: u(6) }}
                />
              </div>
              <div className="bc-sub" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{w.x}, {w.y}, {w.z}</span>
                <span>{here ? `${waypointDistance(w, game.player.body.x, game.player.body.y, game.player.body.z)} m` : DIMENSION_NAMES[w.dim]}</span>
              </div>
              <div style={{ display: "flex", gap: u(1), flexWrap: "wrap" }}>
                {here && <Button onClick={() => { view.current.x = w.x; view.current.z = w.z; }}>Show</Button>}
                <Button onClick={() => update(i, { hidden: !w.hidden || undefined })}>{w.hidden ? "Unhide" : "Hide"}</Button>
                {cheats && here && <Button onClick={() => travel(w.x, w.y, w.z)}>Teleport</Button>}
                <Button danger onClick={() => setWaypoints(waypoints.filter((_, j) => j !== i))}>Delete</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
