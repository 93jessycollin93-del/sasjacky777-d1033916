/**
 * Everything before a world is running: the title screen, the world list,
 * world creation and joining a friend.
 */
import { ensureMainWorld, isMainWorld, MAIN_WORLD_NAME, resetMainWorld } from "../game/mainWorld";
import { useEffect, useMemo, useRef, useState } from "react";
import { MODS, modEnabled } from "../engine/mods";
import { ModsList } from "./ModsScreen";
import { ModeCard, ModePicker } from "./ModePicker";
import { applyMode, modeDef, MODES, randomMode, type ModeDef } from "../modes/modes";
import { MAPS } from "../engine/maps";
import { randomSeed, seedFromString } from "../engine/rng";
import type { WorldType } from "../engine/worldgen";
import { edition, GAME_NAME, GAME_VERSION } from "../edition";
import { cloudAvailable, deleteCloudWorld, downloadWorld, listCloudWorlds, uploadWorld, type CloudWorld } from "../game/cloud";
import { newWorldMeta, type SaveStore, type WorldMeta } from "../game/save";
import { effectiveControls, type Settings } from "../game/settings";
import { normalizeLanAddress, normalizeRoomCode, type LinkKind } from "../net/transport";
import { Button, Cycle, Toggle } from "./common";
import { MenuFrame } from "./Menus";
import { textureBackground } from "./icons";

// Original lines; the yellow splash is part of the genre's charm.
const SPLASHES = [
  "Every texture painted by code!", "Plays on your phone!", "Open to friends!", "Saves itself!",
  "Twenty ticks a second!", "Punch a tree!", "Chunks all the way down!", "Mind the creepers!",
  "Sheep come in sixteen colours!", "Try hardcore!", "Beds skip the night!", "Water finds its level!",
  "Bone meal works!", "Real caves!", "Diamonds below 16!", "Creative mode flies!", "Collin approved!",
  "Survive the night!", "The dragon waits!", "Mind the shulkers!",
];
// Only where they are true: the solo copy has no Jackie, and is itself a download.
const SPLASHES_APP = ["Now with Jackie!", "Built in SAS-JACKY!", "Also try the Eru lab!", "No downloads!"];
const SPLASHES_SOLO = ["Works offline!", "No account needed!", "LAN parties!", "Yours to keep!"];

/** The tiled dirt of every menu that is not over a world. */
export function MenuBackground() {
  const url = useMemo(() => textureBackground("dirt", 0.62), []);
  return <div className="absolute inset-0" style={{ backgroundImage: `url(${url})`, backgroundSize: "calc(var(--u) * 32)", imageRendering: "pixelated" }} />;
}

export function Logo() {
  const stone = useMemo(() => textureBackground("stone", 0), []);
  const splash = useMemo(() => {
    const all = [...SPLASHES, ...(edition().kind === "sas-jacky" ? SPLASHES_APP : SPLASHES_SOLO)];
    return all[Math.floor(Math.random() * all.length)];
  }, []);
  return (
    <div style={{ position: "relative", textAlign: "center", marginBottom: "calc(var(--u) * 10)" }}>
      <div
        aria-label={GAME_NAME}
        style={{
          fontSize: "min(calc(var(--u) * 19), 7.4vw)", fontWeight: 900, letterSpacing: "0.03em", lineHeight: 1,
          backgroundImage: `url(${stone})`, backgroundSize: "calc(var(--u) * 12)", imageRendering: "pixelated",
          WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          WebkitTextStroke: "calc(var(--u) * 0.8) #1b1b1b",
          filter: "drop-shadow(calc(var(--u) * 1.5) calc(var(--u) * 1.5) 0 #000)",
        }}
      >
        {GAME_NAME.toUpperCase()}
      </div>
      <div className="bc-sub" style={{ marginTop: "calc(var(--u) * 2)", color: "#ddd" }}>{edition().tagline}</div>
      <div
        style={{
          // Hung off the logo's last letters rather than over them: the name is long. The tilt
          // lives here and the pulse on the span inside, since an animated transform replaces a static one.
          position: "absolute", right: 0, bottom: "calc(var(--u) * 3)", color: "#ffff00", fontSize: "calc(var(--u) * 7.5)",
          transform: "translateX(40%) rotate(-18deg)", whiteSpace: "nowrap",
          textShadow: "calc(var(--u) * 0.7) calc(var(--u) * 0.7) 0 #3f3f00",
        }}
      >
        <span style={{ display: "inline-block", animation: "bc-pulse 0.5s ease-in-out infinite" }}>{splash}</span>
      </div>
    </div>
  );
}

