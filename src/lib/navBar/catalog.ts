/**
 * Everything the nav bar can hold — every page and every app this system has.
 *
 * Three sections, because the app is three things sharing one shell: Jackie's
 * own pages, the Eru pages (starting with the forty-three Cybernetic's bar
 * offers, at the paths Eru is mounted under here), and the ninety-odd apps
 * inside the PC.
 *
 * Future-proof by construction: a hand-picked list gives the common pages
 * their icons and order, and everything else is *discovered* — every route the
 * manifest declares and every app the PC roster lists turns up in the editor on
 * its own. A page added to the app tomorrow can be pinned tomorrow, without
 * anyone remembering to add it here.
 *
 * Every `to` is checked against the route manifest by `src/test/nav-bar.test.ts`,
 * so a pinned button can never point at a route the router does not serve: a
 * nav entry that goes nowhere is the one control on screen a person can least
 * afford to have lie to them.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity, AppWindow, ArrowUpDown, Award, BarChart, BarChart2, BarChart3, Bot, Boxes, Brain,
  CalendarDays, Code2, Coins, Compass, Cpu, Dna, Factory, FileSpreadsheet, FlaskConical, FolderLock,
  Gamepad2, Gauge, Gem, GitBranch, Hammer, HardDrive, Home, ImageIcon, KeyRound, Layers, LayoutGrid,
  Library, Lightbulb, Mail, Monitor, Music, Network, PanelsTopLeft, Pickaxe, Plug, Route, Scale, ScanLine,
  Send, Settings, Share2, Shield, ShieldAlert, ShieldCheck, ShoppingBag, Sparkles, SquareKanban,
  StickyNote, Store, Sword, Terminal, UserCog, Users, Volume2, Wallet, Wand2, Wrench, Zap, Clock,
} from "lucide-react";
import { ROUTE_MANIFEST, type RouteEntry } from "@/lib/routeManifest";
import { PC_APPS, pcAppHref } from "@/data/pcApps";

export type NavSection = "jackie" | "eru" | "pc";

export const NAV_SECTIONS: ReadonlyArray<{ id: NavSection; title: string }> = [
  { id: "jackie", title: "Jackie" },
  { id: "eru", title: "Eru" },
  { id: "pc", title: "The PC" },
];

export interface NavPage {
  /** Stable id stored in a person's pins. Never re-used for a different page. */
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  section: NavSection;
}

const jackie = (id: string, label: string, icon: LucideIcon, to: string): NavPage => ({
  id, label, icon, to, section: "jackie",
});

// Cybernetic's own list, in its own order, prefixed `eru-` so an Eru page and a
// Jackie page of the same name ("Settings", "API Keys") are different pins.
const eru = (id: string, label: string, icon: LucideIcon, path: string): NavPage => ({
  id: `eru-${id}`, label, icon, to: path ? `/eru/${path}` : "/eru", section: "eru",
});

const CURATED: readonly NavPage[] = [
  jackie("home", "Home", Home, "/"),
  jackie("workstation", "Workstation", Gauge, "/workstation"),
  jackie("tasks", "Tasks", SquareKanban, "/tasks"),
  jackie("calendar", "Calendar", CalendarDays, "/tasks/calendar"),
  jackie("vault", "Vault", FolderLock, "/vault"),
  jackie("pods", "Pods", LayoutGrid, "/pods"),
  jackie("agents", "Agents", Bot, "/agent-lab"),
  jackie("control", "Control", Clock, "/control"),
  jackie("keys", "API Keys", KeyRound, "/keys"),
  jackie("forge", "Index Forge", Hammer, "/forge"),
  jackie("guide-page", "Guide Page", Compass, "/guide"),
  jackie("bots", "Bot Foundry", Cpu, "/bots"),
  jackie("swarm", "Swarm", Network, "/swarm"),
  jackie("providers", "Providers", Plug, "/providers"),
  jackie("micro", "Micro-AI", Brain, "/micro"),
  jackie("models", "Model Queue", Boxes, "/models"),
  jackie("local-ai", "Local AI", HardDrive, "/local-ai"),
  jackie("jacky-live", "Jacky Live", Activity, "/jacky-live"),
  jackie("pc", "The PC", Monitor, "/pc"),
  jackie("pc-apps", "PC Apps", AppWindow, "/pc-apps"),
  jackie("bridge", "Bridge", Terminal, "/bridge"),
  jackie("repair", "Repair Bay", Wrench, "/repair"),
  jackie("mesh", "Router Mesh", Share2, "/mesh"),
  jackie("nervous", "Nervous", Zap, "/nervous"),
  jackie("github", "GitHub Sync", GitBranch, "/github"),
  jackie("path", "Path Router", Route, "/path"),
  jackie("core", "Core", ShieldCheck, "/core"),
  jackie("morals", "Morals", Scale, "/morals"),
  jackie("skills", "Skills", Hammer, "/skills"),
  jackie("grok", "Grok", Sparkles, "/grok"),
  jackie("craft", "Craft", Pickaxe, "/craft"),
  jackie("play", "Play", Gamepad2, "/play"),
  jackie("hub", "Telegram", Send, "/hub"),

  eru("home", "Eru Home", Home, ""),
  eru("dashboard", "Dashboard", PanelsTopLeft, "dashboard"),
  eru("jackie", "Jackie", Bot, "jackie"),
  eru("markets", "Markets", BarChart2, "markets"),
  eru("trade", "Trade", ArrowUpDown, "trade"),
  eru("nfts", "NFTs", ImageIcon, "nfts"),
  eru("portfolio", "Portfolio", Wallet, "portfolio"),
  eru("collect", "Collectables", ShoppingBag, "collectables"),
  eru("music", "Library", Music, "music"),
  eru("playlists", "Playlists", Library, "playlists"),
  eru("discover", "Discover", Compass, "discover"),
  eru("listening", "Listening", BarChart3, "listening"),
  eru("messages", "Messages", Mail, "messages"),
  eru("community", "Community", Users, "community"),
  eru("botlab", "Bot Lab", Bot, "bot-lab"),
  eru("creator", "Creator Hub", Lightbulb, "creator"),
  eru("thinkers", "Thinkers", Brain, "thinkers"),
  eru("review", "App Review", Shield, "review"),
  eru("reputation", "Reputation", Award, "reputation"),
  eru("tgapps", "TG Apps", Send, "tgapps"),
  eru("ailab", "AI Lab", FlaskConical, "ailab"),
  eru("teambuilder", "Team of Five", Users, "team-builder"),
  eru("devlab", "Dev Lab", Code2, "dev-lab"),
  eru("cardscan", "Card Scan", ScanLine, "card-scanner"),
  eru("integrations", "Connections", Plug, "integrations"),
  eru("botmarket", "Bot Market", Cpu, "bot-marketplace"),
  eru("botfarm", "Bot Farm", Factory, "bot-farm"),
  eru("apikeys", "API Keys", KeyRound, "apikeys"),
  eru("builder", "ERU", Wand2, "builder"),
  eru("pipeline", "Pipeline", Layers, "pipeline"),
  eru("jta", "Jade Atelier", Gem, "jta"),
  eru("visual", "Visual", Sparkles, "visual"),
  eru("arena", "Card Arena", Sword, "arena"),
  eru("creatures", "Creatures", Dna, "creatures"),
  eru("storefront", "Storefront", Store, "storefront"),
  eru("bazar", "Bazar Stand", Coins, "bazar-stand"),
  eru("sfanalytics", "SF Analytics", BarChart, "storefront-analytics"),
  eru("economy", "Economy", Award, "admin/economy"),
  eru("sheets", "Sheets Sync", FileSpreadsheet, "sheets-sync"),
  eru("profileprefs", "Profile Prefs", UserCog, "profile-preferences"),
  eru("adminreview", "Admin Review", ShieldAlert, "admin/review"),
  eru("security", "Security", Shield, "admin/security"),
  eru("settings", "Settings", Settings, "settings"),
];

