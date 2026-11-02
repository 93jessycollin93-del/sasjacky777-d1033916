import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { defaultEngines } from "@/lib/microai/contextRouterService";
import { SquadCommander } from "@/lib/squad/commander";

/**
 * The commander is module-scoped so every surface that renders squads reads the
 * same plans. A per-component instance would give each panel its own idea of
 * which engine is answering.
 */
const commander = new SquadCommander(defaultEngines());

export function useSquads(online: boolean) {
  const survey = useSyncExternalStore(
    commander.subscribe,
    commander.getSnapshot,
    commander.getSnapshot,
  );

  useEffect(() => {
    void commander.survey(online);
  }, [online]);

  const refresh = useCallback(() => {
    void commander.survey(online, true);
  }, [online]);

  return useMemo(() => ({ survey, refresh }), [survey, refresh]);
}
