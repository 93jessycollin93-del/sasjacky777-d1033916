/**
 * Project Zomboid: Realism Overhaul — the workspace's facts, in one place.
 *
 * Everything the page shows comes from here, so the page cannot claim more than
 * this file does. Versions are written as what a named source said on the day it
 * was read, never as what is "supported": the camera dependency moved from its
 * own loader to ZombieBuddy inside a fortnight, and a pin copied from memory
 * would have sent people to a loader its own docs had retired.
 *
 * The mod itself lives in `game-mods/project-zomboid-realism-overhaul/`.
 */

export const PZ_TARGET = {
  game: "Project Zomboid",
  build: "42.21.0",
  platform: "Windows · Steam",
  modId: "RealismOverhaul",
  modDir: "game-mods/project-zomboid-realism-overhaul",
  /** The day the dependency docs below were last read. */
  docsCheckedOn: "2026-10-12",
} as const;

/** Implemented = code exists in the scaffold and runs. Planned = designed, not written. Blocked = needs something we do not control. */
export type WorkStatus = "implemented" | "planned" | "blocked" | "experimental";

export type Goal = { id: string; label: string; status: WorkStatus; note: string };

export const GOALS: Goal[] = [
  {
    id: "sp",
    label: "Single-player",
    status: "planned",
    note: "Primary target. Lua scaffold loads; realism features are planned behind toggles.",
  },
  {
    id: "mp",
    label: "Multiplayer",
    status: "experimental",
    note: "Experimental until verified on a real dedicated server. Server is authoritative; the client only presents.",
  },
];

export type CompatRow = {
  id: string;
  component: string;
  /** What the named source says, verbatim in spirit. */
  documented: string;
  /** Our own verification against Build 42.21.0. */
  verified: "not yet" | "yes" | "no";
  risk: "low" | "medium" | "high";
  note: string;
};

export const COMPATIBILITY: CompatRow[] = [
  {
    id: "pz-42.21",
    component: "Project Zomboid 42.21.0 (Steam, Windows)",
    documented: "Target build for this mod.",
    verified: "not yet",
    risk: "medium",
    note: "Build 42 is still the unstable branch; Lua APIs can change between point releases. Every API is feature-detected.",
  },
  {
    id: "pz3d",
    component: "pz3d 0.7.1 (first-person camera framework)",
    documented:
      "Earlier pz3d notes targeted Build 42.20.4, single-player. The server guide read on 2026-10-12 names 42.21.0 with pz3d 0.7.1.",
    verified: "not yet",
    risk: "high",
    note: "Treat 42.21 as an unverified risk until it runs here. No universal 42.21 claim, and no multiplayer claim.",
  },
  {
    id: "pz3d-mp",
    component: "pz3d in multiplayer",
    documented: "Described by third parties as experimental since 0.7.0.",
    verified: "not yet",
    risk: "high",
    note: "Not relied on. Our multiplayer goal stays experimental regardless of what pz3d does.",
  },
  {
    id: "zombiebuddy",
    component: "ZombieBuddy 2.3.4 or newer (Java loader pz3d needs)",
    documented: "pz3d's own docs: new installs use ZombieBuddy 2.3.4+ from GitHub; pz3d no longer ships its own loader.",
    verified: "not yet",
    risk: "medium",
    note: "Installed by the player, outside this mod. This mod never loads Java and never patches game JARs.",
  },
  {
    id: "pz3d-loader",
    component: "pz3d-loader (old loader)",
    documented: "Superseded: pz3d's docs direct new installs to ZombieBuddy.",
    verified: "no",
    risk: "high",
    note: "Do not pin. Not a dependency of this mod.",
  },
];

export type ChecklistItem = { id: string; label: string; detail?: string };

/** The dependency and version checks a person ticks before a play session. */
export const DEPENDENCY_CHECKLIST: ChecklistItem[] = [
  { id: "dep-pz-build", label: "Steam shows Project Zomboid on build 42.21.0", detail: "Main menu, bottom-right corner shows the build." },
  { id: "dep-ram", label: "At least 6 GB RAM allocated to the game", detail: "pz3d's own minimum." },
  { id: "dep-zb", label: "ZombieBuddy 2.3.4+ installed from its GitHub releases", detail: "Follow ZombieBuddy's instructions, not a re-upload." },
  { id: "dep-pz3d", label: "pz3d 0.7.1 subscribed and enabled", detail: "Only needed for first-person. Skip it and the camera stays isometric." },
  { id: "dep-no-old-loader", label: "No separate pz3d-loader copy left over", detail: "Keep one loader route: ZombieBuddy." },
  { id: "dep-ro", label: "Realism Overhaul enabled, after pz3d in the load order", detail: "It only reads pz3d's presence; it never edits pz3d." },
  { id: "dep-backup", label: "Save folder backed up before the first session", detail: "See ROLLBACK.md." },
];

export type Phase = {
  id: string;
  title: string;
  status: WorkStatus;
  /** Which side owns it — presentation never decides gameplay. */
  side: "client" | "server" | "shared";
  summary: string;
  tasks: ChecklistItem[];
};

