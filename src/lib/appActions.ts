/**
 * What an agent may do to this app, in one place.
 *
 * Two kinds of agent drive Jackie now: external harnesses (Hermes Agent,
 * DeepSeek Harness) through the MCP server, and agents running inside the app
 * (the Agent Lab's DeepSeek and Hermes presets). They must be able to do
 * exactly the same things with exactly the same rules, or an action that works
 * from one fails from the other for a reason nobody can see. So both call these
 * functions, and each surface only adapts inputs and outputs.
 *
 * Every function takes a Supabase client already carrying the caller's own
 * token, so row-level security is the real boundary, and an explicit
 * `user_id` predicate as well: an agent will call every action with every id it
 * has ever seen, and one mistaken policy edit should be a bug, not a
 * cross-account leak.
 *
 * No Deno globals, no browser globals, no `@/` imports: the MCP plugin bundles
 * this file into a Deno function and the browser imports it directly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkArgs, feedsEarlierResult, isDestructive, resolveTemplate, toolSignature, validateSkill, validateToolSpec,
  type CustomToolAction, type ToolParam, type ToolStep,
} from "./customTools";
import {
  isWrite, normalizeBaseUrl, operationSignature, paramsOf, validateConnectionSpec, type ConnectionOperation,
} from "../../supabase/functions/_shared/connections";

/** The values the database's CHECK constraints accept. Anything else is refused there. */
export const TASK_STATUSES = ["todo", "in_progress", "done", "blocked"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const MEMORY_CATEGORIES = ["preference", "decision", "context", "pattern", "architecture", "style"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

// Both branches name both fields: this app's tsconfig is not strict, and without
// strictNullChecks `if (!r.ok)` does not narrow a boolean discriminant.
export type ActionResult<T = unknown> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; error: string; data?: undefined };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated Database type is behind the schema (SECURITY_HARDENING.md)
type Client = SupabaseClient<any, any, any>;

const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

const TASK_COLUMNS = "id,title,description,status,priority,category,due_date,created_at,updated_at";
const MEMORY_COLUMNS = "id,key,value,category,confidence,updated_at";

function clampLimit(limit: unknown, fallback: number, max = 100): number {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.min(Math.max(n, 1), max);
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Strips the characters PostgREST's `or=` filter treats as syntax. */
function filterSafe(text: string): string {
  return text.replace(/[%,()*\\]/g, " ").trim();
}

// ── Tasks ────────────────────────────────────────────────────────────────

export async function listTasks(
  sb: Client,
  userId: string,
  args: { status?: unknown; limit?: unknown },
): Promise<ActionResult> {
  if (args.status !== undefined && !isOneOf(TASK_STATUSES, args.status)) {
    return fail(`status must be one of: ${TASK_STATUSES.join(", ")}`);
  }
  let q = sb
    .from("jackie_tasks")
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(clampLimit(args.limit, 25));
  if (args.status) q = q.eq("status", args.status as string);
  const { data, error } = await q;
  return error ? fail(error.message) : ok(data ?? []);
}

export async function createTask(
  sb: Client,
  userId: string,
  args: { title?: unknown; description?: unknown; status?: unknown; priority?: unknown; category?: unknown; due_date?: unknown },
): Promise<ActionResult> {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) return fail("title is required");
  // The board adds a card straight into the column it was asked from. Without a
  // status here that took a create and then an update, and a failed update left
  // the card sitting in "todo" after the person had watched it land elsewhere.
  if (args.status !== undefined && !isOneOf(TASK_STATUSES, args.status)) {
    return fail(`status must be one of: ${TASK_STATUSES.join(", ")}`);
  }
  if (args.priority !== undefined && !isOneOf(TASK_PRIORITIES, args.priority)) {
    return fail(`priority must be one of: ${TASK_PRIORITIES.join(", ")}`);
  }
  const { data, error } = await sb
    .from("jackie_tasks")
    .insert({
      user_id: userId,
      title: title.slice(0, 500),
      description: typeof args.description === "string" ? args.description : null,
      status: (args.status as TaskStatus | undefined) ?? "todo",
      priority: (args.priority as TaskPriority | undefined) ?? "medium",
      category: typeof args.category === "string" ? args.category : null,
      due_date: typeof args.due_date === "string" && args.due_date ? args.due_date : null,
    })
    .select(TASK_COLUMNS);
  return error ? fail(error.message) : ok(data?.[0] ?? null);
}

export async function updateTask(
  sb: Client,
  userId: string,
  args: { id?: unknown; status?: unknown; priority?: unknown; title?: unknown; description?: unknown; due_date?: unknown },
): Promise<ActionResult> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return fail("id is required");
  const patch: Record<string, unknown> = {};
  if (args.status !== undefined) {
    if (!isOneOf(TASK_STATUSES, args.status)) return fail(`status must be one of: ${TASK_STATUSES.join(", ")}`);
    patch.status = args.status;
  }
  if (args.priority !== undefined) {
    if (!isOneOf(TASK_PRIORITIES, args.priority)) return fail(`priority must be one of: ${TASK_PRIORITIES.join(", ")}`);
    patch.priority = args.priority;
  }
  if (typeof args.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 500);
  if (typeof args.description === "string") patch.description = args.description;
  if (typeof args.due_date === "string") patch.due_date = args.due_date || null;
  if (Object.keys(patch).length === 0) return fail("nothing to change: give status, priority, title, description or due_date");

  const { data, error } = await sb
    .from("jackie_tasks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(TASK_COLUMNS);
  if (error) return fail(error.message);
  return data?.length ? ok(data[0]) : fail(`No task found with id ${id}`);
}

export async function deleteTask(sb: Client, userId: string, args: { id?: unknown }): Promise<ActionResult> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return fail("id is required");
  const { data, error } = await sb
    .from("jackie_tasks")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id,title");
  if (error) return fail(error.message);
  return data?.length ? ok({ deleted: data[0] }) : fail(`No task found with id ${id}`);
}

