/**
 * The engines the main chat can answer from, and the order it tries them in.
 *
 * The chat used to have exactly one brain: the Lovable AI gateway, behind the
 * `jackie-chat` function. That made every outage total. If the gateway was
 * rate-limited, out of credit, or simply unreachable, Jackie had nothing to say
 * — even on a rig that was sitting there with its own engine running and a
 * local model loaded.
 *
 * So the chat now has a chain rather than a brain:
 *
 *   1. **Jacky** — the owner's own Flask engine, through the `jacky-proxy`
 *      function. Native, private, and the one that knows the rig. It answers in
 *      one piece rather than streaming, so the router paces it out itself.
 *   2. **Bionic** — a BionicGPT (or any OpenAI-compatible) server on the
 *      operator's own hardware. Streams.
 *   3. **Ollama** — the local runner, through `jackie-ollama`. Streams.
 *   4. **DeepSeek** — DeepSeek's own API, through `jackie-deepseek`. Cheap,
 *      strong, and only there when DEEPSEEK_API_KEY is set. Streams.
 *   5. **Cloud** — the Lovable gateway, last. It costs money and leaves the
 *      building, so it is the safety net, not the default.
 *
 * Order is priority. The router walks it from the chosen engine downward, so a
 * failure anywhere above still ends in an answer as long as one link works.
 *
 * **On-device** sits outside the chain. It runs Bonsai 1.7B in the browser tab,
 * so it is only there once the owner has downloaded it, and the reason to pick
 * it is that no provider sees the question. Falling back from it to a cloud
 * engine would send the question exactly where its sender chose not to,
 * and falling *to* it from a server engine would start a 237 MB model nobody
 * asked for. So it answers only when chosen, and nothing answers in its place.
 *
 * Each engine names the secret that turns it on. An engine whose secret is
 * missing answers with `needs_secret`, which the router treats as "not
 * configured, move on" rather than an error worth stopping for.
 */

import { CHAT_MODELS } from "../../supabase/functions/_shared/chatRequest";
import { DEVICE_MODELS } from "./microai/deviceModels";

export type EngineId = "jacky" | "bionic" | "ollama" | "deepseek" | "cloud" | "device";

/** How the router talks to an engine. */
export type EngineKind =
  /** POST to `jacky-proxy` and read one whole JSON answer. */
  | "jacky"
  /** POST to an edge function that answers OpenAI-compatible SSE. */
  | "sse"
  /** Runs in this browser tab (src/lib/microai/bonsaiDevice.ts). */
  | "device";

export interface EngineModel {
  id: string;
  label: string;
  note?: string;
}

export interface EngineDef {
  id: EngineId;
  label: string;
  /** One word for the badge under an answer. */
  short: string;
  kind: EngineKind;
  /** Edge function this engine goes through. */
  fn: string;
  description: string;
  /** Secret that has to exist for this engine to answer at all. */
  requiresSecret?: string;
  helpUrl?: string;
  /** True when the engine runs on hardware the owner controls. */
  local: boolean;
  /**
   * Models the picker offers. Empty means the engine decides for itself —
   * Jacky routes to its own model and takes no model argument.
   */
  models: EngineModel[];
}

