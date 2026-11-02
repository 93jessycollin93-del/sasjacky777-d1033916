/**
 * Jackie's morals and the guard rail around them, on the browser side.
 *
 * What lives where, and why:
 *  - The morals themselves are rows in `jackie_morals`, owner-only by RLS. The
 *    engines read them server-side; nothing here sends them to an engine.
 *  - Every change is chained into `jackie_morals_ledger` by a database trigger.
 *    This file re-verifies that chain from scratch on every check, because a
 *    verification the server did on its own behalf proves nothing to the owner.
 *  - The browser keeps a witness: the last ledger head it verified. A history
 *    that no longer contains it was rewritten, however well the new chain
 *    verifies on its own.
 *  - `assessIntegrity` turns all of it into the checks the page shows. It is
 *    pure, so every verdict the owner might see is covered by a test.
 *
 * Agents get none of this. No MCP tool and no in-app operator action reads or
 * writes the morals (a test enforces it): an agent able to edit the rules that
 * bind it would make them suggestions.
 */
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction, describeEdgeFailure } from "@/lib/edgeFunction";
import {
  buildMoralsBlock, MORAL_CATEGORIES, MORAL_LIMITS, moralsFingerprint, MORALS_UNAVAILABLE, PERSONA_ENGINES,
  type Moral, type MoralCategory,
} from "../../supabase/functions/_shared/morals";

export { buildMoralsBlock, MORAL_CATEGORIES, MORAL_LIMITS, PERSONA_ENGINES };
export type { Moral, MoralCategory };

// --- types ---------------------------------------------------------------------

