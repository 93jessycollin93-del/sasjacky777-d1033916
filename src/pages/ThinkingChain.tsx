import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Brain, ImagePlus, FilePlus, Play, Square, Trash2, CheckCircle2, XCircle, Loader2, MinusCircle, Download, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { chatOnDevice } from "@/lib/microai/bonsaiDevice";
import { runChain, type Ask, type Source, type StepRecord } from "@/lib/microai/chain/chain";
import { describeImage, VISION_MODEL_NAME } from "@/lib/microai/chain/vision";
import { clearArchive } from "@/lib/microai/chain/archive";
import { activateWeights, planActivation, readWeightBlocks, type WeightBlock } from "@/lib/microai/activation";
import { DEVICE_BUDGET_MB } from "@/lib/microai/budget";
import { contextFor, dive, ledgerStatus, type LedgerStatus } from "@/lib/microai/ledger";

/** Bonsai on this device, one short step at a time, low randomness. */
const askBonsai: Ask = async ({ system, user, maxTokens }, signal) => {
  let text = "";
  const v = await chatOnDevice({
    system,
    messages: [{ role: "user", content: user }],
    onDelta: (d) => (text += d),
    maxTokens,
    temperature: 0.2,
    signal,
  });
  return v.ok ? { ok: true, text } : { ok: false, error: "error" in v ? String(v.error) : "Bonsai stopped." };
};

const icon = (s: StepRecord["status"]) =>
  s === "ok" ? <CheckCircle2 size={14} className="text-primary" /> :
  s === "failed" ? <XCircle size={14} className="text-destructive" /> :
  s === "skipped" ? <MinusCircle size={14} className="text-muted-foreground" /> :
  <Loader2 size={14} className="animate-spin text-muted-foreground" />;

