// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { createTask, TASK_PRIORITIES, TASK_STATUSES } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "create_task",
  title: "Create task",
  description: "Create a new Jackie task for the signed-in user. It appears on the app's task board.",
  inputSchema: {
    title: z.string().trim().min(1).describe("Short task title."),
    description: z.string().optional().describe("Optional longer detail."),
    status: z.enum(TASK_STATUSES).optional().describe("Column to start in (default todo)."),
    priority: z.enum(TASK_PRIORITIES).optional().describe("Priority (default medium)."),
    category: z.string().optional().describe("Optional grouping category."),
    due_date: z.string().optional().describe("Optional ISO 8601 due date."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await createTask(supabaseForUser(ctx), ctx.getUserId(), args), "task");
  },
});
