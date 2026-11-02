import { beforeEach, describe, expect, it, vi } from "vitest";
import { runChatHarness } from "@/lib/chatHarness";
import * as router from "@/lib/jackie-router";
import * as runtime from "@/lib/appAgentRuntime";

beforeEach(() => vi.restoreAllMocks());
const tool = (name: string, args = {}) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;
const base = () => ({ userId: "owner", messages: [{ role: "user" as const, content: "What is on my task board?" }], engine: "device" as const, model: "bonsai-1.7b", reviewWrites: false,
  requestApproval: vi.fn(async () => true), onEvent: vi.fn(), onStatus: vi.fn(), onIssue: vi.fn(), signal: new AbortController().signal });
function replies(texts: string[]) {
  return vi.spyOn(router, "routeChat").mockImplementation(async (args) => {
    args.onDelta(texts.shift() ?? "Done.");
    await args.onDone({ engine: "device", model: "bonsai-1.7b", fellBackFrom: [] });
  });
}

describe("the mobile agent harness", () => {
  it("runs a real user-scoped read, observes its result, then returns the model's final answer", async () => {
    const calls = replies([tool("list_tasks"), "Your board has one open task."]);
    const execute = vi.spyOn(runtime, "executeAsUser").mockResolvedValue({ ok: true, data: [{ title: "Ship the repair" }] });
    const options = base();
    const result = await runChatHarness(options);
    expect(result.ok).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(execute).toHaveBeenCalledWith("list_tasks", {}, { allowDestructive: false, expectedUserId: "owner" });
    expect(calls.mock.calls[1][0].messages.at(-1)?.content).toContain("Ship the repair");
    expect(calls.mock.calls.every(([args]) => args.fallback === false)).toBe(true);
  });
  it("does not execute a write in read-only mode, even when the model requests one", async () => {
    replies([tool("create_task", { title: "Unapproved" }), "I cannot create that task in read-only mode."]);
    const execute = vi.spyOn(runtime, "executeAsUser");
    const options = base();
    const result = await runChatHarness(options);
    expect(execute).not.toHaveBeenCalled();
    expect(options.requestApproval).not.toHaveBeenCalled();
    expect(result.steps[0].result).toMatchObject({ ok: false, error: expect.stringContaining("outside this run") });
  });
  it("waits for explicit approval of the exact proposed arguments before writing", async () => {
    replies([tool("create_task", { title: "Approved task" }), "Task created."]);
    let approve!: (value: boolean) => void;
    const execute = vi.spyOn(runtime, "executeAsUser").mockResolvedValue({ ok: true, data: { id: "task" } });
    const requestApproval = vi.fn(() => new Promise<boolean>((resolve) => { approve = resolve; }));
    const request = runChatHarness({ ...base(), reviewWrites: true, requestApproval });
    await vi.waitFor(() => expect(requestApproval).toHaveBeenCalledWith({ tool: "create_task", args: { title: "Approved task" } }));
    expect(execute).not.toHaveBeenCalled();
    approve(true);
    expect((await request).ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not execute a declined write", async () => {
    replies([tool("remember_fact", { key: "plan", value: "Test" }), "You declined that memory."]);
    const execute = vi.spyOn(runtime, "executeAsUser");
    const result = await runChatHarness({ ...base(), reviewWrites: true, requestApproval: async () => false });
    expect(execute).not.toHaveBeenCalled();
    expect(result.steps[0].result.ok).toBe(false);
  });
  it("refuses deletion and outside-service calls even when reviewed writes are enabled", async () => {
    replies([tool("delete_task", { id: "task" }), tool("call_connection"), "Those actions are unavailable."]);
    const execute = vi.spyOn(runtime, "executeAsUser");
    const result = await runChatHarness({ ...base(), reviewWrites: true });
    expect(result.steps).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
  });
  it("stops at its action budget instead of calling an unfinished run successful", async () => {
    const calls = replies(Array.from({ length: 4 }, () => tool("list_tasks")));
    const execute = vi.spyOn(runtime, "executeAsUser").mockResolvedValue({ ok: true, data: [] });
    const result = await runChatHarness(base());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("3 actions");
    expect(calls).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it("stops a cancelled model turn without running app actions", async () => {
    const controller = new AbortController();
    vi.spyOn(router, "routeChat").mockImplementation(async () => { controller.abort(); });
    const execute = vi.spyOn(runtime, "executeAsUser");
    expect(await runChatHarness({ ...base(), signal: controller.signal })).toMatchObject({ ok: false, error: "Stopped." });
    expect(execute).not.toHaveBeenCalled();
  });
  it("Stop settles a pending approval without relying on the approval UI", async () => {
    replies([tool("create_task", { title: "Do not create" })]);
    const controller = new AbortController();
    const execute = vi.spyOn(runtime, "executeAsUser");
    const requestApproval = vi.fn(() => new Promise<boolean>(() => {}));
    const request = runChatHarness({ ...base(), reviewWrites: true, signal: controller.signal, requestApproval });
    await vi.waitFor(() => expect(requestApproval).toHaveBeenCalled());
    controller.abort();
    expect(await request).toMatchObject({ ok: false, error: "Stopped." });
    expect(execute).not.toHaveBeenCalled();
  });
});
