/**
 * One running world: the canvas, the HUD over it, whichever screen is open,
 * and the touch controls on a phone or tablet.
 *
 * The Game object owns everything that runs per frame; React only draws
 * what the Game's store says, ten times a second for the HUD and whenever a
 * screen's contents change. Leaving the view always stops the game and saves
 * it — including when the tab is hidden or closed, which on a phone is how
 * most sessions end.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Game, type Role } from "../game/game";
import { DesktopInput } from "../game/input";
import type { SaveStore, WorldMeta } from "../game/save";
import { effectiveControls, type Settings } from "../game/settings";
import type { Hud as HudState } from "../game/types";
import { NetSession } from "../net/session";
import { clientId, newRoomCode, type LinkKind } from "../net/transport";
import { edition, GAME_NAME } from "../edition";
import { Button } from "./common";
import { Hud } from "./Hud";
import { AdvancementsScreen, ChatInput, DeathScreen, MenuFrame, OptionsScreen, PauseMenu, ShareScreen } from "./Menus";
import { AnvilScreen, BrewingScreen, ChestScreen, CookingScreen, CraftingScreen, EnchantingScreen, FurnaceScreen, InventoryScreen, SmithingScreen, TradeScreen } from "./Screens";
import { TouchControls } from "./TouchControls";
import { EndPoem } from "./EndPoem";
import { Minimap, WaypointLabels, WorldMapScreen } from "./MapView";
import { WaystoneScreen } from "./WaystoneScreen";
import { EngramScreen } from "./EngramScreen";
import { ModsScreen } from "./ModsScreen";
import { BattleScreen, CenterScreen, CritterTradeScreen, LinkScreen, PartyScreen, PartyStrip, StarterScreen } from "./CritterScreens";
import { SurvivorScreen } from "./SurvivorScreen";
import { CasinoScreen } from "./CasinoScreens";
import { ShopScreen } from "./CityScreens";
import { SpaceScreen } from "./SpaceScreen";

export interface GameViewProps {
  meta: WorldMeta;
  role: Role;
  /** A guest's already-joined session; null for a local world (which may be opened to others later). */
  session: NetSession | null;
  saves: SaveStore;
  settings: Settings;
  onSettings: (s: Settings) => void;
  /** Back to the title screen, optionally with a message explaining why. */
  onQuit: (message?: string) => void;
  onExitApp?: () => void;
  /** Handed the final save once the world stops, so the world list can wait for it. */
  onStopped?: (saved: Promise<void>) => void;
}

function webglProblem(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/webgl|context/i.test(text)) {
    return `${GAME_NAME} needs WebGL 2, and this browser would not create a WebGL 2 canvas. Turn on hardware acceleration in the browser's settings, or try another browser.`;
  }
  return `The world could not start: ${text}`;
}

export function GameView(props: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState<{ game: Game; input: DesktopInput } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Props at mount: a running world is never rebuilt for a settings change (applySettings handles those).
  const initial = useRef(props);

  useEffect(() => {
    const { meta, role, session, saves, settings, onStopped } = initial.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let g: Game;
    try {
      g = new Game({
        meta, canvas, settings, saves, role,
        // A guest must answer to the id the host knows its connection by.
        playerId: session?.myId ?? clientId(),
        playerName: settings.playerName.trim() || "Player",
      });
    } catch (err) {
      console.error("[blockcraft] could not start", err);
      session?.close();
      setStartError(webglProblem(err));
      return;
    }
    session?.attach(g);
    // Development builds only: lets a browser test (or a curious developer) read the live game state.
    if (import.meta.env.DEV) (window as unknown as { __blockcraft?: Game }).__blockcraft = g;
    const input = new DesktopInput(g, canvas);
    g.start();
    setRunning({ game: g, input });

    const save = () => {
      if (g.role === "guest") return;
      void g.saveNow().catch((e: Error) => g.message(`Could not save the world: ${e.message}`, "#ff6666"));
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    const ro = new ResizeObserver(() => g.resize());
    ro.observe(canvas);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
      ro.disconnect();
      input.dispose();
      onStopped?.(g.thumbnail().finally(() => g.stop(true)));
    };
  }, []);

  if (startError) {
    return (
      <MenuFrame title={`${GAME_NAME} could not start`}>
        <div style={{ fontSize: "calc(var(--u) * 7)", lineHeight: 1.5, textAlign: "center" }}>{startError}</div>
        <Button wide onClick={() => props.onQuit()}>Back to title</Button>
      </MenuFrame>
    );
  }

  return (
    <>
      <canvas ref={canvasRef} className="bc-canvas" tabIndex={-1} />
      {running && <Overlay game={running.game} input={running.input} {...props} />}
    </>
  );
}

