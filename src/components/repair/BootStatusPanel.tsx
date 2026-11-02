import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BOOT_ENTRY_LABEL, type Platform } from "@/lib/repair/autorun";
import {
  bootStatusBrief, bootVerdict, makeSnapshot, moveLastCommands, parseBootStatus,
  rollbackCommands, statusCommand,
  type BootCommand, type BootSnapshot, type BootStatus,
} from "@/lib/repair/bootEntries";
import {
  EMPTY_WALK, lastBootCommand, parseLastBoot, walkVerdict, type BootWalk,
} from "@/lib/repair/bootWalk";

const LS_KEY = "jackie.bootstatus.v1";

type Saved = { raw: string; snapshot: BootSnapshot | null; walk: BootWalk };

function load(): Saved {
  try {
    const r = localStorage.getItem(LS_KEY);
    const base: Saved = { raw: "", snapshot: null, walk: { ...EMPTY_WALK } };
    if (!r) return base;
    const parsed = JSON.parse(r) as Partial<Saved>;
    return { ...base, ...parsed, walk: { ...EMPTY_WALK, ...(parsed.walk ?? {}) } };
  } catch {
    return { raw: "", snapshot: null, walk: { ...EMPTY_WALK } };
  }
}

const TONE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-500",
  info: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/15 text-amber-500",
  high: "bg-destructive/15 text-destructive",
};

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground">
      {children}
    </pre>
  );
}

function CmdRow({
  cmd, onRun, onCopy,
}: { cmd: BootCommand; onRun?: (c: string) => void; onCopy: (c: string) => void }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{cmd.title}</p>
        {cmd.readOnly && <Badge variant="outline">read-only</Badge>}
      </div>
      <Mono>{cmd.command}</Mono>
      {cmd.note && <p className="mt-1 text-xs text-muted-foreground">{cmd.note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onCopy(cmd.command)}>
          Copy
        </Button>
        {onRun && (
          <Button size="sm" className="min-h-11" onClick={() => onRun(cmd.command)}>
            Run on bridge
          </Button>
        )}
      </div>
    </div>
  );
}

