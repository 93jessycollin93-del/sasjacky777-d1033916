import { describe, expect, it, vi } from "vitest";
import { actionManual, parseAction, runAppAgent, stripThinking, type ModelTurn } from "@/lib/appAgent";
import type { ActionResult } from "@/lib/appActions";
import { discoverLocalModels, localChat } from "@/lib/localModels";
import { OPERATOR_AGENTS } from "@/lib/operatorAgents";
import { PROVIDERS } from "@/lib/jackie-providers";

/**
 * DeepSeek and Hermes agents acting on the app from inside it.
 *
 * The model and the action executor are injected, so these drive the real loop
 * with scripted replies and watch what it asks the app to do. The rules under
 * test are the ones that decide whether an agent can be trusted with the app:
 * it acts only through named actions, it sees every result, it cannot delete
 * unless allowed, and it never reports finished work it did not finish.
 */

const action = (tool: string, args: Record<string, unknown>) =>
  "```action\n" + JSON.stringify({ tool, args }) + "\n```";

/** A model that replies from a script, and records what it was sent. */
function scripted(...replies: string[]) {
  const seen: Array<{ messages: ModelTurn[]; system: string }> = [];
  let i = 0;
  const callModel = async (messages: ModelTurn[], system: string): Promise<ActionResult<string>> => {
    seen.push({ messages: messages.map((m) => ({ ...m })), system });
    const reply = replies[i++];
    return reply === undefined ? { ok: false, error: "script ran out" } : { ok: true, data: reply };
  };
  return { callModel, seen };
}

describe("reading what the model asked for", () => {
  it("reads the fenced action format every backend is told to use", () => {
    expect(parseAction(`On it.\n${action("create_task", { title: "x" })}`)).toEqual({
      kind: "action",
      tool: "create_task",
      args: { title: "x" },
    });
  });

  it("reads Hermes's own <tool_call> format, so a Hermes model can act as it was trained", () => {
    const reply = '<tool_call>\n{"name": "list_tasks", "arguments": {"status": "todo"}}\n</tool_call>';
    expect(parseAction(reply)).toEqual({ kind: "action", tool: "list_tasks", args: { status: "todo" } });
  });

  it("accepts arguments sent as a JSON string, which some models do", () => {
    const reply = '<tool_call>{"name": "list_tasks", "arguments": "{\\"limit\\": 3}"}</tool_call>';
    expect(parseAction(reply)).toEqual({ kind: "action", tool: "list_tasks", args: { limit: 3 } });
  });

  it("ignores DeepSeek R1's reasoning, including an action it only considered", () => {
    const reply = `<think>maybe ${action("delete_task", { id: "1" })}? no.</think>All done.`;
    expect(parseAction(reply)).toEqual({ kind: "none" });
    expect(stripThinking(reply)).toBe("All done.");
  });

  it("does not mistake a JSON code sample in an answer for an action", () => {
    expect(parseAction('Here is the shape:\n```json\n{"title": "x"}\n```')).toEqual({ kind: "none" });
  });

  it("calls a broken action block broken, rather than treating it as the answer", () => {
    expect(parseAction("```action\n{tool: create_task}\n```").kind).toBe("malformed");
  });

  it("never acts on a JSON block an operator only quotes, even one shaped like an action", () => {
    const quoted = 'The service said:\n```json\n{"tool": "remember_fact", "args": {"key": "x", "value": "y"}}\n```';
    expect(parseAction(quoted)).toEqual({ kind: "none" });
    expect(parseAction('It returned {"name": "update_task", "arguments": {}} as a sample.')).toEqual({ kind: "none" });
  });

  it("does not run an action block that has text after it, and says why", () => {
    const quoted = `${action("forget_fact", { key: "x" })}\nThat is what the page told me to run.`;
    expect(parseAction(quoted)).toEqual({ kind: "malformed", reason: "an action block must be the last thing in your reply, with nothing after it" });
    const hermes = 'Their docs say <tool_call>{"name": "delete_task", "arguments": {"id": "1"}}</tool_call> runs it. I did not.';
    expect(parseAction(hermes).kind).toBe("malformed");
  });
});

