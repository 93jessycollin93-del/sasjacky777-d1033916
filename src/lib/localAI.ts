export interface LocalAIOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  system?: string;
  format?: "json";
}

export interface LocalAIResult {
  text: string;
  tokens: number;
  model: string;
}

/** The local Ollama host. Exported so the station probe checks the same address the runner uses. */
export const OLLAMA_HOST = "http://localhost:11434";

export async function runLocalModel(
  prompt: string,
  options: LocalAIOptions = {}
): Promise<LocalAIResult> {
  const model = options.model || "llama3.2:3b";
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      system: options.system,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.max_tokens ?? 512,
      },
      format: options.format,
    }),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama ${res.status}: ${message}`);
  }

  const json = await res.json();
  return {
    text: (json.response ?? "").trim(),
    tokens: Number(json.eval_count ?? 0),
    model: json.model ?? model,
  };
}
