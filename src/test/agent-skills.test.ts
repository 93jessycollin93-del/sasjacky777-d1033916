import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getSkill, listCustomTools, listSkills, proposeSkill, proposeTool, runCustomTool,
} from "@/lib/appActions";
import { AGENT_TOOLS } from "@/lib/appAgent";

/**
 * Skills and custom tools, as agents meet them: what reaches the database,
 * what an agent is told when it cannot do something, and that a custom tool
 * never does more than the agent running it could do step by step.
 */

type Call = { table: string; op: string; filters: Array<[string, unknown]>; payload?: unknown };

function fakeSupabase(responses: Array<{ data?: unknown; error?: { message: string } | null }> = []) {
  const calls: Call[] = [];
  let next = 0;
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => {
        fn(...a);
        return builder;
      };
      Object.assign(builder, {
        select: chain(() => {}),
        insert: chain((p) => { call.op = "insert"; call.payload = p; }),
        update: chain((p) => { call.op = "update"; call.payload = p; }),
        delete: chain(() => { call.op = "delete"; }),
        eq: chain((c, v) => { call.filters.push([c as string, v]); }),
        or: chain((expr) => { call.filters.push(["or", expr]); }),
        order: chain(() => {}),
        limit: chain(() => {}),
        then: (resolve: (v: unknown) => void) => {
          const r = responses[next++] ?? { data: [], error: null };
          resolve({ data: r.data ?? null, error: r.error ?? null });
        },
      });
      return builder;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: client as any, calls };
}

const USER = "11111111-1111-1111-1111-111111111111";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const reviewTool = {
  name: "start_review",
  description: "Open a review task and start it.",
  params: [{ name: "topic", type: "string", required: true }],
  steps: [
    { action: "create_task", args: { title: "Review {{topic}}", priority: "high" } },
    { action: "update_task", args: { id: "{{steps.0.id}}", status: "in_progress" } },
  ],
};

describe("skills, as an agent meets them", () => {
  it("lists only the caller's active skills, and only the line that says when to use each", async () => {
    const { sb, calls } = fakeSupabase([{ data: [] }]);
    await listSkills(sb, USER, {});
    expect(calls[0]).toMatchObject({ table: "jackie_skills", op: "select" });
    expect(calls[0].filters).toEqual(expect.arrayContaining([["user_id", USER], ["status", "active"]]));
  });

  it("tells an agent asking for a skill that does not exist where to look", async () => {
    const { sb } = fakeSupabase([{ data: [] }]);
    const r = await getSkill(sb, USER, { name: "nope" }, { via: "mcp" });
    expect(r).toEqual({ ok: false, error: 'No active skill called "nope". list_skills shows the ones you can use.' });
  });

  it("records that an agent loaded a skill, so the person can see which instructions were followed", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ name: "weekly_review", body: "…" }] }, { data: null }]);
    const r = await getSkill(sb, USER, { name: "weekly_review" }, { via: "mcp" });
    expect(r.ok).toBe(true);
    expect(calls[1]).toMatchObject({ table: "audit_events", op: "insert", payload: { action: "skill.load", actor: "agent:mcp", user_id: USER } });
  });

  it("says so when the load could not be recorded, rather than pretending it was", async () => {
    const { sb } = fakeSupabase([{ data: [{ name: "weekly_review" }] }, { error: { message: "denied" } }]);
    const r = await getSkill(sb, USER, { name: "weekly_review" }, { via: "mcp" });
    expect(r).toMatchObject({ ok: true, data: { activity_logged: false } });
  });

  it("saves an agent's skill as a proposal, switched off, marked with where it came from", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ name: "bug_reports", status: "proposed" }] }, { data: null }]);
    const r = await proposeSkill(sb, USER, { name: "bug_reports", title: "Bug reports", description: "When filing a bug.", body: "Steps, expected, actual." }, { via: "agent-lab" });
    expect(r.ok).toBe(true);
    expect(calls[0]).toMatchObject({ table: "jackie_skills", op: "insert", payload: { status: "proposed", proposed_by: "agent:agent-lab", user_id: USER } });
  });

  it("refuses a malformed proposal before it reaches the database", async () => {
    const { sb, calls } = fakeSupabase();
    const r = await proposeSkill(sb, USER, { name: "Bad Name", title: "t", description: "d", body: "b" }, { via: "mcp" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("explains a name that is taken, instead of passing on a constraint error", async () => {
    const { sb } = fakeSupabase([{ error: { message: 'duplicate key value violates unique constraint "jackie_skills_user_id_name_key"' } }]);
    const r = await proposeSkill(sb, USER, { name: "weekly_review", title: "t", description: "d", body: "b" }, { via: "mcp" });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("already exists or is waiting for review") });
  });
});

