import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIEF_OPENING, carryBrief } from "../../supabase/functions/_shared/chatRequest";

const FUNCTIONS = "supabase/functions";
const read = (p: string) => readFileSync(join(FUNCTIONS, p), "utf8");

describe("a caller's own system text never replaces Jackie's instructions", () => {
  it("rides at the front of the first user turn, below the server's prompt", () => {
    const out = carryBrief([{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }], "Answer in JSON.");
    expect(out[0].role).toBe("user");
    expect(out[0].content.startsWith(BRIEF_OPENING)).toBe(true);
    expect(out[0].content).toContain("Answer in JSON.");
    expect(out[0].content.endsWith("hello")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("gets a user turn of its own when the history opens with the assistant", () => {
    const out = carryBrief([{ role: "assistant", content: "earlier answer" }], "Be brief.");
    expect(out.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("leaves the conversation untouched when there is no brief", () => {
    const turns = [{ role: "user" as const, content: "hello" }];
    expect(carryBrief(turns, "  ")).toEqual(turns);
  });

  it("lets only the owner replace the persona", () => {
    const guard = read("_shared/personaGuard.ts");
    expect(guard).toMatch(/explicit && \(await mayReplacePersona\(opts\.userId\)\)/);
    expect(guard).toMatch(/\.eq\("role", "owner"\)/);
  });

  it("sends the guarded conversation, with the caller's id, from every engine that accepts `system`", () => {
    const engines = [
      "jackie-chat/index.ts", "jackie-openrouter/index.ts", "jackie-ollama/index.ts", "jackie-anthropic/index.ts",
      "jackie-bionic/index.ts", "jackie-orchestrate/index.ts", "_shared/openaiCompat.ts",
    ];
    for (const file of engines) {
      const src = read(file);
      expect(src, file).toMatch(/guardedSystemPrompt\([^)]*userId: admission\.userId/);
      expect(src, file).toMatch(/guarded\.conversation\(/);
      expect(src, file).not.toMatch(/\.\.\.verdict\.messages\]/);
    }
  });
});
