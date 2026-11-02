import { createContext, useCallback, useContext, useEffect, useState, useRef, useMemo, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Pin, X, Link as LinkIcon, Palette, Edit2 } from "lucide-react";
import { routerNS, FilingSystem } from "@/lib/routerNervousSystem";
import { voiceManager } from "@/lib/voice-manager";
import { toast } from "sonner";

const getContrastText = (bg: string): string => {
  const r = parseInt(bg.substr(1,2),16);
  const g = parseInt(bg.substr(3,2),16);
  const b = parseInt(bg.substr(5,2),16);
  const luminance = (0.299*r + 0.587*g + 0.114*b)/255;
  return luminance > 0.5 ? '#000' : '#fff';
};

type Note = {
  id: string;
  title?: string;
  text: string;
  color: string;
  x: number;
  y: number;
  pinned: boolean;
  pod?: string;
  agent?: string;
};

/**
 * Notes are per-account, not per-browser.
 *
 * This panel is mounted globally — outside every ProtectedRoute, so it renders
 * on /auth too — and it stored everything under one fixed localStorage key.
 * localStorage is scoped to the origin, not to the person, so on a shared
 * machine user A could sign out, user B could sign in, and A's notes were
 * still sitting there: readable, editable, and indistinguishable from B's own.
 *
 * Two things fix that, and both are needed. The key carries the user id, so
 * two accounts cannot address the same records. And the panel renders nothing
 * at all when nobody is signed in, so the signed-out surface has no notes to
 * show and no way to write into an account's namespace.
 *
 * These records stay local to the browser. If notes should follow a person
 * between devices they need a table with RLS, which is a larger change than
 * closing the leak.
 */
const notesKeyFor = (userId: string) => `jackie.notes.v1:${userId}`;
const VOICE_KEY = "jackie.notes.voice.v1";
const COLORS = ["#FFF8C6", "#CDE7FF", "#FFD6E7", "#D6FFEA", "#FFE3C6"];

/**
 * The notes' state, shared by the notes layer and the nav bar.
 *
 * The notes used to carry their own floating toolbar — voice, show/hide, add,
 * "N pinned" — stacked on top of three other toolbars. Those controls now live
 * on the one nav bar, so the state they act on is lifted here and both read it.
 * Everything about how notes are stored is unchanged.
 */
export interface StickyNotesApi {
  /** False when nobody is signed in: there is nothing to show and nowhere to write. */
  available: boolean;
  open: boolean;
  toggleOpen: () => void;
  addNote: () => void;
  pinnedCount: number;
  speaks: boolean;
  voiceSupported: boolean;
  toggleVoice: () => void;
}

interface StickyNotesState extends StickyNotesApi {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  confirm: (line: string) => void;
}

const StickyNotesContext = createContext<StickyNotesState | null>(null);

const UNAVAILABLE: StickyNotesApi = {
  available: false,
  open: false,
  toggleOpen: () => {},
  addNote: () => {},
  pinnedCount: 0,
  speaks: false,
  voiceSupported: false,
  toggleVoice: () => {},
};

/** The nav bar's view of the notes. Inert, not throwing, outside the provider. */
export function useStickyNotes(): StickyNotesApi {
  return useContext(StickyNotesContext) ?? UNAVAILABLE;
}

