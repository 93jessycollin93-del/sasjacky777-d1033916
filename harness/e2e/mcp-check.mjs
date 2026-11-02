// Drives the app's MCP server with the official MCP SDK client, the way any
// harness does, and checks every tool against the real database behind it.
//
//   MCP_URL=http://localhost:54321/functions/v1/mcp TOKENS=…/tokens.json node mcp-check.mjs
//
// Exits non-zero on the first thing that is not as it should be, naming it.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL;
const tokens = JSON.parse(readFileSync(process.env.TOKENS, "utf8"));
const JACKIE_ANSWER = "Jackie here — the end-to-end run reached me through ask_jackie.";

let passed = 0;
function check(name, ok, detail = "") {
  if (!ok) {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok    ${name}`);
}

async function connect(token) {
  const client = new Client({ name: "sas-jacky-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  });
  await client.connect(transport);
  return client;
}

const text = (r) => r.content?.map((c) => c.text ?? "").join("") ?? "";
const data = (r, key) => r.structuredContent?.[key];

// ── Who may connect ───────────────────────────────────────────────────────
{
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } }),
  });
  const challenge = res.headers.get("www-authenticate") ?? "";
  check("refuses a call with no token, and says where to sign in", res.status === 401 && /resource_metadata=/.test(challenge), `HTTP ${res.status}, WWW-Authenticate: ${challenge}`);

  const meta = await fetch(new URL(".well-known/oauth-protected-resource", url.endsWith("/") ? url : `${url}/`));
  const body = meta.ok ? await meta.json() : {};
  check("publishes OAuth metadata naming the app's sign-in as its authorization server", meta.ok && body.authorization_servers?.length === 1, JSON.stringify(body));

  let refused = false;
  try {
    await connect(tokens.session);
  } catch {
    refused = true;
  }
  check("refuses a copied browser session token (no client_id)", refused);
}

// ── What a signed-in agent can do ─────────────────────────────────────────
const mcp = await connect(tokens.user);
const { tools } = await mcp.listTools();
const names = tools.map((t) => t.name).sort();
const expected = [
  "ask_jackie", "create_conversation", "create_task", "delete_task", "forget_fact", "list_conversations",
  "list_tasks", "read_conversation", "remember_fact", "search_memory", "update_task", "update_task_status",
  "list_skills", "get_skill", "propose_skill", "list_custom_tools", "run_custom_tool", "propose_tool",
  "list_connections", "call_connection", "propose_connection",
].sort();
check("offers all twenty-one tools", JSON.stringify(names) === JSON.stringify(expected), names.join(", "));

const created = await mcp.callTool({ name: "create_task", arguments: { title: "MCP check task", priority: "high" } });
const task = data(created, "task");
check("create_task writes a task", !created.isError && task?.title === "MCP check task" && task?.priority === "high", text(created));

const listed = await mcp.callTool({ name: "list_tasks", arguments: { status: "todo" } });
check("list_tasks sees it", (data(listed, "tasks") ?? []).some((t) => t.id === task.id), text(listed));

const updated = await mcp.callTool({ name: "update_task", arguments: { id: task.id, status: "in_progress", title: "MCP check task (moving)" } });
check("update_task changes status and title together", data(updated, "task")?.status === "in_progress" && /moving/.test(data(updated, "task")?.title ?? ""), text(updated));

const badStatus = await mcp.callTool({ name: "update_task_status", arguments: { id: task.id, status: "pending" } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
check("refuses a status the database would reject", badStatus.isError === true, text(badStatus));

const missing = await mcp.callTool({ name: "update_task", arguments: { id: "00000000-0000-0000-0000-000000000000", status: "done" } });
check("says so when a task does not exist, instead of succeeding quietly", missing.isError === true && /No task found/.test(text(missing)), text(missing));

const remembered = await mcp.callTool({ name: "remember_fact", arguments: { key: "e2e_mcp_check", value: "the MCP check ran" } });
check("remember_fact with no category stores it (the old 'general' default failed here)", !remembered.isError && data(remembered, "entry")?.category === "context", text(remembered));

const found = await mcp.callTool({ name: "search_memory", arguments: { query: "MCP check" } });
check("search_memory finds it", (data(found, "entries") ?? []).some((e) => e.key === "e2e_mcp_check"), text(found));

const forgotten = await mcp.callTool({ name: "forget_fact", arguments: { key: "e2e_mcp_check" } });
check("forget_fact removes it", !forgotten.isError, text(forgotten));

const asked = await mcp.callTool({ name: "ask_jackie", arguments: { message: "Are you there?", engine: "bionic", title: "MCP check session" } });
const convId = asked.structuredContent?.conversation_id;
check("ask_jackie reaches Jackie's engine and returns her answer", !asked.isError && text(asked) === JACKIE_ANSWER, text(asked));

const convo = await mcp.callTool({ name: "read_conversation", arguments: { id: convId } });
const msgs = data(convo, "messages") ?? [];
check("the exchange is saved to a conversation in the app", msgs.length === 2 && msgs[0].role === "user" && msgs[1].content === JACKIE_ANSWER, text(convo));

const again = await mcp.callTool({ name: "ask_jackie", arguments: { message: "And again?", engine: "bionic", conversation_id: convId } });
const convo2 = await mcp.callTool({ name: "read_conversation", arguments: { id: convId } });
check("ask_jackie continues an existing conversation", !again.isError && (data(convo2, "messages") ?? []).length === 4, text(convo2));

const convs = await mcp.callTool({ name: "list_conversations", arguments: {} });
check("list_conversations shows it", (data(convs, "conversations") ?? []).some((c) => c.id === convId), text(convs));

const deleted = await mcp.callTool({ name: "delete_task", arguments: { id: task.id } });
check("delete_task removes the task", !deleted.isError, text(deleted));

// ── Skills and custom tools (run.sh seeded one of each, as the person) ──────
const skills = await mcp.callTool({ name: "list_skills", arguments: {} });
check("list_skills shows the person's skill", (data(skills, "skills") ?? []).some((s) => s.name === "e2e_skill"), text(skills));

const loaded = await mcp.callTool({ name: "get_skill", arguments: { name: "e2e_skill" } });
check("get_skill loads its instructions", data(loaded, "skill")?.body === "Say E2E-SKILL-LOADED.", text(loaded));

const proposed = await mcp.callTool({
  name: "propose_skill",
  arguments: { name: "e2e_proposed", title: "Proposed", description: "An agent's idea.", body: "Do it this way." },
});
check("propose_skill saves an agent's skill as a proposal", data(proposed, "proposal")?.status === "proposed", text(proposed));

const notYet = await mcp.callTool({ name: "get_skill", arguments: { name: "e2e_proposed" } });
check("an agent cannot use its own proposal before the person approves it", notYet.isError === true && /No active skill/.test(text(notYet)), text(notYet));

const customTools = await mcp.callTool({ name: "list_custom_tools", arguments: {} });
check("list_custom_tools shows the person's tool", (data(customTools, "tools") ?? []).some((t) => t.name === "e2e_start"), text(customTools));

const ran = await mcp.callTool({ name: "run_custom_tool", arguments: { name: "e2e_start", args: { topic: "custom tool" } } });
const ranSteps = data(ran, "run")?.steps ?? [];
check(
  "run_custom_tool runs both steps, the second using the first's result",
  !ran.isError && ranSteps.length === 2 && ranSteps[1].result?.status === "in_progress" && ranSteps[1].result?.title === "E2E custom tool",
  text(ran),
);
await mcp.callTool({ name: "delete_task", arguments: { id: ranSteps[0]?.result?.id } });

const proposedTool = await mcp.callTool({
  name: "propose_tool",
  arguments: { name: "e2e_tool_idea", description: "An agent's recipe.", steps: [{ action: "list_tasks", args: { status: "todo" } }] },
});
check("propose_tool saves an agent's tool as a proposal", data(proposedTool, "proposal")?.status === "proposed", text(proposedTool));

// ── Connections (docs/CONNECTIONS.md) ─────────────────────────────────────
const proposedConn = await mcp.callTool({
  name: "propose_connection",
  arguments: {
    name: "e2e_conn", title: "E2E service", description: "An agent's idea for a service.",
    base_url: "https://api.example.com", auth_type: "bearer",
    operations: [{ name: "ping", description: "Ping it.", method: "GET", path: "/ping" }],
  },
});
check("propose_connection saves an agent's connection as a proposal", data(proposedConn, "proposal")?.status === "proposed", text(proposedConn));

const conns = await mcp.callTool({ name: "list_connections", arguments: {} });
check(
  "list_connections does not offer a connection the person has not approved",
  !conns.isError && !(data(conns, "connections") ?? []).some((c) => c.name === "e2e_conn"),
  text(conns),
);

const metadata = await mcp.callTool({
  name: "propose_connection",
  arguments: {
    name: "e2e_metadata", title: "Metadata", description: "The cloud metadata service.",
    base_url: "https://169.254.169.254", operations: [{ name: "creds", description: "Read credentials.", method: "GET", path: "/latest" }],
  },
}).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
check("refuses to propose a connection to an IP address", metadata.isError === true, text(metadata));

await mcp.close();
console.log(`\nMCP check: ${passed} passed`);
