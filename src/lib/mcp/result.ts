// Turns an app action's verdict into what an MCP client expects.
//
// A refusal is an MCP error result (`isError: true`) carrying the action's own
// words, never a success with an error string inside it — harnesses decide
// whether to retry or change course on that flag, and a failure dressed as a
// success is the one thing CLAUDE.md rule 8 exists to stop.
import type { JsonValueInput } from "@lovable.dev/mcp-js";
import type { ActionResult } from "../appActions";

/**
 * structuredContent must be JSON. Action data is typed `unknown`, and a Date
 * or a Map inside it would reach the client as something other than what the
 * text block said — so it goes through the same serialization the text does,
 * and both halves of the result always agree.
 */
export function asJson(value: unknown): JsonValueInput {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValueInput;
}

export function toToolResult(result: ActionResult, key: string) {
  if (!result.ok) {
    return { content: [{ type: "text" as const, text: result.error }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.data) }],
    structuredContent: { [key]: asJson(result.data) },
  };
}

export const notAuthenticated = {
  content: [{ type: "text" as const, text: "Not authenticated" }],
  isError: true,
};
