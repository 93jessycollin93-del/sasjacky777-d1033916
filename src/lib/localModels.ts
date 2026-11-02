/**
 * Models already running on this computer, reached straight from the browser.
 *
 * LM Studio (127.0.0.1:1234) and Ollama (localhost:11434) both speak the OpenAI
 * chat-completions API on the machine the app is open on. Going to them
 * directly needs no tunnel, no secret and no quota, and the conversation never
 * leaves the computer — the right path for a DeepSeek or Hermes model the owner
 * has pulled locally. The edge functions (Bionic, Ollama) remain the way to
 * reach the same servers from somewhere else.
 *
 * Both servers must allow the app's origin: LM Studio's "Enable CORS" switch in
 * its server settings, and OLLAMA_ORIGINS for Ollama. When they do not, the
 * browser reports a bare network error, so the message below says which switch.
 */
import { LM_STUDIO_HOST } from "./lmStudio";
import { OLLAMA_HOST } from "./localAI";
import type { ActionResult } from "./appActions";

export type LocalRuntime = "lmstudio" | "ollama";

export const LOCAL_RUNTIMES: Record<LocalRuntime, { label: string; base: string; corsHint: string }> = {
  lmstudio: {
    label: "LM Studio (this computer)",
    base: LM_STUDIO_HOST,
    corsHint: "Start LM Studio's local server and turn on \"Enable CORS\" in its server settings.",
  },
  ollama: {
    label: "Ollama (this computer)",
    base: OLLAMA_HOST,
    corsHint: "Start Ollama with OLLAMA_ORIGINS set to this app's address (or *), e.g. OLLAMA_ORIGINS=* ollama serve.",
  },
};

/** Model names that mark a DeepSeek or Hermes build, for sorting them first. */
export function isAgentFamily(model: string): boolean {
  return /deepseek|hermes/i.test(model);
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * What each local server has, DeepSeek and Hermes first.
 *
 * LM Studio lists loaded models at /v1/models; Ollama lists pulled ones at
 * /api/tags. A server that is not running comes back as an empty list with the
 * reason, never as a thrown error.
 */
export async function discoverLocalModels(
  fetchImpl: FetchLike = defaultFetch,
): Promise<Record<LocalRuntime, { models: string[]; error?: string }>> {
  const sort = (ids: string[]) =>
    [...new Set(ids)].sort((a, b) => Number(isAgentFamily(b)) - Number(isAgentFamily(a)) || a.localeCompare(b));

  const lm = (async () => {
    try {
      const res = await fetchImpl(`${LM_STUDIO_HOST}/v1/models`);
      if (!res.ok) return { models: [], error: `LM Studio answered HTTP ${res.status}.` };
      const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
      return { models: sort((body.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean)) };
    } catch {
      return { models: [], error: `LM Studio is not reachable. ${LOCAL_RUNTIMES.lmstudio.corsHint}` };
    }
  })();
  const ol = (async () => {
    try {
      const res = await fetchImpl(`${OLLAMA_HOST}/api/tags`);
      if (!res.ok) return { models: [], error: `Ollama answered HTTP ${res.status}.` };
      const body = (await res.json()) as { models?: Array<{ name?: unknown }> };
      return { models: sort((body.models ?? []).map((m) => String(m.name ?? "")).filter(Boolean)) };
    } catch {
      return { models: [], error: `Ollama is not reachable. ${LOCAL_RUNTIMES.ollama.corsHint}` };
    }
  })();
  const [lmstudio, ollama] = await Promise.all([lm, ol]);
  return { lmstudio, ollama };
}

/** One chat turn against a local OpenAI-compatible server. Never throws. */
export async function localChat(
  runtime: LocalRuntime,
  model: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  system: string,
  opts: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<ActionResult<string>> {
  const { base, label, corsHint } = LOCAL_RUNTIMES[runtime];
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  let res: Response;
  try {
    res = await fetchImpl(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, ...messages],
        stream: false,
      }),
      signal: opts.signal,
    });
  } catch {
    return { ok: false, error: `${label} is not reachable. ${corsHint}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `${label} refused (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}` };
  }
  const body = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const text = body?.choices?.[0]?.message?.content;
  return typeof text === "string" && text.trim()
    ? { ok: true, data: text }
    : { ok: false, error: `${label} returned an empty answer from ${model}.` };
}
