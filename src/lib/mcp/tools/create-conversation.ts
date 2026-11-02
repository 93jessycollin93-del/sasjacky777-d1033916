// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { createConversation } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "create_conversation",
  title: "Create conversation",
  description: "Start a new conversation in the app's chat sidebar. Use its id with ask_jackie.",
  inputSchema: { title: z.string().optional().describe("Conversation title (default 'Agent session').") },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await createConversation(supabaseForUser(ctx), ctx.getUserId(), args), "conversation");
  },
});
