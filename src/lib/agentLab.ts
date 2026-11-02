// Agent R&D Lab — the workstation's data layer.
//
// Everything here is real: agents persist to localStorage, context budgets
// actually trim the message window before a call, and export/import move real
// JSON files through the browser. Inference itself runs through the existing
// provider edge functions (see jackie-provider-stream), so a run in the lab is
// the same call path the rest of Jackie uses.

import type { ProviderId } from "./jackie-providers";
import type { ChatMessage } from "./jackie-provider-stream";
import type { LocalRuntime } from "./localModels";

export interface LabAgent {
  id: string;
  name: string;
  role: string;
  system: string;
  provider: ProviderId;
  model: string;
  /** Context budget in tokens — the window the agent is allowed to use. */
  contextBudget: number;
  /** Cascade to other providers if this one fails. */
  fallback: boolean;
  tags: string[];
  /** Free-form R&D notes — findings, prompt iterations, observations. */
  notes: string;
  /** May act on the app (tasks, memory, conversations) instead of only answering. */
  canAct?: boolean;
  /** May delete tasks and memory while acting. Off unless turned on. */
  allowDestructive?: boolean;
  /**
   * Run on a model server on this computer (LM Studio / Ollama), reached
   * straight from the browser, instead of through `provider`'s edge function.
   */
  local?: LocalRuntime;
  createdAt: number;
  updatedAt: number;
}

export interface RunRecord {
  id: string;
  agentId: string;
  agentName: string;
  prompt: string;
  output: string;
  servedBy?: string;
  model?: string;
  /** Wall-clock ms for the run. */
  ms: number;
  /** Estimated prompt tokens after budget trimming. */
  promptTokens: number;
  droppedMessages: number;
  error?: string;
  at: number;
}

const AGENTS_KEY = "jackie.agentlab.agents.v1";
const RUNS_KEY = "jackie.agentlab.runs.v1";
const MAX_RUNS = 100;

/** Context presets, so "small" vs "large" context is one click. */
export const CONTEXT_PRESETS: { label: string; tokens: number; hint: string }[] = [
  { label: "Nano", tokens: 2_000, hint: "Tight, cheap, fast — single-shot tasks" },
  { label: "Small", tokens: 8_000, hint: "Focused work, short documents" },
  { label: "Medium", tokens: 32_000, hint: "Multi-file reasoning, long threads" },
  { label: "Large", tokens: 128_000, hint: "Whole-codebase / long-document research" },
  { label: "Max", tokens: 1_000_000, hint: "Everything you've got (model permitting)" },
];

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — state just won't persist */
  }
}

/* ── Agents ─────────────────────────────────────────────────────────── */

