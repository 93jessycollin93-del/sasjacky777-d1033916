import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, RotateCcw } from "lucide-react";
import {
  COMPATIBILITY,
  DEPENDENCY_CHECKLIST,
  GOALS,
  LINKS,
  PHASES,
  PZ_TARGET,
  STATUS_BOARD,
  allChecklistIds,
  type ChecklistItem,
  type WorkStatus,
} from "@/lib/pzRealism/plan";
import { readProgress, resetProgress, toggleDone, writeProgress, type PzProgress } from "@/lib/pzRealism/progress";

const STATUS_STYLE: Record<WorkStatus, string> = {
  implemented: "border-primary/50 text-primary",
  planned: "border-border text-muted-foreground",
  blocked: "border-destructive/60 text-destructive",
  experimental: "border-accent text-accent-foreground",
};

function StatusPill({ status }: { status: WorkStatus }) {
  return (
    <span className={`inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-md border border-border bg-card p-4">
      <h2 id={id} className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Check({ item, checked, onToggle }: { item: ChecklistItem; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm px-2 py-2 hover:bg-secondary/40 focus-within:ring-2 focus-within:ring-ring">
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 h-4 w-4 accent-primary" />
      <span className="text-sm">
        <span className={checked ? "text-muted-foreground line-through" : "text-foreground"}>{item.label}</span>
        {item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}
      </span>
    </label>
  );
}

const storage = (): Storage | null => {
  try { return window.localStorage; } catch { return null; }
};

/**
 * The working page for the Realism Overhaul mod: what it targets, what is
 * actually built, what is blocked and on whom. Progress ticks stay on this
 * device. Nothing here pretends the camera works — it is blocked on pz3d.
 */
export default function ZomboidRealism() {
  const [progress, setProgress] = useState<PzProgress>(() => readProgress(storage()));
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const before = document.title;
    document.title = "Project Zomboid: Realism Overhaul · Jackie";
    return () => { document.title = before; };
  }, []);

  const done = useMemo(() => new Set(progress.done), [progress]);
  const total = allChecklistIds().length;

  const toggle = (id: string) => {
    const next = toggleDone(progress, id);
    setProgress(next);
    setSaveFailed(!writeProgress(storage(), next));
  };

  const reset = () => {
    const ok = resetProgress(storage());
    setSaveFailed(!ok);
    if (ok) setProgress(readProgress(storage()));
    setConfirmReset(false);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <header className="space-y-2">
          <Link to="/" className="inline-flex min-h-11 items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft size={14} /> Back to Jackie
          </Link>
          <h1 className="font-mono text-xl text-primary md:text-2xl">Project Zomboid: Realism Overhaul</h1>
          <p className="text-sm text-muted-foreground">
            Target build {PZ_TARGET.build} · {PZ_TARGET.platform} · mod id <code className="font-mono">{PZ_TARGET.modId}</code> ·
            files in <code className="font-mono">{PZ_TARGET.modDir}/</code>
          </p>
        </header>

        <Section id="pz-overview" title="Overview">
          <ul className="space-y-2">
            {GOALS.map((g) => (
              <li key={g.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-mono">{g.label}</span>
                <StatusPill status={g.status} />
                <span className="text-muted-foreground">{g.note}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="pz-status" title="Honest status — what exists today">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {STATUS_BOARD.map((s) => (
              <li key={s.label} className="flex items-start gap-2 text-sm">
                <StatusPill status={s.status} />
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="pz-compat" title={`Compatibility matrix — docs read ${PZ_TARGET.docsCheckedOn}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3">Component</th>
                  <th scope="col" className="py-2 pr-3">Source says</th>
                  <th scope="col" className="py-2 pr-3">Verified here</th>
                  <th scope="col" className="py-2 pr-3">Risk</th>
                  <th scope="col" className="py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {COMPATIBILITY.map((c) => (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{c.component}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{c.documented}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{c.verified}</td>
                    <td className={`py-2 pr-3 font-mono text-xs ${c.risk === "high" ? "text-destructive" : "text-muted-foreground"}`}>{c.risk}</td>
                    <td className="py-2 text-muted-foreground">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="pz-progress" title={`Your progress — ${done.size} of ${total} ticked, saved on this device`}>
          {saveFailed && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              This browser would not save your ticks. They will be lost when you close the page.
            </p>
          )}
          <h3 className="mb-1 font-mono text-xs text-primary">Dependency and version checklist</h3>
          <div className="mb-4">
            {DEPENDENCY_CHECKLIST.map((item) => (
              <Check key={item.id} item={item} checked={done.has(item.id)} onToggle={() => toggle(item.id)} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!confirmReset ? (
              <button type="button" onClick={() => setConfirmReset(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border px-3 font-mono text-xs hover:bg-secondary/50">
                <RotateCcw size={14} /> Reset all ticks
              </button>
            ) : (
              <>
                <span className="text-sm">Clear every tick on this page?</span>
                <button type="button" onClick={reset} className="min-h-11 rounded-sm border border-destructive/60 px-3 font-mono text-xs text-destructive hover:bg-destructive/10">Yes, reset</button>
                <button type="button" onClick={() => setConfirmReset(false)} className="min-h-11 rounded-sm border border-border px-3 font-mono text-xs hover:bg-secondary/50">Keep them</button>
              </>
            )}
          </div>
        </Section>

        <Section id="pz-phases" title="Implementation phases">
          <ol className="space-y-4">
            {PHASES.map((p) => (
              <li key={p.id} className="rounded-sm border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-sm text-foreground">{p.title}</h3>
                  <StatusPill status={p.status} />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{p.side}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{p.summary}</p>
                <div className="mt-2">
                  {p.tasks.map((t) => (
                    <Check key={t.id} item={t} checked={done.has(t.id)} onToggle={() => toggle(t.id)} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="pz-links" title="Game, dependency docs and source">
          <ul className="grid gap-1 sm:grid-cols-2">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <ExternalLink size={14} className="shrink-0 text-primary" aria-hidden />
                  <span className="text-sm">
                    <span className="font-mono text-primary">{l.label}</span>
                    <span className="block text-xs text-muted-foreground">{l.what}</span>
                  </span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}
