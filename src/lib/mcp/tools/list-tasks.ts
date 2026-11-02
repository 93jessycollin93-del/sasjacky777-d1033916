// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { listTasks, TASK_STATUSES } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "list_tasks",
  title: "List tasks",
  description: "List the signed-in user's Jackie tasks, newest first. Optionally filter by status.",
  inputSchema: {
    status: z.enum(TASK_STATUSES).optional().describe("Filter by task status."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await listTasks(supabaseForUser(ctx), ctx.getUserId(), args), "tasks");
  },
});
