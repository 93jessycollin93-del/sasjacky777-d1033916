// Agent R&D Lab — the workstation.
//
// Build agents against any of the real providers, give them a small or large
// context budget, run them for real (streaming, through the same edge
// functions the rest of Jackie uses), and export the results as portable
// assets. Nothing here is simulated: no provider, no run, no token count is
// invented — trimming and latency are measured, and failures surface as errors.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Beaker, Plus, Play, Square, Save, Trash2, Copy, Download,
  Upload, FileDown, Gauge, Sparkles, History, RotateCcw, Bot, Wrench, Radar,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PROVIDERS, findProvider, type ProviderId } from "@/lib/jackie-providers";
import { streamProviderChat, type ChatMessage } from "@/lib/jackie-provider-stream";
import {
  CONTEXT_PRESETS, type LabAgent, type RunRecord, type PromptVersion,
  listAgents, saveAgent, deleteAgent, newAgent, duplicateAgent,
  estimateTokens, fitToBudget, listRuns, recordRun, clearRuns,
  exportAgent, exportAll, exportRun, importAgentsFromFile,
  listVersions, saveVersion, deleteVersion, deleteVersionsFor, diffSummary,
} from "@/lib/agentLab";
import { installLovableAgents } from "@/lib/lovableAgents";
import { installOperatorAgents } from "@/lib/operatorAgents";
import { runAppAgent, type AgentStep } from "@/lib/appAgent";
import { executeAsUser, modelCaller } from "@/lib/appAgentRuntime";
import { discoverLocalModels, isAgentFamily, LOCAL_RUNTIMES, type LocalRuntime } from "@/lib/localModels";

const DEFAULT_PROVIDER = (PROVIDERS[0]?.id ?? "lovable") as ProviderId;
const DEFAULT_MODEL = PROVIDERS[0]?.models[0]?.id ?? "";