/** Cybernetic's forty-three, for the test that holds this list to them. */
export const CYBERNETIC_PAGE_IDS: readonly string[] = CURATED.filter((p) => p.section === "eru").map((p) => p.id);

const GROUP_ICON: Record<RouteEntry["group"], LucideIcon> = {
  core: PanelsTopLeft,
  ai: Brain,
  ops: Activity,
  eru: Sparkles,
};

/** "Eru · Deck Builder" → "Deck Builder"; "Index Forge (craft your own…)" → "Index Forge". */
function shortLabel(label: string): string {
  return label.replace(/^Eru · /, "").replace(/\s*\(.*\)\s*$/, "").trim();
}

/**
 * Every real destination in the manifest the curated list does not already
 * cover. Aliases are skipped (they only redirect), and so are routes with
 * parameters, which have no single place to go.
 */
function discoveredRoutes(): NavPage[] {
  const covered = new Set(CURATED.map((p) => p.to));
  return ROUTE_MANIFEST.filter(
    (route) => !route.alias && !route.path.includes(":") && route.path !== "/auth" && !covered.has(route.path),
  ).map((route) => ({
    id: `route:${route.path}`,
    label: shortLabel(route.label),
    icon: GROUP_ICON[route.group],
    to: route.path,
    section: route.group === "eru" ? "eru" : "jackie",
  }));
}

/** Every app in the PC, opening straight into it (`/pc?app=<id>`). */
function pcApps(): NavPage[] {
  return PC_APPS.map((app) => ({
    id: `pc:${app.appId}`,
    label: app.name,
    icon: AppWindow,
    to: pcAppHref(app.appId),
    section: "pc" as const,
  }));
}

export const NAV_PAGES: readonly NavPage[] = [...CURATED, ...discoveredRoutes(), ...pcApps()];

export const NAV_PAGE_IDS: ReadonlySet<string> = new Set(NAV_PAGES.map((p) => p.id));

/**
 * What a fresh bar holds: the six the old bar hard-coded (Home, Pods, Agents,
 * Vault, Control, API Keys), plus the task board, which the agents have always
 * said their tasks appear on.
 */
export const DEFAULT_PINNED: readonly string[] = ["home", "tasks", "pods", "agents", "vault", "control", "keys"];

/**
 * Things that attach to the bar rather than navigate: each used to be its own
 * floating toolbar, stacked on top of the others. Now each is a switch in the
 * editor, and when on it is one more button on the one bar.
 */
export type NavWidgetId = "guide" | "notes" | "voice";

export interface NavWidget {
  id: NavWidgetId;
  label: string;
  icon: LucideIcon;
  /** Shown in the editor under the switch. */
  hint: string;
}

export const NAV_WIDGETS: readonly NavWidget[] = [
  { id: "guide", label: "Guide", icon: Compass, hint: "How do I use this? Answered from the app's own map." },
  { id: "notes", label: "Notes", icon: StickyNote, hint: "Show or hide your sticky notes, and see how many are pinned." },
  { id: "voice", label: "Voice", icon: Volume2, hint: "Spoken confirmations when you add or pin a note." },
];
