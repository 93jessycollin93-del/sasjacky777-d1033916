/**
 * The commander: one survey, every unit.
 *
 * Owns the plan cache across squads, so a router fielded by two units — Recall
 * is in both Recon and Workshop — carries one plan, not one per unit. Two
 * copies of the same plan is two chances to disagree about which engine is
 * answering, and the disagreement would surface as a squad reporting ready
 * while the other reports grounded, on the same router, at the same instant.
 *
 * Views observe the snapshot and dispatch `survey()`. They hold no plans and
 * take no observations of their own.
 */
import type { InferenceEngine } from "@/lib/microai/contextRouter";
import type { RouterId } from "@/lib/partitions/types";
import { WorldObserver, type ObserverStats } from "./observer";
import type { Observation, PathPlan } from "./pathPlanner";
import { planAllSquads, type SquadPlan } from "./squads";

export interface SquadSurvey {
  squads: SquadPlan[];
  observation: Observation;
  stats: ObserverStats;
  /** Members that re-derived a route on this survey, across every unit. */
  replanned: number;
  /** Units that can carry out their formation right now. */
  operational: number;
}

export class SquadCommander {
  private plans = new Map<RouterId, PathPlan>();
  private snapshot: SquadSurvey | null = null;
  private listeners = new Set<() => void>();
  private readonly observer: WorldObserver;

  constructor(
    private readonly engines: InferenceEngine[],
    observer?: WorldObserver,
    now: () => number = () => Date.now(),
  ) {
    this.observer = observer ?? new WorldObserver(engines, now);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SquadSurvey | null => this.snapshot;

  /**
   * Plans every unit against one observation and keeps the resulting plans.
   *
   * `force` takes a fresh look rather than reusing the window — used when the
   * person asks, since the one thing worse than a stale plan is a stale plan
   * you just pressed a button to refresh.
   */
  async survey(online: boolean, force = false): Promise<SquadSurvey> {
    const observation = await this.observer.observe(online, force);
    const squads = planAllSquads(this.engines, observation, this.plans);

    for (const squad of squads) {
      for (const member of squad.members) this.plans.set(member.routerId, member.plan);
    }

    this.snapshot = {
      squads,
      observation,
      stats: this.observer.getStats(),
      // Counted over distinct routers, not per unit: a router in two squads
      // re-derives once, and reporting it twice would overstate the churn.
      replanned: new Set(
        squads.flatMap((s) => s.members.filter((m) => m.replanned).map((m) => m.routerId)),
      ).size,
      operational: squads.filter((s) => s.operational).length,
    };

    for (const listener of this.listeners) listener();
    return this.snapshot;
  }

  /** The standing plan for a router, shared across every unit that fields it. */
  getPlan(routerId: RouterId): PathPlan | null {
    return this.plans.get(routerId) ?? null;
  }
}