export default function BootStatusPanel({
  platform, onRun, onReadStatus, onReadCommand, onCopy,
}: {
  platform: Platform;
  onRun?: (c: string) => void;
  /** Runs the read-only status command and returns its raw stdout. */
  onReadStatus?: () => Promise<string>;
  /** Runs any read-only command through the bridge and returns its raw stdout. */
  onReadCommand?: (c: string) => Promise<string>;
  onCopy: (c: string) => void;
}) {
  const [state, setState] = useState<Saved>(() => load());
  const [reading, setReading] = useState(false);
  const [showRollback, setShowRollback] = useState(false);
  const [readingBoot, setReadingBoot] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
  }, [state]);

  const status: BootStatus | null = useMemo(() => parseBootStatus(state.raw), [state.raw]);
  const verdict = bootVerdict(status);
  const statusCmd = statusCommand(platform);
  const bootCmd = lastBootCommand(platform);
  const walk = state.walk;
  const walkV = walkVerdict(walk, status ? Boolean(status.jackie) : null);

  const setWalk = (patch: Partial<BootWalk>) =>
    setState((s) => ({ ...s, walk: { ...s.walk, ...patch } }));

  const readLastBoot = async () => {
    if (!onReadCommand) return;
    setReadingBoot(true);
    try {
      const out = await onReadCommand(bootCmd.command);
      setWalk({ lastBootRaw: out, lastBootAt: parseLastBoot(out) });
    } finally {
      setReadingBoot(false);
    }
  };

  const readNow = async () => {
    if (!onReadStatus) return;
    setReading(true);
    try {
      const out = await onReadStatus();
      setState((s) => ({ ...s, raw: out }));
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">UEFI boot entry status</h2>
          <Badge variant="outline">{platform === "windows" ? "bcdedit" : "efibootmgr"}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Reads the firmware boot list as it is right now and reports whether{" "}
          <span className="font-mono">{BOOT_ENTRY_LABEL}</span> exists, where it sits in the boot order, and how to undo it.
          Every line below comes from the output you read — nothing is assumed about your NVRAM.
        </p>

        <div className="mt-3 rounded-lg border border-border/60 p-3">
          <Badge className={TONE[verdict.tone]}>{verdict.tone}</Badge>
          <p className="mt-2 text-sm font-medium">{verdict.headline}</p>
          <p className="mt-1 text-sm text-muted-foreground">{verdict.detail}</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {onReadStatus && (
            <Button size="sm" className="min-h-11" disabled={reading} onClick={() => void readNow()}>
              {reading ? "Reading…" : "Read status on bridge"}
            </Button>
          )}
          <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onCopy(statusCmd.command)}>
            Copy status command
          </Button>
          {status && (
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onCopy(bootStatusBrief(status))}>
              Copy factual brief
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {platform === "windows"
            ? "Needs an Administrator terminal — bcdedit refuses NVRAM reads otherwise."
            : "Needs sudo — efibootmgr reads the EFI variables through the kernel."}
        </p>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Did it survive a real restart?</h3>
          <Badge className={TONE[walkV.tone]}>{walkV.tone}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          An entry that exists in a listing you took before restarting proves nothing — some boards drop added entries on
          the next power cycle. This compares the moment the entry was created against the machine&apos;s own last boot time.
        </p>

        <div className="mt-3 rounded-lg border border-border/60 p-3">
          <p className="text-sm font-medium">{walkV.headline}</p>
          <p className="mt-1 text-sm text-muted-foreground">{walkV.detail}</p>
        </div>

        <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <p>
            Entry created:{" "}
            <span className="font-mono text-foreground">
              {walk.createdAt ? new Date(walk.createdAt).toLocaleString() : "not recorded"}
            </span>
          </p>
          <p>
            Machine last booted:{" "}
            <span className="font-mono text-foreground">
              {walk.lastBootAt ? new Date(walk.lastBootAt).toLocaleString() : "not read"}
            </span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="min-h-11"
            onClick={() => setWalk({ createdAt: new Date().toISOString() })}
          >
            {walk.createdAt ? "Re-record creation as now" : "I just ran the create command"}
          </Button>
          {onReadCommand && (
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11"
              disabled={readingBoot}
              onClick={() => void readLastBoot()}
            >
              {readingBoot ? "Reading…" : "Read last boot time"}
            </Button>
          )}
          <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onCopy(bootCmd.command)}>
            Copy last-boot command
          </Button>
          {(walk.createdAt || walk.lastBootRaw) && (
            <Button
              size="sm"
              variant="ghost"
              className="min-h-11"
              onClick={() => setWalk({ createdAt: null, lastBootRaw: "", lastBootAt: null })}
            >
              Clear walk-through
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{bootCmd.note}</p>

        <Textarea
          className="mt-3 min-h-[70px] font-mono text-xs"
          placeholder={platform === "windows" ? "Or paste the LastBootUpTime output here" : "Or paste the output of: uptime -s"}
          value={walk.lastBootRaw}
          onChange={(e) => setWalk({ lastBootRaw: e.target.value, lastBootAt: parseLastBoot(e.target.value) })}
        />
        {walk.lastBootRaw.trim() && !walk.lastBootAt && (
          <p className="mt-2 text-xs text-destructive">
            No readable date in that output, so no restart can be confirmed from it.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold">Firmware listing</h3>
        <div className="mt-3">
          <CmdRow cmd={statusCmd} onRun={onRun} onCopy={onCopy} />
        </div>
        <Textarea
          className="mt-3 min-h-[140px] font-mono text-xs"
          placeholder={
            platform === "windows"
              ? "Paste the full output of: bcdedit /enum firmware"
              : "Paste the full output of: sudo efibootmgr -v"
          }
          value={state.raw}
          onChange={(e) => setState((s) => ({ ...s, raw: e.target.value }))}
        />
        {state.raw.trim() && !status && (
          <p className="mt-2 text-xs text-destructive">
            That does not look like a firmware boot listing. Paste the whole output, including the boot order line.
          </p>
        )}
        {state.raw && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 min-h-11"
            onClick={() => setState((s) => ({ ...s, raw: "" }))}
          >
            Clear listing
          </Button>
        )}
      </Card>

      {status && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Boot order</h3>
            <Badge variant="outline">{status.orderCount} entries</Badge>
            {status.jackiePosition !== null && (
              <Badge className={TONE[verdict.tone]}>
                Jackie Boot: position {status.jackiePosition} of {status.orderCount}
              </Badge>
            )}
          </div>
          <ol className="mt-3 space-y-2">
            {status.order.map((e, i) => (
              <li
                key={`${e.id}-${i}`}
                className={`rounded-lg border p-3 ${e.isJackie ? "border-primary bg-primary/5" : "border-border/60"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="text-sm font-medium">{e.label}</span>
                  {e.isJackie && <Badge variant="outline">Jackie</Badge>}
                  {e.active && <Badge variant="secondary">active</Badge>}
                  <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
                </div>
                {e.target && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{e.target}</p>}
              </li>
            ))}
          </ol>
          {status.unordered.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground">Defined in NVRAM but outside the boot order</p>
              <ul className="mt-2 space-y-1">
                {status.unordered.map((e) => (
                  <li key={e.id} className="rounded-md border border-border/60 p-2 text-xs">
                    {e.label} <span className="font-mono text-muted-foreground">{e.id}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {status && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Snapshot — take this before any change</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Rollback is only exact if the original order was recorded. This stores the boot order ids from the listing above,
            locally, so a one-click undo can put them back verbatim.
          </p>
          {state.snapshot ? (
            <div className="mt-3 rounded-lg border border-border/60 p-3">
              <p className="text-sm font-medium">Snapshot held</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(state.snapshot.takenAt).toLocaleString()} · {state.snapshot.platform} ·{" "}
                {state.snapshot.rawOrder.length} entries · Jackie Boot was{" "}
                {state.snapshot.jackiePresent ? "already present" : "not present"}
              </p>
              <Mono>{state.snapshot.labels.join(" → ") || state.snapshot.rawOrder.join(", ")}</Mono>
            </div>
          ) : (
            <p className="mt-3 text-xs text-amber-500">
              No snapshot yet. Take one now, while the machine is in a state you are happy with.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" onClick={() => setState((s) => ({ ...s, snapshot: makeSnapshot(status) }))}>
              {state.snapshot ? "Replace snapshot with current order" : "Take snapshot"}
            </Button>
            {state.snapshot && (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={() => setState((s) => ({ ...s, snapshot: null }))}
              >
                Discard snapshot
              </Button>
            )}
          </div>
        </Card>
      )}

      {status && status.jackie && status.jackiePosition !== status.orderCount && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold">Move Jackie Boot last</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The rescue entry should be reachable by name, never ahead of your normal boot target.
          </p>
          <div className="mt-3 space-y-3">
            {moveLastCommands(status).map((c, i) => (
              <CmdRow key={i} cmd={c} onRun={onRun} onCopy={onCopy} />
            ))}
          </div>
        </Card>
      )}

      {status && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">One-click rollback</h3>
            <Badge variant="outline">restores order, then deletes the entry</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Order restore runs first on purpose: if the delete then fails, the machine still boots exactly as it did before.
            Nothing here touches the BIOS image, Windows Boot Manager, or any other entry.
          </p>
          {!status.jackie && (
            <p className="mt-2 text-xs text-muted-foreground">
              There is no Jackie Boot entry in this listing, so rollback would only restore the boot order.
            </p>
          )}
          {!state.snapshot && (
            <p className="mt-2 text-xs text-amber-500">
              No snapshot held — rollback will delete the entry but cannot prove what the order was beforehand.
            </p>
          )}
          {!showRollback ? (
            <Button
              size="sm"
              variant="destructive"
              className="mt-3 min-h-11"
              onClick={() => setShowRollback(true)}
            >
              Prepare rollback
            </Button>
          ) : (
            <div className="mt-3 space-y-3">
              {rollbackCommands(status, state.snapshot).map((c, i) => (
                <CmdRow key={i} cmd={c} onRun={onRun} onCopy={onCopy} />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() =>
                    onCopy(
                      rollbackCommands(status, state.snapshot)
                        .filter((c) => !c.readOnly)
                        .map((c) => c.command)
                        .join("\n"),
                    )
                  }
                >
                  Copy rollback sequence
                </Button>
                <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setShowRollback(false)}>
                  Hide
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                After running it, read the status again — the listing is the only proof the rollback took effect.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