export default function AgentLab() {
  const [agents, setAgents] = useState<LabAgent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LabAgent | null>(null);
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [versionLabel, setVersionLabel] = useState("");
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [localFound, setLocalFound] = useState<Record<LocalRuntime, { models: string[]; error?: string }> | null>(null);
  const [detecting, setDetecting] = useState(false);

  async function detectLocal() {
    setDetecting(true);
    const found = await discoverLocalModels();
    setLocalFound(found);
    setDetecting(false);
    const total = found.lmstudio.models.length + found.ollama.models.length;
    toast({
      title: total ? `Found ${total} local model(s)` : "No local models found",
      description: total
        ? [...found.lmstudio.models, ...found.ollama.models].filter(isAgentFamily).join(", ") || "None of them are DeepSeek or Hermes builds."
        : [found.lmstudio.error, found.ollama.error].filter(Boolean).join(" "),
    });
  }

  useEffect(() => {
    const list = listAgents();
    setAgents(list);
    setRuns(listRuns());
    if (list.length) {
      setSelectedId(list[0].id);
      setDraft(list[0]);
      setVersions(listVersions(list[0].id));
    }
  }, []);

  const provider = draft ? findProvider(draft.provider) : undefined;
  const models = provider?.models ?? [];

  // Live, measured context accounting for what would actually be sent.
  const budgetInfo = useMemo(() => {
    if (!draft) return null;
    const messages: ChatMessage[] = prompt ? [{ role: "user", content: prompt }] : [];
    const fit = fitToBudget(messages, draft.system, draft.contextBudget);
    const pct = Math.min(100, Math.round((fit.tokens / Math.max(1, draft.contextBudget)) * 100));
    return { ...fit, pct, systemTokens: estimateTokens(draft.system) };
  }, [draft, prompt]);

  function select(a: LabAgent) {
    setSelectedId(a.id);
    setDraft(a);
    setOutput("");
    setVersions(listVersions(a.id));
  }

  function persist(next: LabAgent, note?: string) {
    const saved = saveAgent(next);
    setAgents(listAgents());
    setDraft(saved);
    setSelectedId(saved.id);
    if (note) toast({ title: note });
    return saved;
  }

  function create() {
    const a = newAgent(DEFAULT_PROVIDER, DEFAULT_MODEL);
    persist(a, "Agent created");
    setOutput("");
  }

  /** Seed the prebuilt Lovable AI roster — no key needed, safe to re-run. */
  function installAgents() {
    const { added, skipped } = installLovableAgents();
    const list = listAgents();
    setAgents(list);
    if (added && list[0]) select(list[0]);
    toast({
      title: added ? `Added ${added} Lovable agent${added === 1 ? "" : "s"}` : "Lovable agents already installed",
      description: skipped ? `${skipped} already present — left untouched.` : undefined,
    });
  }


  function patch(p: Partial<LabAgent>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function remove(a: LabAgent) {
    deleteAgent(a.id);
    deleteVersionsFor(a.id); // don't orphan this agent's prompt history
    setVersions([]);
    const list = listAgents();
    setAgents(list);
    if (selectedId === a.id) {
      setSelectedId(list[0]?.id ?? null);
      setDraft(list[0] ?? null);
      setOutput("");
    }
    toast({ title: `Deleted “${a.name}”` });
  }

  async function onImport(file: File) {
    try {
      const incoming = await importAgentsFromFile(file);
      incoming.forEach((a) => saveAgent(a));
      const list = listAgents();
      setAgents(list);
      if (incoming[0]) select(incoming[0]);
      toast({ title: `Imported ${incoming.length} agent${incoming.length === 1 ? "" : "s"}` });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function run() {
    if (!draft || running) return;
    const text = prompt.trim();
    if (!text) return;

    // Persist edits before running so a run always reflects a saved agent.
    const agent = persist(draft);
    const messages: ChatMessage[] = [{ role: "user", content: text }];
    const fit = fitToBudget(messages, agent.system, agent.contextBudget);

    setRunning(true);
    setOutput("");
    setSteps([]);
    stopRef.current = false;
    const started = performance.now();
    let acc = "";
    let meta: { servedBy?: string; model?: string } = {};

    const finish = (error?: string) => {
      const ms = performance.now() - started;
      recordRun({
        agentId: agent.id,
        agentName: agent.name,
        prompt: text,
        output: acc,
        servedBy: meta.servedBy,
        model: meta.model,
        ms,
        promptTokens: fit.tokens,
        droppedMessages: fit.dropped,
        error,
      });
      // recordRun already persisted + capped the history; re-read it as the source of truth.
      setRuns(listRuns());
      setRunning(false);
    };

    if (agent.canAct || agent.local) {
      // Acting agents (and any agent on a local server) run the action loop:
      // each reply may name one action, which runs as the signed-in user, and
      // the result goes back to the model until it answers. An agent without
      // app control still goes through here when local, with no actions to take.
      const controller = new AbortController();
      abortRef.current = controller;
      const where = agent.local ? LOCAL_RUNTIMES[agent.local].label : findProvider(agent.provider)?.label ?? agent.provider;
      const result = await runAppAgent({
        system: agent.system,
        prompt: text,
        callModel: modelCaller(
          { provider: agent.provider, model: agent.model, local: agent.local, fallback: agent.fallback },
          controller.signal,
        ),
        execute: executeAsUser,
        allowDestructive: !!agent.allowDestructive,
        canAct: !!agent.canAct,
        maxSteps: 8,
        signal: controller.signal,
        onStep: (step) => setSteps((prev) => [...prev, step]),
      });
      abortRef.current = null;
      acc = result.answer;
      setOutput(result.answer || result.error || "");
      meta = { servedBy: where, model: agent.model };
      if (!result.ok) toast({ title: "Run failed", description: result.error, variant: "destructive" });
      finish(result.ok ? undefined : result.error);
      return;
    }

    await streamProviderChat({
      provider: agent.provider,
      model: agent.model,
      messages: fit.messages,
      system: agent.system,
      fallback: agent.fallback,
      onDelta: (t) => {
        if (stopRef.current) return;
        acc += t;
        setOutput(acc);
      },
      onFallback: (from, to, reason) =>
        toast({ title: `Fell back: ${from} → ${to}`, description: reason }),
      onDone: (m) => {
        meta = { servedBy: m?.servedBy, model: m?.model };
        finish();
      },
      onError: (e) => {
        toast({ title: "Run failed", description: e, variant: "destructive" });
        finish(e);
      },
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-sidebar">
        <Link to="/" className="flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft size={14} /> Jackie
        </Link>
        <Beaker size={14} className="text-primary" />
        <span className="font-mono text-xs uppercase tracking-widest">Agent R&amp;D Lab</span>
        <div className="flex-1" />
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload size={13} className="mr-1" /> Import
        </Button>
        <Button variant="outline" size="sm" disabled={!agents.length} onClick={() => exportAll(agents)}>
          <Download size={13} className="mr-1" /> Export all
        </Button>
        <Button variant="outline" size="sm" onClick={installAgents}>
          <Bot size={13} className="mr-1" /> Add Lovable agents
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const { added, skipped } = installOperatorAgents();
            const list = listAgents();
            setAgents(list);
            toast({
              title: added ? `Added ${added} DeepSeek & Hermes operator(s)` : "Operators already installed",
              description: skipped ? `${skipped} already in the lab were left as they are.` : "They can act on your tasks, memory and conversations.",
            });
          }}
        >
          <Wrench size={13} className="mr-1" /> Add DeepSeek &amp; Hermes operators
        </Button>
        <Button size="sm" onClick={create}>
          <Plus size={13} className="mr-1" /> New agent
        </Button>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Roster */}
        <aside className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground px-1">
            Agents · {agents.length}
          </div>
          {!agents.length && (
            <Card className="p-4 text-xs text-muted-foreground">
              No agents yet. <button className="text-primary underline" onClick={create}>Create one</button> or import a bundle.
            </Card>
          )}
          {agents.map((a) => (
            <Card
              key={a.id}
              onClick={() => select(a)}
              className={cn(
                "p-3 cursor-pointer transition-colors hover:bg-secondary/50",
                selectedId === a.id && "border-primary",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold truncate">{a.name}</span>
                <Badge variant="outline" className="ml-auto text-[9px] shrink-0">
                  {(a.contextBudget / 1000).toFixed(0)}k
                </Badge>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground truncate">
                {findProvider(a.provider)?.label ?? a.provider} · {a.model.split("/").pop()}
              </div>
              {a.role && <div className="mt-1 text-[10px] text-muted-foreground/80 truncate">{a.role}</div>}
            </Card>
          ))}
        </aside>

        {/* Bench */}
        <main className="space-y-4 min-w-0">
          {!draft ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Select an agent, or create one to start.
            </Card>
          ) : (
            <>
              <Card className="p-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Name</Label>
                    <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Role / purpose</Label>
                    <Input value={draft.role} placeholder="e.g. literature triage" onChange={(e) => patch({ role: e.target.value })} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Provider</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draft.provider}
                      onChange={(e) => {
                        const pid = e.target.value as ProviderId;
                        patch({ provider: pid, model: findProvider(pid)?.models[0]?.id ?? "" });
                      }}
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}{p.tier !== "default" ? ` · ${p.tier}` : ""}
                        </option>
                      ))}
                    </select>
                    {provider?.requiresSecret && (
                      <p className="text-[10px] text-muted-foreground">
                        Needs the <code>{provider.requiresSecret}</code> secret. Without it this provider errors — turn on fallback below.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Model</Label>
                    {draft.local ? (
                      <>
                        <Input
                          list="agentlab-local-models"
                          value={draft.model}
                          placeholder="model name as the local server lists it"
                          onChange={(e) => patch({ model: e.target.value })}
                        />
                        <datalist id="agentlab-local-models">
                          {(localFound?.[draft.local].models ?? []).map((m) => <option key={m} value={m} />)}
                        </datalist>
                      </>
                    ) : (
                      <select
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={draft.model}
                        onChange={(e) => patch({ model: e.target.value })}
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}{m.free ? " · free" : ""}{m.reasoning ? " · reasoning" : ""}
                            {m.note ? ` · ${m.note}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Where the model runs, and whether the agent may act on the app */}
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Runs on</Label>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      value={draft.local ?? ""}
                      onChange={(e) => {
                        const local = (e.target.value || undefined) as LocalRuntime | undefined;
                        patch({ local, ...(local ? { fallback: false } : {}) });
                      }}
                    >
                      <option value="">{provider?.label ?? "Provider"} (edge function)</option>
                      <option value="lmstudio">{LOCAL_RUNTIMES.lmstudio.label}</option>
                      <option value="ollama">{LOCAL_RUNTIMES.ollama.label}</option>
                    </select>
                    <Button type="button" variant="outline" size="sm" disabled={detecting} onClick={detectLocal}>
                      <Radar size={13} className="mr-1" /> {detecting ? "Detecting…" : "Detect local models"}
                    </Button>
                  </div>
                  {localFound && (
                    <div className="space-y-1 text-[10px] text-muted-foreground">
                      {(["lmstudio", "ollama"] as const).map((rt) => (
                        <div key={rt} className="flex flex-wrap items-center gap-1">
                          <span className="font-mono">{LOCAL_RUNTIMES[rt].label}:</span>
                          {localFound[rt].models.length ? (
                            localFound[rt].models.map((m) => (
                              <button
                                key={m}
                                type="button"
                                className={cn(
                                  "rounded-sm border px-1.5 py-0.5 font-mono",
                                  isAgentFamily(m) ? "border-primary text-primary" : "border-border",
                                )}
                                onClick={() => patch({ local: rt, model: m, fallback: false })}
                              >
                                {m}
                              </button>
                            ))
                          ) : (
                            <span>{localFound[rt].error ?? "nothing loaded"}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch checked={!!draft.canAct} onCheckedChange={(v) => patch({ canAct: v })} id="act" />
                      <Label htmlFor="act" className="text-xs text-muted-foreground">
                        App control — may change your tasks, memory and conversations
                      </Label>
                    </div>
                    {draft.canAct && (
                      <div className="flex items-center gap-2">
                        <Switch checked={!!draft.allowDestructive} onCheckedChange={(v) => patch({ allowDestructive: v })} id="del" />
                        <Label htmlFor="del" className="text-xs text-muted-foreground">Allow deletes</Label>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">System prompt</Label>
                  <Textarea
                    rows={4}
                    value={draft.system}
                    onChange={(e) => patch({ system: e.target.value })}
                    className="font-mono text-xs"
                  />
                </div>

                {/* Context budget — small ↔ large, with real accounting */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Gauge size={13} className="text-primary" />
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Context budget</Label>
                    <span className="ml-auto font-mono text-xs">
                      {draft.contextBudget.toLocaleString()} tok
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CONTEXT_PRESETS.map((p) => (
                      <Button
                        key={p.label}
                        type="button"
                        size="sm"
                        variant={draft.contextBudget === p.tokens ? "default" : "outline"}
                        title={p.hint}
                        onClick={() => patch({ contextBudget: p.tokens })}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                  {budgetInfo && (
                    <>
                      <Progress value={budgetInfo.pct} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground">
                        ~{budgetInfo.tokens.toLocaleString()} of {draft.contextBudget.toLocaleString()} tokens used
                        (system ~{budgetInfo.systemTokens.toLocaleString()}) · estimate, ~4 chars/token
                        {budgetInfo.dropped > 0 && ` · ${budgetInfo.dropped} older message(s) would be trimmed`}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch checked={draft.fallback} onCheckedChange={(v) => patch({ fallback: v })} id="fb" />
                    <Label htmlFor="fb" className="text-xs text-muted-foreground">Auto-fallback to other providers</Label>
                  </div>
                  <div className="flex-1" />
                  <Button variant="outline" size="sm" onClick={() => persist(draft, "Saved")}>
                    <Save size={13} className="mr-1" /> Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => persist(duplicateAgent(draft), "Duplicated")}>
                    <Copy size={13} className="mr-1" /> Duplicate
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportAgent(draft)}>
                    <FileDown size={13} className="mr-1" /> Export
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive" onClick={() => remove(draft)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Card>

              {/* Bench run */}
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-primary" />
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Bench</Label>
                </div>
                <Textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Give the agent a task — this runs for real against the selected provider."
                />
                <div className="flex items-center gap-2">
                  {running ? (
                    <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; abortRef.current?.abort(); }}>
                      <Square size={13} className="mr-1" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" disabled={!prompt.trim()} onClick={run}>
                      <Play size={13} className="mr-1" /> Run
                    </Button>
                  )}
                  {running && <span className="font-mono text-[10px] text-muted-foreground animate-pulse">streaming…</span>}
                </div>
                {steps.length > 0 && (
                  <div className="space-y-1">
                    {steps.map((st, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-sm border px-2 py-1 font-mono text-[10px] break-words",
                          st.result.ok ? "border-border" : "border-destructive/50 text-destructive",
                        )}
                      >
                        <span className="text-primary">{i + 1}. {st.tool}</span> {JSON.stringify(st.args)}
                        {" → "}
                        {st.result.ok ? JSON.stringify(st.result.data).slice(0, 160) : st.result.error}
                      </div>
                    ))}
                  </div>
                )}
                {(output || running) && (
                  <div className="rounded-md bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words max-h-80 overflow-y-auto">
                    {output || (running && draft.canAct ? "working…" : "…")}
                  </div>
                )}
              </Card>

              {/* Prompt versions — the prompt-engineering loop */}
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <History size={13} className="text-primary" />
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Prompt versions · {versions.length}
                  </Label>
                </div>
                <div className="flex gap-2">
                  <Input
                    value={versionLabel}
                    onChange={(e) => setVersionLabel(e.target.value)}
                    placeholder="label this version — e.g. 'added evidence rule'"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      saveVersion(draft.id, versionLabel, draft.system);
                      setVersionLabel("");
                      setVersions(listVersions(draft.id));
                      toast({ title: "Version saved" });
                    }}
                  >
                    <Save size={13} className="mr-1" /> Snapshot
                  </Button>
                </div>
                {!versions.length && (
                  <p className="text-[10px] text-muted-foreground">
                    No versions yet. Snapshot a prompt before you change it, so you can always get back to the one that worked.
                  </p>
                )}
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {versions.map((v) => {
                    const d = diffSummary(v.system, draft.system);
                    const current = d.added === 0 && d.removed === 0;
                    return (
                      <div key={v.id} className="flex items-center gap-2 rounded-sm bg-muted/20 px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px]">{v.label}</div>
                          <div className="text-[9px] text-muted-foreground">
                            {new Date(v.at).toLocaleString()} · ~{estimateTokens(v.system)} tok ·{" "}
                            {current ? (
                              <span className="text-primary">matches current prompt</span>
                            ) : (
                              <>vs current: +{d.added} −{d.removed} chars</>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Restore this prompt into the editor"
                          disabled={current}
                          onClick={() => {
                            patch({ system: v.system });
                            toast({ title: `Restored “${v.label}”`, description: "Save the agent to keep it." });
                          }}
                        >
                          <RotateCcw size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Delete version"
                          onClick={() => {
                            deleteVersion(v.id);
                            setVersions(listVersions(draft.id));
                          }}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* R&D notes */}
              <Card className="p-4 space-y-2">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">R&amp;D notes</Label>
                <Textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => patch({ notes: e.target.value })}
                  onBlur={() => persist(draft)}
                  placeholder="Findings, prompt iterations, what worked and what didn't…"
                  className="text-xs"
                />
              </Card>

              {/* Run history */}
              <Card className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Run history · {runs.length}
                  </Label>
                  {runs.length > 0 && (
                    <Button variant="ghost" size="sm" className="ml-auto text-[10px]" onClick={() => { clearRuns(); setRuns([]); }}>
                      Clear
                    </Button>
                  )}
                </div>
                {!runs.length && <p className="text-[10px] text-muted-foreground">No runs yet.</p>}
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {runs.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 rounded-sm bg-muted/20 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[11px]">
                          {r.error ? <span className="text-destructive">⚠ </span> : null}
                          {r.agentName} — {r.prompt.slice(0, 60)}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {new Date(r.at).toLocaleTimeString()} · {(r.ms / 1000).toFixed(2)}s
                          {r.servedBy ? ` · ${r.servedBy}` : ""} · ~{r.promptTokens} tok
                          {r.droppedMessages ? ` · ${r.droppedMessages} trimmed` : ""}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" title="Export transcript (.md)" onClick={() => exportRun(r)}>
                        <FileDown size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
