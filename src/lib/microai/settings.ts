export interface MicroSettings {
  modelId: string;
  temperature: number;
  maxTokens: number;
  seedling: boolean;
  /** Automatically fold every micro answer into the shared knowledge circle. */
  autoFold: boolean;
}

const KEY = "jacky.microai.settings.v1";

export const DEFAULT_SETTINGS: MicroSettings = {
  modelId: "tinystories",
  temperature: 0.7,
  maxTokens: 512,
  seedling: false,
  autoFold: false,
};

export function readSettings(): MicroSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // migrate legacy keys
      const legacyModel = localStorage.getItem("jacky.microai.model");
      const legacySeed = localStorage.getItem("jacky.microai.seedling") === "on";
      return { ...DEFAULT_SETTINGS, modelId: legacyModel || DEFAULT_SETTINGS.modelId, seedling: legacySeed };
    }
    const p = JSON.parse(raw);
    return {
      modelId: typeof p.modelId === "string" ? p.modelId : DEFAULT_SETTINGS.modelId,
      temperature: Number.isFinite(p.temperature) ? Math.min(2, Math.max(0, p.temperature)) : DEFAULT_SETTINGS.temperature,
      maxTokens: Number.isFinite(p.maxTokens) ? Math.min(4096, Math.max(32, Math.round(p.maxTokens))) : DEFAULT_SETTINGS.maxTokens,
      seedling: !!p.seedling,
      autoFold: !!p.autoFold,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(s: MicroSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable */ }
}