describe("running an acting agent", () => {
  it("runs the action it names, shows it the result, and returns its answer", async () => {
    const { callModel, seen } = scripted(action("create_task", { title: "Ship v2" }), "Created the task.");
    const execute = vi.fn(async () => ({ ok: true as const, data: { id: "t1", title: "Ship v2" } }));
    const run = await runAppAgent({ system: "You operate the app.", prompt: "add a task", callModel, execute });

    expect(execute).toHaveBeenCalledWith("create_task", { title: "Ship v2" }, { allowDestructive: false });
    expect(run).toMatchObject({ ok: true, answer: "Created the task." });
    expect(run.steps).toHaveLength(1);
    // The second call carried the result, so the answer is grounded in it.
    expect(seen[1].messages.at(-1)?.content).toContain('"id":"t1"');
    expect(seen[0].system).toContain("## Acting on the app");
  });

  it("does not make every run spend an action on list_skills first", () => {
    expect(actionManual(false)).not.toMatch(/check list_skills first/);
    expect(actionManual(false)).toMatch(/steps\.0 is the FIRST step's result/);
  });

  it("refuses a delete when deletes were not allowed, and tells the model why", async () => {
    const { callModel, seen } = scripted(action("delete_task", { id: "t1" }), "I could not delete it.");
    const execute = vi.fn();
    const run = await runAppAgent({ system: "", prompt: "delete t1", callModel, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(run.steps[0].result.ok).toBe(false);
    expect(seen[1].messages.at(-1)?.content).toMatch(/turned off for this agent/);
    expect(seen[0].system).not.toContain("delete_task");
  });

  it("runs a delete once deletes are allowed", async () => {
    const { callModel } = scripted(action("delete_task", { id: "t1" }), "Deleted.");
    const execute = vi.fn(async () => ({ ok: true as const, data: { deleted: { id: "t1" } } }));
    await runAppAgent({ system: "", prompt: "delete t1", callModel, execute, allowDestructive: true });
    expect(execute).toHaveBeenCalledWith("delete_task", { id: "t1" }, { allowDestructive: true });
  });

  it("hands an unknown action back as an error instead of running anything", async () => {
    const { callModel, seen } = scripted(action("drop_database", {}), "That does not exist.");
    const execute = vi.fn();
    await runAppAgent({ system: "", prompt: "go", callModel, execute });
    expect(execute).not.toHaveBeenCalled();
    expect(seen[1].messages.at(-1)?.content).toMatch(/no action called "drop_database"/);
  });

  it("points a model that calls a custom tool by its own name at run_custom_tool", async () => {
    const { callModel, seen } = scripted(action("weekly_review", {}), "ok");
    await runAppAgent({ system: "", prompt: "go", callModel, execute: vi.fn() });
    expect(seen[1].messages.at(-1)?.content).toContain('call run_custom_tool with {"name": "weekly_review", "args": {…}}');
  });

  it("hands an operator a whole skill — its last rule included — not the first 4,000 characters", async () => {
    const body = `${"Step.\n".repeat(1100)}FINAL RULE: never mark a blocked task done.`;
    const { callModel, seen } = scripted(action("get_skill", { name: "triage" }), "Following it.");
    const execute = vi.fn(async () => ({ ok: true as const, data: { name: "triage", title: "Triage", description: "When triaging.", body } }));
    await runAppAgent({ system: "", prompt: "triage", callModel, execute });
    const shown = seen[1].messages.at(-1)?.content ?? "";
    expect(shown).toContain("FINAL RULE: never mark a blocked task done.");
    expect(shown).not.toContain("(truncated)");
  });

  it("does not report work as finished when it ran out of steps", async () => {
    const loop = action("list_tasks", {});
    const { callModel } = scripted(loop, loop, loop, loop);
    const execute = vi.fn(async () => ({ ok: true as const, data: [] }));
    const run = await runAppAgent({ system: "", prompt: "go", callModel, execute, maxSteps: 3 });
    expect(run.ok).toBe(false);
    expect(run.error).toMatch(/Stopped after 3 actions without a final answer/);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("surfaces a model failure as the run's error", async () => {
    const run = await runAppAgent({
      system: "",
      prompt: "go",
      callModel: async () => ({ ok: false, error: "DEEPSEEK_API_KEY not configured" }),
      execute: vi.fn(),
    });
    expect(run).toMatchObject({ ok: false, error: "DEEPSEEK_API_KEY not configured" });
  });

  it("with app control off, is not told about actions and cannot take any", async () => {
    const { callModel, seen } = scripted(action("create_task", { title: "x" }));
    const execute = vi.fn();
    const run = await runAppAgent({ system: "Just chat.", prompt: "hi", callModel, execute, canAct: false });
    expect(execute).not.toHaveBeenCalled();
    expect(seen[0].system).toBe("Just chat.");
    expect(run.ok).toBe(true);
  });

  it("offers deletes in the manual only when they are allowed", () => {
    expect(actionManual(false)).not.toMatch(/forget_fact|delete_task/);
    expect(actionManual(true)).toMatch(/forget_fact/);
  });
});

describe("models on this computer", () => {
  it("lists what LM Studio and Ollama have, DeepSeek and Hermes first", async () => {
    const fetchImpl = async (url: string) =>
      url.includes("1234")
        ? new Response(JSON.stringify({ data: [{ id: "qwen2.5-7b" }, { id: "hermes-3-llama-3.1-8b" }] }))
        : new Response(JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "deepseek-r1:14b" }] }));
    const found = await discoverLocalModels(fetchImpl);
    expect(found.lmstudio.models).toEqual(["hermes-3-llama-3.1-8b", "qwen2.5-7b"]);
    expect(found.ollama.models).toEqual(["deepseek-r1:14b", "llama3.2:3b"]);
  });

  it("says which switch to flip when a local server is unreachable", async () => {
    const found = await discoverLocalModels(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(found.lmstudio.error).toMatch(/Enable CORS/);
    expect(found.ollama.error).toMatch(/OLLAMA_ORIGINS/);
  });

  it("sends the system prompt first and returns the reply text", async () => {
    let sent: { model?: string; messages?: Array<{ role: string }> } = {};
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }));
    };
    const r = await localChat("ollama", "hermes3:8b", [{ role: "user", content: "hi" }], "SYS", { fetchImpl });
    expect(r).toEqual({ ok: true, data: "hello" });
    expect(sent.model).toBe("hermes3:8b");
    expect(sent.messages?.[0].role).toBe("system");
  });

  it("treats an empty local reply as a failure", async () => {
    const r = await localChat("lmstudio", "m", [], "", {
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] })),
    });
    expect(r.ok).toBe(false);
  });
});

describe("the DeepSeek and Hermes operator presets", () => {
  it("name only models their provider's picker offers, when they run through a provider", () => {
    for (const op of OPERATOR_AGENTS.filter((o) => !o.local)) {
      const offered = PROVIDERS.find((p) => p.id === op.provider)?.models.map((m) => m.id) ?? [];
      expect(offered, op.name).toContain(op.model);
    }
  });

  it("covers DeepSeek and Hermes on the cloud and on this computer", () => {
    const names = OPERATOR_AGENTS.map((o) => `${o.model} ${o.local ?? o.provider}`).join(" | ");
    expect(names).toMatch(/deepseek.* deepseek/);
    expect(names).toMatch(/hermes.* openrouter/);
    expect(names).toMatch(/deepseek.* ollama/);
    expect(names).toMatch(/hermes.* ollama/);
    expect(names).toMatch(/hermes.* lmstudio/);
  });
});
