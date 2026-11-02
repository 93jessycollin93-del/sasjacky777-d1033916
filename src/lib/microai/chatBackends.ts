/**
 * Everything on `/micro` that can answer a question, in one list.
 *
 * The page could reach exactly one family before this: the micro models in
 * `models.ts`, through `routeMicroPrompt`. Groq, OpenRouter, Ollama and the
 * operator's own Gemini engine were all wired up elsewhere in the app and
 * simply were not offered here, so picking between them meant changing screens.
 *
 * Three kinds answer, and the difference between them is the thing a picker
 * exists to make visible:
 *
 *  - `device` — runs in this tab, on weights this clone carries. Works with the
 *    radio off, costs nothing, and is the only kind that keeps the question on
 *    the machine.
 *  - `provider` — a cloud function behind the gateway. Fast and capable; the
 *    question leaves the device and the call is metered.
 *  - `gemini` — the operator's own grounded engine. Answers from indexed
 *    material and cites it, which none of the others can do.
 *
 * `send` never throws. Every backend resolves to a result that either carries
 * text or says, in words a person can act on, why it does not — an empty answer
 * reported as success is the failure this repository keeps relearning.
 */
import { PROVIDERS, type ProviderId } from "@/lib/jackie-providers";
import { streamProviderChat } from "@/lib/jackie-provider-stream";
import { askGemini, GeminiNotConnectedError, GeminiSkippedError } from "@/lib/geminiEngine";
import { routeMicroPrompt } from "./router";
import { MICRO_MODELS } from "./models";

export type BackendKind = "device" | "provider" | "gemini";

export interface ChatBackendModel {
  id: string;
  label: string;
  note?: string;
}

export interface ChatBackend {
  id: string;
  label: string;
  kind: BackendKind;
  /** One line on what choosing this costs and buys. */
  description: string;
  /** Secret that has to exist for this backend to answer at all. */
  requiresSecret?: string;
  models: ChatBackendModel[];
}

/** Providers offered on `/micro`. Others exist; these are the ones asked for. */
const MICRO_PROVIDER_IDS: ProviderId[] = ["lovable", "groq", "openrouter", "ollama", "google", "deepseek"];

function providerBackend(id: ProviderId): ChatBackend | null {
  const def = PROVIDERS.find((p) => p.id === id);
  if (!def) return null;
  return {
    id: def.id,
    label: def.label,
    kind: "provider",
    description: def.description,
    requiresSecret: def.requiresSecret,
    models: def.models.map((m) => ({ id: m.id, label: m.label, note: m.note })),
  };
}

export const GEMINI_BACKEND: ChatBackend = {
  id: "gemini-enterprise",
  label: "My Gemini Enterprise engine",
  kind: "gemini",
  description: "Grounded in the material you indexed, and cites it. Needs the connector linked.",
  requiresSecret: "GEMINI_ENTERPRISE_API_KEY",
  // The engine picks its own model; the choice here is the engine itself.
  models: [{ id: "default_assistant", label: "Grounded assistant", note: "Answers with citations" }],
};

export const DEVICE_BACKEND: ChatBackend = {
  id: "device",
  label: "On this device",
  kind: "device",
  description: "Runs in the tab on weights this clone carries. Works offline; nothing leaves the machine.",
  models: MICRO_MODELS.map((m) => ({ id: m.id, label: m.name, note: m.sizeLabel })),
};

/** The picker's order: what runs here first, then the grounded engine, then the cloud. */
export const CHAT_BACKENDS: readonly ChatBackend[] = [
  DEVICE_BACKEND,
  GEMINI_BACKEND,
  ...MICRO_PROVIDER_IDS.map(providerBackend).filter((b): b is ChatBackend => b !== null),
];

export function findBackend(id: string): ChatBackend {
  return CHAT_BACKENDS.find((b) => b.id === id) ?? DEVICE_BACKEND;
}

/** The model to select when a backend is chosen and nothing is remembered. */
export function defaultModelOf(backend: ChatBackend): string {
  return backend.models[0]?.id ?? "";
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface SendResult {
  ok: boolean;
  text: string;
  /** What actually answered — a fallback provider may not be the one asked. */
  servedBy: string;
  /** Present when ok is false. Written for the person reading the screen. */
  error?: string;
  citations?: { title?: string; uri?: string; domain?: string }[];
  session?: string | null;
}

/**
 * Asks one backend and returns what came back.
 *
 * `history` is prior turns in this thread, oldest first, so a provider can see
 * the conversation rather than just the last line.
 */
export async function sendChat(opts: {
  backendId: string;
  modelId: string;
  prompt: string;
  history?: ChatTurn[];
  system?: string;
  session?: string | null;
  signal?: AbortSignal;
}): Promise<SendResult> {
  const backend = findBackend(opts.backendId);
  const prompt = opts.prompt.trim();
  if (!prompt) return { ok: false, text: "", servedBy: backend.label, error: "Ask it something first." };

  if (backend.kind === "gemini") {
    try {
      const answer = await askGemini(prompt, { session: opts.session });
      return {
        ok: true,
        text: answer.text,
        servedBy: backend.label,
        citations: answer.citations,
        session: answer.session,
      };
    } catch (e) {
      // Not-connected and declined are setup and content, not outages, and
      // they send someone looking in completely different places.
      if (e instanceof GeminiNotConnectedError) {
        return {
          ok: false, text: "", servedBy: backend.label,
          error: e.missing.length
            ? `Not connected yet — still needs ${e.missing.join(", ")}.`
            : "Not connected yet.",
        };
      }
      if (e instanceof GeminiSkippedError) {
        return {
          ok: false, text: "", servedBy: backend.label,
          error: `Your engine declined to ground that (${e.reasons.join(", ")}).`,
        };
      }
      return { ok: false, text: "", servedBy: backend.label, error: e instanceof Error ? e.message : "Failed." };
    }
  }

  if (backend.kind === "device") {
    const run = await routeMicroPrompt(prompt, opts.modelId, opts.system);
    const served = `${backend.label} · ${run.metrics.model}${run.metrics.fellBack ? " (fell back)" : ""}`;
    if (run.metrics.error) return { ok: false, text: "", servedBy: served, error: run.metrics.error };
    if (!run.text.trim()) {
      return { ok: false, text: "", servedBy: served, error: "The model returned an empty answer." };
    }
    return { ok: true, text: run.text, servedBy: served };
  }

  // Cloud provider, over SSE. Collected here rather than streamed because the
  // panel renders a turn at a time; the stream's own empty-answer rule still
  // applies underneath, so a silent stream arrives as an error, not a blank.
  return await new Promise<SendResult>((resolve) => {
    let text = "";
    let settled = false;
    const done = (r: SendResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    void streamProviderChat({
      provider: backend.id as ProviderId,
      model: opts.modelId,
      system: opts.system,
      messages: [
        ...(opts.history ?? []).map((t) => ({ role: t.role, content: t.text })),
        { role: "user" as const, content: prompt },
      ],
      onDelta: (t) => {
        text += t;
      },
      onDone: (meta) =>
        done({
          ok: true,
          text,
          servedBy: meta ? `${meta.servedBy} · ${meta.model}` : backend.label,
        }),
      onError: (e) => done({ ok: false, text: "", servedBy: backend.label, error: e }),
    });
  });
}
