import { useEffect, useRef, useState, type ReactNode } from "react";
import { isEnchanted } from "../engine/enchanting";
import { itemDef } from "../engine/items";
import { tooltipLines } from "./itemText";
import type { Slot } from "../engine/inventory";
import { iconFor } from "./icons";

export function Button({ children, onClick, disabled, danger, className = "", title, wide }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; className?: string; title?: string; wide?: boolean;
}) {
  return (
    <button
      type="button"
      className={`bc-btn ${danger ? "bc-danger" : ""} ${wide ? "w-full" : ""} ${className}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ItemIcon({ id, className = "bc-icon" }: { id: number; className?: string }) {
  const url = iconFor(id);
  if (!url) return null;
  return <img src={url} alt="" className={className} draggable={false} />;
}

export function StackView({ stack }: { stack: Slot }) {
  if (!stack) return null;
  const def = itemDef(stack.id);
  const max = def?.durability;
  const dmg = stack.damage ?? 0;
  const frac = max ? Math.max(0, 1 - dmg / max) : 1;
  const url = isEnchanted(stack) ? iconFor(stack.id) : null;
  return (
    <>
      <ItemIcon id={stack.id} />
      {/* The shimmer is masked by the icon itself, so it runs over the item and not its empty corners. */}
      {url && <span className="bc-glint" style={{ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})` }} />}
      {stack.count > 1 && <span className="bc-count">{stack.count}</span>}
      {max && dmg > 0 && (
        <span className="bc-dura">
          <div style={{ width: `${frac * 100}%`, background: `hsl(${frac * 120}, 90%, 45%)` }} />
        </span>
      )}
    </>
  );
}

export type SlotClick = (button: "left" | "right", shift: boolean) => void;

/** One inventory slot. Mouse: left/right/shift as usual. Touch: tap = left, long press = right. */
export function SlotButton({ stack, onClick, onHover, quickMove, className = "", ghost }: {
  stack: Slot; onClick: SlotClick; onHover?: (s: Slot, x: number, y: number) => void; quickMove?: boolean; className?: string; ghost?: number;
}) {
  const press = useRef<{ t: number; timer: ReturnType<typeof setTimeout> | null; long: boolean } | null>(null);
  return (
    <div
      className={`bc-slot ${className}`}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        if ((e.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
        e.preventDefault();
        e.stopPropagation();
        onClick(e.button === 2 ? "right" : "left", e.shiftKey || !!quickMove);
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
        const state = { t: performance.now(), timer: null as ReturnType<typeof setTimeout> | null, long: false };
        state.timer = setTimeout(() => { state.long = true; onClick("right", false); navigator.vibrate?.(15); }, 380);
        press.current = state;
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = press.current;
        press.current = null;
        if (!s) return;
        if (s.timer) clearTimeout(s.timer);
        if (!s.long) onClick("left", !!quickMove);
      }}
      onMouseEnter={(e) => onHover?.(stack, e.clientX, e.clientY)}
      onMouseMove={(e) => onHover?.(stack, e.clientX, e.clientY)}
      onMouseLeave={() => onHover?.(null, 0, 0)}
    >
      {stack ? <StackView stack={stack} /> : ghost !== undefined ? <span style={{ opacity: 0.25 }}><ItemIcon id={ghost} /></span> : null}
    </div>
  );
}

/** The item name that follows the mouse over slots. */
export function useTooltip(): { tip: ReactNode; onHover: (s: Slot, x: number, y: number) => void } {
  const [state, setState] = useState<{ s: Slot; x: number; y: number } | null>(null);
  const onHover = (s: Slot, x: number, y: number) => setState(s ? { s, x, y } : null);
  const lines = tooltipLines(state?.s ?? null);
  const tip = lines.length && state ? (
    <div className="bc-tooltip" style={{ left: state.x + 14, top: state.y - 10 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ color: l.color, fontSize: l.small ? "0.85em" : undefined, fontStyle: l.italic ? "italic" : undefined }}>{l.text}</div>
      ))}
    </div>
  ) : null;
  return { tip, onHover };
}

/** The stack carried on the cursor, drawn under the pointer. */
export function CursorStack({ stack }: { stack: Slot }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", move);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", move); };
  }, []);
  if (!stack) return null;
  return (
    <div ref={ref} style={{ position: "fixed", left: 0, top: 0, zIndex: 210, pointerEvents: "none", marginLeft: "calc(var(--u) * -9)", marginTop: "calc(var(--u) * -9)" }}>
      <div style={{ position: "relative", width: "var(--slot)", height: "var(--slot)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <StackView stack={stack} />
      </div>
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Button wide onClick={() => onChange(!value)}>{label}: {value ? "ON" : "OFF"}</Button>;
}

export function Cycle<T extends string | number>({ label, value, options, onChange, format }: {
  label: string; value: T; options: T[]; onChange: (v: T) => void; format?: (v: T) => string;
}) {
  const i = Math.max(0, options.indexOf(value));
  return <Button wide onClick={() => onChange(options[(i + 1) % options.length])}>{label}: {format ? format(value) : String(value)}</Button>;
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="bc-btn w-full" style={{ position: "relative", overflow: "hidden", cursor: "ew-resize" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${((value - min) / (max - min)) * 100}%`, background: "rgba(255,255,255,0.12)" }} />
      <span style={{ position: "relative", pointerEvents: "none" }}>{label}: {format ? format(value) : value}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "ew-resize", touchAction: "none" }}
      />
    </label>
  );
}

export function guiUnit(scale: number, width: number, height: number): number {
  if (scale > 0) return scale;
  const s = Math.min(width / 300, height / 200);
  return Math.max(1.5, Math.min(4, Math.floor(s * 2) / 2));
}
