/**
 * Provider layer — ported in shape from jackie-core-keeper's jackie-provider-*
 * modules, which already solved fallback, health and key validation.
 *
 * Policy, deliberately strict:
 *  - Nothing is called unless the user configured it via environment.
 *  - No key is ever read from, or written to, anywhere but the environment.
 *  - Every provider failure is non-fatal: the caller falls back to the local
 *    tier rather than surfacing an error. An engine that stops working when a
 *    gateway is down is not an engine you can build a memory system on.
 */

export interface Provider {
  name: string;
  /** Whether this provider is configured at all. */
  available(): boolean;
  complete(system: string, user: string, signal?: AbortSignal): Promise<string>;
}

export interface ProviderEnv {
  OLLAMA_URL?: string;
  OLLAMA_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  CCE_TIMEOUT_MS?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function timeout(env: ProviderEnv): number {
  const n = Number(env.CCE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** Local model server. No key, no cost — the preferred tier when present. */
export function ollamaProvider(env: ProviderEnv): Provider {
  const url = env.OLLAMA_URL;
  const model = env.OLLAMA_MODEL || 'llama3.2';
  return {
    name: `ollama:${model}`,
    available: () => Boolean(url),
    async complete(system, user, signal) {
      if (!url) throw new Error('ollama not configured');
      const res = await fetch(`${url.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: `${system}\n\n---\n\n${user}`, stream: false }),
        signal: signal ?? AbortSignal.timeout(timeout(env)),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
      const json = await res.json() as { response?: string };
      const out = json.response?.trim();
      if (!out) throw new Error('ollama returned an empty completion');
      return out;
    },
  };
}

/**
 * Any OpenAI-compatible chat endpoint: Groq, OpenRouter, the Lovable AI
 * gateway, a local vLLM. One adapter covers all of them because they share
 * the /chat/completions contract.
 */
export function openAICompatibleProvider(env: ProviderEnv): Provider {
  const base = env.OPENAI_BASE_URL;
  const key = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  return {
    name: `openai-compatible:${model}`,
    available: () => Boolean(base && key),
    async complete(system, user, signal) {
      if (!base || !key) throw new Error('openai-compatible provider not configured');
      const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0,
        }),
        signal: signal ?? AbortSignal.timeout(timeout(env)),
      });
      if (!res.ok) throw new Error(`provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json() as { choices?: { message?: { content?: string } }[] };
      const out = json.choices?.[0]?.message?.content?.trim();
      if (!out) throw new Error('provider returned an empty completion');
      return out;
    },
  };
}

export interface ChainResult {
  text: string;
  provider: string;
}

/**
 * Try each configured provider in order. Returns null — never throws — when
 * none is configured or all of them fail, so the caller can fall back cleanly.
 */
export class ProviderChain {
  readonly providers: Provider[];
  readonly failures: { provider: string; error: string }[] = [];

  constructor(env: ProviderEnv = process.env as ProviderEnv) {
    this.providers = [ollamaProvider(env), openAICompatibleProvider(env)].filter((p) => p.available());
  }

  get configured(): boolean {
    return this.providers.length > 0;
  }

  async complete(system: string, user: string): Promise<ChainResult | null> {
    for (const p of this.providers) {
      try {
        return { text: await p.complete(system, user), provider: p.name };
      } catch (err) {
        this.failures.push({ provider: p.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return null;
  }
}
