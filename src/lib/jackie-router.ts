/**
 * Which engine answers, and what happens when it cannot.
 *
 * The chat had one route and no recovery. `streamChat` went to the cloud
 * gateway, and when the gateway said no — no key, no credit, rate limited,
 * unreachable — the send ended in a toast and an empty bubble. Nothing tried
 * anything else, so a rig with its own engine running and a model loaded still
 * had a dead chat.
 *
 * This walks `jackie-engines`' chain instead. It starts at whichever engine is
 * chosen, and on any failure that another engine could plausibly answer it
 * moves down: Jacky → Bionic → Ollama → DeepSeek → Cloud. Only two things stop the walk:
 *
 *   - the user aborted, which is not a failure and must not be retried
 *     somewhere else, and
 *   - there is no signed-in session, which every engine would refuse
 *     identically, so trying four of them is four identical errors.
 *
 * A failover is reported through `onRoute` rather than swallowed. An answer
 * that quietly came from somewhere other than the engine named on screen is
 * how a chat ends up lying about what it is.
 *
 * Partial output is the one case that needs care. If an engine streamed some
 * tokens and then broke, the next engine starts a *fresh* answer — it never
 * saw the half one — so appending its text to what is on screen produced
 * "The capital of France is Paris is the capital of France." and saved that,
 * as one reply, to the database, the history and the memory extractor. So
 * before a failover that follows output, the router calls `onReset` and the
 * caller clears the half answer. A caller that cannot reset gets the break
 * reported as an error instead, with nothing spliced.
 *
 * On-device is a chain of its own (see `jackie-engines`): when Bonsai cannot
 * answer in this tab, the reason is reported and nothing else is asked.
 */
import { streamSse, type ChatMessage } from "@/lib/jackie-stream";
import { callEdgeFunction, describeEdgeFailure, describesUnreachable, NotSignedInError } from "@/lib/edgeFunction";
import { deviceModelOrDefault } from "@/lib/microai/deviceModels";
import { fetchDevicePersona, type DevicePersonaIssue } from "@/lib/microai/devicePersona";
import {
  chainFrom,
  findEngine,
  DEFAULT_ENGINE,
  type EngineDef,
  type EngineId,
} from "@/lib/jackie-engines";

export type { ChatMessage };

export interface RouteAttempt {
  engine: EngineId;
  model?: string;
  /** Why the previous engine gave up. Absent on the first attempt. */
  reason?: string;
  /** The engine that just failed, when this attempt is a failover. */
  from?: EngineId;
}

export interface RouteResult {
  engine: EngineId;
  model?: string;
  /** Engines that were tried and failed before this one answered. */
  fellBackFrom: EngineId[];
}

export interface RouteChatOptions {
  messages: ChatMessage[];
  /** Memory, tasks and file summaries, injected into the system prompt. */
  context?: string;
  /** Engine to try first. Defaults to Jacky. */
  engine?: EngineId;
  /** Model for that engine. Ignored by engines that pick their own. */
  model?: string;
  onDelta: (text: string) => void;
  /**
   * The engine that was answering broke after some output and the next engine
   * is about to start over. Discard what `onDelta` delivered so far. Without
   * this, a break after output ends the walk instead of being spliced.
   */
  onReset?: () => void;
  onDone: (result: RouteResult) => void;
  onError: (error: string) => void;
  /** Fired before each attempt, including the first. */
  onRoute?: (attempt: RouteAttempt) => void;
  /**
   * What an engine that runs here is doing before its first word — loading,
   * reading the persona — and null once text flows. On a CPU that is minutes,
   * and a blank bubble for minutes reads as a hang.
   */
  onStatus?: (note: string | null) => void;
  /** A persistent recovery panel can show a problem instead of losing it in a toast. */
  onIssue?: (issue: DevicePersonaIssue) => void;
  signal?: AbortSignal;
  /** Walk the rest of the chain on failure. Default true. */
  fallback?: boolean;
  /**
   * How Jacky's one-piece answer is paced onto the screen. Overridable so
   * tests do not wait on real timers.
   */
  pace?: (ms: number) => Promise<void>;
}

type Attempt =
  | { kind: "ok" }
  | { kind: "failed"; reason: string }
  /** Nothing else can help: no session, or the user stopped it. */
  | { kind: "stop"; reason?: string };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Failures that mean "ask someone else", and the one that does not.
 *
 * Every engine in the chain refuses an unauthenticated caller the same way, so
 * a missing session is the only error worth stopping on. Everything else — a
 * missing secret, a refused key, a rate limit, an unreachable host, an empty
 * answer — is a reason to try the next engine, because the next engine is a
 * different machine with different limits.
 */
function isTerminal(reason: string): boolean {
  return /signed out|not signed in|sign in and try again/i.test(reason);
}

