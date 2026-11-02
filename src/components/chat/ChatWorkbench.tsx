import { useEffect, useRef, useState } from "react";
import { Activity, Check, ChevronDown, Copy, Cpu, Focus, RefreshCw, ShieldCheck, Terminal, X } from "lucide-react";
import { fetchDevicePersona, DEVICE_PROFILE_DEPLOY_COMMAND, type DevicePersonaIssue } from "@/lib/microai/devicePersona";
import type { HarnessApproval, HarnessEvent } from "@/lib/chatHarness";

export interface ChatWorkbenchProps {
  device: boolean;
  model: string;
  mode: "chat" | "harness";
  onMode: (mode: "chat" | "harness") => void;
  reviewWrites: boolean;
  onReviewWrites: (value: boolean) => void;
  focus: boolean;
  onFocus: () => void;
  running: boolean;
  status: string | null;
  outcome: "idle" | "working" | "complete" | "blocked" | "stopped";
  events: HarnessEvent[];
  issue: DevicePersonaIssue | null;
  error: string | null;
  onIssue: (issue: DevicePersonaIssue | null) => void;
  approval: HarnessApproval | null;
  onDecision: (approved: boolean) => void;
  onRestore: (() => void) | null;
}

const control = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-50";

/** Runtime checks and observed actions, never synthetic reasoning or success. */
export function ChatWorkbench(p: ChatWorkbenchProps) {
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [profile, setProfile] = useState<"unchecked" | "verified" | "degraded">("unchecked");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const checkRef = useRef<AbortController | null>(null);
  useEffect(() => () => { checkRef.current?.abort(); }, []);

  const check = async () => {
    checkRef.current?.abort();
    const controller = new AbortController();
    checkRef.current = controller;
    setChecking(true);
    const result = await fetchDevicePersona({ signal: controller.signal });
    if (controller.signal.aborted) return;
    setChecking(false);
    if (result.ok) {
      setProfile(result.mode === "persona" ? "verified" : "degraded");
      p.onIssue(null);
    } else {
      setProfile("unchecked");
      p.onIssue(result.issue);
    }
  };

  const copy = async () => {
    try {
      // Deployment instructions contain neither the profile nor session keys.
      await navigator.clipboard.writeText(DEVICE_PROFILE_DEPLOY_COMMAND);
      setCopied(true);
      setCopyError(false);
    } catch { setCopyError(true); }
  };
  const state = p.approval ? "Approval needed" : p.outcome === "working" ? "Running" : p.outcome === "complete" ? "Completed" : p.outcome === "blocked" ? "Needs attention" : p.outcome === "stopped" ? "Stopped" : "Ready for a task";

  return (
    <section className="rounded-xl border border-border bg-card/95 shadow-sm" aria-label="Session workbench">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal size={15} className="text-primary shrink-0" />
          <span className="text-[11px] font-mono uppercase tracking-[.16em] text-foreground">Jackie workspace</span>
          <span className={`rounded-full px-2 py-1 text-[10px] ${p.issue || p.outcome === "blocked" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground"}`}>{p.issue ? "Profile blocked" : state}</span>
        </div>
        <button type="button" className="min-h-11 min-w-11 rounded-lg text-muted-foreground hover:bg-secondary" aria-label={p.focus ? "Show animated background" : "Enable focus mode"} aria-pressed={p.focus} onClick={p.onFocus}>
          <Focus size={17} className="mx-auto" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <div className="flex rounded-lg bg-secondary p-1" role="group" aria-label="Session mode">
          {(["chat", "harness"] as const).map((mode) => (
            <button key={mode} type="button" disabled={p.running} onClick={() => p.onMode(mode)} aria-pressed={p.mode === mode} className={`min-h-11 rounded-md px-3 text-xs font-medium ${p.mode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
              {mode === "chat" ? "Chat" : "Agent harness"}
            </button>
          ))}
        </div>
        {p.device && (
          <button type="button" className={control} disabled={checking || p.running} onClick={check}>
            <RefreshCw size={13} className={checking ? "animate-spin" : ""} />{checking ? "Checking profile…" : "Check connection"}
          </button>
        )}
        <button type="button" className={`${control} ml-auto`} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <Activity size={13} />Run trace<ChevronDown size={13} className={expanded ? "rotate-180" : ""} />
        </button>
      </div>
      {p.mode === "harness" && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground space-y-2">
          <p>Up to 3 app actions · 4 model turns · no automatic engine switch. Small models may need a simpler task.</p>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-foreground">
            <input type="checkbox" checked={p.reviewWrites} onChange={(e) => p.onReviewWrites(e.target.checked)} disabled={p.running} className="h-4 w-4 accent-primary" />
            Allow proposed tasks and memories, with my approval for each write
          </label>
          {!p.reviewWrites && <p>Read-only app tools: task board, memories and conversation history. Conversations are still saved. Deletes and outside-service calls are unavailable.</p>}
        </div>
      )}
      {p.device && !p.issue && profile !== "unchecked" && (
        <p className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status">
          <ShieldCheck size={13} className="text-primary" />{profile === "verified" ? "Owner profile verified. Model readiness is shown below." : "Profile received with reduced attestation. Check Jackie Morals before relying on it."}
        </p>
      )}
      {p.issue || p.error ? (
        <div className="border-t border-destructive/30 bg-destructive/5 p-3 space-y-2" role="alert">
          <p className="font-semibold text-sm text-foreground">{p.issue?.title ?? "This run did not complete"}</p>
          <p className="text-xs leading-relaxed text-foreground/85 break-words">{p.issue?.detail ?? p.error}</p>
          {p.issue && <p className="text-xs leading-relaxed text-muted-foreground">{p.issue.recovery}</p>}
          <div className="flex flex-wrap gap-2">
            {p.issue?.href && <a href={p.issue.href} className={control}>{p.issue.code === "OWNER_ONLY" ? "Open Jackie Core" : "Sign in"}</a>}
            {p.issue?.code === "NOT_DEPLOYED" && <button type="button" className={control} onClick={copy}><Copy size={13} />{copied ? "Command copied" : "Copy deploy command"}</button>}
            {p.onRestore && <button type="button" className={control} disabled={p.running} onClick={p.onRestore}>Restore prompt</button>}
          </div>
          {copyError && <pre className="whitespace-pre-wrap break-all text-[11px] font-mono">{DEVICE_PROFILE_DEPLOY_COMMAND}</pre>}
        </div>
      ) : p.running && (
        <p className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status"><Cpu size={13} className="animate-pulse text-primary" />{p.status ?? "Working on your request…"}</p>
      )}
      {p.approval && (
        <div className="border-t border-primary/30 p-3 space-y-2" role="region" aria-label="Approve app action">
          <p className="text-sm font-semibold text-foreground">Review {p.approval.tool.replaceAll("_", " ")}</p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-secondary p-3 text-xs whitespace-pre-wrap break-words">{JSON.stringify(p.approval.args, null, 2)}</pre>
          <div className="flex gap-2">
            <button type="button" className={`${control} bg-primary text-primary-foreground`} onClick={() => p.onDecision(true)}><Check size={14} />Approve this action</button>
            <button type="button" className={control} onClick={() => p.onDecision(false)}><X size={14} />Decline</button>
          </div>
        </div>
      )}
      {expanded && (
        <ol className="max-h-52 overflow-auto border-t border-border px-3 py-2 space-y-2" aria-label="Observed run events">
          {p.events.length === 0 && <li className="text-xs text-muted-foreground">Your next run's actual model calls and app actions will appear here.</li>}
          {p.events.map((event) => <li key={event.id} className="flex gap-3 text-xs"><time className="shrink-0 font-mono text-[10px] text-muted-foreground">{new Date(event.at).toLocaleTimeString([], { hour12: false })}</time><span className={`break-words ${event.kind === "error" ? "text-destructive" : event.kind === "success" ? "text-primary" : "text-foreground"}`}>{event.label}</span></li>)}
        </ol>
      )}
    </section>
  );
}
