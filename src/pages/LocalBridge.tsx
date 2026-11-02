import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AGENT_SCRIPT, DEFAULT_CONFIG, execOnBridge, isLoopback, isReadOnlyCommand,
  listPathOnBridge, loadBridgeConfig, pingBridge, saveBridgeConfig, suggestConclusion,
  type BridgeConfig, type BridgeStatus, type ExecResult,
} from "@/lib/repair/localBridge";
import {
  RUNNERS, buildConversionPlan, discoveryCommands, findDuplicates, findRunner,
  fromBridgeEntries, humanSize, modelEstateBrief, parseGgufListing, parseOllamaList,
  type LocalModel, type Platform, type RunnerId,
} from "@/lib/repair/modelBridge";
import {
  loadEvidence, saveEvidence, newEvidenceId, downloadFile,
  type EvidenceEntry,
} from "@/lib/repair/evidenceLog";
import CustodyPanel from "@/components/repair/CustodyPanel";
import BootPanel from "@/components/repair/BootPanel";
import BootStatusPanel from "@/components/repair/BootStatusPanel";
import ConversionWizard from "@/components/repair/ConversionWizard";
import { statusCommand } from "@/lib/repair/bootEntries";

type Tab = "terminal" | "models" | "wizard" | "custody" | "boot" | "bootstatus" | "setup";

const TABS: { id: Tab; label: string }[] = [
  { id: "terminal", label: "Terminal" },
  { id: "models", label: "Model Vault" },
  { id: "wizard", label: "Conversion Wizard" },
  { id: "custody", label: "Custody & Backup" },
  { id: "boot", label: "Jackie Boot" },
  { id: "bootstatus", label: "Boot Entry Status" },
  { id: "setup", label: "Bridge Setup" },
];


const MODELS_KEY = "jackie.bridge.models.v1";

function copy(text: string, label = "Copied") {
  navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("Clipboard blocked — select and copy manually"),
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function CommandRow({ title, command, note, onRun }: { title: string; command: string; note?: string; onRun?: (c: string) => void }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-sm font-medium">{title}</p>
      <Mono>{command}</Mono>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="min-h-11" onClick={() => copy(command, "Command copied")}>
          Copy
        </Button>
        {onRun && (
          <Button size="sm" className="min-h-11" onClick={() => onRun(command)}>
            Run on bridge
          </Button>
        )}
      </div>
    </div>
  );
}

