/**
 * A waystone's screen (engine/waystones.ts): its name, which anyone may
 * change, and every other waystone this player has found — the ones in this
 * dimension to travel to, for the levels shown; the ones elsewhere greyed,
 * since a waystone's reach ends at the dimension's edge.
 */
import { useEffect, useRef, useState } from "react";
import type { Game } from "../game/game";
import { travelCost, WAYSTONE_NAME_MAX, waystoneKey } from "../engine/waystones";
import { Button } from "./common";
import { MenuFrame } from "./Menus";

const DIMENSION_NAMES = { overworld: "Overworld", nether: "The Nether", end: "The End" } as const;

export function WaystoneScreen({ game, x, y, z }: { game: Game; x: number; y: number; z: number }) {
  const here = waystoneKey(game.dimension, x, y, z);
  const stone = game.waystones[here];
  const [name, setName] = useState(stone?.name ?? "");
  const p = game.player;
  const creative = p.gameMode === "creative" || p.gameMode === "spectator";
  const found = [...p.waystones].filter((k) => k !== here && game.waystones[k]).map((k) => ({ key: k, w: game.waystones[k] }));
  found.sort((a, b) => Number(b.w.dim === game.dimension) - Number(a.w.dim === game.dimension) || a.w.name.localeCompare(b.w.name));
  const commit = () => { if (name.trim()) game.renameWaystone(here, name); else setName(stone?.name ?? ""); };
  // Leaving by Escape or a trip unmounts the box without a blur: the name typed so far still counts.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);
  const u = (n: number) => `calc(var(--u) * ${n})`;
  return (
    <MenuFrame title="Waystone" width={240}>
      <input
        className="bc-input" value={name} maxLength={WAYSTONE_NAME_MAX} aria-label="Waystone name"
        onChange={(e) => setName(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        style={{ fontSize: u(8), textAlign: "center" }}
      />
      <div className="bc-sub" style={{ textAlign: "center" }}>
        {!found.length
          ? "The first of its kind you have found. Find another, and you can travel between them."
          : creative ? "Travel is free in creative." : `Travel costs a level for every 500 blocks (at most five). You have ${p.xpLevel}.`}
      </div>
      <div className="bc-scroll" style={{ maxHeight: "50vh", display: "flex", flexDirection: "column", gap: u(2) }}>
        {found.map(({ key, w }) => {
          const reachable = w.dim === game.dimension;
          const cost = stone ? travelCost(stone, w, creative) : 0;
          const dist = Math.round(Math.hypot(w.x - x, w.z - z));
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: u(3), background: "rgba(0,0,0,0.35)", padding: u(2), opacity: reachable ? 1 : 0.5 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: u(7), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</div>
                <div className="bc-sub">{reachable ? `${dist} blocks away` : DIMENSION_NAMES[w.dim]}</div>
              </div>
              {reachable && (
                <Button disabled={p.xpLevel < cost} onClick={() => game.travelByWaystone(here, key)} title={cost ? `${cost} level${cost === 1 ? "" : "s"}` : "Free"}>
                  {cost ? `Travel (${cost})` : "Travel"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <Button wide onClick={() => game.setScreen(null)}>Done</Button>
    </MenuFrame>
  );
}
