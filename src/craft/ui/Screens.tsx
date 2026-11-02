import { useMemo, useState, type ReactNode } from "react";
import { allRecipes, canAfford, recipeResult, type Recipe } from "../engine/crafting";
import { allItems, itemDef, itemId, type Category, type ItemStack } from "../engine/items";
import { B } from "../engine/blocks";
import { BREW_TICKS, BREWS_PER_FUEL } from "../engine/brewing";
import { enchantedBook, enchantLabel, ENCHANTMENTS, MAX_SHELVES } from "../engine/enchanting";
import type { Slot } from "../engine/inventory";
import type { Game } from "../game/game";
import {
  anvilView, brewingView, chestView, clickContainer, cookView, smithingView, sortContainer, craftOutput, craftLockedBy, craftWidth, creativeTake, creativeTrash, dropCursor, enchantItem,
  enchantOffers, fillRecipe, furnaceView, inventoryCounts, makeTrade, tradingWith, type Section,
} from "../game/containers";
import { canAfford as canAffordOffer, LEVEL_NAMES, LEVEL_XP } from "../engine/trading";
import { boxRegions, skin } from "../render/skins";
import { Button, CursorStack, ItemIcon, SlotButton, StackView, useTooltip } from "./common";
import { RecipeViewer } from "./RecipeViewer";

