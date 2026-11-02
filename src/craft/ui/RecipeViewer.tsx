/**
 * The recipe viewer beside the inventory (after Just Enough Items): every
 * item in the game, searchable; click one to see how it is made, right-click
 * to see what it is used for, and click any ingredient in a recipe to follow
 * it further. What it shows comes from engine/recipeIndex.ts.
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { allItems, itemDef, type ItemStack } from "../engine/items";
import { recipesFor, usesOf, type ShownRecipe } from "../engine/recipeIndex";
import { ItemIcon } from "./common";

type Mode = "make" | "use";

const u = (n: number) => `calc(var(--u) * ${n})`;
const small = { width: u(18), height: u(18) };

/** Ticks once a second, so an ingredient that can be any of several items shows each in turn. */
function useCycle(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return n;
}

function Cell({ ids, count, tick, onPick }: { ids: number[]; count?: number; tick: number; onPick: (id: number, mode: Mode) => void }) {
  const id = ids.length ? ids[tick % ids.length] : null;
  const name = id !== null ? itemDef(id)?.displayName : undefined;
  const click = (e: MouseEvent, mode: Mode) => { e.preventDefault(); if (id !== null) onPick(id, mode); };
  return (
    <div
      className="bc-slot" title={name ? `${name}${ids.length > 1 ? " (or others)" : ""} — click: recipes, right-click: uses` : undefined}
      style={{ ...small, cursor: id !== null ? "pointer" : "default" }}
      onClick={(e) => click(e, "make")} onContextMenu={(e) => click(e, "use")}
    >
      {id !== null && <ItemIcon id={id} />}
      {count !== undefined && count > 1 && <span className="bc-count">{count}</span>}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "#555", fontSize: u(9), lineHeight: 1 }}>
      ➜{label && <span style={{ fontSize: u(4.5), color: "#3f3f3f" }}>{label}</span>}
    </div>
  );
}

function RecipeCard({ r, tick, onPick }: { r: ShownRecipe; tick: number; onPick: (id: number, mode: Mode) => void }) {
  const one = (id: number) => [id];
  const stack = (s: ItemStack) => <Cell ids={one(s.id)} count={s.count} tick={0} onPick={onPick} />;
  let body;
  let where: string;
  switch (r.kind) {
    case "crafting": {
      where = r.width === 2 && r.cells.length <= 4 ? "Crafting (any grid)" : "Crafting table";
      body = (
        <>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${r.width}, ${u(18)})` }}>
            {r.cells.map((ids, i) => <Cell key={i} ids={ids} tick={tick + i} onPick={onPick} />)}
          </div>
          <Arrow label={r.shapeless ? "any order" : undefined} />
          {stack(r.result)}
        </>
      );
      break;
    }
    case "smelting":
      where = "Furnace";
      body = <><Cell ids={r.input} tick={tick} onPick={onPick} /><Arrow label={`🔥 ${r.xp} xp`} />{stack(r.result)}</>;
      break;
    case "brewing":
      where = "Brewing stand";
      body = <><Cell ids={one(r.bottle)} tick={0} onPick={onPick} /><span style={{ color: "#555" }}>+</span><Cell ids={one(r.ingredient)} tick={0} onPick={onPick} /><Arrow />{stack(r.result)}</>;
      break;
    case "smithing":
      where = "Smithing table";
      body = <><Cell ids={one(r.base)} tick={0} onPick={onPick} /><span style={{ color: "#555" }}>+</span><Cell ids={one(r.addition)} tick={0} onPick={onPick} /><Arrow />{stack(r.result)}</>;
      break;
    case "cooking":
      where = "Cooking pot, over heat";
      body = (
        <>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${u(18)})` }}>
            {r.ingredients.map((id, i) => <Cell key={i} ids={one(id)} tick={0} onPick={onPick} />)}
          </div>
          <span style={{ color: "#555" }}>+</span>
          <Cell ids={one(r.bowl)} tick={0} onPick={onPick} />
          <Arrow />
          {stack(r.result)}
        </>
      );
      break;
    case "fuel":
      where = "Furnace fuel";
      body = <><Cell ids={one(r.item)} tick={0} onPick={onPick} /><span className="bc-label" style={{ fontSize: u(5.5) }}>Smelts {r.items % 1 ? r.items.toFixed(1) : r.items} item{r.items === 1 ? "" : "s"}</span></>;
      break;
  }
  return (
    <div style={{ background: "#b4b4b4", padding: u(2), display: "flex", flexDirection: "column", gap: u(1) }}>
      <div className="bc-label" style={{ fontSize: u(5) }}>{where}</div>
      <div style={{ display: "flex", alignItems: "center", gap: u(2) }}>{body}</div>
      {r.kind === "crafting" && r.note && <div className="bc-label" style={{ fontSize: u(4.5), lineHeight: 1.3 }}>{r.note}</div>}
    </div>
  );
}

