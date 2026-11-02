/**
 * Laser vision: look once, decide, then watch.
 *
 * The router service used to answer the same question on every single request —
 * probe every engine, walk the ladder, pick one — which is a full recalculation
 * to arrive, almost always, at the answer it had a second ago. That is work
 * spent proving nothing changed.
 *
 * This inverts it. A plan is derived once from one observation and carries the
 * short list of conditions that would make it wrong. Afterwards the system
 * checks those conditions, which is a handful of set lookups, instead of
 * re-deriving the decision. It re-plans when an invariant actually breaks, and
 * not before.
 *
 * The invariant that earns its keep is `no-better-engine`. Watching only "is my
 * engine still up" would hold a plan on a LAN engine forever while the device
 * engine came back — correct, and slower than it needed to be. Predicting the
 * optimal path means noticing when a better one opens, not only when the
 * current one closes.
 */
import type { ContextRouterSpec, InferenceEngine } from "@/lib/microai/contextRouter";
import { selectEngine } from "@/lib/microai/contextRouter";
import type { RouterId } from "@/lib/partitions/types";

/** How long a plan is trusted before it is re-derived regardless. */
export const PLAN_TTL_MS = 30_000;

/** What the world looked like when a plan was made. */
export interface Observation {
  online: boolean;
  readyEngines: ReadonlySet<string>;
  /** Epoch ms this observation was taken. */
  at: number;
}

/**
 * A condition the plan depends on. Each is cheap to evaluate — no probing, no
 * ladder walk — which is the whole point: checking is meant to cost far less
 * than deciding.
 */
export type PathInvariant =
  | { kind: "engine-ready"; engineId: string }
  | { kind: "engine-absent"; engineId: string }
  | { kind: "online"; value: boolean }
  | { kind: "no-better-engine"; engineIds: string[] };

export interface PathPlan {
  routerId: RouterId;
  /** The engine that will answer, or null when nothing may. */
  engineId: string | null;
  reason: string;
  /** The observation this was derived from. */
  from: Observation;
  invariants: PathInvariant[];
  /** Epoch ms after which the plan is re-derived even if nothing broke. */
  expiresAt: number;
}

export interface PlanCheck {
  valid: boolean;
  /** Which invariant broke, or why the plan still holds. */
  reason: string;
}

/**
 * Derives the plan and the conditions that would invalidate it.
 *
 * The invariants are built from the ladder, not from the chosen engine alone:
 * everything ranked above the choice is watched for becoming ready, so a better
 * path opening is a deviation the same way a current path closing is.
 */
export function planPath(
  router: ContextRouterSpec,
  engines: InferenceEngine[],
  observation: Observation,
  ttlMs = PLAN_TTL_MS,
): PathPlan {
  const { engine, reason } = selectEngine(router, engines, observation.readyEngines, observation.online);
  const invariants: PathInvariant[] = [{ kind: "online", value: observation.online }];

  if (engine) {
    invariants.push({ kind: "engine-ready", engineId: engine.id });

    // Everything the router would have preferred over this choice.
    const chosenRung = router.ladder.indexOf(engine.locality);
    const better = engines
      .filter((candidate) => {
        const rung = router.ladder.indexOf(candidate.locality);
        return rung !== -1 && rung < chosenRung;
      })
      .map((candidate) => candidate.id);
    if (better.length > 0) invariants.push({ kind: "no-better-engine", engineIds: better });
  } else {
    // Nothing was usable. The plan is only wrong once something becomes usable,
    // so every engine the router would accept is watched for appearing.
    for (const candidate of engines.filter((c) => router.ladder.includes(c.locality))) {
      invariants.push({ kind: "engine-absent", engineId: candidate.id });
    }
  }

  return {
    routerId: router.id,
    engineId: engine?.id ?? null,
    reason,
    from: observation,
    invariants,
    expiresAt: observation.at + ttlMs,
  };
}

/**
 * Checks a plan against a fresh observation without re-deriving it.
 *
 * Returns the first broken invariant by name, so a re-plan can say what
 * actually changed rather than "something did".
 */
export function checkPlan(plan: PathPlan, observation: Observation): PlanCheck {
  if (observation.at >= plan.expiresAt) {
    return { valid: false, reason: "plan expired" };
  }

  for (const invariant of plan.invariants) {
    switch (invariant.kind) {
      case "online":
        if (observation.online !== invariant.value) {
          return { valid: false, reason: `network went ${observation.online ? "up" : "down"}` };
        }
        break;
      case "engine-ready":
        if (!observation.readyEngines.has(invariant.engineId)) {
          return { valid: false, reason: `${invariant.engineId} stopped answering` };
        }
        break;
      case "engine-absent":
        if (observation.readyEngines.has(invariant.engineId)) {
          return { valid: false, reason: `${invariant.engineId} became available` };
        }
        break;
      case "no-better-engine": {
        const better = invariant.engineIds.find((id) => observation.readyEngines.has(id));
        if (better) return { valid: false, reason: `${better} came up and is a shorter path` };
        break;
      }
    }
  }

  return { valid: true, reason: `holds: ${plan.reason}` };
}

/**
 * Reuses the plan while it holds, re-derives it when it does not.
 *
 * Kept pure and separate from the service so the reuse rule can be tested by
 * feeding it observations rather than by counting how often a probe ran.
 */
export function advancePlan(
  plan: PathPlan | null,
  router: ContextRouterSpec,
  engines: InferenceEngine[],
  observation: Observation,
  ttlMs = PLAN_TTL_MS,
): { plan: PathPlan; replanned: boolean; reason: string } {
  if (plan && plan.routerId === router.id) {
    const check = checkPlan(plan, observation);
    if (check.valid) return { plan, replanned: false, reason: check.reason };
    return {
      plan: planPath(router, engines, observation, ttlMs),
      replanned: true,
      reason: check.reason,
    };
  }

  return {
    plan: planPath(router, engines, observation, ttlMs),
    replanned: true,
    reason: plan ? "different router" : "no plan yet",
  };
}
