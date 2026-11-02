// Central registry of AI providers Jackie can talk to.
// Order = priority for auto-fallback and UI listing (Lovable first, then free, then freemium, then paid).
// Each entry defines the edge function endpoint + supported models.
// Add a key in Cloud → Secrets to activate providers that require one.

import { CHAT_MODELS } from "../../supabase/functions/_shared/chatRequest";

export type ProviderId =
  | "lovable"
  | "groq"
  | "openrouter"
  | "bionic"
  | "ollama"
  | "google"
  | "mistral"
  | "cerebras"
  | "together"
  | "hf"
  | "deepinfra"
  | "fireworks"
  | "openai"
  | "anthropic"
  | "xai"
  | "deepseek";

export type ProviderTier = "default" | "free" | "freemium" | "paid";

export interface ModelDef {
  id: string;
  label: string;
  note?: string;
  free?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  fn: string;                   // edge function name
  tier: ProviderTier;
  requiresSecret?: string;
  helpUrl?: string;
  free: boolean;                // legacy display flag
  isDefault?: boolean;          // Lovable is always the default
  description: string;
  models: ModelDef[];
}

export const PROVIDERS: ProviderDef[] = [
  // ── DEFAULT ────────────────────────────────────────────────────────
  {
    id: "lovable",
    label: "Lovable AI Gateway",
    fn: "jackie-chat",
    tier: "default",
    free: true,
    isDefault: true,
    description: "Default brain. Zero-config gateway to Gemini + GPT via Lovable. Always tried first.",
    // The exact list `jackie-chat` accepts. This used to be its own list of
    // eight models the function had never heard of, each silently answered by
    // the function's default under the chosen model's name (rule 5).
    models: CHAT_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.description })),
  },

  // ── FREE TIER ──────────────────────────────────────────────────────
  {
    id: "groq",
    label: "Groq",
    fn: "jackie-groq",
    tier: "free",
    free: true,
    requiresSecret: "GROQ_API_KEY",
    helpUrl: "https://console.groq.com/keys",
    description: "Free ~14.4k req/day. Fastest inference (300-1000 tok/s). Real Meta Llama.",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", free: true, note: "Best general" },
      { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", free: true },
      { id: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick 17B", free: true },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", free: true, note: "Fastest" },
      { id: "llama-3.2-11b-vision-preview", label: "Llama 3.2 11B Vision", free: true, vision: true },
      { id: "llama-3.2-90b-vision-preview", label: "Llama 3.2 90B Vision", free: true, vision: true },
      { id: "gemma2-9b-it", label: "Gemma 2 9B", free: true },
      { id: "qwen/qwen3-32b", label: "Qwen 3 32B", free: true },
      { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B", free: true, reasoning: true },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter (free tier)",
    fn: "jackie-openrouter",
    tier: "free",
    free: true,
    requiresSecret: "OPENROUTER_API_KEY",
    helpUrl: "https://openrouter.ai/keys",
    description: "One key → hundreds of models. Free-tier Llama, DeepSeek, Qwen, Gemma.",
    models: [
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B", free: true },
      { id: "meta-llama/llama-3.1-405b-instruct:free", label: "Llama 3.1 405B", free: true, note: "Biggest" },
      { id: "meta-llama/llama-4-maverick:free", label: "Llama 4 Maverick", free: true },
      { id: "meta-llama/llama-4-scout:free", label: "Llama 4 Scout", free: true },
      { id: "deepseek/deepseek-r1:free", label: "DeepSeek R1", free: true, reasoning: true },
      { id: "deepseek/deepseek-chat:free", label: "DeepSeek V3", free: true },
      { id: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B", free: true },
      { id: "qwen/qwen-2.5-coder-32b-instruct:free", label: "Qwen 2.5 Coder 32B", free: true, note: "Coding" },
      { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B", free: true },
      { id: "mistralai/mistral-small-3.1-24b-instruct:free", label: "Mistral Small 3.1 24B", free: true },
      { id: "nousresearch/hermes-3-llama-3.1-405b:free", label: "Hermes 3 405B", free: true },
      // Paid on OpenRouter. Offered because Hermes 4 is the model Hermes Agent
      // is tuned around; the note says so, so nobody picks it thinking it is free.
      { id: "nousresearch/hermes-4-70b", label: "Hermes 4 70B", reasoning: true, note: "Paid" },
      { id: "nousresearch/hermes-4-405b", label: "Hermes 4 405B", reasoning: true, note: "Paid" },
    ],
  },
  {
    id: "google",
    label: "Google AI Studio (Gemini direct)",
    fn: "jackie-google",
    tier: "free",
    free: true,
    requiresSecret: "GOOGLE_AI_STUDIO_KEY",
    helpUrl: "https://aistudio.google.com/apikey",
    description: "Free tier direct to Gemini. Generous quotas for personal use.",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", free: true, vision: true },
      { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", free: true, vision: true },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", free: true, vision: true },
      { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B", free: true, vision: true },
      { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", free: true, vision: true, reasoning: true },
    ],
  },
  {
    id: "mistral",
    label: "Mistral La Plateforme",
    fn: "jackie-mistral",
    tier: "free",
    free: true,
    requiresSecret: "MISTRAL_API_KEY",
    helpUrl: "https://console.mistral.ai/api-keys/",
    description: "Free experimental tier. Mistral Large, Small, Codestral.",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large", free: true },
      { id: "mistral-small-latest", label: "Mistral Small", free: true },
      { id: "open-mistral-nemo", label: "Mistral Nemo", free: true },
      { id: "codestral-latest", label: "Codestral", free: true, note: "Code" },
      { id: "pixtral-large-latest", label: "Pixtral Large", free: true, vision: true },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    fn: "jackie-cerebras",
    tier: "free",
    free: true,
    requiresSecret: "CEREBRAS_API_KEY",
    helpUrl: "https://cloud.cerebras.ai/",
    description: "Free tier. Fastest wafer-scale inference (~2000 tok/s Llama).",
    models: [
      { id: "llama-3.3-70b", label: "Llama 3.3 70B", free: true, note: "~2000 tok/s" },
      { id: "llama3.1-8b", label: "Llama 3.1 8B", free: true, note: "~2500 tok/s" },
      { id: "llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", free: true },
      { id: "qwen-3-32b", label: "Qwen 3 32B", free: true },
    ],
  },
  {
    id: "bionic",
    label: "Bionic (self-hosted, OpenAI-compatible)",
    fn: "jackie-bionic",
    tier: "free",
    free: true,
    requiresSecret: "BIONIC_BASE_URL",
    helpUrl: "https://bionic-gpt.com/docs/",
    description:
      "BionicGPT, LM Studio, llama.cpp or vLLM on your own hardware. Serves whatever GGUF you have loaded. $0.",
    models: [
      { id: "bonsai-1.7b", label: "Bonsai 1.7B", free: true, note: "The bundled guidance model" },
      { id: "llama3.3:70b", label: "Llama 3.3 70B", free: true },
      { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B", free: true, note: "Code" },
      { id: "deepseek-r1:32b", label: "DeepSeek R1 32B", free: true, reasoning: true },
      // LM Studio's own model identifiers, for when Bionic points at LM Studio.
      { id: "hermes-3-llama-3.1-8b", label: "Hermes 3 8B (LM Studio)", free: true },
      { id: "deepseek-r1-distill-qwen-14b", label: "DeepSeek R1 Distill 14B (LM Studio)", free: true, reasoning: true },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (self-hosted)",
    fn: "jackie-ollama",
    tier: "free",
    free: true,
    requiresSecret: "OLLAMA_BASE_URL",
    helpUrl: "https://ollama.com/download",
    description: "Your own GPU/laptop via Cloudflare Tunnel. 100% private, $0.",
    models: [
      { id: "llama3.3:70b", label: "Llama 3.3 70B", free: true, note: "~40GB VRAM" },
      { id: "llama3.2:3b", label: "Llama 3.2 3B", free: true, note: "Laptop-friendly" },
      { id: "llama3.2:1b", label: "Llama 3.2 1B", free: true, note: "Phone-friendly" },
      { id: "llama3.2-vision:11b", label: "Llama 3.2 Vision 11B", free: true, vision: true },
      { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B", free: true, note: "Best local coder" },
      { id: "deepseek-r1:32b", label: "DeepSeek R1 32B", free: true, reasoning: true },
      { id: "deepseek-r1:14b", label: "DeepSeek R1 14B", free: true, reasoning: true, note: "~10GB VRAM" },
      { id: "hermes3:8b", label: "Hermes 3 8B", free: true, note: "Tool-calling tuned" },
      { id: "hermes3:70b", label: "Hermes 3 70B", free: true, note: "~40GB VRAM" },
      { id: "codellama:34b", label: "CodeLlama 34B", free: true },
      { id: "gemma2:9b", label: "Gemma 2 9B", free: true },
      { id: "mistral:7b", label: "Mistral 7B", free: true },
    ],
  },

  // ── FREEMIUM ───────────────────────────────────────────────────────
  {
    id: "together",
    label: "Together AI",
    fn: "jackie-together",
    tier: "freemium",
    free: false,
    requiresSecret: "TOGETHER_API_KEY",
    helpUrl: "https://api.together.xyz/settings/api-keys",
    description: "$1 signup credit. 200+ open models, low pay-as-you-go.",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo" },
      { id: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", label: "Llama 3.1 405B Turbo", note: "Biggest" },
      { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", label: "Llama 4 Maverick" },
      { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1", reasoning: true },
      { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3" },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B", note: "Code" },
      { id: "mistralai/Mixtral-8x22B-Instruct-v0.1", label: "Mixtral 8x22B" },
    ],
  },
  {
    id: "hf",
    label: "Hugging Face Inference",
    fn: "jackie-hf",
    tier: "freemium",
    free: false,
    requiresSecret: "HF_TOKEN",
    helpUrl: "https://huggingface.co/settings/tokens",
    description: "Free rate-limited tier for hosted models. Pay for higher throughput.",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
      { id: "meta-llama/Meta-Llama-3.1-8B-Instruct", label: "Llama 3.1 8B" },
      { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen 2.5 72B" },
      { id: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B" },
    ],
  },
  {
    id: "deepinfra",
    label: "DeepInfra",
    fn: "jackie-deepinfra",
    tier: "freemium",
    free: false,
    requiresSecret: "DEEPINFRA_API_KEY",
    helpUrl: "https://deepinfra.com/dash/api_keys",
    description: "Cheap pay-per-token hosting for open Llama, DeepSeek, Qwen.",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
      { id: "meta-llama/Meta-Llama-3.1-405B-Instruct", label: "Llama 3.1 405B" },
      { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1", reasoning: true },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B" },
    ],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    fn: "jackie-fireworks",
    tier: "freemium",
    free: false,
    requiresSecret: "FIREWORKS_API_KEY",
    helpUrl: "https://fireworks.ai/account/api-keys",
    description: "Signup credit. Fast serving of open models.",
    models: [
      { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B" },
      { id: "accounts/fireworks/models/llama-v3p1-405b-instruct", label: "Llama 3.1 405B" },
      { id: "accounts/fireworks/models/deepseek-r1", label: "DeepSeek R1", reasoning: true },
      { id: "accounts/fireworks/models/qwen2p5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B" },
    ],
  },

  // ── PAID (opt-in only) ─────────────────────────────────────────────
  {
    id: "openai",
    label: "OpenAI (direct)",
    fn: "jackie-openai",
    tier: "paid",
    free: false,
    requiresSecret: "OPENAI_API_KEY",
    helpUrl: "https://platform.openai.com/api-keys",
    description: "Direct OpenAI. Only used if you paste your own key.",
    models: [
      { id: "gpt-4o", label: "GPT-4o", vision: true },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", vision: true },
      { id: "o1", label: "o1", reasoning: true },
      { id: "o1-mini", label: "o1 Mini", reasoning: true },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic (direct)",
    fn: "jackie-anthropic",
    tier: "paid",
    free: false,
    requiresSecret: "ANTHROPIC_API_KEY",
    helpUrl: "https://console.anthropic.com/settings/keys",
    description: "Direct Claude. Only used if you paste your own key.",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5", vision: true, reasoning: true, note: "Default" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", vision: true, reasoning: true },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", vision: true, note: "Fastest, lowest cost" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek (direct)",
    fn: "jackie-deepseek",
    tier: "paid",
    free: false,
    requiresSecret: "DEEPSEEK_API_KEY",
    helpUrl: "https://platform.deepseek.com/api_keys",
    description: "DeepSeek's own API. Low per-token price, strong at code and tool use.",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "Default · fast, cheap" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", reasoning: true },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", reasoning: true, note: "Legacy alias" },
      { id: "deepseek-chat", label: "DeepSeek Chat", note: "Legacy alias" },
    ],
  },
  {
    id: "xai",
    label: "xAI Grok (direct)",
    fn: "jackie-xai",
    tier: "paid",
    free: false,
    requiresSecret: "XAI_API_KEY",
    helpUrl: "https://console.x.ai/",
    description: "Direct xAI. Only used if you paste your own key.",
    models: [
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-4-latest", label: "Grok 4" },
      { id: "grok-3", label: "Grok 3" },
      { id: "grok-3-mini", label: "Grok 3 Mini" },
      { id: "grok-2-latest", label: "Grok 2" },
      { id: "grok-2-vision-latest", label: "Grok 2 Vision", vision: true },
      { id: "grok-beta", label: "Grok Beta" },
    ],
  },
];

export function findProvider(id: ProviderId): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// Priority-ordered ids used by the auto-fallback wrapper.
export const FALLBACK_ORDER: ProviderId[] = PROVIDERS.map((p) => p.id);

export function providersByTier(): Record<ProviderTier, ProviderDef[]> {
  return {
    default: PROVIDERS.filter((p) => p.tier === "default"),
    free: PROVIDERS.filter((p) => p.tier === "free"),
    freemium: PROVIDERS.filter((p) => p.tier === "freemium"),
    paid: PROVIDERS.filter((p) => p.tier === "paid"),
  };
}

// Suggested agent presets (Ollama). At least 3, as requested.
export const OLLAMA_AGENTS = [
  {
    name: "Jackie-Coder",
    model: "qwen2.5-coder:32b",
    system: "You are Jackie-Coder. Terse, output only code, TypeScript+Tailwind, no markdown fences unless asked.",
    role: "Code generation & refactor",
  },
  {
    name: "Jackie-Reasoner",
    model: "deepseek-r1:32b",
    system: "You are Jackie-Reasoner. Think step-by-step. Show reasoning, then a bold conclusion.",
    role: "Complex reasoning, planning, debugging",
  },
  {
    name: "Jackie-Guardian",
    model: "llama-guard-3-8b",
    system: "You are Jackie-Guardian. Classify input for safety. Output JSON: {safe:bool, categories:[]}.",
    role: "Security/safety filter (via Groq or Ollama)",
  },
  {
    name: "Jackie-Fast",
    model: "llama3.2:3b",
    system: "You are Jackie-Fast. Short replies. No preamble.",
    role: "Latency-critical chat / mobile / offline",
  },
  {
    name: "Jackie-Vision",
    model: "llama3.2-vision:11b",
    system: "You are Jackie-Vision. Describe images factually and concisely.",
    role: "Image understanding",
  },
];
