import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Settings } from "../game/settings";
import { edition } from "../edition";
import type { LinkKind } from "../net/transport";
import { ADVANCEMENTS } from "../engine/advancements";
import { itemId } from "../engine/items";
import { Button, Cycle, ItemIcon, Slider, Toggle } from "./common";

export function MenuFrame({ title, children, width = 200, dim = true }: { title?: string; children: ReactNode; width?: number; dim?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bc-shadow" style={{ padding: "calc(var(--u) * 6)" }}>
      {dim && <div className="bc-dim" />}
      <div className="bc-scroll" style={{ position: "relative", width: `min(100%, calc(var(--u) * ${width}))`, maxHeight: "100%", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 4)" }}>
        {title && <div className="bc-title" style={{ textAlign: "center", marginBottom: "calc(var(--u) * 4)" }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function PauseMenu({ onResume, onOptions, onShare, onAdvancements, onMods, onEngrams, onCritters, onQuit, onExitApp, shareLabel, canShare, quitLabel }: {
  onResume: () => void; onOptions: () => void; onShare: () => void; onAdvancements: () => void; onMods: () => void; onQuit: () => void; onExitApp?: () => void;
  /** Primal worlds: the engram list. */
  onEngrams?: () => void;
  /** Critter worlds: the party and field guide. */
  onCritters?: () => void;
  shareLabel: string; canShare: boolean; quitLabel: string;
}) {
  const exitLabel = onExitApp ? edition().exitLabel : null;
  return (
    <MenuFrame title="Game Menu">
      <Button wide onClick={onResume}>Back to Game</Button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "calc(var(--u) * 4)" }}>
        <Button onClick={onAdvancements}>Advancements</Button>
        <Button onClick={onShare} disabled={!canShare}>{shareLabel}</Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "calc(var(--u) * 4)" }}>
        <Button onClick={onOptions}>Options…</Button>
        <Button onClick={onMods}>Mods…</Button>
      </div>
      {onEngrams && <Button wide onClick={onEngrams}>Engrams…</Button>}
      {onCritters && <Button wide onClick={onCritters}>Critters and Field Guide…</Button>}
      <Button wide onClick={onQuit}>{quitLabel}</Button>
      {exitLabel && <Button wide onClick={onExitApp}>{exitLabel}</Button>}
    </MenuFrame>
  );
}

export function DeathScreen({ message, score, hardcore, onRespawn, onTitle }: {
  message: string; score: number; hardcore: boolean; onRespawn: () => void; onTitle: () => void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto bc-shadow" style={{ background: "linear-gradient(rgba(80,0,0,0.55), rgba(160,0,0,0.65))", gap: "calc(var(--u) * 6)" }}>
      <div style={{ fontSize: "calc(var(--u) * 20)" }}>{hardcore ? "Game over!" : "You died!"}</div>
      <div style={{ fontSize: "calc(var(--u) * 7)" }}>{message}</div>
      <div style={{ fontSize: "calc(var(--u) * 7)" }}>Score: <span style={{ color: "#ffff55" }}>{score}</span></div>
      <div style={{ width: "calc(var(--u) * 200)", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 4)" }}>
        <Button wide disabled={!ready} onClick={onRespawn}>{hardcore ? "Spectate world" : "Respawn"}</Button>
        <Button wide disabled={!ready} onClick={onTitle}>Title screen</Button>
      </div>
    </div>
  );
}

const history: string[] = [];

export function ChatInput({ initial, onSubmit, onClose }: { initial: string; onSubmit: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const [h, setH] = useState(history.length);
  // At once: the key that opened chat was already swallowed, and anything typed before focus lands
  // would be read as movement keys instead.
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="absolute left-0 right-0 pointer-events-auto" style={{ bottom: "calc(var(--u) * 2)", padding: "0 calc(var(--u) * 2)", display: "flex", gap: "calc(var(--u) * 2)" }}>
      <input
        ref={ref}
        className="bc-input"
        value={text}
        maxLength={256}
        placeholder="Say something, or type / for commands (try /help)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            if (text.trim()) { history.push(text); onSubmit(text); }
            onClose();
          } else if (e.key === "Escape") onClose();
          else if (e.key === "ArrowUp" && history.length) { const i = Math.max(0, h - 1); setH(i); setText(history[i]); }
          else if (e.key === "ArrowDown") { const i = Math.min(history.length, h + 1); setH(i); setText(history[i] ?? ""); }
        }}
      />
      <button type="button" className="bc-btn" onClick={() => { if (text.trim()) { history.push(text); onSubmit(text); } onClose(); }}>Send</button>
      <button type="button" className="bc-btn" onClick={onClose} aria-label="Close chat">✕</button>
    </div>
  );
}

