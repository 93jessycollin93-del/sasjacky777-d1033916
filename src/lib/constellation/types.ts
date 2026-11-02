/**
 * The constellation contract.
 *
 * Jackie is not one app — it is a set of repos that each own one job: a Python
 * engine that decides where work runs, a desktop shell that hosts tools, a
 * vault that holds what must not be lost, model runtimes that do inference on
 * hardware the browser cannot see. Each of those was reachable only by knowing
 * it existed. Nothing named them as one system, so nothing could tell you what
 * was actually running.
 *
 * A `Station` is one such job, declared once. A `StationProbe` answers the only
 * question a caller ever asks about it: is it there right now. Callers depend
 * on `StationProbe` and read `StationStatus` — they never learn whether a
 * station is an in-app route, a build shipped under /public, an HTTP engine, or
 * source that has to be run on a machine. That difference is a property of the
 * probe, normalised here, so adding a new kind of station adds a probe and
 * changes no caller.
 */

/** Stages of the single flow, in the order they are walked. */
export const FLOW_STAGES = ["ignition", "core", "workstation", "field"] as const;

export type FlowStage = (typeof FLOW_STAGES)[number];

/**
 * What a probe found.
 *
 * `live` — answered a check just now.
 * `declared` — real and named, but its liveness cannot be observed from here
 *   (source that runs on a phone or a rig). Honest by construction: never
 *   reported as `live` on the strength of existing.
 * `absent` — checked, did not answer.
 * `unknown` — not checked yet.
 */
export type StationState = "live" | "declared" | "absent" | "unknown";

export interface StationProbeResult {
  state: StationState;
  /** One line a person can act on: what answered, or why nothing did. */
  detail: string;
}

/**
 * The one question the system asks a station. Every station answers it the same
 * way, whatever it is made of.
 */
export interface StationProbe {
  /** How this station is checked, in words, for the panel and the logs. */
  readonly method: string;
  check(signal?: AbortSignal): Promise<StationProbeResult>;
}

export interface StationStatus extends StationProbeResult {
  id: StationId;
  /** Epoch ms of the check that produced this. 0 when never checked. */
  checkedAt: number;
}

export type StationId =
  | "jackie-shell"
  | "guide"
  | "partitions"
  | "self-host"
  | "offline-shell"
  | "jacky-engine"
  | "jacky-console"
  | "core-keeper"
  | "vault"
  | "workstation-pc"
  | "bot-foundry"
  | "router-mesh"
  | "pod-station"
  | "ollama"
  | "lm-studio"
  | "off-grid-mobile"
  | "llmfarm"
  | "mobile-llm"
  | "mobilerun"
  | "llama-cpp"
  | "xagent";

/**
 * What losing the network costs this station.
 *
 * `full` — works entirely offline; the network adds nothing it needs.
 * `sync` — works offline on what it already holds, and uses the network only to
 *   fetch more or push backups.
 * `online-only` — cannot answer without a network. Kept to a minimum by design,
 *   and never something the flow depends on to advance.
 */
export type OfflineCapability = "full" | "sync" | "online-only";

export interface Station {
  id: StationId;
  /** What it is called, as its own repo calls it. */
  name: string;
  /** `owner/repo` this station's source lives in. */
  repo: string;
  /** One sentence: the job it owns and nothing else. */
  purpose: string;
  /** Stage of the flow this station belongs to. */
  stage: FlowStage;
  /**
   * Where it is entered from here. An in-app path, or an absolute URL for
   * source that is entered on GitHub because it does not run in a browser.
   */
  href: string;
  /** True when `href` leaves the app. */
  external?: boolean;
  /** Declared, not inferred: what this station can still do with the radio off. */
  offline: OfflineCapability;
  /**
   * The flow does not advance past this station's stage while it is absent.
   * Only true where the station genuinely gates the next step.
   */
  required?: boolean;
  probe: StationProbe;
}
