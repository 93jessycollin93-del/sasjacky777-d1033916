/**
 * The Index Forge — where the pills are made.
 *
 * `contextRouter.ts` shipped four specialised indexes hard-coded: Recall,
 * Keeper, Operator, Maker. Each pairs a specialisation with the partitions it
 * reads, a small model, and the ladder of engines allowed to answer. The idea
 * was right and the authoring was not: a fifth meant editing TypeScript.
 *
 * This page is the same shape, authored at runtime. What it deliberately does
 * *not* do is let you save something that cannot answer — every draft goes
 * through `validateIndex`, which refuses an unknown model, a partition that
 * does not exist, an empty ladder or no keywords. Each of those would produce
 * an index that looks saved, appears in the launcher, and fails the first time
 * it is asked anything, which is the failure this whole codebase is organised
 * against.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Download, Plus, RefreshCw, Save, Trash2, Upload, Play, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MICRO_MODELS } from "@/lib/microai/models";
import { PARTITIONS } from "@/lib/partitions/registry";
import type { EngineLocality } from "@/lib/microai/contextRouter";
import { defaultEngines } from "@/lib/microai/contextRouterService";
import {
  emptyDraft, slugify, validateIndex,
  type CraftedIndex, type IndexDraft,
} from "@/lib/forge/types";
import { parseIndexes, serializeIndexes, suggestFilename } from "@/lib/forge/exchange";
import { deleteLocal, listLocal, saveLocal, syncIndexes } from "@/lib/forge/store";

const LOCALITIES: EngineLocality[] = ["device", "lan", "network"];

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</label>
    {children}
    {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
  </div>
);

export default function IndexForge() {
  const [indexes, setIndexes] = useState<CraftedIndex[]>([]);
  const [draft, setDraft] = useState<IndexDraft>(emptyDraft);
  const [problems, setProblems] = useState<string[]>([]);
  const [editingExisting, setEditingExisting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [testPrompt, setTestPrompt] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ text: string; engine: string } | null>(null);

  const reload = useCallback(() => setIndexes(listLocal()), []);
  useEffect(reload, [reload]);

  const set = <K extends keyof IndexDraft>(key: K, value: IndexDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const startNew = () => {
    setDraft(emptyDraft());
    setProblems([]);
    setEditingExisting(false);
    setTestResult(null);
  };

  const edit = (index: CraftedIndex) => {
    setDraft({ ...index });
    setProblems([]);
    setEditingExisting(true);
    setTestResult(null);
  };

  const save = () => {
    const verdict = validateIndex(draft) as {
      ok: boolean; index?: CraftedIndex; problems?: string[];
    };
    if (verdict.ok !== true || !verdict.index) {
      setProblems(verdict.problems ?? ["Refused."]);
      return;
    }
    setProblems([]);
    // `saveLocal` returns false when the write did not happen — a full or
    // unavailable store. Reporting a save that did not occur would lose
    // something the person wrote and tell them it was safe.
    if (!saveLocal(verdict.index)) {
      toast.error("Could not save: this browser refused to write to local storage.");
      return;
    }
    reload();
    setEditingExisting(true);
    toast.success(`Saved ${verdict.index.name}.`);
  };

  const remove = (index: CraftedIndex) => {
    if (!deleteLocal(index.id)) return;
    reload();
    if (draft.id === index.id) startNew();
    toast.success(`Deleted ${index.name}.`);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const report = await syncIndexes();
      reload();
      if (report.error) toast.error(report.error);
      else if (report.pushed || report.pulled) {
        toast.success(`Synced — ${report.pushed} up, ${report.pulled} down.`);
      } else {
        toast.success("Already in sync.");
      }
    } finally {
      setSyncing(false);
    }
  };

  const exportAll = () => {
    const blob = new Blob([serializeIndexes(indexes)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestFilename(indexes);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    const report = parseIndexes(await file.text());
    let saved = 0;
    for (const index of report.accepted) if (saveLocal(index)) saved += 1;
    reload();
    if (saved) toast.success(`Imported ${saved} index${saved === 1 ? "" : "es"}.`);
    // Refusals are named, never counted. "3 failed" tells the author nothing
    // they can fix.
    for (const reason of report.rejected) toast.error(reason);
    if (!saved && report.rejected.length === 0) toast.error("That file held no indexes.");
  };

  /**
   * Runs the draft against the real ladder.
   *
   * The engine that answers is named in the result, and it is whichever rung
   * was actually ready — not the first one the draft asked for. An index tested
   * against a cloud model and shipped as offline-first is exactly the kind of
   * lie the ladder exists to prevent.
   */
  const runTest = async () => {
    const verdict = validateIndex(draft) as { ok: boolean; index?: CraftedIndex; problems?: string[] };
    if (verdict.ok !== true || !verdict.index) {
      setProblems(verdict.problems ?? ["Refused."]);
      return;
    }
    if (!testPrompt.trim()) return;

    setTesting(true);
    setTestResult(null);
    try {
      const allowed = new Set(verdict.index.ladder);
      const engines = defaultEngines().filter((e) => allowed.has(e.locality));
      for (const engine of engines) {
        if (!(await engine.available())) continue;
        const answer = await engine.run(
          `${verdict.index.systemPrompt}\n\n${testPrompt.trim()}`,
          verdict.index.modelId,
        );
        setTestResult({ text: answer.text, engine: `${engine.name} · ${answer.model}` });
        return;
      }
      toast.error(
        `Nothing on this index's ladder (${verdict.index.ladder.join(" → ")}) is ready to answer.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The test failed.");
    } finally {
      setTesting(false);
    }
  };

  const modelsBySize = useMemo(() => [...MICRO_MODELS].sort((a, b) => a.sizeMB - b.sizeMB), []);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link to="/" className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Jackie
        </Link>
        <span className="font-mono text-xs uppercase tracking-widest text-foreground">Index Forge</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          <span className="ml-1.5 font-mono text-xs">Sync</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={exportAll} disabled={indexes.length === 0}>
          <Download size={14} /><span className="ml-1.5 font-mono text-xs">Export</span>
        </Button>
        <label className="inline-flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-muted-foreground hover:text-foreground">
          <Upload size={14} /><span className="ml-1.5 font-mono text-xs">Import</span>
          <input
            type="file" accept="application/json,.json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }}
          />
        </label>
      </header>

      <div className="grid gap-6 p-4 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-2">
          <Button onClick={startNew} variant="outline" size="sm" className="w-full justify-start">
            <Plus size={14} /><span className="ml-1.5 font-mono text-xs">New index</span>
          </Button>
          {indexes.length === 0 && (
            <p className="px-1 py-3 text-[11px] text-muted-foreground">
              Nothing crafted yet. An index is a specialisation, the partitions it reads, a small
              model, and the engines allowed to answer it.
            </p>
          )}
          {indexes.map((index) => (
            <div
              key={index.id}
              className={`flex items-start gap-2 rounded-md border p-2 transition-colors ${
                draft.id === index.id ? "border-primary/40 bg-secondary/40" : "border-border"
              }`}
            >
              <button onClick={() => edit(index)} className="flex flex-1 items-start gap-2 text-left">
                <span className="text-base leading-none">{index.glyph}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs text-foreground">{index.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{index.specialty}</span>
                </span>
              </button>
              <button
                onClick={() => remove(index)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${index.name}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </aside>

        <main className="max-w-2xl space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_80px]">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setDraft((prev) => ({
                    ...prev, name,
                    // The id follows the name until the index has been saved
                    // once; after that it is frozen, because it is what export
                    // files and synced rows are keyed by.
                    id: editingExisting ? prev.id : slugify(name),
                  }));
                }}
                placeholder="Field Notes"
              />
            </Field>
            <Field label="Glyph">
              <Input value={draft.glyph} onChange={(e) => set("glyph", e.target.value)} maxLength={2} />
            </Field>
          </div>

          <Field label="Id" hint={editingExisting ? "Frozen — export files and synced rows are keyed by it." : "Follows the name until first save."}>
            <Input value={draft.id} onChange={(e) => set("id", e.target.value)} disabled={editingExisting} />
          </Field>

          <Field label="Specialty" hint="The one kind of question this index is for.">
            <Input value={draft.specialty} onChange={(e) => set("specialty", e.target.value)} />
          </Field>

          <Field label="System prompt">
            <Textarea rows={4} value={draft.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
          </Field>

          <Field label="Keywords" hint="Comma separated. An intent matching one of these routes here.">
            <Input
              value={draft.keywords.join(", ")}
              onChange={(e) => set("keywords", e.target.value.split(",").map((k) => k.trim()).filter(Boolean))}
              placeholder="note, wrote, jotted"
            />
          </Field>

          <Field label="Reads" hint="Partitions it draws context from.">
            <div className="flex flex-wrap gap-1.5">
              {PARTITIONS.map((partition) => {
                const on = draft.reads.includes(partition.id);
                return (
                  <button
                    key={partition.id}
                    onClick={() => set("reads", on ? draft.reads.filter((r) => r !== partition.id) : [...draft.reads, partition.id])}
                    title={partition.purpose}
                    className={`rounded-sm border px-2 py-1 font-mono text-[10px] transition-colors ${
                      on ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    {partition.id}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Model">
            <select
              value={draft.modelId}
              onChange={(e) => set("modelId", e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
            >
              {modelsBySize.map((m) => (
                <option key={m.id} value={m.id}>{m.name} · {m.sizeLabel} · {m.type}</option>
              ))}
            </select>
          </Field>

          <Field label="Ladder" hint="Nearest first. The network never answers unless you put it here.">
            <div className="flex gap-1.5">
              {LOCALITIES.map((rung) => {
                const on = draft.ladder.includes(rung);
                return (
                  <button
                    key={rung}
                    onClick={() => set("ladder", on ? draft.ladder.filter((l) => l !== rung) : [...draft.ladder, rung])}
                    className={`rounded-sm border px-2.5 py-1 font-mono text-[10px] transition-colors ${
                      on ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    {rung}
                  </button>
                );
              })}
            </div>
          </Field>

          {problems.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-destructive">Not saved</p>
              <ul className="space-y-0.5 text-xs text-destructive">
                {problems.map((problem) => <li key={problem}>· {problem}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={save}><Save size={14} /><span className="ml-1.5">Save</span></Button>
          </div>

          <section className="space-y-3 rounded-md border border-border p-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Test bench — runs on this index's own ladder
            </p>
            <Textarea
              rows={2} value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Ask it something it should be good at…"
            />
            <Button size="sm" variant="outline" onClick={runTest} disabled={testing || !testPrompt.trim()}>
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              <span className="ml-1.5">Run</span>
            </Button>
            {testResult && (
              <div className="space-y-1 rounded-md bg-secondary/40 p-3">
                <p className="font-mono text-[10px] text-primary">answered by {testResult.engine}</p>
                <p className="whitespace-pre-wrap text-xs text-foreground">{testResult.text}</p>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