// ── Memory ───────────────────────────────────────────────────────────────

export async function searchMemory(
  sb: Client,
  userId: string,
  args: { query?: unknown; category?: unknown; limit?: unknown },
): Promise<ActionResult> {
  if (args.category !== undefined && !isOneOf(MEMORY_CATEGORIES, args.category)) {
    return fail(`category must be one of: ${MEMORY_CATEGORIES.join(", ")}`);
  }
  let q = sb
    .from("jackie_memory")
    .select(MEMORY_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(clampLimit(args.limit, 25));
  if (args.category) q = q.eq("category", args.category as string);
  const safe = typeof args.query === "string" ? filterSafe(args.query) : "";
  if (safe) q = q.or(`key.ilike.%${safe}%,value.ilike.%${safe}%`);
  const { data, error } = await q;
  return error ? fail(error.message) : ok(data ?? []);
}

/**
 * Stores or overwrites a fact by key.
 *
 * The MCP tool this replaces defaulted the category to "general", which the
 * table's CHECK constraint does not allow — so every call that named no
 * category failed with a constraint error. "context" is the column's own
 * default and what the chat's memory extractor uses.
 */
export async function rememberFact(
  sb: Client,
  userId: string,
  args: { key?: unknown; value?: unknown; category?: unknown },
): Promise<ActionResult> {
  const key = typeof args.key === "string" ? args.key.trim() : "";
  const value = typeof args.value === "string" ? args.value.trim() : "";
  if (!key || !value) return fail("key and value are required");
  if (args.category !== undefined && !isOneOf(MEMORY_CATEGORIES, args.category)) {
    return fail(`category must be one of: ${MEMORY_CATEGORIES.join(", ")}`);
  }
  const category = (args.category as MemoryCategory | undefined) ?? undefined;

  const { data: existing, error: findError } = await sb
    .from("jackie_memory")
    .select("id")
    .eq("user_id", userId)
    .eq("key", key)
    .limit(1);
  if (findError) return fail(findError.message);

  const { data, error } = existing?.length
    ? await sb
        .from("jackie_memory")
        .update({ value, ...(category ? { category } : {}) })
        .eq("id", existing[0].id)
        .eq("user_id", userId)
        .select(MEMORY_COLUMNS)
    : await sb
        .from("jackie_memory")
        .insert({ user_id: userId, key, value, category: category ?? "context" })
        .select(MEMORY_COLUMNS);
  return error ? fail(error.message) : ok(data?.[0] ?? null);
}

export async function forgetFact(
  sb: Client,
  userId: string,
  args: { id?: unknown; key?: unknown },
): Promise<ActionResult> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  const key = typeof args.key === "string" ? args.key.trim() : "";
  if (!id && !key) return fail("give the fact's id or key");
  let q = sb.from("jackie_memory").delete().eq("user_id", userId);
  q = id ? q.eq("id", id) : q.eq("key", key);
  const { data, error } = await q.select("id,key");
  if (error) return fail(error.message);
  return data?.length ? ok({ forgotten: data }) : fail(`No memory found with ${id ? `id ${id}` : `key "${key}"`}`);
}

