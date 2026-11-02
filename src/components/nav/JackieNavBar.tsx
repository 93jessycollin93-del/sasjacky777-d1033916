/**
 * The nav bar — one bar, customisable per person, in liquid glass.
 *
 * A port of Cybernetic's CenteredBottomNav (Eru's `src/eru/components/
 * CenteredBottomNav.jsx`), which replaces four bars that used to stack on top
 * of each other: the main nav, the Guide, the notes toolbar and the Index
 * Pill. What each of those did is now a button here, and three of them are
 * switches in the editor.
 *
 * Kept from Cybernetic, as it behaves there:
 * - press and hold anywhere on the bar (half a second) to drag it anywhere;
 * - the control strip: back, "hold to snap", grip, orientation, rows, edit,
 *   and the three-stage mode button (labels → icons → controls only);
 * - the Customize Nav Bar sheet: tap pages and widgets on or off, Done, rows
 *   1–4, and the "Pages · Widgets" count.
 *
 * Changed on the way in:
 * - Search is SANDi, the index router (`SandiPanel`), and Ctrl/⌘+K opens it —
 *   the old bar showed ⌘K on a button that only wrote to the console.
 * - The layout is saved per account, not per browser (`src/lib/navBar/prefs.ts`).
 * - "Lock to ticker" is gone: this app has no ticker to lock to.
 * - Rows are balanced, so no row is ever left empty.
 * - A layout that cannot be saved says so once instead of silently resetting.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowLeftRight, ArrowUpRightFromSquare, Bot, Check, Eye, EyeOff, GripHorizontal,
  Hammer, Maximize2, Minimize2, Pencil, Plus, SquareKanban, StickyNote, Volume2, VolumeX, X,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useStickyNotes } from "@/components/GlobalStickyNotes";
import { cn } from "@/lib/utils";
import { NAV_PAGES, NAV_SECTIONS, NAV_WIDGETS, type NavPage, type NavWidgetId } from "@/lib/navBar/catalog";
import {
  NAV_MODES,
  NAV_ROW_CHOICES,
  clampPos,
  distributeRows,
  nextMode,
  nextRows,
  readNavPrefs,
  togglePinned,
  toggleWidget,
  writeNavPrefs,
  type NavPos,
  type NavPrefs,
} from "@/lib/navBar/prefs";
import { GuidePanel } from "./GuidePanel";
import { SandiPanel } from "./SandiPanel";

const HOLD_MS = 500;
const MOVE_CANCELS_HOLD_PX = 8;

type Panel = "sandi" | "guide" | null;

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isActive(pathname: string, to: string): boolean {
  return pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));
}

/** One button on the bar: icon, and a tiny label unless the bar is in icon mode. */
function BarButton({
  label,
  icon: Icon,
  showLabel,
  active,
  onClick,
  to,
  badge,
  pressed,
}: {
  label: string;
  icon: NavPage["icon"];
  showLabel: boolean;
  active?: boolean;
  onClick?: () => void;
  to?: string;
  badge?: number;
  pressed?: boolean;
}) {
  const className = cn(
    "nav-item relative flex flex-col items-center gap-0.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
    showLabel ? "px-2.5 py-1.5" : "px-1.5 py-1",
    active ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
  );
  const body = (
    <>
      <Icon style={{ width: 18, height: 18 }} aria-hidden />
      {showLabel && <span className="text-[8px] font-medium leading-none">{label}</span>}
      {!!badge && (
        <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-primary px-1 text-[8px] font-bold leading-[14px] text-primary-foreground">
          {badge}
        </span>
      )}
    </>
  );
  if (to) {
    return (
      <Link to={to} title={label} aria-label={label} aria-current={active ? "page" : undefined} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={pressed} className={className}>
      {body}
    </button>
  );
}

export function JackieNavBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const notes = useStickyNotes();

  // The layout in state carries the account it was read for. On the render
  // after a sign-in the state still holds the previous account's layout; a
  // save keyed only on "the current user" wrote it into the new account's
  // namespace for one render before the right one overwrote it. A test caught
  // that. Now nothing is saved, or shown, under an owner it does not belong to.
  const [layout, setLayout] = useState(() => ({ owner: userId, prefs: readNavPrefs(safeStorage(), userId) }));
  const prefs = layout.owner === userId ? layout.prefs : readNavPrefs(safeStorage(), userId);
  const warnedUnsaved = useRef(false);

  const setPrefs = useCallback(
    (update: (current: NavPrefs) => NavPrefs) =>
      setLayout((l) => {
        const current = l.owner === userId ? l.prefs : readNavPrefs(safeStorage(), userId);
        const next = update(current);
        return next === current && l.owner === userId ? l : { owner: userId, prefs: next };
      }),
    [userId],
  );

  useEffect(() => {
    if (layout.owner !== userId) setLayout({ owner: userId, prefs: readNavPrefs(safeStorage(), userId) });
  }, [userId, layout.owner]);

  useEffect(() => {
    if (layout.owner !== userId) return;
    const saved = writeNavPrefs(safeStorage(), userId, layout.prefs);
    if (!saved && !warnedUnsaved.current) {
      warnedUnsaved.current = true;
      toast.error("Your nav bar layout can't be saved — this browser's storage is full or blocked. It will reset when you reload.");
    } else if (saved) {
      warnedUnsaved.current = false;
    }
  }, [layout, userId]);

  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [held, setHeld] = useState(false);
  // While dragging the position lives here and is committed on release, so a
  // drag writes storage once rather than on every pointer move.
  const [dragPos, setDragPos] = useState<NavPos | null>(null);
  const dragPosRef = useRef<NavPos | null>(null);

  const navRef = useRef<HTMLElement>(null);
  const holdTimer = useRef<number | null>(null);
  const holdStart = useRef({ x: 0, y: 0, pointerId: -1 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const didDrag = useRef(false);

  const showLabels = prefs.mode === "expanded";
  const controlsOnly = prefs.mode === "controls";
  const horizontal = prefs.orientation === "horizontal";
  const pos = dragPos ?? prefs.pos;

  const pinnedPages = useMemo(() => NAV_PAGES.filter((p) => prefs.pinned.includes(p.id)), [prefs.pinned]);

  const togglePanel = useCallback((next: Exclude<Panel, null>) => {
    setPanel((current) => (current === next ? null : next));
  }, []);

  // The bar's own buttons, in the order Cybernetic draws them: pages, then the
  // widgets that ride on the bar.
  const items = useMemo(() => {
    const out: Array<{ key: string; render: () => JSX.Element }> = pinnedPages.map((page) => ({
      key: page.id,
      render: () => (
        <BarButton key={page.id} label={page.label} icon={page.icon} to={page.to} showLabel={showLabels} active={isActive(pathname, page.to)} />
      ),
    }));
    if (prefs.widgets.guide) {
      out.push({
        key: "w-guide",
        render: () => (
          <BarButton key="w-guide" label="Guide" icon={NAV_WIDGETS[0].icon} showLabel={showLabels} active={panel === "guide"} pressed={panel === "guide"} onClick={() => togglePanel("guide")} />
        ),
      });
    }
    if (prefs.widgets.notes && notes.available) {
      out.push({
        key: "w-notes",
        render: () => (
          <BarButton key="w-notes" label={notes.open ? "Hide notes" : "Show notes"} icon={StickyNote} showLabel={showLabels} active={notes.open} pressed={notes.open} badge={notes.pinnedCount} onClick={notes.toggleOpen} />
        ),
      });
    }
    if (prefs.widgets.voice && notes.available && notes.voiceSupported) {
      out.push({
        key: "w-voice",
        render: () => (
          <BarButton key="w-voice" label={notes.speaks ? "Voice on" : "Voice off"} icon={notes.speaks ? Volume2 : VolumeX} showLabel={showLabels} active={notes.speaks} pressed={notes.speaks} onClick={notes.toggleVoice} />
        ),
      });
    }
    return out;
  }, [pinnedPages, prefs.widgets, notes, showLabels, pathname, panel, togglePanel]);

  const rows = useMemo(() => distributeRows(items, prefs.rows), [items, prefs.rows]);

  // ── Panels open beside the bar, on whichever side has room ────────────────
  const placePanel = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(window.innerWidth * 0.92, 440);
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = rect.top + rect.height / 2 < window.innerHeight / 2;
    setPanelStyle(below ? { left, top: rect.bottom + 8 } : { left, bottom: window.innerHeight - rect.top + 8 });
  }, []);

  useEffect(() => {
    if (!panel) return;
    placePanel();
    window.addEventListener("resize", placePanel);
    return () => window.removeEventListener("resize", placePanel);
  }, [panel, placePanel, pos, prefs.mode, prefs.rows, prefs.orientation]);

  // Ctrl/⌘+K opens SANDi from anywhere. Escape closes whatever the bar opened.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePanel("sandi");
      } else if (e.key === "Escape") {
        setPanel(null);
        setEditing(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  // ── Keep a dragged bar on screen when the window changes ───────────────────
  useEffect(() => {
    const keepOnScreen = () => {
      const el = navRef.current;
      if (!el) return;
      setPrefs((p) => {
        if (!p.pos) return p;
        const next = clampPos(p.pos, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
        return next.x === p.pos.x && next.y === p.pos.y ? p : { ...p, pos: next };
      });
    };
    keepOnScreen();
    window.addEventListener("resize", keepOnScreen);
    return () => window.removeEventListener("resize", keepOnScreen);
    // Re-run when the bar changes size, not only when the window does: a bar
    // dropped by the right edge and then given a second row can end up past it.
  }, [setPrefs, prefs.mode, prefs.rows, prefs.orientation, prefs.pinned.length]);

  // ── Press and hold anywhere on the bar to move it ──────────────────────────
  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = navRef.current;
    if (!el || e.button > 0) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    holdStart.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    didDrag.current = false;
    clearHold();
    holdTimer.current = window.setTimeout(() => {
      dragging.current = true;
      setHeld(true);
      try { el.setPointerCapture(holdStart.current.pointerId); } catch { /* pointer already gone */ }
      try { navigator.vibrate?.(15); } catch { /* no haptics */ }
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) {
      // Moving before the hold completes is a scroll or a tap, not a hold.
      if (holdTimer.current !== null && Math.hypot(e.clientX - holdStart.current.x, e.clientY - holdStart.current.y) > MOVE_CANCELS_HOLD_PX) {
        clearHold();
      }
      return;
    }
    const el = navRef.current;
    if (!el) return;
    didDrag.current = true;
    const next = clampPos(
      { x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    dragPosRef.current = next;
    setDragPos(next);
  };

  const endHold = () => {
    clearHold();
    if (dragging.current) {
      dragging.current = false;
      setHeld(false);
      const dropped = dragPosRef.current;
      dragPosRef.current = null;
      setDragPos(null);
      if (dropped) setPrefs((p) => ({ ...p, pos: dropped }));
    }
  };

  // A drag ends over a button; swallow that click so dropping the bar does not
  // also navigate.
  const onClickCapture = (e: React.MouseEvent) => {
    if (didDrag.current) {
      e.preventDefault();
      e.stopPropagation();
      didDrag.current = false;
    }
  };

  const barStyle: CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { left: "50%", bottom: 16, transform: "translateX(-50%)" };

  const modeLabel = prefs.mode === "expanded" ? "Collapse to icons" : prefs.mode === "icons" ? "Collapse to control bar" : "Expand navigation";
  const widgetsOn = NAV_WIDGETS.filter((w) => prefs.widgets[w.id]).length;

  const microButton = "inline-flex h-3.5 w-3.5 items-center justify-center transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60";

  return (
    <>
      <nav
        ref={navRef}
        aria-label="Main navigation"
        style={{ ...barStyle, touchAction: "none", userSelect: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onClickCapture={onClickCapture}
        title="Press and hold to move"
        className={cn(
          "liquid-glass fixed z-[70] w-fit rounded-2xl px-2 py-1.5 text-foreground",
          held && "liquid-glass-held cursor-grabbing",
          horizontal ? "flex items-center gap-0.5" : "flex flex-col gap-0.5",
        )}
      >
        {/* The control strip. It stacks against the bar's direction — vertical
            beside a horizontal bar, horizontal above a vertical one — so it
            costs the least room either way, as in Cybernetic. */}
        <div className={cn("flex items-center gap-[2px] text-muted-foreground/50", horizontal ? "flex-col pr-0.5 justify-center" : "flex-row pb-0.5")}>
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
            aria-label="Go back"
            title="Back"
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-secondary/60 text-muted-foreground transition-all hover:scale-110 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          >
            <ArrowLeft style={{ width: 8, height: 8 }} />
          </button>
          <GripHorizontal style={{ width: 10, height: 10 }} aria-hidden />
          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, orientation: p.orientation === "horizontal" ? "vertical" : "horizontal" }))}
            className={microButton}
            aria-label={horizontal ? "Switch to vertical" : "Switch to horizontal"}
            title={horizontal ? "Switch to vertical" : "Switch to horizontal"}
          >
            {horizontal ? <ArrowUpRightFromSquare style={{ width: 10, height: 10 }} /> : <ArrowLeftRight style={{ width: 10, height: 10 }} />}
          </button>
          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, rows: nextRows(p.rows) }))}
            className={cn(microButton, "text-[9px] font-bold")}
            aria-label={`${prefs.rows} row${prefs.rows > 1 ? "s" : ""}, click to change`}
            title={`${prefs.rows} row${prefs.rows > 1 ? "s" : ""} (click to cycle)`}
          >
            {prefs.rows}
          </button>
          <button
            type="button"
            onClick={() => {
              clearHold();
              dragging.current = false;
              setHeld(false);
              setPanel(null);
              setEditing(true);
            }}
            className={microButton}
            aria-label="Customize the nav bar"
            title="Edit"
          >
            <Pencil style={{ width: 10, height: 10 }} />
          </button>
          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, mode: nextMode(p.mode) }))}
            aria-label={modeLabel}
            title={modeLabel}
            className="ml-px inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary shadow-[0_0_8px_hsl(var(--primary)/0.25)] transition-all hover:scale-110 hover:bg-primary/20"
          >
            {prefs.mode === "controls" ? <Maximize2 style={{ width: 8, height: 8 }} /> : <Minimize2 style={{ width: 8, height: 8 }} className={prefs.mode === "icons" ? "opacity-70" : ""} />}
          </button>
          <span aria-hidden className="ml-px hidden items-center gap-[1px] sm:inline-flex" title={`Mode: ${prefs.mode}`}>
            {NAV_MODES.map((m) => (
              <span key={m} className={cn("block h-[3px] w-[3px] rounded-full", m === prefs.mode ? "bg-primary" : "bg-muted-foreground/30")} />
            ))}
          </span>
        </div>

        {!controlsOnly && (
          <div className={cn("flex gap-0.5", horizontal ? "flex-col" : "flex-row")}>
            {rows.map((row, i) => (
              <div key={i} className={cn("flex gap-0.5", horizontal ? "flex-row" : "flex-col")}>
                {row.map((item) => item.render())}
              </div>
            ))}
          </div>
        )}

        {!controlsOnly && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Create"
                aria-label="Create"
                className={cn(
                  "nav-item flex flex-col items-center gap-0.5 rounded-xl text-muted-foreground hover:bg-secondary/60 hover:text-primary",
                  showLabels ? "px-2.5 py-1.5" : "px-1.5 py-1",
                )}
              >
                <Plus style={{ width: 18, height: 18 }} aria-hidden />
                {showLabels && <span className="text-[8px] font-medium leading-none">Create</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent className="liquid-glass w-52 rounded-2xl p-1.5" onPointerDown={(e) => e.stopPropagation()}>
              {notes.available && (
                <CreateItem icon={StickyNote} label="Sticky note" onSelect={notes.addNote} />
              )}
              <CreateItem icon={SquareKanban} label="Task" onSelect={() => navigate("/tasks?new=1")} />
              <CreateItem icon={Hammer} label="Index (in the Forge)" onSelect={() => navigate("/forge")} />
              <CreateItem icon={Bot} label="Agent (in Agent Lab)" onSelect={() => navigate("/agent-lab")} />
            </PopoverContent>
          </Popover>
        )}

        {/* SANDi takes Search's place, and stays even in controls-only mode:
            the fastest way anywhere should not be the first thing to go. */}
        <button
          type="button"
          onClick={() => togglePanel("sandi")}
          aria-label="SANDi — go anywhere or ask (Ctrl+K)"
          aria-pressed={panel === "sandi"}
          title="SANDi — go anywhere or ask (Ctrl+K)"
          className={cn(
            "nav-item relative flex flex-col items-center gap-0.5 rounded-xl border",
            showLabels ? "px-2.5 py-1.5" : "px-1.5 py-1",
            panel === "sandi" ? "border-primary/60 bg-primary/15 text-primary" : "border-primary/30 text-primary hover:bg-primary/10",
          )}
        >
          <span className="relative">
            <Bot style={{ width: 18, height: 18 }} aria-hidden />
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {showLabels && <span className="font-mono text-[8px] font-semibold leading-none tracking-wider">SANDi</span>}
        </button>

        {/* The newer Cybernetic centres this reminder on the bar's bottom edge
            rather than tucking it into the control strip, where it made the
            strip the tallest thing on the bar. Not a target: taps go through. */}
        {showLabels && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[1px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-card/85 px-1.5 text-[7px] font-medium leading-none text-muted-foreground/60"
          >
            hold to snap
          </span>
        )}
      </nav>

      <SandiPanel open={panel === "sandi"} onClose={() => setPanel(null)} style={panelStyle} />
      <GuidePanel open={panel === "guide"} onClose={() => setPanel(null)} style={panelStyle} />

      {editing && (
        <NavEditor
          prefs={prefs}
          notesAvailable={notes.available}
          voiceSupported={notes.voiceSupported}
          onToggleWidget={(id) => setPrefs((p) => toggleWidget(p, id))}
          onTogglePage={(id) => setPrefs((p) => togglePinned(p, id))}
          onRows={(rows) => setPrefs((p) => ({ ...p, rows }))}
          onResetPosition={() => setPrefs((p) => ({ ...p, pos: null, orientation: "horizontal", rows: 1 }))}
          onClose={() => setEditing(false)}
          widgetsOn={widgetsOn}
        />
      )}
    </>
  );
}

