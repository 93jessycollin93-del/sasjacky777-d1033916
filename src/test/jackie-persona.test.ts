import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { BASE_PROMPT, buildSystemPrompt } from "../../supabase/functions/_shared/persona";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RIG_PROMPT = readFileSync(path.join(REPO_ROOT, "Jackie", "prompts", "system_prompt.md"), "utf8");

// The honesty section, as the bullet lines every engine is given. Taken from the
// prompt itself so the drift check below compares the real text, not a copy of it.
const honestyBullets = (() => {
  const start = BASE_PROMPT.indexOf("You are transparent, honest, realistic, precise, and factual:");
  const lines = BASE_PROMPT.slice(start).split("\n").slice(1);
  return lines.slice(0, lines.findIndex((l) => !l.startsWith("- ")));
})();

describe("Jackie's persona", () => {
  it("gives every engine the honesty rules, whether or not there is project context", () => {
    for (const prompt of [buildSystemPrompt(""), buildSystemPrompt("Router decision: keep the chain.")]) {
      expect(prompt).toContain("Never invent facts, numbers, quotes, sources, links, APIs, file contents, or memories.");
      expect(prompt).toContain("Never present a guess, a skipped step, or a failure as success.");
      expect(prompt).toContain("never fake certainty");
    }
  });

  it("answers a missing memory with 'no record', not a labelled guess", () => {
    // Without this, a small local model asked about a past decision it was never
    // shown invents one and calls it a guess.
    expect(BASE_PROMPT).toContain("If it is not there, say you have no record and ask for a recap.");
  });

  it("reads 'precisely calculated' as checked working, not as claimed infallibility", () => {
    expect(BASE_PROMPT).toContain("then check it another way");
    expect(BASE_PROMPT).toContain("If inputs are rough, give a range.");
    expect(BASE_PROMPT).not.toMatch(/\b(always (right|correct|certain)|never wrong|infallible)\b/i);
  });

  it("keeps the rig-side prompt saying the same thing as the web one", () => {
    // The web Jackie and the rig Jackie answered as two different people once
    // already, because only one of these files was updated.
    expect(honestyBullets.length).toBeGreaterThan(5);
    for (const line of honestyBullets) expect(RIG_PROMPT).toContain(line);
  });

  it("stays small enough to leave a local model room for the conversation", () => {
    // Ollama and Bionic run models with small windows; the persona rides on every request.
    expect(BASE_PROMPT.split(/\s+/).length).toBeLessThan(1200);
  });
});
