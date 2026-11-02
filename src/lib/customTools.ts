/**
 * Skills and custom tools: the shapes, the limits and the template language,
 * with no I/O.
 *
 * Shared by appActions.ts (what agents do), the /skills page (what the person
 * writes) and the tests, so a tool the page accepts is a tool an agent can run,
 * and the reverse. Like appActions.ts it is bundled into the MCP Deno function,
 * so: no Deno globals, no browser globals, no `@/` imports.
 *
 * A custom tool composes the actions agents already have; it adds no
 * capability. Its steps name those actions and give their arguments, which may
 * use the tool's parameters and earlier steps' results:
 *
 *   {"action": "create_task", "args": {"title": "Review {{topic}}", "priority": "high"}}
 *   {"action": "update_task", "args": {"id": "{{steps.0.id}}", "status": "in_progress"}}
 *
 * A placeholder that is the whole string keeps its type (a number stays a
 * number); one inside other text is written in as text.
 */

import { smugglingProblem } from "../../supabase/functions/_shared/textSafety.ts";

/** The actions a step may call. Mirrored by private.custom_tool_steps_valid in SQL; a test keeps them equal. */
export const CUSTOM_TOOL_ACTIONS = [
  "list_tasks", "create_task", "update_task", "delete_task",
  "search_memory", "remember_fact", "forget_fact",
  "list_conversations", "read_conversation", "create_conversation",
  // Everything else an agent may do: ask Jackie, and call one of the person's
  // approved connections — under that connection's own rules (CONNECTIONS.md).
  "ask_jackie", "call_connection",
] as const;
export type CustomToolAction = (typeof CUSTOM_TOOL_ACTIONS)[number];

/**
 * Where a value that came from an outside service may go. A connection's
 * answer is someone else's text: let it choose which task a later step
 * deletes, or what a later step remembers, files on the board or tells Jackie,
 * and the service writes into the person's app — into every chat's context,
 * through memory and active tasks — with no model in between to doubt it.
 * It may only narrow a read, or go to another connection under that
 * connection's own rules.
 */
export const MAY_TAKE_OUTSIDE_DATA: readonly CustomToolAction[] = ["list_tasks", "search_memory", "list_conversations", "call_connection"];

/** Steps that delete. A tool containing one is off for agents not allowed to delete. */
export const DESTRUCTIVE_ACTIONS: readonly CustomToolAction[] = ["delete_task", "forget_fact"];

/** Names a custom tool may not take — the built-ins, so no tool impersonates one. Mirrored in SQL. */
export const RESERVED_NAMES = [
  ...CUSTOM_TOOL_ACTIONS, "update_task_status",
  "list_skills", "get_skill", "propose_skill", "list_custom_tools", "run_custom_tool", "propose_tool",
  "list_connections", "propose_connection",
] as const;

export const NAME_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
export const LIMITS = {
  title: 80,
  description: 300,
  body: 8000,
  params: 8,
  steps: 8,
  paramDescription: 200,
} as const;

export const PARAM_TYPES = ["string", "number", "boolean"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export interface ToolParam {
  name: string;
  type: ParamType;
  description?: string;
  required?: boolean;
}

export interface ToolStep {
  action: CustomToolAction;
  args?: Record<string, unknown>;
}

export interface SkillSpec {
  name: string;
  title: string;
  description: string;
  body: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  params: ToolParam[];
  steps: ToolStep[];
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function nameProblem(kind: "skill" | "tool", name: unknown): string | null {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    return `The ${kind}'s name must be 2–48 characters of lowercase letters, digits and underscores, starting with a letter (e.g. weekly_review).`;
  }
  return null;
}

/** Null when the database will accept it; otherwise what to change, in words an agent or a person can act on. */
export function validateSkill(s: Partial<Record<keyof SkillSpec, unknown>>): string | null {
  return nameProblem("skill", s.name)
    ?? smugglingProblem({ title: s.title, description: s.description, instructions: s.body })
    ?? (!str(s.title) || str(s.title).length > LIMITS.title ? `Give the skill a title of 1–${LIMITS.title} characters.` : null)
    ?? (!str(s.description) || str(s.description).length > LIMITS.description
      ? `Describe when to use it in 1–${LIMITS.description} characters — agents choose skills by this line.` : null)
    ?? (!str(s.body) || str(s.body).length > LIMITS.body ? `Write the skill's instructions in 1–${LIMITS.body} characters.` : null);
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Every placeholder used anywhere in a value — read with the same pattern the resolver fills them with. */
export function placeholders(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(PLACEHOLDER)) out.push(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => placeholders(v, out));
  } else if (isObject(value)) {
    Object.values(value).forEach((v) => placeholders(v, out));
  }
  return out;
}

