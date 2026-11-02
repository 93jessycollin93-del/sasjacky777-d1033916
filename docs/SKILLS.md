# Skills, custom tools and connections

`/skills` is where you teach the agents that drive Jackie: Hermes Agent and DeepSeek
Harness over MCP, and the Agent Lab's operators. There are three kinds of thing to
teach them, and they can propose all three themselves.

| | What it is | How an agent uses it |
| --- | --- | --- |
| **Skill** | Named instructions for a kind of task ("how I like a weekly review run"). A title, one line saying when it applies, and up to 8,000 characters of Markdown. | `list_skills` shows each skill's one line. `get_skill` loads the instructions when a task fits. |
| **Custom tool** | A named recipe of up to 8 steps, each one of the actions agents already have (`create_task`, `remember_fact`, `ask_jackie`, `call_connection`, …), with parameters. | `list_custom_tools` shows signatures. `run_custom_tool` runs one. |
| **Connection** | An outside HTTPS service, its key, and the operations agents may call on it. | `list_connections` shows each one's operations. `call_connection` runs one. See [CONNECTIONS.md](CONNECTIONS.md). |

A custom tool **adds no capability**. Each step goes through the same action an agent
could call directly, with the same checks: row-level security for the app's own rows,
the chat's quota and model allowlist for `ask_jackie`, and the connection's own grants
for `call_connection`. There is no code in a tool, so it can never do more than the
agent running it could already do one step at a time.

One thing a tool *can* do that a single call cannot is feed one step's result into
the next. Into a connection, that would carry app data — your tasks, your memory —
out to someone else's server. So a `call_connection` step whose arguments use
`{{steps.…}}` is refused unless you marked that operation **accepts app data**.
Agents cannot mark it, and cannot propose a connection with it already marked.

## Agents propose, you decide

`propose_skill`, `propose_tool` and `propose_connection` save what an agent wrote as a
**proposal**, switched off. It appears under **Waiting for you** on `/skills`, with where
it came from. Nothing an agent proposes is listed to any agent, or runnable, until you
approve it.

The card shows a proposal **exactly as agents will read it**: a skill's instructions as
raw text, not rendered Markdown (a link definition or an HTML comment renders as
nothing, and `get_skill` hands agents every character), a tool's every parameter and
parameter description, a connection's every operation and parameter. Invisible
characters are spelled out as `⟦U+200B⟧`, with a count. Characters whose only use here
is to show a person one text and a model another — bidi overrides and isolates, Unicode
tag characters — are refused outright, by the validators and by the database
(`supabase/functions/_shared/textSafety.ts`). Approving checks the row the way the page
checks what you write, so a row written around the app that cannot run is not switched
on.

This is enforced in the database, not only in the tools. An agent harness holds a real
access token and is one HTTP call away from the API. Tokens the MCP server accepts carry
an OAuth `client_id`; the app's own session does not. A trigger on both tables
(`private.agent_proposals_only`) lets a write carrying a `client_id` do one thing:
insert a row with status `proposed`. It cannot activate, edit, archive or delete
anything, including its own proposal, and the database — not the agent — records who
proposed it (`agent:mcp`), so no proposal can claim to be yours. The same goes for the
activity trail: a row an agent's token writes to `audit_events` is attributed to the
agent, whatever actor it names. `scripts/db-authz-test.sh` proves each of those
refusals, for both forms in which PostgREST publishes claims.

A runaway agent cannot bury your list either: 20 pending proposals of each kind is the
cap, and 200 skills or tools per account, counted under a per-account lock so that
proposals sent in parallel cannot all slip under it.

## Writing a tool

Steps are JSON. A step's arguments may use:

- `{{topic}}` for a parameter of the tool;
- `{{steps.0.id}}` for a field of an earlier step's result. Step 1 is `steps.0`.

A placeholder that is the whole value keeps its type (a number stays a number). One
inside other text is written in as text. An optional parameter that was left out drops
its argument when it is the whole value, and reads as nothing inside text — so a tool
never fails half-way over a parameter it advertises as optional. Every placeholder is
checked when the tool is saved: a parameter that does not exist, or a step that refers to
a later step, is refused with the reason.

Call a tool as `run_custom_tool {"name": "start_review", "args": {"topic": "billing"}}`.
Parameters written beside `name` rather than inside `args` are refused with the right
form, not silently dropped.

```json
[
  {"action": "create_task", "args": {"title": "Review {{topic}}", "priority": "high"}},
  {"action": "update_task", "args": {"id": "{{steps.0.id}}", "status": "in_progress"}}
]
```

A run stops at the first failing step. The error names the step, lists the steps that
already ran and what each returned — the task it created, say — so an agent can finish
or undo them instead of retrying from the top and doing them twice. A tool with a
deleting step (`delete_task`, `forget_fact`) is refused for an Agent Lab operator whose
**Allow deletes** is off, the same as if it had called `delete_task` itself.

## What agents did

Every skill load, tool run, connection call and proposal is written to your own
`audit_events` trail, with the surface it came from (`agent:mcp` or `agent:agent-lab`),
and shown under **What agents did** — yours only, even if your role lets you read other
accounts' trails. A refused run is recorded as `denied`, and a failed one as `error` with
the step it stopped at. When the record itself cannot be written, the agent's result says
so (`activity_logged: false`) rather than the action passing unrecorded and unmentioned.
If the trail cannot be read, the tab says that, not "no agent has done anything".

## Changing this

- What a step may call is `CUSTOM_TOOL_ACTIONS` in `src/lib/customTools.ts` **and**
  `private.custom_tool_steps_valid` in the migration. `src/test/custom-tools.test.ts`
  fails if they differ, and does the same for the reserved names and the name pattern.
- A new agent capability is still an action in `appActions.ts` first (rule 9). Adding it
  to `CUSTOM_TOOL_ACTIONS` is a separate decision: a step may do anything an agent may
  do, but never run another tool or propose one — a tool that runs tools is a loop, and
  a tool that proposes tools is an agent writing its own permissions.
- An action that reaches an edge function (`ask_jackie`, `call_connection`) does it
  through `ctx.callFunction`, which each surface supplies: the MCP server a fetch with
  the agent's token, the browser `callEdgeFunction` (rule 4). `appActions.ts` never
  builds a request itself.
- Every action is in `appActions.ts`, an MCP tool in `src/lib/mcp/tools/`, and an
  `AGENT_TOOLS` entry in `appAgent.ts`. `src/test/agent-skills.test.ts` fails if one
  surface is missing one.

## Switching it on

Run `supabase db push` (`20261011120000_jackie_skills_and_tools.sql` and
`20261011130000_jackie_connections.sql`). Until then the tools answer that the tables
do not exist, and `/skills` says the same with the command to run. Connections that
need a key also need `CONNECTIONS_SECRET_KEY` in Cloud → Secrets; CONNECTIONS.md says
how to make one.
