// Talks to Jackie the way the chat page does, and leaves the exchange in the app.
//
// A thin adapter over appActions.askJackie (rule 9): the same action a custom
// tool's step runs. It goes through the same edge functions the chat uses,
// with the caller's own token, so every rule the chat obeys applies here too —
// the model allowlist, the quota, the owner-only engines — and the exchange is
// saved to a conversation, so what an agent does is visible in the sidebar.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { functionCaller, supabaseForUser } from "../supabase";
import { askJackie } from "../../appActions";
import { notAuthenticated } from "../result";

export default defineTool({
  name: "ask_jackie",
  title: "Ask Jackie",
  description:
    "Send a message to Jackie and get her answer. She sees the user's memory and active tasks. " +
    "The exchange is saved to a conversation in the app (a new one unless conversation_id is given).",
  inputSchema: {
    message: z.string().trim().min(1).max(20_000).describe("What to say to Jackie."),
    conversation_id: z.string().trim().optional().describe("Continue this conversation (its recent history is sent)."),
    title: z.string().optional().describe("Title for a new conversation."),
    engine: z
      .enum(["cloud", "deepseek", "bionic", "ollama"])
      .optional()
      .describe("Which engine answers (default cloud). bionic and ollama answer the owner only."),
    model: z.string().optional().describe("Model id for that engine; omit for its default."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  handler: async (args, ctx) => {
    if (!ctx.isAuthenticated() || !ctx.getToken()) return notAuthenticated;
    const result = await askJackie(supabaseForUser(ctx), ctx.getUserId(), args, {
      via: "mcp",
      callFunction: functionCaller(ctx),
    });
    if (!result.ok) return { content: [{ type: "text" as const, text: result.error }], isError: true };
    return { content: [{ type: "text" as const, text: result.data.answer }], structuredContent: result.data };
  },
});