function CreateItem({ icon: Icon, label, onSelect }: { icon: NavPage["icon"]; label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-foreground hover:bg-secondary/70"
    >
      <Icon size={14} className="text-primary" aria-hidden />
      {label}
    </button>
  );
}

/**
 * Customize Nav Bar — Cybernetic's sheet: tap to pin a page or show a widget,
 * Done, rows 1–4, and the running count. Rendered outside the bar so the bar's
 * press-and-hold handlers cannot swallow taps inside it.
 */
function NavEditor({
  prefs,
  notesAvailable,
  voiceSupported,
  widgetsOn,
  onTogglePage,
  onToggleWidget,
  onRows,
  onResetPosition,
  onClose,
}: {
  prefs: NavPrefs;
  notesAvailable: boolean;
  voiceSupported: boolean;
  widgetsOn: number;
  onTogglePage: (id: string) => void;
  onToggleWidget: (id: NavWidgetId) => void;
  onRows: (rows: NavPrefs["rows"]) => void;
  onResetPosition: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  // Every page and PC app is in here — a few hundred — so the sheet has a
  // search box; without one the thing you want is a long scroll away.
  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return NAV_SECTIONS.map((section) => ({
      title: section.title,
      pages: NAV_PAGES.filter(
        (p) => p.section === section.id && (!needle || p.label.toLowerCase().includes(needle) || p.to.toLowerCase().includes(needle)),
      ),
    })).filter((section) => section.pages.length > 0);
  }, [filter]);

  // A widget that cannot work here is said to be unavailable, not offered as
  // a switch that does nothing.
  const unavailable = (id: NavWidgetId): string | null => {
    if ((id === "notes" || id === "voice") && !notesAvailable) return "Sign in to use notes.";
    if (id === "voice" && !voiceSupported) return "This browser has no speech voices.";
    return null;
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nav-editor-title"
        className="liquid-glass flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-2xl md:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <p id="nav-editor-title" className="text-sm font-semibold">Customize Nav Bar</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="border-b border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
          Tap to add or remove pages and floating widgets. Saved to your account on this device.
        </p>

        <div className="border-b border-border/60 px-4 py-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${NAV_PAGES.length} pages and apps…`}
            aria-label="Search pages and apps"
            className="w-full rounded-lg border border-border bg-background/60 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
          {sections.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">Nothing matches “{filter}”.</p>
          )}
          {sections.map((section) => (
            <div key={section.title}>
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pages · {section.title} ({section.pages.length})
              </p>
              <div className="grid grid-cols-4 gap-3">
                {section.pages.map(({ id, label, icon: Icon }) => {
                  const pinned = prefs.pinned.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onTogglePage(id)}
                      aria-pressed={pinned}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all",
                        pinned ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/60 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <div className="relative">
                        <Icon style={{ width: 20, height: 20 }} aria-hidden />
                        {pinned && (
                          <div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary">
                            <Check className="h-2 w-2 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                      <span className="text-center text-[9px] font-medium leading-tight">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Floating Widgets</p>
            <div className="grid grid-cols-3 gap-3">
              {NAV_WIDGETS.map(({ id, label, icon: Icon, hint }) => {
                const visible = prefs.widgets[id];
                const why = unavailable(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onToggleWidget(id)}
                    aria-pressed={visible}
                    title={why ?? hint}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border p-3 transition-all",
                      visible ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/60 text-muted-foreground hover:text-foreground",
                      why && "opacity-60",
                    )}
                  >
                    <div className="relative">
                      <Icon style={{ width: 20, height: 20 }} aria-hidden />
                      <div className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-background">
                        {visible ? <Eye className="h-2 w-2 text-primary" /> : <EyeOff className="h-2 w-2 text-muted-foreground" />}
                      </div>
                    </div>
                    <span className="text-center text-[9px] font-medium leading-tight">{label}</span>
                    {why && <span className="text-center text-[8px] leading-tight text-muted-foreground">{why}</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              These attach to the bar when on. SANDi is always there — press Ctrl+K (⌘K on a Mac) to open it from anywhere.
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 space-y-2 border-t border-border/60 px-4 py-3">
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
              Done
            </button>
            <div className="flex gap-1 rounded-xl bg-secondary p-1" role="group" aria-label="Rows">
              {NAV_ROW_CHOICES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onRows(r)}
                  aria-pressed={prefs.rows === r}
                  aria-label={`${r} row${r > 1 ? "s" : ""}`}
                  className={cn(
                    "h-8 w-8 rounded text-xs font-medium transition-colors",
                    prefs.rows === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
            <span>Pages: {prefs.pinned.length} · Widgets: {widgetsOn}</span>
            <span aria-hidden>·</span>
            <button type="button" onClick={onResetPosition} className="underline hover:text-foreground">
              Reset position
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
