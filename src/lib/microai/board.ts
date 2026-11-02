import { MICRO_MODELS, findModel } from "./models";
import { readMicroLog, type MicroLogEntry } from "./router";

export interface MicroModelStat {
  id: string;
  name: string;
  family: string;
  sizeLabel: string;
  type: string;
  runs: number;
  failures: number;
  lastRunTs: number | null;
  lastLatencyMs: number | null;
  lastTokens: number | null;
  avgLatencyMs: number | null;
  avgTokens: number | null;
  bestTokensPerSec: number | null;
  lastError?: string;
}

/** Per-model roll-up of every locally logged micro-AI run. Pure read: never writes. */
export function buildMicroBoard(entries: MicroLogEntry[] = readMicroLog()): MicroModelStat[] {
  const byModel = new Map<string, MicroLogEntry[]>();
  for (const e of entries) {
    const list = byModel.get(e.model) ?? [];
    list.push(e);
    byModel.set(e.model, list);
  }

  const ids = new Set<string>([...MICRO_MODELS.map((m) => m.id), ...byModel.keys()]);

  return [...ids]
    .map((id) => {
      const m = findModel(id);
      const runs = (byModel.get(id) ?? []).slice().sort((a, b) => a.ts - b.ts);
      const ok = runs.filter((r) => !r.error);
      const last = runs[runs.length - 1] ?? null;
      const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);
      return {
        id,
        name: m.id === id ? m.name : id,
        family: m.family,
        sizeLabel: m.sizeLabel,
        type: m.type,
        runs: runs.length,
        failures: runs.length - ok.length,
        lastRunTs: last ? last.ts : null,
        lastLatencyMs: last ? Math.round(last.latencyMs) : null,
        lastTokens: last?.tokens ?? null,
        avgLatencyMs: avg(ok.map((r) => r.latencyMs)),
        avgTokens: avg(ok.map((r) => r.tokens ?? 0)),
        bestTokensPerSec: ok.length ? Math.max(...ok.map((r) => r.tokensPerSec ?? 0)) : null,
        lastError: last?.error,
      };
    })
    .sort((a, b) => (b.lastRunTs ?? 0) - (a.lastRunTs ?? 0) || a.sizeLabel.localeCompare(b.sizeLabel));
}

export function boardToCsv(rows: MicroModelStat[]): string {
  const head = ["model", "family", "size", "type", "runs", "failures", "last_run", "last_ms", "last_tokens", "avg_ms", "avg_tokens", "best_tok_per_s"];
  const body = rows.map((r) => [
    r.id, r.family, r.sizeLabel, r.type, r.runs, r.failures,
    r.lastRunTs ? new Date(r.lastRunTs).toISOString() : "",
    r.lastLatencyMs ?? "", r.lastTokens ?? "", r.avgLatencyMs ?? "", r.avgTokens ?? "", r.bestTokensPerSec ?? "",
  ].join(","));
  return [head.join(","), ...body].join("\n");
}