export function OptionsScreen({ settings, onChange, onDone, inGame }: {
  settings: Settings; onChange: (s: Settings) => void; onDone: () => void; inGame: boolean;
}) {
  const [tab, setTab] = useState<"video" | "controls" | "audio" | "profile">("video");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  return (
    <MenuFrame title="Options" width={260} dim={inGame}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "calc(var(--u) * 2)" }}>
        {(["video", "controls", "audio", "profile"] as const).map((t) => (
          <Button key={t} onClick={() => setTab(t)} className={tab === t ? "!text-yellow-200" : ""}>{t[0].toUpperCase() + t.slice(1)}</Button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "calc(var(--u) * 3)" }}>
        {tab === "video" && (
          <>
            <Slider label="Render Distance" value={settings.renderDistance} min={2} max={16} onChange={(v) => set("renderDistance", v)} format={(v) => `${v} chunks`} />
            <Slider label="FOV" value={settings.fov} min={30} max={110} onChange={(v) => set("fov", v)} format={(v) => (v === 70 ? "Normal" : v >= 110 ? "Quake Pro" : String(v))} />
            <Cycle label="Graphics" value={settings.graphics} options={["fancy", "fast"]} onChange={(v) => set("graphics", v)} format={(v) => (v === "fancy" ? "Fancy" : "Fast")} />
            <Toggle label="Smooth Lighting" value={settings.smoothLighting} onChange={(v) => set("smoothLighting", v)} />
            <Slider label="Brightness" value={Math.round(settings.brightness * 100)} min={0} max={100} onChange={(v) => set("brightness", v / 100)} format={(v) => (v === 0 ? "Moody" : v === 100 ? "Bright" : `${v}%`)} />
            <Toggle label="Clouds" value={settings.clouds} onChange={(v) => set("clouds", v)} />
            <Cycle label="Particles" value={settings.particles} options={["all", "decreased", "minimal"]} onChange={(v) => set("particles", v)} format={(v) => v[0].toUpperCase() + v.slice(1)} />
            <Toggle label="View Bobbing" value={settings.viewBobbing} onChange={(v) => set("viewBobbing", v)} />
            <Cycle label="GUI Scale" value={settings.guiScale} options={[0, 1.5, 2, 2.5, 3, 4]} onChange={(v) => set("guiScale", v)} format={(v) => (v === 0 ? "Auto" : String(v))} />
            <Cycle label="Resolution" value={settings.maxPixelRatio} options={[0.75, 1, 1.5, 2, 3]} onChange={(v) => set("maxPixelRatio", v)} format={(v) => `${v}×`} />
            <Toggle label="Show Coordinates" value={settings.showCoordinates} onChange={(v) => set("showCoordinates", v)} />
          </>
        )}
        {tab === "controls" && (
          <>
            <Cycle label="Controls" value={settings.controls} options={["auto", "desktop", "mobile"]} onChange={(v) => set("controls", v)} format={(v) => (v === "auto" ? "Auto-detect" : v === "desktop" ? "Keyboard & mouse" : "Touch")} />
            <Slider label="Sensitivity" value={Math.round(settings.sensitivity * 100)} min={10} max={200} onChange={(v) => set("sensitivity", v / 100)} format={(v) => `${v}%`} />
            <Toggle label="Invert Mouse" value={settings.invertY} onChange={(v) => set("invertY", v)} />
            <Toggle label="Toggle Sneak" value={settings.toggleSneak} onChange={(v) => set("toggleSneak", v)} />
            <Cycle label="Touch Actions" value={settings.touchMode} options={["buttons", "tap"]} onChange={(v) => set("touchMode", v)} format={(v) => (v === "buttons" ? "Crosshair + buttons" : "Tap to interact")} />
            <Toggle label="Auto-Jump" value={settings.autoJump} onChange={(v) => set("autoJump", v)} />
            <Slider label="Button Opacity" value={Math.round(settings.touchOpacity * 100)} min={15} max={100} onChange={(v) => set("touchOpacity", v / 100)} format={(v) => `${v}%`} />
            <Slider label="Button Size" value={Math.round(settings.touchScale * 100)} min={70} max={150} onChange={(v) => set("touchScale", v / 100)} format={(v) => `${v}%`} />
          </>
        )}
        {tab === "audio" && (
          <>
            <Slider label="Master Volume" value={Math.round(settings.masterVolume * 100)} min={0} max={100} onChange={(v) => set("masterVolume", v / 100)} format={(v) => (v ? `${v}%` : "OFF")} />
            <Slider label="Music" value={Math.round(settings.musicVolume * 100)} min={0} max={100} onChange={(v) => set("musicVolume", v / 100)} format={(v) => (v ? `${v}%` : "OFF")} />
            <Slider label="Sounds" value={Math.round(settings.soundVolume * 100)} min={0} max={100} onChange={(v) => set("soundVolume", v / 100)} format={(v) => (v ? `${v}%` : "OFF")} />
          </>
        )}
        {tab === "profile" && (
          <>
            <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: "calc(var(--u) * 2)" }}>
              <span className="bc-sub">Player name (shown to others online)</span>
              <input className="bc-input" value={settings.playerName} maxLength={16} placeholder="Steve"
                onChange={(e) => set("playerName", e.target.value.replace(/[^\w\- ]/g, "").slice(0, 16))} onKeyDown={(e) => e.stopPropagation()} />
            </label>
            <Slider label="Skin" value={settings.skin} min={0} max={31} onChange={(v) => set("skin", v)} format={(v) => `#${v + 1}`} />
          </>
        )}
      </div>
      <Button wide onClick={onDone}>Done</Button>
    </MenuFrame>
  );
}

