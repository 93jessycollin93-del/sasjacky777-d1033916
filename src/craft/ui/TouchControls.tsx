/**
 * Touch controls.
 *
 * A joystick appears wherever the left thumb lands (push it to the rim to
 * sprint), the rest of the screen turns the camera. Two layouts, chosen in
 * Options:
 *  - "Crosshair + buttons": a crosshair in the middle and attack/use buttons,
 *    precise and familiar to anyone coming from a controller.
 *  - "Tap to interact": no crosshair — tap where you want to place or use,
 *    hold still on a block to mine it, drag to look. The pocket-edition feel.
 * Jump doubles as fly-up and sneak as fly-down while flying; a quick double
 * tap on jump toggles flight in creative.
 */
import { useEffect, useRef, useState } from "react";
import type { Game } from "../game/game";

interface Stick { id: number; ox: number; oy: number; x: number; y: number }
interface Look { id: number; x: number; y: number; sx: number; sy: number; t: number; moved: boolean; holdTimer: ReturnType<typeof setTimeout> | null; mining: boolean }

export function TouchControls({ game, onPause, onChat, onInventory, onMap }: {
  game: Game; onPause: () => void; onChat: () => void; onInventory: () => void; onMap?: () => void;
}) {
  const s = game.settings;
  const [stick, setStick] = useState<Stick | null>(null);
  const [sneakOn, setSneakOn] = useState(false);
  const [flying, setFlying] = useState(game.player.flying);
  const looks = useRef(new Map<number, Look>());
  const stickRef = useRef<Stick | null>(null);
  const lastJump = useRef(0);
  const [moved, setMoved] = useState(false);
  const scale = s.touchScale;
  const opacity = s.touchOpacity;
  const tap = s.touchMode === "tap";
  const size = (n: number) => `${n * scale}px`;

  useEffect(() => {
    const t = setInterval(() => setFlying(game.player.flying), 300);
    return () => clearInterval(t);
  }, [game]);

  useEffect(() => {
    game.controls.sneak = sneakOn;
  }, [sneakOn, game]);

  const setMove = (st: Stick | null) => {
    stickRef.current = st;
    setStick(st);
    const c = game.controls;
    if (!st) { c.forward = 0; c.strafe = 0; c.sprint = false; return; }
    const radius = 60 * scale;
    let dx = (st.x - st.ox) / radius, dy = (st.y - st.oy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    c.strafe = Math.abs(dx) < 0.15 ? 0 : dx;
    c.forward = Math.abs(dy) < 0.15 ? 0 : -dy;
    c.sprint = len > 1.15 && c.forward > 0.6;
  };

  const toNdc = (x: number, y: number) => ({ x: (x / window.innerWidth) * 2 - 1, y: -(y / window.innerHeight) * 2 + 1 });

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    game.audio.unlock();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const leftZone = e.clientX < window.innerWidth * 0.42 && e.clientY > window.innerHeight * 0.3;
    if (leftZone && !stickRef.current) {
      setMoved(true);
      setMove({ id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
      return;
    }
    const look: Look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, holdTimer: null, mining: false };
    if (tap) {
      look.holdTimer = setTimeout(() => {
        if (!look.moved) {
          look.mining = true;
          game.controls.aim = toNdc(look.x, look.y);
          game.controls.attack = true;
          navigator.vibrate?.(10);
        }
      }, 280);
    }
    looks.current.set(e.pointerId, look);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    const st = stickRef.current;
    if (st && st.id === e.pointerId) {
      setMove({ ...st, x: e.clientX, y: e.clientY });
      return;
    }
    const look = looks.current.get(e.pointerId);
    if (!look) return;
    const dx = e.clientX - look.x, dy = e.clientY - look.y;
    look.x = e.clientX; look.y = e.clientY;
    if (Math.hypot(look.x - look.sx, look.y - look.sy) > 12) look.moved = true;
    if (look.mining) {
      game.controls.aim = toNdc(look.x, look.y);
      return;
    }
    if (look.moved) {
      const k = 0.0065 * s.sensitivity;
      game.controls.lookX += dx * k;
      game.controls.lookY += dy * k * (s.invertY ? -1 : 1);
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    const st = stickRef.current;
    if (st && st.id === e.pointerId) { setMove(null); return; }
    const look = looks.current.get(e.pointerId);
    if (!look) return;
    looks.current.delete(e.pointerId);
    if (look.holdTimer) clearTimeout(look.holdTimer);
    const c = game.controls;
    if (look.mining) {
      c.attack = false;
      c.aim = null;
      return;
    }
    if (tap && !look.moved && performance.now() - look.t < 280) {
      // A tap: use or place at that spot, or hit what is there.
      c.aim = toNdc(look.x, look.y);
      game.actions.updateTarget();
      if (game.actions.target?.entity || game.actions.target?.remote) {
        c.attack = true;
        setTimeout(() => { c.attack = false; c.aim = null; }, 60);
      } else {
        c.use = true;
        setTimeout(() => { c.use = false; c.aim = null; }, 60);
      }
    }
  };

  const hold = (key: "attack" | "use" | "jump") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      game.audio.unlock();
      if (key === "jump") {
        const now = performance.now();
        if (now - lastJump.current < 300) game.controls.actions.push({ type: "toggleFly" });
        lastJump.current = now;
      }
      game.controls[key] = true;
    },
    onPointerUp: (e: React.PointerEvent) => { e.stopPropagation(); game.controls[key] = false; },
    onPointerCancel: () => { game.controls[key] = false; },
  });

  const btn = (style: React.CSSProperties): React.CSSProperties => ({ ...style, opacity, width: style.width ?? size(64), height: style.height ?? size(64) });
  const creative = game.player.canFly;

  return (
    <div className="absolute inset-0" style={{ touchAction: "none" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {stick && (
        <>
          <div style={{ position: "absolute", left: stick.ox - 60 * scale, top: stick.oy - 60 * scale, width: size(120), height: size(120), borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)", background: "rgba(0,0,0,0.2)", opacity, pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: stick.ox + Math.max(-60, Math.min(60, (stick.x - stick.ox) / scale)) * scale - 26 * scale, top: stick.oy + Math.max(-60, Math.min(60, (stick.y - stick.oy) / scale)) * scale - 26 * scale, width: size(52), height: size(52), borderRadius: "50%", background: "rgba(255,255,255,0.45)", opacity, pointerEvents: "none" }} />
        </>
      )}
      {!stick && !moved && (
        <div className="bc-shadow" style={{ position: "absolute", left: size(40), bottom: size(96), color: "rgba(255,255,255,0.45)", fontSize: 12, pointerEvents: "none" }}>
          Drag here to move
        </div>
      )}

      {/* Right-hand buttons. */}
      <div className="bc-touch-btn" style={btn({ right: size(24), bottom: size(36), width: size(76), height: size(76), borderRadius: "50%", fontSize: 26 })} {...hold("jump")} aria-label="Jump">⤒</div>
      <div className={`bc-touch-btn ${sneakOn ? "on" : ""}`} style={btn({ right: size(112), bottom: size(22), borderRadius: "50%", fontSize: 20 })}
        onPointerDown={(e) => {
          e.stopPropagation();
          // Flying: hold to descend. Walking: tap to toggle sneak, like a crouch button.
          if (flying) {
            game.controls.sneak = true;
            const up = () => { game.controls.sneak = sneakOn; window.removeEventListener("pointerup", up); };
            window.addEventListener("pointerup", up);
          } else setSneakOn((v) => !v);
        }} aria-label={flying ? "Fly down" : "Sneak"}>{flying ? "⤓" : "⇩"}</div>
      {flying && (
        <div className="bc-touch-btn" style={btn({ right: size(112), bottom: size(96), borderRadius: "50%", fontSize: 12 })}
          onPointerDown={(e) => { e.stopPropagation(); game.controls.actions.push({ type: "toggleFly" }); }}>Land</div>
      )}
      {!tap && (
        <>
          <div className="bc-touch-btn" style={btn({ right: size(24), bottom: size(130), width: size(70), height: size(70), borderRadius: "50%", fontSize: 26 })} {...hold("attack")} aria-label="Attack or mine">⛏</div>
          <div className="bc-touch-btn" style={btn({ right: size(104), bottom: size(176), width: size(62), height: size(62), borderRadius: "50%", fontSize: 22 })} {...hold("use")} aria-label="Use or place">✋</div>
        </>
      )}
      {creative && !flying && (
        <div className="bc-touch-btn" style={btn({ right: size(112), bottom: size(96), borderRadius: "50%", fontSize: 12 })}
          onPointerDown={(e) => { e.stopPropagation(); game.controls.actions.push({ type: "toggleFly" }); }}>Fly</div>
      )}

      {/* Hotbar: tap to select, hold to drop one. Sits exactly over the HUD's hotbar. */}
      <div style={{ position: "absolute", left: "50%", bottom: "calc(var(--u) * 2)", transform: "translateX(-50%)", width: "calc(var(--u) * 184)", height: "calc(var(--u) * 24)", display: "flex", padding: "calc(var(--u) * 2)" }}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={{ width: "calc(var(--u) * 20)", height: "100%" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              game.controls.actions.push({ type: "hotbar", slot: i });
              const timer = setTimeout(() => { game.controls.actions.push({ type: "drop", all: false }); navigator.vibrate?.(15); }, 500);
              const up = () => { clearTimeout(timer); window.removeEventListener("pointerup", up); };
              window.addEventListener("pointerup", up);
            }} />
        ))}
      </div>

      {/* Top bar. */}
      <div style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
        {[
          ["⏸", onPause, "Pause"],
          ["💬", onChat, "Chat"],
          ["🎒", onInventory, "Inventory"],
          ...(onMap ? [["🗺", onMap, "Map"]] : []),
          ["👁", () => game.controls.actions.push({ type: "perspective" }), "Camera"],
          ["⬇", () => game.controls.actions.push({ type: "drop", all: false }), "Drop one"],
        ].map(([label, fn, title]) => (
          <div key={title as string} className="bc-touch-btn" title={title as string} aria-label={title as string}
            style={{ position: "relative", width: size(42), height: size(36), opacity, fontSize: 16 }}
            onPointerDown={(e) => { e.stopPropagation(); (fn as () => void)(); }}>{label as string}</div>
        ))}
      </div>
    </div>
  );
}