describe("custom tools, as an agent runs them", () => {
  it("lists the caller's active tools with a signature a model can call", async () => {
    const { sb, calls } = fakeSupabase([{ data: [reviewTool] }]);
    const r = await listCustomTools(sb, USER, {});
    expect(calls[0].filters).toEqual(expect.arrayContaining([["user_id", USER], ["status", "active"]]));
    expect(r).toMatchObject({ ok: true, data: [{ name: "start_review", deletes: false, signature: expect.stringContaining('"topic": string') }] });
  });

  it("runs the steps in order through the agents' own actions, feeding one step's result to the next", async () => {
    const { sb, calls } = fakeSupabase([
      { data: [reviewTool] },
      { data: [{ id: "t9", title: "Review billing" }] },
      { data: [{ id: "t9", status: "in_progress" }] },
      { data: null },
    ]);
    const r = await runCustomTool(sb, USER, { name: "start_review", args: { topic: "billing" } }, { via: "mcp", allowDestructive: true });
    expect(r.ok).toBe(true);
    expect(calls[1]).toMatchObject({ table: "jackie_tasks", op: "insert", payload: { user_id: USER, title: "Review billing", priority: "high" } });
    expect(calls[2]).toMatchObject({ table: "jackie_tasks", op: "update", payload: { status: "in_progress" } });
    expect(calls[2].filters).toEqual(expect.arrayContaining([["id", "t9"], ["user_id", USER]]));
    expect(calls[3]).toMatchObject({ table: "audit_events", payload: { action: "tool.run", result: "success" } });
  });

  it("stops at a failing step and says which steps already ran, so the agent does not run them twice", async () => {
    const { sb } = fakeSupabase([
      { data: [reviewTool] },
      { data: [{ id: "t9" }] },
      { data: [] }, // the update matches nothing
      { data: null },
    ]);
    const r = await runCustomTool(sb, USER, { name: "start_review", args: { topic: "billing" } }, { allowDestructive: true });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(
      /^Step 2 \(update_task\) of "start_review" failed: No task found with id t9\. Steps 1 \(create_task\) already ran and were not undone\./,
    );
  });

  it("hands back what the finished steps made, so the agent can finish or undo them instead of guessing", async () => {
    const { sb, calls } = fakeSupabase([{ data: [reviewTool] }, { data: [{ id: "t9" }] }, { data: [] }, { data: null }]);
    const r = await runCustomTool(sb, USER, { name: "start_review", args: { topic: "billing" } }, {});
    expect(r.ok ? "" : r.error).toContain('What they returned: [{"step":1,"action":"create_task","result":{"id":"t9"}}]');
    const audit = calls.find((c) => c.table === "audit_events");
    expect(audit?.payload).toMatchObject({ details: { made: ["t9"], failed_step: 2 } });
  });

  it("refuses parameters written beside the name instead of inside args, rather than dropping them", async () => {
    const { sb, calls } = fakeSupabase();
    const r = await runCustomTool(sb, USER, { name: "close_out", status: "blocked" } as never, {});
    expect(r).toEqual({ ok: false, error: '"status" must go inside args: {"name": "close_out", "args": {"status": …}}' });
    expect(calls).toHaveLength(0);
  });

  it("says so when a run could not be recorded in the person's activity, instead of dropping it", async () => {
    const { sb } = fakeSupabase([
      { data: [reviewTool] }, { data: [{ id: "t9" }] }, { data: [{ id: "t9", status: "in_progress" }] },
      { error: { message: "permission denied for table audit_events" } },
    ]);
    const r = await runCustomTool(sb, USER, { name: "start_review", args: { topic: "billing" } }, {});
    expect(r).toMatchObject({ ok: true, data: { activity_logged: false } });
  });

  it("lists a tool it cannot run as broken, with the reason, instead of failing the whole list", async () => {
    const broken = { name: "tidy", description: "Tidy.", params: [null], steps: [{ action: "list_tasks", args: {} }] };
    const { sb } = fakeSupabase([{ data: [reviewTool, broken] }]);
    const r = await listCustomTools(sb, USER, {});
    expect(r.ok).toBe(true);
    const listed = (r.ok ? r.data : []) as Array<Record<string, unknown>>;
    expect(listed[0].signature).toMatch(/^start_review /);
    expect(listed[1]).toMatchObject({ name: "tidy" });
    expect(String(listed[1].broken)).toMatch(/Cannot run as saved: Parameter 1 needs a name/);
  });

  it("refuses a tool that deletes when this agent may not delete — the same rule as calling delete_task itself", async () => {
    const deleting = { ...reviewTool, name: "clear_done", params: [], steps: [{ action: "delete_task", args: { id: "x" } }] };
    const { sb, calls } = fakeSupabase([{ data: [deleting] }, { data: null }]);
    const r = await runCustomTool(sb, USER, { name: "clear_done" }, { via: "agent-lab", allowDestructive: false });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("not allowed to delete") });
    expect(calls.some((c) => c.table === "jackie_tasks")).toBe(false);
    expect(calls[1]).toMatchObject({ table: "audit_events", payload: { result: "denied" } });
  });

  it("refuses arguments the tool does not take, before running anything", async () => {
    const { sb, calls } = fakeSupabase([{ data: [reviewTool] }]);
    const r = await runCustomTool(sb, USER, { name: "start_review", args: { topic: "x", owner: "me" } }, {});
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('no parameter "owner"') });
    expect(calls).toHaveLength(1);
  });

  it("only runs active tools: a proposal is not runnable until the person approves it", async () => {
    const { sb, calls } = fakeSupabase([{ data: [] }]);
    const r = await runCustomTool(sb, USER, { name: "start_review", args: { topic: "x" } }, {});
    expect(calls[0].filters).toEqual(expect.arrayContaining([["status", "active"]]));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("No active tool") });
  });

  it("saves an agent's tool as a proposal and checks it the way the database will", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ name: "start_review", status: "proposed" }] }, { data: null }]);
    expect((await proposeTool(sb, USER, reviewTool, { via: "mcp" })).ok).toBe(true);
    expect(calls[0]).toMatchObject({ table: "jackie_custom_tools", payload: { status: "proposed", proposed_by: "agent:mcp" } });
    const bad = await proposeTool(sb, USER, { ...reviewTool, steps: [{ action: "drop_table" }] }, { via: "mcp" });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("must call one of") });
  });
});

