/**
 * Key rotation policy.
 *
 * Rotating a key is not "make a new key and delete the old one". The old secret
 * is already in something — a bot, a script, a device that is not in the room —
 * and deleting it the instant a replacement exists breaks every one of them
 * with a 403 and no explanation. But leaving it alive forever is not rotation
 * at all, it is just having two keys.
 *
 * So a rotation here is three facts written at once: the new key carries the
 * old one's identity (name, scopes, rate limit and every bot link), the old key
 * keeps working until a stated moment and not one second longer, and both rows
 * record which is which. That last part is what makes an audit trail readable a
 * year later — without it you have two keys and no idea that one replaced the
 * other.
 *
 * The decisions live here, apart from the database and the clock, so the cases
 * that matter — a grace period that has run out, a key old enough to be
 * overdue, a caller asking for a year-long grace — are pinned by tests rather
 * than discovered in production with a bot down.
 */

/** Longest grace period we will honour. A key that outlives this was not rotated. */
export const MAX_GRACE_HOURS = 168; // seven days

/** Default overlap: long enough to redeploy a bot, short enough to mean something. */
export const DEFAULT_GRACE_HOURS = 24;

/** A key older than this is reported overdue for rotation. */
export const ROTATION_DUE_DAYS = 90;

/** …and this is where overdue turns into "say it louder". */
export const ROTATION_STALE_DAYS = 180;

export interface RotationInput {
  /** Hours the retiring key keeps authenticating. 0 retires it immediately. */
  graceHours?: number;
  /** Now, in epoch ms. Passed in so the decision is testable. */
  now: number;
}

export interface RotationPlan {
  /** When the retiring key stops authenticating, as an ISO string. */
  expiresAt: string;
  /** The grace actually granted, after clamping. */
  graceHours: number;
  /** True when the old key is dead the moment the new one exists. */
  immediate: boolean;
  /** Set on the new row, so the lineage reads forwards and backwards. */
  rotatedAt: string;
}

/**
 * Works out when the retiring key dies.
 *
 * A grace period is a window in which two secrets both work, so it is clamped
 * rather than trusted: a caller asking for a year is asking for two live keys,
 * which is the state rotation exists to end.
 */
export function planRotation({ graceHours = DEFAULT_GRACE_HOURS, now }: RotationInput): RotationPlan {
  const requested = Number.isFinite(graceHours) ? graceHours : DEFAULT_GRACE_HOURS;
  const clamped = Math.min(MAX_GRACE_HOURS, Math.max(0, requested));
  return {
    graceHours: clamped,
    immediate: clamped === 0,
    expiresAt: new Date(now + clamped * 3600_000).toISOString(),
    rotatedAt: new Date(now).toISOString(),
  };
}

export interface KeyLifecycle {
  is_active: boolean;
  /** ISO string, or null for a key with no expiry. */
  expires_at?: string | null;
  created_at: string;
}

/**
 * Whether a key may still authenticate.
 *
 * `is_active` alone is not enough once grace periods exist: a retiring key stays
 * active on purpose, and the only thing standing between it and immortality is
 * this check. Authentication has to call it, or a grace period is decoration.
 */
export function isUsable(key: KeyLifecycle, now: number): boolean {
  if (!key.is_active) return false;
  if (!key.expires_at) return true;
  const expiry = Date.parse(key.expires_at);
  if (Number.isNaN(expiry)) return true; // unreadable expiry is not a reason to lock someone out
  return expiry > now;
}

export type RotationState = "fresh" | "due" | "stale" | "retiring" | "retired";

export interface RotationStatus {
  state: RotationState;
  /** Whole days since the key was issued. */
  ageDays: number;
  /** Hours left of a grace period, or null when the key is not retiring. */
  graceHoursLeft: number | null;
  /** One line for a person, saying what to do rather than what is stored. */
  detail: string;
}

/** How a key is doing, in the terms the panel shows and the tests assert. */
export function rotationStatus(key: KeyLifecycle, now: number): RotationStatus {
  const created = Date.parse(key.created_at);
  const ageDays = Number.isNaN(created) ? 0 : Math.floor((now - created) / 86_400_000);

  if (key.expires_at) {
    const expiry = Date.parse(key.expires_at);
    if (!Number.isNaN(expiry)) {
      const msLeft = expiry - now;
      if (msLeft <= 0) {
        return {
          state: "retired",
          ageDays,
          graceHoursLeft: 0,
          detail: "Replaced. This key no longer authenticates.",
        };
      }
      const graceHoursLeft = Math.ceil(msLeft / 3600_000);
      return {
        state: "retiring",
        ageDays,
        graceHoursLeft,
        detail: `Replaced. Still works for ${graceHoursLeft}h — move anything still using it before then.`,
      };
    }
  }

  if (!key.is_active) {
    return { state: "retired", ageDays, graceHoursLeft: null, detail: "Revoked." };
  }
  if (ageDays >= ROTATION_STALE_DAYS) {
    return {
      state: "stale",
      ageDays,
      graceHoursLeft: null,
      detail: `${ageDays} days old. Well past the ${ROTATION_DUE_DAYS}-day mark — rotate it.`,
    };
  }
  if (ageDays >= ROTATION_DUE_DAYS) {
    return {
      state: "due",
      ageDays,
      graceHoursLeft: null,
      detail: `${ageDays} days old. Due for rotation.`,
    };
  }
  return {
    state: "fresh",
    ageDays,
    graceHoursLeft: null,
    detail: `${ageDays} days old.`,
  };
}
