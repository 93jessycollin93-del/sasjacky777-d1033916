import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadThread, saveThread, clearThread, clearAllThreads, listThreads,
  threadKey, threadSummary, newMessageId, MAX_MESSAGES, type ChatMessage,
} from "@/lib/microai/chatHistory";
import { CHAT_BACKENDS, findBackend, defaultModelOf, sendChat } from "@/lib/microai/chatBackends";
import * as gemini from "@/lib/geminiEngine";
import * as microRouter from "@/lib/microai/router";

const msg = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: newMessageId(), role, text, ts: Date.now(),
});

/**
 * Chat on /micro that outlives the tab.
 *
 * The page kept its conversation in React state, so a reload threw it away —
 * which makes asking two models the same question impossible, because the first
 * answer is gone before the second arrives. Each model keeps its own thread,
 * and a write that did not land says so rather than leaving a screen full of
 * messages implying they are saved.
 */
describe("threads that survive a reload", () => {
  beforeEach(() => localStorage.clear());

  it("reads back what was written, per model", () => {
    saveThread(threadKey("groq", "llama-3.3"), [msg("user", "hi groq")]);
    saveThread(threadKey("device", "bonsai-1.7b"), [msg("user", "hi bonsai")]);

    expect(loadThread(threadKey("groq", "llama-3.3")).messages[0].text).toBe("hi groq");
    expect(loadThread(threadKey("device", "bonsai-1.7b")).messages[0].text).toBe("hi bonsai");
  });

  it("keeps one model's thread out of another's", () => {
    saveThread(threadKey("groq", "a"), [msg("user", "one")]);
    expect(loadThread(threadKey("groq", "b")).messages).toEqual([]);
  });

  it("says when the write did not land, instead of implying it did", () => {
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    try {
      expect(saveThread("k", [msg("user", "x")])).toBe(false);
    } finally {
      full.mockRestore();
    }
  });

  it("confirms the write that did land", () => {
    expect(saveThread("k", [msg("user", "x")])).toBe(true);
  });

  it("treats a corrupt thread as empty rather than throwing", () => {
    localStorage.setItem("jacky.microai.chat.v1.broken", "{not json");
    expect(loadThread("broken").messages).toEqual([]);
  });

  it("drops entries that are not messages", () => {
    localStorage.setItem(
      "jacky.microai.chat.v1.mixed",
      JSON.stringify({ key: "mixed", updatedAt: 1, messages: [{ role: "user", text: "keep" }, null, 42, {}] }),
    );
    expect(loadThread("mixed").messages).toHaveLength(1);
  });

  it("caps a thread so one conversation cannot eat the quota", () => {
    const many = Array.from({ length: MAX_MESSAGES + 25 }, (_, i) => msg("user", `m${i}`));
    saveThread("big", many);
    const back = loadThread("big").messages;
    expect(back).toHaveLength(MAX_MESSAGES);
    // The tail is kept: the recent turns are the ones that carry the context.
    expect(back[back.length - 1].text).toBe(`m${MAX_MESSAGES + 24}`);
  });

  it("lists every saved thread, newest first", () => {
    saveThread(threadKey("groq", "a"), [msg("user", "older")]);
    vi.setSystemTime(new Date(Date.now() + 5_000));
    saveThread(threadKey("ollama", "b"), [msg("user", "newer")]);

    const keys = listThreads().map((t) => t.key);
    expect(keys).toEqual([threadKey("ollama", "b"), threadKey("groq", "a")]);
    vi.useRealTimers();
  });

  it("leaves an emptied thread out of the list", () => {
    saveThread(threadKey("groq", "a"), [msg("user", "x")]);
    clearThread(threadKey("groq", "a"));
    expect(listThreads()).toEqual([]);
  });

  it("clears every thread at once without touching other keys", () => {
    saveThread(threadKey("groq", "a"), [msg("user", "x")]);
    localStorage.setItem("jacky.something.else", "keep me");
    clearAllThreads();
    expect(listThreads()).toEqual([]);
    expect(localStorage.getItem("jacky.something.else")).toBe("keep me");
  });

  it("summarises a thread by its first question", () => {
    expect(threadSummary({ key: "k", updatedAt: 0, messages: [msg("user", "why won't it post")] }))
      .toBe("why won't it post");
  });
});

describe("the engines /micro can reach", () => {
  it("offers the device, the grounded engine and the cloud", () => {
    const kinds = new Set(CHAT_BACKENDS.map((b) => b.kind));
    expect(kinds).toEqual(new Set(["device", "gemini", "provider"]));
  });

  it("offers the providers that were asked for", () => {
    const ids = CHAT_BACKENDS.map((b) => b.id);
    for (const wanted of ["groq", "openrouter", "ollama", "gemini-enterprise", "device"]) {
      expect(ids).toContain(wanted);
    }
  });

  it("offers Gemini chat models alongside the local ones", () => {
    const lovable = findBackend("lovable");
    expect(lovable.models.some((m) => m.id.startsWith("google/gemini"))).toBe(true);
    expect(findBackend("device").models.some((m) => m.id === "bonsai-1.7b")).toBe(true);
  });

  it("names the secret a backend needs rather than hiding it", () => {
    expect(findBackend("gemini-enterprise").requiresSecret).toBeTruthy();
  });

  it("resolves an unknown backend to the device rather than undefined", () => {
    expect(findBackend("nope").kind).toBe("device");
  });

  it("gives every backend a usable default model", () => {
    for (const b of CHAT_BACKENDS) expect(defaultModelOf(b)).toBeTruthy();
  });
});

describe("sending a turn", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("carries the grounded engine's citations back", async () => {
    vi.spyOn(gemini, "askGemini").mockResolvedValue({
      text: "Reseat it.", citations: [{ title: "Manual", uri: "https://m" }], session: "s/1",
    });
    const r = await sendChat({ backendId: "gemini-enterprise", modelId: "default_assistant", prompt: "why" });
    expect(r.ok).toBe(true);
    expect(r.citations?.[0].title).toBe("Manual");
    expect(r.session).toBe("s/1");
  });

  it("reports a not-connected engine as setup, naming the secret", async () => {
    vi.spyOn(gemini, "askGemini").mockRejectedValue(
      new gemini.GeminiNotConnectedError(["GEMINI_ENTERPRISE_ENGINE_ID"]),
    );
    const r = await sendChat({ backendId: "gemini-enterprise", modelId: "default_assistant", prompt: "why" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/GEMINI_ENTERPRISE_ENGINE_ID/);
  });

  it("treats an empty device answer as a failure, not a blank turn", async () => {
    vi.spyOn(microRouter, "routeMicroPrompt").mockResolvedValue({
      text: "   ",
      metrics: { loadMs: 1, inferenceMs: 1, tokens: 0, tokensPerSec: 0, memoryApproxMB: 1, model: "bonsai-1.7b", fellBack: false },
    });
    const r = await sendChat({ backendId: "device", modelId: "bonsai-1.7b", prompt: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/i);
  });

  it("refuses an empty prompt before spending a call", async () => {
    const run = vi.spyOn(microRouter, "routeMicroPrompt");
    const r = await sendChat({ backendId: "device", modelId: "bonsai-1.7b", prompt: "  " });
    expect(r.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
