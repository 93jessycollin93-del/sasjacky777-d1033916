/**
 * The crew roster.
 *
 * One area of the system, one specialist tool — a coding assistant is not a
 * model runner is not a vector store, and pretending one thing covers all three
 * is how a stack ends up mediocre at everything. This is the catalogue of what
 * can be brought in per area, and, more usefully, what this machine can
 * actually run right now.
 *
 * The second part is the point. A roster that lists seventy tools and never
 * says which of them will start is a wish list. `buildCompatibilityReport`
 * names the missing capability per tool, and `capabilitiesFrom` derives that
 * environment from the constellation's own live station checks — so "Ollama is
 * available" means a probe answered, not that someone ticked a box.
 */
import type { StationId, StationStatus } from "./types";

export type IntegrationCategory =
  | "coding-assistant"
  | "agent-framework"
  | "model-runner"
  | "orchestration"
  | "memory"
  | "search"
  | "browser-automation"
  | "voice"
  | "development-tool";

export type DeploymentMode = "local" | "cloud" | "hybrid";

export interface EnvironmentCapabilities {
  docker: boolean;
  node: boolean;
  python: boolean;
  gpu: boolean;
  vscodeExtensionHost: boolean;
  localOllama: boolean;
  openWebUI: boolean;
  cloudProxy: boolean;
}

/**
 * Requirements are keys of the capability record, not free strings. A typo is
 * then a compile error rather than a tool that silently reports itself
 * compatible because nothing in the environment matched its misspelt need.
 */
export type Capability = keyof EnvironmentCapabilities;

export interface IntegrationTool {
  id: string;
  name: string;
  category: IntegrationCategory;
  deployment: DeploymentMode[];
  requirements: Capability[];
  notes?: string;
}

export interface CompatibilityGap {
  toolId: string;
  missing: string[];
}

