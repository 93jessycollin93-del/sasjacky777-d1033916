/**
 * Which engine answers the Repair Consultant.
 *
 * The consultant has only ever asked the Lovable gateway, which is a general
 * model that knows nothing about this rig beyond what the prompt carries. The
 * operator's own Gemini Enterprise engine indexes their own material and
 * answers with citations into it, which for "is this firmware update worth
 * taking on my board" is a different kind of answer entirely — one that can be
 * checked against a source rather than taken on trust.
 *
 * The choice is persisted. Someone who connected their own engine did not do
 * that in order to be put back on the gateway by a page reload.
 */
export type ConsultEngineId = "gemini" | "gateway";

export interface ConsultEngine {
  id: ConsultEngineId;
  label: string;
  short: string;
  /** What it means for the answer, in the terms the person is choosing between. */
  description: string;
  /** Whether answers can carry sources. Drives whether the citation panel shows. */
  cites: boolean;
}

export const CONSULT_ENGINES: readonly ConsultEngine[] = [
  {
    id: "gemini",
    label: "My Gemini Enterprise engine",
    short: "My engine",
    description: "Grounded in the material you indexed, and cites it. Needs the connector linked.",
    cites: true,
  },
  {
    id: "gateway",
    label: "Lovable AI gateway",
    short: "Gateway",
    description: "A general model. Knows only what this page puts in the prompt, and cites nothing.",
    cites: false,
  },
];

export const DEFAULT_CONSULT_ENGINE: ConsultEngineId = "gemini";

const KEY = "jacky.repair.consultEngine.v1";

export function findConsultEngine(id: string): ConsultEngine {
  return CONSULT_ENGINES.find((e) => e.id === id) ?? CONSULT_ENGINES[0];
}

export function readConsultEngine(): ConsultEngineId {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw && CONSULT_ENGINES.some((e) => e.id === raw)) return raw as ConsultEngineId;
  } catch {
    /* private window, blocked storage — the default is a fine answer */
  }
  return DEFAULT_CONSULT_ENGINE;
}

export function writeConsultEngine(id: ConsultEngineId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* the choice still applies to this session; it just will not outlive it */
  }
}
