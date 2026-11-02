// Post-conversion verification — a model is only "converted" when the target
// runner loads it and answers a real prompt. This module builds that smoke test
// per runner, judges the raw output honestly, and keeps one record per target so
// the operator can see which runners are proven and which were never tested.
//
// Rules it holds to:
//   · The verdict comes from the runner's own output, never from the fact that a
//     command was issued. Exit 0 with no text is "unclear", not a pass.
//   · Read-only: it loads and prompts. It never writes, moves, or deletes weights.
//   · Every run is recorded with its verbatim output so it can go to the
//     Evidence Log unchanged.

import { findRunner, type Platform, type RunnerId } from "./modelBridge";

export type CheckVerdict = "pass" | "fail" | "unclear";

export type CheckRecord = {
  id: string;
  ts: string;
  target: RunnerId;
  /** Tag, model name or GGUF path the runner was asked to load. */
  modelRef: string;
  prompt: string;
  command: string;
  exitCode: number;
  /** Verbatim combined output, trimmed for storage. */
  output: string;
  durationMs: number;
  verdict: CheckVerdict;
  reason: string;
};

export const VERDICT_LABEL: Record<CheckVerdict, string> = {
  pass: "Loaded and answered",
  fail: "Did not answer",
  unclear: "No usable output",
};

/** The canonical test prompt: short, cheap, and unambiguous to grade. */
export const DEFAULT_PROMPT = "Reply with the single word READY.";

const q = (p: string) => `"${p}"`;

function slug(name: string) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "model";
}

/**
 * The exact command that loads the model in `target` and asks it one prompt.
 * `modelRef` is an Ollama tag, an LM Studio model name, or a GGUF path.
 */
export function smokeTestCommand(
  target: RunnerId,
  modelRef: string,
  platform: Platform,
  prompt = DEFAULT_PROMPT,
): { command: string; note: string } {
  const ref = modelRef.trim();
  const p = prompt.replace(/"/g, "'");
  switch (target) {
    case "ollama":
      return {
        command: `ollama run ${slug(ref || "model")} "${p}"`,
        note: "Loads the tag into VRAM and prints the completion. A 'model not found' here means the install step never registered it.",
      };
    case "lmstudio":
      return {
        command:
          platform === "windows"
            ? `curl -s http://127.0.0.1:1234/v1/chat/completions -H "Content-Type: application/json" -d "{\\"model\\":\\"${slug(ref)}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"${p}\\"}],\\"max_tokens\\":16}"`
            : `curl -s http://127.0.0.1:1234/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"${slug(ref)}","messages":[{"role":"user","content":"${p}"}],"max_tokens":16}'`,
        note: "Needs `lms server start` running. If the server is down this fails even though the file is fine — start it, then re-run.",
      };
    case "bionicgpt":
      return {
        command:
          platform === "windows"
            ? `curl -s http://127.0.0.1:11434/v1/chat/completions -H "Content-Type: application/json" -d "{\\"model\\":\\"${ref || "model"}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"${p}\\"}],\\"max_tokens\\":16}"`
            : `curl -s http://127.0.0.1:11434/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"${ref || "model"}","messages":[{"role":"user","content":"${p}"}],"max_tokens":16}'`,
        note: "BionicGPT answers through its backend, so a pass here proves the backend chain, not a local file.",
      };
    default:
      return {
        command: `llama-cli -m ${q(ref || "<gguf>")} -ngl 999 -c 2048 -n 24 -p "${p}"`,
        note: "Direct llama.cpp load. If this passes and a runner fails, the fault is in the runner's registration, not the weights.",
      };
  }
}

const FAIL_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /model .*not found|no such model|pull the model/i, reason: "the runner does not have this model registered" },
  { re: /connection refused|failed to connect|couldn't connect/i, reason: "the runner's server is not listening" },
  { re: /unable to load model|failed to load model|invalid magic|unknown model architecture/i, reason: "the runner could not load the file" },
  { re: /out of memory|cuda error|insufficient memory/i, reason: "the load ran out of memory" },
  { re: /permission denied|access is denied/i, reason: "the file could not be read with these privileges" },
  { re: /"error"\s*:/i, reason: "the runner returned an error object" },
];

