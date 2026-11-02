import { useCallback, useState } from "react";
import { runLocalModel, type LocalAIResult, type LocalAIOptions } from "@/lib/localAI";

export function useLocalAI() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LocalAIResult | null>(null);

  const run = useCallback(async (prompt: string, options?: LocalAIOptions) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const out = await runLocalModel(prompt, options);
      setResult(out);
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return { run, reset, loading, error, result };
}