function Grid({ slots, cols, section, game, offset = 0, onHover, quick }: {
  slots: Slot[]; cols: number; section: Section; game: Game; offset?: number; onHover: (s: Slot, x: number, y: number) => void; quick: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, var(--slot))` }}>
      {slots.map((s, i) => (
        <SlotButton key={i} stack={s} onHover={onHover} quickMove={quick}
          onClick={(b, shift) => clickContainer(game, section, i + offset, b, shift)} />
      ))}
    </div>
  );
}

function PlayerSlots({ game, onHover, quick }: { game: Game; onHover: (s: Slot, x: number, y: number) => void; quick: boolean }) {
  const inv = game.player.inventory;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 4)" }}>
      <Grid slots={inv.slots.slice(9, 36)} cols={9} section="inv" offset={9} game={game} onHover={onHover} quick={quick} />
      <Grid slots={inv.slots.slice(0, 9)} cols={9} section="inv" offset={0} game={game} onHover={onHover} quick={quick} />
    </div>
  );
}

/** Whether the recipe viewer is open, remembered from screen to screen for the session; open by default where there is room. */
let viewerPref: boolean | null = null;

/** The shared frame: a centred panel, a click-outside-to-drop backdrop, tooltip and cursor stack. */
function Frame({ game, title, children, side, mobile, quick, setQuick }: {
  game: Game; title: string; children: ReactNode; side?: ReactNode; mobile: boolean; quick: boolean; setQuick: (v: boolean) => void;
}) {
  const viewerAllowed = game.modOn("recipe_viewer");
  const [viewer, setViewerState] = useState(() => viewerPref ?? !mobile);
  const setViewer = (v: boolean) => { viewerPref = v; setViewerState(v); };
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) dropCursor(game, e.button === 2); }}
      onContextMenu={(e) => e.preventDefault()}>
      <div className="bc-dim" style={{ pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", gap: "calc(var(--u) * 3)", alignItems: "flex-start", maxHeight: "100%" }}>
        {side}
        <div className="bc-panel" style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 4)" }}>
          <div className="bc-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "calc(var(--u) * 4)" }}>
            <span>{title}</span>
            <span style={{ display: "flex", gap: "calc(var(--u) * 2)" }}>
              {mobile && (
                <button type="button" className="bc-btn" style={{ minHeight: "calc(var(--u) * 12)", fontSize: "calc(var(--u) * 5.5)", background: quick ? "#5c6ea8" : undefined }}
                  onClick={() => setQuick(!quick)}>⇅ Quick move</button>
              )}
              {viewerAllowed && (
                <button type="button" className="bc-btn" title="Recipe viewer" aria-label="Recipe viewer"
                  style={{ minHeight: "calc(var(--u) * 12)", fontSize: "calc(var(--u) * 5.5)", background: viewer ? "#5c6ea8" : undefined }}
                  onClick={() => setViewer(!viewer)}>🔎 Items</button>
              )}
              <button type="button" className="bc-btn" style={{ minHeight: "calc(var(--u) * 12)", fontSize: "calc(var(--u) * 6)" }} onClick={() => game.setScreen(null)} aria-label="Close">✕</button>
            </span>
          </div>
          {children}
        </div>
        {viewerAllowed && viewer && <RecipeViewer />}
      </div>
      <CursorStack stack={game.cursor} />
    </div>
  );
}

function Arrow({ progress = 0 }: { progress?: number }) {
  return (
    <div style={{ position: "relative", width: "calc(var(--u) * 22)", height: "calc(var(--u) * 15)", display: "flex", alignItems: "center" }}>
      <div style={{ fontSize: "calc(var(--u) * 14)", color: "#8b8b8b", lineHeight: 1 }}>➜</div>
      {progress > 0 && (
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, overflow: "hidden", display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: "calc(var(--u) * 14)", color: "#fff", lineHeight: 1 }}>➜</div>
        </div>
      )}
    </div>
  );
}

function CraftingArea({ game, onHover, quick }: { game: Game; onHover: (s: Slot, x: number, y: number) => void; quick: boolean }) {
  const width = craftWidth(game);
  const out = craftOutput(game);
  const locked = out ? null : craftLockedBy(game);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 4)" }}>
      <Grid slots={game.craftGrid} cols={width} section="grid" game={game} onHover={onHover} quick={quick} />
      <Arrow />
      <SlotButton stack={out?.stack ?? null} className="bc-result" onHover={onHover} quickMove={quick}
        onClick={(b, shift) => clickContainer(game, "result", 0, b, shift)} />
      {locked && <div className="bc-sub" data-testid="engram-locked" style={{ color: "#ff9a6a", maxWidth: "calc(var(--u) * 60)" }}>Learn the {locked} engram to make this.</div>}
    </div>
  );
}

function RecipeBook({ game, open }: { game: Game; open: boolean }) {
  const [onlyCraftable, setOnly] = useState(true);
  const [search, setSearch] = useState("");
  const width = craftWidth(game);
  const counts = inventoryCounts(game);
  const list = useMemo(() => {
    const seen = new Set<string>();
    return allRecipes().filter((r) => {
      if (width === 2 && !r.small) return false;
      const key = r.result.item;
      if (seen.has(key + r.id)) return false;
      seen.add(key + r.id);
      return true;
    });
  }, [width]);
  if (!open) return null;
  const q = search.trim().toLowerCase();
  const shown = list.filter((r) => (!q || itemDef(recipeResult(r).id)?.displayName.toLowerCase().includes(q)) && (!onlyCraftable || canAfford(r, counts)));
  return (
    <div className="bc-panel" style={{ width: "calc(var(--u) * 116)", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 3)", maxHeight: "calc(var(--u) * 180)" }}>
      <div className="bc-label">Recipe book</div>
      <input className="bc-input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minHeight: "calc(var(--u) * 13)" }} />
      <button type="button" className="bc-btn" style={{ minHeight: "calc(var(--u) * 12)", fontSize: "calc(var(--u) * 5.5)" }} onClick={() => setOnly(!onlyCraftable)}>
        {onlyCraftable ? "Showing craftable" : "Showing all"}
      </button>
      <div className="bc-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(5, var(--slot))", alignContent: "start", flex: 1, minHeight: 0 }}>
        {shown.map((r: Recipe) => {
          const res = recipeResult(r);
          const ok = canAfford(r, counts);
          return (
            <div key={r.id} className="bc-slot" title={itemDef(res.id)?.displayName}
              style={{ background: ok ? "#8bb88b" : "#b88b8b" }}
              onClick={(e) => { if (ok) fillRecipe(game, r, e.shiftKey); }}
              onContextMenu={(e) => { e.preventDefault(); if (ok) fillRecipe(game, r, true); }}>
              <ItemIcon id={res.id} />
              {res.count > 1 && <span className="bc-count">{res.count}</span>}
            </div>
          );
        })}
        {!shown.length && <div className="bc-label" style={{ gridColumn: "1 / -1", fontSize: "calc(var(--u) * 5.5)" }}>{onlyCraftable ? "Nothing craftable yet — gather more materials." : "No recipes match."}</div>}
      </div>
    </div>
  );
}

const TABS: { id: Category | "search" | "survival"; label: string; icon: string }[] = [
  { id: "building", label: "Building Blocks", icon: "bricks" },
  { id: "colored", label: "Colored Blocks", icon: "cyan_wool" },
  { id: "natural", label: "Natural Blocks", icon: "grass_block" },
  { id: "functional", label: "Functional Blocks", icon: "crafting_table" },
  { id: "redstone", label: "Redstone Blocks", icon: "redstone" },
  { id: "tools", label: "Tools & Utilities", icon: "iron_pickaxe" },
  { id: "combat", label: "Combat", icon: "diamond_sword" },
  { id: "food", label: "Food & Drinks", icon: "cooked_beef" },
  { id: "ingredients", label: "Ingredients", icon: "iron_ingot" },
  { id: "search", label: "Search", icon: "compass" },
  { id: "survival", label: "Survival Inventory", icon: "chest" },
];

function CreativeInventory({ game, onHover, mobile }: { game: Game; onHover: (s: Slot, x: number, y: number) => void; mobile: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("building");
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState(false);
  const inv = game.player.inventory;
  const items = useMemo((): ItemStack[] => {
    const all = allItems().filter((i) => !i.hidden);
    // One enchanted book per enchantment, at its highest level, as the original's creative menu lists them.
    const books = ENCHANTMENTS.map((e) => enchantedBook(e.name, e.maxLevel));
    if (tab === "search") {
      const q = search.trim().toLowerCase();
      return [
        ...all.filter((i) => !q || i.displayName.toLowerCase().includes(q) || i.name.includes(q)).map((d) => ({ id: d.id, count: 1 })),
        ...(q ? books.filter((b) => Object.keys(b.ench!).some((n) => enchantLabel(n, 1).toLowerCase().includes(q) || "enchanted book".includes(q))) : []),
      ];
    }
    return [...all.filter((i) => i.category === tab).map((d) => ({ id: d.id, count: 1 })), ...(tab === "ingredients" ? books : [])];
  }, [tab, search]);
  const tabIcon = (name: string) => {
    const def = allItems().find((i) => i.name === name);
    return def ? <ItemIcon id={def.id} /> : <span style={{ fontSize: "calc(var(--u) * 9)" }}>🔍</span>;
  };
  return (
    <Frame game={game} title={TABS.find((t) => t.id === tab)?.label ?? ""} mobile={mobile} quick={quick} setQuick={setQuick}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--u) * 1)", maxWidth: "calc(var(--slot) * 9)" }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" title={t.label} className="bc-slot" onClick={() => setTab(t.id)}
            style={{ background: tab === t.id ? "#c6c6c6" : "#8b8b8b" }}>{tabIcon(t.icon)}</button>
        ))}
      </div>
      {tab === "survival" ? (
        <SurvivalBody game={game} onHover={onHover} quick={quick} creative />
      ) : (
        <>
          {tab === "search" && <input autoFocus={!mobile} className="bc-input" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />}
          <div className="bc-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(9, var(--slot))", maxHeight: "calc(var(--slot) * 5)", alignContent: "start" }}>
            {items.map((d, i) => (
              <SlotButton key={`${d.id}:${i}`} stack={d} onHover={onHover}
                onClick={(b, shift) => creativeTake(game, d.id, b, shift || quick, d)} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 3)" }}>
            <Grid slots={inv.slots.slice(0, 9)} cols={9} section="inv" game={game} onHover={onHover} quick={false} />
            <div className="bc-slot" title="Destroy item" onClick={() => creativeTrash(game)} style={{ background: "#b85c5c" }}>🗑</div>
          </div>
        </>
      )}
    </Frame>
  );
}

/** The player's own skin, front on — the flat cousin of the turning model in the original's inventory. */
function PlayerPreview({ variant }: { variant: number }) {
  const url = useMemo(() => {
    const src = skin("player", variant);
    const c = document.createElement("canvas");
    c.width = 16; c.height = 32;
    const g = c.getContext("2d");
    if (!g) return null;
    const head = boxRegions(0, 0, 8, 8, 8).front, body = boxRegions(16, 16, 8, 12, 4).front;
    const arm = boxRegions(40, 16, 4, 12, 4).front, leg = boxRegions(0, 16, 4, 12, 4).front;
    const put = (r: { x: number; y: number; w: number; h: number }, x: number, y: number, mirror = false) => {
      g.save();
      if (mirror) { g.translate(x + r.w, y); g.scale(-1, 1); g.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); }
      else g.drawImage(src, r.x, r.y, r.w, r.h, x, y, r.w, r.h);
      g.restore();
    };
    put(head, 4, 0); put(body, 4, 8); put(arm, 0, 8); put(arm, 12, 8, true); put(leg, 4, 20); put(leg, 8, 20, true);
    return c.toDataURL();
  }, [variant]);
  if (!url) return null;
  return <img src={url} alt="" style={{ height: "calc(var(--u) * 52)", imageRendering: "pixelated" }} draggable={false} />;
}

function SurvivalBody({ game, onHover, quick, creative }: { game: Game; onHover: (s: Slot, x: number, y: number) => void; quick: boolean; creative?: boolean }) {
  const inv = game.player.inventory;
  const ARMOR_GHOST = ["iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots"].map((n) => allItems().find((i) => i.name === n)!.id);
  return (
    <>
      <div style={{ display: "flex", gap: "calc(var(--u) * 6)", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {inv.armor.map((s, i) => (
            <SlotButton key={i} stack={s} ghost={ARMOR_GHOST[i]} onHover={onHover} quickMove={quick}
              onClick={(b, shift) => clickContainer(game, "armor", i, b, shift)} />
          ))}
        </div>
        <div style={{ width: "calc(var(--u) * 44)", height: "calc(var(--slot) * 4)", background: "#000", border: "calc(var(--u) * 1) solid #373737", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: "calc(var(--u) * 2)", color: "#aaa", fontSize: "calc(var(--u) * 5)", padding: "calc(var(--u) * 2)" }}>
          <PlayerPreview variant={game.settings.skin} />
          {game.player.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignSelf: "stretch" }}>
          <SlotButton stack={inv.offhand} onHover={onHover} onClick={(b, shift) => clickContainer(game, "offhand", 0, b, shift)} />
        </div>
        {!creative && (
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
            <div className="bc-label">Crafting</div>
            <CraftingArea game={game} onHover={onHover} quick={quick} />
          </div>
        )}
      </div>
      <PlayerSlots game={game} onHover={onHover} quick={quick} />
    </>
  );
}

export function InventoryScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [book, setBook] = useState(mobile);
  const [quick, setQuick] = useState(false);
  if (game.player.gameMode === "creative") return <>{tip}<CreativeInventory game={game} onHover={onHover} mobile={mobile} /></>;
  return (
    <>
      <Frame game={game} title="Inventory" mobile={mobile} quick={quick} setQuick={setQuick} side={<RecipeBook game={game} open={book} />}>
        <SurvivalBody game={game} onHover={onHover} quick={quick} />
        <div style={{ display: "flex", gap: "calc(var(--u) * 2)" }}>
          <Button onClick={() => setBook(!book)}>📖 {book ? "Hide" : "Show"} recipe book</Button>
          {game.modOn("inventory_sort") && <SortButton onClick={() => sortContainer(game, "inv")} label="Sort inventory" />}
          {game.engramsOn() && <Button onClick={() => game.setScreen({ kind: "engrams", from: "inventory" })}>Engrams…</Button>}
        </div>
      </Frame>
      {tip}
    </>
  );
}

export function CraftingScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [book, setBook] = useState(true);
  const [quick, setQuick] = useState(false);
  return (
    <>
      <Frame game={game} title="Crafting" mobile={mobile} quick={quick} setQuick={setQuick} side={<RecipeBook game={game} open={book} />}>
        <CraftingArea game={game} onHover={onHover} quick={quick} />
        <Button onClick={() => setBook(!book)}>📖 {book ? "Hide" : "Show"} recipe book</Button>
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

export function FurnaceScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const f = furnaceView(game);
  if (!f) return null;
  const burn = f.burnTotal ? f.burn / f.burnTotal : 0;
  return (
    <>
      <Frame game={game} title="Furnace" mobile={mobile} quick={quick} setQuick={setQuick}>
        <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 8)", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
            <SlotButton stack={f.input} onHover={onHover} quickMove={quick} onClick={(b, s) => clickContainer(game, "furnace", 0, b, s)} />
            <div style={{ width: "calc(var(--u) * 14)", height: "calc(var(--u) * 14)", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div style={{ fontSize: "calc(var(--u) * 12)", lineHeight: 1, opacity: 0.25 }}>🔥</div>
              {burn > 0 && <div style={{ position: "absolute", bottom: 0, height: `${burn * 100}%`, overflow: "hidden", display: "flex", alignItems: "flex-end" }}><div style={{ fontSize: "calc(var(--u) * 12)", lineHeight: 1 }}>🔥</div></div>}
            </div>
            <SlotButton stack={f.fuel} onHover={onHover} quickMove={quick} onClick={(b, s) => clickContainer(game, "furnace", 1, b, s)} />
          </div>
          <Arrow progress={f.cook / 200} />
          <SlotButton stack={f.output} onHover={onHover} quickMove={quick} onClick={(b, s) => clickContainer(game, "furnace", 2, b, s)} />
        </div>
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

export function ChestScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const chest = chestView(game);
  if (!chest) return null;
  const s = game.screen;
  const blockId = s && s.kind === "chest" ? game.world.blockAt(s.x, s.y, s.z) : B.CHEST;
  // The same screen serves chests (27), hoppers (a row of 5) and dispensers and droppers (3×3), and an open backpack.
  const title = s?.kind === "backpack" ? (game.player.inventory.slots[s.slot]?.name ?? "Backpack")
    : blockId === B.HOPPER ? "Item Hopper" : blockId === B.DISPENSER ? "Dispenser" : blockId === B.DROPPER ? "Dropper"
    : blockId === B.SHULKER_BOX ? "Shulker Box" : blockId === B.BARREL ? "Barrel" : "Chest";
  const cols = chest.items.length === 9 ? 3 : chest.items.length === 5 ? 5 : 9;
  const sortable = game.modOn("inventory_sort") && chest.items.length >= 9;
  return (
    <>
      <Frame game={game} title={title} mobile={mobile} quick={quick} setQuick={setQuick}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Grid slots={chest.items} cols={cols} section="chest" game={game} onHover={onHover} quick={quick} />
        </div>
        <div className="bc-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Inventory</span>
          {sortable && (
            <span style={{ display: "flex", gap: "calc(var(--u) * 2)" }}>
              <SortButton onClick={() => sortContainer(game, "chest")} label="Sort chest" />
              <SortButton onClick={() => sortContainer(game, "inv")} label="Sort inventory" />
            </span>
          )}
        </div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

/** Sorting (after Inventory Profiles): like stacks merged, then kinds together. */
function SortButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="bc-btn" title={label} aria-label={label} onClick={onClick}
      style={{ minHeight: "calc(var(--u) * 11)", fontSize: "calc(var(--u) * 5)", padding: "0 calc(var(--u) * 3)" }}>
      ⇅ {label.replace(/^Sort /, "")}
    </button>
  );
}

/** The enchanting table: an item and lapis in, three offers out, each costing levels and lapis. */
export function EnchantingScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const view = enchantOffers(game);
  if (!view) return null;
  const p = game.player;
  // The table's script: decorative, as in the original. Kept to single code units so indexing never splits a character.
  const runes = "ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ꖌꖎᒲリ!¡ᑑ∷ᓭℸ⚍⍊∴";
  const runic = (seed: number) => Array.from({ length: 10 }, (_, i) => runes[(seed * 31 + i * 17) % runes.length]).join("");
  return (
    <>
      <Frame game={game} title="Enchant" mobile={mobile} quick={quick} setQuick={setQuick}>
        <div style={{ display: "flex", gap: "calc(var(--u) * 6)", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
            <div style={{ display: "flex", gap: "calc(var(--u) * 2)" }}>
              <SlotButton stack={game.craftGrid[0]} onHover={onHover} quickMove={quick} ghost={itemId("book")}
                onClick={(b, sh) => clickContainer(game, "work", 0, b, sh)} />
              <SlotButton stack={game.craftGrid[1]} onHover={onHover} quickMove={quick} ghost={itemId("lapis_lazuli")}
                onClick={(b, sh) => clickContainer(game, "work", 1, b, sh)} />
            </div>
            <div className="bc-label" style={{ fontSize: "calc(var(--u) * 5)" }}>📚 {view.shelves}/{MAX_SHELVES}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 1)" }}>
            {[0, 1, 2].map((slot) => {
              const o = view.offers[slot];
              const label = o?.clue ? `${enchantLabel(o.clue[0], o.clue[1])} . . . ?` : "";
              return (
                <button key={slot} type="button" className="bc-offer" disabled={!o?.affordable}
                  title={o?.clue ? `${label}\n${o.cost} Lapis Lazuli, ${o.cost} Enchantment Level${o.cost > 1 ? "s" : ""}` : undefined}
                  onClick={() => enchantItem(game, slot)}>
                  <span style={{ minWidth: "calc(var(--u) * 8)", color: "#8fd8ff" }}>{o?.clue ? "💎".repeat(o.cost) : ""}</span>
                  <span className="bc-rune">{o?.clue ? (mobile ? label : `${runic(p.enchantSeed + slot)} · ${label}`) : ""}</span>
                  <span className="lvl">{o?.clue ? o.level : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
        {p.survivalLike && <div className="bc-label" style={{ fontSize: "calc(var(--u) * 5)" }}>Your level: {p.xpLevel}</div>}
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

/** The anvil: combine, repair and rename, at a cost in levels. */
export function AnvilScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const left = game.craftGrid[0];
  const view = anvilView(game);
  const name = game.anvilName ?? (left ? left.name ?? itemDef(left.id)?.displayName ?? "" : "");
  const cost = view
    ? view.tooExpensive
      ? { text: "Too Expensive!", color: "#ff6060" }
      : { text: `Enchantment Cost: ${view.cost}`, color: view.affordable ? "#80ff20" : "#ff6060" }
    : null;
  return (
    <>
      <Frame game={game} title="Repair & Name" mobile={mobile} quick={quick} setQuick={setQuick}>
        <input className="bc-input" value={name} disabled={!left} maxLength={35} placeholder="Name"
          onChange={(e) => { game.anvilName = e.target.value; game.bumpInv(); }}
          onKeyDown={(e) => e.stopPropagation()} />
        <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 4)", justifyContent: "center" }}>
          <SlotButton stack={left} onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "work", 0, b, sh)} />
          <span style={{ fontSize: "calc(var(--u) * 10)", color: "#555" }}>+</span>
          <SlotButton stack={game.craftGrid[1]} onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "work", 1, b, sh)} />
          <Arrow />
          <SlotButton stack={view?.stack ?? null} className="bc-result" onHover={onHover} quickMove={quick}
            onClick={(b, sh) => clickContainer(game, "anvil_out", 0, b, sh)} />
        </div>
        {cost && <div style={{ color: cost.color, fontSize: "calc(var(--u) * 6)", textAlign: "right" }}>{cost.text}</div>}
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

/** The smithing table: diamond gear and a netherite ingot in, netherite gear out. */
export function SmithingScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const out = smithingView(game);
  const [base, ingot] = [game.craftGrid[0], game.craftGrid[1]];
  const hint = !base ? "Put in a diamond tool, weapon or piece of armour" : !ingot ? "Add a netherite ingot" : !out ? "Only diamond gear takes netherite" : null;
  return (
    <>
      <Frame game={game} title="Upgrade Gear" mobile={mobile} quick={quick} setQuick={setQuick}>
        <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 4)", justifyContent: "center" }}>
          <SlotButton stack={base} onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "work", 0, b, sh)} />
          <span style={{ fontSize: "calc(var(--u) * 10)", color: "#555" }}>+</span>
          <SlotButton stack={ingot} onHover={onHover} quickMove={quick} ghost={itemId("netherite_ingot")} onClick={(b, sh) => clickContainer(game, "work", 1, b, sh)} />
          <Arrow />
          <SlotButton stack={out} className="bc-result" onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "smithing_out", 0, b, sh)} />
        </div>
        {hint && <div className="bc-sub" style={{ textAlign: "center" }}>{hint}</div>}
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

/** The cooking pot: six ingredients and a bowl in, a meal out — while there is heat under it. */
export function CookingScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const { stack, heated, matched } = cookView(game);
  const hint = !heated ? "Set the pot over heat: fire, lava, a magma block or a lit furnace." : !matched ? "Put in the ingredients of a meal (the recipe viewer lists them)." : !stack ? "Add a bowl to serve it in." : null;
  return (
    <>
      <Frame game={game} title="Cooking Pot" mobile={mobile} quick={quick} setQuick={setQuick}>
        <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 4)", justifyContent: "center" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, var(--slot))" }}>
            {game.craftGrid.slice(0, 6).map((s, i) => (
              <SlotButton key={i} stack={s} onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "work", i, b, sh)} />
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
            <SlotButton stack={game.craftGrid[6] ?? null} ghost={itemId("bowl")} onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "work", 6, b, sh)} />
            <span style={{ fontSize: "calc(var(--u) * 9)", filter: heated ? undefined : "grayscale(1) opacity(0.4)" }} title={heated ? "Heated" : "No heat"}>🔥</span>
          </div>
          <Arrow progress={stack && heated ? 1 : 0} />
          <SlotButton stack={stack} className="bc-result" onHover={onHover} quickMove={quick} onClick={(b, sh) => clickContainer(game, "pot_out", 0, b, sh)} />
        </div>
        {hint && <div className="bc-sub" style={{ textAlign: "center" }}>{hint}</div>}
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

/** The brewing stand: ingredient on top, blaze powder beside it, three bottles below. */
export function BrewingScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const e = brewingView(game);
  if (!e) return null;
  const progress = e.brew > 0 ? 1 - e.brew / BREW_TICKS : 0;
  const click = (i: number) => (b: "left" | "right", sh: boolean) => clickContainer(game, "brewing", i, b, sh);
  return (
    <>
      <Frame game={game} title="Brewing Stand" mobile={mobile} quick={quick} setQuick={setQuick}>
        <div style={{ display: "flex", justifyContent: "center", gap: "calc(var(--u) * 8)", alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
            <SlotButton stack={e.fuel} onHover={onHover} quickMove={quick} ghost={itemId("blaze_powder")} onClick={click(4)} />
            <div title="Fuel" style={{ width: "calc(var(--u) * 18)", height: "calc(var(--u) * 3)", background: "#3a2a1a" }}>
              <div style={{ width: `${(e.fuelLeft / BREWS_PER_FUEL) * 100}%`, height: "100%", background: "#f0a020" }} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "calc(var(--u) * 3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 3)" }}>
              <SlotButton stack={e.ingredient} onHover={onHover} quickMove={quick} onClick={click(3)} />
              <div title="Brewing" style={{ width: "calc(var(--u) * 4)", height: "calc(var(--u) * 18)", background: "#3a3a3a", display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: "100%", height: `${progress * 100}%`, background: "#e8e8e8" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: "calc(var(--u) * 3)" }}>
              {[0, 1, 2].map((i) => (
                <SlotButton key={i} stack={e.bottles[i]} onHover={onHover} quickMove={quick} ghost={itemId("glass_bottle")} onClick={click(i)} />
              ))}
            </div>
          </div>
        </div>
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}

/** An item in an offer: shown and explained on hover, but the whole row is what you click. */
function OfferStack({ stack, onHover }: { stack: Slot; onHover: (s: Slot, x: number, y: number) => void }) {
  return (
    <span className="bc-slot" style={{ pointerEvents: "auto" }}
      onMouseEnter={(e) => onHover(stack, e.clientX, e.clientY)} onMouseMove={(e) => onHover(stack, e.clientX, e.clientY)}
      onMouseLeave={() => onHover(null, 0, 0)}>
      <StackView stack={stack} />
    </span>
  );
}

/** Trading with a villager: its offers down the side, pay and take with a click (shift-click: as many as you can). */
export function TradeScreen({ game, mobile }: { game: Game; mobile: boolean }) {
  const { tip, onHover } = useTooltip();
  const [quick, setQuick] = useState(false);
  const v = tradingWith(game);
  if (!v) {
    // The villager died or was left behind: close rather than show a dead screen.
    queueMicrotask(() => { if (game.screen?.kind === "trade") game.setScreen(null); });
    return null;
  }
  const inv = game.player.inventory;
  const level = v.villagerLevel;
  const lo = LEVEL_XP[level - 1] ?? 0, hi = LEVEL_XP[level];
  const progress = hi === undefined ? 1 : (v.villagerXp - lo) / (hi - lo);
  const title = `${v.profession[0].toUpperCase()}${v.profession.slice(1)} — ${LEVEL_NAMES[level - 1]}`;
  return (
    <>
      <Frame game={game} title={title} mobile={mobile} quick={quick} setQuick={setQuick}>
        <div title={`${v.villagerXp} experience`} style={{ height: "calc(var(--u) * 3)", background: "#3a3a3a" }}>
          <div style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%`, height: "100%", background: "#80ff20" }} />
        </div>
        <div className="bc-scroll" style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 1)", maxHeight: "calc(var(--slot) * 4)" }}>
          {v.offers.map((o, i) => {
            const out = o.uses >= o.maxUses;
            const ok = canAffordOffer(o, (id) => inv.count(id));
            return (
              <button key={i} type="button" className="bc-offer" disabled={!ok}
                style={{ width: "100%", justifyContent: "space-between" }}
                onClick={(e) => makeTrade(game, i, e.shiftKey || quick)}
                onContextMenu={(e) => { e.preventDefault(); makeTrade(game, i, true); }}>
                <span style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
                  <OfferStack stack={o.buy} onHover={onHover} />
                  {o.buyB && <OfferStack stack={o.buyB} onHover={onHover} />}
                </span>
                <span style={{ color: out ? "#ff6060" : "#e8d8b0", fontSize: "calc(var(--u) * 7)" }}>{out ? "✕" : "➜"}</span>
                <OfferStack stack={o.sell} onHover={onHover} />
              </button>
            );
          })}
        </div>
        <div className="bc-label" style={{ fontSize: "calc(var(--u) * 5)" }}>{mobile ? "Tap to trade; Quick move trades all you can." : "Click to trade; shift-click trades all you can."}</div>
        <div className="bc-label">Inventory</div>
        <PlayerSlots game={game} onHover={onHover} quick={quick} />
      </Frame>
      {tip}
    </>
  );
}
