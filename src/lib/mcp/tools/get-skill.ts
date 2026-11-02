// Loading a skill is recorded in the user's activity, so the Skills page can
// show which instructions an agent actually followed.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { getSkill } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "get_skill",
  title: "Load a skill",
  description: "Load one of the user's skills by name: its full instructions. Follow them for the task it fits.",
  inputSchema: {
    name: z.string().trim().min(1).describe("The skill's name, from list_skills."),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await getSkill(supabaseForUser(ctx), ctx.getUserId(), args, { via: "mcp" }), "skill");
  },
});
