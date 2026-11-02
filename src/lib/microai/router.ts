import { runLocalModel } from "@/lib/localAI";
import { FALLBACK_MODEL, findModel, type MicroModel } from "./models";

export interface MicroRunMetrics {
  loadMs: number;
  inferenceMs: number;
  tokens: number;
  tokensPerSec: number;
  memoryApproxMB: number;
  model: string;
  fellBack: boolean;
  error?: string;
}

export interface MicroRunResult {
  text: string;
  metrics: MicroRunMetrics;
}

export interface MicroLogEntry {
  ts: number;
  model: string;
  prompt: string;
  response: string;
  latencyMs: number;
  fellBack: boolean;
  error?: string;
  tokens?: number;
  tokensPerSec?: number;
}

const LOG_KEY = "jacky.microai.log";
const MAX_LOG = 200;

export function appendMicroLog(entry: MicroLogEntry) {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const list: MicroLogEntry[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    while (list.length > MAX_LOG) list.shift();
    localStorage.setItem(LOG_KEY, JSON.stringify(list));
  } catch { /* offline storage may be unavailable */ }
}

export function readMicroLog(): MicroLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearMicroLog() {
  try { localStorage.removeItem(LOG_KEY); } catch { /* noop */ }
}

/**
 * Minimal, deterministic micro-AI router.
 * Tries the selected model once; on failure falls back to FALLBACK_MODEL once.
 * Logs every attempt. Never throws — returns an error result instead.
 */
export async function routeMicroPrompt(
  prompt: string,
  modelId: string,
  system?: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<MicroRunResult> {
  const model: MicroModel = findModel(modelId);
  const t0 = performance.now();

  const attempt = async (m: MicroModel, fellBack: boolean): Promise<MicroRunResult> => {
    const loadStart = performance.now();
    const res = await runLocalModel(prompt, {
      model: m.id,
      system,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
    });
    const loadMs = performance.now() - loadStart;
    const inferenceMs = res.tokens > 0 ? loadMs : 0;
    const metrics: MicroRunMetrics = {
      loadMs,
      inferenceMs,
      tokens: res.tokens,
      tokensPerSec: loadMs > 0 ? Math.round((res.tokens / loadMs) * 1000 * 10) / 10 : 0,
      memoryApproxMB: m.sizeMB,
      model: res.model,
      fellBack,
    };
    return { text: res.text, metrics };
  };

  try {
    const out = await attempt(model, false);
    appendMicroLog({
      ts: Date.now(), model: model.id, prompt, response: out.text,
      latencyMs: out.metrics.loadMs, fellBack: false,
      tokens: out.metrics.tokens, tokensPerSec: out.metrics.tokensPerSec,
    });
    return out;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (model.id === FALLBACK_MODEL.id) {
      appendMicroLog({ ts: Date.now(), model: model.id, prompt, response: "", latencyMs: performance.now() - t0, fellBack: false, error: errMsg, tokens: 0, tokensPerSec: 0 });
      return {
        text: "",
        metrics: { loadMs: performance.now() - t0, inferenceMs: 0, tokens: 0, tokensPerSec: 0, memoryApproxMB: model.sizeMB, model: model.id, fellBack: false, error: errMsg },
      };
    }
    try {
      const out = await attempt(FALLBACK_MODEL, true);
      appendMicroLog({
        ts: Date.now(), model: FALLBACK_MODEL.id, prompt, response: out.text,
        latencyMs: out.metrics.loadMs, fellBack: true, error: `primary failed: ${errMsg}`,
        tokens: out.metrics.tokens, tokensPerSec: out.metrics.tokensPerSec,
      });
      return out;
    } catch (err2) {
      const err2Msg = err2 instanceof Error ? err2.message : String(err2);
      appendMicroLog({ ts: Date.now(), model: FALLBACK_MODEL.id, prompt, response: "", latencyMs: performance.now() - t0, fellBack: true, error: `${errMsg}; fallback failed: ${err2Msg}`, tokens: 0, tokensPerSec: 0 });
      return {
        text: "",
        metrics: { loadMs: performance.now() - t0, inferenceMs: 0, tokens: 0, tokensPerSec: 0, memoryApproxMB: FALLBACK_MODEL.sizeMB, model: FALLBACK_MODEL.id, fellBack: true, error: `${errMsg}; fallback failed: ${err2Msg}` },
      };
    }
  }
}