export function RecipeViewer() {
  const [search, setSearch] = useState("");
  const [trail, setTrail] = useState<{ id: number; mode: Mode }[]>([]);
  const tick = useCycle();
  const items = useMemo(() => allItems().filter((i) => !i.hidden), []);
  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (q ? items.filter((i) => i.displayName.toLowerCase().includes(q) || i.name.includes(q)) : items), [items, q]);
  const pick = (id: number, mode: Mode) => setTrail((t) => [...t.slice(-19), { id, mode }]);
  const cur = trail[trail.length - 1];

  const panel = { width: u(122), display: "flex", flexDirection: "column" as const, gap: u(3), maxHeight: u(190) };
  if (cur) {
    const def = itemDef(cur.id);
    const makes = recipesFor(cur.id), uses = usesOf(cur.id);
    const list = cur.mode === "make" ? makes : uses;
    const setMode = (mode: Mode) => setTrail((t) => [...t.slice(0, -1), { id: cur.id, mode }]);
    return (
      <div className="bc-panel" style={panel} data-testid="recipe-viewer">
        <div style={{ display: "flex", alignItems: "center", gap: u(2) }}>
          <button type="button" className="bc-btn" style={{ minHeight: u(12), fontSize: u(5.5) }} onClick={() => setTrail((t) => t.slice(0, -1))}>◀</button>
          <ItemIcon id={cur.id} />
          <div className="bc-label" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def?.displayName}</div>
        </div>
        <div style={{ display: "flex", gap: u(1) }}>
          {(["make", "use"] as const).map((m) => (
            <button key={m} type="button" className="bc-btn" onClick={() => setMode(m)}
              style={{ flex: 1, minHeight: u(12), fontSize: u(5.5), background: cur.mode === m ? "#5c6ea8" : undefined }}>
              {m === "make" ? `Made by (${makes.length})` : `Used in (${uses.length})`}
            </button>
          ))}
        </div>
        <div className="bc-scroll" style={{ display: "flex", flexDirection: "column", gap: u(2), flex: 1, minHeight: 0 }}>
          {list.map((r) => <RecipeCard key={r.id} r={r} tick={tick} onPick={pick} />)}
          {!list.length && (
            <div className="bc-label" style={{ fontSize: u(5.5), lineHeight: 1.4 }}>
              {cur.mode === "make" ? "Not made by any recipe — it is found, mined, dropped, traded or fished." : "Not an ingredient in anything."}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="bc-panel" style={panel} data-testid="recipe-viewer">
      <div className="bc-label">Items</div>
      <input className="bc-input" placeholder="Search every item…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minHeight: u(13) }} />
      <div className="bc-label" style={{ fontSize: u(4.8) }}>Click: how to make it · right-click: what it is for</div>
      <div className="bc-scroll" style={{ display: "grid", gridTemplateColumns: `repeat(6, ${u(18)})`, alignContent: "start", flex: 1, minHeight: 0 }}>
        {shown.map((d) => (
          <div key={d.id} className="bc-slot" title={d.displayName} style={{ ...small, cursor: "pointer" }}
            onClick={() => pick(d.id, "make")} onContextMenu={(e) => { e.preventDefault(); pick(d.id, "use"); }}>
            <ItemIcon id={d.id} />
          </div>
        ))}
        {!shown.length && <div className="bc-label" style={{ gridColumn: "1 / -1", fontSize: u(5.5) }}>Nothing matches.</div>}
      </div>
    </div>
  );
}