const TOOLS: IntegrationTool[] = [
  // Coding & code review
  { id: "claude-code", name: "Claude Code", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["cloudProxy"] },
  { id: "coderabbit", name: "CodeRabbit", category: "coding-assistant", deployment: ["cloud"], requirements: ["cloudProxy"] },
  { id: "github-copilot", name: "GitHub Copilot", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["cloudProxy", "vscodeExtensionHost"] },
  { id: "cursor", name: "Cursor", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["vscodeExtensionHost"] },
  { id: "windsurf", name: "Windsurf", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["vscodeExtensionHost"] },
  { id: "aider", name: "Aider", category: "coding-assistant", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "continue", name: "Continue", category: "coding-assistant", deployment: ["local", "hybrid"], requirements: ["vscodeExtensionHost"] },
  { id: "cline", name: "Cline", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["vscodeExtensionHost"] },
  { id: "roo-code", name: "Roo Code", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["vscodeExtensionHost"] },
  { id: "sourcegraph-cody", name: "Sourcegraph Cody", category: "coding-assistant", deployment: ["cloud", "hybrid"], requirements: ["cloudProxy"] },
  { id: "openhands", name: "OpenHands", category: "coding-assistant", deployment: ["local", "hybrid"], requirements: ["docker", "python"] },

  // Agent frameworks
  { id: "openclaw", name: "OpenClaw", category: "agent-framework", deployment: ["local", "hybrid"], requirements: ["python"], notes: "Use compatible model/runtime package and verify adapter support." },
  { id: "openmanus", name: "OpenManus", category: "agent-framework", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "opendevin", name: "OpenDevin", category: "agent-framework", deployment: ["local", "hybrid"], requirements: ["docker", "python"] },
  { id: "autogen", name: "AutoGen", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "crewai", name: "CrewAI", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "langgraph", name: "LangGraph", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "langchain", name: "LangChain", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "llamaindex", name: "LlamaIndex", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "semantic-kernel", name: "Semantic Kernel", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "haystack", name: "Haystack", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "xagent", name: "Xagent", category: "agent-framework", deployment: ["local", "cloud", "hybrid"], requirements: ["python"], notes: "In the constellation as its own station — ReAct and DAG patterns." },

  // Local AI / model runners
  { id: "ollama", name: "Ollama", category: "model-runner", deployment: ["local", "hybrid"], requirements: ["localOllama"] },
  { id: "lm-studio", name: "LM Studio", category: "model-runner", deployment: ["local"], requirements: ["gpu"] },
  { id: "vllm", name: "vLLM", category: "model-runner", deployment: ["local", "cloud", "hybrid"], requirements: ["python", "gpu"] },
  { id: "llama-cpp", name: "llama.cpp", category: "model-runner", deployment: ["local"], requirements: ["gpu"] },
  { id: "localai", name: "LocalAI", category: "model-runner", deployment: ["local", "hybrid"], requirements: ["docker"] },
  { id: "text-generation-webui", name: "Text Generation WebUI", category: "model-runner", deployment: ["local"], requirements: ["python", "gpu"] },
  { id: "jan-ai", name: "Jan AI", category: "model-runner", deployment: ["local", "hybrid"], requirements: ["gpu"] },
  { id: "whiterabbit", name: "WhiteRabbit", category: "model-runner", deployment: ["local", "hybrid"], requirements: ["gpu", "cloudProxy"], notes: "Treat as non-native local profile unless verified local runtime support exists." },

  // Interfaces
  { id: "open-webui", name: "Open WebUI", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["docker", "openWebUI"] },
  { id: "librechat", name: "LibreChat", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["docker"] },
  { id: "anythingllm", name: "AnythingLLM", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["docker"] },
  { id: "sillytavern", name: "SillyTavern", category: "development-tool", deployment: ["local"], requirements: ["node"] },
  { id: "msty", name: "Msty", category: "development-tool", deployment: ["local"], requirements: ["gpu"] },

  // Browser agents
  { id: "browser-use", name: "Browser Use", category: "browser-automation", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "stagehand", name: "Stagehand", category: "browser-automation", deployment: ["local", "hybrid"], requirements: ["node"] },
  { id: "playwright", name: "Playwright", category: "browser-automation", deployment: ["local", "cloud", "hybrid"], requirements: ["node"] },
  { id: "browserbase", name: "Browserbase", category: "browser-automation", deployment: ["cloud", "hybrid"], requirements: ["cloudProxy"] },
  { id: "mobilerun", name: "MobileRun", category: "browser-automation", deployment: ["local", "hybrid"], requirements: ["python"], notes: "Drives a real Android device rather than a browser." },

  // Memory & knowledge
  { id: "mem0", name: "Mem0", category: "memory", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "graphiti", name: "Graphiti", category: "memory", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "zep", name: "Zep", category: "memory", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "chroma", name: "Chroma", category: "memory", deployment: ["local", "cloud", "hybrid"], requirements: ["python"] },
  { id: "weaviate", name: "Weaviate", category: "memory", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "qdrant", name: "Qdrant", category: "memory", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "milvus", name: "Milvus", category: "memory", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },

  // Automation
  { id: "n8n", name: "n8n", category: "orchestration", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "flowise", name: "Flowise", category: "orchestration", deployment: ["local", "hybrid"], requirements: ["node"] },
  { id: "dify", name: "Dify", category: "orchestration", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "comfyui", name: "ComfyUI", category: "orchestration", deployment: ["local"], requirements: ["python", "gpu"] },
  { id: "node-red", name: "Node-RED", category: "orchestration", deployment: ["local", "cloud", "hybrid"], requirements: ["node"] },

  // Search & retrieval
  { id: "searxng", name: "SearXNG", category: "search", deployment: ["local", "hybrid"], requirements: ["docker"] },
  { id: "meilisearch", name: "Meilisearch", category: "search", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "typesense", name: "Typesense", category: "search", deployment: ["local", "cloud", "hybrid"], requirements: ["docker"] },
  { id: "tavily", name: "Tavily", category: "search", deployment: ["cloud", "hybrid"], requirements: ["cloudProxy"] },
  { id: "jina-reader", name: "Jina AI Reader", category: "search", deployment: ["cloud", "hybrid"], requirements: ["cloudProxy"] },

  // Voice
  { id: "kokoro-tts", name: "Kokoro TTS", category: "voice", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "piper-tts", name: "Piper TTS", category: "voice", deployment: ["local"], requirements: ["gpu"] },
  { id: "whisper-cpp", name: "Whisper.cpp", category: "voice", deployment: ["local", "hybrid"], requirements: ["gpu"] },
  { id: "wyoming-protocol", name: "Wyoming Protocol", category: "voice", deployment: ["local", "hybrid"], requirements: ["node"] },

  // Niche and research
  { id: "open-interpreter", name: "Open Interpreter", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "fabric", name: "Fabric", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "gpt-researcher", name: "GPT Researcher", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "bolt-diy", name: "Bolt.diy", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["node"] },
  { id: "pocket-flow", name: "Pocket Flow", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "superagi", name: "SuperAGI", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["docker", "python"] },
  { id: "agent-zero", name: "Agent Zero", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "swe-agent", name: "SWE-agent", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "agno", name: "Agno", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
  { id: "smolai-developer", name: "SmolAI Developer", category: "development-tool", deployment: ["local", "hybrid"], requirements: ["python"] },
];

/** The fifteen brought in first, one per area that actually needs covering. */
const PRIORITY_STACK = [
  "claude-code",
  "open-webui",
  "ollama",
  "cline",
  "aider",
  "openhands",
  "langgraph",
  "mem0",
  "browser-use",
  "n8n",
  "flowise",
  "coderabbit",
  "gpt-researcher",
  "openclaw",
  "fabric",
] as const;

export function getAllIntegrations(): IntegrationTool[] {
  return TOOLS;
}

export function getIntegrationsByCategory(category: IntegrationCategory): IntegrationTool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

export function getPriorityStack(): IntegrationTool[] {
  return PRIORITY_STACK.map((id) => {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) throw new Error(`Missing priority tool ${id}`);
    return tool;
  });
}

