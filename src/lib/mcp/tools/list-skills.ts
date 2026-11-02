// Skills are instructions the person has written for their agents. Listing
// shows only the line that says when each one applies; get_skill loads the
// rest, so a harness does not pay for every skill's text on every turn.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { listSkills } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "list_skills",
  title: "List skills",
  description:
    "List the skills the user has given their agents: each one's name and when to use it. " +
    "Before a task one fits, load it with get_skill and follow it.",
  inputSchema: {
    query: z.string().trim().optional().describe("Words to filter by (name, title or description)."),
    limit: z.number().int().min(1).max(100).optional().describe("Most to return (default 50)."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await listSkills(supabaseForUser(ctx), ctx.getUserId(), args), "skills");
  },
});
