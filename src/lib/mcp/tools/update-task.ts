// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { updateTask, TASK_PRIORITIES, TASK_STATUSES } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "update_task",
  title: "Update task",
  description: "Change any of a task's status, priority, title, description or due date. Give only the fields to change.",
  inputSchema: {
    id: z.string().trim().min(1).describe("Task id (uuid)."),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    due_date: z.string().optional().describe("ISO 8601 date, or empty string to clear it."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await updateTask(supabaseForUser(ctx), ctx.getUserId(), args), "task");
  },
});
