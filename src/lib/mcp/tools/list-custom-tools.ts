// Custom tools are the user's own recipes over the actions above. Each one is
// listed with a signature the model can call it by.
import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { listCustomTools } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "list_custom_tools",
  title: "List custom tools",
  description:
    "List the user's custom tools: named recipes of this server's actions, with their parameters. " +
    "Run one with run_custom_tool.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await listCustomTools(supabaseForUser(ctx), ctx.getUserId(), {}), "tools");
  },
});
