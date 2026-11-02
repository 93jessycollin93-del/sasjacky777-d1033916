/**
 * One look at the world, shared.
 *
 * Availability is the expensive part of routing: every engine has to be asked
 * whether it can answer, and that is a round trip each. Doing it per router
 * meant a squad of four paid four times for the same answer, and doing it per
 * request meant paying again a second later for an answer that had not changed.
 *
 * This owns the observation. It takes a real look when there is reason to — the
 * first time, after the window lapses, when connectivity flips, or when
 * something asks it to — and otherwise hands back the one it already has.
 * Connectivity flipping always forces a fresh look, because that is precisely
 * the moment the cached answer is most likely to be wrong.
 *
 * `looks` and `reuses` are kept so the saving is a number the panel can show
 * rather than a claim in a comment.
 */
import type { InferenceEngine } from "@/lib/microai/contextRouter";
import type { Observation } from "./pathPlanner";

/** How long one look is trusted. */
export const OBSERVE_TTL_MS = 15_000;

export interface ObserverStats {
  /** Times every engine was actually probed. */
  looks: number;
  /** Times a cached observation answered instead. */
  reuses: number;
}

export class WorldObserver {
  private cached: Observation | null = null;
  private stats: ObserverStats = { looks: 0, reuses: 0 };
  private inFlight: Promise<Observation> | null = null;

  constructor(
    private readonly engines: InferenceEngine[],
    private readonly now: () => number = () => Date.now(),
    private readonly ttlMs = OBSERVE_TTL_MS,
  ) {}

  getStats(): ObserverStats {
    return { ...this.stats };
  }

  /** The last observation taken, without taking a new one. */
  peek(): Observation | null {
    return this.cached;
  }

  private stale(online: boolean): boolean {
    if (!this.cached) return true;
    if (this.cached.online !== online) return true;
    return this.now() - this.cached.at >= this.ttlMs;
  }

  async observe(online: boolean, force = false): Promise<Observation> {
    if (!force && !this.stale(online) && this.cached) {
      this.stats.reuses += 1;
      return this.cached;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const results = await Promise.all(
        this.engines.map(async (engine) => {
          try {
            return (await engine.available()) ? engine.id : null;
          } catch {
            // An engine that cannot say whether it is ready is not ready. The
            // alternative is treating a thrown probe as availability, which
            // routes work to something that is not there.
            return null;
          }
        }),
      );

      const observation: Observation = {
        online,
        readyEngines: new Set(results.filter((id): id is string => id !== null)),
        at: this.now(),
      };
      this.cached = observation;
      this.stats.looks += 1;
      this.inFlight = null;
      return observation;
    })();

    return this.inFlight;
  }
}