export const ENGINES: readonly EngineDef[] = [
  {
    id: "jacky",
    label: "Jacky (native engine)",
    short: "Jacky",
    kind: "jacky",
    fn: "jacky-proxy",
    description:
      "The rig's own Flask engine. Picks its own route and model, keeps everything on your hardware.",
    requiresSecret: "JACKY_API_BASE",
    local: true,
    models: [],
  },
  {
    id: "bionic",
    label: "Bionic (OpenAI-compatible)",
    short: "Bionic",
    kind: "sse",
    fn: "jackie-bionic",
    description:
      "BionicGPT or any OpenAI-compatible server you host. Whatever GGUF you have loaded, streamed.",
    requiresSecret: "BIONIC_BASE_URL",
    helpUrl: "https://bionic-gpt.com/docs/",
    local: true,
    models: [
      { id: "bionic-default", label: "Server default", note: "Whatever BIONIC_MODEL names" },
      { id: "bonsai-1.7b", label: "Bonsai 1.7B", note: "The bundled guidance model" },
      { id: "llama3.3:70b", label: "Llama 3.3 70B" },
      { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B", note: "Code" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (self-hosted)",
    short: "Ollama",
    kind: "sse",
    fn: "jackie-ollama",
    description: "Your own GPU or laptop over a tunnel. Private, free, offline-capable.",
    requiresSecret: "OLLAMA_BASE_URL",
    helpUrl: "https://ollama.com/download",
    local: true,
    models: [
      { id: "llama3.2:3b", label: "Llama 3.2 3B", note: "Laptop-friendly" },
      { id: "llama3.3:70b", label: "Llama 3.3 70B", note: "~40GB VRAM" },
      { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B", note: "Code" },
      { id: "deepseek-r1:32b", label: "DeepSeek R1 32B", note: "Reasoning" },
      { id: "llama3.2:1b", label: "Llama 3.2 1B", note: "Phone-friendly" },
      { id: "hermes3:8b", label: "Hermes 3 8B", note: "Tool-calling tuned" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    kind: "sse",
    fn: "jackie-deepseek",
    description: "DeepSeek's own API. Low per-token cost; answers before the Lovable gateway when its key is set.",
    requiresSecret: "DEEPSEEK_API_KEY",
    helpUrl: "https://platform.deepseek.com/api_keys",
    local: false,
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "Fast, cheap" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", note: "Stronger reasoning" },
    ],
  },
  {
    id: "cloud",
    label: "Cloud gateway",
    short: "Cloud",
    kind: "sse",
    fn: "jackie-chat",
    description:
      "The Lovable AI gateway. Leaves your hardware and costs credit, so it answers last.",
    requiresSecret: "LOVABLE_API_KEY",
    local: false,
    // The same list the `jackie-chat` function accepts, so the picker cannot
    // offer a model the server will reject.
    models: CHAT_MODELS.map((m) => ({ id: m.id, label: m.label, note: m.description })),
  },
  {
    id: "device",
    label: "On-device",
    short: "On-device",
    kind: "device",
    // Not a model call: it hands this tab Jackie's persona and morals, which
    // never ship in the bundle, and records what the device was given.
    fn: "jackie-device",
    description:
      "Bonsai or another small model, downloaded once and run in this browser, so no provider sees the question. Slow first answers without a GPU.",
    local: true,
    // No allowlist to agree with (rule 5): nothing server-side runs these.
    // The list is deviceModels.ts's, so the picker cannot offer a model the
    // device engine does not know how to fetch.
    models: DEVICE_MODELS.map((m) => ({ id: m.id, label: m.name, note: m.note })),
  },
];

/** Fallback order. The router starts at the chosen engine and walks down. */
export const ENGINE_CHAIN: readonly EngineId[] = ENGINES.filter((e) => e.kind !== "device").map((e) => e.id);

/** What a fresh install talks to first. */
export const DEFAULT_ENGINE: EngineId = "jacky";

export function findEngine(id: unknown): EngineDef | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function isKnownEngine(id: unknown): id is EngineId {
  return findEngine(id) !== undefined;
}

/**
 * The engines to try, in order, when `preferred` is asked for.
 *
 * The preferred engine comes first even if it sits late in the chain; the rest
 * follow in chain order. Choosing Ollama by hand should not mean Jacky and
 * Bionic are gone — it means they come after. On-device is the exception, and
 * the header says why: it is a chain of one.
 */
export function chainFrom(preferred: EngineId): EngineId[] {
  if (findEngine(preferred)?.kind === "device") return [preferred];
  const rest = ENGINE_CHAIN.filter((id) => id !== preferred);
  return [preferred, ...rest];
}

/** The model an engine uses when nothing was picked. Undefined = engine decides. */
export function defaultModelFor(id: EngineId): string | undefined {
  return findEngine(id)?.models[0]?.id;
}