export function validateToolSpec(t: Partial<Record<keyof ToolSpec, unknown>>): string | null {
  const named = nameProblem("tool", t.name);
  if (named) return named;
  if ((RESERVED_NAMES as readonly string[]).includes(t.name as string)) {
    return `"${t.name}" is a built-in action's name. Pick another, so no agent mistakes one for the other.`;
  }
  if (!str(t.description) || str(t.description).length > LIMITS.description) {
    return `Describe what the tool does in 1–${LIMITS.description} characters — agents choose tools by this line.`;
  }
  const smuggled = smugglingProblem({ description: t.description, parameters: t.params, steps: t.steps });
  if (smuggled) return smuggled;
  const params = t.params ?? [];
  if (!Array.isArray(params) || params.length > LIMITS.params) return `A tool takes at most ${LIMITS.params} parameters, as a list.`;
  const paramNames = new Set<string>();
  for (const [i, p] of params.entries()) {
    if (!isObject(p) || typeof p.name !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(p.name)) {
      return `Parameter ${i + 1} needs a name of lowercase letters, digits and underscores.`;
    }
    if (p.name === "steps") return `"steps" is reserved for earlier steps' results; name parameter ${i + 1} something else.`;
    if (paramNames.has(p.name)) return `Two parameters are called "${p.name}".`;
    paramNames.add(p.name);
    if (!(PARAM_TYPES as readonly string[]).includes(p.type as string)) {
      return `Parameter "${p.name}" must be of type ${PARAM_TYPES.join(", ")}.`;
    }
    if (p.description !== undefined && (typeof p.description !== "string" || p.description.length > LIMITS.paramDescription)) {
      return `Parameter "${p.name}"'s description must be text of at most ${LIMITS.paramDescription} characters.`;
    }
    if (p.required !== undefined && typeof p.required !== "boolean") return `Parameter "${p.name}"'s "required" must be true or false.`;
  }
  const steps = t.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > LIMITS.steps) {
    return `A tool has 1–${LIMITS.steps} steps.`;
  }
  // Which steps' results carry an outside service's words: a connection
  // call's, and any step's that was fed one.
  const outside: boolean[] = [];
  for (const [i, s] of steps.entries()) {
    if (!isObject(s) || !(CUSTOM_TOOL_ACTIONS as readonly string[]).includes(s.action as string)) {
      return `Step ${i + 1} must call one of: ${CUSTOM_TOOL_ACTIONS.join(", ")}.`;
    }
    if (s.args !== undefined && !isObject(s.args)) return `Step ${i + 1}'s args must be an object.`;
    let fedOutside: number | null = null;
    for (const ref of placeholders(s.args)) {
      const step = /^steps\.(\d+)(\.|$)/.exec(ref);
      if (step) {
        if (Number(step[1]) >= i) return `Step ${i + 1} refers to {{${ref}}}, but only earlier steps' results exist by then.`;
        if (outside[Number(step[1])]) fedOutside ??= Number(step[1]);
      } else if (ref === "steps") {
        return `Step ${i + 1} refers to {{steps}}; name one earlier step's result, like {{steps.0.id}}.`;
      } else if (!paramNames.has(ref)) {
        return `Step ${i + 1} refers to {{${ref}}}, which is not one of the tool's parameters.`;
      }
    }
    if (fedOutside !== null && !MAY_TAKE_OUTSIDE_DATA.includes(s.action as CustomToolAction)) {
      return `Step ${i + 1} (${s.action}) would take step ${fedOutside + 1}'s result, which comes from an outside service. `
        + "A service's answer cannot choose what a tool deletes, changes, remembers, adds to the board or says to Jackie; "
        + `it can only narrow a read or go to another connection (${MAY_TAKE_OUTSIDE_DATA.join(", ")}).`;
    }
    outside.push(s.action === "call_connection" || fedOutside !== null);
  }
  return null;
}

