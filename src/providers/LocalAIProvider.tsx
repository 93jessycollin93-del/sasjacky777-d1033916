import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useLocalAI } from "@/hooks/useLocalAI";
import type { LocalAIResult, LocalAIOptions } from "@/lib/localAI";

interface LocalAIContextValue {
  run: (prompt: string, options?: LocalAIOptions) => Promise<LocalAIResult>;
  reset: () => void;
  loading: boolean;
  error: string | null;
  result: LocalAIResult | null;
}

const LocalAIContext = createContext<LocalAIContextValue | null>(null);

export function LocalAIProvider({ children }: { children: ReactNode }) {
  const { run, reset, loading, error, result } = useLocalAI();
  const value = useMemo(() => ({ run, reset, loading, error, result }), [run, reset, loading, error, result]);
  return <LocalAIContext.Provider value={value}>{children}</LocalAIContext.Provider>;
}

export function useLocalAIContext() {
  const ctx = useContext(LocalAIContext);
  if (!ctx) throw new Error("useLocalAIContext must be used inside LocalAIProvider");
  return ctx;
}