export function StickyNotesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = user ? notesKeyFor(user.id) : null;
  const [notes, setNotes] = useState<Note[]>([]);
  // Which namespace the notes in state were loaded from. The save effect
  // refuses to run until this matches, so the moment after an account switch —
  // when state still holds the previous user's notes but the key has already
  // changed — cannot write one account's notes into another's namespace.
  const loadedFor = useRef<string | null>(null);
  const [open, setOpen] = useState(true);
  // Off until asked for. A surface that starts talking the first time you pin
  // something is a worse surprise than one that never speaks — so the setting
  // is opt-in, remembered, and hidden entirely where the browser has no voice.
  const [speaks, setSpeaks] = useState(false);
  const voiceSupported = useRef(voiceManager.isSupported());
  /** Keeps the unsaved warning to one per spell of failing storage. */
  const warnedUnsaved = useRef(false);

  useEffect(() => {
    try { setSpeaks(localStorage.getItem(VOICE_KEY) === "on"); } catch { /* storage off */ }
  }, []);

  const confirm = useCallback((line: string) => {
    if (!speaks || !voiceSupported.current) return;
    // Confirmations must never break the action they are confirming, and the
    // browser rejects speech for reasons of its own (no voices yet, autoplay
    // policy), so a failure here is swallowed rather than surfaced.
    voiceManager.speak(line).catch(() => {});
  }, [speaks]);

  const toggleVoice = useCallback(() => {
    setSpeaks((on) => {
      const next = !on;
      try { localStorage.setItem(VOICE_KEY, next ? "on" : "off"); } catch { /* storage off */ }
      if (next) voiceManager.speak("Voice confirmations on").catch(() => {});
      else voiceManager.stop();
      return next;
    });
  }, []);

  useEffect(() => {
    if (!storageKey) {
      loadedFor.current = null;
      setNotes([]);
      return;
    }
    let loaded: Note[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) loaded = JSON.parse(raw);
    } catch { /* storage off or unreadable */ }
    loadedFor.current = storageKey;
    setNotes(loaded);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || loadedFor.current !== storageKey) return;
    // Notes that cannot be saved still sit on the screen looking saved, and the
    // only time the person finds out is the reload that loses them. A full
    // quota is the ordinary cause and it is something they can act on, so it
    // gets said — once, because this effect runs on every keystroke.
    let persisted = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify(notes));
    } catch {
      persisted = false;
    }
    if (persisted) persisted = notes.every(n => FilingSystem.write('note', n.id, n));

    if (!persisted && !warnedUnsaved.current) {
      warnedUnsaved.current = true;
      toast.error("Notes are not being saved — this browser's storage is full or blocked. Copy anything you need before reloading.");
    } else if (persisted) {
      warnedUnsaved.current = false;
    }
  }, [notes, storageKey]);

  const addNote = useCallback(() => {
    const id = Math.random().toString(36).slice(2);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const note: Note = { id, text: "New thought...", color, x: 120 + Math.random() * 200, y: 120 + Math.random() * 200, pinned: false };
    setNotes((n) => [...n, note]);
    // A note added while the notes are hidden would be saved and invisible,
    // which reads exactly like the add button doing nothing.
    setOpen(true);
    routerNS.emit('notes:create', { note });
    confirm("Note added");
    if (navigator.vibrate) navigator.vibrate(15);
  }, [confirm]);

  const pinnedCount = useMemo(() => notes.filter((n) => n.pinned).length, [notes]);
  const toggleOpen = useCallback(() => setOpen((v) => !v), []);

  const value = useMemo<StickyNotesState>(
    () => ({
      available: !!storageKey,
      open,
      toggleOpen,
      addNote,
      pinnedCount,
      speaks,
      voiceSupported: voiceSupported.current,
      toggleVoice,
      notes,
      setNotes,
      confirm,
    }),
    [storageKey, open, toggleOpen, addNote, pinnedCount, speaks, toggleVoice, notes, confirm],
  );

  return <StickyNotesContext.Provider value={value}>{children}</StickyNotesContext.Provider>;
}

