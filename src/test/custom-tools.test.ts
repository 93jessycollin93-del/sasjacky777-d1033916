import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CUSTOM_TOOL_ACTIONS, LIMITS, NAME_PATTERN, PARAM_TYPES, RESERVED_NAMES, checkArgs, isDestructive, resolveTemplate,
  toolSignature, validateSkill, validateToolSpec, type ToolSpec,
} from "@/lib/customTools";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SQL = readFileSync(path.join(ROOT, "supabase", "migrations", "20261011120000_jackie_skills_and_tools.sql"), "utf8");
const quoted = (block: string) => [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const tool = (over: Partial<ToolSpec> = {}): ToolSpec => ({
  name: "start_review",
  description: "Open a review task and note the decision.",
  params: [{ name: "topic", type: "string", required: true }, { name: "due", type: "string" }],
  steps: [
    { action: "create_task", args: { title: "Review {{topic}}", priority: "high", due_date: "{{due}}" } },
    { action: "update_task", args: { id: "{{steps.0.id}}", status: "in_progress" } },
  ],
  ...over,
});

describe("what a skill must be", () => {
  it("accepts a well-formed skill", () => {
    expect(validateSkill({ name: "weekly_review", title: "Weekly review", description: "Fridays.", body: "1. List tasks." })).toBeNull();
  });

  it("refuses a name an agent could not type back exactly", () => {
    expect(validateSkill({ name: "Weekly Review", title: "t", description: "d", body: "b" })).toContain("lowercase");
  });

  it("asks for the line agents choose skills by", () => {
    expect(validateSkill({ name: "a_skill", title: "t", description: "  ", body: "b" })).toContain("agents choose skills");
  });

  it("caps the instructions, since a loaded skill rides on the agent's next request", () => {
    expect(validateSkill({ name: "a_skill", title: "t", description: "d", body: "x".repeat(LIMITS.body + 1) })).toContain(String(LIMITS.body));
  });
});

describe("what a custom tool must be", () => {
  it("accepts a tool whose steps use its parameters and an earlier step's result", () => {
    expect(validateToolSpec(tool())).toBeNull();
  });

  it("will not let a tool take a built-in's name", () => {
    expect(validateToolSpec(tool({ name: "delete_task" }))).toContain("built-in");
  });

  it("lets a step do anything an agent may do — including asking Jackie and calling a connection", () => {
    expect(validateToolSpec(tool({ steps: [{ action: "ask_jackie", args: { message: "Summarise {{topic}}" } }] }))).toBeNull();
    expect(validateToolSpec(tool({ steps: [{ action: "call_connection", args: { connection: "github", operation: "search_issues", args: { q: "{{topic}}" } } }] }))).toBeNull();
  });

  it("will not let a step run another tool or propose one — no recursion, no tool extending itself", () => {
    for (const action of ["run_custom_tool", "propose_tool", "propose_skill", "propose_connection", "fetch_url"]) {
      expect(validateToolSpec(tool({ steps: [{ action: action as never, args: {} }] }))).toContain("must call one of");
    }
  });

  it("refuses a step that refers to a later step's result", () => {
    const bad = tool({ steps: [{ action: "update_task", args: { id: "{{steps.0.id}}" } }] });
    expect(validateToolSpec(bad)).toContain("only earlier steps");
  });

  it("refuses a placeholder that names no parameter, instead of sending an empty value later", () => {
    const bad = tool({ steps: [{ action: "create_task", args: { title: "{{topick}}" } }] });
    expect(validateToolSpec(bad)).toContain("{{topick}}");
  });

  it("keeps 'steps' free for results, so a parameter cannot shadow them", () => {
    expect(validateToolSpec(tool({ params: [{ name: "steps", type: "string" }] }))).toContain("reserved");
  });

  it("caps the steps, so one call cannot become an unbounded run", () => {
    const many = Array.from({ length: LIMITS.steps + 1 }, () => ({ action: "list_tasks" as const }));
    expect(validateToolSpec(tool({ steps: many }))).toContain(String(LIMITS.steps));
  });

  it("knows a tool with a deleting step deletes", () => {
    expect(isDestructive(tool().steps)).toBe(false);
    expect(isDestructive([{ action: "forget_fact" }])).toBe(true);
  });

  it("describes itself the way a model reads a signature", () => {
    expect(toolSignature(tool())).toBe('start_review {"topic": string, "due"?: string} — Open a review task and note the decision.');
  });
});

describe("filling a step in", () => {
  const scope = { params: { topic: "billing", due: undefined, count: 3 }, steps: [{ id: "t1", title: "x" }] };

  it("writes parameters into text and keeps a whole-placeholder's type", () => {
    expect(resolveTemplate({ title: "Review {{topic}}", limit: "{{count}}" }, scope))
      .toEqual({ ok: true, value: { title: "Review billing", limit: 3 } });
  });

  it("reads a field of an earlier step's result", () => {
    expect(resolveTemplate({ id: "{{steps.0.id}}" }, scope)).toEqual({ ok: true, value: { id: "t1" } });
  });

  it("drops an argument whose optional parameter was left out, rather than sending it empty", () => {
    expect(resolveTemplate({ title: "x", due_date: "{{due}}" }, scope)).toEqual({ ok: true, value: { title: "x" } });
  });

  it("names a placeholder it cannot fill, rather than sending text with a hole in it", () => {
    expect(resolveTemplate({ title: "Due {{nothing}}" }, scope)).toEqual({ ok: false, error: "{{nothing}} has no value" });
    expect(resolveTemplate({ id: "{{steps.1.id}}" }, scope)).toMatchObject({ ok: false });
    expect(resolveTemplate({ title: "Re {{steps.0.missing}}" }, scope)).toMatchObject({ ok: false });
  });

  it("reads an optional parameter that was left out as nothing inside text, so the tool does not fail half-way", () => {
    expect(resolveTemplate({ value: "Started {{topic}}. {{due}}" }, scope)).toEqual({ ok: true, value: { value: "Started billing. " } });
  });
});

describe("checking a call's arguments", () => {
  const params = tool().params;
  it("asks for what is required", () => {
    expect(checkArgs(params, {})).toBe('"topic" is required.');
  });
  it("refuses NaN and Infinity, which typeof calls numbers", () => {
    const counted = [{ name: "count", type: "number" as const, required: true }];
    expect(checkArgs(counted, { count: Number.NaN })).toBe('"count" must be a finite number.');
    expect(checkArgs(counted, { count: Infinity })).toBe('"count" must be a finite number.');
    expect(checkArgs(counted, { count: 3 })).toBeNull();
  });

  it("refuses an argument the tool does not take, instead of ignoring it", () => {
    expect(checkArgs(params, { topic: "a", priority: "high" })).toContain('no parameter "priority"');
  });
  it("refuses the wrong type", () => {
    expect(checkArgs([{ name: "n", type: "number" }], { n: "3" })).toBe('"n" must be a number.');
  });
});

describe("the code and the database agree", () => {
  it("allows the same step actions as the SQL check", () => {
    const from = SQL.indexOf("s->>'action' NOT IN (") + "s->>'action' NOT IN (".length;
    const block = SQL.slice(from, SQL.indexOf("OR (s ? 'args'"));
    expect(quoted(block).sort()).toEqual([...CUSTOM_TOOL_ACTIONS].sort());
  });

  it("reserves the same names as the SQL check", () => {
    const start = SQL.indexOf("AND name NOT IN (");
    const block = SQL.slice(start, SQL.indexOf("description text", start));
    expect(quoted(block).sort()).toEqual([...RESERVED_NAMES].sort());
  });

  it("checks a parameter's shape the way the SQL check does", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION private.custom_tool_params_valid"), SQL.indexOf("FUNCTION private.visible_length"));
    expect(fn).toContain("'^[a-z][a-z0-9_]{0,31}$'");
    expect(fn).toContain(`jsonb_array_length(params) <= ${LIMITS.params}`);
    expect(fn).toContain(`char_length(p->>'description') > ${LIMITS.paramDescription}`);
    expect(fn).toContain("p->>'name' = 'steps'");
    for (const t of PARAM_TYPES) expect(fn).toContain(`'${t}'`);
    expect(validateToolSpec({ ...tool(), params: [{ name: "n", type: "string", required: "yes" }] } as never)).toMatch(/"required" must be true or false/);
  });

  it("will not let an outside service's answer choose what a tool writes, deletes or tells Jackie", () => {
    const fetchThen = (action: string, args: Record<string, unknown>) => ({
      name: "fetch_then", description: "d", params: [],
      steps: [{ action: "call_connection", args: { connection: "feed", operation: "today" } }, { action, args }],
    });
    for (const [action, args] of [
      ["remember_fact", { key: "k", value: "{{steps.0.body.text}}" }],
      ["delete_task", { id: "{{steps.0.body.id}}" }],
      ["update_task", { id: "t1", title: "{{steps.0.body.title}}" }],
      ["create_task", { title: "{{steps.0.body.title}}" }],
      ["ask_jackie", { message: "Summarise {{steps.0.body}}" }],
    ] as const) {
      expect(validateToolSpec(fetchThen(action, args) as never)).toMatch(/comes from an outside service/);
    }
    expect(validateToolSpec(fetchThen("search_memory", { query: "{{steps.0.body.q}}" }) as never)).toBeNull();
    expect(validateToolSpec(fetchThen("call_connection", { connection: "other", operation: "x", args: { q: "{{steps.0.body.q}}" } }) as never)).toBeNull();
  });

  it("follows outside data through a step that passed it on", () => {
    const laundered = {
      name: "laundered", description: "d", params: [],
      steps: [
        { action: "call_connection", args: { connection: "feed", operation: "today" } },
        { action: "search_memory", args: { query: "{{steps.0.body.q}}" } },
        { action: "forget_fact", args: { id: "{{steps.1.0.id}}" } },
      ],
    };
    expect(validateToolSpec(laundered as never)).toMatch(/Step 3 \(forget_fact\) would take step 2's result/);
  });

  it("uses the same name pattern as the SQL check", () => {
    expect(SQL).toContain(`name ~ '${NAME_PATTERN.source}'`);
  });
});