/** Jacky answers in one piece. This puts it on screen as if it were typed. */
async function emit(
  text: string,
  onDelta: (t: string) => void,
  signal: AbortSignal | undefined,
  pace: (ms: number) => Promise<void>,
) {
  const size = 24;
  for (let i = 0; i < text.length; i += size) {
    if (signal?.aborted) return;
    onDelta(text.slice(i, i + size));
    await pace(8);
  }
}

interface JackyAnswer {
  response?: unknown;
  engine?: unknown;
  route?: unknown;
  model?: unknown;
  status?: unknown;
}

/**
 * Jacky's turn, through `jacky-proxy`.
 *
 * The proxy's allowlist forwards exactly five calls and `ask` is the one that
 * thinks; it takes a single prompt and answers whole. So the conversation is
 * flattened into that prompt here. The persona is not re-sent — Jacky is the
 * rig's own engine and already has one — but the injected context is, because
 * memory and tasks are the part Jacky has no other way to see.
 */
async function askJacky(
  args: RouteChatOptions,
  pace: (ms: number) => Promise<void>,
): Promise<Attempt> {
  const history = args.messages
    .map((m) => `${m.role === "user" ? "User" : "Jackie"}: ${m.content}`)
    .join("\n\n");
  const prompt = args.context
    ? `## Context Jackie is carrying\n\n${args.context}\n\n## Conversation\n\n${history}`
    : history;

  let resp: Response;
  try {
    resp = await callEdgeFunction(
      "jacky-proxy",
      { path: "ask", method: "POST", body: { prompt, task_type: "general" } },
      { signal: args.signal },
    );
  } catch (e) {
    if (args.signal?.aborted || (e as Error)?.name === "AbortError") {
      return { kind: "stop" };
    }
    const reason = describeEdgeFailure(e, "jacky-proxy");
    return e instanceof NotSignedInError
      ? { kind: "stop", reason }
      : { kind: "failed", reason };
  }

  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) {
    const detail =
      typeof body?.detail === "string"
        ? body.detail
        : typeof body?.error === "string"
        ? body.error
        : `HTTP ${resp.status}`;
    if (resp.status === 401) return { kind: "stop", reason: "You are signed out, so Jackie cannot answer. Sign in and try again." };
    return { kind: "failed", reason: `Jacky: ${detail}` };
  }

  // `jacky-proxy` wraps the engine's own JSON in `{ ok, status, data }`.
  const envelope = body as { ok?: boolean; error?: string; detail?: string; data?: JackyAnswer };
  if (envelope.error) return { kind: "failed", reason: `Jacky: ${envelope.detail || envelope.error}` };
  if (envelope.ok === false) return { kind: "failed", reason: "Jacky: the engine refused the request." };

  const answer = envelope.data ?? {};
  const text = typeof answer.response === "string" ? answer.response.trim() : "";
  if (!text) return { kind: "failed", reason: "Jacky answered with nothing." };

  await emit(text, args.onDelta, args.signal, pace);
  if (args.signal?.aborted) return { kind: "stop" };
  return { kind: "ok" };
}

/** Any engine whose function answers OpenAI-compatible SSE. */
async function streamEngine(
  args: RouteChatOptions,
  def: EngineDef,
  model: string | undefined,
): Promise<Attempt> {
  let outcome: Attempt = { kind: "failed", reason: "no answer" };
  let emitted = false;
  await streamSse({
    fn: def.fn,
    payload: {
      messages: args.messages,
      ...(model ? { model } : {}),
      ...(args.context ? { context: args.context } : {}),
    },
    onDelta: (text) => {
      emitted = true;
      args.onDelta(text);
    },
    onDone: () => {
      outcome = { kind: "ok" };
    },
    onError: (reason) => {
      outcome = isTerminal(reason)
        ? { kind: "stop", reason }
        : { kind: "failed", reason: `${def.short}: ${reason}` };
    },
    signal: args.signal,
  });
  // `streamSse` calls neither callback when the user stopped it.
  if (args.signal?.aborted) return { kind: "stop" };
  if (outcome.kind === "failed" && emitted) {
    if (!args.onReset) {
      return { kind: "stop", reason: `${outcome.reason} (the answer broke off partway through)` };
    }
    args.onReset();
  }
  return outcome;
}

/**
 * The on-device turn: Bonsai, or another downloaded model, in this tab,
 * answering as Jackie.
 *
 * Its system prompt comes from `jackie-device`, built by the same guard as
 * every other engine's — the persona never ships in the bundle — so the one
 * request that leaves the machine carries the memory context and nothing of
 * the conversation. Every failure is a `failed` with words to act on; there
 * is no next engine to try.
 */
