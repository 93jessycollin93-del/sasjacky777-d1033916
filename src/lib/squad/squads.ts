/**
 * Squads: routers combined into units.
 *
 * One router answers one kind of question well. Real work is rarely one kind of
 * question — "can this machine run the model I saved yesterday, and what did we
 * decide about it" is Operator and Recall at once. Asking them separately gets
 * two half-answers and leaves the joining to whoever is reading.
 *
 * A squad is a standing unit with a lead and support, and a formation that says
 * how their work combines. The lead is the router the answer is attributed to;
 * support routers contribute context from partitions the lead cannot read.
 *
 * The operational rule is deliberately strict: a squad is operational only when
 * its LEAD has a path. Support that cannot reach an engine degrades the answer;
 * a lead that cannot reach one means there is no answer to degrade. Reporting
 * a squad ready because two of its three members are up would be the kind of
 * green light that gets acted on and then fails.
 */
import { CONTEXT_ROUTERS, findRouter, type ContextRouterSpec, type InferenceEngine } from "@/lib/microai/contextRouter";
import type { PartitionId, RouterId } from "@/lib/partitions/types";
import { advancePlan, type Observation, type PathPlan } from "./pathPlanner";

export type SquadId = "recon" | "armory" | "vault-guard" | "workshop";

/**
 * How the members' work combines.
 *
 * `lead-and-support` — the lead answers; support supplies context only.
 * `relay` — each member's output is the next member's input, in order.
 * `parallel-consensus` — every member answers the same question; disagreement
 *   is the signal, so this needs at least two members with a path.
 */
export type Formation = "lead-and-support" | "relay" | "parallel-consensus";

export interface SquadSpec {
  id: SquadId;
  name: string;
  /** What this unit is for, in one line. */
  doctrine: string;
  /** Lead first, then support, in the order they contribute. */
  members: RouterId[];
  formation: Formation;
  /** Words that put a task in front of this squad. */
  keywords: string[];
}

export const SQUADS: SquadSpec[] = [
  {
    id: "recon",
    name: "Recon",
    doctrine: "Find out what is true right now — what was decided, what is stored, what the machine says.",
    members: ["recall", "operator"],
    formation: "lead-and-support",
    keywords: ["what", "when", "status", "find", "history", "check", "why"],
  },
  {
    id: "armory",
    name: "Armory",
    doctrine: "Get a model onto this device and running, and keep it inside the budget.",
    members: ["operator", "recall"],
    formation: "lead-and-support",
    keywords: ["model", "download", "load", "quantize", "memory", "budget", "gpu", "run"],
  },
  {
    id: "vault-guard",
    name: "Vault Guard",
    doctrine: "Anything touching identity, keys or backups. Never leaves the device, and never asks anything that would.",
    members: ["keeper"],
    formation: "lead-and-support",
    keywords: ["key", "secret", "vault", "identity", "backup", "restore", "credential"],
  },
  {
    id: "workshop",
    name: "Workshop",
    doctrine: "Build the thing — pods, surfaces, images, audio — with what has been built before as reference.",
    members: ["maker", "recall", "operator"],
    formation: "relay",
    keywords: ["build", "make", "generate", "design", "render", "pod", "surface", "image"],
  },
];

export function findSquad(id: SquadId): SquadSpec {
  const squad = SQUADS.find((s) => s.id === id);
  if (!squad) throw new Error(`unknown squad: ${id}`);
  return squad;
}

export function squadLead(squad: SquadSpec): ContextRouterSpec {
  return findRouter(squad.members[0]);
}

/** Every partition the unit can read between them, in member order, deduplicated. */
export function squadReach(squad: SquadSpec): PartitionId[] {
  const seen = new Set<PartitionId>();
  for (const id of squad.members) {
    for (const partition of findRouter(id).reads) seen.add(partition);
  }
  return [...seen];
}