export function listAgents(): LabAgent[] {
  return readJson<LabAgent[]>(AGENTS_KEY, []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveAgent(agent: LabAgent): LabAgent {
  const all = readJson<LabAgent[]>(AGENTS_KEY, []);
  const next = { ...agent, updatedAt: Date.now() };
  const i = all.findIndex((a) => a.id === next.id);
  if (i >= 0) all[i] = next;
  else all.push(next);
  writeJson(AGENTS_KEY, all);
  return next;
}

export function deleteAgent(id: string): void {
  writeJson(
    AGENTS_KEY,
    readJson<LabAgent[]>(AGENTS_KEY, []).filter((a) => a.id !== id),
  );
}

export function newAgent(provider: ProviderId, model: string): LabAgent {
  const now = Date.now();
  return {
    id: uid(),
    name: "Untitled agent",
    role: "",
    system: "You are a precise research assistant. Answer with evidence and state your uncertainty.",
    provider,
    model,
    contextBudget: 8_000,
    fallback: true,
    tags: [],
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateAgent(agent: LabAgent): LabAgent {
  const now = Date.now();
  return { ...agent, id: uid(), name: `${agent.name} (copy)`, createdAt: now, updatedAt: now };
}

/* ── Prompt versions ────────────────────────────────────────────────── */

/**
 * A saved snapshot of an agent's system prompt. Prompt engineering is the
 * actual R&D loop — you change wording, run, compare, and need to get back to
 * the version that worked. Versions are per-agent and immutable once saved.
 */
export interface PromptVersion {
  id: string;
  agentId: string;
  label: string;
  system: string;
  at: number;
}

const VERSIONS_KEY = "jackie.agentlab.promptversions.v1";

export function listVersions(agentId: string): PromptVersion[] {
  return readJson<PromptVersion[]>(VERSIONS_KEY, [])
    .filter((v) => v.agentId === agentId)
    .sort((a, b) => b.at - a.at);
}

/** Snapshot the agent's current system prompt under a label. */
export function saveVersion(agentId: string, label: string, system: string): PromptVersion {
  const v: PromptVersion = { id: uid(), agentId, label: label.trim() || "untitled", system, at: Date.now() };
  writeJson(VERSIONS_KEY, [v, ...readJson<PromptVersion[]>(VERSIONS_KEY, [])]);
  return v;
}

export function deleteVersion(id: string): void {
  writeJson(
    VERSIONS_KEY,
    readJson<PromptVersion[]>(VERSIONS_KEY, []).filter((v) => v.id !== id),
  );
}

/** Drop every version belonging to an agent — used when the agent is deleted. */
export function deleteVersionsFor(agentId: string): void {
  writeJson(
    VERSIONS_KEY,
    readJson<PromptVersion[]>(VERSIONS_KEY, []).filter((v) => v.agentId !== agentId),
  );
}

/**
 * Character-level diff summary between two prompts. Deliberately simple: it
 * reports how much changed, not a full patch, and is labelled as such in the UI.
 */
export function diffSummary(a: string, b: string): { added: number; removed: number } {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { removed: Math.max(0, a.length - head - tail), added: Math.max(0, b.length - head - tail) };
}

/* ── Context budgeting ──────────────────────────────────────────────── */

/**
 * Token estimate. Deliberately a heuristic (~4 chars/token) — it is labelled as
 * an estimate everywhere it surfaces, never presented as an exact count.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function messagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
}

/**
 * Trim a conversation to fit the agent's context budget. The system prompt is
 * always kept; oldest turns are dropped first. Returns what actually fits plus
 * how much was dropped, so the UI can report it honestly.
 */
export function fitToBudget(
  messages: ChatMessage[],
  system: string,
  budget: number,
): { messages: ChatMessage[]; tokens: number; dropped: number } {
  const reserve = estimateTokens(system) + 32;
  const room = Math.max(0, budget - reserve);
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content) + 4;
    if (used + cost > room && kept.length > 0) break;
    kept.unshift(messages[i]);
    used += cost;
  }
  return { messages: kept, tokens: used + reserve, dropped: messages.length - kept.length };
}

/* ── Run history ────────────────────────────────────────────────────── */

export function listRuns(agentId?: string): RunRecord[] {
  const all = readJson<RunRecord[]>(RUNS_KEY, []);
  return (agentId ? all.filter((r) => r.agentId === agentId) : all).sort((a, b) => b.at - a.at);
}

export function recordRun(run: Omit<RunRecord, "id" | "at">): RunRecord {
  const rec: RunRecord = { ...run, id: uid(), at: Date.now() };
  const all = [rec, ...readJson<RunRecord[]>(RUNS_KEY, [])].slice(0, MAX_RUNS);
  writeJson(RUNS_KEY, all);
  return rec;
}

export function clearRuns(): void {
  writeJson(RUNS_KEY, []);
}

/* ── Portable assets: export / import ───────────────────────────────── */

export const LAB_FORMAT = "jackie.agentlab/v1";

function download(filename: string, body: string, mime = "application/json"): void {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}

/** Download one agent as a portable .json asset. */
export function exportAgent(agent: LabAgent): void {
  download(`${slug(agent.name)}.agent.json`, JSON.stringify({ format: LAB_FORMAT, agents: [agent] }, null, 2));
}

/** Download the whole lab (all agents) as one bundle. */
export function exportAll(agents: LabAgent[]): void {
  const stamp = new Date().toISOString().slice(0, 10);
  download(`agent-lab-${stamp}.json`, JSON.stringify({ format: LAB_FORMAT, agents }, null, 2));
}

/** Download a run transcript as Markdown — the shareable R&D artifact. */
export function exportRun(run: RunRecord): void {
  const md = [
    `# ${run.agentName} — run`,
    "",
    `- **When:** ${new Date(run.at).toLocaleString()}`,
    `- **Served by:** ${run.servedBy ?? "—"}${run.model ? ` · \`${run.model}\`` : ""}`,
    `- **Latency:** ${(run.ms / 1000).toFixed(2)}s`,
    `- **Prompt tokens (est.):** ${run.promptTokens}${run.droppedMessages ? ` · ${run.droppedMessages} older message(s) trimmed to fit budget` : ""}`,
    "",
    "## Prompt",
    "",
    run.prompt,
    "",
    "## Output",
    "",
    run.error ? `> **Error:** ${run.error}` : run.output,
    "",
  ].join("\n");
  download(`${slug(run.agentName)}-${run.at}.md`, md, "text/markdown");
}

/** One agent's result in a side-by-side comparison. */
export interface ComparisonLane {
  agentName: string;
  provider: string;
  model: string;
  contextBudget: number;
  output: string;
  servedBy?: string;
  servedModel?: string;
  ms?: number;
  promptTokens: number;
  error?: string;
}

/**
 * Download a side-by-side comparison as a Markdown report — the artifact you
 * keep from an R&D session. Includes a results table plus each full output.
 */
export function exportComparison(prompt: string, lanes: ComparisonLane[]): void {
  const stamp = new Date();
  const rows = lanes.map((l) => {
    const served = l.error ? "—" : `${l.servedBy ?? "—"}${l.servedModel ? ` (${l.servedModel})` : ""}`;
    const secs = typeof l.ms === "number" ? `${(l.ms / 1000).toFixed(2)}s` : "—";
    const chars = l.error ? "—" : String(l.output.length);
    return `| ${l.agentName} | ${l.provider} · ${l.model} | ${(l.contextBudget / 1000).toFixed(0)}k | ${served} | ${secs} | ${chars} | ${l.error ? "❌" : "✅"} |`;
  });
  const md = [
    `# Agent comparison — ${stamp.toLocaleString()}`,
    "",
    "## Prompt",
    "",
    prompt,
    "",
    "## Results",
    "",
    "| Agent | Configured | Budget | Served by | Latency | Output chars | |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    `_Prompt tokens are estimates (~4 chars/token). Latency is measured wall-clock._`,
    "",
    "## Outputs",
    "",
    ...lanes.flatMap((l) => [
      `### ${l.agentName}`,
      "",
      l.error ? `> **Error:** ${l.error}` : l.output || "_(empty)_",
      "",
    ]),
  ].join("\n");
  download(`agent-comparison-${stamp.getTime()}.md`, md, "text/markdown");
}

function isAgentish(v: unknown): v is LabAgent {
  const a = v as LabAgent;
  return !!a && typeof a.name === "string" && typeof a.system === "string" && typeof a.provider === "string";
}

/**
 * Read agents out of an exported file. Accepts either the bundle shape
 * ({format, agents:[…]}) or a bare array, and re-ids on import so importing
 * never silently overwrites an existing agent.
 */
export async function importAgentsFromFile(file: File): Promise<LabAgent[]> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const raw = Array.isArray(parsed) ? parsed : (parsed as { agents?: unknown[] })?.agents;
  if (!Array.isArray(raw)) throw new Error("No agents found in that file.");
  const valid = raw.filter(isAgentish);
  if (!valid.length) throw new Error("No agents in that file matched the expected shape.");
  const now = Date.now();
  return valid.map((a) => ({
    ...a,
    id: uid(),
    tags: Array.isArray(a.tags) ? a.tags : [],
    contextBudget: typeof a.contextBudget === "number" ? a.contextBudget : 8_000,
    createdAt: now,
    updatedAt: now,
  }));
}
