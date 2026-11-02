/**
 * Permanent app guidance.
 *
 * One question — "how do I…", "where is…" — answered from the app's own map,
 * on every route, with or without a model and with or without a network.
 *
 * The order matters and is the whole design. The routes come first, from the
 * manifest, deterministically: that part cannot be wrong and cannot be absent,
 * so guidance never has nothing to say. The model comes second and only writes
 * the sentence around those routes. If Bonsai is not installed, the answer is
 * shorter, not missing — which is what makes this "permanent" rather than "a
 * feature that works once the weights are in place".
 */
import { selectEngine, type EngineLocality, type InferenceEngine } from "@/lib/microai/contextRouter";
import { GUIDANCE_MODEL } from "@/lib/microai/models";
import type { RouteEntry } from "@/lib/routeManifest";
import { findRoutes, mapForPrompt, unservedPaths, type RouteMatch } from "./appMap";

/** Guidance runs on the device first, the machine on the LAN second, and never off it. */
export const GUIDE_LADDER: EngineLocality[] = ["device", "lan"];

export interface GuideAnswer {
  /** Prose for the person. Never empty. */
  text: string;
  /** Real routes, in the order they are worth trying. */
  routes: RouteEntry[];
  /** True when a model wrote the prose; false when it is the deterministic answer. */
  fromModel: boolean;
  /** Which engine answered, or why none did. */
  reason: string;
  /** The model that actually answered, as the runtime named it. Null when none did. */
  model: string | null;
  /** Paths the model named that the app does not serve. Dropped, and reported. */
  dropped: string[];
}

export const GUIDE_SYSTEM_PROMPT = [
  "You are the Guide inside Jackie, an offline-first app.",
  "Answer in at most three sentences, in plain language, about how to use this app.",
  "You may only name paths from the ROUTES list you are given. Never invent a path.",
  "If the routes do not cover the question, say so plainly instead of guessing.",
].join(" ");

function deterministicText(question: string, matches: RouteMatch[]): string {
  if (!matches.length) {
    return "Nothing in the app map matches that. Try naming the thing you want — a vault, a model, a bot, a pod — or open the Workstation, which lists every station in one flow.";
  }
  const [first, ...rest] = matches;
  const lead = `${first.route.label} — ${first.route.path}`;
  if (!rest.length) return `Closest match in the app: ${lead}.`;
  return `Closest match in the app: ${lead}. Also relevant: ${rest.map((m) => m.route.path).join(", ")}.`;
}

export interface GuideDeps {
  engines: InferenceEngine[];
  /** Engine ids ready right now. */
  ready: ReadonlySet<string>;
}

/**
 * Answers one guidance question.
 *
 * `selectEngine` is reused rather than reimplemented, so guidance obeys the
 * same offline-first ladder as every other router: on-device before the LAN,
 * and off the network entirely. It is handed availability instead of probing
 * for it, which keeps the decision a pure function of its inputs.
 */
export async function askGuide(question: string, deps: GuideDeps): Promise<GuideAnswer> {
  const matches = findRoutes(question);
  const routes = matches.map((m) => m.route);
  const fallback = deterministicText(question, matches);

  const { engine, reason } = selectEngine(
    { name: "Guide", ladder: GUIDE_LADDER },
    deps.engines,
    deps.ready,
    // Guidance never takes the network rung, so its answer cannot change with
    // connectivity. Passing false keeps that true even if a network engine is
    // added to the list later.
    false,
  );

  if (!engine) {
    return { text: fallback, routes, fromModel: false, reason, model: null, dropped: [] };
  }

  const prompt = [
    GUIDE_SYSTEM_PROMPT,
    routes.length ? `ROUTES:\n${mapForPrompt(matches)}` : "ROUTES: none matched.",
    `QUESTION: ${question}`,
  ].join("\n\n");

  try {
    // The preferred model is a request, not a requirement: LM Studio answers
    // with whatever the operator has loaded, and reports which. Guidance names
    // the model that actually spoke rather than the one it asked for.
    const { text, model } = await engine.run(prompt, GUIDANCE_MODEL.id);
    const clean = text.trim();
    if (!clean) {
      return { text: fallback, routes, fromModel: false, reason: `${reason} — empty answer`, model: null, dropped: [] };
    }

    const dropped = unservedPaths(clean);
    if (dropped.length) {
      // The prose named somewhere that does not exist. The routes below it are
      // still right, so the person keeps a working answer and loses only the
      // sentence that was wrong.
      return {
        text: fallback,
        routes,
        fromModel: false,
        reason: `${reason} — answer named ${dropped.join(", ")}, which the app does not serve`,
        model,
        dropped,
      };
    }
    return { text: clean, routes, fromModel: true, reason, model, dropped: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { text: fallback, routes, fromModel: false, reason: `${reason} — ${message}`, model: null, dropped: [] };
  }
}
