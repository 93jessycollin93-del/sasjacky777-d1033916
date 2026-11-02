/**
 * The /skills page's data: the person writing, approving and reviewing what
 * their agents use.
 *
 * Agents go through appActions.ts and can only propose. Here the person is
 * acting for themselves, from the app's own session, so they can write active
 * skills and tools, approve proposals and archive or delete — the database's
 * agent rule does not apply to a session with no OAuth client behind it.
 */
import { supabase } from "@/integrations/supabase/client";
import { runCustomTool, type ActionResult } from "@/lib/appActions";
import { callEdgeFunction, describeEdgeFailure } from "@/lib/edgeFunction";
import { normalizeBaseUrl, validateConnectionSpec, type ConnectionSpec } from "../../supabase/functions/_shared/connections";
import {
  validateSkill, validateToolSpec, type SkillSpec, type ToolParam, type ToolSpec, type ToolStep,
} from "@/lib/customTools";

export type Status = "proposed" | "active" | "archived";

export interface SkillRow extends SkillSpec {
  id: string;
  status: Status;
  proposed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolRow extends ToolSpec {
  id: string;
  status: Status;
  proposed_by: string | null;
  params: ToolParam[];
  steps: ToolStep[];
  created_at: string;
  updated_at: string;
}

export interface ActivityRow {
  id: string;
  ts: string;
  action: string;
  actor: string;
  details: Record<string, unknown> | null;
  result: "success" | "denied" | "error";
}

// The new tables are not in the generated types until they are regenerated
// after `supabase db push`; the same cast the other owner pages use.
type Loose = { from: (t: string) => any };
const db = supabase as unknown as Loose;

async function me(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function run<T>(q: () => any): Promise<ActionResult<T>> {
  try {
    const { data, error } = await q();
    if (error) return { ok: false, error: friendly(error.message ?? String(error)) };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function friendly(message: string): string {
  if (/duplicate key|unique/i.test(message)) return "That name is already taken by another skill or tool of yours.";
  if (/relation .* does not exist|schema cache|PGRST205/i.test(message)) {
    return "The skills tables are not in the database yet. Run `supabase db push`, then reload.";
  }
  return message;
}

export const loadSkills = () =>
  run<SkillRow[]>(() => db.from("jackie_skills").select("*").order("status").order("name"));
export const loadTools = () =>
  run<ToolRow[]>(() => db.from("jackie_custom_tools").select("*").order("status").order("name"));

/**
 * What agents did with skills, tools and connections, newest first, from the
 * person's own audit trail. Pinned to them explicitly: row-level security lets
 * an owner or auditor read every account's trail, and without the pin this tab
 * showed other people's agents as the owner's own.
 */
export async function loadActivity(): Promise<ActionResult<ActivityRow[]>> {
  const userId = await me();
  if (!userId) return { ok: false, error: "You are signed out. Sign in and try again." };
  return run<ActivityRow[]>(() =>
    db.from("audit_events")
      .select("id,ts,action,actor,details,result")
      .eq("user_id", userId)
      .or("action.like.skill.%,action.like.tool.%,action.like.connection.%")
      .order("ts", { ascending: false })
      .limit(50));
}

export async function saveSkill(spec: SkillSpec, id?: string): Promise<ActionResult<null>> {
  const problem = validateSkill(spec);
  if (problem) return { ok: false, error: problem };
  const row = { name: spec.name, title: spec.title.trim(), description: spec.description.trim(), body: spec.body.trim() };
  if (id) return run(() => db.from("jackie_skills").update(row).eq("id", id));
  const userId = await me();
  if (!userId) return { ok: false, error: "You are signed out. Sign in and try again." };
  return run(() => db.from("jackie_skills").insert({ ...row, user_id: userId, status: "active" }));
}

export async function saveTool(spec: ToolSpec, id?: string): Promise<ActionResult<null>> {
  const problem = validateToolSpec(spec);
  if (problem) return { ok: false, error: problem };
  const row = { name: spec.name, description: spec.description.trim(), params: spec.params, steps: spec.steps };
  if (id) return run(() => db.from("jackie_custom_tools").update(row).eq("id", id));
  const userId = await me();
  if (!userId) return { ok: false, error: "You are signed out. Sign in and try again." };
  return run(() => db.from("jackie_custom_tools").insert({ ...row, user_id: userId, status: "active" }));
}

type Table = "jackie_skills" | "jackie_custom_tools" | "jackie_connections";

export const setStatus = (table: Table, id: string, status: Status) =>
  run<null>(() => db.from(table).update({ status }).eq("id", id));

/**
 * Switches a proposal (or an archived row) on — after checking it the way the
 * page checks what the person writes. The database accepts some shapes the
 * app refuses, and a row written around the app can be one of them; approving
 * it blind would hand every agent something that cannot run.
 */
export function activate(table: Table, row: SkillRow | ToolRow | ConnectionRow): Promise<ActionResult<null>> {
  const problem = table === "jackie_skills" ? validateSkill(row as SkillRow)
    : table === "jackie_custom_tools" ? validateToolSpec(row as ToolRow)
      : validateConnectionSpec(row as ConnectionRow);
  if (problem) return Promise.resolve({ ok: false, error: `Not switched on: ${problem}` });
  return setStatus(table, row.id, "active");
}

export const remove = (table: Table, id: string) =>
  run<null>(() => db.from(table).delete().eq("id", id));

/** Runs a tool now, as the person — the same runner agents use, so a test here is a real test. */
export async function runToolNow(name: string, args: Record<string, unknown>): Promise<ActionResult> {
  const userId = await me();
  if (!userId) return { ok: false, error: "You are signed out. Sign in and try again." };
  return runCustomTool(supabase, userId, { name, args }, {
    via: "app",
    allowDestructive: true,
    callFunction: (fn, body) => callEdgeFunction(fn, body),
  });
}

// ── Connections (docs/CONNECTIONS.md) ─────────────────────────────────────

export interface ConnectionRow extends ConnectionSpec {
  id: string;
  status: Status;
  proposed_by: string | null;
  agents_may_write: boolean;
  created_at: string;
  updated_at: string;
}

export const loadConnections = () =>
  run<ConnectionRow[]>(() => db.from("jackie_connections").select("*").order("status").order("name"));

export async function saveConnection(spec: ConnectionSpec, id?: string): Promise<ActionResult<null>> {
  const problem = validateConnectionSpec(spec);
  if (problem) return { ok: false, error: problem };
  const row = {
    name: spec.name,
    title: spec.title.trim(),
    description: spec.description.trim(),
    base_url: normalizeBaseUrl(spec.base_url),
    auth_type: spec.auth_type,
    auth_name: spec.auth_type === "header" || spec.auth_type === "query" ? spec.auth_name : null,
    operations: spec.operations.map((o) => ({ ...o, params: o.params ?? [] })),
    agents_may_write: !!spec.agents_may_write,
  };
  if (id) return run(() => db.from("jackie_connections").update(row).eq("id", id));
  const userId = await me();
  if (!userId) return { ok: false, error: "You are signed out. Sign in and try again." };
  return run(() => db.from("jackie_connections").insert({ ...row, user_id: userId, status: "active" }));
}

export const setAgentsMayWrite = (id: string, on: boolean) =>
  run<null>(() => db.from("jackie_connections").update({ agents_may_write: on }).eq("id", id));

/** The person's mark that a tool may feed app data into this operation (T3). */
export async function setAcceptsAppData(c: ConnectionRow, operation: string, on: boolean): Promise<ActionResult<null>> {
  const operations = c.operations.map((o) => (o.name === operation ? { ...o, accepts_app_data: on === true } : o));
  return run(() => db.from("jackie_connections").update({ operations }).eq("id", c.id));
}

async function connectFn<T>(body: Record<string, unknown>): Promise<ActionResult<T>> {
  try {
    const resp = await callEdgeFunction("jackie-connect", body);
    const parsed = (await resp.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!resp.ok || !parsed) return { ok: false, error: parsed?.error ?? `jackie-connect answered HTTP ${resp.status}` };
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: describeEdgeFailure(e, "jackie-connect") };
  }
}

/** Which connections have a secret stored. The secret itself never comes back (T1). */
export const loadSecretStatus = () =>
  connectFn<{ secrets: Array<{ connection_id: string; updated_at: string }> }>({ action: "secrets" });
export const setSecret = (connectionId: string, secret: string) =>
  connectFn<{ stored: boolean }>({ action: "set_secret", connection_id: connectionId, secret });
export const clearSecret = (connectionId: string) =>
  connectFn<{ cleared: boolean }>({ action: "clear_secret", connection_id: connectionId });

/** Runs an operation now, as the person. */
export const runOperationNow = (connection: string, operation: string, args: Record<string, unknown>) =>
  connectFn<Record<string, unknown>>({ action: "call", connection, operation, args });