/** The notes themselves, drawn over the page. Mount inside StickyNotesProvider. */
export function GlobalStickyNotes() {
  const context = useContext(StickyNotesContext);
  const [dragId, setDragId] = useState<string | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  const setNotes = context?.setNotes;
  const confirm = context?.confirm;

  const updateText = (id: string, text: string) => {
    setNotes?.((n) => n.map((note) => (note.id === id ? { ...note, text } : note)));
  };

  const togglePin = (id: string) => {
    setNotes?.((n) => n.map((note) => {
      if (note.id !== id) return note;
      const pinned = !note.pinned;
      routerNS.emit('notes:pin', { id, pinned });
      confirm?.(pinned ? "Pinned" : "Unpinned");
      if (navigator.vibrate) navigator.vibrate(pinned ? 30 : 10);
      return { ...note, pinned };
    }));
  };

  const removeNote = (id: string) => {
    setNotes?.((n) => n.filter((note) => note.id !== id));
  };

  const linkToPod = (id: string) => {
    const pod = prompt("Link to Pod ID:");
    if (!pod) return;
    setNotes?.(n => n.map(note => note.id === id ? { ...note, pod } : note));
    routerNS.emit('notes:link:pod', { noteId: id, podId: pod });
  };

  const linkToAgent = (id: string) => {
    const agent = prompt("Link to Agent ID:");
    if (!agent) return;
    setNotes?.(n => n.map(note => note.id === id ? { ...note, agent } : note));
    routerNS.emit('notes:link:agent', { noteId: id, agentId: agent });
  };

  const changeColor = (id: string) => {
    const newColor = prompt("Enter hex color");
    if (!newColor) return;
    setNotes?.(n => n.map(note => note.id === id ? { ...note, color: newColor } : note));
  };

  const renameNote = (id: string) => {
    const title = prompt("Rename note");
    if (!title) return;
    setNotes?.(n => n.map(note => note.id === id ? { ...note, title } : note));
  };

  const startDrag = (e: React.MouseEvent, id: string, note: Note) => {
    setDragId(id);
    offset.current = { x: e.clientX - note.x, y: e.clientY - note.y };
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragId) return;
      setNotes?.((n) =>
        n.map((note) =>
          note.id === dragId ? { ...note, x: e.clientX - offset.current.x, y: e.clientY - offset.current.y } : note
        )
      );
    };
    const up = () => setDragId(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [dragId, setNotes]);

  // Nothing to show, and nothing that could write, when nobody is signed in.
  // This is mounted outside every ProtectedRoute — including on /auth — so the
  // check has to live here rather than in the routing. It sits after the hooks
  // above: an early return placed higher would change how many hooks run
  // between renders, which React forbids.
  if (!context?.available) return null;
  const { notes, open } = context;

  return (
    <>
      {open && (
        <div className="fixed inset-0 pointer-events-none z-[60]">
          {notes.map((note) => (
            <div
              key={note.id}
              style={{ left: note.x, top: note.y, background: note.color }}
              className="pointer-events-auto absolute w-[240px] rounded-lg shadow-lg border border-border p-2"
            >
              <div
                className="flex items-center justify-between cursor-move mb-1"
                onMouseDown={(e) => startDrag(e, note.id, note)}
              >
                <span style={{ color: getContrastText(note.color) }} className={`text-[10px] ${note.title ? 'font-bold' : ''}`}>{note.title || 'Thought'}</span>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => changeColor(note.id)} className="p-0.5 hover:text-foreground text-muted-foreground" title="Change Color">
                    <Palette size={12} />
                  </button>
                  <button onClick={() => renameNote(note.id)} className="p-0.5 hover:text-foreground text-muted-foreground" title="Rename Note">
                    <Edit2 size={12} />
                  </button>
                  <button onClick={() => linkToPod(note.id)} className="p-0.5 hover:text-foreground text-muted-foreground" title="Link Pod">
                    <LinkIcon size={12} />
                  </button>
                  <button onClick={() => linkToAgent(note.id)} className="p-0.5 hover:text-foreground text-muted-foreground" title="Link Agent">
                    <LinkIcon size={12} />
                  </button>
                  <button onClick={() => togglePin(note.id)} className="p-0.5 hover:text-foreground text-muted-foreground">
                    <Pin size={12} className={note.pinned ? "text-primary" : ""} />
                  </button>
                  <button onClick={() => removeNote(note.id)} className="p-0.5 hover:text-destructive text-muted-foreground">
                    <X size={12} />
                  </button>
                </div>
              </div>
              <textarea
                style={{ color: getContrastText(note.color) }}
                value={note.text}
                onChange={(e) => updateText(note.id, e.target.value)}
                className="w-full h-[90px] bg-transparent outline-none resize-none text-sm leading-relaxed"
              />
              {(note.pod || note.agent) && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {note.pod && <div>Pod: {note.pod}</div>}
                  {note.agent && <div>Agent: {note.agent}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}