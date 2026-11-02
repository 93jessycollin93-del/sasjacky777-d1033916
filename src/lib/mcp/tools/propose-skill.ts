// An agent that has worked out how to do something well can write it down as
// a skill — as a proposal. It stays off until the person approves it on the
// Skills page; the database refuses anything more from an agent's token.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { proposeSkill } from "../../appActions";
import { LIMITS } from "../../customTools";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "propose_skill",
  title: "Propose a skill",
  description:
    "Propose a new skill: reusable instructions for a kind of task. It is saved switched off; the user reviews " +
    "and approves it in the app before any agent can use it. Do not propose one for a one-off task.",
  inputSchema: {
    name: z.string().trim().describe("lowercase_with_underscores, 2–48 characters, e.g. weekly_review."),
    title: z.string().trim().min(1).max(LIMITS.title).describe("A short human title."),
    description: z.string().trim().min(1).max(LIMITS.description).describe("When an agent should use it — one line."),
    body: z.string().trim().min(1).max(LIMITS.body).describe("The instructions, in Markdown."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await proposeSkill(supabaseForUser(ctx), ctx.getUserId(), args, { via: "mcp" }), "proposal");
  },
});
