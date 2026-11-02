/**
 * The poem and credits after the dragon: two voices talking about the player
 * over a field of stars, then the names of what made the game, scrolling up
 * the screen the first time a player comes home from the End.
 *
 * The words are this game's own. The idea — that the end of the fight is a
 * conversation about the one who fought it — is the genre's, and a good one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { GAME_NAME } from "../edition";
import { MODS } from "../engine/mods";

type Line = { voice: "gold" | "violet" | "credit" | "title" | "gap"; text: string };

const VOICE_COLOR = { gold: "#ffd966", violet: "#c9a0ff", credit: "#dddddd", title: "#ffffff", gap: "#000" } as const;

function poem(name: string): Line[] {
  const g = (text: string): Line => ({ voice: "gold", text });
  const v = (text: string): Line => ({ voice: "violet", text });
  return [
    g("I see the player you mean."),
    v(`${name}? The one who came back through the stars?`),
    g("Yes. The dragon is still. The island is quiet."),
    v("They did not know, at the start, that there would be an end."),
    g("At the start there was only a tree, and a pair of empty hands."),
    v("And the first night. Do you remember the first night?"),
    g("They dug into a hill and waited for the sun, listening to things that were not there."),
    v("And to some things that were."),
    g("They learned that wood becomes a table, and a table becomes a pickaxe, and a pickaxe becomes a way down."),
    v("They learned that the dark is only the world before a torch."),
    g("They went deeper than the sky is tall. They found red stone that remembers, and diamonds that do not."),
    v("They lit a fire in a frame of obsidian and walked into a world that was burning."),
    g("And they came back. That is the part that matters. They always came back."),
    v("With blaze rods and pearls, and a plan they had not told anyone."),
    g("Twelve eyes in a ring. A dark pool in the ground. A fall into the end of the world."),
    v("Were they afraid?"),
    g("Yes. That is how we knew they were brave."),
    v("And now?"),
    g("Now the portal is open, and home is on the other side of it."),
    v("Will they stay there?"),
    g("No. They will build. A house, and then a better house. A farm, a road, a bridge to nowhere, just to see it standing."),
    v("A world is not a thing to be finished."),
    g("No. It is a thing to be lived in."),
    v("Should we tell them that none of this was a test?"),
    g("They already know. Every block they placed was a word. Every world they made was a story about who they could be."),
    v("And who can they be?"),
    g("Anyone. That is the gift of a world made of blocks: nothing in it is fixed, least of all the one who plays."),
    v(`${name}.`),
    g(`${name}. You walked through the end, and found a beginning.`),
    v("Wake up now."),
    g("The sun is coming up over the world you made."),
    v("It is waiting for you."),
  ];
}

function credits(): Line[] {
  const c = (text: string): Line => ({ voice: "credit", text });
  const gap: Line = { voice: "gap", text: "" };
  return [
    gap, gap,
    { voice: "title", text: GAME_NAME.toUpperCase() },
    c("Made for Collin"),
    gap,
    c("Every block, creature, sound and star in it is painted and played by code."),
    c("Built inside SAS-JACKY, and free to take home."),
    gap,
    { voice: "title", text: "With thanks to the modding community" },
    c("whose ideas this game borrowed, in its own words and art:"),
    ...MODS.map((m) => c(`${m.inspiredBy} — ${m.name}`)),
    gap,
    c("Inspired by Minecraft, by Mojang Studios."),
    c(`${GAME_NAME} is an original game, and is not affiliated with Mojang or Microsoft.`),
    gap, gap,
    { voice: "title", text: "Thank you for playing." },
  ];
}

export function EndPoem({ name, onDone }: { name: string; onDone: () => void }) {
  const lines = useMemo(() => [...poem(name || "Player"), ...credits()], [name]);
  const [skippable, setSkippable] = useState(false);
  const done = useRef(false);
  const finish = () => { if (!done.current) { done.current = true; onDone(); } };
  useEffect(() => {
    const t = setTimeout(() => setSkippable(true), 2500);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); finish(); } };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  });
  // About two and a half seconds a line: slow enough to read, not so slow it drags.
  const seconds = Math.round(lines.length * 2.6);
  const stars = useMemo(() => Array.from({ length: 140 }, () => [Math.random() * 100, Math.random() * 100, Math.random() * 1.6 + 0.4]), []);
  return (
    <div className="absolute inset-0 pointer-events-auto" style={{ background: "#03020a", overflow: "hidden", zIndex: 20 }}>
      <style>{`@keyframes bc-poem { from { transform: translateY(100vh); } to { transform: translateY(-100%); } }`}</style>
      {stars.map(([x, y, s], i) => (
        <div key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: s, height: s, background: "#fff", opacity: 0.35 + s / 4, borderRadius: "50%" }} />
      ))}
      <div
        onAnimationEnd={finish}
        style={{
          position: "absolute", left: 0, right: 0, margin: "0 auto", width: "min(90vw, calc(var(--u) * 260))",
          animation: `bc-poem ${seconds}s linear forwards`, textAlign: "center", lineHeight: 1.7,
        }}
      >
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              color: VOICE_COLOR[l.voice], minHeight: "calc(var(--u) * 9)", marginBottom: "calc(var(--u) * 5)",
              fontSize: l.voice === "title" ? "calc(var(--u) * 10)" : "calc(var(--u) * 7)", fontWeight: l.voice === "title" ? 900 : 400,
              textShadow: "0 0 calc(var(--u) * 2) rgba(0,0,0,0.9)",
            }}
          >
            {l.text}
          </div>
        ))}
      </div>
      {skippable && (
        <button
          type="button" className="bc-btn" onClick={finish}
          style={{ position: "absolute", right: "calc(var(--u) * 6)", bottom: "calc(var(--u) * 6)", minHeight: "calc(var(--u) * 16)" }}
        >
          Skip ▸
        </button>
      )}
    </div>
  );
}
