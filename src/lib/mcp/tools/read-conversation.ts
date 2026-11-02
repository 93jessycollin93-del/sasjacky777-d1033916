// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { readConversation } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "read_conversation",
  title: "Read conversation",
  description: "Read the most recent messages of one conversation, oldest first.",
  inputSchema: {
    id: z.string().trim().min(1).describe("Conversation id (uuid), from list_conversations."),
    limit: z.number().int().min(1).max(200).optional().describe("How many recent messages (default 40)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await readConversation(supabaseForUser(ctx), ctx.getUserId(), args), "messages");
  },
});
