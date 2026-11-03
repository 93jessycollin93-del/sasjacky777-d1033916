/**
 * The context ledger: an endless, append-only stream of what has been said and
 * done, kept on this device, with a slow fold that keeps it answerable.
 *
 * The owner's rule is that context here has no ceiling — no 256k wall, no
 * "conversation too long", no silently dropping the beginning. A model's window
 * is a hard physical thing and always will be, so the only way to honour an
 * endless conversation is to stop treating the window as the container. The
 * container is this ledger; the window only ever receives a slice chosen for the
 * question being asked.
 *
 * Three parts, each doing one job:
 *   append  — every turn is written once, with a sequence number, and never
 *             edited, never evicted. The words themselves stay with the
 *             archivist, verbatim, so a fold that dropped a detail can always
 *             be re-run against what was actually said.
 *   fold    — the oldest un-folded stretch is compressed into a note, extractive
 *             only, and the fold is stored. One call folds one stretch; a caller
 *             may keep calling for a week while Jackie reads her own history,
 *             and nothing about the design assumes it finishes in one sitting.
 *   read    — a step asks for context on a focus and gets a bounded slice: the
 *             folds plus the most recent words, distributed by the same
 *             distributor the chain uses, so one long source cannot crowd out
 *             the rest.
 *
 * The ledger never invents. Compression here is sentence-level selection
 * inherited from `compress`, so a fold can lose detail and cannot gain a claim.
 * And a fold that had nothing to fold says so, rather than reporting a success
 * that did not happen.
 *
 * IndexedDB, like the archivist, because it has to work with the radio off; a
 * Map when IndexedDB is absent (tests, private windows that refuse it), with the
 * same honesty about which one is holding the data.
 */
import { archive, recall } from "./chain/archive";
import { distribute, type Note } from "./chain/compress";

export interface LedgerTurn {
  id: string;
  seq: number;
  at: number;
  role: "user" | "assistant" | "tool" | "note";
  /** Who or what said it, shown to the model so it can cite its own history. */
  label: string;
  text: string;
  /** The archivist's id for the verbatim original, or null when it was refused. */
  archivedId: string | null;
}

export interface LedgerFold {
  id: string;
  seqFrom: number;
  seqTo: number;
  at: number;
  text: string;
  /** Turns this fold stands for — how much of the stream it covers. */
  turns: number;
}

export interface LedgerStatus {
  turns: number;
  folds: number;
  /** Turns the fold has not reached yet. */
  unfolded: number;
  /** Highest sequence number folded. */
  cursor: number;
  chars: number;
  /** Where the ledger is actually being kept. */
  where: "device" | "memory";
}

/** Turns one fold absorbs. Small on purpose: a fold is a unit of work, not a batch job. */
export const FOLD_WINDOW = 8;
/** The fold's own ceiling, in characters. */
export const FOLD_CHARS = 1200;
/** How many recent turns stay verbatim in front of a step, before compression. */
export const RECENT_TURNS = 6;

const DB = "jackie-context-ledger";
const TURNS = "turns";
const FOLDS = "folds";
const STATE = "state";

