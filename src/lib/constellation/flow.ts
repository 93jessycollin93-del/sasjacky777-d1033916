/**
 * The flow.
 *
 * Four stages, walked in order, each gated by the stations that genuinely have
 * to be up before the next one means anything: you cannot work in a workstation
 * whose desktop build was never shipped, and you cannot trust a vault on a
 * device that will not grant it room. `resolveFlow` turns a set of station
 * statuses into the state of that walk and the single next thing to do.
 *
 * It is pure. No fetch, no clock, no storage — statuses in, flow out. That is
 * what makes the case worth guarding testable: the one where a station is
 * checked, comes back absent, and the flow has to refuse to advance. A resolver
 * that went and looked for itself could only be tested by arranging the world.
 */
import type { FlowStage, Station, StationId, StationStatus } from "./types";
import { FLOW_STAGES } from "./types";

export type StageState = "ready" | "blocked" | "pending";

export interface StageView {
  stage: FlowStage;
  title: string;
  /** What this stage is for, in one line. */
  intent: string;
  state: StageState;
  stations: Array<{ station: Station; status: StationStatus }>;
  /** Required stations in this stage that are not live. */
  blockers: StationId[];
}

export interface FlowAction {
  label: string;
  href: string;
  external?: boolean;
  /** Why this is the next step. */
  why: string;
}

export interface FlowState {
  stages: StageView[];
  /** The stage being worked on: the first that is not ready, else the last. */
  current: FlowStage;
  /** True when every stage is ready. */
  complete: boolean;
  /** Stations that are live right now, of those that can be. */
  liveCount: number;
  checkableCount: number;
  /** The one next step. Never null: a finished flow still has somewhere to go. */
  next: FlowAction;
}

const STAGE_TITLE: Record<FlowStage, string> = {
  ignition: "Ignition",
  core: "Core",
  workstation: "Workstation",
  field: "Field",
};

const STAGE_INTENT: Record<FlowStage, string> = {
  ignition: "The shell is up and the device has granted room to hold the system offline.",
  core: "Identity, vault and the engine that decides where work runs.",
  workstation: "The desk itself: the PC, the foundry, the mesh and the pods.",
  field: "Everything that runs away from this screen — hosts, phones, agents.",
};

const UNKNOWN = (id: StationId): StationStatus => ({
  id,
  state: "unknown",
  detail: "not checked yet",
  checkedAt: 0,
});

/** A required station holds its stage until it answers a check. */
function isBlocking(station: Station, status: StationStatus): boolean {
  return station.required === true && status.state !== "live";
}

export function resolveFlow(
  stations: Station[],
  statuses: Map<StationId, StationStatus>,
): FlowState {
  const stages: StageView[] = FLOW_STAGES.map((stage) => {
    const members = stations
      .filter((s) => s.stage === stage)
      .map((station) => ({ station, status: statuses.get(station.id) ?? UNKNOWN(station.id) }));

    const blockers = members.filter((m) => isBlocking(m.station, m.status)).map((m) => m.station.id);
    const anyChecked = members.some((m) => m.status.state !== "unknown");

    return {
      stage,
      title: STAGE_TITLE[stage],
      intent: STAGE_INTENT[stage],
      state: blockers.length > 0 ? "blocked" : anyChecked ? "ready" : "pending",
      stations: members,
      blockers,
    };
  });

  const firstUnready = stages.find((s) => s.state !== "ready");
  const current = firstUnready?.stage ?? FLOW_STAGES[FLOW_STAGES.length - 1];
  const complete = !firstUnready;

  const checkable = stations.filter((s) => s.probe.method !== "declared");
  const liveCount = checkable.filter(
    (s) => (statuses.get(s.id) ?? UNKNOWN(s.id)).state === "live",
  ).length;

  return {
    stages,
    current,
    complete,
    liveCount,
    checkableCount: checkable.length,
    next: nextAction(stages, stations, statuses, complete),
  };
}

/**
 * The statuses behind a resolved flow, as a lookup.
 *
 * Anything deriving from the whole sweep — which crew tools would start, what
 * the environment can claim — reads it from here rather than from the service,
 * so it is looking at exactly the sweep the stages are rendering. Two sources
 * for the same answer is how a panel ends up saying a tool is ready while the
 * station it needs shows absent.
 */
export function statusesOf(flow: FlowState): Map<StationId, StationStatus> {
  return new Map(
    flow.stages.flatMap((stage) =>
      stage.stations.map(({ station, status }) => [station.id, status] as const),
    ),
  );
}

/**
 * One step, chosen in the order a person would actually take them: clear the
 * earliest blocker, or — with nothing blocked — walk into the workstation.
 */
function nextAction(
  stages: StageView[],
  stations: Station[],
  statuses: Map<StationId, StationStatus>,
  complete: boolean,
): FlowAction {
  const blockedStage = stages.find((s) => s.state === "blocked");
  if (blockedStage) {
    const id = blockedStage.blockers[0];
    const station = stations.find((s) => s.id === id);
    const status = statuses.get(id);
    return {
      label: `Fix ${station?.name ?? id}`,
      href: station?.href ?? "/workstation",
      external: station?.external,
      why: `${blockedStage.title} is held: ${status?.detail ?? "not checked yet"}`,
    };
  }

  const pending = stages.find((s) => s.state === "pending");
  if (pending) {
    return {
      label: "Check the constellation",
      href: "/workstation",
      why: `${pending.title} has not been checked yet`,
    };
  }

  const desk = stations.find((s) => s.id === "workstation-pc");
  return {
    label: complete && desk ? `Open ${desk.name}` : "Open the Workstation",
    href: desk?.href ?? "/workstation",
    why: complete
      ? "Every required station answered. The desk is the place to work."
      : "Nothing is blocking the walk.",
  };
}
