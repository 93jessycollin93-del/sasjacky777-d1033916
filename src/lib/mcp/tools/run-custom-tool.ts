// Runs one of the user's custom tools. Each step goes through the same action
// a harness could call directly, under the same row-level security, so a
// custom tool can never do more than the agent running it could already do.
// A harness can delete with delete_task anyway, so deleting steps are allowed
// here; the in-app operators keep their own Allow deletes switch.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { functionCaller, supabaseForUser } from "../supabase";
import { runCustomTool } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "run_custom_tool",
  title: "Run a custom tool",
  description:
    "Run one of the user's custom tools by name with its arguments. Steps run in order and stop at the first " +
    "failure; the error says which steps already ran.",
  inputSchema: {
    name: z.string().trim().min(1).describe("The tool's name, from list_custom_tools."),
    args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
      .describe("The tool's parameters, by name."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated() || !ctx.getToken()) return notAuthenticated;
    return toToolResult(
      await runCustomTool(supabaseForUser(ctx), ctx.getUserId(), args, {
        via: "mcp",
        allowDestructive: true,
        callFunction: functionCaller(ctx),
      }),
      "run",
    );
  },
});
