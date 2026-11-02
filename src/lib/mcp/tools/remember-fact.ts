// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { rememberFact, MEMORY_CATEGORIES } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "remember_fact",
  title: "Remember a fact",
  description: "Store or overwrite a fact in the signed-in user's Jackie long-term memory. Jackie sees it in every chat.",
  inputSchema: {
    key: z.string().trim().min(1).describe("Stable identifier for the fact."),
    value: z.string().trim().min(1).describe("The fact to remember."),
    category: z.enum(MEMORY_CATEGORIES).optional().describe("Category (default context)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await rememberFact(supabaseForUser(ctx), ctx.getUserId(), args), "entry");
  },
});