// ── Conversations ────────────────────────────────────────────────────────

export async function listConversations(sb: Client, userId: string, args: { limit?: unknown }): Promise<ActionResult> {
  const { data, error } = await sb
    .from("conversations")
    .select("id,title,model,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(clampLimit(args.limit, 20));
  return error ? fail(error.message) : ok(data ?? []);
}

export async function createConversation(sb: Client, userId: string, args: { title?: unknown }): Promise<ActionResult> {
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim().slice(0, 200) : "Agent session";
  const { data, error } = await sb
    .from("conversations")
    .insert({ user_id: userId, title })
    .select("id,title,created_at");
  return error ? fail(error.message) : ok(data?.[0] ?? null);
}

/** The most recent messages of one conversation, oldest first so they read in order. */
export async function readConversation(
  sb: Client,
  userId: string,
  args: { id?: unknown; limit?: unknown },
): Promise<ActionResult<Array<{ role: string; content: string; created_at: string }>>> {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (!id) return fail("id is required");
  const { data, error } = await sb
    .from("chat_messages")
    .select("role,content,created_at")
    .eq("user_id", userId)
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(clampLimit(args.limit, 40, 200));
  if (error) return fail(error.message);
  return ok(((data ?? []) as Array<{ role: string; content: string; created_at: string }>).reverse());
}

export async function saveMessage(
  sb: Client,
  userId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<ActionResult> {
  const { error } = await sb
    .from("chat_messages")
    .insert({ user_id: userId, conversation_id: conversationId, role, content });
  if (error) return fail(error.message);
  // Keeps the conversation at the top of the sidebar, where the chat lists by recency.
  await sb.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", userId);
  return ok(null);
}

/**
 * The memory-and-tasks block the chat injects into Jackie's system prompt.
 *
 * Same shape as `buildMemoryContext` + `buildTaskContext` in the chat page, so
 * Jackie answers an agent with the same knowledge she answers the owner with.
 */
export async function buildAgentContext(sb: Client, userId: string): Promise<string> {
  const [memories, tasks] = await Promise.all([
    searchMemory(sb, userId, { limit: 60 }),
    listTasks(sb, userId, { limit: 50 }),
  ]);
  let context = "";
  if (memories.ok && Array.isArray(memories.data) && memories.data.length) {
    context += "\n## Jackie's Memory\n";
    for (const m of memories.data as Array<{ key: string; value: string; category: string }>) {
      context += `- **${m.key}** (${m.category}): ${m.value}\n`;
    }
  }
  if (tasks.ok && Array.isArray(tasks.data)) {
    const active = (tasks.data as Array<{ title: string; status: string; priority: string; description?: string | null }>)
      .filter((t) => t.status !== "done");
    if (active.length) {
      context += "\n## Active Tasks\n";
      for (const t of active.slice(0, 15)) {
        context += `- [${t.status}/${t.priority}] **${t.title}**${t.description ? ` — ${t.description.slice(0, 80)}` : ""}\n`;
      }
    }
  }
  return context;
}

/**
 * Reads an OpenAI-compatible SSE body to the end and returns the text.
 *
 * Deliberately as strict as the browser's `streamSse`: an error frame is an
 * error, a stream that carried nothing is an error, and a stream that stopped
 * with neither `[DONE]` nor a finish reason is reported as cut off. An agent
 * handed a half answer as a whole one would act on it.
 */
export async function readSseText(resp: Response): Promise<ActionResult<string>> {
  if (!resp.body) return fail("The response had no body.");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finished = false;
  const take = (line: string): string | null => {
    if (!line.startsWith("data:")) return null;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      finished = true;
      return null;
    }
    let frame: { error?: { message?: string } | string; choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> };
    try {
      frame = JSON.parse(payload);
    } catch {
      return null;
    }
    if (frame.error) return typeof frame.error === "string" ? frame.error : frame.error.message ?? "stream error";
    const choice = frame.choices?.[0];
    if (typeof choice?.delta?.content === "string") text += choice.delta.content;
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      if (choice.finish_reason === "content_filter") return "The model's content filter stopped the answer.";
      finished = true;
    }
    return null;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const err = take(buffer.slice(0, nl).replace(/\r$/, ""));
      buffer = buffer.slice(nl + 1);
      if (err) return fail(err);
    }
  }
  if (buffer.trim()) {
    const err = take(buffer.trim());
    if (err) return fail(err);
  }
  if (!text.trim()) return fail("Jackie's model returned an empty answer.");
  if (!finished) return fail("The answer was cut off before it finished.");
  return ok(text);
}

