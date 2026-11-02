import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArchiveRestore, Bot, Check, Play, Plus, RefreshCw, Trash2, Wrench, X, BookOpen, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CUSTOM_TOOL_ACTIONS, LIMITS, PARAM_TYPES, isDestructive, toolSignature, validateSkill, validateToolSpec,
  type CustomToolAction, type ParamType, type SkillSpec, type ToolParam, type ToolSpec,
} from "@/lib/customTools";
import {
  activate, loadActivity, loadConnections, loadSkills, loadTools, remove, runToolNow, saveSkill, saveTool, setStatus,
  type ActivityRow, type ConnectionRow, type SkillRow, type ToolRow,
} from "@/lib/jackie-skills";
import { ConnectionSummary, ConnectionsTab } from "@/components/skills/ConnectionsTab";
import { Revealed } from "@/components/skills/Revealed";
import { ParamInputs, typedArgs } from "@/components/skills/ParamInputs";
import { feedsEarlierResult } from "@/lib/customTools";
import { isWrite } from "../../supabase/functions/_shared/connections";
import type { ActionResult } from "@/lib/appActions";

/**
 * Skills, tools and connections for the agents that drive Jackie — Hermes
 * Agent and DeepSeek Harness over MCP, and the Agent Lab's operators.
 *
 * Agents may propose; only the person switches anything on, here. The
 * database holds that line (an agent's token can only insert a proposal), so
 * this page is where the decision is made, not where it is enforced.
 */

const errorOf = (r: ActionResult<unknown>) => ("error" in r ? r.error ?? null : null);
/** Who did something in the activity trail. "person" is jackie-connect's word for the signed-in person. */
const who = (actor: string | null) =>
  actor === "agent:mcp" ? "an external agent (MCP)"
    : actor === "agent:agent-lab" ? "an Agent Lab operator"
      : actor === "agent:app" || actor === "person" || !actor ? "you"
        : actor;
/**
 * Who proposed something. Never "you": the person writes active rows, not
 * proposals, so a proposal whose author is missing or unfamiliar is said to be
 * exactly that — the database pins agents' own writes to agent:mcp.
 */
const proposer = (by: string | null) =>
  by === "agent:mcp" ? "an external agent (MCP)"
    : by === "agent:agent-lab" ? "an Agent Lab operator"
      : by ? `"${by}" (not a source this page recognises)`
        : "an unrecorded source";