async function askDevice(args: RouteChatOptions, modelId: string): Promise<Attempt> {
  const device = await import("@/lib/microai/bonsaiDevice");
  const status = await device.storedModel(modelId);
  if (!status.supported) return { kind: "failed", reason: device.UNSUPPORTED_BROWSER };
  if (!status.downloaded) return { kind: "failed", reason: status.error ?? device.notDownloaded(deviceModelOrDefault(modelId)) };

  args.onStatus?.("Fetching Jackie's persona…");
  const profile = await fetchDevicePersona({ context: args.context, signal: args.signal });
  if (!profile.ok) {
    args.onStatus?.(null);
    if (profile.stopped) return { kind: "stop" };
    args.onIssue?.(profile.issue);
    return {
      kind: profile.issue.code === "SIGNED_OUT" ? "stop" : "failed",
      reason: `${deviceModelOrDefault(modelId).name} is stored, but Jackie's persona could not be fetched. ${profile.issue.detail} ${profile.issue.recovery}`,
    };
  }

  const result = await device.chatOnDevice({
    modelId,
    system: profile.prompt,
    messages: args.messages,
    onDelta: args.onDelta,
    onStatus: args.onStatus,
    signal: args.signal,
  });
  if (args.signal?.aborted) return { kind: "stop" };
  return result.ok ? { kind: "ok" } : { kind: "failed", reason: result.error };
}

async function attempt(
  args: RouteChatOptions,
  id: EngineId,
  pace: (ms: number) => Promise<void>,
): Promise<{ result: Attempt; model?: string }> {
  const def = findEngine(id);
  if (!def) return { result: { kind: "failed", reason: `Unknown engine: ${id}` } };

  if (def.kind === "jacky") {
    return { result: await askJacky(args, pace) };
  }
  if (def.kind === "device") {
    // The model picked for this engine, or Bonsai; never another engine's id.
    const model = deviceModelOrDefault(id === args.engine ? args.model : undefined).id;
    return { result: await askDevice(args, model), model };
  }

  // The chosen model only belongs to the chosen engine. Every engine further
  // down the chain gets its own default, because handing Ollama a Gemini id is
  // a guaranteed second failure.
  const model = id === args.engine ? args.model ?? def.models[0]?.id : def.models[0]?.id;
  const usable = model === "bionic-default" ? undefined : model;
  return { result: await streamEngine(args, def, usable), model: usable };
}

export async function routeChat(args: RouteChatOptions): Promise<void> {
  const pace = args.pace ?? sleep;
  const preferred = findEngine(args.engine) ? (args.engine as EngineId) : DEFAULT_ENGINE;
  const chain = args.fallback === false ? [preferred] : chainFrom(preferred);

  const fellBackFrom: EngineId[] = [];
  const reasons: string[] = [];
  let lastReason = "";

  for (const id of chain) {
    if (args.signal?.aborted) return;

    args.onRoute?.({
      engine: id,
      ...(fellBackFrom.length
        ? { reason: lastReason, from: fellBackFrom[fellBackFrom.length - 1] }
        : {}),
    });

    const { result, model } = await attempt(args, id, pace);

    if (result.kind === "ok") {
      await args.onDone({ engine: id, model, fellBackFrom: [...fellBackFrom] });
      return;
    }
    if (result.kind === "stop") {
      // Aborts carry no reason and must stay silent — the caller already knows
      // it stopped the answer, and a toast for it reads like a fault.
      if (result.reason) args.onError(result.reason);
      return;
    }

    fellBackFrom.push(id);
    reasons.push(result.reason);
    lastReason = result.reason;
  }

  // When every rung refused for the *same* reason, the engines are not the
  // problem — the thing they share is. Listing them sends someone to check
  // four engines and a network when the answer is one gate, one secret or one
  // un-pushed migration, and the chain's own length is what disguises it: four
  // identical refusals look like four faults.
  //
  // The comparison drops a leading engine label because `askJacky` writes
  // "Jacky: …" while the streamed rungs return the server's words unprefixed.
  // Comparing raw strings would therefore never match on the one chain that
  // matters — the full one, starting at Jacky.
  const core = (r: string) => r.replace(/^[A-Za-z][\w-]*:\s*/, "").trim();
  const shared = reasons.length > 1 && reasons.every((r) => core(r) === core(reasons[0]));

  // Refused and unreachable are different diagnoses with opposite fixes. Each
  // rung calls a *different* function, so if none of them could even be
  // reached, the engines are not individually broken — no edge function on this
  // project answered at all, which means they are not deployed (or are
  // answering without CORS headers, which a browser reports the same way).
  // Listing four engine names for that sends someone to check four engines,
  // three secrets and their wifi, and the answer is one deploy.
  const allUnreachable = reasons.length > 1 && reasons.every((r) => describesUnreachable(core(r)));

  args.onError(
    allUnreachable
      ? `No engine could be reached — not one of ${fellBackFrom.length} edge functions answered. ` +
        `They are most likely not deployed to this project, or are answering without CORS headers. ` +
        `Deploy the functions, then try again. (Last: ${core(lastReason)})`
      : shared
        ? `Every engine refused for the same reason, so this is not the engines: ${core(reasons[0])}`
        : fellBackFrom.length > 1
          ? `Every engine refused (${fellBackFrom.join(" → ")}). Last: ${lastReason}`
          : lastReason || "Jackie could not reach any engine.",
  );
}
