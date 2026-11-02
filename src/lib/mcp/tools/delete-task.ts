// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { deleteTask } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "delete_task",
  title: "Delete task",
  description: "Permanently delete one of the signed-in user's tasks. Prefer update_task with status done to finish a task.",
  inputSchema: { id: z.string().trim().min(1).describe("Task id (uuid).") },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await deleteTask(supabaseForUser(ctx), ctx.getUserId(), args), "result");
  },
});
