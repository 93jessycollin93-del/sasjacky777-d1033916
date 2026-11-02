// Chat presets: preferred engine + model applied to every new conversation.
// Stored in localStorage so it survives reloads without a DB round-trip.
//
// `engine` is what the main chat routes on now (jacky → bionic → ollama →
// cloud). `provider` stays for the Agent Lab and the provider gallery, which
// still pick from the wider `jackie-providers` registry.
//
// The stored default used to name `google/gemini-3.6-flash`, a model that is
// not in the list the chat function accepts. Every new chat therefore opened on
// a model the picker could not show and the server would refuse, and the only
// reason it worked at all was the silent fallback further down. Defaults that
// do not exist are worse than no default.

import { DEFAULT_CHAT_MODEL } from "../../supabase/functions/_shared/chatRequest";
import { DEFAULT_ENGINE } from "./jackie-engines";

const KEY = "jackie:chat-preset:v1";

export type ChatPreset = {
  /** Main-chat engine: "jacky" | "bionic" | "ollama" | "cloud". */
  engine: string;
  /** Wider provider registry id, used by the Agent Lab. */
  provider: string;
  model: string;
  system?: string;
};

// Jacky — the rig's own engine — answers first. The cloud gateway is the net.
const DEFAULT: ChatPreset = {
  engine: DEFAULT_ENGINE,
  provider: "lovable",
  model: DEFAULT_CHAT_MODEL,
};

export function getChatPreset(): ChatPreset {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    if (!parsed?.model) return DEFAULT;
    return {
      engine: parsed.engine || DEFAULT.engine,
      provider: parsed.provider || "lovable",
      model: parsed.model,
      system: parsed.system,
    };
  } catch {
    return DEFAULT;
  }
}

export function setChatPreset(preset: ChatPreset): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preset));
  } catch {
    /* quota / privacy mode */
  }
}

export function clearChatPreset(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
