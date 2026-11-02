/**
 * One person's nav bar: what is pinned, which widgets ride on it, how it is
 * laid out and where it sits.
 *
 * Per account, not per browser. The four bars this replaces each kept their
 * position under one fixed localStorage key, so two people sharing a machine
 * shared a layout — the same leak GlobalStickyNotes closed for notes. The key
 * carries the user id here, and signed-out visitors get a namespace of their
 * own rather than borrowing the last account's.
 *
 * Pure apart from the two storage functions, which take the storage they use,
 * so every rule below is a unit test.
 */
import { DEFAULT_PINNED, NAV_PAGES, NAV_WIDGETS, type NavWidgetId } from "./catalog";

export type NavOrientation = "horizontal" | "vertical";
/** Cybernetic's three stages: full labels → icons only → just the control strip. */
export type NavMode = "expanded" | "icons" | "controls";
export const NAV_MODES: readonly NavMode[] = ["expanded", "icons", "controls"];
export type NavRows = 1 | 2 | 3 | 4;
export const NAV_ROW_CHOICES: readonly NavRows[] = [1, 2, 3, 4];

export interface NavPos {
  x: number;
  y: number;
}

export interface NavPrefs {
  pinned: string[];
  widgets: Record<NavWidgetId, boolean>;
  orientation: NavOrientation;
  rows: NavRows;
  mode: NavMode;
  /** Null until the bar has been dragged: it then rests at its default spot. */
  pos: NavPos | null;
}

export const DEFAULT_NAV_PREFS: NavPrefs = {
  pinned: [...DEFAULT_PINNED],
  widgets: { guide: true, notes: true, voice: false },
  orientation: "horizontal",
  rows: 1,
  mode: "expanded",
  pos: null,
};

export function navPrefsKey(userId: string | null): string {
  return `jackie.navbar.v1:${userId ?? "signed-out"}`;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reads whatever was stored, keeping what is still valid and defaulting the
 * rest. A page that has since left the catalog is dropped from the pins rather
 * than rendered as a button to nowhere; a corrupt record gives the default bar,
 * never a blank one.
 */
export function parseNavPrefs(raw: string | null): NavPrefs {
  if (!raw) return clonePrefs(DEFAULT_NAV_PREFS);
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return clonePrefs(DEFAULT_NAV_PREFS);
    data = parsed as Record<string, unknown>;
  } catch {
    return clonePrefs(DEFAULT_NAV_PREFS);
  }

  const known = new Set(NAV_PAGES.map((p) => p.id));
  const pinned = Array.isArray(data.pinned)
    ? [...new Set(data.pinned.filter((id): id is string => typeof id === "string" && known.has(id)))]
    : [...DEFAULT_NAV_PREFS.pinned];

  const storedWidgets = (data.widgets && typeof data.widgets === "object" ? data.widgets : {}) as Record<string, unknown>;
  const widgets = Object.fromEntries(
    NAV_WIDGETS.map((w) => [
      w.id,
      typeof storedWidgets[w.id] === "boolean" ? (storedWidgets[w.id] as boolean) : DEFAULT_NAV_PREFS.widgets[w.id],
    ]),
  ) as Record<NavWidgetId, boolean>;

  const pos = data.pos as { x?: unknown; y?: unknown } | null | undefined;

  return {
    pinned,
    widgets,
    orientation: data.orientation === "vertical" ? "vertical" : "horizontal",
    rows: (NAV_ROW_CHOICES as readonly unknown[]).includes(data.rows) ? (data.rows as NavRows) : 1,
    mode: (NAV_MODES as readonly unknown[]).includes(data.mode) ? (data.mode as NavMode) : "expanded",
    pos: pos && isFiniteNumber(pos.x) && isFiniteNumber(pos.y) ? { x: pos.x, y: pos.y } : null,
  };
}

function clonePrefs(prefs: NavPrefs): NavPrefs {
  return { ...prefs, pinned: [...prefs.pinned], widgets: { ...prefs.widgets }, pos: prefs.pos && { ...prefs.pos } };
}

export function readNavPrefs(storage: Pick<Storage, "getItem"> | null, userId: string | null): NavPrefs {
  try {
    return parseNavPrefs(storage?.getItem(navPrefsKey(userId)) ?? null);
  } catch {
    // Storage that throws on read (blocked cookies, some private modes) still
    // gets a working bar — the default one.
    return clonePrefs(DEFAULT_NAV_PREFS);
  }
}

/** False when the layout could not be saved, so the caller can say so once. */
export function writeNavPrefs(storage: Pick<Storage, "setItem"> | null, userId: string | null, prefs: NavPrefs): boolean {
  if (!storage) return false;
  try {
    storage.setItem(navPrefsKey(userId), JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/**
 * Pins are shown in catalog order, as Cybernetic shows them, so pinning a page
 * puts it where it belongs in the bar rather than always at the far end.
 */
export function togglePinned(prefs: NavPrefs, id: string): NavPrefs {
  const on = prefs.pinned.includes(id);
  const next = on ? prefs.pinned.filter((p) => p !== id) : [...prefs.pinned, id];
  const order = new Map(NAV_PAGES.map((p, i) => [p.id, i]));
  next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { ...prefs, pinned: next };
}

export function toggleWidget(prefs: NavPrefs, id: NavWidgetId): NavPrefs {
  return { ...prefs, widgets: { ...prefs.widgets, [id]: !prefs.widgets[id] } };
}

export function nextMode(mode: NavMode): NavMode {
  return NAV_MODES[(NAV_MODES.indexOf(mode) + 1) % NAV_MODES.length];
}

export function nextRows(rows: NavRows): NavRows {
  return NAV_ROW_CHOICES[(NAV_ROW_CHOICES.indexOf(rows) + 1) % NAV_ROW_CHOICES.length];
}

/**
 * Splits the bar's buttons across `rows` lines as evenly as possible.
 *
 * Cybernetic cut into chunks of ceil(n / rows), which leaves a trailing row
 * empty for some counts — five buttons on four rows came out 2, 2, 1, 0 — and
 * an empty row still took up a row's height on screen. This balances instead,
 * and never returns an empty row.
 */
export function distributeRows<T>(items: readonly T[], rows: number): T[][] {
  const lines = Math.max(1, Math.min(Math.floor(rows), items.length || 1));
  const base = Math.floor(items.length / lines);
  const extra = items.length % lines;
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < lines; i++) {
    const size = base + (i < extra ? 1 : 0);
    if (size === 0) continue;
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/** Keeps a dragged bar fully on screen, with a gutter, whatever the window did since. */
export function clampPos(
  pos: NavPos,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gutter = 8,
): NavPos {
  const maxX = Math.max(gutter, viewport.width - size.width - gutter);
  const maxY = Math.max(gutter, viewport.height - size.height - gutter);
  return {
    x: Math.round(Math.min(Math.max(pos.x, gutter), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, gutter), maxY)),
  };
}