export function ShareScreen({ onOpen, onBack, busy, error, room, kind, addresses, onStop }: {
  onOpen: (kind: LinkKind) => void; onBack: () => void; busy: boolean; error: string | null;
  room: string | null; kind: LinkKind | null; addresses?: string[]; onStop: () => void;
}) {
  const e = edition();
  const where = kind === "online" ? "online" : kind === "lan" ? "to your local network" : "to other tabs on this device";
  return (
    <MenuFrame title="Play Together" width={240}>
      {room ? (
        <>
          <div className="bc-sub" style={{ textAlign: "center" }}>
            Your world is open {where}. Friends join from Multiplayer{kind === "lan" ? " → LAN, with this address and code" : " with this code"}:
          </div>
          {kind === "lan" && (
            addresses?.length
              ? addresses.map((a) => <div key={a} style={{ textAlign: "center", fontSize: "calc(var(--u) * 11)", color: "#55ffff" }}>{a}</div>)
              : <div className="bc-sub" style={{ textAlign: "center", color: "#ffcc55" }}>This computer reports no network address — is it connected to Wi-Fi or a cable?</div>
          )}
          <div style={{ textAlign: "center", fontSize: "calc(var(--u) * 22)", color: "#ffff55", letterSpacing: "0.2em" }}>{room}</div>
          <Button wide onClick={() => { void navigator.clipboard?.writeText(kind === "lan" && addresses?.[0] ? `${addresses[0]} ${room}` : room); }}>Copy code</Button>
          <Button wide danger onClick={onStop}>Close world to others</Button>
        </>
      ) : (
        <>
          <div className="bc-sub" style={{ textAlign: "center" }}>Open this world so friends can join. You stay the host: the world is saved on your side.</div>
          {e.online && <Button wide disabled={busy} onClick={() => onOpen("online")}>🌐 Open online</Button>}
          {e.lanHost && <Button wide disabled={busy} onClick={() => onOpen("lan")}>📡 Open to LAN</Button>}
          {e.device && <Button wide disabled={busy} onClick={() => onOpen("device")}>🖥 Open to tabs on this device</Button>}
          {!e.online && !e.lanHost && (
            <div className="bc-sub" style={{ textAlign: "center", lineHeight: 1.5 }}>
              To host friends on other computers, run the desktop app (it opens a LAN server), or start one with <span style={{ color: "#ffff55" }}>node relay.mjs</span> and join it from every copy.
            </div>
          )}
          {busy && <div className="bc-sub" style={{ textAlign: "center" }}>Opening…</div>}
        </>
      )}
      {error && <div style={{ color: "#ff8080", fontSize: "calc(var(--u) * 6)", textAlign: "center" }}>{error}</div>}
      <Button wide onClick={onBack}>Back</Button>
    </MenuFrame>
  );
}

export function AdvancementsScreen({ earned, onBack }: { earned: ReadonlySet<string>; onBack: () => void }) {
  const done = ADVANCEMENTS.filter((a) => earned.has(a.id)).length;
  return (
    <MenuFrame title="Advancements" width={260}>
      <div className="bc-sub" style={{ textAlign: "center" }}>{done} of {ADVANCEMENTS.length} earned in this world</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(var(--u) * 120), 1fr))", gap: "calc(var(--u) * 3)" }}>
        {ADVANCEMENTS.map((a) => {
          const got = earned.has(a.id);
          return (
            <div key={a.id} style={{
              display: "flex", gap: "calc(var(--u) * 4)", alignItems: "center", padding: "calc(var(--u) * 3)",
              background: got ? "rgba(40,90,40,0.75)" : "rgba(0,0,0,0.5)", border: `calc(var(--u) * 1) solid ${got ? "#6c6" : "#333"}`,
            }}>
              <span style={{ opacity: got ? 1 : 0.35, filter: got ? undefined : "grayscale(1)" }}><ItemIcon id={itemId(a.icon)} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "calc(var(--u) * 6.5)", color: got ? "#ffff55" : "#bbb" }}>{a.title}</div>
                <div className="bc-sub" style={{ lineHeight: 1.3 }}>{a.description}</div>
              </div>
            </div>
          );
        })}
      </div>
      <Button wide onClick={onBack}>Done</Button>
    </MenuFrame>
  );
}