/** Whether a step sends an earlier step's result — app data — onward (CONNECTIONS.md, T3). */
export function feedsEarlierResult(step: { args?: unknown }): boolean {
  return placeholders(step.args).some((ref) => ref === "steps" || ref.startsWith("steps."));
}

/** Whether any step deletes something. */
export function isDestructive(steps: readonly { action: string }[]): boolean {
  return steps.some((s) => (DESTRUCTIVE_ACTIONS as readonly string[]).includes(s.action));
}

/** Checks a call's arguments against the tool's parameters. Unknown arguments are refused, not ignored. */
export function checkArgs(params: readonly ToolParam[], args: Record<string, unknown>): string | null {
  for (const key of Object.keys(args)) {
    if (!params.some((p) => p.name === key)) {
      return `This tool has no parameter "${key}". It takes: ${params.map((p) => p.name).join(", ") || "nothing"}.`;
    }
  }
  for (const p of params) {
    const v = args[p.name];
    if (v === undefined || v === null || v === "") {
      if (p.required) return `"${p.name}" is required.`;
      continue;
    }
    if (typeof v !== p.type) return `"${p.name}" must be a ${p.type}.`;
    // NaN and Infinity are numbers to typeof, and nonsense to every action.
    if (p.type === "number" && !Number.isFinite(v)) return `"${p.name}" must be a finite number.`;
  }
  return null;
}

function lookup(path: string, scope: { params: Record<string, unknown>; steps: unknown[] }): { found: boolean; value?: unknown } {
  const parts = path.split(".");
  let cur: unknown = parts[0] === "steps" ? scope.steps : scope.params[parts[0]];
  if (parts[0] !== "steps" && !(parts[0] in scope.params)) return { found: false };
  for (const part of parts.slice(1)) {
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (isObject(cur) && part in cur) cur = cur[part];
    else return { found: false };
  }
  return { found: true, value: cur };
}

// Both branches name both fields: without strictNullChecks, `if (!r.ok)` does not
// narrow a union that only one side of carries `error` on.
export type Resolved = { ok: true; value: unknown; error?: undefined } | { ok: false; error: string; value?: undefined };

/**
 * Fills a step's arguments in. A placeholder that cannot be filled is an error
 * naming it — never an empty string sent on to the action as if it were meant.
 */
export function resolveTemplate(value: unknown, scope: { params: Record<string, unknown>; steps: unknown[] }): Resolved {
  if (typeof value === "string") {
    const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
    if (whole) {
      const hit = lookup(whole[1], scope);
      if (!hit.found) return { ok: false, error: `{{${whole[1]}}} has no value` };
      return { ok: true, value: hit.value };
    }
    let missing: string | null = null;
    const text = value.replace(PLACEHOLDER, (_, ref: string) => {
      const hit = lookup(ref, scope);
      // An optional parameter left out reads as nothing inside text, the way
      // it drops a whole-value argument. Otherwise a tool that advertises it as
      // optional fails at that step — after earlier steps have already written.
      if (hit.found && (hit.value === undefined || hit.value === null) && !ref.includes(".") && ref in scope.params) return "";
      if (!hit.found || hit.value === undefined || hit.value === null) {
        missing ??= ref;
        return "";
      }
      return typeof hit.value === "object" ? JSON.stringify(hit.value) : String(hit.value);
    });
    return missing ? { ok: false, error: `{{${missing}}} has no value` } : { ok: true, value: text };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const r = resolveTemplate(v, scope);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return { ok: true, value: out };
  }
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = resolveTemplate(v, scope);
      if (!r.ok) return r;
      // An optional parameter left out drops its argument, rather than sending
      // the action an empty value it would read as "set this to nothing".
      if (r.value !== undefined && r.value !== null && !(typeof v === "string" && r.value === "" && /^\{\{[^{}]+\}\}$/.test(v.trim()))) {
        out[k] = r.value;
      }
    }
    return { ok: true, value: out };
  }
  return { ok: true, value };
}

/** One line per tool, the way a model reads a signature. */
export function toolSignature(t: { name: string; description: string; params: readonly ToolParam[] }): string {
  const args = t.params.map((p) => `"${p.name}"${p.required ? "" : "?"}: ${p.type}`).join(", ");
  return `${t.name} {${args}} — ${t.description}`;
}
