/**
 * The owner of constellation state.
 *
 * Screens observe this and dispatch intents at it; they do not run probes, hold
 * statuses or decide what the next step is. Keeping that here is what stops the
 * same judgement being made twice, slightly differently, in two panels — the
 * failure this whole layer exists to end.
 *
 * The snapshot identity only changes when something actually changed, so it can
 * back `useSyncExternalStore` without re-rendering the desk on every tick.
 */
import { resolveFlow, type FlowState } from "./flow";
import { STATIONS } from "./stations";
import type { Station, StationId, StationStatus } from "./types";

export interface ConstellationSnapshot {
  flow: FlowState;
  /** Whether a network is available. Offline is a normal state, not an error. */
  online: boolean;
  /** True while probes are in flight. */
  checking: boolean;
  /** Epoch ms of the last completed sweep. 0 before the first. */
  lastCheckedAt: number;
}

export class ConstellationService {
  private statuses = new Map<StationId, StationStatus>();
  private listeners = new Set<() => void>();
  private snapshot: ConstellationSnapshot;
  private inFlight: Promise<ConstellationSnapshot> | null = null;

  constructor(
    private readonly stations: Station[] = STATIONS,
    private readonly isOnline: () => boolean = () =>
      typeof navigator === "undefined" ? true : navigator.onLine,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.snapshot = {
      flow: resolveFlow(this.stations, this.statuses),
      online: this.isOnline(),
      checking: false,
      lastCheckedAt: 0,
    };
  }

  getStations(): Station[] {
    return this.stations;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConstellationSnapshot => this.snapshot;

  private commit(patch: Partial<ConstellationSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      flow: resolveFlow(this.stations, this.statuses),
      online: patch.online ?? this.isOnline(),
    };
    for (const listener of this.listeners) listener();
  }

  /** Records that the network came or went, without re-probing. */
  setOnline(online: boolean) {
    this.commit({ online });
  }

  /**
   * Checks every station at once. A probe that throws is recorded as absent
   * rather than taking the sweep down with it — one dead station must not hide
   * the state of the other sixteen.
   */
  refresh(): Promise<ConstellationSnapshot> {
    if (this.inFlight) return this.inFlight;
    this.commit({ checking: true });

    this.inFlight = (async () => {
      const results = await Promise.all(
        this.stations.map(async (station): Promise<StationStatus> => {
          try {
            const result = await station.probe.check();
            return { id: station.id, ...result, checkedAt: this.now() };
          } catch (error) {
            return {
              id: station.id,
              state: "absent",
              detail: error instanceof Error ? error.message : String(error),
              checkedAt: this.now(),
            };
          }
        }),
      );
      for (const status of results) this.statuses.set(status.id, status);
      this.commit({ checking: false, lastCheckedAt: this.now() });
      this.inFlight = null;
      return this.snapshot;
    })();

    return this.inFlight;
  }

  getStatus(id: StationId): StationStatus | null {
    return this.statuses.get(id) ?? null;
  }
}

/** The instance the app observes. */
export const constellation = new ConstellationService();