// ── Skills and custom tools ─────────────────────────────────────────────
//
// What the person teaches their agents. A skill is named instructions an agent
// loads when a task fits it; a custom tool is a named recipe of the actions
// above. Agents can list and use the active ones, and propose new ones — which
// wait, switched off, until the person approves them on /skills. The database
// enforces that last part (see the migration): a write from an agent token can
// only ever add a proposal.

/** Which surface an agent acts from, recorded with what it does. */
export interface ActionContext {
  via?: "mcp" | "agent-lab" | "app";
  /** Whether this agent may delete. A tool with a deleting step is refused without it. */
  allowDestructive?: boolean;
  /**
   * Calls one of the project's edge functions as the caller. Each surface
   * passes its own: the MCP server a fetch with the agent's token, the browser
   * callEdgeFunction (rule 4). Absent, actions that need one say so.
   */
  callFunction?: (fn: string, body: unknown) => Promise<Response>;
  /** Set by runCustomTool when a step's arguments come from earlier steps' results (CONNECTIONS.md, T3). */
  carriesAppData?: boolean;
}

const SKILL_LIST_COLUMNS = "name,title,description,updated_at";
const TOOL_COLUMNS = "name,description,params,steps,updated_at";

/**
 * What agents did with skills and tools, in the person's own audit trail, so
 * /skills can show it. A failure to record does not undo the action — but it is
 * reported back with it rather than dropped (rule 8).
 */
async function recordAgentActivity(
  sb: Client,
  userId: string,
  ctx: ActionContext | undefined,
  action: string,
  details: Record<string, unknown>,
  result: "success" | "denied" | "error" = "success",
): Promise<boolean> {
  const { error } = await sb.from("audit_events").insert({
    user_id: userId,
    action,
    actor: `agent:${ctx?.via ?? "unknown"}`,
    category: "other",
    details,
    result,
  });
  return !error;
}

export async function listSkills(
  sb: Client,
  userId: string,
  args: { query?: unknown; limit?: unknown },
): Promise<ActionResult> {
  let q = sb.from("jackie_skills").select(SKILL_LIST_COLUMNS).eq("user_id", userId).eq("status", "active");
  const query = typeof args.query === "string" ? filterSafe(args.query) : "";
  if (query) q = q.or(`name.ilike.%${query}%,title.ilike.%${query}%,description.ilike.%${query}%`);
  const { data, error } = await q.order("name").limit(clampLimit(args.limit, 50));
  return error ? fail(error.message) : ok(data ?? []);
}

export async function getSkill(
  sb: Client,
  userId: string,
  args: { name?: unknown },
  ctx?: ActionContext,
): Promise<ActionResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return fail("name is required — list_skills shows what there is");
  const { data, error } = await sb
    .from("jackie_skills")
    .select("name,title,description,body,updated_at")
    .eq("user_id", userId)
    .eq("name", name)
    .eq("status", "active")
    .limit(1);
  if (error) return fail(error.message);
  if (!data?.length) return fail(`No active skill called "${name}". list_skills shows the ones you can use.`);
  const logged = await recordAgentActivity(sb, userId, ctx, "skill.load", { name });
  return ok(logged ? data[0] : { ...data[0], activity_logged: false });
}

export async function proposeSkill(
  sb: Client,
  userId: string,
  args: { name?: unknown; title?: unknown; description?: unknown; body?: unknown },
  ctx?: ActionContext,
): Promise<ActionResult> {
  const problem = validateSkill(args);
  if (problem) return fail(problem);
  const { data, error } = await sb
    .from("jackie_skills")
    .insert({
      user_id: userId,
      name: args.name,
      title: (args.title as string).trim(),
      description: (args.description as string).trim(),
      body: (args.body as string).trim(),
      status: "proposed",
      proposed_by: `agent:${ctx?.via ?? "unknown"}`,
    })
    .select("name,title,status");
  if (error) {
    return fail(/duplicate key|unique/i.test(error.message)
      ? `A skill called "${args.name}" already exists or is waiting for review. Propose it under another name.`
      : error.message);
  }
  const logged = await recordAgentActivity(sb, userId, ctx, "skill.propose", { name: args.name });
  return ok({
    ...data?.[0],
    note: "Proposed. It stays off until the person approves it on the Skills page.",
    ...(logged ? {} : { activity_logged: false }),
  });
}

interface StoredTool {
  name: string;
  description: string;
  params: ToolParam[];
  steps: ToolStep[];
}

