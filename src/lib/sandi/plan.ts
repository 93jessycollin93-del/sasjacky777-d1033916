/**
 * SANDi — the index router on the nav bar.
 *
 * One box, three ways an utterance can go, tried cheapest first:
 *
 * 1. **Go.** "Open Tasks" is a command. It is matched against the route
 *    manifest and the commands crafted indexes declare, and it moves the app at
 *    once — no model, no network, no wait. This is the part that has to feel
 *    instant, so it is a string comparison over a list already in memory.
 * 2. **Crafted index.** A question one of your own indexes (made in the Forge)
 *    claims by keyword goes to it, on the engine ladder it declares.
 * 3. **Specialist.** Anything else goes to one of the four built-in micro
 *    routers — Recall, Keeper, Operator, Maker — each a small model paired with
 *    the slice of local storage it is expert in. The Index Pill this replaces
 *    stopped at step 2 and answered "no index crafted yet"; the specialists
 *    were already built and tested, and were only ever counted.
 *
 * The "extra weights" are the ladder each specialist climbs: the weights on this
 * device first, then a bigger model on a runner on the LAN, then the network —
 * each rung only if the specialist allows it. Keeper allows the device alone,
 * because vault context does not leave the machine.
 *
 * Pure: availability is handed in, so the rules are unit tests.
 */
import { resolveUtterance } from "@/lib/forge/commands";
import type { CraftedIndex } from "@/lib/forge/types";
import {
  routeIntent,
  type ContextRouterSpec,
  type EngineLocality,
  type InferenceEngine,
} from "@/lib/microai/contextRouter";

export type SandiPlan =
  | { kind: "go"; path: string; label: string }
  | { kind: "crafted"; index: CraftedIndex; text: string }
  | {
      kind: "specialist";
      router: ContextRouterSpec;
      text: string;
      /** False when no specialist's keywords matched and Recall took it as the default. */
      claimed: boolean;
    };

export function planSandi(raw: string, indexes: CraftedIndex[]): SandiPlan | null {
  const resolution = resolveUtterance(raw, indexes);
  if (!resolution) return null;
  if (resolution.kind === "command") {
    return { kind: "go", path: resolution.path, label: resolution.label };
  }
  if (resolution.index) {
    return { kind: "crafted", index: resolution.index, text: resolution.text };
  }
  const router = routeIntent(resolution.text);
  const lower = resolution.text.toLowerCase();
  return {
    kind: "specialist",
    router,
    text: resolution.text,
    claimed: router.keywords.some((keyword) => lower.includes(keyword)),
  };
}

export type RungState = "ready" | "down" | "offline" | "none";

export interface Rung {
  locality: EngineLocality;
  label: string;
  state: RungState;
  /** The engines at this rung, by name, for the tooltip. */
  engines: string[];
}

const RUNG_LABEL: Record<EngineLocality, string> = {
  device: "device weights",
  lan: "LAN runner",
  network: "network",
};

/**
 * The ladder a question will climb, rung by rung, as it stands right now.
 *
 * `none` is kept apart from `down`: a rung with no engine configured is not
 * the same news as one whose engine is configured and not answering, and the
 * person can only act on the second.
 */
export function describeLadder(
  ladder: readonly EngineLocality[],
  engines: readonly InferenceEngine[],
  ready: ReadonlySet<string>,
  online: boolean,
): Rung[] {
  return ladder.map((locality) => {
    const here = engines.filter((e) => e.locality === locality);
    let state: RungState;
    if (here.length === 0) state = "none";
    else if (locality === "network" && !online) state = "offline";
    else state = here.some((e) => ready.has(e.id)) ? "ready" : "down";
    return { locality, label: RUNG_LABEL[locality], state, engines: here.map((e) => e.name) };
  });
}