const memoryTurns = new Map<string, LedgerTurn>();
const memoryFolds = new Map<string, LedgerFold>();
const memoryState = new Map<string, { cursor: number; seq: number }>();

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TURNS)) db.createObjectStore(TURNS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(FOLDS)) db.createObjectStore(FOLDS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The one counter every turn and fold reads, so sequence never repeats. */
async function readState(db: IDBDatabase | null): Promise<{ cursor: number; seq: number }> {
  if (db) {
    try {
      const row = (await tx<{ cursor: number; seq: number }>(db, STATE, "readonly", (s) => s.get("ledger"))) as
        | { cursor: number; seq: number }
        | undefined;
      if (row) return row;
    } catch {
      // fall through to memory
    }
  }
  return memoryState.get("ledger") ?? { cursor: 0, seq: 0 };
}

async function writeState(db: IDBDatabase | null, state: { cursor: number; seq: number }): Promise<void> {
  memoryState.set("ledger", state);
  if (db) await tx(db, STATE, "readwrite", (s) => s.put({ key: "ledger", ...state })).catch(() => undefined);
}

async function allTurns(db: IDBDatabase | null): Promise<LedgerTurn[]> {
  const stored = db
    ? ((await tx<LedgerTurn[]>(db, TURNS, "readonly", (s) => s.getAll()).catch(() => [])) as LedgerTurn[])
    : [];
  return [...stored, ...memoryTurns.values()].sort((a, b) => a.seq - b.seq);
}

async function allFolds(db: IDBDatabase | null): Promise<LedgerFold[]> {
  const stored = db
    ? ((await tx<LedgerFold[]>(db, FOLDS, "readonly", (s) => s.getAll()).catch(() => [])) as LedgerFold[])
    : [];
  return [...stored, ...memoryFolds.values()].sort((a, b) => a.seqFrom - b.seqFrom);
}

/**
 * Writes one turn onto the stream and returns it.
 *
 * The verbatim original goes to the archivist first: the ledger row is the index
 * and the fold's raw material, and the archivist is what makes a fold
 * reversible. A refusal to persist is not a reason to lose the turn — it is
 * recorded as `archivedId: null` so a later read can say which words are held
 * only in memory.
 */
export async function appendTurn(
  turn: Omit<LedgerTurn, "id" | "seq" | "at" | "archivedId">,
): Promise<LedgerTurn> {
  const db = await openDb();
  const state = await readState(db);
  const seq = state.seq + 1;
  const saved = await archive({ label: turn.label, kind: `ledger:${turn.role}`, text: turn.text }).catch(() => null);
  const entry: LedgerTurn = {
    ...turn,
    id: newId(),
    seq,
    at: Date.now(),
    archivedId: saved?.entry.id ?? null,
  };
  memoryTurns.set(entry.id, entry);
  if (db) await tx(db, TURNS, "readwrite", (s) => s.put(entry)).catch(() => undefined);
  await writeState(db, { cursor: state.cursor, seq });
  if (db) db.close();
  return entry;
}

/** The whole stream, oldest first. There is no limit to ask for it. */
export async function readLedger(): Promise<LedgerTurn[]> {
  const db = await openDb();
  const turns = await allTurns(db);
  if (db) db.close();
  return turns;
}

/** The folds, oldest first. */
export async function readFolds(): Promise<LedgerFold[]> {
  const db = await openDb();
  const folds = await allFolds(db);
  if (db) db.close();
  return folds;
}

/**
 * Folds the next stretch of the stream, and stops there.
 *
 * Deliberately small and deliberately not a loop: the fold is the unit of work,
 * so a caller can run one between answers, or run hundreds overnight while
 * Jackie reads her own past, and a pass interrupted halfway is simply resumed by
 * asking again. The stretch is compressed against `focus` with the same
 * extractive compressor the chain uses, and the archivist keeps the words, so
 * this can only lose detail, never add a claim.
 *
 * Returns `folded: 0` with a reason when there is nothing to do — a fold that
 * processed nothing and reported success is the bug this whole file exists to
 * avoid.
 */
export async function foldOldest(
  focus: string,
  opts: { window?: number; chars?: number } = {},
): Promise<{ folded: number; fold?: LedgerFold; reason?: string }> {
  const db = await openDb();
  const state = await readState(db);
  const turns = (await allTurns(db)).filter((t) => t.seq > state.cursor);
  if (!turns.length) {
    if (db) db.close();
    return { folded: 0, reason: "nothing left to fold — the fold has reached the newest turn" };
  }
  const window = Math.max(1, opts.window ?? FOLD_WINDOW);
  const chars = Math.max(120, opts.chars ?? FOLD_CHARS);
  const stretch = turns.slice(0, window);
  const notes: Note[] = stretch.map((t) => ({ label: `${t.role === "user" ? "You" : t.label}`, text: t.text }));
  const text = distribute(notes, focus, chars);
  if (!text.trim()) {
    if (db) db.close();
    return { folded: 0, reason: "the stretch folded to nothing — its words are still in the archive" };
  }
  const fold: LedgerFold = {
    id: newId(),
    seqFrom: stretch[0].seq,
    seqTo: stretch[stretch.length - 1].seq,
    at: Date.now(),
    text,
    turns: stretch.length,
  };
  memoryFolds.set(fold.id, fold);
  if (db) await tx(db, FOLDS, "readwrite", (s) => s.put(fold)).catch(() => undefined);
  await writeState(db, { cursor: fold.seqTo, seq: state.seq });
  if (db) db.close();
  return { folded: stretch.length, fold };
}

/**
 * Runs the fold until the stream is caught up or `maxFolds` are done.
 *
 * The week-long dive: a caller asks for a slice of work, not for the whole job.
 * The report says how far it got, which is what makes a slow dive honest — a
 * pass that stopped early reads as stopped, not as finished.
 */
export async function dive(
  focus: string,
  opts: { maxFolds?: number; onFold?: (fold: LedgerFold, done: number) => void } = {},
): Promise<{ folds: number; turns: number; caughtUp: boolean; reason?: string }> {
  const max = Math.max(1, opts.maxFolds ?? 1);
  let folds = 0;
  let turns = 0;
  for (let i = 0; i < max; i++) {
    const r = await foldOldest(focus);
    if (!r.fold) return { folds, turns, caughtUp: false, reason: r.reason };
    folds += 1;
    turns += r.folded;
    opts.onFold?.(r.fold, folds);
  }
  const status = await ledgerStatus();
  return { folds, turns, caughtUp: status.unfolded === 0, reason: status.unfolded ? `${status.unfolded} turns still ahead of the fold` : undefined };
}

/**
 * What a step reads: the folds and the newest words, sliced for this focus.
 *
 * The window never sees the stream. It sees this — bounded, relevant, and
 * labelled so the model can tell its own history from a fetched document. The
 * distributor keeps one long fold from crowding out the last message, which is
 * the difference between a small model that remembers and one that echoes.
 */
export async function contextFor(
  focus: string,
  budget: number,
  opts: { recent?: number } = {},
): Promise<string> {
  const db = await openDb();
  const state = await readState(db);
  const turns = await allTurns(db);
  const folds = await allFolds(db);
  if (db) db.close();

  const notes: Note[] = folds.map((f) => ({
    label: `earlier, turns ${f.seqFrom}–${f.seqTo}`,
    text: f.text,
  }));
  const recent = turns.filter((t) => t.seq > state.cursor).slice(-(opts.recent ?? RECENT_TURNS));
  for (const t of recent) {
    notes.push({ label: t.role === "user" ? "you, just now" : `${t.label}, just now`, text: t.text });
  }
  return distribute(notes, focus, budget);
}

/** What the ledger holds, and how far behind the fold is. */
export async function ledgerStatus(): Promise<LedgerStatus> {
  const db = await openDb();
  const state = await readState(db);
  const turns = await allTurns(db);
  const folds = await allFolds(db);
  if (db) db.close();
  const where: LedgerStatus["where"] = db ? "device" : "memory";
  return {
    turns: turns.length,
    folds: folds.length,
    unfolded: turns.filter((t) => t.seq > state.cursor).length,
    cursor: state.cursor,
    chars: turns.reduce((n, t) => n + t.text.length, 0),
    where,
  };
}

/**
 * Forgets the ledger and nothing else. The archivist keeps the originals: this
 * drops the index and the folds, which is what "clear this conversation" means,
 * and does not silently delete material the rest of Jackie may still be using.
 */
export async function clearLedger(): Promise<void> {
  memoryTurns.clear();
  memoryFolds.clear();
  memoryState.clear();
  const db = await openDb();
  if (!db) return;
  for (const store of [TURNS, FOLDS, STATE]) {
    await tx(db, store, "readwrite", (s) => s.clear()).catch(() => undefined);
  }
  db.close();
}

/** The verbatim words behind a ledger row, from the archivist. */
export async function turnOriginal(turn: LedgerTurn): Promise<string | null> {
  if (!turn.archivedId) return null;
  const entry = await recall(turn.archivedId);
  return entry?.text ?? null;
}

/**
 * Writes one finished exchange onto the stream.
 *
 * Called once an answer is complete, from the chat, whatever engine produced it.
 * The engine and model are recorded because an answer's provenance is part of
 * what makes it checkable later — "Jackie said X" is weaker than "Bonsai on this
 * device said X, from these notes". Nothing here waits on the network: the
 * conversation is the one thing that must survive being offline, and a chat that
 * only remembers while a server is reachable is a chat with amnesia by default.
 */
export async function recordExchange(opts: {
  question: string;
  answer: string;
  engine: string;
  model?: string | null;
}): Promise<void> {
  const question = opts.question.trim();
  const answer = opts.answer.trim();
  if (!question || !answer) return;
  await appendTurn({ role: "user", label: "you", text: question });
  await appendTurn({
    role: "assistant",
    label: `Jackie via ${opts.engine}${opts.model ? ` (${opts.model})` : ""}`,
    text: answer,
  });
}