export async function listCustomTools(sb: Client, userId: string, _args: Record<string, unknown>): Promise<ActionResult> {
  const { data, error } = await sb
    .from("jackie_custom_tools")
    .select(TOOL_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("name")
    .limit(100);
  if (error) return fail(error.message);
  // A row written around the app can be in a shape the database accepted but
  // no run can honour. It is listed as broken, with the reason — not allowed
  // to throw, which would take list_custom_tools away from every agent.
  return ok(((data ?? []) as StoredTool[]).map((t) => {
    const broken = validateToolSpec(t);
    if (broken) return { name: t.name, broken: `Cannot run as saved: ${broken} The person can fix it on the Skills page.` };
    return {
      name: t.name,
      params: t.params,
      deletes: isDestructive(t.steps),
      // The signature carries the description; sending it twice only made the
      // list longer than the Agent Lab shows a model.
      signature: toolSignature(t),
    };
  }));
}

export async function proposeTool(
  sb: Client,
  userId: string,
  args: { name?: unknown; description?: unknown; params?: unknown; steps?: unknown },
  ctx?: ActionContext,
): Promise<ActionResult> {
  const spec = { ...args, params: args.params ?? [] };
  const problem = validateToolSpec(spec);
  if (problem) return fail(problem);
  const { data, error } = await sb
    .from("jackie_custom_tools")
    .insert({
      user_id: userId,
      name: spec.name,
      description: (spec.description as string).trim(),
      params: spec.params,
      steps: spec.steps,
      status: "proposed",
      proposed_by: `agent:${ctx?.via ?? "unknown"}`,
    })
    .select("name,status");
  if (error) {
    return fail(/duplicate key|unique/i.test(error.message)
      ? `A tool called "${args.name}" already exists or is waiting for review. Propose it under another name.`
      : error.message);
  }
  const logged = await recordAgentActivity(sb, userId, ctx, "tool.propose", { name: spec.name });
  return ok({
    ...data?.[0],
    note: "Proposed. It stays off until the person approves it on the Skills page.",
    ...(logged ? {} : { activity_logged: false }),
  });
}

type StepExecutor = (sb: Client, userId: string, args: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult>;

/** What a custom tool's steps run — the same functions agents call one at a time. */
const STEP_EXECUTORS: Record<CustomToolAction, StepExecutor> = {
  list_tasks: listTasks,
  create_task: createTask,
  update_task: updateTask,
  delete_task: deleteTask,
  search_memory: searchMemory,
  remember_fact: rememberFact,
  forget_fact: forgetFact,
  list_conversations: listConversations,
  read_conversation: readConversation,
  create_conversation: createConversation,
  ask_jackie: (sb, userId, args, ctx) => askJackie(sb, userId, args, ctx),
  call_connection: (sb, userId, args, ctx) => callConnection(sb, userId, args, ctx),
};

export interface ToolRunStep {
  step: number;
  action: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Runs an active custom tool, step by step, stopping at the first failure.
 *
 * A failure part-way names the step, and lists the steps that did run: an agent
 * told only "failed" would retry from the top and do the first steps twice.
 */
export async function runCustomTool(
  sb: Client,
  userId: string,
  args: { name?: unknown; args?: unknown },
  ctx?: ActionContext,
): Promise<ActionResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return fail("name is required — list_custom_tools shows what there is");
  // A model that writes the tool's parameters beside "name" instead of inside
  // "args" would otherwise have them dropped without a word, and the tool run
  // without the filter it asked for.
  const stray = Object.keys(args).filter((k) => k !== "name" && k !== "args");
  if (stray.length) {
    return fail(
      `${stray.map((k) => `"${k}"`).join(", ")} must go inside args: `
      + `{"name": "${name}", "args": {${stray.map((k) => `"${k}": …`).join(", ")}}}`,
    );
  }
  const callArgs = args.args === undefined || args.args === null ? {} : args.args;
  if (typeof callArgs !== "object" || Array.isArray(callArgs)) return fail("args must be an object");

  const { data, error } = await sb
    .from("jackie_custom_tools")
    .select(TOOL_COLUMNS)
    .eq("user_id", userId)
    .eq("name", name)
    .eq("status", "active")
    .limit(1);
  if (error) return fail(error.message);
  const tool = (data?.[0] ?? null) as StoredTool | null;
  if (!tool) return fail(`No active tool called "${name}". list_custom_tools shows the ones you can run.`);

  // Stored rows passed the database's checks; this catches one edited since in
  // a way the checks allow but a run cannot honour (a placeholder to nowhere).
  const broken = validateToolSpec(tool);
  if (broken) return fail(`The tool "${name}" cannot run as saved: ${broken} Fix it on the Skills page.`);

  if (isDestructive(tool.steps) && !ctx?.allowDestructive) {
    await recordAgentActivity(sb, userId, ctx, "tool.run", { name, refused: "deletes not allowed" }, "denied");
    return fail(`"${name}" deletes things, and this agent is not allowed to delete. Turn on Allow deletes for it, or run the steps yourself.`);
  }
  const bad = checkArgs(tool.params, callArgs as Record<string, unknown>);
  if (bad) return fail(bad);

  // Every declared parameter is in scope, so an optional one left out reads as
  // "not given" rather than as a reference to nothing.
  const params: Record<string, unknown> = Object.fromEntries(tool.params.map((p) => [p.name, (callArgs as Record<string, unknown>)[p.name]]));
  const results: unknown[] = [];
  const ran: ToolRunStep[] = [];
  for (const [i, step] of tool.steps.entries()) {
    const resolved = resolveTemplate(step.args ?? {}, { params, steps: results });
    if (!resolved.ok) {
      ran.push({ step: i + 1, action: step.action, args: {}, ok: false, error: resolved.error });
      break;
    }
    const stepArgs = resolved.value as Record<string, unknown>;
    // A connection call fed by an earlier step's result is carrying app data
    // out; the function refuses that unless the person marked the operation
    // as accepting it (CONNECTIONS.md, T3). Read off the stored step, which no
    // caller's arguments can change.
    // Read with the resolver's own pattern: a regex over the JSON text missed
    // {{\nsteps.0}}, which the resolver fills all the same.
    const carriesAppData = step.action === "call_connection" && feedsEarlierResult(step);
    const res = await STEP_EXECUTORS[step.action](sb, userId, stepArgs, { ...ctx, carriesAppData });
    ran.push(res.ok
      ? { step: i + 1, action: step.action, args: stepArgs, ok: true, result: res.data }
      : { step: i + 1, action: step.action, args: stepArgs, ok: false, error: res.error });
    if (!res.ok) break;
    results.push(res.data);
  }

  const failed = ran.find((s) => !s.ok);
  const done = ran.filter((s) => s.ok);
  const logged = await recordAgentActivity(
    sb, userId, ctx, "tool.run",
    { name, steps: ran.length, failed_step: failed?.step ?? null, made: done.map((s) => idOf(s.result)).filter(Boolean) },
    failed ? "error" : "success",
  );
  if (failed) {
    // What the finished steps made goes back with the failure: an agent told
    // only that step 1 "already ran" cannot finish or undo it without guessing,
    // and a guess is how a retry makes the same task twice.
    const results = JSON.stringify(done.map((s) => ({ step: s.step, action: s.action, result: s.result })));
    return fail(
      `Step ${failed.step} (${failed.action}) of "${name}" failed: ${failed.error}. `
      + (done.length
        ? `Steps ${done.map((s) => `${s.step} (${s.action})`).join(", ")} already ran and were not undone. What they returned: `
          + (results.length > 2000 ? `${results.slice(0, 2000)}… (cut)` : results)
        : "Nothing had run before it.")
      + (logged ? "" : " This run could not be recorded in the person's activity trail."),
    );
  }
  return ok({ tool: name, steps: ran, ...(logged ? {} : { activity_logged: false }) });
}

/** The id a step's result carries, when it made or touched one row. */
function idOf(result: unknown): string | null {
  const r = Array.isArray(result) ? (result.length === 1 ? result[0] : null) : result;
  return r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" ? (r as { id: string }).id : null;
}

// ── Asking Jackie, and connections ──────────────────────────────────────
//
// Both reach an edge function, so both go through ctx.callFunction, which each
// surface supplies with its own correct headers (rule 4). appActions itself
// never builds a request to a function.

/** The chat's streaming engines, by the function that serves each. */
export const ASK_ENGINES = {
  cloud: "jackie-chat",
  deepseek: "jackie-deepseek",
  bionic: "jackie-bionic",
  ollama: "jackie-ollama",
} as const;
export type AskEngine = keyof typeof ASK_ENGINES;

const NO_FUNCTIONS = "This surface cannot reach the app's server functions, so it cannot do that here.";

/**
 * Talks to Jackie the way the chat page does, and leaves the exchange in the
 * app. Same edge functions, the caller's own token: the model allowlist, the
 * quota and the owner-only engines all apply. Saved only once there is an
 * answer, so a failed ask leaves no orphaned question behind.
 */
export async function askJackie(
  sb: Client,
  userId: string,
  args: { message?: unknown; conversation_id?: unknown; title?: unknown; engine?: unknown; model?: unknown },
  ctx: ActionContext = {},
): Promise<ActionResult<{ conversation_id: string; engine: AskEngine; answer: string; warning?: string }>> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return fail("message is required");
  if (message.length > 20_000) return fail("message is longer than 20,000 characters");
  const speaker = ctx.via === "mcp" ? "An agent (MCP)" : ctx.via === "agent-lab" ? "An Agent Lab operator" : null;
  const engine = (args.engine ?? "cloud") as AskEngine;
  if (!(engine in ASK_ENGINES)) return fail(`engine must be one of: ${Object.keys(ASK_ENGINES).join(", ")}`);
  const model = typeof args.model === "string" && args.model.trim() ? args.model.trim().slice(0, 100) : undefined;
  if (!ctx.callFunction) return fail(NO_FUNCTIONS);

  let conversationId = typeof args.conversation_id === "string" ? args.conversation_id.trim() : "";
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (conversationId) {
    const past = await readConversation(sb, userId, { id: conversationId, limit: 20 });
    if (!past.ok) return fail(past.error);
    history = past.data
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  } else {
    // An agent's words are titled as an agent's: a title taken from them
    // would put whatever the agent was handed into the sidebar as the
    // person's own topic.
    const title = typeof args.title === "string" && args.title.trim()
      ? args.title
      : speaker ? `${speaker}: ${message.slice(0, 48)}` : message.slice(0, 60);
    const created = await createConversation(sb, userId, { title });
    if (!created.ok) return fail(created.error);
    conversationId = (created.data as { id: string }).id;
  }

  const fn = ASK_ENGINES[engine];
  const context = await buildAgentContext(sb, userId);
  let resp: Response;
  try {
    resp = await ctx.callFunction(fn, {
      messages: [...history, { role: "user", content: message }],
      ...(model ? { model } : {}),
      ...(context ? { context } : {}),
    });
  } catch (e) {
    return fail(`Could not reach ${fn}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // An unconfigured engine answers 200 with `ok: false` (restoreUnconfigured
  // in edgeFunction.ts turns that back into a 503 in the browser; the MCP
  // server sees the 200). Judged by the body's code, not the Content-Type
  // alone, so a JSON answer that is not a refusal is never reported as one —
  // and any other JSON is named rather than read as an empty stream.
  const isJson = (resp.headers.get("Content-Type") ?? "").includes("application/json");
  if (!resp.ok || isJson) {
    const body = (await resp.json().catch(() => null)) as { code?: string; error?: string; detail?: string } | null;
    if (resp.ok && body?.code !== "PROVIDER_UNCONFIGURED" && !body?.error) {
      return fail(`${fn} answered with JSON instead of a stream: ${JSON.stringify(body).slice(0, 200)}`);
    }
    const why = [body?.error, body?.detail].filter(Boolean).join(" ") || `HTTP ${resp.status}`;
    return fail(`${fn} refused: ${why}`);
  }

  const answer = await readSseText(resp);
  if (!answer.ok) return fail(`${fn}: ${answer.error}`);
  // Saved with who sent it. Without the mark, an agent's message — and any
  // outside text it carried — reads in the person's chat, and to every agent
  // that later reads the conversation, as the person's own words.
  const savedQ = await saveMessage(sb, userId, conversationId, "user", speaker ? `(${speaker} sent this.)\n\n${message}` : message);
  const savedA = savedQ.ok ? await saveMessage(sb, userId, conversationId, "assistant", answer.data) : savedQ;
  return ok({
    conversation_id: conversationId,
    engine,
    answer: answer.data,
    ...(savedA.ok ? {} : { warning: `Answered, but not saved to the conversation: ${savedA.error}` }),
  });
}

interface StoredConnectionRow {
  name: string;
  title: string;
  description: string;
  base_url: string;
  agents_may_write: boolean;
  operations: ConnectionOperation[];
}

/** The person's active connections and what each one's operations take. Never a secret. */
export async function listConnections(sb: Client, userId: string, _args: Record<string, unknown>): Promise<ActionResult> {
  const { data, error } = await sb
    .from("jackie_connections")
    .select("name,title,description,base_url,agents_may_write,operations")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("name")
    .limit(100);
  if (error) return fail(error.message);
  // A row the validator refuses is listed as broken, with the reason, rather
  // than allowed to throw and take list_connections away from every agent.
  return ok(((data ?? []) as StoredConnectionRow[]).map((c) => {
    const broken = validateConnectionSpec({ ...c, auth_type: "none" });
    if (broken) return { name: c.name, broken: `Cannot be used as saved: ${broken} The person can fix it on the Skills page.` };
    return {
      name: c.name,
      title: c.title,
      description: c.description,
      host: new URL(c.base_url).host,
      agents_may_write: c.agents_may_write,
      operations: c.operations.map((o) => ({
        name: o.name,
        description: o.description,
        method: o.method,
        writes: isWrite(o.method),
        accepts_app_data: o.accepts_app_data === true,
        params: paramsOf(o),
        signature: operationSignature(c.name, o),
      })),
    };
  }));
}

/**
 * Runs one operation of one of the person's connections. Everything that
 * decides — the connection's rules, the address check, the secret — happens in
 * jackie-connect; this only shapes the call and reads the verdict.
 */
export async function callConnection(
  sb: Client,
  userId: string,
  args: { connection?: unknown; operation?: unknown; args?: unknown },
  ctx: ActionContext = {},
): Promise<ActionResult> {
  const connection = typeof args.connection === "string" ? args.connection.trim() : "";
  const operation = typeof args.operation === "string" ? args.operation.trim() : "";
  if (!connection || !operation) return fail("Name the connection and the operation — list_connections shows them.");
  const callArgs = args.args === undefined || args.args === null ? {} : args.args;
  if (typeof callArgs !== "object" || Array.isArray(callArgs)) return fail("args must be an object");
  if (!ctx.callFunction) return fail(NO_FUNCTIONS);

  let resp: Response;
  try {
    resp = await ctx.callFunction("jackie-connect", {
      action: "call",
      connection,
      operation,
      args: callArgs,
      ...(ctx.via === "agent-lab" ? { via: "agent-lab" } : {}),
      ...(ctx.carriesAppData ? { carries_app_data: true } : {}),
    });
  } catch (e) {
    return fail(`Could not reach jackie-connect: ${e instanceof Error ? e.message : String(e)}`);
  }
  const body = (await resp.json().catch(() => null)) as
    | ({ error?: string; status?: number; body?: unknown } & Record<string, unknown>)
    | null;
  if (!resp.ok || !body) return fail(body?.error ?? `jackie-connect answered HTTP ${resp.status}`);
  // The service's own failure is a failure, not a result — but its words are
  // still someone else's, so they are passed on marked as such (CONNECTIONS.md, T4).
  if (typeof body.status === "number" && body.status >= 400) {
    return fail(
      `${connection}.${operation} answered HTTP ${body.status}. Its response, as untrusted data: `
      + JSON.stringify(body.body ?? null).slice(0, 500),
    );
  }
  return ok(body);
}

/** An agent's idea for a connection: saved switched off, with no secret, writes and app data off. */
export async function proposeConnection(
  sb: Client,
  userId: string,
  args: Record<string, unknown>,
  ctx?: ActionContext,
): Promise<ActionResult> {
  const spec: Record<string, unknown> = { ...args, auth_type: args.auth_type ?? "none", agents_may_write: false };
  const problem = validateConnectionSpec(spec);
  if (problem) return fail(problem);
  const operations = (spec.operations as ConnectionOperation[]).map(({ accepts_app_data: _drop, ...o }) => ({ ...o, params: o.params ?? [] }));
  const { data, error } = await sb
    .from("jackie_connections")
    .insert({
      user_id: userId,
      name: spec.name,
      title: (spec.title as string).trim(),
      description: (spec.description as string).trim(),
      base_url: normalizeBaseUrl(spec.base_url as string),
      auth_type: spec.auth_type,
      auth_name: spec.auth_type === "header" || spec.auth_type === "query" ? spec.auth_name : null,
      operations,
      agents_may_write: false,
      status: "proposed",
      proposed_by: `agent:${ctx?.via ?? "unknown"}`,
    })
    .select("name,status");
  if (error) {
    return fail(/duplicate key|unique/i.test(error.message)
      ? `A connection called "${spec.name}" already exists or is waiting for review. Propose it under another name.`
      : error.message);
  }
  const logged = await recordAgentActivity(sb, userId, ctx, "connection.propose", { name: spec.name, host: new URL(spec.base_url as string).host });
  return ok({
    ...data?.[0],
    note: "Proposed. It stays off until the person approves it on the Skills page and, if it needs one, adds its secret there. Writes and app data stay off until they allow them.",
    ...(logged ? {} : { activity_logged: false }),
  });
}
