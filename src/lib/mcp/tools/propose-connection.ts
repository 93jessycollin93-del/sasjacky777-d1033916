// An agent may suggest a connection — never with a secret, writes or app data
// allowed. The user reviews the host and every operation before approving.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { proposeConnection } from "../../appActions";
import {
  AUTH_TYPES, CONNECTION_LIMITS, CONNECTION_PARAM_TYPES, HTTP_METHODS, PARAM_PLACES,
} from "../../../../supabase/functions/_shared/connections";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "propose_connection",
  title: "Propose a connection",
  description:
    "Propose a connection to a public HTTPS API: its base URL, how it authenticates, and the operations agents could " +
    "call (method, path with {param} placeholders, typed parameters). Saved switched off with no secret; the user " +
    "reviews, adds the key and approves it in the app.",
  inputSchema: {
    name: z.string().trim().describe("lowercase_with_underscores."),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(CONNECTION_LIMITS.description).describe("What the service is."),
    base_url: z.string().trim().describe("https://api.example.com — a public hostname, no IP address."),
    auth_type: z.enum(AUTH_TYPES).optional().describe("none, bearer, header or query (default none)."),
    auth_name: z.string().optional().describe("The header or query parameter the key goes in, for header/query."),
    operations: z.array(z.object({
      name: z.string(),
      description: z.string(),
      method: z.enum(HTTP_METHODS),
      path: z.string().describe("Starts with /; {name} for a path parameter."),
      params: z.array(z.object({
        name: z.string(),
        in: z.enum(PARAM_PLACES),
        type: z.enum(CONNECTION_PARAM_TYPES),
        required: z.boolean().optional(),
        description: z.string().optional(),
        maxLength: z.number().int().optional(),
      })).optional(),
    })).min(1).max(CONNECTION_LIMITS.operations),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await proposeConnection(supabaseForUser(ctx), ctx.getUserId(), args, { via: "mcp" }), "proposal");
  },
});
