/**
 * CollinSurvivalCraft, start to finish: title → worlds → a running world, or title →
 * multiplayer → a friend's world. Mounted full-screen over the app; leaving
 * saves whatever is running.
 */
import { ensureMainWorld } from "../game/mainWorld";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Role } from "../game/game";
import { SaveStore, type WorldMeta } from "../game/save";
import { loadSettings, saveSettings, type Settings } from "../game/settings";
import { NetSession, type Welcome } from "../net/session";
import type { LinkKind } from "../net/transport";
import { sanitizeWaystones } from "../engine/waystones";
import { isMapId } from "../engine/maps";
import { guiUnit } from "./common";
import { GameView } from "./GameView";
import { OptionsScreen } from "./Menus";
import { THEME_CSS } from "./theme";
import { CreateWorld, MenuBackground, MultiplayerScreen, TitleScreen, WorldSelect } from "./TitleMenus";

type View =
  | { kind: "title"; message?: string }
  | { kind: "worlds" }
  | { kind: "create"; existing: string[] }
  | { kind: "multiplayer" }
  | { kind: "options" }
  | { kind: "game"; meta: WorldMeta; role: Role; session: NetSession | null; run: number };

/** A world the guest does not own: only what the host chose to share, never written to this browser's saves. */
function guestWorld(w: Welcome, room: string): WorldMeta {
  const now = Date.now();
  return {
    id: `guest:${room}`,
    name: w.worldName,
    seed: w.seed,
    seedText: w.seedText,
    type: w.type,
    gameMode: w.player?.gameMode ?? w.gameMode,
    difficulty: w.difficulty,
    hardcore: w.hardcore,
    cheats: w.cheats,
    created: now,
    lastPlayed: now,
    playTime: 0,
    time: w.time,
    day: 0,
    // The host runs the weather; a guest's timers never fire.
    weather: { rain: w.rain, thunder: w.thunder, rainTimer: Number.MAX_SAFE_INTEGER, thunderTimer: Number.MAX_SAFE_INTEGER },
    spawn: w.spawn,
    rules: w.rules,
    player: w.player,
    players: {},
    entities: [],
    dimension: w.dimension,
    disabledMods: Array.isArray(w.disabledMods) ? w.disabledMods.filter((m): m is string => typeof m === "string") : [],
    waystones: sanitizeWaystones(w.waystones),
    map: isMapId(w.map) ? w.map : undefined,
    mode: w.mode && typeof w.mode.id === "string" ? { id: w.mode.id.slice(0, 40), data: {} } : undefined,
    skyEpoch: typeof w.skyEpoch === "number" && Number.isFinite(w.skyEpoch) ? w.skyEpoch : undefined,
    place: w.place && Number.isFinite(w.place.lat) && Number.isFinite(w.place.lon) && Math.abs(w.place.lat) <= 90 ? { lat: w.place.lat, lon: w.place.lon } : undefined,
    version: 1,
  };
}

/** `onExit` leaves the game entirely; without one (a browser tab) there is no such button. */
export function CraftApp({ onExit }: { onExit?: () => void }) {
  const saves = useMemo(() => new SaveStore(), []);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [view, setView] = useState<View>({ kind: "title" });
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [join, setJoin] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const runs = useRef(0);
  // The last world's final save; the world list waits on it so it never shows stale data.
  const [lastSave, setLastSave] = useState<Promise<void>>(Promise.resolve());
  const [exiting, setExiting] = useState(false);
  // Read by the exit below in the same commit that unmounts the world, before the state catches up.
  const finalSave = useRef<Promise<void>>(Promise.resolve());
  const exited = useRef(false);

  // Leaving the game entirely steps out of the running world first, so its
  // final save is written before whatever comes next — for the desktop app,
  // closing the window, which would otherwise cut an IndexedDB write short.
  const exitApp = onExit && (() => { setExiting(true); setView({ kind: "title" }); });
  useEffect(() => {
    if (!exiting || view.kind === "game" || !onExit || exited.current) return;
    exited.current = true;
    void finalSave.current.finally(onExit);
  }, [exiting, view.kind, onExit]);
  // The desktop shell asks with this event when its window's close button is pressed.
  useEffect(() => {
    if (!exitApp) return;
    window.addEventListener("csc:exit-request", exitApp);
    return () => window.removeEventListener("csc:exit-request", exitApp);
  });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  };

  const play = (meta: WorldMeta, role: Role, session: NetSession | null) => {
    setView({ kind: "game", meta, role, session, run: ++runs.current });
  };

  const joinWorld = async (kind: LinkKind, room: string, address?: string) => {
    setJoin({ busy: true, error: null });
    try {
      const { session, welcome } = await NetSession.join(kind, room, settings.playerName.trim() || "Player", settings.skin, address);
      setJoin({ busy: false, error: null });
      play(guestWorld(welcome, room), "guest", session);
    } catch (err) {
      setJoin({ busy: false, error: (err as Error).message });
    }
  };

  const u = guiUnit(settings.guiScale, size.w, size.h);
  const style = { "--u": `${u}px` } as CSSProperties;

  return (
    <div className="bc-root" style={style}>
      <style>{THEME_CSS}</style>
      {view.kind === "title" && (
        <TitleScreen
          settings={settings}
          message={view.message ?? saves.problem ?? undefined}
          onMain={() => void lastSave.catch(() => {}).then(() => ensureMainWorld(saves)).then((m) => play(m, "local", null), (err: Error) => setView({ kind: "title", message: `The main world could not be opened: ${err.message}` }))}
          onSingle={() => setView({ kind: "worlds" })}
          onMulti={() => { setJoin({ busy: false, error: null }); setView({ kind: "multiplayer" }); }}
          onOptions={() => setView({ kind: "options" })}
          onExit={exitApp}
        />
      )}
      {view.kind === "worlds" && (
        <WorldSelect
          saves={saves}
          ready={lastSave}
          onPlay={(meta) => play(meta, "local", null)}
          onCreate={() => void saves.listWorlds().then((l) => setView({ kind: "create", existing: l.map((w) => w.name) }), () => setView({ kind: "create", existing: [] }))}
          onBack={() => setView({ kind: "title" })}
        />
      )}
      {view.kind === "create" && (
        <CreateWorld
          saves={saves}
          existing={view.existing}
          onCreate={(meta) => play(meta, "local", null)}
          onBack={() => setView({ kind: "worlds" })}
        />
      )}
      {view.kind === "multiplayer" && (
        <MultiplayerScreen
          settings={settings}
          onSettings={setSettings}
          busy={join.busy}
          error={join.error}
          onJoin={(kind, room, address) => void joinWorld(kind, room, address)}
          onBack={() => setView({ kind: "title" })}
        />
      )}
      {view.kind === "options" && (
        <>
          <MenuBackground />
          <OptionsScreen settings={settings} onChange={setSettings} onDone={() => setView({ kind: "title" })} inGame={false} />
        </>
      )}
      {view.kind === "game" && (
        <GameView
          key={view.run}
          meta={view.meta}
          role={view.role}
          session={view.session}
          saves={saves}
          settings={settings}
          onSettings={setSettings}
          onStopped={(p) => { finalSave.current = p; setLastSave(p); }}
          onQuit={(message) => setView(view.role === "guest" ? { kind: "title", message } : message ? { kind: "title", message } : { kind: "worlds" })}
          onExitApp={exitApp}
        />
      )}
    </div>
  );
}
