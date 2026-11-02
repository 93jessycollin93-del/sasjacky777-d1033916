/**
 * Jackie Sovereign OS – Router Nervous System
 * Event bus for navigation, UFNB, Filing, Sticky Notes, Agents, Pods
 * 
 * Myth: Router is the nervous system, branching like roots.
 * Every navigation action is an impulse traveling through the OS.
 */

/**
 * Every impulse the system can send, in one list.
 *
 * Exported as values, not just as a type, because an inspector cannot subscribe
 * to a type — and until one could enumerate these, the bus had exactly one
 * consumer and no way to see what was travelling through it.
 */
export const EVENT_NAMES = [
  'nav:back', 'nav:home', 'nav:pods', 'nav:agents', 'nav:files', 'nav:time',
  'nav:notif', 'nav:settings', 'nav:notes:new', 'nav:notes:open', 'nav:notes:save',
  'ufnb:drag', 'ufnb:dock', 'ufnb:resize',
  'notes:create', 'notes:update', 'notes:pin', 'notes:link:pod', 'notes:link:agent',
  'filing:write', 'filing:read', 'filing:archive',
  'agent:activate', 'agent:deactivate',
  'pod:enter', 'pod:leave',
  'nav:custom', 'pod:fold', 'pod:slice',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];



type EventPayload = Record<string, any>;

type Listener = (payload: EventPayload, event: EventName) => void;

class RouterNervousSystem {
  private listeners = new Map<EventName, Set<Listener>>();
  private history: Array<{event: EventName, payload: EventPayload, ts: number}> = [];

  on(event: EventName, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: EventName, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: EventName, payload: EventPayload = {}) {
    const ts = Date.now();
    this.history.push({ event, payload, ts });
    if (this.history.length > 1000) this.history.shift();
    
    // Haptic feedback hook
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }

    this.listeners.get(event)?.forEach(l => {
      try { l(payload, event); } catch {}
    });

    // Global logging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Jackie.NS] ${event}`, payload);
    }
  }

  /**
   * Watch every event with one subscription.
   *
   * Returns a single unsubscribe that detaches all of them, so an inspector
   * cannot leak a listener per event name when it unmounts.
   */
  onAny(listener: Listener) {
    const offs = EVENT_NAMES.map((event) => this.on(event, listener));
    return () => offs.forEach((off) => off());
  }

  getHistory(filter?: EventName) {
    return filter 
      ? this.history.filter(h => h.event === filter)
      : [...this.history];
  }

  // Sovereign OS helpers
  navigate = (path: string) => this.emit('nav:custom', { path });
  createNote = (note: any) => this.emit('notes:create', { note });
  linkNoteToPod = (noteId: string, podId: string) => this.emit('notes:link:pod', { noteId, podId });
  linkNoteToAgent = (noteId: string, agentId: string) => this.emit('notes:link:agent', { noteId, agentId });
}

export const routerNS = new RouterNervousSystem();

/**
 * The filing cabinet is per-account, per-browser.
 *
 * These records live in localStorage, which is scoped to the origin and not to
 * the person. With one fixed prefix, everything filed by whoever signed in
 * first stayed readable by whoever signed in next on the same machine — a
 * shared laptop, a demo device, a library. Notes were the visible case; pods,
 * agents and tasks all went to the same place.
 *
 * The scope segment sits inside the prefix so `list()`, `archive()` and
 * `restore()` inherit it without changing: switching accounts changes which
 * keys those functions can even see. `anon` covers the signed-out case rather
 * than a bare prefix, so signed-out scribbles can never be mistaken for a
 * user's own records.
 *
 * Note the ordering relationship the enumeration in list() depends on: the
 * archive prefix must remain an extension of the live one.
 */
const FILING_ROOT = 'jackie.filing.';
let filingScope = 'anon';

/** Called by the auth provider whenever the signed-in user changes. */
export function setFilingScope(userId: string | null | undefined): void {
  // A dot would be read as a separator by the key parser below.
  filingScope = userId ? String(userId).replace(/\./g, '_') : 'anon';
}

export function currentFilingScope(): string {
  return filingScope;
}

const filingPrefix = () => `${FILING_ROOT}${filingScope}.`;
const archivePrefix = () => `${FILING_ROOT}${filingScope}.archived.`;

export interface FiledRecord {
  key: string;
  entityType: string;
  id: string;
  archived: boolean;
  bytes: number;
  data: unknown;
}

/**
 * Filing System Bridge – every note/pod/agent is a file
 */
export const FilingSystem = {
  /**
   * Files a record, and says whether it managed to.
   *
   * This announced `filing:write` before it wrote and swallowed whatever the
   * write threw — the same shape as the archive bug below, where the event was
   * the only thing that ever happened. A full quota is the ordinary case here,
   * because the cabinet only ever grows, and every listener went on believing
   * a record existed that nothing would ever read back. The event now follows
   * the write rather than predicting it.
   */
  write: (entityType: 'note' | 'pod' | 'agent' | 'task', id: string, data: any): boolean => {
    try {
      const key = `${filingPrefix()}${entityType}.${id}`;
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      return false;
    }
    routerNS.emit('filing:write', { entityType, id, data, ts: Date.now() });
    return true;
  },
  read: (entityType: string, id: string) => {
    try {
      const raw = localStorage.getItem(`${filingPrefix()}${entityType}.${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  /**
   * Every record the filing system holds, live and archived.
   *
   * There was no way to read these back without already knowing an id, so the
   * writes below piled up unseen. Enumerating the keys is what lets a person
   * look at their own filing cabinet.
   */
  list: (): FiledRecord[] => {
    const found: FiledRecord[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        // Order matters: the archive prefix extends the live one, so a key has
        // to be tested for archived first or every archived record reads as
        // live, filed under an entity type of "archived".
        const archived = key.startsWith(archivePrefix());
        const live = !archived && key.startsWith(filingPrefix());
        if (!live && !archived) continue;
        const [entityType, ...rest] = key.slice((archived ? archivePrefix() : filingPrefix()).length).split('.');
        const raw = localStorage.getItem(key) ?? '';
        let data: unknown = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        found.push({ key, entityType, id: rest.join('.'), archived, bytes: raw.length, data });
      }
    } catch { /* storage unavailable */ }
    return found.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.id.localeCompare(b.id));
  },
  /**
   * Archiving used to emit an event and leave the record exactly where it was,
   * so nothing was ever actually archived. It now moves the record out of the
   * live drawer and into the archive one, which is what the word promises.
   */
  archive: (entityType: string, id: string) => {
    routerNS.emit('filing:archive', { entityType, id });
    try {
      const key = `${filingPrefix()}${entityType}.${id}`;
      const raw = localStorage.getItem(key);
      if (raw === null) return false;
      localStorage.setItem(`${archivePrefix()}${entityType}.${id}`, raw);
      localStorage.removeItem(key);
      return true;
    } catch { return false; }
  },
  /** Puts an archived record back in the live drawer. */
  restore: (entityType: string, id: string) => {
    try {
      const key = `${archivePrefix()}${entityType}.${id}`;
      const raw = localStorage.getItem(key);
      if (raw === null) return false;
      localStorage.setItem(`${filingPrefix()}${entityType}.${id}`, raw);
      localStorage.removeItem(key);
      routerNS.emit('filing:write', { entityType, id, restored: true, ts: Date.now() });
      return true;
    } catch { return false; }
  },
};

export default routerNS;