export interface MoralRow extends Moral {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface LedgerRow {
  seq: number;
  at: string;
  actor: string | null;
  action: "create" | "update" | "delete" | "seal";
  moral_id: string | null;
  payload: string;
  prev_hash: string;
  hash: string;
}

export interface AttestationRow {
  engine: string;
  mode: "persona" | "persona-without-morals" | "override" | "rig";
  persona_fp: string;
  morals_fp: string;
  detail: string | null;
  first_seen: string;
  last_seen: string;
  requests: number;
}

export interface PersonaStatus {
  persona: { text: string; fingerprint: string };
  morals: { block: string; fingerprint: string; count: number; enabled: number; error?: string };
  engines: string[];
}

/** What a seal entry's payload holds. Written by the jackie-morals function. */
export interface SealRecord {
  seq: number;
  at: string;
  actor: string | null;
  persona_fp: string;
  persona_text: string;
  morals_fp: string;
  morals_block: string;
  note?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// tsconfig.app.json runs without strictNullChecks, where `if (!r.ok)` does not
// narrow these unions; reading the field through `in` does, in either mode.
export const errorOf = (r: Result<unknown>): string | null => ("error" in r ? r.error : null);

// user_roles and the jackie_morals* tables are not in the generated types until
// they are regenerated after `supabase db push`; the same cast JackieCore uses.
type Loose = { from: (t: string) => any };
const db = supabase as unknown as Loose;

// --- reading -------------------------------------------------------------------

/**
 * A missing table is the normal state until the migration has been pushed, and
 * the one the owner can fix — so it is recognised and named, not reported as a
 * generic failure that reads like tampering.
 */
export function isMissingTable(message: string): boolean {
  return /relation .* does not exist|could not find the table|schema cache|PGRST205|42P01/i.test(message);
}

async function select<T>(table: string, query: (q: any) => any): Promise<Result<T[]>> {
  try {
    const { data, error } = await query(db.from(table));
    if (error) return { ok: false, error: `${table}: ${error.message ?? String(error)}` };
    return { ok: true, data: (data ?? []) as T[] };
  } catch (e) {
    return { ok: false, error: `${table}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const loadMorals = () =>
  select<MoralRow>("jackie_morals", (q) => q.select("*").order("sort_order").order("created_at"));
// PostgREST caps a response at 1,000 rows. A ledger read in one request would
// stop at #1000 for good: every later seal and change invisible, and the
// witness — which by then points past the end — reporting a rewrite that never
// happened. So it is read a page at a time until a page comes back short.
const LEDGER_PAGE = 1000;
export async function loadLedger(): Promise<Result<LedgerRow[]>> {
  const all: LedgerRow[] = [];
  for (let from = 0; ; from += LEDGER_PAGE) {
    const page = await select<LedgerRow>("jackie_morals_ledger", (q) =>
      q.select("*").order("seq").range(from, from + LEDGER_PAGE - 1));
    if (!page.ok) return page;
    all.push(...page.data);
    if (page.data.length < LEDGER_PAGE) return { ok: true, data: all };
  }
}
export const loadAttestations = () =>
  select<AttestationRow>("jackie_persona_attestations", (q) => q.select("*").order("last_seen", { ascending: false }));

async function callMoralsFunction<T>(body: Record<string, unknown>): Promise<Result<T>> {
  try {
    const resp = await callEdgeFunction("jackie-morals", body);
    const parsed = (await resp.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!resp.ok || !parsed) {
      return { ok: false, error: parsed?.error ?? `jackie-morals answered HTTP ${resp.status}` };
    }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: describeEdgeFailure(e, "jackie-morals") };
  }
}

export const fetchStatus = () => callMoralsFunction<PersonaStatus>({ action: "status" });
/**
 * Seals exactly what the owner was shown. The function refuses if the persona
 * or morals moved in between — otherwise a deploy or an edit landing while the
 * dialog was open would be approved without ever having been seen.
 */
export const sealNow = (note: string, expected: { persona_fp: string; morals_fp: string }) =>
  callMoralsFunction<{ sealed: boolean; seq: number | null; hash: string | null }>({ action: "seal", note, expected });

// --- writing -------------------------------------------------------------------

export interface MoralDraft {
  title: string;
  rule: string;
  category: MoralCategory;
  enabled?: boolean;
}

/** The same limits the database enforces, checked first so the owner gets words, not an error code. */
export function validateMoral(d: MoralDraft): string | null {
  const title = d.title.trim();
  const rule = d.rule.trim();
  if (!title) return "Give the moral a short title.";
  if (title.length > MORAL_LIMITS.maxTitle) return `Keep the title to ${MORAL_LIMITS.maxTitle} characters.`;
  if (!rule) return "Write the rule Jackie should follow.";
  if (rule.length > MORAL_LIMITS.maxRule) {
    return `Keep the rule to ${MORAL_LIMITS.maxRule} characters — it rides on every message, including to small local models.`;
  }
  if (!(MORAL_CATEGORIES as readonly string[]).includes(d.category)) return "Pick a category.";
  return null;
}

async function write(run: () => any): Promise<Result<null>> {
  try {
    const { error } = await run();
    if (error) return { ok: false, error: error.message ?? String(error) };
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addMoral(d: MoralDraft, existing: readonly MoralRow[]): Promise<Result<null>> {
  const invalid = validateMoral(d);
  if (invalid) return { ok: false, error: invalid };
  if (existing.length >= MORAL_LIMITS.maxMorals) {
    return { ok: false, error: `Jackie can hold at most ${MORAL_LIMITS.maxMorals} morals. Disable or remove one first.` };
  }
  const sort_order = existing.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
  return write(() =>
    db.from("jackie_morals").insert({
      title: d.title.trim(), rule: d.rule.trim(), category: d.category, enabled: d.enabled ?? true, sort_order,
    }),
  );
}

export async function updateMoral(id: string, d: MoralDraft): Promise<Result<null>> {
  const invalid = validateMoral(d);
  if (invalid) return { ok: false, error: invalid };
  return write(() =>
    db.from("jackie_morals")
      .update({ title: d.title.trim(), rule: d.rule.trim(), category: d.category, enabled: d.enabled ?? true })
      .eq("id", id),
  );
}

export const setMoralEnabled = (id: string, enabled: boolean) =>
  write(() => db.from("jackie_morals").update({ enabled }).eq("id", id));

export const deleteMoral = (id: string) => write(() => db.from("jackie_morals").delete().eq("id", id));

/**
 * Moves one moral up or down by renumbering the whole list 1..n and writing
 * only the rows whose number changed. Swapping two numbers did nothing when the
 * two were equal — which is how a batch of suggestions arrives — and a swap
 * that failed half way left exactly such a tie behind. Each row written is one
 * ledger entry, which is honest: that many rows changed.
 */
export async function moveMoral(list: readonly MoralRow[], index: number, delta: -1 | 1): Promise<Result<null>> {
  const target = index + delta;
  if (target < 0 || target >= list.length) return { ok: true, data: null };
  const order = list.slice();
  [order[index], order[target]] = [order[target], order[index]];
  for (let i = 0; i < order.length; i++) {
    if (order[i].sort_order === i + 1) continue;
    const id = order[i].id;
    const res = await write(() => db.from("jackie_morals").update({ sort_order: i + 1 }).eq("id", id));
    if (!res.ok) return res;
  }
  return { ok: true, data: null };
}

/**
 * A starting set, offered and never inserted on its own. Each one says
 * something the persona does not already say, so adding them is not paying
 * twice for the same tokens on every message.
 */
export const SUGGESTED_MORALS: readonly MoralDraft[] = [
  { category: "honesty", title: "No deception, even kindly", rule: "Never deceive or manipulate the owner, even to comfort them or to make a task easier." },
  { category: "privacy", title: "Guard private data", rule: "Never share the owner's personal data, secrets or files with any person or service without their explicit go-ahead." },
  { category: "safety", title: "Ask before the irreversible", rule: "Before anything hard to undo (deleting, sending, paying, publishing), say exactly what will happen and wait for a clear yes." },
  { category: "care", title: "Wellbeing over engagement", rule: "Put the owner's long-term wellbeing ahead of keeping them engaged, and never encourage dependency on you." },
  { category: "fairness", title: "Fair to everyone", rule: "Treat every person fairly: no stereotypes, and no contempt for people the owner disagrees with." },
  { category: "safety", title: "Do no harm", rule: "Refuse to help harm people, and say plainly why rather than pretending you cannot." },
];

export async function addSuggested(existing: readonly MoralRow[]): Promise<Result<number>> {
  const have = new Set(existing.map((m) => m.title.trim().toLowerCase()));
  const fresh = SUGGESTED_MORALS.filter((m) => !have.has(m.title.toLowerCase()));
  const room = MORAL_LIMITS.maxMorals - existing.length;
  const batch = fresh.slice(0, Math.max(0, room));
  if (batch.length === 0) return { ok: true, data: 0 };
  let order = existing.reduce((m, r) => Math.max(m, r.sort_order), 0);
  const res = await write(() =>
    db.from("jackie_morals").insert(batch.map((m) => ({ ...m, enabled: true, sort_order: ++order }))),
  );
  return res.ok ? { ok: true, data: batch.length } : res;
}

// --- the ledger ------------------------------------------------------------------

export const GENESIS = "genesis";

async function sha256Hex(text: string): Promise<string> {
  // crypto.subtle exists only in secure contexts. Over plain http on the LAN it
  // is missing, and without this the page sat on "Checking…" for ever.
  if (!globalThis.crypto?.subtle) {
    throw new Error("This page needs a secure connection (https or localhost) to verify the history — the browser withholds its hashing on plain http.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mirrors private.jackie_morals_append in the migration exactly. A golden
 * vector captured from PostgreSQL pins the two together in the tests.
 */
export function ledgerHash(prevHash: string, seq: number, action: string, payload: string): Promise<string> {
  return sha256Hex(`${prevHash}\n${seq}\n${action}\n${payload}`);
}

export function parsePayload(row: Pick<LedgerRow, "payload">): Record<string, unknown> {
  try {
    const v = JSON.parse(row.payload);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Who made an entry and when, from the hashed record rather than the unhashed columns. */
export function signedOf(row: Pick<LedgerRow, "payload" | "actor" | "at">): { actor: string | null; at: string } {
  const p = parsePayload(row);
  return {
    actor: typeof p.actor === "string" ? p.actor : null,
    at: typeof p.at === "string" ? p.at : row.at,
  };
}

// --- what this browser remembers -------------------------------------------------------

/**
 * The witness is the last head this browser verified; a history that no longer
 * contains it was rewritten. The anchor is where the owner, after looking into
 * a break or a rewrite, chose to start trusting again: verification restarts
 * from it, and seals and morals from before it are not relied on. Without an
 * anchor, one broken entry would keep the page red for the life of the table.
 *
 * Both live in this browser only. Storage can be missing or throw (private
 * windows, blocked site data); the page then checks everything else and simply
 * cannot remember.
 */
export interface Witness { seq: number; hash: string; at: string }
export interface Anchor extends Witness {
  /** The morals as they stood when the owner re-anchored: the replay starts here. */
  morals: Moral[];
}
const WITNESS_KEY = "jackie-morals-witness:v1";
const ANCHOR_KEY = "jackie-morals-anchor:v1";

function readStored<T>(key: string, valid: (v: any) => boolean): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return valid(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
function writeStored(key: string, value: unknown | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const isWitness = (w: any) => typeof w?.seq === "number" && typeof w?.hash === "string";
export const readWitness = () => readStored<Witness>(WITNESS_KEY, isWitness);
export const writeWitness = (w: Witness | null) => writeStored(WITNESS_KEY, w);
export const readAnchor = () => readStored<Anchor>(ANCHOR_KEY, (a) => isWitness(a) && Array.isArray(a.morals));
export const writeAnchor = (a: Anchor | null) => writeStored(ANCHOR_KEY, a);

export type ChainVerdict =
  | { ok: true; count: number; head: { seq: number; hash: string } | null; anchoredAt: number | null }
  | { ok: false; count: number; brokenAt: number; reason: string };

type VerifiableRow = Pick<LedgerRow, "seq" | "action" | "payload" | "prev_hash" | "hash"> & Partial<Pick<LedgerRow, "actor" | "at">>;

/**
 * Recomputes every link. Catches an entry edited in place (its hash no longer
 * matches), one removed or reordered (the next entry's prev_hash points at
 * something else, or the numbering skips), a new first entry slipped in front
 * (it would have to start from genesis), and an edited `actor` or `at` column
 * (those sit outside the hash; their hashed copies are in the payload).
 *
 * With an anchor, entries up to it are taken as the owner accepted them and
 * checking starts from the anchor's own hash — which must still be there.
 */
export async function verifyLedger(rows: readonly VerifiableRow[], anchor: Pick<Anchor, "seq" | "hash"> | null = null): Promise<ChainVerdict> {
  let prev = GENESIS;
  let expectSeq = 1;
  let start = 0;
  if (anchor) {
    const at = rows.findIndex((r) => r.seq === anchor.seq);
    if (at < 0 || rows[at].hash !== anchor.hash) {
      return { ok: false, count: rows.length, brokenAt: anchor.seq, reason: `entry #${anchor.seq}, where you chose to trust the history from, is gone or changed` };
    }
    prev = anchor.hash;
    expectSeq = anchor.seq + 1;
    start = at + 1;
  }
  for (const row of rows.slice(start)) {
    if (row.seq !== expectSeq) {
      return { ok: false, count: rows.length, brokenAt: row.seq, reason: `entry #${expectSeq} is missing — the numbering jumps to #${row.seq}` };
    }
    if (row.prev_hash !== prev) {
      return { ok: false, count: rows.length, brokenAt: row.seq, reason: `entry #${row.seq} does not follow the entry before it` };
    }
    const actual = await ledgerHash(row.prev_hash, row.seq, row.action, row.payload);
    if (actual !== row.hash) {
      return { ok: false, count: rows.length, brokenAt: row.seq, reason: `entry #${row.seq} was changed after it was written` };
    }
    const signed = signedOf({ payload: row.payload, actor: row.actor ?? null, at: row.at ?? "" });
    if (row.actor !== undefined && row.actor !== signed.actor) {
      return { ok: false, count: rows.length, brokenAt: row.seq, reason: `entry #${row.seq}'s account was changed after it was written` };
    }
    if (row.at !== undefined && Date.parse(row.at) !== Date.parse(signed.at)) {
      return { ok: false, count: rows.length, brokenAt: row.seq, reason: `entry #${row.seq}'s time was changed after it was written` };
    }
    prev = row.hash;
    expectSeq += 1;
  }
  const last = rows[rows.length - 1];
  return { ok: true, count: rows.length, head: last ? { seq: last.seq, hash: last.hash } : null, anchoredAt: anchor?.seq ?? null };
}

export function latestSeal(rows: readonly LedgerRow[], afterSeq = 0): SealRecord | null {
  for (let i = rows.length - 1; i >= 0 && rows[i].seq > afterSeq; i--) {
    if (rows[i].action !== "seal") continue;
    const p = parsePayload(rows[i]);
    if (typeof p.persona_fp !== "string" || typeof p.morals_fp !== "string") continue;
    return {
      seq: rows[i].seq,
      ...signedOf(rows[i]),
      persona_fp: p.persona_fp,
      persona_text: typeof p.persona_text === "string" ? p.persona_text : "",
      morals_fp: p.morals_fp,
      morals_block: typeof p.morals_block === "string" ? p.morals_block : "",
      note: typeof p.note === "string" ? p.note : undefined,
    };
  }
  return null;
}

export type WitnessVerdict =
  | { state: "none" }
  | { state: "ok" }
  | { state: "shorter"; witnessed: Witness; headSeq: number }
  | { state: "rewritten"; witnessed: Witness };

export function checkWitness(witness: Witness | null, rows: readonly Pick<LedgerRow, "seq" | "hash">[]): WitnessVerdict {
  if (!witness) return { state: "none" };
  const headSeq = rows.length ? rows[rows.length - 1].seq : 0;
  if (witness.seq > headSeq) return { state: "shorter", witnessed: witness, headSeq };
  const same = rows.find((r) => r.seq === witness.seq);
  if (!same || same.hash !== witness.hash) return { state: "rewritten", witnessed: witness };
  return { state: "ok" };
}

// --- replaying the morals from their history -----------------------------------------

export interface MoralsReplay {
  /** The morals block the history says is in force now. */
  fingerprint: string;
  block: string;
  /** Each morals fingerprint and when it took effect, oldest first. */
  timeline: { fp: string; from: number }[];
}

const asMoral = (v: unknown): (Moral & { id: string }) | null => {
  const m = v as Record<string, unknown> | null;
  if (!m || typeof m.id !== "string" || typeof m.title !== "string" || typeof m.rule !== "string") return null;
  return {
    id: m.id, title: m.title, rule: m.rule, category: m.category as MoralCategory,
    enabled: m.enabled === true, sort_order: Number(m.sort_order) || 0,
  };
};

/**
 * Rebuilds the morals from the ledger alone, entry by entry. Two uses:
 *  - its end state must match the morals table. Every write fires the trigger,
 *    so a table that differs from its own history was changed with the
 *    triggers off — the one tamper the chain itself cannot show.
 *  - its timeline says which morals were in force at any moment, so an engine
 *    that answered with yesterday's morals yesterday is told apart from one that
 *    used morals nobody ever set.
 */
export async function replayMorals(rows: readonly LedgerRow[], anchor: Anchor | null = null): Promise<MoralsReplay> {
  const state = new Map<string, Moral>();
  for (const m of anchor?.morals ?? []) {
    const parsed = asMoral(m);
    if (parsed) state.set(parsed.id, parsed);
  }
  const blockNow = () => buildMoralsBlock([...state.values()]);
  let block = blockNow();
  let fp = await moralsFingerprint(block);
  const timeline = [{ fp, from: Number.NEGATIVE_INFINITY }];
  for (const row of rows) {
    if (anchor && row.seq <= anchor.seq) continue;
    if (row.action === "seal") continue;
    const p = parsePayload(row);
    const after = asMoral(p.after);
    const before = asMoral(p.before);
    if (row.action === "delete") {
      if (before) state.delete(before.id);
    } else if (after) {
      state.set(after.id, after);
    }
    const nextBlock = blockNow();
    if (nextBlock === block) continue;
    block = nextBlock;
    fp = await moralsFingerprint(block);
    timeline.push({ fp, from: Date.parse(signedOf(row).at) });
  }
  return { fingerprint: fp, block, timeline };
}

/** Whether `fp` was the morals in force at some moment in (`at` − window, `at`]. */
export function wasInForce(timeline: MoralsReplay["timeline"], fp: string, at: number, windowMs: number): boolean {
  for (let i = 0; i < timeline.length; i++) {
    const from = timeline[i].from;
    const until = i + 1 < timeline.length ? timeline[i + 1].from : Number.POSITIVE_INFINITY;
    if (timeline[i].fp === fp && from <= at && until + windowMs >= at) return true;
  }
  return false;
}

// --- diffs ---------------------------------------------------------------------

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/** Line diff by longest common subsequence. The persona is ~150 lines; quadratic is fine. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  while (i < n) out.push({ kind: "removed", text: a[i++] });
  while (j < m) out.push({ kind: "added", text: b[j++] });
  return out;
}

// --- the assessment -------------------------------------------------------------------

export type CheckState = "ok" | "info" | "warn" | "fail";

export interface Check {
  id: string;
  state: CheckState;
  title: string;
  summary: string;
}

export interface EngineReport {
  engine: string;
  state: CheckState;
  summary: string;
  lastSeen: string | null;
  personaFp: string | null;
  moralsFp: string | null;
  overrideRequests: number;
}

export interface Assessment {
  verdict: CheckState | "setup";
  headline: string;
  checks: Check[];
  engines: EngineReport[];
  seal: SealRecord | null;
  chain: ChainVerdict | null;
  witness: WitnessVerdict;
  /** Ledger entries after the seal that changed a moral. */
  changesSinceSeal: LedgerRow[];
}

export interface AssessmentInput {
  status: Result<PersonaStatus>;
  ledger: Result<LedgerRow[]>;
  attestations: Result<AttestationRow[]>;
  chain: ChainVerdict | null;
  witness: WitnessVerdict;
  /** The morals rebuilt from the ledger; null when the ledger could not be read or verified. */
  replay?: MoralsReplay | null;
  /** True when this browser has verified a ledger here before (it holds a witness or an anchor). */
  seenBefore?: boolean;
  /** How long after a change an engine may still use the old morals (its cache, plus slack). */
  propagationMs?: number;
}

const RANK: Record<CheckState, number> = { ok: 0, info: 0, warn: 1, fail: 2 };
const worst = (states: CheckState[]): CheckState =>
  states.reduce<CheckState>((w, s) => (RANK[s] > RANK[w] ? s : w), "ok");
const short = (fp: string) => (fp.length < 32 ? fp : fp.slice(0, 12));
const when = (iso: string | number) => new Date(iso).toLocaleString();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function assessIntegrity(input: AssessmentInput): Assessment {
  const propagationMs = input.propagationMs ?? 30_000;
  const checks: Check[] = [];
  const missing = [input.ledger, input.attestations].map(errorOf).some((e) => e !== null && isMissingTable(e))
    || (input.status.ok && !!input.status.data.morals.error && isMissingTable(input.status.data.morals.error));

  if (missing) {
    // Tables that this browser has already verified do not un-exist on their
    // own. "Not set up" would be a comfortable lie about a dropped ledger.
    const gone = !!input.seenBefore;
    return {
      verdict: gone ? "fail" : "setup",
      headline: gone
        ? "The guard rail's own tables are gone."
        : "The guard rail is built but not switched on yet.",
      checks: [gone
        ? {
            id: "setup", state: "fail", title: "Guard rail tables missing",
            summary: "This browser has verified the morals history here before, and now the database says the tables do not exist. Someone with database access dropped them, or the project was reset. Nothing about Jackie's morals can be trusted until you find out which.",
          }
        : {
            id: "setup", state: "warn", title: "Database not set up",
            summary: "The morals tables do not exist in the database yet. Run `supabase db push`, then deploy the functions, and reload this page. Until then every engine answers on the base persona and says so.",
          }],
      engines: [],
      seal: null,
      chain: null,
      witness: input.witness,
      changesSinceSeal: [],
    };
  }

  // The ledger, then the witness: everything after leans on the history being sound.
  const rows = input.ledger.ok ? input.ledger.data : [];
  const broken = !!input.chain && "reason" in input.chain;
  const anchoredAt = input.chain && "anchoredAt" in input.chain ? input.chain.anchoredAt : null;
  if (!input.ledger.ok) {
    checks.push({ id: "chain", state: "fail", title: "Change history", summary: `Could not read the ledger: ${errorOf(input.ledger)}` });
  } else if (input.chain && "reason" in input.chain) {
    checks.push({
      id: "chain", state: "fail", title: "Change history",
      summary: `Tampered: ${input.chain.reason}. Nothing written through the app can do this — it takes direct database access. Once you know why, you can choose to trust the history from its current end.`,
    });
  } else {
    checks.push({
      id: "chain", state: "ok", title: "Change history",
      summary: (rows.length
        ? `${plural(rows.length, "entry", "entries")}, every hash checks out against the one before it.`
        : "Empty so far. Every change from now on is chained.")
        + (anchoredAt ? ` Checked from entry #${anchoredAt}, where you chose to trust it from.` : ""),
    });
  }

  const w = input.witness;
  if (w.state === "none") {
    checks.push({
      id: "witness", state: "info", title: "This browser's memory of the history",
      summary: "First check from this browser. From now on it remembers the latest entry, and will notice if the history is ever rewritten behind it.",
    });
  } else if (w.state === "shorter") {
    checks.push({
      id: "witness", state: "fail", title: "This browser's memory of the history",
      summary: `Rewritten: this browser last saw entry #${w.witnessed.seq} (${when(w.witnessed.at)}), and the history now ends at #${w.headSeq}. Entries were removed.`,
    });
  } else if (w.state === "rewritten") {
    checks.push({
      id: "witness", state: "fail", title: "This browser's memory of the history",
      summary: `Rewritten: entry #${w.witnessed.seq} is not the one this browser verified on ${when(w.witnessed.at)}. The history was replaced with one that only looks consistent.`,
    });
  } else {
    checks.push({
      id: "witness", state: "ok", title: "This browser's memory of the history",
      summary: "The history still contains the latest entry this browser verified, unchanged.",
    });
  }

  const status = input.status.ok ? input.status.data : null;
  if (!input.status.ok) {
    checks.push({ id: "status", state: "fail", title: "Live persona", summary: `Could not ask the server what Jackie is running: ${errorOf(input.status)}` });
  }

  // The morals table against its own history.
  const replay = !broken && input.ledger.ok ? input.replay ?? null : null;
  if (replay && status && !status.morals.error) {
    checks.push(replay.fingerprint === status.morals.fingerprint
      ? { id: "replay", state: "ok", title: "Morals against their history", summary: "Rebuilding your morals from the history gives exactly what the database holds now." }
      : {
          id: "replay", state: "fail", title: "Morals against their history",
          summary: "Your morals in the database are not what their history says they should be. They were changed with the history's triggers switched off — something only direct database access can do.",
        });
  }

  // The seal, and what has moved since. Nothing from before an anchor is relied on.
  const seal = input.ledger.ok && !broken ? latestSeal(rows, anchoredAt ?? 0) : null;
  const trustedFrom = Math.max(seal?.seq ?? 0, anchoredAt ?? 0);
  const changesSinceSeal = rows.filter((r) => r.seq > trustedFrom && r.action !== "seal");

  // Writes with no account behind them. Those after the seal are live findings;
  // the seal itself is the owner's word on everything before it.
  if (!broken) {
    const outside = rows.filter((r) => signedOf(r).actor === null);
    const fresh = outside.filter((r) => r.seq > trustedFrom);
    const acknowledged = outside.length - fresh.length;
    if (fresh.length) {
      checks.push({
        id: "outside", state: "fail", title: "Changes made outside the app",
        summary: `${plural(fresh.length, "change was", "changes were")} made with no signed-in account — the service role, the SQL editor or a migration (${fresh.map((r) => `#${r.seq}`).join(", ")}). If you did not make ${fresh.length === 1 ? "it" : "them"}, someone with database access did. Sealing again records that you accept ${fresh.length === 1 ? "it" : "them"}.`,
      });
    } else if (acknowledged) {
      checks.push({
        id: "outside", state: "info", title: "Changes made outside the app",
        summary: `${plural(acknowledged, "earlier change", "earlier changes")} had no account behind ${acknowledged === 1 ? "it" : "them"}, before your seal or the point you chose to trust from. You accepted ${acknowledged === 1 ? "it" : "them"} there.`,
      });
    }
  }

  if (broken) {
    checks.push({
      id: "seal", state: "fail", title: "Your seal",
      summary: "No seal can be relied on while the history is broken. Once you have looked into it, trust the history from its current end, then seal again.",
    });
  } else if (!seal) {
    checks.push({
      id: "seal", state: "warn", title: "Your seal",
      summary: anchoredAt
        ? "Nothing sealed since you chose to trust the history again. Review the persona and your morals, then seal them."
        : "Nothing sealed yet. Review the persona and your morals below, then seal them — every later change is measured from that point.",
    });
  } else if (status) {
    checks.push(status.persona.fingerprint === seal.persona_fp
      ? { id: "persona", state: "ok", title: "Jackie's persona", summary: `Matches what you sealed on ${when(seal.at)}.` }
      : {
          id: "persona", state: "fail", title: "Jackie's persona",
          summary: `Changed since you sealed it on ${when(seal.at)} (was ${short(seal.persona_fp)}, now ${short(status.persona.fingerprint)}). This comes from code, so a deploy changed it: the Persona tab shows exactly what. If the change is yours, seal again.`,
        });
    if (status.morals.error) {
      checks.push({ id: "morals", state: "fail", title: "Your morals", summary: status.morals.error });
    } else if (status.morals.fingerprint === seal.morals_fp) {
      checks.push({ id: "morals", state: "ok", title: "Your morals", summary: `Match what you sealed on ${when(seal.at)}.` });
    } else {
      checks.push({
        id: "morals", state: "fail", title: "Your morals",
        summary: `Changed since you sealed them: ${plural(changesSinceSeal.length, "change", "changes")} after seal #${seal.seq}. History shows who made each one and Persona shows the difference; if they are yours, seal again.`,
      });
    }
  }

  // The engines: what each one actually ran.
  const engines: EngineReport[] = [];
  const atts = input.attestations.ok ? input.attestations.data : [];
  if (!input.attestations.ok) {
    checks.push({ id: "engines", state: "fail", title: "Engine reports", summary: `Could not read what the engines reported: ${errorOf(input.attestations)}` });
  }
  const names = Array.from(new Set([...(status?.engines ?? PERSONA_ENGINES), ...atts.map((a) => a.engine)]));
  const sealAt = seal ? Date.parse(seal.at) : null;
  const currentMorals = status && !status.morals.error ? status.morals.fingerprint : null;

  // An engine's morals: current, the ones in force when it answered, or neither.
  const judgeMorals = (fp: string, lastSeen: number): { state: CheckState; text: string } => {
    if (currentMorals === null) return { state: "info", text: "Its morals cannot be compared: the live morals could not be read." };
    if (fp === currentMorals) return { state: "ok", text: "your current morals" };
    if (replay && wasInForce(replay.timeline, fp, lastSeen, propagationMs)) {
      return { state: "info", text: "the morals in force at the time — it has not answered since your latest change" };
    }
    if (!replay) return { state: "warn", text: `morals that differ from the current ones (${short(fp)}); without a verified history it cannot be told whether they were ever yours` };
    return { state: "fail", text: `morals that were never yours at that time (${short(fp)})` };
  };

  for (const engine of names) {
    const mine = atts.filter((a) => a.engine === engine);
    const personaRows = mine.filter((a) => a.mode !== "override").sort((x, y) => Date.parse(y.last_seen) - Date.parse(x.last_seen));
    const overrides = mine.filter((a) => a.mode === "override");
    const overrideRequests = overrides.reduce((n, a) => n + Number(a.requests), 0);
    const latest = personaRows[0] ?? null;
    let state: CheckState = "info";
    let summary: string;

    if (!latest) {
      summary = overrideRequests
        ? "Has only answered with a caller's own system prompt, never Jackie's persona."
        : "No requests recorded yet.";
    } else {
      const lastSeen = Date.parse(latest.last_seen);
      const beforeSeal = sealAt !== null && lastSeen < sealAt;
      if (latest.mode === "persona-without-morals" || latest.morals_fp === MORALS_UNAVAILABLE) {
        state = "fail";
        summary = `Answered without your morals on ${when(latest.last_seen)}: ${latest.detail ?? "it could not load them"}.`;
      } else if (latest.mode === "rig") {
        // Jacky's persona lives on the rig, where this app cannot fingerprint
        // it; only the morals put in front of its prompt are checked. Said
        // outright, so the missing persona check is not mistaken for a pass.
        const m = judgeMorals(latest.morals_fp, lastSeen);
        state = m.state;
        summary = (m.state === "info" && currentMorals === null ? m.text : `Last answered on ${when(latest.last_seen)} with ${m.text} in front of its prompt.`)
          + " Its persona is the rig's own, which this app cannot see or fingerprint.";
      } else if (seal && latest.persona_fp !== seal.persona_fp) {
        state = beforeSeal ? "info" : "fail";
        summary = beforeSeal
          ? `Last answered on ${when(latest.last_seen)}, before your latest seal, with persona ${short(latest.persona_fp)}. Its next answer will show whether it runs what you sealed.`
          : `Running a persona you did not seal (${short(latest.persona_fp)}) since ${when(latest.first_seen)}. Its deployed code differs from what you approved.`;
      } else if (!seal && status && latest.persona_fp !== status.persona.fingerprint) {
        state = "warn";
        summary = `Its last answer (${when(latest.last_seen)}) used a different persona (${short(latest.persona_fp)}) from the one live now: either it answered before the latest deploy, or it runs different code.`;
      } else {
        const m = judgeMorals(latest.morals_fp, lastSeen);
        state = m.state;
        summary = m.state === "info" && currentMorals === null
          ? m.text
          : `Answered with ${seal ? "the sealed" : "the live"} persona and ${m.text}, last on ${when(latest.last_seen)} (${plural(Number(latest.requests), "request", "requests")} with this setup).`;
      }
    }
    if (overrideRequests && latest) {
      summary += ` Also ${plural(overrideRequests, "request", "requests")} with a caller's own system prompt (Agent Lab, operators) — your morals are not added to those.`;
    }
    engines.push({
      engine, state, summary,
      lastSeen: latest?.last_seen ?? overrides[0]?.last_seen ?? null,
      personaFp: latest?.persona_fp ?? null,
      moralsFp: latest?.morals_fp ?? null,
      overrideRequests,
    });
  }

  const verdict = worst([...checks.map((c) => c.state), ...engines.map((e) => e.state)]);
  // "Confirmed" only by engines that answered after the seal: a report from
  // before it confirms nothing about what was sealed. Claiming otherwise is the
  // success-when-nothing-happened this repo keeps having to unlearn.
  const confirming = engines.filter((e) => e.state === "ok" && e.lastSeen && (sealAt === null || Date.parse(e.lastSeen) >= sealAt)).length;
  const headline =
    verdict === "fail" ? "Something changed that you did not approve, or could not be verified."
      : verdict === "warn" ? "Nothing looks tampered with, but it is not fully under watch yet."
        : confirming === 0 ? "Intact so far: everything matches your seal. No engine has answered since, so none has confirmed it yet."
          : `Intact: everything matches what you sealed, confirmed by ${plural(confirming, "engine", "engines")} that answered since.`;
  return { verdict, headline, checks, engines, seal, chain: input.chain, witness: input.witness, changesSinceSeal };
}
