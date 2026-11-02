/**
 * Specialised context routers.
 *
 * A micro model is small enough to run on the device and too small to know
 * everything, so the useful unit is not "a model" but "a model plus the slice
 * of local storage it is expert in". Each router below owns one such pairing:
 * a specialisation, the partitions it draws context from, and an ordered ladder
 * of engines to answer with.
 *
 * The ladder is ordered offline-first on purpose. On-device comes before the
 * machine on the LAN, which comes before anything across a network, and the
 * selector will return nothing at all rather than reach for a cloud engine
 * while offline. That is the whole inversion the system is built on: the
 * network is where updates come from, never where answers come from.
 */
import { PARTITIONS } from "@/lib/partitions/registry";
import type { PartitionId, RouterId } from "@/lib/partitions/types";
import { MICRO_MODELS, findModel, type MicroModel } from "./models";

/** Where an engine runs, which is what decides whether it can be used offline. */
export type EngineLocality = "device" | "lan" | "network";

export interface InferenceEngine {
  id: string;
  /** Human name for the panel. */
  name: string;
  locality: EngineLocality;
  /** Whether this engine can answer right now. Must not throw. */
  available(): Promise<boolean>;
  run(prompt: string, model?: string): Promise<{ text: string; model: string }>;
}

export interface ContextRouterSpec {
  id: RouterId;
  name: string;
  /** The one kind of question this router is for. */
  specialty: string;
  /** Partitions it reads for context, in the order it reads them. */
  reads: PartitionId[];
  /** Preferred micro model id, resolved against the micro registry. */
  modelId: string;
  /** Engine localities this router will accept, best first. */
  ladder: EngineLocality[];
  /** Words that route an intent here. */
  keywords: string[];
}

/**
 * Derived from the partition table: every partition names the router that reads
 * it, so a router's `reads` can never drift away from the partitions that
 * declared it. Adding a partition adds it to its router's context for free.
 */
function readsFor(id: RouterId): PartitionId[] {
  return PARTITIONS.filter((p) => p.router === id).map((p) => p.id);
}

export const CONTEXT_ROUTERS: ContextRouterSpec[] = [
  {
    id: "recall",
    name: "Recall",
    specialty: "What was said, decided or stored before — threads, notes, indexed context.",
    reads: readsFor("recall"),
    modelId: "granite-micro",
    ladder: ["device", "lan", "network"],
    keywords: ["remember", "recall", "search", "history", "conversation", "note", "when did"],
  },
  {
    id: "keeper",
    name: "Keeper",
    specialty: "Identity, keys and vault records. Never leaves the device.",
    reads: readsFor("keeper"),
    modelId: "axl-micro-8m",
    // No network rung, at any budget: vault context is not sent anywhere.
    ladder: ["device"],
    keywords: ["key", "secret", "vault", "identity", "credential", "token", "backup"],
  },
  {
    id: "operator",
    name: "Operator",
    specialty: "Running models and reading the machine — what is loaded, what fits, what is hot.",
    reads: readsFor("operator"),
    modelId: "microllm2-i1",
    ladder: ["device", "lan"],
    keywords: ["model", "load", "gpu", "memory", "thermal", "download", "run", "engine"],
  },
  {
    id: "maker",
    name: "Maker",
    specialty: "Building things — pods, images, audio, the surfaces they live on.",
    reads: readsFor("maker"),
    modelId: "microatlas-v1",
    ladder: ["device", "lan", "network"],
    keywords: ["build", "make", "pod", "image", "generate", "render", "design", "surface"],
  },
];

export function findRouter(id: RouterId): ContextRouterSpec {
  const router = CONTEXT_ROUTERS.find((r) => r.id === id);
  if (!router) throw new Error(`unknown context router: ${id}`);
  return router;
}

export function routerModel(id: RouterId): MicroModel {
  return findModel(findRouter(id).modelId);
}

/**
 * Picks the router for a request by keyword weight, falling back to Recall —
 * the router that reads the widest context and is therefore the safest default
 * for a question nobody classified.
 */
export function routeIntent(intent: string): ContextRouterSpec {
  const words = intent.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let best = CONTEXT_ROUTERS.find((r) => r.id === "recall") ?? CONTEXT_ROUTERS[0];
  let bestScore = 0;

  for (const router of CONTEXT_ROUTERS) {
    const score = router.keywords.reduce(
      (sum, keyword) => sum + (words.includes(keyword) ? 2 : intent.toLowerCase().includes(keyword) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      best = router;
      bestScore = score;
    }
  }
  return best;
}

export interface EngineChoice {
  engine: InferenceEngine | null;
  /** Why this engine, or why none — shown in the panel and written to the log. */
  reason: string;
}

/**
 * Chooses the engine for a router from those available.
 *
 * Pure over its inputs: it is handed the availability it should believe rather
 * than probing for it, so the case that matters — offline, with a cloud engine
 * sitting right there, available and ready — can be pinned in a test instead of
 * waited for on a train.
 */
export function selectEngine(
  // Only the name and the ladder are consulted, so anything that declares a
  // ladder can be routed — the Guide reads the app's own manifest rather than a
  // partition, and still has to obey the same offline-first order.
  router: { name: string; ladder: EngineLocality[] },
  engines: InferenceEngine[],
  ready: ReadonlySet<string>,
  online: boolean,
): EngineChoice {
  for (const locality of router.ladder) {
    if (locality === "network" && !online) continue;
    const engine = engines.find((e) => e.locality === locality && ready.has(e.id));
    if (engine) {
      return { engine, reason: `${router.name} → ${engine.name} (${locality})` };
    }
  }

  const blocked = router.ladder.filter((l) => l !== "network" || online);
  return {
    engine: null,
    reason: blocked.length
      ? `${router.name} has no engine ready at ${blocked.join(" or ")}`
      : `${router.name} is device-and-LAN only and nothing local is ready`,
  };
}

export const MICRO_MODEL_IDS = MICRO_MODELS.map((m) => m.id);
