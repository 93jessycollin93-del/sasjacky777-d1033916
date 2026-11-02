import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/jackie-providers";
import { LOVABLE_AGENTS } from "@/lib/lovableAgents";
import { CHAT_MODEL_IDS } from "../../supabase/functions/_shared/chatRequest";

/**
 * The /micro picker against what each function will actually send upstream.
 *
 * CLAUDE.md, rule 5: a picker offering a model the function refuses — or, for
 * the functions that fall back instead of refusing, silently swaps for its
 * default — is a failure the person choosing it cannot see. The Lovable entry
 * offered eight models `jackie-chat` had never heard of; every one of them was
 * answered by Gemini 2.5 Flash under another model's name.
 */

/** Every quoted model id in the function's allowlist, however it is spelled. */
function allowlistOf(fn: string): Set<string> | null {
  if (fn === "jackie-chat") return new Set(CHAT_MODEL_IDS);
  const src = readFileSync(join(process.cwd(), "supabase", "functions", fn, "index.ts"), "utf8");
  const block =
    /models:\s*\[([\s\S]*?)\]/.exec(src)?.[1] ??
    /const ALLOWED(?:_MODELS)?\s*=\s*(?:new Set\(\[|allowlistFromEnv\([^,]+,\s*\[)([\s\S]*?)\]/.exec(src)?.[1];
  if (!block) return null;
  return new Set([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

describe("the provider picker", () => {
  for (const provider of PROVIDERS) {
    it(`offers only models ${provider.fn} will really use (${provider.id})`, () => {
      const allowed = allowlistOf(provider.fn);
      if (!allowed) return; // the function takes any model the operator serves
      const offered = provider.models.map((m) => m.id).filter((id) => id !== "bionic-default");
      expect(offered.filter((id) => !allowed.has(id))).toEqual([]);
    });
  }
});

describe("the Lovable agent roster", () => {
  it("runs every agent on a model jackie-chat accepts", () => {
    const unknown = LOVABLE_AGENTS.filter((a) => !CHAT_MODEL_IDS.includes(a.model)).map((a) => `${a.name}: ${a.model}`);
    expect(unknown).toEqual([]);
  });
});
