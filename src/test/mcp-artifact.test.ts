import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the one generated file in this repo that is also deployed.
 *
 * `supabase/functions/mcp/index.ts` is committed, but the `mcpPlugin()` in
 * vite.config.ts rewrites it on every `vite dev` / `vite build`. When the
 * plugin cannot bundle — the normal outcome outside Lovable's own environment —
 * it does not fail. It writes an eight-line entry stub that reaches the MCP root
 * through an absolute path on whatever machine ran the build:
 *
 *     import mcp from "npm:C:\Users\...\src\lib\mcp\index.ts";
 *
 * Committing that replaces the real bundle with a file Deno cannot resolve, so
 * every tool on the `mcp` function stops existing in production. It is silent at
 * build time and silent in review, because the file is generated and nobody
 * reads it. It has already happened once during a branch integration.
 *
 * These tests run under vitest, whose config does NOT load mcpPlugin, so the
 * file is never regenerated underneath the assertion. `npm test` therefore
 * checks what is actually on disk and headed for a commit.
 *
 * If this fails: `git checkout -- supabase/functions/mcp/index.ts`, and do not
 * commit the version your build produced.
 */

const artifact = readFileSync(
  resolve(__dirname, "../../supabase/functions/mcp/index.ts"),
  "utf8",
);
const source = readFileSync(resolve(__dirname, "../lib/mcp/index.ts"), "utf8");

describe("supabase/functions/mcp/index.ts (generated, deployed)", () => {
  it("is the bundle, not the entry stub the plugin falls back to", () => {
    expect(artifact).toContain("// src/lib/mcp/tools/");
    expect(artifact.split("\n").length).toBeGreaterThan(100);
  });

  it("contains no absolute filesystem path from the machine that built it", () => {
    // Backslash is spelled via String.fromCharCode so no editor, shell or
    // heredoc can silently collapse it and leave a pattern that matches only
    // forward slashes -- which is exactly how an earlier version of this guard
    // passed against a stub containing "C:\\Users".
    const B = String.fromCharCode(92);
    const patterns = [
      new RegExp("(?<![A-Za-z0-9_])[A-Za-z]:[/" + B + B + "]"),
      /file:[/][/]/,
      new RegExp("[/" + B + B + "](?:Users|home|Temp|tmp)[/" + B + B + "]", "i"),
    ];
    const offenders = artifact
      .split("\n")
      .map((line, n) => ({ line: line.trim(), n: n + 1 }))
      .filter(({ line }) => patterns.some((re) => re.test(line)))
      .map(({ n, line }) => `${n}: ${line}`);
    expect(offenders.join("\n")).toBe("");
  });

  it("still carries every tool the MCP root declares", () => {
    // Derived from the source, so adding a tool cannot leave this test stale.
    const tools = [...source.matchAll(/from\s+"\.\/tools\/([\w-]+)"/g)].map((m) => m[1]);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(artifact).toContain(`// src/lib/mcp/tools/${tool}.ts`);
    }
  });

  it("pins one mcp-js version rather than mixing the plugin's with the bundle's", () => {
    const versions = new Set(
      [...artifact.matchAll(/@lovable\.dev\/mcp-js@([\d.]+)/g)].map((m) => m[1]),
    );
    expect([...versions]).toHaveLength(1);
  });
});
