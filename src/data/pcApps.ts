/**
 * The PC's app roster, as reachable deep links.
 *
 * The PC ships whole under /public/pc-os/ and is framed by /pc (PCDesktop).
 * It resolves `?app=<id>` against its own desktop items on boot, matching
 * either the item id or its appId — which is what lets Jackie open the PC
 * directly on one tool instead of dropping you on the desktop to hunt.
 *
 * GENERATED from the PC's INITIAL_DESKTOP_ITEMS by `npm run gen:pc-apps` in
 * the PC repo. Do not hand-edit — the hand-written menu this replaces had
 * drifted into dead links, which is the failure mode generating it prevents.
 */

export interface PcApp {
  /** Value passed as ?app= — the PC matches this against appId or item id. */
  appId: string;
  /** Label as the PC itself names it. */
  name: string;
  /** Surfaced first in the library. */
  featured?: boolean;
}

export const PC_APPS: PcApp[] = [
  { appId: "activity_center", name: "Activity Center" },
  { appId: "agent_builder", name: "Agent Builder" },
  { appId: "agent_orchestration", name: "Agent Orchestration" },
  { appId: "agent_team_console", name: "Agent Team" },
  { appId: "data-resolver", name: "AI Data Resolver" },
  { appId: "ai_providers", name: "AI Providers" },
  { appId: "aiterm", name: "ai-term" },
  { appId: "ambient_agents", name: "Ambient Agents" },
  { appId: "anomaly_alert", name: "Anomaly Detector" },
  { appId: "api_keys", name: "API Keys" },
  { appId: "app_connector", name: "App Connector" },
  { appId: "app_health_monitor", name: "App Health" },
  { appId: "archiver", name: "Archiver AI" },
  { appId: "audit_trail", name: "Audit Trail" },
  { appId: "automation", name: "Automation" },
  { appId: "blender", name: "Blender AI" },
  { appId: "budget_guardian", name: "Budget Guardian" },
  { appId: "budget_radar", name: "Budget Radar" },
  { appId: "build_vault", name: "BuildVault" },
  { appId: "bus_recorder", name: "Bus Recorder" },
  { appId: "cartographer", name: "Cartographer" },
  { appId: "chat_history_share", name: "Chat Share" },
  { appId: "choreography", name: "Choreography" },
  { appId: "claude_assistant", name: "Claude Assistant" },
  { appId: "clipboard_manager", name: "Clipboard" },
  { appId: "cloud_infrastructure", name: "Cloud Infrastructure" },
  { appId: "coderabbit", name: "CodeRabbit AI" },
  { appId: "codex", name: "Codex" },
  { appId: "colosseum", name: "Colosseum" },
  { appId: "consensus_lab", name: "Consensus Lab" },
  { appId: "cost_analytics", name: "Cost Analytics" },
  { appId: "cross_ai_lab", name: "Cross-AI Lab" },
  { appId: "dependency_cve_checker", name: "CVE Checker" },
  { appId: "cyber_rulebook", name: "Cyber Codex" },
  { appId: "data_pods", name: "Data Pods Vault" },
  { appId: "data_redaction", name: "Data Redaction" },
  { appId: "data_vault", name: "Data Vault" },
  { appId: "eru", name: "Eru" },
  { appId: "cybernetic_export", name: "Export OS" },
  { appId: "flash-ui", name: "Flash UI" },
  { appId: "fleet_atlas", name: "Fleet Atlas" },
  { appId: "flipper", name: "Flipper Zero" },
  { appId: "function-call-kitchen", name: "Function Call Kitchen" },
  { appId: "fusion", name: "Fusion" },
  { appId: "snake", name: "Game" },
  { appId: "agentic-vision", name: "Gemini Agentic Vision" },
  { appId: "github_sync", name: "GitHub Sync" },
  { appId: "cloud_deploy", name: "Global Deploy" },
  { appId: "grok_terminal", name: "Grok Terminal" },
  { appId: "notepad", name: "how_to_use.txt" },
  { appId: "integrity_monitor", name: "Integrity Monitor" },
  { appId: "iron-men-arcade", name: "Iron Men Arcade" },
  { appId: "jacky", name: "JACKY v3", featured: true },
  { appId: "knowledge_compressor", name: "Knowledge Condenser" },
  { appId: "langchain", name: "LangChain AI" },
  { appId: "laser-tag", name: "Laser Tag Arcade" },
  { appId: "llm_environment", name: "LLM Studio" },
  { appId: "ollama", name: "Local AI (Ollama)" },
  { appId: "mail", name: "Mail" },
  { appId: "memory_fabric", name: "Memory Fabric" },
  { appId: "mission_control", name: "Mission Control" },
  { appId: "model_router", name: "Model Router" },
  { appId: "ondevice_models", name: "Model Store" },
  { appId: "notification_center", name: "Notifications" },
  { appId: "bot_studio", name: "Offline AI Studio" },
  { appId: "cortex", name: "Offline Cortex" },
  { appId: "okse_sandbox", name: "Okse Sandbox" },
  { appId: "openclaw", name: "OpenClaw Hub" },
  { appId: "terminal", name: "Opus Terminal" },
  { appId: "papers_with_code", name: "Papers With Code" },
  { appId: "permission_broker", name: "Permissions" },
  { appId: "prompt_genome", name: "Prompt Genome" },
  { appId: "prompt_library", name: "Prompt Library" },
  { appId: "prompt-to-json", name: "Prompt to JSON" },
  { appId: "qpdb", name: "qpdb Matrix" },
  { appId: "research_rabbit", name: "ResearchRabbit AI" },
  { appId: "secrets_hygiene", name: "Secrets Hygiene" },
  { appId: "secrets_vault", name: "Secrets Vault" },
  { appId: "security_center", name: "Security Center" },
  { appId: "security_event_log", name: "Security Log" },
  { appId: "self_audit_scanner", name: "Self-Audit Scanner" },
  { appId: "pod_system", name: "Semantic Pod" },
  { appId: "semantic_scholar", name: "Semantic Scholar" },
  { appId: "session_recorder", name: "Session Recorder" },
  { appId: "system_settings", name: "Settings" },
  { appId: "slides", name: "Slides" },
  { appId: "small_agent_fleet", name: "Small Agent Fleet" },
  { appId: "speed_racer", name: "Speed Racer" },
  { appId: "storage_stats", name: "Storage Stats" },
  { appId: "supersayen", name: "SuperSayen AI" },
  { appId: "cybernetic67", name: "Telegram Replica" },
  { appId: "termstudio", name: "TermStudio" },
  { appId: "understudy", name: "The Understudy" },
  { appId: "pc_themes", name: "Themes" },
  { appId: "time_machine", name: "Time Machine" },
  { appId: "tool_registry", name: "Tool Registry" },
  { appId: "ui_studio", name: "UI Studio" },
  { appId: "unreal_engine", name: "Unreal Engine AI" },
  { appId: "voice_commands", name: "Voice Commands" },
  { appId: "workspace_manager", name: "Workspaces" },
  { appId: "chess", name: "Zenith Chess AI" },
];

/** Folders on the PC desktop, also addressable via ?app=<id>. */
export const PC_FOLDERS: PcApp[] = [
  { appId: "docs", name: "Documents" },
  { appId: "projects", name: "Projects" },
];

/** Deep link into the embedded PC for a given app id. */
export const pcAppHref = (appId: string) => `/pc?app=${encodeURIComponent(appId)}`;
