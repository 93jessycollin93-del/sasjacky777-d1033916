import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ModelSelector } from "@/components/microai/ModelSelector";
import { BackendPicker } from "@/components/microai/BackendPicker";
import { ModelChatPanel } from "@/components/microai/ModelChatPanel";
import { ChatHistoryPanel } from "@/components/microai/ChatHistoryPanel";
import { CHAT_BACKENDS, findBackend, defaultModelOf } from "@/lib/microai/chatBackends";
import { listThreads, threadKey, type ChatThread } from "@/lib/microai/chatHistory";
import { PerfMonitor } from "@/components/microai/PerfMonitor";
import { routeMicroPrompt, readMicroLog, clearMicroLog, type MicroRunMetrics, type MicroLogEntry } from "@/lib/microai/router";
import { readSettings, writeSettings } from "@/lib/microai/settings";
import { Terminal, Brain, Trash2, ClipboardPaste, CircleDot } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { findModel } from "@/lib/microai/models";

interface TermLine { role: "in" | "out" | "sys"; text: string; }

export default function MicroAI() {
  const { toast } = useToast();
  const initial = readSettings();
  const [activeModel, setActiveModel] = useState<string>(initial.modelId);
  const [seedling, setSeedling] = useState<boolean>(initial.seedling);
  const [autoFold, setAutoFold] = useState<boolean>(initial.autoFold);
  const [temperature, setTemperature] = useState<number>(initial.temperature);
  const [maxTokens, setMaxTokens] = useState<number>(initial.maxTokens);
  const [termInput, setTermInput] = useState("");
  const [termLines, setTermLines] = useState<TermLine[]>([{ role: "sys", text: `micro terminal ready. active: ${initial.modelId} · temp ${initial.temperature} · ${initial.maxTokens} tokens · Seedling lock: ${initial.seedling ? "ON" : "OFF"}.` }]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [folding, setFolding] = useState(false);
  const [metrics, setMetrics] = useState<MicroRunMetrics | null>(null);
  const [log, setLog] = useState<MicroLogEntry[]>(() => readMicroLog());
  const termRef = useRef<HTMLDivElement>(null);

  // The chat picker is its own selection: the device model above drives the
  // terminal and assistant, while this drives the chat panel, and collapsing
  // them would make choosing Groq silently change what the terminal runs.
  const [chatBackendId, setChatBackendId] = useState<string>(() => {
    try {
      return localStorage.getItem("jacky.microai.chatBackend") ?? CHAT_BACKENDS[0].id;
    } catch {
      return CHAT_BACKENDS[0].id;
    }
  });
  const [chatModelId, setChatModelId] = useState<string>(() => {
    try {
      return localStorage.getItem("jacky.microai.chatModel") ?? defaultModelOf(CHAT_BACKENDS[0]);
    } catch {
      return defaultModelOf(CHAT_BACKENDS[0]);
    }
  });
  const [threads, setThreads] = useState<ChatThread[]>(() => listThreads());

  const refreshThreads = () => setThreads(listThreads());

  const pickChat = (backendId: string, modelId: string) => {
    const backend = findBackend(backendId);
    const model = modelId || defaultModelOf(backend);
    setChatBackendId(backend.id);
    setChatModelId(model);
    try {
      localStorage.setItem("jacky.microai.chatBackend", backend.id);
      localStorage.setItem("jacky.microai.chatModel", model);
    } catch {
      /* the choice holds for this session even if it cannot be remembered */
    }
  };

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [termLines]);

  const locked = seedling;

  useEffect(() => {
    writeSettings({ modelId: activeModel, temperature, maxTokens, seedling, autoFold });
  }, [activeModel, temperature, maxTokens, seedling, autoFold]);

  const switchModel = (id: string) => {
    if (locked) return;
    setActiveModel(id);
    setTermLines(l => [...l, { role: "sys", text: `active model → ${id} (saved)` }]);
  };

  const toggleSeedling = (on: boolean) => {
    setSeedling(on);
    setTermLines(l => [...l, { role: "sys", text: `Seedling lock: ${on ? "ON — terminal + switching locked" : "OFF"}` }]);
  };

  const runTerminal = async (raw?: string) => {
    const cmd = (raw ?? termInput).trim();
    if (!cmd || busy || locked) return;
    setBusy(true);
    setTermLines(l => [...l, { role: "in", text: cmd }]);
    setTermInput("");
    const res = await routeMicroPrompt(cmd, activeModel, undefined, { temperature, maxTokens });
    setMetrics(res.metrics);
    setLog(readMicroLog());
    setTermLines(l => [...l, { role: res.metrics.error ? "sys" : "out", text: res.metrics.error ? `error: ${res.metrics.error}` : res.text || "(empty response)" }]);
    setBusy(false);
    if (autoFold && !res.metrics.error && res.text.trim()) {
      await foldAnswer(cmd, res.text, "/micro terminal", true);
    }
  };

  const quickPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setTermInput(text.trim());
        toast({ title: "Pasted", description: "Clipboard loaded into terminal." });
      }
    } catch {
      toast({ title: "Clipboard blocked", description: "Grant clipboard permission to quick-paste.", variant: "destructive" });
    }
  };

  const runAssistant = async () => {
    const q = assistantInput.trim();
    if (!q || busy) return;
    setBusy(true);
    setAssistantReply("");
    const res = await routeMicroPrompt(q, activeModel,
      "You are Jacky, a small local assistant. Answer briefly and factually. Never claim to modify files; describe steps only. Confirmation is required before any file write.",
      { temperature, maxTokens });
    setMetrics(res.metrics);
    setLog(readMicroLog());
    setAssistantReply(res.metrics.error ? `⚠ ${res.metrics.error}` : res.text);
    setBusy(false);
    if (autoFold && !res.metrics.error && res.text.trim()) {
      await foldAnswer(q, res.text, "/micro assistant", true);
    }
  };

  /** Fold an answer into the shared knowledge circle at /pods/surface. */
  const foldAnswer = async (question: string, answer: string, origin: string, quiet = false) => {
    const text = answer.trim();
    if (!text || text.startsWith("\u26a0")) return;
    setFolding(true);
    const model = findModel(activeModel);
    const { data, error } = await supabase.functions.invoke("pod-fold", {
      body: {
        text: `Q: ${question.trim()}\n\nA: ${text}`,
        capability: `micro:${model.id}`.slice(0, 60),
        source_ref: `${origin} · ${model.name} · temp ${temperature} · ${maxTokens} tokens`,
        color: "#22d3ee",
        glyph: "\u25c8",
      },
    });
    setFolding(false);
    if (error) {
      if (!quiet) toast({ title: "Fold failed", description: error.message, variant: "destructive" });
      else setTermLines(l => [...l, { role: "sys", text: `circle: fold failed — ${error.message}` }]);
      return;
    }
    const hash = String((data as { source_hash?: string } | null)?.source_hash ?? "").slice(0, 12);
    if (quiet) {
      setTermLines(l => [...l, { role: "sys", text: `circle: answer folded (${hash}…)` }]);
    } else {
      toast({
        title: "Folded into the circle",
        description: `${model.name}'s answer is now one point on /pods/surface (${hash}…).`,
      });
    }
  };

  const foldReply = () => foldAnswer(assistantInput, assistantReply, "/micro assistant");

  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl text-foreground">🧬 Jacky Micro-AI</h1>
          <p className="text-xs text-muted-foreground">Local micro-LLMs via LM Studio / Ollama at localhost:11434</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-muted-foreground">Seedling {seedling ? "ON" : "OFF"}</span>
          <Switch checked={seedling} onCheckedChange={toggleSeedling} />
          <Badge variant="outline" className="text-[10px] font-mono">active: {activeModel}</Badge>
          <Button size="sm" variant="outline" className="min-h-11" asChild>
            <Link to="/micro/board" className="text-[11px]">Compare models</Link>
          </Button>
        </div>
      </div>

      {/* The full picker. Every engine this app can reach, in one place, so
          choosing between the device, the operator's own grounded engine and
          the cloud no longer means changing screens. */}
      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider">Chat with any engine</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <BackendPicker
            backendId={chatBackendId}
            modelId={chatModelId}
            onChange={pickChat}
            disabled={locked}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ModelChatPanel
            key={threadKey(chatBackendId, chatModelId)}
            backendId={chatBackendId}
            modelId={chatModelId}
            onActivity={refreshThreads}
          />
        </div>
        <ChatHistoryPanel
          threads={threads}
          activeKey={threadKey(chatBackendId, chatModelId)}
          onOpen={pickChat}
          onCleared={refreshThreads}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <ModelSelector activeModel={activeModel} locked={locked} onSelect={switchModel} />

          <Card className="bg-card/80 border-border/40">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs font-mono uppercase tracking-wider">Model Settings (saved)</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span>temperature</span><span className="text-foreground">{temperature.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0} max={2} step={0.05} value={temperature}
                  disabled={locked}
                  onChange={e => setTemperature(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                  <span>max tokens</span><span className="text-foreground">{maxTokens}</span>
                </div>
                <input
                  type="range" min={32} max={2048} step={32} value={maxTokens}
                  disabled={locked}
                  onChange={e => setMaxTokens(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 p-2">
                <div>
                  <p className="text-[11px] font-mono text-foreground">Share answers to the circle</p>
                  <p className="text-[10px] text-muted-foreground">Every answer is folded into /pods/surface automatically.</p>
                </div>
                <Switch checked={autoFold} onCheckedChange={setAutoFold} />
              </div>
              <p className="text-[10px] text-muted-foreground">Model, temperature, max tokens, sharing and the Seedling lock are remembered on this device.</p>
            </CardContent>
          </Card>

          <PerfMonitor metrics={metrics} />
        </div>

        <Card className="bg-card/80 border-border/40 lg:col-span-1 flex flex-col">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-primary" /> Micro Terminal
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 flex flex-col flex-1 gap-2 min-h-0">
            <div ref={termRef} className="flex-1 overflow-y-auto rounded-md bg-muted/30 border border-border/40 p-2 font-mono text-[11px] space-y-1 min-h-[220px] max-h-[320px]">
              {termLines.map((l, i) => (
                <div key={i} className={l.role === "in" ? "text-primary" : l.role === "out" ? "text-foreground" : "text-muted-foreground italic"}>
                  {l.role === "in" ? "❯ " : l.role === "out" ? "◈ " : "· "}{l.text}
                </div>
              ))}
              {busy && <div className="text-muted-foreground animate-pulse">◈ thinking…</div>}
            </div>
            <div className="flex gap-2">
              <Input
                value={termInput}
                onChange={e => setTermInput(e.target.value)}
                placeholder={locked ? "Seedling ON — locked" : "Send to micro model…"}
                disabled={locked || busy}
                className="text-xs font-mono"
                onKeyDown={e => { if (e.key === "Enter") runTerminal(); }}
              />
              <Button size="sm" variant="outline" onClick={quickPaste} disabled={locked || busy} title="Quick-paste from clipboard">
                <ClipboardPaste className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" onClick={() => runTerminal()} disabled={locked || busy || !termInput.trim()}>
                {busy ? "…" : "Run"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/80 border-border/40 flex flex-col">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-primary" /> Assistant
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 flex flex-col flex-1 gap-2">
            <Textarea
              value={assistantInput}
              onChange={e => setAssistantInput(e.target.value)}
              placeholder="Short reasoning, code explanation, or repair question…"
              className="min-h-[70px] text-xs"
              disabled={busy}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={runAssistant} disabled={busy || !assistantInput.trim()}>
                {busy ? "Thinking…" : "Ask"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={foldReply}
                disabled={folding || !assistantReply || assistantReply.startsWith("⚠")}
                title="Add this answer to the shared knowledge circle"
              >
                <CircleDot className="h-3.5 w-3.5 mr-1" /> {folding ? "Folding…" : "Fold into circle"}
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to="/pods/surface" className="text-[11px]">Open circle</Link>
              </Button>
            </div>
            <div className="rounded-md bg-muted/30 border border-border/40 p-2 text-[12px] text-foreground whitespace-pre-wrap min-h-[120px]">
              {assistantReply || <span className="text-muted-foreground">Assistant replies here. It never writes files without your confirmation.</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2 flex-row items-center justify-between">
          <CardTitle className="text-xs font-mono uppercase tracking-wider">Interaction Log ({log.length})</CardTitle>
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { clearMicroLog(); setLog([]); }}>
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        </CardHeader>
        <CardContent className="p-3 pt-0 max-h-48 overflow-y-auto">
          {log.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No interactions logged yet.</p>
          ) : (
            <div className="space-y-1 font-mono text-[10px]">
              {[...log].reverse().slice(0, 30).map((e, i) => (
                <div key={i} className="border-b border-border/20 pb-1">
                  <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>{" "}
                  <span className="text-primary">{e.model}</span>
                  {e.fellBack && <span className="text-amber-500"> [fallback]</span>}
                  {e.error && <span className="text-destructive"> [err]</span>}
                  <span className="text-muted-foreground"> — {e.latencyMs.toFixed(0)}ms</span>
                  <div className="text-foreground/70 truncate">❯ {e.prompt}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
