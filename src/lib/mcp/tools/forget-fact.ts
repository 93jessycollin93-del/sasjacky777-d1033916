// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { forgetFact } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "forget_fact",
  title: "Forget a fact",
  description: "Delete one of Jackie's memory entries, by id or by key.",
  inputSchema: {
    id: z.string().trim().optional().describe("Memory entry id (uuid)."),
    key: z.string().trim().optional().describe("Memory key, when the id is not known."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await forgetFact(supabaseForUser(ctx), ctx.getUserId(), args), "result");
  },
});
