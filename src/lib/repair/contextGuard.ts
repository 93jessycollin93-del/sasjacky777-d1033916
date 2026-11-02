// Context Guard — auto-saves terminal / chat context to the device BEFORE any
// model or provider switch, so a switch (or a rate-limit failover) can never
// take the working context with it.
//
// Storage is the same local Session Capture store used by the Repair Bay, so
// anything auto-saved here shows up in the Capture tab and can be handed back
// to the consultant.

import { loadCaptures, saveCaptures, newId, type SessionCapture } from "./repairStore";

const DRAFT_KEY = "jackie.repair.capture.draft.v1";
const MAX_AUTO = 40;
const MAX_BODY = 40_000;

export type GuardReason =
  | "provider-switch"
  | "model-switch"
  | "rate-limit-failover"
  | "manual-checkpoint";

export type GuardPayload = {
  reason: GuardReason;
  /** Provider/model we are leaving. */
  from?: string;
  /** Provider/model we are moving to. */
  to?: string;
  /** Why the switch happened (error text, user action). */
  detail?: string;
  /** The context itself: transcript, terminal output, prompt + partial reply. */
  body: string;
};

const REASON_LABEL: Record<GuardReason, string> = {
  "provider-switch": "Provider switch",
  "model-switch": "Model switch",
  "rate-limit-failover": "Rate-limit failover",
  "manual-checkpoint": "Manual checkpoint",
};

function autoTitle(p: GuardPayload) {
  const route = [p.from, p.to].filter(Boolean).join(" → ");
  return `[auto] ${REASON_LABEL[p.reason]}${route ? ` · ${route}` : ""} · ${new Date().toLocaleTimeString()}`;
}

/**
 * Persist a context snapshot. Returns the stored capture, or null when there
 * was nothing worth saving (empty body).
 */
export function captureContext(p: GuardPayload): SessionCapture | null {
  const body = p.body?.trim();
  if (!body) return null;

  const header = [
    `reason: ${REASON_LABEL[p.reason]}`,
    p.from ? `from: ${p.from}` : null,
    p.to ? `to: ${p.to}` : null,
    p.detail ? `detail: ${p.detail}` : null,
    `saved: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const row: SessionCapture = {
    id: newId(),
    createdAt: new Date().toISOString(),
    title: autoTitle(p),
    body: `${header}\n---\n${body.slice(0, MAX_BODY)}`,
  };

  const all = loadCaptures();
  // Cap the number of AUTO captures so the log never grows without bound.
  const autos = all.filter((c) => c.title.startsWith("[auto]"));
  const manual = all.filter((c) => !c.title.startsWith("[auto]"));
  const trimmedAutos = [row, ...autos].slice(0, MAX_AUTO);
  saveCaptures(
    [...trimmedAutos, ...manual].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  );
  return row;
}

/** Draft autosave for the capture editor, so a refresh doesn't eat a paste. */
export const loadDraft = (): { title: string; body: string } => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : { title: "", body: "" };
  } catch {
    return { title: "", body: "" };
  }
};

export const saveDraft = (title: string, body: string) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body }));
  } catch {
    /* storage blocked — keep the UI alive */
  }
};

export const clearDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Registry of live context providers. Any screen that holds a transcript
 * registers a getter; the guard pulls from all of them at switch time, so a
 * provider switch anywhere in the app captures whatever is on screen.
 */
type ContextSource = () => string;
const sources = new Map<string, ContextSource>();

export function registerContextSource(key: string, get: ContextSource) {
  sources.set(key, get);
  return () => {
    sources.delete(key);
  };
}

export function collectLiveContext(): string {
  const parts: string[] = [];
  for (const [key, get] of sources) {
    try {
      const v = get()?.trim();
      if (v) parts.push(`### ${key}\n${v}`);
    } catch {
      /* a broken source must not block the save */
    }
  }
  return parts.join("\n\n");
}

/** Convenience: snapshot every registered source before a switch. */
export function guardSwitch(
  reason: GuardReason,
  opts: { from?: string; to?: string; detail?: string; extra?: string } = {},
) {
  const body = [collectLiveContext(), opts.extra?.trim()].filter(Boolean).join("\n\n");
  return captureContext({ reason, from: opts.from, to: opts.to, detail: opts.detail, body });
}
