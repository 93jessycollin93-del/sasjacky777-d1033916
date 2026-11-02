// A scripted model for the end-to-end run.
//
// The run proves the wiring, not a model's judgement: that each harness finds
// the app's MCP tools, sends a call through them, and the app really changes.
// So the "model" here follows a fixed plan — call these tools in this order,
// then answer — and a real DeepSeek or Hermes model takes its place in use.
//
// It speaks both wire formats the harnesses use:
//   POST /v1/chat/completions  OpenAI (Hermes Agent's custom provider, Bionic,
//                              and DeepSeek Harness 0.1.5's DeepSeek adapter)
//   POST /v1/messages          Anthropic Messages (the wire newer DeepSeek
//                              Harness releases document, which DeepSeek's own
//                              API serves at /anthropic)
// streaming or not. A request that offers no tools gets a plain answer, which
// is how it stands in for Jackie's engine behind `ask_jackie`.
//
// Harnesses prefix MCP tool names (`mcp_sas_jacky_create_task`,
// `mcp__sasjacky__create_task`), so a planned tool matches any offered name
// ending in it. Every request is appended to MODEL_LOG, so the run can show
// which tools each harness actually offered.
//
//   MODEL_PORT=8200 MODEL_PLAN='[{"tool":"create_task","args":{…}}]' MODEL_LOG=… node model.mjs
import http from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.env.MODEL_PORT ?? 8200);
const plan = JSON.parse(process.env.MODEL_PLAN ?? "[]");
const log = process.env.MODEL_LOG;
const JACKIE_ANSWER = "Jackie here — the end-to-end run reached me through ask_jackie.";

const record = (entry) => log && appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");

/** The planned step this conversation is on: one per tool result already in it. */
function decide(toolNames, resultsSoFar, lastResult) {
  if (toolNames.length === 0) return { text: JACKIE_ANSWER };
  const step = plan[resultsSoFar];
  if (!step) return { text: `E2E-DONE after ${resultsSoFar} tool call(s). Last result: ${String(lastResult).slice(0, 300)}` };
  const name = toolNames.find((n) => n === step.tool || n.endsWith(`_${step.tool}`));
  if (!name) return { text: `E2E-MISSING-TOOL ${step.tool}; offered: ${toolNames.join(", ")}` };
  return { call: { name, args: step.args ?? {} } };
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b ? JSON.parse(b) : {}));
  });
}

const sse = (res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  return (event, data) => res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
};

function openai(body, res) {
  const tools = (body.tools ?? []).map((t) => t.function?.name).filter(Boolean);
  const msgs = body.messages ?? [];
  const results = msgs.filter((m) => m.role === "tool");
  const d = decide(tools, results.length, results.at(-1)?.content);
  record({ api: "openai", model: body.model, tools, toolResults: results.length, decision: d });
  const id = `chatcmpl-${Date.now()}`;
  const toolCall = d.call && {
    id: `call_${results.length}`,
    type: "function",
    function: { name: d.call.name, arguments: JSON.stringify(d.call.args) },
  };
  if (!body.stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      id, object: "chat.completion", model: body.model,
      choices: [{
        index: 0,
        message: toolCall ? { role: "assistant", content: null, tool_calls: [toolCall] } : { role: "assistant", content: d.text },
        finish_reason: toolCall ? "tool_calls" : "stop",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  }
  const send = sse(res);
  const chunk = (delta, finish = null) => send(null, { id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  if (toolCall) {
    chunk({ role: "assistant", tool_calls: [{ index: 0, id: toolCall.id, type: "function", function: { name: toolCall.function.name, arguments: "" } }] });
    chunk({ tool_calls: [{ index: 0, function: { arguments: toolCall.function.arguments } }] });
    chunk({}, "tool_calls");
  } else {
    chunk({ role: "assistant", content: "" });
    chunk({ content: d.text });
    chunk({}, "stop");
  }
  send(null, "[DONE]");
  res.end();
}

function anthropic(body, res) {
  const tools = (body.tools ?? []).map((t) => t.name).filter(Boolean);
  const blocks = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
  const results = blocks.filter((b) => b.type === "tool_result");
  const last = results.at(-1);
  const lastText = last && (typeof last.content === "string" ? last.content : JSON.stringify(last.content));
  const d = decide(tools, results.length, lastText);
  record({ api: "anthropic", model: body.model, tools, toolResults: results.length, decision: d });
  const id = `msg_${Date.now()}`;
  const block = d.call
    ? { type: "tool_use", id: `toolu_${results.length}`, name: d.call.name, input: d.call.args }
    : { type: "text", text: d.text };
  const stop = d.call ? "tool_use" : "end_turn";
  const usage = { input_tokens: 1, output_tokens: 1 };
  if (!body.stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id, type: "message", role: "assistant", model: body.model, content: [block], stop_reason: stop, stop_sequence: null, usage }));
  }
  const send = sse(res);
  send("message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
  if (d.call) {
    send("content_block_start", { type: "content_block_start", index: 0, content_block: { ...block, input: {} } });
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(d.call.args) } });
  } else {
    send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
    send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d.text } });
  }
  send("content_block_stop", { type: "content_block_stop", index: 0 });
  send("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage });
  send("message_stop", { type: "message_stop" });
  res.end();
}

http
  .createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "e2e-scripted", object: "model", owned_by: "e2e" }] }));
    }
    if (req.method === "POST" && path.endsWith("/chat/completions")) return openai(await readBody(req), res);
    if (req.method === "POST" && path.endsWith("/messages")) return anthropic(await readBody(req), res);
    record({ unhandled: `${req.method} ${path}` });
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `scripted model: no route ${req.method} ${path}` } }));
  })
  .listen(port, "127.0.0.1", () => console.log(`scripted model on http://127.0.0.1:${port}`));
