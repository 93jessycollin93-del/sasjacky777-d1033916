/**
 * Chat that survives the reload, one thread per model.
 *
 * `/micro` kept its conversation in React state, so every reload threw the
 * thread away — which makes comparing two models on the same question a thing
 * you cannot do, because the first half of the comparison is gone by the time
 * you have the second. Each model gets its own thread here, because switching
 * model is not the same act as starting a new conversation.
 *
 * Storage is per-viewer and can refuse a write for reasons that have nothing to
 * do with this app: a private window, blocked site data, a full quota. Every
 * read and write is guarded, and — the part that matters — a write that did not
 * land says so rather than letting a screen full of messages imply they are
 * saved. Notes that vanish at the reload that was supposed to restore them is
 * the exact failure this file exists to avoid.
 */
export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  /** What actually answered, when that differs from what was asked. */
  servedBy?: string;
  /** Set on an assistant turn that failed, so a thread records its own gaps. */
  error?: boolean;
}

export interface ChatThread {
  /** The backend:model pair this thread belongs to. */
  key: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const PREFIX = "jacky.microai.chat.v1.";
/** Enough to keep a session's worth of context without letting one thread eat the quota. */
export const MAX_MESSAGES = 200;

export function threadKey(backendId: string, modelId: string): string {
  return `${backendId}:${modelId}`;
}

export function newMessageId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function storageKey(key: string): string {
  return `${PREFIX}${key}`;
}

/** Reads a thread back. An unreadable or corrupt one is an empty thread, never a throw. */
export function loadThread(key: string): ChatThread {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return { key, messages: [], updatedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<ChatThread>;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(
          (m): m is ChatMessage =>
            !!m && typeof m === "object" && typeof m.text === "string" && typeof m.role === "string",
        )
      : [];
    return { key, messages, updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0 };
  } catch {
    return { key, messages: [], updatedAt: 0 };
  }
}

/**
 * Writes a thread, and says whether it landed.
 *
 * The boolean is the point. A caller that ignores it is back to a screen that
 * looks saved and is not.
 */
export function saveThread(key: string, messages: ChatMessage[]): boolean {
  const trimmed = messages.slice(-MAX_MESSAGES);
  try {
    localStorage.setItem(
      storageKey(key),
      JSON.stringify({ key, messages: trimmed, updatedAt: Date.now() } satisfies ChatThread),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearThread(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* nothing to clear if storage will not answer */
  }
}

/** Every thread on this device, newest first — the history panel's list. */
export function listThreads(): ChatThread[] {
  const found: ChatThread[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i);
      if (!raw?.startsWith(PREFIX)) continue;
      const thread = loadThread(raw.slice(PREFIX.length));
      if (thread.messages.length) found.push(thread);
    }
  } catch {
    /* storage unavailable — an empty list is the honest answer */
  }
  return found.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Removes every stored thread. Used by the panel's clear-all. */
export function clearAllThreads(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.key(i);
      if (raw?.startsWith(PREFIX)) keys.push(raw);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* nothing to clear if storage will not answer */
  }
}

/** A one-line label for a thread in the history list. */
export function threadSummary(thread: ChatThread): string {
  const firstUser = thread.messages.find((m) => m.role === "user");
  const text = (firstUser?.text ?? thread.messages[0]?.text ?? "").replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "(empty)";
}
