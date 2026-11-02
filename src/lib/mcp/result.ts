// Turns an app action's verdict into what an MCP client expects.
//
// A refusal is an MCP error result (`isError: true`) carrying the action's own
// words, never a success with an error string inside it — harnesses decide
// whether to retry or change course on that flag, and a failure dressed as a
// success is the one thing CLAUDE.md rule 8 exists to stop.
import type { ActionResult } from "../appActions";

export function toToolResult(result: ActionResult, key: string) {
  if (!result.ok) {
    return { content: [{ type: "text" as const, text: result.error }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.data) }],
    structuredContent: { [key]: result.data },
  };
}

export const notAuthenticated = {
  content: [{ type: "text" as const, text: "Not authenticated" }],
  isError: true,
};
