// Like propose_skill: an agent may write down a recipe it keeps repeating, and
// the user decides whether it becomes a tool.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { proposeTool } from "../../appActions";
import { CUSTOM_TOOL_ACTIONS, LIMITS, PARAM_TYPES } from "../../customTools";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "propose_tool",
  title: "Propose a custom tool",
  description:
    "Propose a custom tool: a named recipe of up to 8 steps, each one of this server's actions. Step args may use " +
    "{{param}} for the tool's parameters and {{steps.N.field}} for an earlier step's result (N counts from 0). " +
    "It is saved switched off until the user approves it in the app.",
  inputSchema: {
    name: z.string().trim().describe("lowercase_with_underscores, 2–48 characters; not a built-in action's name."),
    description: z.string().trim().min(1).max(LIMITS.description).describe("What it does — one line."),
    params: z.array(z.object({
      name: z.string(),
      type: z.enum(PARAM_TYPES),
      description: z.string().max(LIMITS.paramDescription).optional(),
      required: z.boolean().optional(),
    })).max(LIMITS.params).optional().describe("Its parameters."),
    steps: z.array(z.object({
      action: z.enum(CUSTOM_TOOL_ACTIONS),
      args: z.record(z.string(), z.unknown()).optional(),
    })).min(1).max(LIMITS.steps).describe("The actions to run, in order."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await proposeTool(supabaseForUser(ctx), ctx.getUserId(), args, { via: "mcp" }), "proposal");
  },
});