export default function LocalBridge() {
  const [tab, setTab] = useState<Tab>("terminal");
  const [cfg, setCfg] = useState<BridgeConfig>(() => loadBridgeConfig());
  const [status, setStatus] = useState<BridgeStatus>({ state: "unknown" });
  const [checking, setChecking] = useState(false);

  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<ExecResult[]>([]);
  const [autoLog, setAutoLog] = useState(true);

  const [models, setModels] = useState<LocalModel[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(MODELS_KEY) || "[]") as LocalModel[];
    } catch {
      return [];
    }
  });
  const [pasteOllama, setPasteOllama] = useState("");
  const [pasteGguf, setPasteGguf] = useState("");
  const [pasteSource, setPasteSource] = useState<RunnerId>("lmstudio");
  const [scanPath, setScanPath] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [target, setTarget] = useState<RunnerId>("ollama");

  const platform: Platform = useMemo(() => {
    if (status.state === "online") return status.platform === "win32" ? "windows" : "linux";
    return /win/i.test(navigator.platform || navigator.userAgent) ? "windows" : "linux";
  }, [status]);

  useEffect(() => {
    saveBridgeConfig(cfg);
  }, [cfg]);

  useEffect(() => {
    try {
      localStorage.setItem(MODELS_KEY, JSON.stringify(models));
    } catch {
      /* quota */
    }
  }, [models]);

  const check = async () => {
    setChecking(true);
    setStatus(await pingBridge(cfg));
    setChecking(false);
  };

  useEffect(() => {
    if (cfg.token) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logEvidence = (r: ExecResult) => {
    const s = suggestConclusion(r);
    const entry: EvidenceEntry = {
      id: newEvidenceId(),
      ts: r.startedAt,
      command: r.command,
      context: `Local bridge · ${r.shell}${status.state === "online" ? ` on ${status.host}` : ""}`,
      output: [r.stdout, r.stderr].filter(Boolean).join("\n--- stderr ---\n").slice(0, 20000),
      conclusion: s.conclusion,
      status: s.status,
    };
    saveEvidence([entry, ...loadEvidence()]);
  };

  const run = async (raw?: string) => {
    const cmd = (raw ?? command).trim();
    if (!cmd) return;
    if (status.state !== "online") {
      toast.error("Bridge is not connected — check Bridge Setup first");
      setTab("setup");
      return;
    }
    if (cfg.confirmWrites && !isReadOnlyCommand(cmd)) {
      const ok = window.confirm(
        `This is not a read-only command. It will run on ${status.state === "online" ? status.host : "your machine"} with your privileges:\n\n${cmd}\n\nRun it?`,
      );
      if (!ok) return;
    }
    setRunning(true);
    try {
      const r = await execOnBridge(cfg, cmd, { cwd: cwd || undefined });
      setHistory((h) => [r, ...h].slice(0, 50));
      if (autoLog) logEvidence(r);
      if (r.exitCode !== 0) toast.warning(`Exit ${r.exitCode}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Command failed");
      void check();
    } finally {
      setRunning(false);
    }
  };

  /** Runs a command and hands the result back — used by automated verification. */
  const execForResult = async (cmd: string): Promise<ExecResult | null> => {
    if (status.state !== "online") {
      toast.error("Bridge is not connected — check Bridge Setup first");
      setTab("setup");
      return null;
    }
    setRunning(true);
    try {
      const r = await execOnBridge(cfg, cmd, { cwd: cwd || undefined });
      setHistory((h) => [r, ...h].slice(0, 50));
      if (autoLog) logEvidence(r);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Command failed");
      void check();
      return null;
    } finally {
      setRunning(false);
    }
  };


  /** Read-only firmware boot listing, straight into the status screen. */
  const readBootStatus = async (): Promise<string> => {
    if (status.state !== "online") {
      toast.error("Bridge is not connected — run the command in an elevated terminal and paste the output");
      return "";
    }
    const cmd = statusCommand(platform).command;
    try {
      const r = await execOnBridge(cfg, cmd, {});
      setHistory((h) => [r, ...h].slice(0, 50));
      if (autoLog) logEvidence(r);
      const out = [r.stdout, r.stderr].filter(Boolean).join("\n");
      if (r.exitCode !== 0) toast.warning(`Exit ${r.exitCode} — is the helper running elevated?`);
      return out;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the boot list");
      return "";
    }
  };

  const mergeModels = (rows: LocalModel[], label: string) => {

    if (rows.length === 0) {
      toast.error("Nothing recognisable in that output");
      return;
    }
    setModels((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      rows.forEach((r) => map.set(r.id, r));
      return [...map.values()];
    });
    toast.success(`${rows.length} model${rows.length === 1 ? "" : "s"} from ${label}`);
  };

  const scanWithBridge = async () => {
    if (status.state !== "online") {
      toast.error("Bridge not connected");
      return;
    }
    const path = scanPath.trim();
    if (!path) return;
    try {
      const { entries } = await listPathOnBridge(cfg, path);
      mergeModels(fromBridgeEntries(entries, pasteSource), path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    }
  };

  const pullOllama = async () => {
    if (status.state !== "online") {
      toast.error("Bridge not connected");
      return;
    }
    try {
      const r = await execOnBridge(cfg, "ollama list", {});
      if (autoLog) logEvidence(r);
      mergeModels(parseOllamaList(r.stdout), "ollama list");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ollama list failed");
    }
  };

  const selected = models.find((m) => m.id === selectedModelId) || null;
  const plan = selected ? buildConversionPlan(selected, target, platform) : null;
  const dupes = findDuplicates(models);
  const totalBytes = models.reduce((s, m) => s + (m.sizeBytes || 0), 0);

  const statusBadge = () => {
    if (checking) return <Badge variant="secondary">Checking…</Badge>;
    switch (status.state) {
      case "online":
        return <Badge className="bg-emerald-500/15 text-emerald-500">Connected · {status.host} ({status.platform})</Badge>;
      case "unauthorized":
        return <Badge variant="destructive">Token rejected</Badge>;
      case "offline":
        return <Badge variant="destructive">No bridge</Badge>;
      default:
        return <Badge variant="secondary">Not checked</Badge>;
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24">
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Local Bridge</h1>
          {statusBadge()}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Your terminal and your local model library, wired straight to Jackie over loopback. No cloud in the path — it works
          with the machine fully offline. Command output lands in the{" "}
          <Link to="/repair?tab=evidence" className="underline">Evidence Log</Link> automatically.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? "default" : "secondary"}
            className="min-h-11"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "terminal" && (
        <div className="space-y-4">
          <Card className="p-4">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Command</label>
            <Textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={platform === "windows" ? "Get-PhysicalDisk | Format-Table" : "lsblk -o NAME,MODEL,SIZE"}
              className="mt-2 min-h-24 font-mono text-sm"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Working directory (optional)</label>
                <Input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="leave blank for home" className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Shell</label>
                <select
                  value={cfg.shell}
                  onChange={(e) => setCfg({ ...cfg, shell: e.target.value as BridgeConfig["shell"] })}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="powershell">PowerShell</option>
                  <option value="cmd">cmd.exe</option>
                  <option value="bash">bash</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button className="min-h-11" disabled={running || !command.trim()} onClick={() => run()}>
                {running ? "Running…" : "Run"}
              </Button>
              <Button variant="secondary" className="min-h-11" onClick={check} disabled={checking}>
                Re-check bridge
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={autoLog} onChange={(e) => setAutoLog(e.target.checked)} />
                Auto-log to Evidence Log
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cfg.confirmWrites}
                  onChange={(e) => setCfg({ ...cfg, confirmWrites: e.target.checked })}
                />
                Confirm non read-only commands
              </label>
            </div>
            {command.trim() && !isReadOnlyCommand(command) && (
              <p className="mt-2 text-xs text-amber-500">
                Not on the read-only list — this can change your system. Read it once more before running.
              </p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Results</h2>
              {history.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() =>
                    downloadFile(`bridge-session-${Date.now()}.json`, JSON.stringify(history, null, 2), "application/json")
                  }
                >
                  Export session JSON
                </Button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nothing run yet in this session.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {history.map((r, i) => (
                  <div key={`${r.startedAt}-${i}`} className="rounded-lg border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={r.exitCode === 0 ? "secondary" : "destructive"}>exit {r.exitCode}</Badge>
                      <span>{new Date(r.startedAt).toLocaleString()}</span>
                      <span>{r.durationMs} ms</span>
                      <span>{r.shell}</span>
                    </div>
                    <Mono>{`$ ${r.command}`}</Mono>
                    {r.stdout && <Mono>{r.stdout.slice(0, 8000)}</Mono>}
                    {r.stderr && (
                      <div className="text-destructive">
                        <Mono>{r.stderr.slice(0, 4000)}</Mono>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" className="min-h-11" onClick={() => copy(r.stdout || r.stderr)}>
                        Copy output
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-11"
                        onClick={() => {
                          logEvidence(r);
                          toast.success("Logged as evidence");
                        }}
                      >
                        Log as evidence
                      </Button>
                      {/^ollama\s+list/i.test(r.command) && (
                        <Button size="sm" className="min-h-11" onClick={() => mergeModels(parseOllamaList(r.stdout), "ollama list")}>
                          Import into Model Vault
                        </Button>
                      )}
                      {/\.gguf/i.test(r.stdout) && (
                        <Button size="sm" className="min-h-11" onClick={() => mergeModels(parseGgufListing(r.stdout, pasteSource), "GGUF scan")}>
                          Import GGUF paths
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Discovery commands</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Read-only. These are the ones that fill in what the machine actually has.
            </p>
            <div className="mt-3 space-y-3">
              {discoveryCommands(platform).map((c) => (
                <CommandRow key={c.title} {...c} onRun={(cmd) => run(cmd)} />
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "models" && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Model Vault · {models.length} entr{models.length === 1 ? "y" : "ies"} · {humanSize(totalBytes)}
              </h2>
              <div className="flex gap-2">
                <Button size="sm" className="min-h-11" onClick={pullOllama}>
                  Pull from Ollama
                </Button>
                {models.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => copy(modelEstateBrief(models), "Estate brief copied")}
                    >
                      Copy brief
                    </Button>
                    <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setModels([])}>
                      Clear
                    </Button>
                  </>
                )}
              </div>
            </div>

            {dupes.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-500">
                  {dupes.length} duplicate weight group across runners · ~{humanSize(dupes.reduce((s, d) => s + d.reclaimable, 0))} reclaimable
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Same byte-size GGUF held by two runners. Hard-link one copy instead of keeping both.
                </p>
              </div>
            )}

            {models.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing scanned. Pull from Ollama above, scan a folder, or paste real output below — no model list is assumed.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      selectedModelId === m.id ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{m.name}</span>
                      <Badge variant="secondary">{findRunner(m.source)?.label}</Badge>
                      {m.quant && <Badge variant="outline">{m.quant}</Badge>}
                      <span className="text-xs text-muted-foreground">{humanSize(m.sizeBytes)}</span>
                    </div>
                    {m.path && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{m.path}</p>}
                    {m.digest && <p className="mt-1 font-mono text-xs text-muted-foreground">digest {m.digest}</p>}
                  </button>
                ))}
              </div>
            )}
          </Card>

          {selected && (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Convert · {selected.name}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {RUNNERS.map((r) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant={target === r.id ? "default" : "secondary"}
                    className="min-h-11"
                    onClick={() => setTarget(r.id)}
                    disabled={r.id === selected.source}
                  >
                    → {r.label}
                  </Button>
                ))}
              </div>
              {plan && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={plan.zeroCopy ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}>
                      {plan.zeroCopy ? "Zero extra disk" : "Duplicates the weights"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {findRunner(plan.from)?.label} → {findRunner(plan.to)?.label} · {platform}
                    </span>
                  </div>
                  <p className="text-sm">{plan.summary}</p>
                  {plan.steps.map((s, i) => (
                    <CommandRow key={i} title={`${i + 1}. ${s.title}`} command={s.command} note={s.note} onRun={(c) => run(c)} />
                  ))}
                  {plan.warnings.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {plan.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {plan.steps.length > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => copy(plan.steps.map((s) => s.command).join("\n"), "All steps copied")}
                    >
                      Copy all steps
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Add what you have</h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Paste `ollama list` output</label>
                <Textarea
                  value={pasteOllama}
                  onChange={(e) => setPasteOllama(e.target.value)}
                  className="mt-1 min-h-28 font-mono text-xs"
                  placeholder={"NAME               ID            SIZE     MODIFIED\nqwen2.5-coder:32b  ab12cd34ef56  19 GB    2 days ago"}
                />
                <Button
                  size="sm"
                  className="mt-2 min-h-11"
                  onClick={() => {
                    mergeModels(parseOllamaList(pasteOllama), "pasted ollama list");
                    setPasteOllama("");
                  }}
                >
                  Parse Ollama list
                </Button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Paste any GGUF listing (LM Studio `lms ls`, dir /s, find)</label>
                <Textarea
                  value={pasteGguf}
                  onChange={(e) => setPasteGguf(e.target.value)}
                  className="mt-1 min-h-28 font-mono text-xs"
                  placeholder={"C:\\Users\\Eru\\.lmstudio\\models\\lmstudio-community\\Qwen2.5-Coder-32B-GGUF\\Qwen2.5-Coder-32B-Q4_K_M.gguf  19.9 GB"}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select
                    value={pasteSource}
                    onChange={(e) => setPasteSource(e.target.value as RunnerId)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {RUNNERS.filter((r) => r.id !== "bionicgpt").map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      mergeModels(parseGgufListing(pasteGguf, pasteSource), "pasted GGUF listing");
                      setPasteGguf("");
                    }}
                  >
                    Parse GGUF paths
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className="text-xs text-muted-foreground">Or scan a folder through the bridge</label>
              <div className="mt-1 flex flex-wrap gap-2">
                <Input
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  placeholder={platform === "windows" ? "C:\\Users\\Eru\\.lmstudio\\models" : "~/.lmstudio/models"}
                  className="max-w-md"
                />
                <Button size="sm" className="min-h-11" onClick={scanWithBridge}>
                  Scan folder
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Lists one level. For nested publisher folders, use the recursive discovery command on the Terminal tab.
              </p>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">How each runner stores weights</h2>
            <div className="mt-3 space-y-3">
              {RUNNERS.map((r) => (
                <div key={r.id} className="rounded-lg border border-border/60 p-3">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{r.storage}</p>
                  <p className="mt-1 font-mono text-xs">{platform === "windows" ? r.dir.windows : r.dir.linux}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{r.notes}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2 min-h-11"
                    onClick={() => run(platform === "windows" ? r.listCommand.windows : r.listCommand.linux)}
                  >
                    Run its list command
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === "wizard" && (
        <ConversionWizard
          platform={platform}
          onRun={status.state === "online" ? (c) => void run(c) : undefined}
          onExec={status.state === "online" ? execForResult : undefined}

          onCopy={(c) => copy(c, "Command copied")}
          onDownload={(name, content, mime) => downloadFile(name, content, mime || "text/plain")}
          presetPath={selected?.path || (selected?.source === "ollama" ? selected.name : undefined)}
          presetSource={
            selected
              ? selected.source === "ollama"
                ? "ollama"
                : selected.source === "lmstudio"
                  ? "lmstudio"
                  : selected.source === "bionicgpt"
                    ? "bionicgpt"
                    : "file"
              : undefined
          }
          presetSize={selected?.sizeBytes}
        />
      )}

      {tab === "bootstatus" && (
        <BootStatusPanel
          platform={platform}
          onRun={status.state === "online" ? (c) => void run(c) : undefined}
          onReadStatus={readBootStatus}
          onReadCommand={async (c) => {
            const r = await execForResult(c);
            return r ? [r.stdout, r.stderr].filter(Boolean).join("\n") : "";
          }}
          onCopy={(c) => copy(c, "Command copied")}
        />
      )}


      {tab === "custody" && (
        <CustodyPanel
          platform={platform}
          onRun={status.state === "online" ? (c) => void run(c) : undefined}
          onCopy={(c) => copy(c, "Command copied")}
        />
      )}

      {tab === "boot" && (
        <BootPanel
          platform={platform}
          onRun={status.state === "online" ? (c) => void run(c) : undefined}
          onCopy={(c) => copy(c, "Command copied")}
          onDownload={(name, content, mime) => downloadFile(name, content, mime || "text/plain")}
        />
      )}

      {tab === "setup" && (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">1. Save and start the helper</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              One file, no dependencies, Node 18+. It binds to 127.0.0.1 only, requires the token it prints, and appends every
              command it runs to <span className="font-mono">~/.jackie-bridge/commands.log</span>.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" className="min-h-11" onClick={() => downloadFile("jackie-bridge.mjs", AGENT_SCRIPT, "text/javascript")}>
                Download jackie-bridge.mjs
              </Button>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => copy(AGENT_SCRIPT, "Helper script copied")}>
                Copy script
              </Button>
            </div>
            <Mono>{`# in the folder where you saved it\nnode jackie-bridge.mjs\n# it prints:  TOKEN: <paste that below>`}</Mono>
            <p className="text-xs text-muted-foreground">
              Run the terminal as Administrator if you need elevated commands (BIOS reads, disk queries). The helper inherits
              whatever privileges that terminal has — nothing more.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">2. Point Jackie at it</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Bridge URL (loopback only)</label>
                <Input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} className="mt-1 font-mono" />
                {!isLoopback(cfg.baseUrl) && (
                  <p className="mt-1 text-xs text-destructive">Not a loopback address. The bridge refuses anything but this machine.</p>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Token (printed by the helper)</label>
                <Input
                  type="password"
                  value={cfg.token}
                  onChange={(e) => setCfg({ ...cfg, token: e.target.value })}
                  className="mt-1 font-mono"
                  placeholder="paste TOKEN here"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button className="min-h-11" onClick={check} disabled={checking}>
                {checking ? "Checking…" : "Connect"}
              </Button>
              <Button variant="secondary" className="min-h-11" onClick={() => setCfg(DEFAULT_CONFIG)}>
                Reset
              </Button>
              {statusBadge()}
            </div>
            {(status.state === "offline" || status.state === "unauthorized") && (
              <p className="mt-2 text-xs text-destructive">{status.detail}</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Offline behaviour</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Browser → 127.0.0.1 only. With the internet cut, the terminal and Model Vault keep working.</li>
              <li>Vault, bridge settings and command results live in this browser's local storage — no server round trip.</li>
              <li>Install the app to the desktop (PWA) so the shell itself loads with no network.</li>
              <li>
                Conversions are plain filesystem operations — hard links and one-line Modelfiles. Nothing here needs a download
                to work.
              </li>
              <li>Evidence Log entries are written locally and only leave the machine if you export them.</li>
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">What the helper will not do</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Listen on anything but 127.0.0.1 — no LAN, no tunnel by default.</li>
              <li>Accept a request without the token, or from an origin outside its allowlist.</li>
              <li>Escalate privileges. If a command needs admin, start the helper from an admin terminal.</li>
              <li>Hide anything: every executed command is timestamped in its own log file.</li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
