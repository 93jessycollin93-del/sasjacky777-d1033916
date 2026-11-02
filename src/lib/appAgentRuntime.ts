/**
 * The browser's wiring for `runAppAgent`: which model answers, and who acts.
 *
 * Kept apart from the loop so the loop stays pure and testable. The model is
 * either a provider behind the edge functions (DeepSeek's API, OpenRouter,
 * Ollama or LM Studio through Bionic, …) or a server on this very computer,
 * reached directly. Actions run through `appActions.ts` with the signed-in
 * user's own Supabase session — the same functions and rules the MCP server
 * uses for Hermes Agent and DeepSeek Harness.
 */
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/lib/edgeFunction";
import { streamProviderChat } from "./jackie-provider-stream";
import type { ProviderId } from "./jackie-providers";
import { localChat, type LocalRuntime } from "./localModels";
import * as actions from "./appActions";
import type { ActionResult } from "./appActions";
import type { ModelTurn } from "./appAgent";

export interface AgentModelSpec {
  provider: ProviderId;
  model: string;
  /** Set to run on a server on this computer instead of through the provider. */
  local?: LocalRuntime;
  fallback?: boolean;
}

/** One model call that resolves to the whole reply, or to why there is none. */
export function modelCaller(spec: AgentModelSpec, signal?: AbortSignal) {
  return async (messages: ModelTurn[], system: string): Promise<ActionResult<string>> => {
    if (spec.local) return localChat(spec.local, spec.model, messages, system, { signal });
    return new Promise((resolve) => {
      let text = "";
      void streamProviderChat({
        provider: spec.provider,
        model: spec.model,
        messages,
        system,
        fallback: spec.fallback ?? false,
        onDelta: (t) => {
          text += t;
        },
        onDone: () => resolve({ ok: true, data: text }),
        onError: (e) => resolve({ ok: false, error: e }),
      });
    });
  };
}

type Executor = (
  sb: typeof supabase,
  userId: string,
  args: Record<string, unknown>,
  ctx: actions.ActionContext,
) => Promise<ActionResult>;

const EXECUTORS: Record<string, Executor> = {
  list_tasks: actions.listTasks,
  create_task: actions.createTask,
  update_task: actions.updateTask,
  delete_task: actions.deleteTask,
  search_memory: actions.searchMemory,
  remember_fact: actions.rememberFact,
  forget_fact: actions.forgetFact,
  list_conversations: actions.listConversations,
  read_conversation: actions.readConversation,
  create_conversation: actions.createConversation,
  ask_jackie: actions.askJackie,
  list_skills: actions.listSkills,
  get_skill: actions.getSkill,
  propose_skill: actions.proposeSkill,
  list_custom_tools: actions.listCustomTools,
  run_custom_tool: actions.runCustomTool,
  propose_tool: actions.proposeTool,
  list_connections: actions.listConnections,
  call_connection: actions.callConnection,
  propose_connection: actions.proposeConnection,
};

/** Runs one action as whoever is signed in. Refuses rather than acting anonymously. */
export async function executeAsUser(
  tool: string,
  args: Record<string, unknown>,
  ctx: { allowDestructive?: boolean; expectedUserId?: string } = {},
): Promise<ActionResult> {
  const run = EXECUTORS[tool];
  if (!run) return { ok: false, error: `There is no action called "${tool}".` };
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return { ok: false, error: "You are signed out, so the agent cannot act on your app. Sign in and run it again." };
  if (ctx.expectedUserId && userId !== ctx.expectedUserId) {
    return { ok: false, error: "The signed-in account changed. Start a new run before allowing app actions." };
  }
  // An in-app operator's own Allow deletes reaches its custom tools too: a tool
  // with a deleting step is refused when deletes were not allowed.
  return run(supabase, userId, args, {
    via: "agent-lab",
    allowDestructive: ctx.allowDestructive ?? false,
    // Rule 4: the browser reaches functions through edgeFunction.ts only.
    callFunction: (fn, body) => callEdgeFunction(fn, body),
  });
}
