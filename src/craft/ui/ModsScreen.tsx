/**
 * The Mods screen: every feature this game borrowed from the modding
 * community (engine/mods.ts), what it does, the mod it comes from with a
 * link to it, and — for the ones that can be — a switch for this world.
 *
 * Shown when creating a world, and from the pause menu; a guest sees the
 * host's choices but cannot change them, since the world is the host's.
 */
import { MODS, modEnabled } from "../engine/mods";
import { Button } from "./common";
import { MenuFrame } from "./Menus";

const u = (n: number) => `calc(var(--u) * ${n})`;

/** Features whose change shows only in ground generated after it. */
const TERRAIN = new Set(["dungeons"]);

export function ModsList({ disabled, onChange }: { disabled: readonly string[]; onChange?: (next: string[]) => void }) {
  const toggle = (id: string) => {
    if (!onChange) return;
    onChange(disabled.includes(id) ? disabled.filter((d) => d !== id) : [...disabled, id]);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: u(3) }} data-testid="mods-list">
      {MODS.map((m) => {
        const on = modEnabled(disabled, m.id);
        return (
          <div key={m.id} style={{ display: "flex", gap: u(4), alignItems: "center", padding: u(3), background: on ? "rgba(40,70,40,0.6)" : "rgba(0,0,0,0.5)", border: `${u(1)} solid ${on ? "#5a5" : "#333"}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: u(7), color: on ? "#ffff55" : "#aaa" }}>{m.name}</div>
              <div className="bc-sub" style={{ lineHeight: 1.35 }}>{m.description}</div>
              <div className="bc-sub" style={{ marginTop: u(1) }}>
                After <a href={m.url} target="_blank" rel="noreferrer" style={{ color: "#8cf", textDecoration: "underline" }}>{m.inspiredBy}</a>
                {TERRAIN.has(m.id) ? " · changes show in newly generated ground" : ""}
              </div>
            </div>
            {m.toggle ? (
              <Button disabled={!onChange} onClick={() => toggle(m.id)}>{on ? "On" : "Off"}</Button>
            ) : (
              <span className="bc-sub" title="Always on: it changes nothing until used">Always on</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** In a world: the host (or a single player) switches features for it; a guest looks. */
export function ModsScreen({ disabled, onChange, onBack }: { disabled: readonly string[]; onChange?: (next: string[]) => void; onBack: () => void }) {
  return (
    <MenuFrame title="Mods" width={280}>
      <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }}>
        Ideas borrowed, with thanks, from the modding community — each rebuilt in this game's own code and art.
        {onChange ? " Switches apply to this world." : " The host decides which are on in this world."}
      </div>
      <ModsList disabled={disabled} onChange={onChange} />
      <Button wide onClick={onBack}>Done</Button>
    </MenuFrame>
  );
}
