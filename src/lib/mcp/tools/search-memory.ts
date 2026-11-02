// Every tool here is a thin adapter over `src/lib/appActions.ts`, which the
// in-app agents call too, so an action behaves the same from a harness as from
// inside the app. Owner scoping (RLS plus an explicit user_id predicate) lives
// there.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { searchMemory, MEMORY_CATEGORIES } from "../../appActions";
import { notAuthenticated, toToolResult } from "../result";

export default defineTool({
  name: "search_memory",
  title: "Search Jackie memory",
  description: "Search the signed-in user's Jackie long-term memory by key or value text. Omit query to list recent entries.",
  inputSchema: {
    query: z.string().trim().optional().describe("Text to match against memory key or value."),
    category: z.enum(MEMORY_CATEGORIES).optional().describe("Optional category filter."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated;
    return toToolResult(await searchMemory(supabaseForUser(ctx), ctx.getUserId(), args), "entries");
  },
});