/**
 * Picks the squad for a task by keyword weight, falling back to Recon — the
 * unit that reads widest and is the safest place to put an unclassified task.
 *
 * Vault Guard is never reached by fallback, only by an explicit match. A task
 * that lands on it by accident would be one asking the strictest unit in the
 * system a question it was not meant to hold.
 */
export function assignSquad(task: string): SquadSpec {
  const lower = task.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);

  let best = findSquad("recon");
  let bestScore = 0;

  for (const squad of SQUADS) {
    const score = squad.keywords.reduce(
      (sum, keyword) => sum + (words.includes(keyword) ? 2 : lower.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      best = squad;
      bestScore = score;
    }
  }
  return best;
}

export interface MemberPlan {
  routerId: RouterId;
  role: "lead" | "support";
  plan: PathPlan;
  replanned: boolean;
  reason: string;
}

export interface SquadPlan {
  squad: SquadSpec;
  members: MemberPlan[];
  /** True when the unit can carry out its formation. */
  operational: boolean;
  /** Why it can or cannot. */
  status: string;
  /** Members with no engine. Named so the panel can say which. */
  grounded: RouterId[];
  /** How many members re-planned on this pass, rather than holding. */
  replanned: number;
}

/**
 * Plans every member against one observation, reusing each member's previous
 * plan where its invariants still hold.
 *
 * One observation for the whole unit, taken once — members do not each go and
 * look. That is the efficiency the squad exists to buy: a unit of four routers
 * costs one look at the world, not four.
 */
export function planSquad(
  squad: SquadSpec,
  engines: InferenceEngine[],
  observation: Observation,
  previous: Map<RouterId, PathPlan> = new Map(),
): SquadPlan {
  const members: MemberPlan[] = squad.members.map((routerId, index) => {
    const router = findRouter(routerId);
    const advanced = advancePlan(previous.get(routerId) ?? null, router, engines, observation);
    return {
      routerId,
      role: index === 0 ? "lead" : "support",
      plan: advanced.plan,
      replanned: advanced.replanned,
      reason: advanced.reason,
    };
  });

  const grounded = members.filter((m) => m.plan.engineId === null).map((m) => m.routerId);
  const withPath = members.filter((m) => m.plan.engineId !== null);
  const leadHasPath = members[0].plan.engineId !== null;

  const operational =
    squad.formation === "parallel-consensus" ? withPath.length >= 2 && leadHasPath : leadHasPath;

  return {
    squad,
    members,
    operational,
    grounded,
    replanned: members.filter((m) => m.replanned).length,
    status: operational
      ? grounded.length === 0
        ? `all ${members.length} members have a path`
        : `operational on ${withPath.length}/${members.length}; grounded: ${grounded.join(", ")}`
      : squad.formation === "parallel-consensus"
        ? `consensus needs two paths, has ${withPath.length}`
        : `lead ${members[0].routerId} has no path`,
  };
}

/**
 * Every squad planned against the same observation. One look, all units — and
 * one derivation per router, not one per router per unit.
 *
 * Plans made earlier in the pass are carried into the units planned after it,
 * so a router fielded twice (Recall sits in Recon and Workshop; Operator in
 * Recon, Armory and Workshop) derives its route once and the later units hold
 * it. Without the carry-forward each unit derived its own copy: equal at the
 * instant they were made, and free to drift the moment anything re-planned one
 * of them — which is the disagreement the shared plan exists to prevent.
 */
export function planAllSquads(
  engines: InferenceEngine[],
  observation: Observation,
  previous: Map<RouterId, PathPlan> = new Map(),
): SquadPlan[] {
  const working = new Map(previous);

  return SQUADS.map((squad) => {
    const plan = planSquad(squad, engines, observation, working);
    for (const member of plan.members) working.set(member.routerId, member.plan);
    return plan;
  });
}

/** Routers that belong to no squad. A router nothing fields is dead weight. */
export function unassignedRouters(): RouterId[] {
  const fielded = new Set(SQUADS.flatMap((s) => s.members));
  return CONTEXT_ROUTERS.filter((r) => !fielded.has(r.id)).map((r) => r.id);
}
