// The person's approved connections to outside services, with every
// operation's signature. Never a secret; see docs/CONNECTIONS.md.
import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { listConnections } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "list_connections",
  title: "List connections",
  description:
    "List the outside services the user has connected (e.g. an issue tracker, a weather API) and the operations you " +
    "may call on each, marked when they write. Call one with call_connection.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await listConnections(supabaseForUser(ctx), ctx.getUserId(), {}), "connections");
  },
});