export default function JackieSkills() {
  const { toast } = useToast();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("skills");

  const refresh = useCallback(async () => {
    const [s, t, c, a] = await Promise.all([loadSkills(), loadTools(), loadConnections(), loadActivity()]);
    setLoadError(errorOf(s) ?? errorOf(t) ?? errorOf(c) ?? null);
    if (s.ok) setSkills(s.data);
    if (t.ok) setTools(t.data);
    if (c.ok) setConnections(c.data);
    // The activity trail is a view onto audit_events; failing to read it is
    // said on its tab, never shown as "no agent has done anything" (rule 8).
    setActivity(a.ok ? a.data : []);
    setActivityError(errorOf(a));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = useCallback(async (label: string, op: () => Promise<ActionResult<unknown>>) => {
    setBusy(true);
    try {
      const res = await op();
      if (!res.ok) toast({ title: `${label} failed`, description: errorOf(res) ?? undefined, variant: "destructive" });
      await refresh();
      return res.ok;
    } finally {
      setBusy(false);
    }
  }, [refresh, toast]);

  const pendingSkills = skills.filter((s) => s.status === "proposed");
  const pendingTools = tools.filter((t) => t.status === "proposed");
  const pendingConnections = connections.filter((c) => c.status === "proposed");
  const pending = pendingSkills.length + pendingTools.length + pendingConnections.length;

  // The review tab is disabled once nothing waits; staying on it would leave
  // the person on an empty, unreachable tab after their last decision.
  useEffect(() => {
    if (pending === 0 && tab === "review") setTab("skills");
  }, [pending, tab]);

  return (
    // pb-36 keeps the last entry clear of the floating nav bar.
    <div className="max-w-5xl mx-auto px-4 pt-6 pb-36 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Skills, tools &amp; connections</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Teach the agents that drive Jackie — Hermes and DeepSeek over MCP, and the Agent Lab operators. A skill is
            instructions they load when a task fits; a tool is a named recipe of the actions they already have; a
            connection is an outside service they may call, on the terms you set. They can propose their own; nothing
            an agent writes is used until you approve it here.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={busy} className="min-h-10">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </header>

      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground break-words" role="alert">
          {loadError}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="review" disabled={pending === 0}>
            Waiting for you{pending ? ` (${pending})` : ""}
          </TabsTrigger>
          <TabsTrigger value="skills">Skills ({skills.filter((s) => s.status !== "proposed").length})</TabsTrigger>
          <TabsTrigger value="tools">Tools ({tools.filter((t) => t.status !== "proposed").length})</TabsTrigger>
          <TabsTrigger value="connections">Connections ({connections.filter((c) => c.status !== "proposed").length})</TabsTrigger>
          <TabsTrigger value="activity">What agents did</TabsTrigger>
        </TabsList>

        <TabsContent value="review" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Agents proposed these. Read them as you would a stranger's instructions to your assistant: approve only what
            you would be happy for every agent to follow.
          </p>
          {pendingSkills.map((s) => (
            <Proposal key={s.id} kind="skill" title={s.title} name={s.name} by={s.proposed_by} busy={busy}
              onApprove={() => act("Approving", () => activate("jackie_skills", s))}
              onReject={() => act("Rejecting", () => remove("jackie_skills", s.id))}>
              <Revealed text={s.description} className="text-sm text-muted-foreground" />
              {/* The raw text, not rendered Markdown: a link definition or an
                  HTML comment renders as nothing, and get_skill hands agents
                  every character of it. */}
              <p className="text-xs text-muted-foreground">Exactly what agents will read:</p>
              <Revealed block text={s.body}
                className="whitespace-pre-wrap break-words font-mono text-xs rounded-lg border border-border bg-muted/30 p-3 max-h-96 overflow-auto" />
            </Proposal>
          ))}
          {pendingTools.map((t) => (
            <Proposal key={t.id} kind="tool" title={t.name} name={t.name} by={t.proposed_by} busy={busy}
              onApprove={() => act("Approving", () => activate("jackie_custom_tools", t))}
              onReject={() => act("Rejecting", () => remove("jackie_custom_tools", t.id))}>
              <ToolSummary tool={t} connections={connections} />
            </Proposal>
          ))}
          {pendingConnections.map((c) => (
            <Proposal key={c.id} kind="connection" title={c.title} name={c.name} by={c.proposed_by} busy={busy}
              onApprove={() => act("Approving", () => activate("jackie_connections", c))}
              onReject={() => act("Rejecting", () => remove("jackie_connections", c.id))}>
              <ConnectionSummary c={c} />
              <p className="text-xs text-muted-foreground">
                Approving lets agents read from this host with the operations above. Writes, app data and the key stay
                off until you turn them on under Connections.
              </p>
            </Proposal>
          ))}
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab skills={skills.filter((s) => s.status !== "proposed")} busy={busy} act={act} />
        </TabsContent>
        <TabsContent value="tools">
          <ToolsTab tools={tools.filter((t) => t.status !== "proposed")} busy={busy} act={act} connections={connections} />
        </TabsContent>
        <TabsContent value="connections">
          <ConnectionsTab connections={connections.filter((c) => c.status !== "proposed")} busy={busy} act={act} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab rows={activity} error={activityError} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Proposal({
  kind, title, name, by, busy, onApprove, onReject, children,
}: {
  kind: "skill" | "tool" | "connection"; title: string; name: string; by: string | null; busy: boolean;
  onApprove: () => void; onReject: () => void; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="w-4 h-4 text-amber-700 dark:text-amber-400" />
        <Revealed text={title} className="font-medium text-foreground" />
        <Badge variant="outline" className="font-mono text-[11px]">{kind}: {name}</Badge>
        <span className="text-xs text-muted-foreground">proposed by {proposer(by)}</span>
      </div>
      {children}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={onApprove} aria-label={`Approve ${kind} ${name}`}>
          <Check className="w-4 h-4 mr-1" /> Approve
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReject} aria-label={`Reject ${kind} ${name}`}>
          <X className="w-4 h-4 mr-1" /> Reject
        </Button>
      </div>
    </section>
  );
}

/**
 * Everything about a tool that an agent will read: its description, every
 * parameter with its description (list_custom_tools sends them verbatim), and
 * every step, labelled the way templates refer to it.
 */
function ToolSummary({ tool, connections = [] }: {
  tool: { name: string; description: string; params: ToolParam[]; steps: ToolSpec["steps"] };
  connections?: ConnectionRow[];
}) {
  const params = Array.isArray(tool.params) ? tool.params : [];
  const steps = Array.isArray(tool.steps) ? tool.steps : [];
  return (
    <div className="space-y-2 text-sm">
      <Revealed text={tool.description} className="text-muted-foreground block" />
      {isDestructive(steps) && (
        <p className="text-destructive text-xs">
          Deletes things. Agent Lab operators need Allow deletes to run it; MCP agents can delete with or without it.
        </p>
      )}
      {params.length > 0 && (
        <ul className="space-y-1">
          {params.map((p, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
              <Revealed text={String(p?.name ?? "")} className="font-mono text-foreground" />
              <span className="text-muted-foreground">{String(p?.type ?? "?")}{p?.required ? ", required" : ", optional"}</span>
              {p?.description ? <Revealed text={`— ${p.description}`} className="text-muted-foreground" /> : null}
            </li>
          ))}
        </ul>
      )}
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="break-words">
            <span className="text-xs text-muted-foreground">Step {i + 1} <code className="text-[10px]">steps.{i}</code></span>{" "}
            <span className="font-mono">{s.action}</span>{" "}
            <Revealed text={JSON.stringify(s.args ?? {})} className="font-mono text-xs text-muted-foreground" />
            {s.action === "call_connection" && <ConnectionStepNote step={s} connections={connections} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What a connection step does, in words: which service, which method, whether
 * it writes, and whether it sends an earlier step's result. A tool reaches the
 * same operations as the connection's own Run button, which says "It writes";
 * the tool's card has to say it too.
 */
function ConnectionStepNote({ step, connections }: { step: ToolSpec["steps"][number]; connections: ConnectionRow[] }) {
  const args = (step.args ?? {}) as Record<string, unknown>;
  const name = typeof args.connection === "string" ? args.connection : null;
  const opName = typeof args.operation === "string" ? args.operation : null;
  const c = name && !name.includes("{{") ? connections.find((x) => x.name === name) : undefined;
  const op = c && opName && !opName.includes("{{") ? c.operations.find((o) => o.name === opName) : undefined;
  const sends = feedsEarlierResult(step);
  const parts: string[] = [];
  if (!c) parts.push(name && !name.includes("{{") ? `calls "${name}", which is not one of your connections` : "calls a connection chosen when it runs");
  else if (!op) parts.push(`calls ${c.name}.${opName ?? "?"}, which that connection does not have`);
  else parts.push(`calls ${c.name}.${op.name}: ${op.method} to ${new URL(c.base_url).host}${isWrite(op.method) ? " — writes" : ""}`);
  if (sends) parts.push("sends an earlier step's result");
  const warn = (op && isWrite(op.method)) || sends || !op;
  return <span className={`block text-xs ${warn ? "text-destructive" : "text-muted-foreground"}`}>{parts.join("; ")}.</span>;
}

type Act = (label: string, op: () => Promise<ActionResult<unknown>>) => Promise<boolean>;

// --- skills ---------------------------------------------------------------------

const EMPTY_SKILL: SkillSpec = { name: "", title: "", description: "", body: "" };

function SkillsTab({ skills, busy, act }: { skills: SkillRow[]; busy: boolean; act: Act }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<SkillSpec>(EMPTY_SKILL);
  const [confirm, setConfirm] = useState<SkillRow | null>(null);
  const problem = editing ? validateSkill(draft) : null;

  const open = (s?: SkillRow) => {
    setEditing(s ? s.id : "new");
    setDraft(s ? { name: s.name, title: s.title, description: s.description, body: s.body } : EMPTY_SKILL);
  };

  return (
    <div className="space-y-4">
      {editing ? (
        <section className="rounded-xl border border-border p-4 space-y-3">
          <h2 className="font-medium text-foreground">{editing === "new" ? "New skill" : `Edit ${draft.name}`}</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input aria-label="Name" placeholder="name, e.g. weekly_review" value={draft.name}
              disabled={editing !== "new"} onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })} />
            <Input aria-label="Title" placeholder="Title" maxLength={LIMITS.title} value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <Input aria-label="When to use it" placeholder="When should an agent use it? One line — agents choose by this."
            maxLength={LIMITS.description} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <Textarea aria-label="Instructions" placeholder="The instructions, in Markdown." className="min-h-48 font-mono text-sm"
            maxLength={LIMITS.body} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs ${problem ? "text-destructive" : "text-muted-foreground"}`}>
              {problem ?? `${draft.body.trim().length}/${LIMITS.body}`}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" disabled={busy || !!problem}
                onClick={async () => {
                  if (await act("Saving", () => saveSkill(draft, editing === "new" ? undefined : editing))) setEditing(null);
                }}>
                <Check className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Button size="sm" variant="outline" onClick={() => open()} disabled={busy}><Plus className="w-4 h-4 mr-2" /> New skill</Button>
      )}

      {skills.length === 0 && !editing && (
        <p className="text-sm text-muted-foreground">
          No skills yet. Write down how you like something done — a weekly review, a bug report, a deploy checklist —
          and every agent that drives Jackie can follow it.
        </p>
      )}

      <ul className="space-y-2">
        {skills.map((s) => (
          <li key={s.id} className={`rounded-xl border border-border p-3 ${s.status === "archived" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{s.title}</span>
              <Badge variant="outline" className="font-mono text-[11px]">{s.name}</Badge>
              {s.status === "archived" && <Badge variant="secondary" className="text-[11px]">archived</Badge>}
              {s.proposed_by && <span className="text-xs text-muted-foreground">from {who(s.proposed_by)}</span>}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => open(s)} disabled={busy} aria-label={`Edit ${s.name}`}>Edit</Button>
                <Button size="icon" variant="ghost" disabled={busy}
                  aria-label={s.status === "archived" ? `Restore ${s.name}` : `Archive ${s.name}`}
                  onClick={() => act(s.status === "archived" ? "Restoring" : "Archiving",
                    () => (s.status === "archived" ? activate("jackie_skills", s) : setStatus("jackie_skills", s.id, "archived")))}>
                  {s.status === "archived" ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} aria-label={`Delete ${s.name}`} onClick={() => setConfirm(s)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
          </li>
        ))}
      </ul>

      <ConfirmDelete what={confirm ? `the skill “${confirm.title}”` : ""} open={!!confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const s = confirm; setConfirm(null); if (s) act("Deleting", () => remove("jackie_skills", s.id)); }} />
    </div>
  );
}

// --- tools ----------------------------------------------------------------------

const EMPTY_TOOL: ToolSpec = { name: "", description: "", params: [], steps: [{ action: "list_tasks", args: {} }] };

function ToolsTab({ tools, busy, act, connections }: { tools: ToolRow[]; busy: boolean; act: Act; connections: ConnectionRow[] }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ToolSpec>(EMPTY_TOOL);
  // Args are edited as JSON text; a step whose text does not parse is named, not dropped.
  const [argsText, setArgsText] = useState<string[]>(["{}"]);
  const [confirm, setConfirm] = useState<ToolRow | null>(null);
  const [trying, setTrying] = useState<ToolRow | null>(null);

  const parsed = useMemo(() => {
    const steps = [] as ToolSpec["steps"];
    for (const [i, text] of argsText.entries()) {
      try {
        const args = JSON.parse(text || "{}");
        steps.push({ action: draft.steps[i]?.action ?? "list_tasks", args });
      } catch {
        return { spec: null, problem: `Step ${i + 1}'s arguments are not valid JSON.` };
      }
    }
    const spec = { ...draft, steps };
    return { spec, problem: validateToolSpec(spec) };
  }, [draft, argsText]);

  const open = (t?: ToolRow) => {
    const spec = t ? { name: t.name, description: t.description, params: t.params, steps: t.steps } : EMPTY_TOOL;
    setEditing(t ? t.id : "new");
    setDraft(spec);
    setArgsText(spec.steps.map((s) => JSON.stringify(s.args ?? {}, null, 1)));
  };
  const setParam = (i: number, p: Partial<ToolParam>) =>
    setDraft({ ...draft, params: draft.params.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const setAction = (i: number, action: CustomToolAction) =>
    setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, action } : s)) });

  return (
    <div className="space-y-4">
      {editing ? (
        <section className="rounded-xl border border-border p-4 space-y-4">
          <h2 className="font-medium text-foreground">{editing === "new" ? "New tool" : `Edit ${draft.name}`}</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input aria-label="Tool name" placeholder="name, e.g. start_review" value={draft.name} disabled={editing !== "new"}
              onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })} />
            <Input aria-label="What it does" placeholder="What it does — one line" maxLength={LIMITS.description}
              value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Parameters</h3>
              <Button size="sm" variant="ghost" disabled={draft.params.length >= LIMITS.params}
                onClick={() => setDraft({ ...draft, params: [...draft.params, { name: "", type: "string", required: true }] })}>
                <Plus className="w-4 h-4 mr-1" /> Parameter
              </Button>
            </div>
            {draft.params.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input aria-label={`Parameter ${i + 1} name`} className="w-40" placeholder="name" value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value.toLowerCase() })} />
                <Select value={p.type} onValueChange={(v) => setParam(i, { type: v as ParamType })}>
                  <SelectTrigger className="w-32" aria-label={`Parameter ${i + 1} type`}><SelectValue /></SelectTrigger>
                  <SelectContent>{PARAM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={!!p.required} onCheckedChange={(on) => setParam(i, { required: on })} aria-label={`Parameter ${i + 1} required`} />
                  required
                </label>
                <Input aria-label={`Parameter ${i + 1} description`} className="flex-1 min-w-40" placeholder="description (optional)"
                  value={p.description ?? ""} onChange={(e) => setParam(i, { description: e.target.value || undefined })} />
                <Button size="icon" variant="ghost" aria-label={`Remove parameter ${i + 1}`}
                  onClick={() => setDraft({ ...draft, params: draft.params.filter((_, j) => j !== i) })}><X className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">Steps</h3>
              <Button size="sm" variant="ghost" disabled={draft.steps.length >= LIMITS.steps}
                onClick={() => { setDraft({ ...draft, steps: [...draft.steps, { action: "list_tasks", args: {} }] }); setArgsText([...argsText, "{}"]); }}>
                <Plus className="w-4 h-4 mr-1" /> Step
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Arguments are JSON. Use <code>{"{{param}}"}</code> for a parameter and <code>{"{{steps.0.id}}"}</code> for a field
              of an earlier step's result — step 1 is <code>steps.0</code>.
            </p>
            {draft.steps.map((s, i) => (
              <div key={i} className="rounded-lg border border-border p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24">Step {i + 1} <code className="text-[10px]">steps.{i}</code></span>
                  <Select value={s.action} onValueChange={(v) => setAction(i, v as CustomToolAction)}>
                    <SelectTrigger className="w-56" aria-label={`Step ${i + 1} action`}><SelectValue /></SelectTrigger>
                    <SelectContent>{CUSTOM_TOOL_ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Remove step ${i + 1}`} disabled={draft.steps.length <= 1}
                    onClick={() => {
                      setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) });
                      setArgsText(argsText.filter((_, j) => j !== i));
                    }}><X className="w-4 h-4" /></Button>
                </div>
                <Textarea aria-label={`Step ${i + 1} arguments`} className="font-mono text-xs min-h-28" value={argsText[i] ?? "{}"}
                  onChange={(e) => setArgsText(argsText.map((t, j) => (j === i ? e.target.value : t)))} />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs ${parsed.problem ? "text-destructive" : "text-muted-foreground"}`}>
              {parsed.problem ?? (parsed.spec ? `Agents will see: ${toolSignature(parsed.spec)}` : "")}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" disabled={busy || !!parsed.problem || !parsed.spec}
                onClick={async () => {
                  if (parsed.spec && await act("Saving", () => saveTool(parsed.spec, editing === "new" ? undefined : editing))) setEditing(null);
                }}>
                <Check className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Button size="sm" variant="outline" onClick={() => open()} disabled={busy}><Plus className="w-4 h-4 mr-2" /> New tool</Button>
      )}

      {tools.length === 0 && !editing && (
        <p className="text-sm text-muted-foreground">
          No tools yet. A tool strings together actions agents already have — e.g. “start_review”: create a task, then
          remember the decision — so an agent can do it in one call, the same way every time.
        </p>
      )}

      <ul className="space-y-2">
        {tools.map((t) => (
          <li key={t.id} className={`rounded-xl border border-border p-3 space-y-2 ${t.status === "archived" ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Wrench className="w-4 h-4 text-muted-foreground" />
              <span className="font-mono text-sm text-foreground">{t.name}</span>
              {t.status === "archived" && <Badge variant="secondary" className="text-[11px]">archived</Badge>}
              {t.proposed_by && <span className="text-xs text-muted-foreground">from {who(t.proposed_by)}</span>}
              <div className="ml-auto flex gap-1">
                {t.status === "active" && (
                  <Button size="sm" variant="ghost" onClick={() => setTrying(t)} disabled={busy} aria-label={`Run ${t.name}`}>
                    <Play className="w-4 h-4 mr-1" /> Run
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => open(t)} disabled={busy} aria-label={`Edit ${t.name}`}>Edit</Button>
                <Button size="icon" variant="ghost" disabled={busy}
                  aria-label={t.status === "archived" ? `Restore ${t.name}` : `Archive ${t.name}`}
                  onClick={() => act(t.status === "archived" ? "Restoring" : "Archiving",
                    () => (t.status === "archived" ? activate("jackie_custom_tools", t) : setStatus("jackie_custom_tools", t.id, "archived")))}>
                  {t.status === "archived" ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                </Button>
                <Button size="icon" variant="ghost" disabled={busy} aria-label={`Delete ${t.name}`} onClick={() => setConfirm(t)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <ToolSummary tool={t} connections={connections} />
          </li>
        ))}
      </ul>

      {trying && <TryTool tool={trying} onClose={() => setTrying(null)} connections={connections} />}
      <ConfirmDelete what={confirm ? `the tool “${confirm.name}”` : ""} open={!!confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const t = confirm; setConfirm(null); if (t) act("Deleting", () => remove("jackie_custom_tools", t.id)); }} />
    </div>
  );
}

function TryTool({ tool, onClose, connections }: { tool: ToolRow; onClose: () => void; connections: ConnectionRow[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<ActionResult | null>(null);
  const parsed = useMemo(() => typedArgs(tool.params, values), [tool.params, values]);

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-h-[85vh] overflow-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Run {tool.name}</AlertDialogTitle>
          <AlertDialogDescription>
            This really runs it, as you — the same runner agents use.{isDestructive(tool.steps) ? " It deletes things." : ""}
            {tool.steps.some((s) => s.action === "call_connection") && (
              <span className="block mt-1 text-destructive">
                It calls outside services, as you: a connection's "agents may only read" does not stop a run you start here.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <ToolSummary tool={tool} connections={connections} />
          <ParamInputs params={tool.params} values={values} onChange={setValues} />
          {"error" in parsed && <p className="text-xs text-destructive">{parsed.error}</p>}
          {outcome && (
            <pre className={`rounded-lg border p-2 text-xs whitespace-pre-wrap break-words ${outcome.ok ? "border-border bg-muted/40" : "border-destructive/40 bg-destructive/10"}`}>
              {outcome.ok ? JSON.stringify(outcome.data, null, 1) : outcome.error}
            </pre>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction disabled={running || "error" in parsed}
            onClick={async (e) => {
              e.preventDefault();
              if (!("args" in parsed)) return;
              setRunning(true);
              setOutcome(await runToolNow(tool.name, parsed.args));
              setRunning(false);
            }}>
            <Play className="w-4 h-4 mr-1" /> {running ? "Running…" : "Run"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ActivityTab({ rows, error }: { rows: ActivityRow[]; error: string | null }) {
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        Could not read what agents did: {error}
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No agent has loaded a skill, run a tool, called a connection or proposed one yet.</p>;
  }
  const label: Record<string, string> = {
    "skill.load": "loaded skill", "skill.propose": "proposed skill", "tool.run": "ran tool", "tool.propose": "proposed tool",
    "connection.call": "called", "connection.propose": "proposed connection",
    "connection.secret_set": "stored a key for", "connection.secret_cleared": "cleared the key for",
  };
  return (
    <ol className="space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <Activity className={`w-4 h-4 ${r.result === "success" ? "text-muted-foreground" : "text-destructive"}`} />
          <span className="text-foreground">{who(r.actor)}</span>
          <span className="text-muted-foreground">{label[r.action] ?? r.action}</span>
          <span className="font-mono text-foreground">{activityTarget(r)}</span>
          {r.result !== "success" && <Badge variant="destructive" className="text-[11px]">{r.result}</Badge>}
          {r.details?.failed_step ? <span className="text-xs text-destructive">failed at step {String(r.details.failed_step)}</span> : null}
          {r.details?.refused ? <span className="text-xs text-destructive">refused: {String(r.details.refused)}</span> : null}
          {typeof r.details?.status === "number" ? <span className="text-xs text-muted-foreground">HTTP {r.details.status}</span> : null}
          <span className="ml-auto text-xs text-muted-foreground">{new Date(r.ts).toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

/** What an activity row was about: a skill or tool by name, a call as connection.operation. */
function activityTarget(r: ActivityRow): string {
  const d = r.details ?? {};
  if (d.connection) return d.operation ? `${String(d.connection)}.${String(d.operation)}` : String(d.connection);
  if (d.connection_id) return "a connection";
  return String(d.name ?? "");
}

function ConfirmDelete({ what, open, onCancel, onConfirm }: { what: string; open: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {what}?</AlertDialogTitle>
          <AlertDialogDescription>Agents stop seeing it at once. To keep it but switch it off, archive it instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