/** Judge a finished smoke test from its own output. Never optimistic. */
export function judgeSmokeTest(r: {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): { verdict: CheckVerdict; reason: string } {
  const out = `${r.stdout}\n${r.stderr}`.trim();
  for (const f of FAIL_PATTERNS) {
    if (f.re.test(out)) return { verdict: "fail", reason: `Verification failed — ${f.reason}.` };
  }
  if (r.exitCode !== 0) {
    return { verdict: "fail", reason: `Command exited ${r.exitCode} — the runner did not complete the request.` };
  }
  if (!out) {
    return { verdict: "unclear", reason: "No output at all, so nothing is proven either way. Re-run in a terminal you can watch." };
  }
  // Try to read an OpenAI-shaped reply first; otherwise any prose counts.
  let text = out;
  try {
    const j = JSON.parse(out) as { choices?: { message?: { content?: string } }[] };
    const c = j.choices?.[0]?.message?.content;
    if (typeof c === "string") text = c;
  } catch {
    /* plain CLI output */
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 2) {
    return { verdict: "unclear", reason: "The runner answered, but with nothing readable. Likely a missing chat template." };
  }
  return {
    verdict: "pass",
    reason: `Loaded and answered: "${clean.slice(0, 120)}"`,
  };
}

/* ------------------------------------------------------------------ */
/* Records — one per target, newest kept                               */
/* ------------------------------------------------------------------ */

const KEY = "jackie.convert.verify.v1";

export function loadChecks(): CheckRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as CheckRecord[]) : [];
    return rows.sort((a, b) => b.ts.localeCompare(a.ts));
  } catch {
    return [];
  }
}

export function saveChecks(rows: CheckRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 100)));
  } catch {
    /* quota — state still holds this session */
  }
}

export function recordCheck(rec: CheckRecord): CheckRecord[] {
  const rows = [rec, ...loadChecks()].slice(0, 100);
  saveChecks(rows);
  return rows;
}

export function clearChecks() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function newCheckId() {
  return `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Latest record per target, so the UI can show a status per runner. */
export function latestByTarget(rows = loadChecks()): Partial<Record<RunnerId, CheckRecord>> {
  const out: Partial<Record<RunnerId, CheckRecord>> = {};
  for (const r of rows) if (!out[r.target]) out[r.target] = r;
  return out;
}

export function checksMarkdown(rows = loadChecks()) {
  if (rows.length === 0) return "# Post-conversion verification\n\nNo verification has been run yet.";
  const lines = ["# Post-conversion verification", ""];
  for (const r of rows) {
    lines.push(
      `## ${findRunner(r.target)?.label ?? r.target} — ${VERDICT_LABEL[r.verdict]}`,
      `- When: ${r.ts}`,
      `- Model: ${r.modelRef || "(not set)"}`,
      `- Prompt: ${r.prompt}`,
      `- Exit code: ${r.exitCode} · ${r.durationMs} ms`,
      "",
      "```",
      r.command,
      "```",
      "",
      "Output:",
      "```",
      r.output.slice(0, 4000) || "(empty)",
      "```",
      "",
      `Verdict: ${r.reason}`,
      "",
    );
  }
  return lines.join("\n");
}

export function checksCsv(rows = loadChecks()) {
  const cell = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["timestamp", "target", "model_ref", "prompt", "command", "exit_code", "duration_ms", "verdict", "reason", "output"];
  const body = rows.map((r) =>
    [r.ts, r.target, r.modelRef, r.prompt, r.command, r.exitCode, r.durationMs, r.verdict, r.reason, r.output]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...body].join("\n");
}
