// Agent Compare — the R&D loop: one prompt, many agents, side by side.
//
// Every lane is a real streaming call through the provider edge functions, run
// in parallel. Latency is measured wall-clock, "served by" is whatever actually
// answered (which may differ from the configured provider when fallback kicks
// in), and failures are shown as failures rather than quietly dropped.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Columns3, Play, Square, FileDown, Beaker, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { findProvider } from "@/lib/jackie-providers";
import { streamProviderChat, type ChatMessage } from "@/lib/jackie-provider-stream";
import {
  type LabAgent, type ComparisonLane,
  listAgents, fitToBudget, recordRun, exportComparison,
} from "@/lib/agentLab";

type Lane = ComparisonLane & {
  agentId: string;
  running: boolean;
  dropped: number;
};

export default function AgentCompare() {
  const [agents, setAgents] = useState<LabAgent[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    const list = listAgents();
    setAgents(list);
    setPicked(list.slice(0, 3).map((a) => a.id));
  }, []);

  const chosen = useMemo(
    () => agents.filter((a) => picked.includes(a.id)),
    [agents, picked],
  );

  // Fastest successful lane — only meaningful once runs have finished.
  const fastestId = useMemo(() => {
    const done = lanes.filter((l) => !l.running && !l.error && typeof l.ms === "number");
    if (done.length < 2) return null;
    return done.reduce((a, b) => ((a.ms ?? Infinity) < (b.ms ?? Infinity) ? a : b)).agentId;
  }, [lanes]);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function runAll() {
    const text = prompt.trim();
    if (!text || running || !chosen.length) return;

    stopRef.current = false;
    setRunning(true);

    const initial: Lane[] = chosen.map((a) => {
      const fit = fitToBudget([{ role: "user", content: text }], a.system, a.contextBudget);
      return {
        agentId: a.id,
        agentName: a.name,
        provider: findProvider(a.provider)?.label ?? a.provider,
        model: a.model,
        contextBudget: a.contextBudget,
        output: "",
        promptTokens: fit.tokens,
        dropped: fit.dropped,
        running: true,
      };
    });
    setLanes(initial);

    const update = (id: string, patch: Partial<Lane>) =>
      setLanes((ls) => ls.map((l) => (l.agentId === id ? { ...l, ...patch } : l)));

    await Promise.all(
      chosen.map(
        (agent) =>
          new Promise<void>((resolve) => {
            const messages: ChatMessage[] = [{ role: "user", content: text }];
            const fit = fitToBudget(messages, agent.system, agent.contextBudget);
            const started = performance.now();
            let acc = "";
            let meta: { servedBy?: string; model?: string } = {};

            const settle = (error?: string) => {
              const ms = performance.now() - started;
              update(agent.id, {
                running: false,
                ms,
                error,
                servedBy: meta.servedBy,
                servedModel: meta.model,
              });
              // Comparison runs land in the same history as bench runs.
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
              resolve();
            };

            streamProviderChat({
              provider: agent.provider,
              model: agent.model,
              messages: fit.messages,
              system: agent.system,
              fallback: agent.fallback,
              onDelta: (t) => {
                if (stopRef.current) return;
                acc += t;
                update(agent.id, { output: acc });
              },
              onDone: (m) => {
                meta = { servedBy: m?.servedBy, model: m?.model };
                settle();
              },
              onError: (e) => settle(e),
            });
          }),
      ),
    );

    setRunning(false);
  }

  const finished = lanes.length > 0 && lanes.every((l) => !l.running);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-sidebar">
        <Link to="/" className="flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft size={14} /> Jackie
        </Link>
        <Columns3 size={14} className="text-primary" />
        <span className="font-mono text-xs uppercase tracking-widest">Agent Compare</span>
        <div className="flex-1" />
        <Link to="/agent-lab">
          <Button variant="outline" size="sm">
            <Beaker size={13} className="mr-1" /> Lab
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          disabled={!finished}
          onClick={() => exportComparison(prompt, lanes)}
          title="Download this comparison as a Markdown report"
        >
          <FileDown size={13} className="mr-1" /> Export report
        </Button>
      </header>

      <div className="p-4 space-y-4">
        {!agents.length ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No agents yet — build some in the{" "}
            <Link to="/agent-lab" className="text-primary underline">Agent R&amp;D Lab</Link> first.
          </Card>
        ) : (
          <>
            <Card className="p-4 space-y-3">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Agents in this run · {chosen.length} selected
              </Label>
              <div className="flex flex-wrap gap-2">
                {agents.map((a) => (
                  <label
                    key={a.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors",
                      picked.includes(a.id) ? "border-primary bg-secondary/40" : "border-border hover:bg-secondary/20",
                    )}
                  >
                    <Checkbox checked={picked.includes(a.id)} onCheckedChange={() => toggle(a.id)} />
                    <span className="font-mono text-xs">{a.name}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {(a.contextBudget / 1000).toFixed(0)}k
                    </Badge>
                  </label>
                ))}
              </div>

              <Textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="One prompt, run across every selected agent — the same question, different brains."
              />

              <div className="flex items-center gap-2">
                {running ? (
                  <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>
                    <Square size={13} className="mr-1" /> Stop
                  </Button>
                ) : (
                  <Button size="sm" disabled={!prompt.trim() || !chosen.length} onClick={runAll}>
                    <Play size={13} className="mr-1" /> Run {chosen.length || ""} side by side
                  </Button>
                )}
                {running && (
                  <span className="font-mono text-[10px] text-muted-foreground animate-pulse">
                    running {lanes.filter((l) => l.running).length} of {lanes.length}…
                  </span>
                )}
              </div>
            </Card>

            {lanes.length > 0 && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))` }}
              >
                {lanes.map((l) => (
                  <Card key={l.agentId} className={cn("p-3 flex flex-col", fastestId === l.agentId && "border-primary")}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold truncate">{l.agentName}</span>
                      {fastestId === l.agentId && (
                        <Trophy size={12} className="text-primary shrink-0" aria-label="Fastest" />
                      )}
                      <Badge variant="outline" className="ml-auto text-[9px] shrink-0">
                        {l.running ? "running" : l.error ? "failed" : "done"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {l.provider} · {l.model.split("/").pop()}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      ~{l.promptTokens} tok in
                      {l.dropped ? ` · ${l.dropped} trimmed` : ""}
                      {typeof l.ms === "number" ? ` · ${(l.ms / 1000).toFixed(2)}s` : ""}
                      {l.servedBy && l.servedBy !== l.provider ? ` · served by ${l.servedBy}` : ""}
                    </div>
                    <div className="mt-2 flex-1 rounded-md bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
                      {l.error ? (
                        <span className="text-destructive">⚠ {l.error}</span>
                      ) : (
                        l.output || (l.running ? "…" : "(empty)")
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
