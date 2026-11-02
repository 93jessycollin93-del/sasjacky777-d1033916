/**
 * Choosing how to play a new world: every mode (modes/modes.ts) as a card
 * under its category, and a Random button for when you would rather be told.
 */
import { CATEGORY_NAMES, CATEGORY_ORDER, MODES, randomMode, type ModeDef } from "../modes/modes";
import { MAPS } from "../engine/maps";
import { itemId } from "../engine/items";
import { Button, ItemIcon } from "./common";

const u = (n: number) => `calc(var(--u) * ${n})`;

const ORDER = CATEGORY_ORDER;

function iconId(name: string): number {
  // A card with the wrong picture is better than a create screen that will not open.
  try { return itemId(name); } catch { return itemId("grass_block"); }
}

export function ModeCard({ def, selected, onPick }: { def: ModeDef; selected?: boolean; onPick?: () => void }) {
  return (
    <button
      type="button" data-testid={`mode-${def.id}`} onClick={onPick}
      style={{
        display: "flex", gap: u(4), alignItems: "center", padding: u(3), textAlign: "left", width: "100%", height: "100%",
        background: selected ? "rgba(60,90,40,0.7)" : "rgba(0,0,0,0.5)", border: `${u(1)} solid ${selected ? "#ffff55" : "#333"}`,
        color: "inherit", font: "inherit", cursor: onPick ? "pointer" : "default",
      }}
    >
      <ItemIcon id={iconId(def.icon)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: u(7), color: selected ? "#ffff55" : "#fff" }}>{def.name}</div>
        <div className="bc-sub" style={{ lineHeight: 1.35 }}>{def.description}</div>
        <div className="bc-sub" style={{ marginTop: u(1), color: "#9fd" }}>
          Goal: {def.goal}
          {def.map ? ` · Map: ${MAPS[def.map].name}` : ""}
          {def.multiplayer ? " · Great with friends" : ""}
        </div>
      </div>
    </button>
  );
}

export function ModePicker({ value, onChange }: { value: string; onChange: (def: ModeDef) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: u(3) }} data-testid="mode-picker">
      <Button wide onClick={() => onChange(randomMode(Math.random))}>Random Mode!</Button>
      {ORDER.map((cat) => {
        const list = MODES.filter((m) => m.category === cat);
        if (!list.length) return null;
        return (
          <div key={cat} style={{ display: "flex", flexDirection: "column", gap: u(2) }}>
            <div style={{ fontSize: u(7), color: "#ffaa00", marginTop: u(2) }}>{CATEGORY_NAMES[cat]}</div>
            {/* Two across where there is room: twenty-odd modes one under another is a long scroll. */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${u(150)}), 1fr))`, gap: u(2) }}>
              {list.map((m) => <ModeCard key={m.id} def={m} selected={m.id === value} onPick={() => onChange(m)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
