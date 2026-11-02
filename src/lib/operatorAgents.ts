// DeepSeek and Hermes agents that operate the app, ready to install.
//
// Each is an ordinary Agent Lab agent with `canAct` on, so it runs the action
// loop in `appAgent.ts` over the same actions the MCP server gives Hermes Agent
// and DeepSeek Harness. They differ only in where the model runs: DeepSeek's
// API, OpenRouter, or a server on this computer — so whichever the owner has
// set up, one of these works without editing anything.

import type { LabAgent } from "./agentLab";
import { listAgents, saveAgent } from "./agentLab";
import type { ProviderId } from "./jackie-providers";
import type { LocalRuntime } from "./localModels";

const OPERATOR_SYSTEM = `You are an operator for the user's Jackie app. You act on it for them: you read and
change their task board, their long-term memory and their conversations, using the actions below.

Work in small, checked steps. Look before you change: list or search first when an id is needed.
Report what you actually did, from the action results — never claim an action you did not take.
Keep the final answer short: what changed, and anything that failed.`;

interface OperatorBlueprint {
  name: string;
  role: string;
  provider: ProviderId;
  model: string;
  local?: LocalRuntime;
  why: string;
}

export const OPERATOR_AGENTS: readonly OperatorBlueprint[] = [
  {
    name: "DeepSeek Operator",
    role: "Operates the app · DeepSeek API",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    why: "DeepSeek's own API. Needs DEEPSEEK_API_KEY in Cloud → Secrets.",
  },
  {
    name: "Hermes Operator",
    role: "Operates the app · Hermes via OpenRouter",
    provider: "openrouter",
    model: "nousresearch/hermes-3-llama-3.1-405b:free",
    why: "Nous Hermes 3 405B on OpenRouter's free tier. Needs OPENROUTER_API_KEY.",
  },
  {
    name: "DeepSeek R1 · this PC",
    role: "Operates the app · Ollama on this computer",
    provider: "ollama",
    model: "deepseek-r1:14b",
    local: "ollama",
    why: "Runs on your GPU through Ollama. `ollama pull deepseek-r1:14b` first.",
  },
  {
    name: "Hermes 3 · this PC",
    role: "Operates the app · Ollama on this computer",
    provider: "ollama",
    model: "hermes3:8b",
    local: "ollama",
    why: "Runs on your GPU through Ollama. `ollama pull hermes3:8b` first.",
  },
  {
    name: "Hermes · LM Studio",
    role: "Operates the app · LM Studio on this computer",
    provider: "bionic",
    model: "hermes-3-llama-3.1-8b",
    local: "lmstudio",
    why: "Runs on the model LM Studio has loaded. Pick the exact model in the agent after detecting.",
  },
];

/** Adds any operator not already in the lab, by name. Never overwrites an edited one. */
export function installOperatorAgents(): { added: number; skipped: number } {
  const existing = new Set(listAgents().map((a) => a.name.toLowerCase()));
  const now = Date.now();
  let added = 0;
  let skipped = 0;
  OPERATOR_AGENTS.forEach((bp, i) => {
    if (existing.has(bp.name.toLowerCase())) {
      skipped++;
      return;
    }
    const agent: LabAgent = {
      id: `operator-${bp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${now.toString(36)}-${i}`,
      name: bp.name,
      role: bp.role,
      system: OPERATOR_SYSTEM,
      provider: bp.provider,
      model: bp.model,
      contextBudget: 32_000,
      // A local agent falling back to a cloud provider would move the user's
      // data off the machine without asking, so only cloud agents fall back.
      fallback: !bp.local,
      tags: ["operator", bp.local ? "local" : "cloud"],
      notes: bp.why,
      canAct: true,
      allowDestructive: false,
      ...(bp.local ? { local: bp.local } : {}),
      createdAt: now,
      updatedAt: now,
    };
    saveAgent(agent);
    added++;
  });
  return { added, skipped };
}
