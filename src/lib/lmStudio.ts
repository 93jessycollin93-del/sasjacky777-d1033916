/**
 * LM Studio, as the hub the rest of the system points at.
 *
 * The Repair Bay already tells the operator this in words — "your weights
 * already live in LM Studio, so treat that folder as the single source and
 * point everything else at it… one file, one server, every client. No second
 * copy on disk." This is the code that takes its own advice: guidance asks the
 * hub what it is serving and uses that, instead of the app carrying a duplicate
 * of a model the machine already has.
 *
 * The server is OpenAI-compatible (`lms server start`), so this is the same
 * shape as any /v1 client — deliberately written by hand rather than pulling a
 * dependency in for two endpoints.
 */

/** Where `lms server start` listens. Loopback, so it never leaves the machine. */
export const LM_STUDIO_HOST = "http://127.0.0.1:1234";

export interface LmStudioResult {
  text: string;
  /** The model that actually answered, as the server named it. */
  model: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Models the hub currently has loaded, newest API shape first.
 *
 * Returns an empty list rather than throwing when the hub is not up: callers
 * use this as an availability check as well as a roster, and "nothing is
 * loaded" and "nothing is listening" both mean the same thing to them.
 */
export async function listModels(fetchImpl: FetchLike = fetch): Promise<string[]> {
  try {
    const res = await fetchImpl(`${LM_STUDIO_HOST}/v1/models`);
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Picks which loaded model answers.
 *
 * The preferred id wins when the hub has it. Otherwise the first loaded model
 * does, because the useful question is "what is this machine serving right
 * now", not "does it serve the one model this app was written against". That is
 * what lets the operator load whichever model they like — Bionic, Bonsai,
 * anything — and have guidance use it without a code change.
 */
export function pickModel(loaded: string[], preferred?: string): string | null {
  if (!loaded.length) return null;
  if (preferred) {
    const exact = loaded.find((id) => id === preferred);
    if (exact) return exact;
    // LM Studio ids carry the publisher and quantisation, so the app's short
    // name is usually a substring of the real one rather than equal to it.
    const partial = loaded.find((id) => id.toLowerCase().includes(preferred.toLowerCase()));
    if (partial) return partial;
  }
  return loaded[0];
}

export interface LmStudioOptions {
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

/** One completion from the hub. Throws with the server's own words on failure. */
export async function runLmStudio(
  prompt: string,
  options: LmStudioOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<LmStudioResult> {
  const loaded = await listModels(fetchImpl);
  const model = pickModel(loaded, options.model);
  if (!model) throw new Error("LM Studio has no model loaded");

  const messages = [
    ...(options.system ? [{ role: "system", content: options.system }] : []),
    { role: "user", content: prompt },
  ];

  const res = await fetchImpl(`${LM_STUDIO_HOST}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 220,
      stream: false,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`LM Studio ${res.status}: ${detail}`);
  }

  const body = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };
  return {
    text: (body.choices?.[0]?.message?.content ?? "").trim(),
    model: body.model ?? model,
  };
}
