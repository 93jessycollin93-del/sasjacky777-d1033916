import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  BOOT_ENTRY_LABEL, BOOT_SCOPE, BOOT_VOLUME_LABEL, STARTUP_CHECKS,
  firmwareSteps, installSteps, lmStudioHubSteps, parseStartupReport, reportVerdict,
  sortFindings, startupScript, type Platform, type StartupReport,
} from "@/lib/repair/autorun";

const LS_KEY = "jackie.boot.v1";

type Saved = { custodyRoot: string; lmStudioDir: string; report: string };

function load(platform: Platform): Saved {
  const fallback: Saved = {
    custodyRoot: platform === "windows" ? "D:\\JackieBackup" : "/mnt/backup/jackie",
    lmStudioDir: platform === "windows" ? "%USERPROFILE%\\.lmstudio\\models" : "~/.lmstudio/models",
    report: "",
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Saved>) } : fallback;
  } catch {
    return fallback;
  }
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function Cmd({
  title, command, note, onRun, onCopy,
}: { title: string; command: string; note?: string; onRun?: (c: string) => void; onCopy: (c: string) => void }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-sm font-medium">{title}</p>
      <Mono>{command}</Mono>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onCopy(command)}>
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

const SEV_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  info: "secondary",
  ok: "outline",
};

export default function BootPanel({
  platform, onRun, onCopy, onDownload,
}: {
  platform: Platform;
  onRun?: (c: string) => void;
  onCopy: (c: string) => void;
  onDownload: (name: string, content: string, mime?: string) => void;
}) {
  const [state, setState] = useState<Saved>(() => load(platform));
  const scriptPath = platform === "windows"
    ? "C:\\ProgramData\\Jackie\\jackie-startup-assess.ps1"
    : "/usr/local/sbin/jackie-startup-assess.ps1";

  const persist = (next: Partial<Saved>) => {
    const merged = { ...state, ...next };
    setState(merged);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(merged));
    } catch {
      /* quota */
    }
  };

  const script = useMemo(
    () => startupScript({ custodyRoot: state.custodyRoot, lmStudioDir: state.lmStudioDir }),
    [state.custodyRoot, state.lmStudioDir],
  );
  const parsed: StartupReport | null = useMemo(
    () => (state.report.trim() ? parseStartupReport(state.report) : null),
    [state.report],
  );
  const verdict = parsed ? reportVerdict(parsed) : null;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Jackie Boot</h2>
          <Badge variant="outline">{platform === "windows" ? "Windows" : "Linux"}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Two layers, kept honestly separate: a startup assessment that runs as SYSTEM the moment the machine comes up, and a
          named UEFI boot entry so a rescue path is present in the board's boot menu.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-sm font-medium">What this actually does</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {BOOT_SCOPE.can.map((c) => <li key={c}>· {c}</li>)}
            </ul>
          </div>
          <div className="rounded-lg border border-border/60 p-3">
            <p className="text-sm font-medium">What it cannot do — stated plainly</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {BOOT_SCOPE.cannot.map((c) => <li key={c}>· {c}</li>)}
            </ul>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Paths the assessment reads</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Custody / backup root</span>
            <Input
              className="min-h-11 font-mono text-xs"
              value={state.custodyRoot}
              onChange={(e) => persist({ custodyRoot: e.target.value })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">LM Studio models folder (your hub)</span>
            <Input
              className="min-h-11 font-mono text-xs"
              value={state.lmStudioDir}
              onChange={(e) => persist({ lmStudioDir: e.target.value })}
            />
          </label>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Startup assessment — what it checks and why</h3>
        <div className="mt-3 space-y-2">
          {STARTUP_CHECKS.map((c) => (
            <div key={c.id} className="rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">{c.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.reads}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="min-h-11" onClick={() => onDownload("jackie-startup-assess.ps1", script, "text/plain")}>
            Download script
          </Button>
          <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onCopy(script)}>
            Copy script
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Read-only by design: it inspects and writes a report. It never repairs, deletes, or flashes anything — those stay
          your call, after you have read the report.
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Run it at every boot</h3>
        <div className="mt-3 space-y-3">
          {installSteps(scriptPath).map((s) => (
            <Cmd key={s.title} {...s} onRun={onRun} onCopy={onCopy} />
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Presence in the boot menu — "{BOOT_ENTRY_LABEL}"</h3>
          <Badge variant="outline">NVRAM entry, not a BIOS mod</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a firmware boot entry named <span className="font-mono">{BOOT_ENTRY_LABEL}</span> pointing at a rescue
          loader on a volume labelled <span className="font-mono">{BOOT_VOLUME_LABEL}</span>. It appears in the UEFI boot list
          and the F11 menu by that name, last in order so it never steals a normal boot.
        </p>
        <div className="mt-3 space-y-3">
          {firmwareSteps(platform).map((s) => (
            <Cmd key={s.title} {...s} onRun={onRun} onCopy={onCopy} />
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">LM Studio as the model hub</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your weights already live in LM Studio, so treat that folder as the single source and point everything else at it.
          One file served over a local OpenAI-compatible endpoint beats a second copy on disk every time.
        </p>
        <div className="mt-3 space-y-3">
          {lmStudioHubSteps(state.lmStudioDir, platform).map((s) => (
            <Cmd key={s.title} {...s} onRun={onRun} onCopy={onCopy} />
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Startup report</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste <span className="font-mono">startup-report.json</span> here (or run step 6 on the bridge and paste the output).
          Jackie reads only what the report contains — nothing is inferred.
        </p>
        <Textarea
          className="mt-3 min-h-[140px] font-mono text-xs"
          placeholder="{ ... contents of startup-report.json ... }"
          value={state.report}
          onChange={(e) => persist({ report: e.target.value })}
        />
        {state.report.trim() && !parsed && (
          <p className="mt-2 text-xs text-destructive">
            That is not valid JSON, so nothing is being read from it. Paste the whole file, braces included.
          </p>
        )}
        {parsed && verdict && (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-border/60 p-3">
              <Badge variant={SEV_VARIANT[verdict.tone] ?? "secondary"}>{verdict.tone}</Badge>
              <p className="mt-2 text-sm">{verdict.text}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {parsed.host ?? "unknown host"} · board {parsed.board ?? "unknown"} · BIOS {parsed.biosVersion ?? "unknown"} ·
                OS build {parsed.osBuild ?? "unknown"} · last boot {parsed.lastBootUpTime ?? "unknown"}
              </p>
              {parsed.lmStudio && (
                <p className="mt-1 text-xs text-muted-foreground">
                  LM Studio hub: {parsed.lmStudio.count ?? "?"} GGUF · {parsed.lmStudio.totalGB ?? "?"} GB ·{" "}
                  <span className="font-mono">{parsed.lmStudio.dir}</span>
                </p>
              )}
            </div>
            {sortFindings(parsed.findings).map((f, i) => (
              <div key={`${f.id}-${i}`} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEV_VARIANT[f.severity] ?? "secondary"}>{f.severity}</Badge>
                  <span className="text-sm font-medium">{f.summary}</span>
                </div>
                {f.detail && <Mono>{f.detail}</Mono>}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() => onDownload(`startup-report-${Date.now()}.json`, JSON.stringify(parsed, null, 2), "application/json")}
              >
                Export report
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
