/**
 * CollinSurvivalCraft on its own: the same game as SAS-JACKY's /craft, built
 * from the same src/craft, with no account and no server behind it.
 *
 * Three ways it runs, and what each can reach:
 * - the desktop app (csc/desktop): a window, "Quit Game", and a LAN relay in
 *   its main process so it can host friends on the same network;
 * - dist/ served by any web server: a browser tab, which joins LAN games but
 *   cannot host one (a page cannot open a listening socket);
 * - the single-file build: one .html that opens from disk, offline.
 *
 * Online rooms (Supabase Realtime) are off unless the build is given a
 * project: set VITE_CSC_SUPABASE_URL and VITE_CSC_SUPABASE_KEY (a publishable
 * key) when building, and the multiplayer screen offers "Online" too.
 */
import { createRoot } from "react-dom/client";
import { configureEdition, GAME_SHORT } from "@/craft/edition";
import { CraftApp } from "@/craft/ui/CraftApp";
import "./index.css";

/** What csc/desktop/preload.cjs puts on the window. */
interface DesktopBridge {
  lanStart(): Promise<{ port: number; addresses: string[] }>;
  quit(): void;
}
const desktop = (window as unknown as { cscDesktop?: DesktopBridge }).cscDesktop;

configureEdition({
  kind: "standalone",
  tagline: `${GAME_SHORT} · ${desktop ? "DESKTOP" : "SOLO"} EDITION`,
  exitLabel: desktop ? "Quit Game" : null,
  lanJoin: location.protocol !== "https:",
  lanHost: desktop ? { start: () => desktop.lanStart() } : null,
  // A desktop window has no tabs to link.
  device: !desktop,
});

async function boot(): Promise<void> {
  if (import.meta.env.MODE === "single") {
    const { inlineWorkers } = await import("./singleFile");
    inlineWorkers();
  }
  const url = import.meta.env.VITE_CSC_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_CSC_SUPABASE_KEY as string | undefined;
  if (url && key) {
    const { createClient } = await import("@supabase/supabase-js");
    // Rooms only: there is no sign-in here, so no session to keep and no cloud saves.
    configureEdition({ online: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) });
  }
}

const root = createRoot(document.getElementById("root")!);
boot().then(
  () => root.render(<CraftApp onExit={desktop ? () => desktop.quit() : undefined} />),
  (err: Error) => root.render(
    <div style={{ color: "#fff", font: "16px monospace", padding: 24 }}>CollinSurvivalCraft could not start: {err.message}</div>,
  ),
);
