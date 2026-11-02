import { describe, expect, it, vi } from "vitest";

/**
 * The Guide's device rung running on the model the chat downloaded.
 *
 * One copy of Bonsai on disk and one in memory serves both, and the rung asks
 * it as a chat turn: sent as raw text, the router's instruction had no end of
 * turn, and Bonsai answered and then kept writing questions of its own until
 * the token cap — all of it returned as the answer.
 */

const calls: Array<Record<string, unknown>> = [];
const ensured: Array<unknown> = [];

vi.mock("@/lib/microai/bonsaiDevice", () => ({
  storedBonsai: async () => ({ supported: true, downloaded: true, partial: false }),
  ensureBonsai: async (opts: unknown) => {
    ensured.push(opts);
    return { ok: true };
  },
  unloadBonsai: async () => undefined,
  withBonsai: async (fn: (w: unknown) => Promise<unknown>) =>
    fn({
      createChatCompletion: async (options: Record<string, unknown>) => {
        calls.push(options);
        return { choices: [{ message: { role: "assistant", content: "7" }, finish_reason: "stop" }] };
      },
    }),
}));

const { deviceEngine } = await import("@/lib/microai/deviceEngine");

describe("the device rung on the shared Bonsai", () => {
  it("counts the chat's download as available, without asking the server", async () => {
    const checkWeights = vi.fn(async () => ({ present: false, detail: "an LFS pointer" }));
    const engine = deviceEngine({ checkWeights });
    expect(await engine.available()).toBe(true);
    expect(checkWeights).not.toHaveBeenCalled();
  });

  it("asks the router's prompt as one chat turn, so the answer ends where the model's turn does", async () => {
    calls.length = 0;
    const engine = deviceEngine({ checkWeights: async () => ({ present: false, detail: "" }) });
    const result = await engine.run("You are the Keeper.\n\nQuestion: what is 3 + 4?");

    expect(result).toEqual({ text: "7", model: "bonsai-1.7b" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      messages: [{ role: "user", content: "You are the Keeper.\n\nQuestion: what is 3 + 4?" }],
      max_tokens: 512,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    });
    // Made sure Bonsai is stored (this app's copy only) before loading it.
    expect(ensured.length).toBeGreaterThan(0);
  });
});
