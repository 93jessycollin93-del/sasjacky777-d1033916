import { useCallback, useEffect, useSyncExternalStore } from "react";
import { constellation } from "@/lib/constellation/service";

/**
 * Thin view onto the constellation service: a snapshot to render and intents to
 * dispatch. No state of its own — the moment a hook starts deciding anything
 * about station health, the panel and the flow can disagree.
 */
export function useConstellation() {
  const snapshot = useSyncExternalStore(
    constellation.subscribe,
    constellation.getSnapshot,
    constellation.getSnapshot,
  );

  useEffect(() => {
    void constellation.refresh();
    const online = () => constellation.setOnline(true);
    const offline = () => constellation.setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  const refresh = useCallback(() => {
    void constellation.refresh();
  }, []);

  return { ...snapshot, stations: constellation.getStations(), refresh };
}