describe("both kinds of agent get the same skills, tools and connections", () => {
  // Rule 9: a capability is an action, then an MCP tool, then an AGENT_TOOLS
  // entry. Missing one is how Hermes ends up able to do what the Agent Lab
  // cannot, for no reason anyone can see.
  const NEW = [
    "list_skills", "get_skill", "propose_skill", "list_custom_tools", "run_custom_tool", "propose_tool",
    "list_connections", "call_connection", "propose_connection", "ask_jackie", "create_conversation",
  ];

  it("offers each one to the in-app operators", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    for (const n of NEW) expect(names).toContain(n);
  });

  it("can run each one from the Agent Lab", () => {
    const runtime = readFileSync(path.join(ROOT, "src", "lib", "appAgentRuntime.ts"), "utf8");
    for (const n of NEW) expect(runtime).toMatch(new RegExp(`\\b${n}: actions\\.`));
  });

  it("offers each one over MCP — a tool file the server never registers is offered to no one", () => {
    const dir = path.join(ROOT, "src", "lib", "mcp", "tools");
    const index = readFileSync(path.join(ROOT, "src", "lib", "mcp", "index.ts"), "utf8");
    const registered = new Set([...index.matchAll(/^import (\w+) from "\.\/tools\/([\w-]+)";$/gm)]
      .filter(([, ident]) => new RegExp(`\\b${ident}\\b[,\\s]`).test(index.slice(index.indexOf("tools:"))))
      .map(([, , file]) => file));
    const byName = new Map(readdirSync(dir).map((f) => [
      /name: "([a-z_]+)"/.exec(readFileSync(path.join(dir, f), "utf8"))?.[1], f.replace(/\.ts$/, ""),
    ]));
    for (const n of NEW) {
      expect(byName.has(n), `${n} has a tool file`).toBe(true);
      expect(registered.has(byName.get(n) as string), `${n} is registered in src/lib/mcp/index.ts`).toBe(true);
    }
  });
});
