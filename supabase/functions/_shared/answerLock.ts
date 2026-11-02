/**
 * The q1A–q7A answer lock: pure logic, no Deno imports, so vitest runs this
 * exact file.
 *
 * Only a PBKDF2 fingerprint of each answer is kept, salted per slot and mixed
 * with a server-only pepper. A stolen table copy cannot be brute-forced
 * offline without that pepper, and the answer words never reach storage,
 * logs, or the browser after they are typed.
 */

export const SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;
export const ITERATIONS = 210_000;
export const MAX_FAILURES = 3;
export const LOCKOUT_MS = 15 * 60_000;
export const UNLOCK_MS = 10 * 60_000;
export const MIN_ANSWER = 2;
export const MAX_ANSWER = 200;

export const slotLabel = (slot: number) => `q${slot}A`;

/**
 * Case, spacing and Unicode lookalikes are folded so "34 " and "34" match —
 * the answer is a memory, not a typing test. Invisible characters are dropped
 * so a pasted answer cannot carry a hidden difference.
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function answerProblem(raw: unknown): string | null {
  if (typeof raw !== "string") return "Answer must be text.";
  const n = normalizeAnswer(raw);
  if (n.length < MIN_ANSWER) return `Answer needs at least ${MIN_ANSWER} characters.`;
  if (n.length > MAX_ANSWER) return `Answer is longer than ${MAX_ANSWER} characters.`;
  return null;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function fingerprint(
  answer: string,
  salt: string,
  pepper: string,
  iterations = ITERATIONS,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(`${normalizeAnswer(answer)}\u0000${pepper}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations },
    key,
    256,
  );
  return b64(new Uint8Array(bits));
}

/** Constant-time compare, so a near-miss takes as long as a far miss. */
export function sameFingerprint(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Rotates: never the same question twice in a row when another is set. */
export function pickSlot(set: number[], last: number | null, rand = Math.random): number | null {
  if (set.length === 0) return null;
  const pool = set.length > 1 ? set.filter((s) => s !== last) : set;
  return pool[Math.floor(rand() * pool.length)];
}

export interface LockState {
  failures: number;
  locked_until: string | null;
}

/** After a wrong answer: count it, and lock once the limit is reached. */
export function afterFailure(state: LockState, now: number): LockState {
  const failures = state.failures + 1;
  if (failures >= MAX_FAILURES) {
    return { failures: 0, locked_until: new Date(now + LOCKOUT_MS).toISOString() };
  }
  return { failures, locked_until: null };
}

export function isLocked(state: LockState | null, now: number): boolean {
  return !!state?.locked_until && Date.parse(state.locked_until) > now;
}