export const PHASES: Phase[] = [
  {
    id: "camera",
    title: "1 · First-person camera and clipping",
    status: "blocked",
    side: "client",
    summary:
      "Build 42 has no supported Lua API for a first-person camera. The camera comes from pz3d; this mod only has an adapter that detects it and reports state.",
    tasks: [
      { id: "cam-adapter", label: "Adapter boundary detects pz3d and reports blocked / delegated" },
      { id: "cam-verify", label: "Verify pz3d 0.7.1 on 42.21.0, single-player, on this rig" },
      { id: "cam-clip", label: "Log clipping cases (doors, stairs, vehicles) against pz3d" },
    ],
  },
  {
    id: "movement",
    title: "2 · Movement and interaction",
    status: "planned",
    side: "server",
    summary: "Fatigue-weighted sprint, encumbrance on stance changes. Values decided on the server, never sent from the client.",
    tasks: [
      { id: "mov-sandbox", label: "Sandbox options for each movement rule" },
      { id: "mov-server", label: "Server applies the rule; client only animates" },
    ],
  },
  {
    id: "lighting",
    title: "3 · Lighting, flashlight and weather",
    status: "planned",
    side: "client",
    summary: "Presentation only: darker nights, narrower flashlight cone, weather-dimmed visibility. No gameplay advantage either way.",
    tasks: [
      { id: "lit-detect", label: "Feature-detect the climate and light APIs before touching them" },
      { id: "lit-toggle", label: "Each effect behind its own toggle" },
    ],
  },
  {
    id: "audio",
    title: "4 · Audio, occlusion and zombie detection",
    status: "planned",
    side: "server",
    summary: "Occlusion is presentation; whether a zombie heard you is gameplay and stays on the server.",
    tasks: [
      { id: "aud-occl", label: "Client-side muffling through walls (presentation)" },
      { id: "aud-noise", label: "Server-side noise radius rule (authoritative)" },
    ],
  },
  {
    id: "mp",
    title: "5 · Multiplayer authority and sync",
    status: "experimental",
    side: "server",
    summary: "Clients send requests by name only; the server validates the command and answers with its own state.",
    tasks: [
      { id: "mp-allowlist", label: "Server accepts only allowlisted commands" },
      { id: "mp-dedicated", label: "Test on a dedicated server with two clients" },
    ],
  },
  {
    id: "perf",
    title: "6 · Performance",
    status: "planned",
    side: "shared",
    summary: "No per-tick work unless a feature is on. Measure frame time with and without the mod.",
    tasks: [
      { id: "perf-baseline", label: "Record baseline FPS in Muldraugh at noon and midnight" },
      { id: "perf-compare", label: "Compare with each toggle on" },
    ],
  },
  {
    id: "regression",
    title: "7 · Regression",
    status: "planned",
    side: "shared",
    summary: "TEST_PLAN.md: load, save, reload, and the same with pz3d absent.",
    tasks: [
      { id: "reg-no-pz3d", label: "Game loads and saves with pz3d absent" },
      { id: "reg-reload", label: "Save, quit, reload: no errors in console.txt" },
    ],
  },
  {
    id: "rollback",
    title: "8 · Rollback",
    status: "implemented",
    side: "shared",
    summary: "ROLLBACK.md written. The mod writes nothing outside its own folder and touches no original assets.",
    tasks: [
      { id: "rb-doc", label: "Rollback steps written" },
      { id: "rb-drill", label: "Practise disabling the mod on a copied save" },
    ],
  },
];

/** What the scaffold really contains today — shown verbatim on the page. */
export const STATUS_BOARD: { label: string; status: WorkStatus }[] = [
  { label: "mod.info, Build 42 folder layout, sandbox options", status: "implemented" },
  { label: "Config with feature toggles (all realism features off by default)", status: "implemented" },
  { label: "API feature detection (pz3d, sandbox vars, client/server)", status: "implemented" },
  { label: "Server command allowlist (rejects anything else)", status: "implemented" },
  { label: "Camera adapter boundary", status: "implemented" },
  { label: "First-person camera", status: "blocked" },
  { label: "Movement, lighting, audio rules", status: "planned" },
  { label: "Multiplayer sync verified on a server", status: "experimental" },
];

export type DocLink = { label: string; href: string; what: string };

export const LINKS: DocLink[] = [
  { label: "Project Zomboid", href: "https://projectzomboid.com/", what: "The game, by The Indie Stone" },
  { label: "PZwiki · Modding", href: "https://pzwiki.net/wiki/Modding", what: "Community modding reference" },
  { label: "pz3d · Install", href: "https://pz3d.dev/install/", what: "Official install guide and versions" },
  { label: "pz3d · About the loader", href: "https://pz3d.dev/install/about.html", what: "Why ZombieBuddy, not pz3d-loader" },
  { label: "pz3d · Run on server", href: "https://pz3d.dev/install/server.html", what: "Dedicated server route" },
  { label: "pz3d · Steam Workshop", href: "https://steamcommunity.com/sharedfiles/filedetails/?id=3807334881", what: "Workshop item 3807334881" },
  { label: "ZombieBuddy · GitHub", href: "https://github.com/zed-0xff/ZombieBuddy", what: "Java loader source" },
  { label: "ZombieBuddy · Releases", href: "https://github.com/zed-0xff/ZombieBuddy/releases", what: "Get 2.3.4 or newer here" },
];

/** Every id a person can tick, so stored progress can be checked against it. */
export function allChecklistIds(): string[] {
  return [...DEPENDENCY_CHECKLIST.map((c) => c.id), ...PHASES.flatMap((p) => p.tasks.map((t) => t.id))];
}
