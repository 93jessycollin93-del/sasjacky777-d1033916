// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { updateTask, TASK_STATUSES } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

// Kept for clients already calling it; `update_task` changes more than status.
export default defineTool({
  name: "update_task_status",
  title: "Update task status",
  description: "Change the status of one of the signed-in user's Jackie tasks.",
  inputSchema: {
    id: z.string().trim().min(1).describe("Task id (uuid)."),
    status: z.enum(TASK_STATUSES).describe("New status."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, status }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await updateTask(supabaseForUser(ctx), ctx.getUserId(), { id, status }), "task");
  },
});
