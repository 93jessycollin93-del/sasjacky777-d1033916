import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ASSET_CLASSES, CUSTODY_RULES, OS_CORRUPTION_LADDER, POLICY_LABEL, POWER_LOSS_RECOVERY,
  VOLATILITY_LABEL, classifyPath, hardlinkSteps, preWorkStages, safeCopySteps,
  type Platform,
} from "@/lib/repair/custody";

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

const POLICY_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  hardlink: "secondary",
  copy: "default",
  export: "outline",
  never: "destructive",
};

export default function CustodyPanel({
  platform, onRun, onCopy,
}: { platform: Platform; onRun?: (c: string) => void; onCopy: (c: string) => void }) {
  const [os, setOs] = useState<Platform>(platform);
  const [probe, setProbe] = useState("");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const [backupRoot, setBackupRoot] = useState(os === "windows" ? "D:\\jackie-custody" : "/mnt/backup/jackie-custody");

  const cls = useMemo(() => (probe.trim() ? classifyPath(probe) : null), [probe]);
  const stages = useMemo(() => preWorkStages(backupRoot), [backupRoot]);
  const copySteps = useMemo(
    () => (src.trim() && dest.trim() ? safeCopySteps(src.trim(), dest.trim(), os) : []),
    [src, dest, os],
  );
  const linkSteps = useMemo(
    () => (src.trim() && dest.trim() ? hardlinkSteps(src.trim(), dest.trim(), os) : []),
    [src, dest, os],
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Target OS for generated commands</span>
          {(["windows", "linux"] as Platform[]).map((o) => (
            <Button key={o} size="sm" variant={os === o ? "default" : "secondary"} className="min-h-11" onClick={() => setOs(o)}>
              {o === "windows" ? "Windows" : "Linux"}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Defaults to what the bridge reports. Switch it when you are preparing commands for the rescue stick instead of this machine.
        </p>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Custody rules — these hold whatever the task is</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {CUSTODY_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        <Button
          size="sm"
          variant="secondary"
          className="mt-3 min-h-11"
          onClick={() => onCopy(CUSTODY_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n"))}
        >
          Copy rules
        </Button>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Can this be duplicated?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Paste a real path. Jackie answers from file class, not guesswork — and says plainly when it has no rule yet.
        </p>
        <Input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          placeholder={os === "windows" ? "C:\\Users\\Eru\\.ollama\\models\\blobs\\sha256-…" : "~/.ollama/models/blobs/sha256-…"}
          className="mt-2"
        />
        {cls && (
          <div className="mt-3 rounded-lg border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={POLICY_TONE[cls.policy]}>{POLICY_LABEL[cls.policy]}</Badge>
              <Badge variant="secondary">{VOLATILITY_LABEL[cls.volatility]}</Badge>
              <span className="text-sm font-medium">{cls.label}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{cls.why}</p>
            <p className="mt-2 text-sm">{cls.handling}</p>
            {cls.capture && (cls.capture[os] ?? cls.capture.windows) && (
              <Mono>{cls.capture[os] ?? cls.capture.windows}</Mono>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Power-loss-safe transfer</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Temp name → flush → atomic rename → hash both sides. A cut before the rename leaves the original untouched.
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <Input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Source path" />
          <Input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Destination path" />
        </div>
        {copySteps.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Copy and verify</p>
            {copySteps.map((s) => (
              <Cmd key={s.title} title={s.title} command={s.command} onRun={onRun} onCopy={onCopy} />
            ))}
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Same volume and immutable? Hardlink instead — zero bytes copied
            </p>
            {linkSteps.map((s) => (
              <Cmd key={s.title} title={s.title} command={s.command} onRun={onRun} onCopy={onCopy} />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Pre-work custody run</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Run every stage before flashing, cleaning, or reinstalling anything. Stage 5 is what makes the rest trustworthy.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={backupRoot}
            onChange={(e) => setBackupRoot(e.target.value)}
            placeholder={os === "windows" ? "D:\\jackie-custody" : "/mnt/backup/jackie-custody"}
            className="max-w-md"
          />
          <Button
            size="sm"
            variant="secondary"
            className="min-h-11"
            onClick={() =>
              onCopy(
                stages
                  .map(
                    (s) =>
                      `# ${s.title}\n# ${s.purpose}\n` +
                      s.commands.map((c) => c[os] ?? c.windows ?? c.linux ?? "").filter(Boolean).join("\n"),
                  )
                  .join("\n\n"),
              )
            }
          >
            Copy full script
          </Button>
        </div>
        <div className="mt-3 space-y-4">
          {stages.map((s) => (
            <div key={s.id}>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.purpose}</p>
              <div className="mt-2 space-y-2">
                {s.commands.map((c, i) => {
                  const cmd = c[os] ?? c.windows ?? c.linux;
                  if (!cmd) return null;
                  return <Cmd key={`${s.id}-${i}`} title={`Step ${i + 1}`} command={cmd} note={c.note} onRun={onRun} onCopy={onCopy} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">After a power loss — before you resume</h2>
        <ol className="mt-2 space-y-2 text-sm">
          {POWER_LOSS_RECOVERY.map((p) => (
            <li key={p.step} className="rounded-lg border border-border/60 p-3">
              <p className="font-medium">{p.step}</p>
              <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">OS corruption containment ladder</h2>
        <p className="mt-1 text-xs text-muted-foreground">Climb only as far as the evidence justifies. Never start above the level your logs support.</p>
        <div className="mt-3 space-y-2">
          {OS_CORRUPTION_LADDER.map((l) => (
            <div key={l.level} className="rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">{l.level}</p>
              <p className="mt-1 text-xs text-muted-foreground">Signs: {l.signs}</p>
              <p className="mt-1 text-sm">{l.action}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Full duplication policy table</h2>
        <div className="mt-3 space-y-2">
          {ASSET_CLASSES.map((c) => (
            <div key={c.id} className="rounded-lg border border-border/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={POLICY_TONE[c.policy]}>{POLICY_LABEL[c.policy]}</Badge>
                <span className="text-sm font-medium">{c.label}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.why}</p>
              <p className="mt-1 text-sm">{c.handling}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
