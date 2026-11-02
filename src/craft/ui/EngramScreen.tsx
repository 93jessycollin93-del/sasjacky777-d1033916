/**
 * The engram list (Primal): every engram, the level and points it needs, and
 * a Learn button for the ones within reach. Points come from experience
 * levels; what each engram teaches is shown by the items it unlocks.
 */
import { useReducer } from "react";
import { canLearn, ENGRAMS, pointsFree } from "../engine/engrams";
import { itemByName } from "../engine/items";
import type { Game } from "../game/game";
import { Button, ItemIcon } from "./common";
import { MenuFrame } from "./Menus";

const u = (n: number) => `calc(var(--u) * ${n})`;

function nameOf(item: string): string {
  try { return itemByName(item).displayName; } catch { return item; }
}

export function EngramScreen({ game, onBack }: { game: Game; onBack: () => void }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const p = game.player;
  const free = pointsFree(p.xpLevel, p.engrams);
  return (
    <MenuFrame title="Engrams" width={280}>
      <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }} data-testid="engram-points">
        Level {p.xpLevel} · {free} engram point{free === 1 ? "" : "s"} to spend. Every level earns four, and every fifth four more.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: u(2) }} data-testid="engram-list">
        {ENGRAMS.map((e) => {
          const learned = p.engrams.has(e.id);
          const ok = canLearn(e, p.xpLevel, p.engrams);
          return (
            <div key={e.id} style={{ display: "flex", gap: u(4), alignItems: "center", padding: u(3), background: learned ? "rgba(40,70,40,0.6)" : "rgba(0,0,0,0.5)", border: `${u(1)} solid ${learned ? "#5a5" : "#333"}` }}>
              <ItemIcon id={itemByName(e.icon).id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: u(7), color: learned ? "#ffff55" : ok === true ? "#fff" : "#999" }}>{e.name}</div>
                <div className="bc-sub">Level {e.level} · {e.points} points · {e.unlocks.map(nameOf).slice(0, 4).join(", ")}{e.unlocks.length > 4 ? "…" : ""}</div>
              </div>
              {learned ? <span className="bc-sub">Learned</span> : (
                <Button disabled={ok !== true} title={ok === true ? undefined : ok} onClick={() => { const why = game.learnEngram(e.id); if (why) game.message(why, "#ff8080"); refresh(); }}>
                  {ok === true ? "Learn" : ok}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <Button wide onClick={onBack}>Done</Button>
    </MenuFrame>
  );
}