export default function ThinkingChain() {
  const [question, setQuestion] = useState("");
  const [pasted, setPasted] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visionNote, setVisionNote] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef<AbortController | null>(null);
  const [blocks, setBlocks] = useState<WeightBlock[] | null>(null);
  const [activating, setActivating] = useState(false);
  const [progress, setProgress] = useState<Record<string, number | null>>({});
  const [activateNote, setActivateNote] = useState<string | null>(null);
  const plan = useMemo(() => (blocks ? planActivation(blocks) : null), [blocks]);
  const [ledger, setLedger] = useState<LedgerStatus | null>(null);
  const [diving, setDiving] = useState(false);
  const [diveNote, setDiveNote] = useState<string | null>(null);

  // How much of the conversation the fold has not absorbed yet. A slow dive is
  // the design, not a fallback: reading a week of history is allowed to take a
  // week, so the panel reports the distance rather than pretending to close it.
  useEffect(() => {
    let alive = true;
    ledgerStatus()
      .then((s) => { if (alive) setLedger(s); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const diveIntoHistory = async () => {
    setDiving(true);
    setDiveNote(null);
    const r = await dive(question.trim() || "everything so far", { maxFolds: 3 }).catch(
      (e) => ({ folds: 0, turns: 0, caughtUp: false, reason: `The dive could not run: ${e instanceof Error ? e.message : String(e)}` }),
    );
    setLedger(await ledgerStatus().catch(() => null));
    setDiving(false);
    setDiveNote(
      r.folds
        ? `Folded ${r.turns} turns into ${r.folds} note${r.folds === 1 ? "" : "s"}. ${r.caughtUp ? "The fold has reached the newest turn." : r.reason ?? ""}`
        : r.reason ?? "Nothing was folded.",
    );
  };

  // What this device already holds, asked once on open. The read is lazy on
  // purpose: it pulls in the inference runtime only to answer, so a page that
  // never gets pressed costs nothing.
  useEffect(() => {
    let alive = true;
    readWeightBlocks()
      .then((b) => { if (alive) setBlocks(b); })
      .catch((e) => {
        if (alive) setActivateNote(`Could not ask this device what it holds: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  // The owner's own click is the only thing that starts a download, and the
  // ceiling is the only thing that stops one. A failure names itself and leaves
  // the rest of the plan standing.
  const activate = async () => {
    setActivating(true);
    setActivateNote(null);
    const report = await activateWeights({
      onProgress: (block, fraction) => setProgress((p) => ({ ...p, [block.id]: fraction })),
    });
    const fresh = await readWeightBlocks().catch(() => null);
    if (fresh) setBlocks(fresh);
    setActivating(false);
    setActivateNote(
      report.errors.length
        ? report.errors.join(" ")
        : report.activated.length
          ? `On this device now: ${report.activated.join(", ")}.`
          : report.reason ?? "Nothing new was downloaded.",
    );
  };


  const run = async () => {
    const ac = new AbortController();
    stop.current = ac;
    setRunning(true);
    setAnswer(null);
    setError(null);
    setSteps([]);
    const sources: Source[] = [];
    // What has already been said arrives as a note, and only when there is
    // something to say. An empty note would be logged as a failed fetch and the
    // answer would carry a missing source nobody asked for.
    const prior = await contextFor(question, 1400).catch(() => "");
    if (prior.trim()) sources.push({ label: "Conversation ledger", kind: "text", fetch: async () => prior });
    if (pasted.trim()) sources.push({ label: "Pasted notes", kind: "text", fetch: async () => pasted });
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        sources.push({
          label: f.name,
          kind: "image",
          fetch: () =>
            describeImage(f, {
              onProgress: (p) => setVisionNote(`Downloading ${VISION_MODEL_NAME} (once)… ${p.fraction == null ? "" : Math.round(p.fraction * 100) + "%"}`),
            }).finally(() => setVisionNote(null)),
        });
      } else {
        sources.push({ label: f.name, kind: "file", fetch: () => f.text() });
      }
    }
    const r = await runChain({ question, sources, ask: askBonsai, onStep: setSteps, signal: ac.signal });
    if (r.ok) setAnswer(r.answer ?? "");
    else setError(r.error ?? "The chain stopped.");
    setRunning(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Link to="/micro" className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Micro-AI
        </Link>
        <Brain size={16} className="text-primary ml-2" />
        <h1 className="font-mono text-sm uppercase tracking-widest">Thinking Chain · offline</h1>
      </header>

      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Bonsai 1.7B answers in small steps on this device: fetch, archive, compress, plan, reason, combine, check.
          Photos are read by {VISION_MODEL_NAME}, also on this device. Both download once while online, then work offline.
        </p>

        <section className="border border-border rounded-sm p-3 bg-card space-y-2" aria-label="On this device">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-mono uppercase text-muted-foreground">On this device</h2>
            {plan && (
              <span className="ml-auto text-xs font-mono text-muted-foreground">
                {plan.usedMB} of {DEVICE_BUDGET_MB.total} MB used · {plan.headroomMB} MB spare
              </span>
            )}
          </div>

          {blocks === null && !activateNote && (
            <p className="text-xs font-mono text-muted-foreground">Asking this device what it holds…</p>
          )}

          {blocks?.map((b) => (
            <div key={b.id} className="flex items-start gap-2 text-xs font-mono">
              {b.present ? (
                <CheckCircle2 size={14} className="text-primary mt-0.5 shrink-0" />
              ) : (
                <XCircle size={14} className="text-destructive mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <p>
                  {b.name} · {b.mb} MB
                  {progress[b.id] != null && progress[b.id] < 1 && ` · ${Math.round((progress[b.id] ?? 0) * 100)}%`}
                </p>
                <p className="text-muted-foreground whitespace-pre-wrap">{b.detail}</p>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={activate} disabled={activating || !plan?.missing.length}>
              {activating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {plan?.missing.length ? `Activate ${plan.missing.length} missing` : "Everything is on this device"}
            </Button>
            {activating && (
              <Button size="sm" variant="ghost" onClick={() => stop.current?.abort()}>
                <Square size={14} /> Stop
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={diveIntoHistory} disabled={diving || !ledger?.unfolded}>
              {diving ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
              {ledger?.unfolded ? `Read ${Math.min(ledger.unfolded, 24)} older turns` : "Nothing older to read"}
            </Button>
            {ledger && (
              <span className="text-xs font-mono text-muted-foreground">
                {ledger.turns} turns · {ledger.folds} folds · {ledger.chars.toLocaleString()} characters kept{" "}
                {ledger.where === "device" ? "on this device" : "in memory only"}
              </span>
            )}
          </div>
          {diveNote && <p className="text-xs font-mono text-muted-foreground">{diveNote}</p>}

          {plan?.refused.length ? (
            <p className="text-xs font-mono text-destructive" role="alert">
              Kept out by the {DEVICE_BUDGET_MB.total} MB ceiling: {plan.refused.map((b) => b.name).join(", ")} — {plan.reason}
            </p>
          ) : null}

          {activateNote && <p className="text-xs font-mono text-muted-foreground">{activateNote}</p>}
        </section>


        <label className="block space-y-1">
          <span className="text-xs font-mono uppercase text-muted-foreground">Question</span>
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="Why won't my NVMe drive show up?" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-mono uppercase text-muted-foreground">Notes (optional — logs, errors, anything)</span>
          <Textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <ImagePlus size={16} /> Photo
              <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
            </label>
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <FilePlus size={16} /> Text file
              <input type="file" accept=".txt,.md,.markdown,.log,.json,.csv" multiple hidden onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
            </label>
          </Button>
          {files.map((f, i) => (
            <button key={i} type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
              className="text-xs font-mono px-2 py-1 rounded-sm bg-secondary hover:bg-destructive/20" title="Remove">
              {f.name} ×
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {running ? (
            <Button variant="destructive" onClick={() => stop.current?.abort()}><Square size={16} /> Stop</Button>
          ) : (
            <Button onClick={run} disabled={!question.trim()}><Play size={16} /> Run chain</Button>
          )}
          <Button variant="ghost" onClick={() => clearArchive()} title="Delete archived originals from this device">
            <Trash2 size={16} /> Clear archive
          </Button>
        </div>

        {visionNote && <p className="text-xs font-mono text-muted-foreground">{visionNote}</p>}

        {steps.length > 0 && (
          <ol className="space-y-2" aria-label="Chain steps">
            {steps.map((s) => (
              <li key={s.id} className="border border-border rounded-sm p-3 bg-card">
                <div className="flex items-center gap-2 text-sm font-mono">
                  {icon(s.status)} <span>{s.title}</span>
                  {s.ms != null && <span className="ml-auto text-xs text-muted-foreground">{(s.ms / 1000).toFixed(1)}s</span>}
                </div>
                {s.output && <pre className="mt-2 text-xs whitespace-pre-wrap">{s.output}</pre>}
                {s.error && <p className="mt-2 text-xs text-destructive">{s.error}</p>}
                {s.input && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer">What it read ({s.input.length} chars)</summary>
                    <pre className="text-xs whitespace-pre-wrap text-muted-foreground">{s.input}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}

        {answer !== null && (
          <section className="border border-primary/50 rounded-sm p-3">
            <h2 className="text-xs font-mono uppercase text-primary mb-1">Answer</h2>
            <p className="text-sm whitespace-pre-wrap">{answer}</p>
          </section>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </main>
    </div>
  );
}
