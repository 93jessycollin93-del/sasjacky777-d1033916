import { describe, expect, it } from "vitest";
import {
  createTask, deleteTask, forgetFact, listTasks, readConversation, readSseText,
  rememberFact, searchMemory, updateTask,
} from "@/lib/appActions";

/**
 * What an agent can do to the app — the rules both the MCP server (Hermes
 * Agent, DeepSeek Harness) and the in-app agents go through.
 *
 * The fake below records every query a call builds, so these tests can say
 * what reached the database, not only what came back: that every read and
 * write is pinned to the caller's own rows, and that values the database's
 * CHECK constraints would refuse are refused here first, with words an agent
 * can act on.
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

describe("acting on tasks", () => {
  it("pins every task read and write to the caller's own rows", async () => {
    const { sb, calls } = fakeSupabase([{ data: [] }, { data: [{ id: "t1" }] }, { data: [{ id: "t1" }] }]);
    await listTasks(sb, USER, {});
    await updateTask(sb, USER, { id: "t1", status: "done" });
    await deleteTask(sb, USER, { id: "t1" });
    for (const call of calls) expect(call.filters).toContainEqual(["user_id", USER]);
  });

  it("refuses a status the database would reject, before asking it", async () => {
    const { sb, calls } = fakeSupabase();
    const r = await updateTask(sb, USER, { id: "t1", status: "pending" });
    expect(r).toEqual({ ok: false, error: "status must be one of: todo, in_progress, done, blocked" });
    expect(calls).toHaveLength(0);
  });

  it("says which task was not found rather than reporting an empty success", async () => {
    const { sb } = fakeSupabase([{ data: [] }]);
    expect(await updateTask(sb, USER, { id: "nope", status: "done" })).toEqual({
      ok: false,
      error: "No task found with id nope",
    });
  });

  it("will not send an update that changes nothing", async () => {
    const { sb } = fakeSupabase();
    const r = await updateTask(sb, USER, { id: "t1" });
    expect(r.ok).toBe(false);
  });

  it("creates a task owned by the caller with a medium default priority", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ id: "t9" }] }]);
    const r = await createTask(sb, USER, { title: "  ship it  " });
    expect(r).toEqual({ ok: true, data: { id: "t9" } });
    expect(calls[0].payload).toMatchObject({ user_id: USER, title: "ship it", priority: "medium" });
  });

  it("creates a task straight into the column it was asked for, in one write", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ id: "t9" }] }]);
    await createTask(sb, USER, { title: "unblock deploy", status: "blocked" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: "insert", payload: { status: "blocked", user_id: USER } });
  });

  it("starts a task in todo when no column is named", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ id: "t9" }] }]);
    await createTask(sb, USER, { title: "x" });
    expect(calls[0].payload).toMatchObject({ status: "todo" });
  });

  it("refuses to create a task in a column the database does not have", async () => {
    const { sb, calls } = fakeSupabase();
    const r = await createTask(sb, USER, { title: "x", status: "pending" });
    expect(r).toEqual({ ok: false, error: "status must be one of: todo, in_progress, done, blocked" });
    expect(calls).toHaveLength(0);
  });
});

describe("acting on memory", () => {
  it("files an uncategorised fact under 'context', a category the table accepts", async () => {
    // The MCP tool this replaced defaulted to "general", which the CHECK
    // constraint refuses — every remember_fact without a category failed.
    const { sb, calls } = fakeSupabase([{ data: [] }, { data: [{ id: "m1" }] }]);
    const r = await rememberFact(sb, USER, { key: "editor", value: "vim" });
    expect(r.ok).toBe(true);
    expect(calls[1]).toMatchObject({ op: "insert", payload: { category: "context", user_id: USER } });
  });

  it("overwrites an existing key instead of duplicating it", async () => {
    const { sb, calls } = fakeSupabase([{ data: [{ id: "m1" }] }, { data: [{ id: "m1" }] }]);
    await rememberFact(sb, USER, { key: "editor", value: "helix" });
    expect(calls[1].op).toBe("update");
    expect(calls[1].filters).toContainEqual(["id", "m1"]);
    expect(calls[1].filters).toContainEqual(["user_id", USER]);
  });

  it("keeps filter syntax out of a memory search", async () => {
    const { sb, calls } = fakeSupabase([{ data: [] }]);
    await searchMemory(sb, USER, { query: "a,b(c)%" });
    const [, expr] = calls[0].filters.find(([c]) => c === "or")!;
    expect(expr).not.toMatch(/a,b|\(c\)/);
  });

  it("needs an id or a key to forget anything", async () => {
    const { sb, calls } = fakeSupabase();
    expect((await forgetFact(sb, USER, {})).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("reading a conversation", () => {
  it("returns the recent messages oldest first, so they read in order", async () => {
    const { sb } = fakeSupabase([
      { data: [{ role: "assistant", content: "b", created_at: "2" }, { role: "user", content: "a", created_at: "1" }] },
    ]);
    const r = await readConversation(sb, USER, { id: "c1" });
    expect(r.ok && r.data.map((m) => m.content)).toEqual(["a", "b"]);
  });
});

function sse(...frames: string[]): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        const e = new TextEncoder();
        for (const f of frames) c.enqueue(e.encode(f));
        c.close();
      },
    }),
  );
}
const token = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

describe("reading Jackie's answer for an agent", () => {
  it("returns the whole answer when the stream finished", async () => {
    expect(await readSseText(sse(token("Jackie "), token("here."), "data: [DONE]\n\n"))).toEqual({
      ok: true,
      data: "Jackie here.",
    });
  });

  it("reports an error frame inside a 200 instead of returning partial text", async () => {
    const r = await readSseText(sse(token("half"), `data: ${JSON.stringify({ error: { message: "model went away" } })}\n\n`));
    expect(r).toEqual({ ok: false, error: "model went away" });
  });

  it("will not hand an agent a cut-off answer as a whole one", async () => {
    const r = await readSseText(sse(token("Step 1: open the ca")));
    expect(r).toEqual({ ok: false, error: "The answer was cut off before it finished." });
  });

  it("treats a stream that carried nothing as a failure", async () => {
    expect((await readSseText(sse("data: [DONE]\n\n"))).ok).toBe(false);
  });
});