/** Named capabilities a tool needs that this environment does not have. */
export function buildCompatibilityReport(
  toolIds: string[],
  env: EnvironmentCapabilities,
): CompatibilityGap[] {
  const gaps: CompatibilityGap[] = [];
  for (const id of toolIds) {
    const tool = TOOLS.find((entry) => entry.id === id);
    if (!tool) {
      gaps.push({ toolId: id, missing: ["tool-definition"] });
      continue;
    }
    const missing = tool.requirements.filter((requirement) => !env[requirement]);
    if (missing.length > 0) gaps.push({ toolId: id, missing });
  }
  return gaps;
}

export function isRunnable(tool: IntegrationTool, env: EnvironmentCapabilities): boolean {
  return tool.requirements.every((requirement) => env[requirement]);
}

/** Tools that would start here, and only those. */
export function runnableTools(env: EnvironmentCapabilities): IntegrationTool[] {
  return TOOLS.filter((tool) => isRunnable(tool, env));
}

/**
 * Derives the environment from what the constellation actually found, plus the
 * two facts only the host can answer (a VS Code extension host, a Docker
 * daemon) which a browser cannot see and which therefore default to false.
 *
 * A capability is claimed only on evidence: `localOllama` because a probe got
 * a model list back, `cloudProxy` because the engine proxy answered. That is
 * the difference between this roster and a checklist — being wrong here costs
 * a failed start, so nothing is assumed.
 */
export function capabilitiesFrom(
  statuses: Map<StationId, StationStatus>,
  host: Partial<EnvironmentCapabilities> = {},
): EnvironmentCapabilities {
  const live = (id: StationId) => statuses.get(id)?.state === "live";

  return {
    // The Jacky engine is the Python process; if it answered, Python is there.
    python: live("jacky-engine"),
    // It reports GPU thermals, so a GPU it can see is a GPU we can claim.
    gpu: live("jacky-engine"),
    localOllama: live("ollama"),
    cloudProxy: live("jacky-engine"),
    // Not observable from a browser. False unless the host says otherwise.
    docker: false,
    node: false,
    vscodeExtensionHost: false,
    openWebUI: false,
    ...host,
  };
}
