/**
 * Ashgrove County's "who were you?": an occupation, and traits bought with
 * the points it leaves. Shown before the first step in the county and after
 * every death, since whoever wakes next is somebody new (game/game.ts).
 */
import { useState } from "react";
import type { Game } from "../game/game";
import { invalid, OCCUPATIONS, occupation, perksOf, pointsLeft, trait, TRAITS } from "../engine/survivors";
import { Button } from "./common";
import { MenuFrame } from "./Menus";

const u = (n: number) => `calc(var(--u) * ${n})`;

export function SurvivorScreen({ game }: { game: Game }) {
  const [job, setJob] = useState("unemployed");
  const [traits, setTraits] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const choice = { occupation: job, traits };
  const left = pointsLeft(choice);
  const why = invalid(choice);
  const toggle = (id: string) => setTraits((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t.filter((x) => !trait(id)?.excludes?.includes(x)), id]));
  const kit = perksOf(choice).kit;
  const card = (on: boolean) => ({
    padding: u(2.5), cursor: "pointer", background: on ? "rgba(70,90,50,0.8)" : "rgba(0,0,0,0.55)",
    border: `${u(0.75)} solid ${on ? "#b0d080" : "#444"}`,
  });
  return (
    <MenuFrame title="Who were you?" width={340}>
      <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }}>
        The morning after the county was sealed, you wake in your own house. Before you step outside: what did you do, and what are you like?
      </div>
      <div style={{ fontSize: u(6.5) }}>Occupation</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${u(100)}, 1fr))`, gap: u(2) }}>
        {OCCUPATIONS.map((o) => (
          <div key={o.id} data-testid={`job-${o.id}`} onClick={() => setJob(o.id)} style={card(o.id === job)}>
            <div style={{ fontSize: u(6), display: "flex", justifyContent: "space-between" }}>
              <span>{o.name}</span><span style={{ color: o.points > 0 ? "#a0e080" : o.points < 0 ? "#ff9080" : "#ccc" }}>{o.points > 0 ? `+${o.points}` : o.points}</span>
            </div>
            <div className="bc-sub" style={{ fontSize: u(4.8), lineHeight: 1.35 }}>{o.about}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: u(6.5), display: "flex", justifyContent: "space-between" }}>
        <span>Traits</span>
        <span data-testid="survivor-points" style={{ color: left < 0 ? "#ff7070" : "#e0e0a0" }}>{left} points left</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${u(100)}, 1fr))`, gap: u(2) }}>
        {TRAITS.map((t) => (
          <div key={t.id} data-testid={`trait-${t.id}`} onClick={() => toggle(t.id)} style={card(traits.includes(t.id))}>
            <div style={{ fontSize: u(6), display: "flex", justifyContent: "space-between" }}>
              <span>{t.name}</span>
              {/* A good trait costs points; a bad one gives them back. */}
              <span style={{ color: t.cost > 0 ? "#ff9080" : "#a0e080" }}>{t.cost > 0 ? `−${t.cost}` : `+${-t.cost}`}</span>
            </div>
            <div className="bc-sub" style={{ fontSize: u(4.8), lineHeight: 1.35 }}>{t.about}</div>
          </div>
        ))}
      </div>
      {kit.length > 0 && (
        <div className="bc-sub" style={{ textAlign: "center" }}>
          On you: {kit.map(([name, n]) => `${n > 1 ? `${n} × ` : ""}${name.replace(/_/g, " ")}`).join(", ")}
        </div>
      )}
      {(note ?? why) && <div className="bc-sub" style={{ color: "#ffb070", textAlign: "center" }}>{note ?? why}</div>}
      <Button wide disabled={!!why} onClick={() => setNote(game.chooseSurvivor(choice))}>
        <span data-testid="survivor-confirm">{why ? "Not yet" : `Wake up as ${occupation(job)?.name.toLowerCase() === "unemployed" ? "yourself" : `a ${occupation(job)?.name.toLowerCase()}`}`}</span>
      </Button>
    </MenuFrame>
  );
}
