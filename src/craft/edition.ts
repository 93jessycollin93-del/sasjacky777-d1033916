/**
 * Which copy of CollinSurvivalCraft this is, and what it can reach.
 *
 * One source runs in two places: inside SAS-JACKY at /craft, signed in with
 * the app's Supabase project behind it, and as the solo download (csc/) with
 * no account and no server. Everything that needs a backend asks here first,
 * so the solo copy hides what it cannot do rather than offering a button that
 * fails the moment it is pressed.
 *
 * Internal names stay "blockcraft" (the IndexedDB database, localStorage keys,
 * the export format, channel names): renaming them would strand every world
 * already saved, and keeping them means a world exported from one edition
 * imports into the other.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const GAME_NAME = "CollinSurvivalCraft";
export const GAME_SHORT = "CSC";
export const GAME_VERSION = "2.3";

/** Where a desktop copy can open a LAN relay. Supplied by the desktop shell's preload. */
export interface LanHost {
  /** Starts the relay if it is not running; resolves with its port and this machine's LAN addresses. */
  start(): Promise<{ port: number; addresses: string[] }>;
}

export interface Edition {
  kind: "sas-jacky" | "standalone";
  /** What the second line of the logo says. */
  tagline: string;
  /**
   * What the button that leaves the game entirely says ("Back to Jackie",
   * "Quit Game"), or null where there is nowhere to go — a browser tab cannot
   * close itself. What it does is CraftApp's onExit.
   */
  exitLabel: string | null;
  /** The Supabase client behind online rooms (Realtime broadcast), if this copy has one. */
  online: SupabaseClient | null;
  /** Cloud saves need a signed-in account, which only the app provides. */
  cloud: boolean;
  /**
   * Joining a LAN game dials ws:// on another machine, which a page served over
   * https may not do (mixed content) — so only copies not served from the web
   * can join, and only a desktop copy can host.
   */
  lanJoin: boolean;
  lanHost: LanHost | null;
  /** Tabs of one browser playing together (BroadcastChannel). A desktop window has no tabs. */
  device: boolean;
}

let current: Edition = {
  kind: "standalone",
  tagline: `${GAME_SHORT} · SOLO EDITION`,
  exitLabel: null,
  online: null,
  cloud: false,
  lanJoin: true,
  lanHost: null,
  device: true,
};

/** Called once by whatever mounts the game, before it renders. */
export function configureEdition(e: Partial<Edition>): Edition {
  current = { ...current, ...e };
  return current;
}

export function edition(): Edition {
  return current;
}