function Overlay({ game, input, settings, onSettings, onQuit, onExitApp }: GameViewProps & { game: Game; input: DesktopInput }) {
  const hud = useSyncExternalStore(game.store.subscribe, game.store.get);
  const mobile = effectiveControls(settings) === "mobile";
  const [locked, setLocked] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [share, setShare] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const leaving = useRef(false);

  useEffect(() => {
    game.onFatal = (message) => setFatal(message);
    return () => { game.onFatal = null; };
  }, [game]);

  useEffect(() => {
    const onLock = () => setLocked(document.pointerLockElement === game.renderer.canvas);
    document.addEventListener("pointerlockchange", onLock);
    return () => document.removeEventListener("pointerlockchange", onLock);
  }, [game]);

  // Any screen needs the mouse free — a crafting table or chest opens from a click in the world, and
  // death from anything — and closing it hands the mouse straight back to the game.
  const lastScreen = useRef<HudState["screen"]>(null);
  useEffect(() => {
    const was = lastScreen.current;
    lastScreen.current = hud.screen;
    if (hud.screen && input.locked) input.exitLock();
    // Refused without a recent click (Chrome just after Escape): the "Click to play" prompt covers that.
    else if (was && !hud.screen && !mobile && !input.locked) input.requestLock();
  }, [hud.screen, mobile, input]);

  const quit = (message?: string) => {
    if (leaving.current) return;
    leaving.current = true;
    onQuit(message);
  };

  const changeSettings = (s: Settings) => {
    onSettings(s);
    game.applySettings(s);
  };

  const openToOthers = async (kind: LinkKind) => {
    setShare({ busy: true, error: null });
    try {
      if (kind === "lan") {
        const relay = edition().lanHost;
        if (!relay) throw new Error("Only the desktop app can host over the local network.");
        const { port, addresses } = await relay.start();
        // The host reaches its own relay on loopback; guests use the addresses the relay reported.
        await NetSession.host(game, "lan", newRoomCode(), { address: `127.0.0.1:${port}`, share: addresses.map((a) => `${a}:${port}`) });
      } else {
        await NetSession.host(game, kind, newRoomCode());
      }
      setShare({ busy: false, error: null });
    } catch (err) {
      setShare({ busy: false, error: (err as Error).message });
    }
  };

  const screen = hud.screen;
  const net = hud.net;
  const guest = game.role === "guest";

  if (fatal) {
    return (
      <MenuFrame title={guest ? "Disconnected" : "The world stopped"}>
        <div style={{ fontSize: "calc(var(--u) * 7)", lineHeight: 1.5, textAlign: "center" }}>{fatal}</div>
        <Button wide onClick={() => quit()}>Back to title</Button>
      </MenuFrame>
    );
  }

  return (
    <>
      {hud.minimap && !hud.hudHidden && !hud.loading && (!screen || screen.kind === "chat") && (
        <>
          <WaypointLabels game={game} />
          <Minimap game={game} />
        </>
      )}
      {!hud.space && <Hud hud={hud} mobile={mobile} crosshair={!mobile || settings.touchMode === "buttons"} />}
      {hud.critters && !screen && !hud.hudHidden && !hud.loading && <PartyStrip party={hud.critters.party} />}

      {!mobile && !screen && !locked && !hud.loading && !hud.dead && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bc-shadow">
          <div style={{ background: "rgba(0,0,0,0.5)", padding: "calc(var(--u) * 6) calc(var(--u) * 10)", textAlign: "center", fontSize: "calc(var(--u) * 7)", lineHeight: 1.6 }}>
            <div style={{ fontSize: "calc(var(--u) * 10)" }}>Click to play</div>
            <div className="bc-sub">WASD move · Space jump · Shift sneak · Ctrl sprint · E inventory · T chat · Esc menu</div>
          </div>
        </div>
      )}

      {mobile && !screen && !hud.dead && !hud.loading && (
        <TouchControls
          game={game}
          onPause={() => game.setScreen({ kind: "pause" })}
          onChat={() => game.controls.actions.push({ type: "chat" })}
          onInventory={() => game.controls.actions.push({ type: "inventory" })}
          onMap={hud.minimap ? () => game.controls.actions.push({ type: "map" }) : undefined}
        />
      )}

      {screen?.kind === "pause" && (
        <PauseMenu
          onResume={() => game.setScreen(null)}
          onOptions={() => game.setScreen({ kind: "options" })}
          onShare={() => game.setScreen({ kind: "share" })}
          onAdvancements={() => game.setScreen({ kind: "advancements" })}
          onMods={() => game.setScreen({ kind: "mods" })}
          onEngrams={game.engramsOn() ? () => game.setScreen({ kind: "engrams", from: "pause" }) : undefined}
          onCritters={game.critters.on ? () => game.setScreen({ kind: "party" }) : undefined}
          onQuit={() => quit()}
          onExitApp={onExitApp && (() => { leaving.current = true; onExitApp(); })}
          canShare={!guest}
          shareLabel={guest ? "Joined a friend" : net ? "Playing together…" : "Open to friends"}
          quitLabel={guest ? "Disconnect" : "Save and quit to title"}
        />
      )}
      {screen?.kind === "mods" && (
        <ModsScreen
          disabled={game.meta.disabledMods ?? []}
          onChange={guest ? undefined : (next) => game.setDisabledMods(next)}
          onBack={() => game.setScreen({ kind: "pause" })}
        />
      )}
      {screen?.kind === "waystone" && <WaystoneScreen game={game} x={screen.x} y={screen.y} z={screen.z} />}
      {screen?.kind === "battle" && <BattleScreen game={game} />}
      {screen?.kind === "casino" && <CasinoScreen key={screen.game} game={game} which={screen.game} />}
      {screen?.kind === "shop" && <ShopScreen key={screen.shop} game={game} which={screen.shop} />}
      {screen?.kind === "party" && <PartyScreen key={`${screen.give ?? ""}${screen.tab ?? ""}`} game={game} give={screen.give} tab={screen.tab} />}
      {screen?.kind === "starter" && <StarterScreen game={game} rentals={screen.rentals} />}
      {screen?.kind === "survivor" && <SurvivorScreen game={game} />}
      {screen?.kind === "center" && <CenterScreen game={game} x={screen.x} y={screen.y} z={screen.z} />}
      {/* In space the ship's screen stays up under the pause menu and the chat, which open over it. */}
      {hud.space && (screen?.kind === "space" || screen?.kind === "pause" || screen?.kind === "chat" || screen?.kind === "options") && <SpaceScreen game={game} />}
      {hud.launch !== null && hud.launch !== undefined && hud.launch < 1 && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: `rgba(0,0,0,${1 - hud.launch})` }} />
      )}
      {screen?.kind === "link" && <LinkScreen game={game} />}
      {screen?.kind === "critter_trade" && <CritterTradeScreen game={game} />}
      {screen?.kind === "engrams" && <EngramScreen game={game} onBack={() => game.setScreen(screen.from === "pause" ? { kind: "pause" } : { kind: "inventory" })} />}
      {screen?.kind === "map" && <WorldMapScreen game={game} mobile={mobile} onClose={() => game.setScreen(null)} />}
      {screen?.kind === "poem" && <EndPoem name={game.player.name} onDone={() => game.setScreen(null)} />}
      {screen?.kind === "advancements" && (
        <AdvancementsScreen earned={game.player.advancements} onBack={() => game.setScreen({ kind: "pause" })} />
      )}
      {screen?.kind === "options" && (
        <OptionsScreen settings={settings} onChange={changeSettings} onDone={() => game.setScreen({ kind: "pause" })} inGame />
      )}
      {screen?.kind === "share" && (
        <ShareScreen
          busy={share.busy}
          error={share.error}
          room={net?.role === "host" ? net.room : null}
          kind={net?.kind ?? null}
          addresses={net?.addresses}
          onOpen={(kind) => void openToOthers(kind)}
          onStop={() => { game.net?.close(); game.message("The world is closed to others again.", "#ffff55"); }}
          onBack={() => game.setScreen({ kind: "pause" })}
        />
      )}
      {screen?.kind === "chat" && (
        // Closing the chat closes only the chat: a command may have opened a screen of its own (the poem, going home).
        <ChatInput initial={screen.text} onSubmit={(t) => game.submitChat(t)} onClose={() => { if (game.screen?.kind === "chat") game.setScreen(null); }} />
      )}
      {screen?.kind === "death" && (
        <DeathScreen
          message={hud.deathMessage || "You died"}
          score={game.player.score}
          hardcore={hud.hardcore}
          onRespawn={() => game.respawn()}
          onTitle={() => quit()}
        />
      )}
      {screen?.kind === "inventory" && <InventoryScreen game={game} mobile={mobile} />}
      {screen?.kind === "crafting" && <CraftingScreen game={game} mobile={mobile} />}
      {screen?.kind === "furnace" && <FurnaceScreen game={game} mobile={mobile} />}
      {(screen?.kind === "chest" || screen?.kind === "backpack") && <ChestScreen game={game} mobile={mobile} />}
      {screen?.kind === "brewing" && <BrewingScreen game={game} mobile={mobile} />}
      {screen?.kind === "enchanting" && <EnchantingScreen game={game} mobile={mobile} />}
      {screen?.kind === "anvil" && <AnvilScreen game={game} mobile={mobile} />}
      {screen?.kind === "smithing" && <SmithingScreen game={game} mobile={mobile} />}
      {screen?.kind === "cooking" && <CookingScreen game={game} mobile={mobile} />}
      {screen?.kind === "trade" && <TradeScreen game={game} mobile={mobile} />}
    </>
  );
}