export function TitleScreen({ onMain, onSingle, onMulti, onOptions, onExit, message, settings }: {
  onMain?: () => void; onSingle: () => void; onMulti: () => void; onOptions: () => void; onExit?: () => void; message?: string; settings: Settings;
}) {
  const exitLabel = onExit ? edition().exitLabel : null;
  return (
    <>
      <MenuBackground />
      <div className="absolute inset-0 flex flex-col items-center justify-center bc-shadow" style={{ padding: "calc(var(--u) * 8)" }}>
        <Logo />
        {message && (
          <div style={{ maxWidth: "calc(var(--u) * 240)", marginBottom: "calc(var(--u) * 6)", textAlign: "center", color: "#ffcc55", fontSize: "calc(var(--u) * 6.5)", lineHeight: 1.5 }}>{message}</div>
        )}
        <div style={{ width: "min(100%, calc(var(--u) * 200))", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 4)" }}>
          {onMain && <Button wide onClick={onMain}>{`Main World: ${MAIN_WORLD_NAME}`}</Button>}
          <Button wide onClick={onSingle}>Singleplayer</Button>
          <Button wide onClick={onMulti}>Multiplayer</Button>
          <div style={{ display: "grid", gridTemplateColumns: exitLabel ? "1fr 1fr" : "1fr", gap: "calc(var(--u) * 4)" }}>
            <Button onClick={onOptions}>Options…</Button>
            {exitLabel && <Button onClick={onExit}>{exitLabel}</Button>}
          </div>
        </div>
      </div>
      <div className="absolute bc-shadow" style={{ left: "calc(var(--u) * 2)", bottom: "calc(var(--u) * 2)", fontSize: "calc(var(--u) * 5.5)", color: "#ddd" }}>
        {GAME_NAME} {GAME_VERSION} · {effectiveControls(settings) === "mobile" ? "touch controls" : "keyboard & mouse"}
      </div>
      <div className="absolute bc-shadow" style={{ right: "calc(var(--u) * 2)", bottom: "calc(var(--u) * 2)", fontSize: "calc(var(--u) * 5.5)", color: "#ddd", textAlign: "right", maxWidth: "60%" }}>
        An original game inspired by Minecraft. Not affiliated with Mojang or Microsoft.
      </div>
    </>
  );
}

const MODE_LABEL: Record<string, string> = { survival: "Survival", creative: "Creative", adventure: "Adventure", spectator: "Spectator" };

function when(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export function WorldSelect({ saves, ready, onPlay, onCreate, onBack }: {
  saves: SaveStore; ready: Promise<void>; onPlay: (meta: WorldMeta) => void; onCreate: () => void; onBack: () => void;
}) {
  const [worlds, setWorlds] = useState<WorldMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    try {
      // A world that was just quit may still be writing its last save.
      await ready.catch(() => {});
      // The main world is always there: made fresh if it is missing, and listed first.
      await ensureMainWorld(saves);
      const list = (await saves.listWorlds()).sort((a, b) => Number(isMainWorld(b)) - Number(isMainWorld(a)));
      setWorlds(list);
      setSelected((s) => (s && list.some((w) => w.id === s) ? s : list[0]?.id ?? null));
    } catch (err) {
      setWorlds([]);
      setError(`Could not read your saved worlds: ${(err as Error).message}`);
    }
  };
  // Again when `ready` changes: the world just quit hands over its final save after this list mounts.
  useEffect(() => { void reload(); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = worlds?.find((w) => w.id === selected) ?? null;
  const shown = (worlds ?? []).filter((w) => !filter || w.name.toLowerCase().includes(filter.toLowerCase()));

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(`${what}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const exportWorld = (w: WorldMeta) => run("Export failed", async () => {
    const blob = await saves.exportWorld(w.id);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${w.name.replace(/[^\w\- ]/g, "").trim() || "world"}.csc.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  const importWorld = (file: File) => run("Import failed", async () => {
    const meta = await saves.importWorld(await file.text());
    await reload();
    setSelected(meta.id);
  });

  const rename = (w: WorldMeta, name: string) => run("Rename failed", async () => {
    const clean = name.trim().slice(0, 32);
    if (!clean) return;
    await saves.putWorld({ ...w, name: clean });
    setRenaming(null);
    await reload();
  });

  const remove = (w: WorldMeta) => run(isMainWorld(w) ? "Reset failed" : "Delete failed", async () => {
    if (isMainWorld(w)) {
      await resetMainWorld(saves);
      setNotice(`${MAIN_WORLD_NAME} is back as it was on the first morning.`);
    } else await saves.deleteWorld(w.id);
    setConfirmDelete(false);
    await reload();
  });

  const upload = (w: WorldMeta) => run("Upload failed", async () => {
    const v = await uploadWorld(saves, w);
    if (!v.ok) throw new Error(v.error);
    setNotice(`"${w.name}" is saved in the cloud. Open Cloud Worlds on another device to download it.`);
  });

  if (cloud) {
    return (
      <CloudWorlds
        saves={saves}
        localIds={new Set((worlds ?? []).map((w) => w.id))}
        onBack={() => { setCloud(false); void reload(); }}
        onDownloaded={(meta) => { setCloud(false); void reload().then(() => setSelected(meta.id)); setNotice(`Downloaded "${meta.name}".`); }}
      />
    );
  }

  if (confirmDelete && sel && isMainWorld(sel)) {
    return (
      <>
        <MenuBackground />
        <MenuFrame title="Reset the main world?" dim={false}>
          <div style={{ textAlign: "center", fontSize: "calc(var(--u) * 7)", lineHeight: 1.6 }}>
            '{sel.name}' is the main world, and cannot be deleted. Resetting it puts it back exactly as it was on the first
            morning — every house shut, every cupboard full — and everything you did there is gone. Export it first to keep a copy.
          </div>
          <Button wide danger disabled={busy} onClick={() => void remove(sel)}>Reset World</Button>
          <Button wide onClick={() => setConfirmDelete(false)}>Cancel</Button>
        </MenuFrame>
      </>
    );
  }

  if (confirmDelete && sel) {
    return (
      <>
        <MenuBackground />
        <MenuFrame title="Delete this world?" dim={false}>
          <div style={{ textAlign: "center", fontSize: "calc(var(--u) * 7)", lineHeight: 1.6 }}>
            '{sel.name}' will be lost forever — a long time! Export it first if you might want it back.
          </div>
          <Button wide danger disabled={busy} onClick={() => void remove(sel)}>Delete</Button>
          <Button wide onClick={() => setConfirmDelete(false)}>Cancel</Button>
        </MenuFrame>
      </>
    );
  }

  return (
    <>
      <MenuBackground />
      <div className="absolute inset-0 flex flex-col bc-shadow" style={{ padding: "calc(var(--u) * 4)" }}>
        <div className="bc-title" style={{ textAlign: "center", marginBottom: "calc(var(--u) * 4)" }}>Select World</div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "calc(var(--u) * 4)" }}>
          <input className="bc-input" style={{ maxWidth: "calc(var(--u) * 220)" }} placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="bc-scroll" style={{ flex: 1, background: "rgba(0,0,0,0.5)", borderTop: "calc(var(--u) * 1) solid #000", borderBottom: "calc(var(--u) * 1) solid #000", padding: "calc(var(--u) * 3) 0" }}>
          <div style={{ width: "min(100%, calc(var(--u) * 240))", margin: "0 auto", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
            {worlds === null && <div className="bc-sub" style={{ textAlign: "center" }}>Loading worlds…</div>}
            {worlds?.length === 0 && (
              <div style={{ textAlign: "center", padding: "calc(var(--u) * 10)", fontSize: "calc(var(--u) * 7)", lineHeight: 1.6 }}>
                No worlds yet. Create one, or import a world you exported before.
              </div>
            )}
            {shown.map((w) => (
              <div
                key={w.id}
                className={`bc-list-item ${w.id === selected ? "sel" : ""}`}
                onClick={() => setSelected(w.id)}
                onDoubleClick={() => onPlay(w)}
              >
                <div style={{ width: "calc(var(--u) * 48)", height: "calc(var(--u) * 27)", flex: "none", background: "#222", border: "calc(var(--u) * 0.5) solid #555", overflow: "hidden" }}>
                  {w.thumbnail
                    ? <img src={w.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", backgroundImage: `url(${textureBackground("grass_block_side", 0)})`, backgroundSize: "calc(var(--u) * 27)", imageRendering: "pixelated" }} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {renaming === w.id ? (
                    <input
                      className="bc-input" autoFocus defaultValue={w.name} maxLength={32}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(w, (e.target as HTMLInputElement).value);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={(e) => void rename(w, e.target.value)}
                    />
                  ) : (
                    <div style={{ fontSize: "calc(var(--u) * 7.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isMainWorld(w) && <span data-testid="main-world-badge" style={{ color: "#ffd24a", marginRight: "calc(var(--u) * 2)" }}>★ MAIN WORLD</span>}
                      {w.name}
                    </div>
                  )}
                  <div className="bc-sub">{when(w.lastPlayed)}</div>
                  <div className="bc-sub" style={{ color: w.hardcore ? "#ff5555" : undefined }}>
                    {w.hardcore ? "Hardcore Mode!" : `${MODE_LABEL[w.gameMode] ?? w.gameMode} Mode`}{w.cheats ? ", Cheats" : ""}{modeLabel(w)} · Day {Math.floor(w.time / 24000) + 1}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {(error || saves.problem) && (
          <div style={{ textAlign: "center", color: "#ff8080", fontSize: "calc(var(--u) * 6)", margin: "calc(var(--u) * 3) auto 0", maxWidth: "calc(var(--u) * 260)" }}>{error ?? saves.problem}</div>
        )}
        {notice && !error && (
          <div style={{ textAlign: "center", color: "#aaffaa", fontSize: "calc(var(--u) * 6)", margin: "calc(var(--u) * 3) auto 0", maxWidth: "calc(var(--u) * 260)" }}>{notice}</div>
        )}
        <div style={{ width: "min(100%, calc(var(--u) * 310))", margin: "calc(var(--u) * 4) auto 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--u) * 72), 1fr))", gap: "calc(var(--u) * 3)" }}>
          <Button disabled={!sel || busy} onClick={() => sel && onPlay(sel)}>Play Selected World</Button>
          <Button disabled={busy} onClick={onCreate}>Create New World</Button>
          <Button disabled={!sel || busy || isMainWorld(sel)} onClick={() => sel && setRenaming(sel.id)}>Rename</Button>
          <Button disabled={!sel || busy} onClick={() => setConfirmDelete(true)}>{sel && isMainWorld(sel) ? "Reset…" : "Delete"}</Button>
          <Button disabled={!sel || busy} onClick={() => sel && void exportWorld(sel)}>Export…</Button>
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>Import…</Button>
          {cloudAvailable() && <Button disabled={!sel || busy} onClick={() => sel && void upload(sel)}>☁ Upload to Cloud</Button>}
          {cloudAvailable() && <Button disabled={busy} onClick={() => setCloud(true)}>☁ Cloud Worlds…</Button>}
          <Button onClick={onBack}>Cancel</Button>
        </div>
        <input
          ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importWorld(f); }}
        />
      </div>
    </>
  );
}

/** Worlds this account keeps in the cloud: download one here, or remove it. */
function CloudWorlds({ saves, localIds, onBack, onDownloaded }: {
  saves: SaveStore; localIds: Set<string>; onBack: () => void; onDownloaded: (meta: WorldMeta) => void;
}) {
  const [list, setList] = useState<CloudWorld[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"replace" | "delete" | null>(null);

  const load = async () => {
    const v = await listCloudWorlds();
    if (v.ok) { setList(v.value); setSelected((s) => s ?? v.value[0]?.id ?? null); setError(null); }
    else { setList([]); setError(v.error); }
  };
  useEffect(() => { void load(); }, []);

  const sel = list?.find((w) => w.id === selected) ?? null;

  const download = async (w: CloudWorld) => {
    setBusy(true);
    const v = await downloadWorld(saves, w.id);
    setBusy(false);
    setConfirm(null);
    if (v.ok) onDownloaded(v.value);
    else setError(v.error);
  };

  const remove = async (w: CloudWorld) => {
    setBusy(true);
    const v = await deleteCloudWorld(w.id);
    setBusy(false);
    setConfirm(null);
    if (v.ok) { setSelected(null); await load(); } else setError(v.error);
  };

  if (confirm && sel) {
    return (
      <>
        <MenuBackground />
        <MenuFrame title={confirm === "replace" ? "Replace this device's copy?" : "Remove from the cloud?"} dim={false}>
          <div style={{ textAlign: "center", fontSize: "calc(var(--u) * 7)", lineHeight: 1.6 }}>
            {confirm === "replace"
              ? `'${sel.name}' is already on this device. Downloading replaces it with the cloud copy from ${new Date(sel.updatedAt).toLocaleString()}.`
              : `The cloud copy of '${sel.name}' will be deleted. Copies on your devices stay.`}
          </div>
          <Button wide danger disabled={busy} onClick={() => void (confirm === "replace" ? download(sel) : remove(sel))}>
            {confirm === "replace" ? "Replace" : "Remove"}
          </Button>
          <Button wide onClick={() => setConfirm(null)}>Cancel</Button>
        </MenuFrame>
      </>
    );
  }

  return (
    <>
      <MenuBackground />
      <div className="absolute inset-0 flex flex-col bc-shadow" style={{ padding: "calc(var(--u) * 4)" }}>
        <div className="bc-title" style={{ textAlign: "center", marginBottom: "calc(var(--u) * 4)" }}>Cloud Worlds</div>
        <div className="bc-scroll" style={{ flex: 1, background: "rgba(0,0,0,0.5)", borderTop: "calc(var(--u) * 1) solid #000", borderBottom: "calc(var(--u) * 1) solid #000", padding: "calc(var(--u) * 3) 0" }}>
          <div style={{ width: "min(100%, calc(var(--u) * 240))", margin: "0 auto", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
            {list === null && <div className="bc-sub" style={{ textAlign: "center" }}>Asking the cloud…</div>}
            {list?.length === 0 && !error && (
              <div style={{ textAlign: "center", padding: "calc(var(--u) * 10)", fontSize: "calc(var(--u) * 7)", lineHeight: 1.6 }}>
                Nothing in the cloud yet. Select a world and choose Upload to Cloud.
              </div>
            )}
            {list?.map((w) => (
              <div key={w.id} className={`bc-list-item ${w.id === selected ? "sel" : ""}`} onClick={() => setSelected(w.id)}>
                <div style={{ width: "calc(var(--u) * 48)", height: "calc(var(--u) * 27)", flex: "none", background: "#222", border: "calc(var(--u) * 0.5) solid #555", overflow: "hidden" }}>
                  {w.summary.thumbnail && <img src={w.summary.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "calc(var(--u) * 7.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</div>
                  <div className="bc-sub">Uploaded {new Date(w.updatedAt).toLocaleString()} · {(w.summary.bytes / 1048576).toFixed(1)} MB</div>
                  <div className="bc-sub" style={{ color: w.summary.hardcore ? "#ff5555" : undefined }}>
                    {w.summary.hardcore ? "Hardcore Mode!" : `${MODE_LABEL[w.summary.gameMode] ?? w.summary.gameMode} Mode`} · Day {w.summary.day}{localIds.has(w.id) ? " · on this device" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {error && <div style={{ textAlign: "center", color: "#ff8080", fontSize: "calc(var(--u) * 6)", margin: "calc(var(--u) * 3) auto 0", maxWidth: "calc(var(--u) * 260)", lineHeight: 1.5 }}>{error}</div>}
        <div style={{ width: "min(100%, calc(var(--u) * 240))", margin: "calc(var(--u) * 4) auto 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(calc(var(--u) * 72), 1fr))", gap: "calc(var(--u) * 3)" }}>
          <Button disabled={!sel || busy} onClick={() => sel && (localIds.has(sel.id) ? setConfirm("replace") : void download(sel))}>{busy ? "Working…" : "Download"}</Button>
          <Button disabled={!sel || busy} onClick={() => setConfirm("delete")}>Remove from Cloud</Button>
          <Button onClick={onBack}>Back</Button>
        </div>
      </div>
    </>
  );
}

const WORLD_TYPES: WorldType[] = ["default", "amplified", "large_biomes", "flat"];
const TYPE_LABEL: Record<WorldType, string> = { default: "Default", amplified: "Amplified", large_biomes: "Large Biomes", flat: "Superflat" };
const DIFFICULTY_LABEL = ["Peaceful", "Easy", "Normal", "Hard"];

export function CreateWorld({ saves, existing, onCreate, onBack }: {
  saves: SaveStore; existing: string[]; onCreate: (meta: WorldMeta) => void; onBack: () => void;
}) {
  const [name, setName] = useState(() => uniqueName("New World", existing));
  const [modeId, setModeId] = useState("survival");
  const [picking, setPicking] = useState(false);
  const [difficulty, setDifficulty] = useState<0 | 1 | 2 | 3>(2);
  const [type, setType] = useState<WorldType>("default");
  const [seedText, setSeedText] = useState("");
  const [cheats, setCheats] = useState(false);
  const [more, setMore] = useState(false);
  const [mods, setMods] = useState(false);
  const [disabledMods, setDisabledMods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const def = modeDef(modeId) ?? MODES[0];
  const hardcore = !!def.hardcore;
  const pick = (d: ModeDef) => {
    setModeId(d.id);
    setDifficulty(d.difficulty ?? 2);
    setCheats(!!d.cheats);
    if (d.type) setType(d.type);
    setPicking(false);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = seedText.trim();
      const seed = !text ? randomSeed() : /^-?\d+$/.test(text) ? Number(BigInt.asIntN(32, BigInt(text))) : seedFromString(text);
      const meta = newWorldMeta({
        name: name.trim().slice(0, 32) || "New World",
        seed, seedText: text || String(seed), type, gameMode: def.gameMode,
        difficulty: hardcore ? 3 : difficulty, hardcore, cheats: hardcore ? false : cheats,
      });
      applyMode(meta, def);
      if (disabledMods.length) meta.disabledMods = [...disabledMods];
      await saves.putWorld(meta);
      onCreate(meta);
    } catch (err) {
      setError(`Could not create the world: ${(err as Error).message}`);
      setBusy(false);
    }
  };

  if (picking) {
    return (
      <>
        <MenuBackground />
        <MenuFrame title="Choose a Game Mode" width={330} dim={false}>
          <ModePicker value={modeId} onChange={pick} />
          <Button wide onClick={() => setPicking(false)}>Back</Button>
        </MenuFrame>
      </>
    );
  }

  return (
    <>
      <MenuBackground />
      <MenuFrame title="Create New World" width={220} dim={false}>
        <label style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
          <span className="bc-sub">World Name</span>
          <input className="bc-input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
        </label>
        <ModeCard def={def} selected />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "calc(var(--u) * 4)" }}>
          <Button onClick={() => setPicking(true)}>Game Mode…</Button>
          <Button onClick={() => pick(randomMode(Math.random))}>Random!</Button>
        </div>
        {!hardcore && (
          <Cycle<number> label="Difficulty" value={difficulty} options={[0, 1, 2, 3]} onChange={(v) => setDifficulty(v as 0 | 1 | 2 | 3)} format={(v) => DIFFICULTY_LABEL[v]} />
        )}
        {!hardcore && <Toggle label="Allow Cheats" value={cheats} onChange={setCheats} />}
        <Button wide onClick={() => setMore(!more)}>{more ? "Fewer World Options" : "More World Options…"}</Button>
        {more && (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
              <span className="bc-sub">Seed for the world generator (leave blank for a random seed)</span>
              <input className="bc-input" value={seedText} maxLength={48} onChange={(e) => setSeedText(e.target.value)} />
            </label>
            {def.map
              ? <div className="bc-sub" style={{ textAlign: "center" }}>Map pack: {MAPS[def.map].name}</div>
              : <Cycle<WorldType> label="World Type" value={type} options={WORLD_TYPES} onChange={setType} format={(v) => TYPE_LABEL[v]} />}
          </>
        )}
        <Button wide onClick={() => setMods(!mods)}>{mods ? "Hide Mods" : `Mods… (${MODS.filter((m) => modEnabled(disabledMods, m.id)).length} of ${MODS.length} on)`}</Button>
        {mods && <ModsList disabled={disabledMods} onChange={setDisabledMods} />}
        {error && <div style={{ color: "#ff8080", fontSize: "calc(var(--u) * 6)", textAlign: "center" }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "calc(var(--u) * 4)" }}>
          <Button disabled={busy} onClick={() => void create()}>Create New World</Button>
          <Button onClick={onBack}>Cancel</Button>
        </div>
      </MenuFrame>
    </>
  );
}

/** A world made for a mode says which, unless the mode is only its game mode by another name. */
function modeLabel(w: WorldMeta): string {
  const d = modeDef(w.mode?.id);
  return d && d.category !== "classic" ? ` · ${d.name}` : "";
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} (${i})`)) return `${base} (${i})`;
}

export function MultiplayerScreen({ settings, onSettings, onJoin, onBack, busy, error }: {
  settings: Settings; onSettings: (s: Settings) => void; onJoin: (kind: LinkKind, room: string, address?: string) => void;
  onBack: () => void; busy: boolean; error: string | null;
}) {
  const e = edition();
  // Only the links this copy can make: the solo copy has no online server, a desktop window has no tabs.
  const kinds = ([e.online && "online", e.lanJoin && "lan", e.device && "device"] as const).filter((k): k is LinkKind => !!k);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<LinkKind>(kinds[0] ?? "device");
  const [addressText, setAddressText] = useState(() => {
    try { return localStorage.getItem("blockcraft.lan.address") ?? ""; } catch { return ""; }
  });
  const room = normalizeRoomCode(code);
  const address = kind === "lan" ? normalizeLanAddress(addressText) : undefined;
  const ready = room.length >= 4 && address !== null && !busy;
  const join = () => {
    if (!ready) return;
    if (address) try { localStorage.setItem("blockcraft.lan.address", addressText.trim()); } catch { /* remembered only as a convenience */ }
    onJoin(kind, room, address);
  };
  const LABEL: Record<LinkKind, string> = { online: "Online (any device)", lan: "LAN (same network)", device: "Tabs on this device" };
  return (
    <>
      <MenuBackground />
      <MenuFrame title="Play Multiplayer" width={230} dim={false}>
        <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.6 }}>
          A friend opens their world from the game menu (Esc → Open to friends) and reads you the {kind === "lan" ? "address and code" : "code"} it shows.
        </div>
        {kinds.length > 1 && <Cycle<LinkKind> label="Connect" value={kind} options={kinds} onChange={setKind} format={(v) => LABEL[v]} />}
        {kind === "lan" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
            <span className="bc-sub">Host address</span>
            <input
              className="bc-input" value={addressText} placeholder="e.g. 192.168.1.20:25580" maxLength={64} autoComplete="off"
              onChange={(ev) => setAddressText(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") join(); }}
            />
            {addressText.trim() && address === null && <span className="bc-sub" style={{ color: "#ff8080" }}>That is not an address — it looks like 192.168.1.20:25580.</span>}
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
          <span className="bc-sub">World code</span>
          <input
            className="bc-input" value={code} placeholder="e.g. K7QM3X" maxLength={16} autoCapitalize="characters" autoComplete="off"
            style={{ letterSpacing: "0.2em", textTransform: "uppercase" }}
            onChange={(ev) => setCode(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") join(); }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
          <span className="bc-sub">Your name</span>
          <input
            className="bc-input" value={settings.playerName} maxLength={16} placeholder="Steve"
            onChange={(ev) => onSettings({ ...settings, playerName: ev.target.value.replace(/[^\w\- ]/g, "").slice(0, 16) })}
          />
        </label>
        {error && <div style={{ color: "#ff8080", fontSize: "calc(var(--u) * 6)", textAlign: "center", lineHeight: 1.5 }}>{error}</div>}
        <Button wide disabled={!ready} onClick={join}>{busy ? "Joining…" : "Join World"}</Button>
        <Button wide onClick={onBack}>Back</Button>
      </MenuFrame>
    </>
  );
}
