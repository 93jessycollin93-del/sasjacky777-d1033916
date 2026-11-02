import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown, ArrowUp, Check, CircleAlert, CircleCheck, CircleHelp, Info, Lock, Pencil, Plus,
  RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, Stamp, Trash2, X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  addMoral, addSuggested, assessIntegrity, buildMoralsBlock, checkWitness, deleteMoral, errorOf, fetchStatus,
  lineDiff, loadAttestations, loadLedger, loadMorals, MORAL_CATEGORIES, MORAL_LIMITS, parsePayload,
  moveMoral, readAnchor, readWitness, replayMorals, sealNow, setMoralEnabled, signedOf, updateMoral, verifyLedger,
  writeAnchor, writeWitness,
  type Assessment, type CheckState, type LedgerRow, type MoralCategory, type MoralDraft, type MoralRow,
  type PersonaStatus, type Result,
} from "@/lib/jackie-morals";

/**
 * Jackie's morals, and the guard rail that shows whether anything touched them.
 *
 * Owner-only, like Jackie Core, and for the same reason: the gate that matters
 * is RLS in the database. A visitor without the owner role gets empty results
 * from the API, not a hidden div — this page only presents that fact.
 */

// No success/warning tokens exist in this theme, so these are the palette
// shades used elsewhere in the app, paired for light and dark.
const TONE: Record<CheckState | "setup", { text: string; bg: string; border: string; label: string }> = {
  ok: { text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Intact" },
  info: { text: "text-muted-foreground", bg: "bg-muted/40", border: "border-border", label: "Note" },
  warn: { text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Needs you" },
  fail: { text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/40", label: "Changed / failed" },
  setup: { text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", label: "Not set up" },
};

function StateIcon({ state, className = "w-4 h-4" }: { state: CheckState; className?: string }) {
  const tone = TONE[state].text;
  if (state === "ok") return <CircleCheck className={`${className} ${tone}`} aria-label="ok" />;
  if (state === "warn") return <CircleAlert className={`${className} ${tone}`} aria-label="needs attention" />;
  if (state === "fail") return <CircleAlert className={`${className} ${tone}`} aria-label="failed" />;
  return <Info className={`${className} ${tone}`} aria-label="note" />;
}

type Loaded = {
  status: Result<PersonaStatus>;
  morals: Result<MoralRow[]>;
  ledger: Result<LedgerRow[]>;
  assessment: Assessment;
};

// Fingerprints are shortened; the markers an engine reports instead of one
// ("none", "unavailable", "n/a") are words, and cutting them reads as a hash.
const short = (s: string | null | undefined, n = 12) => (!s ? "—" : s.length < 32 ? s : s.slice(0, n));

export default function JackieMorals() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Each check is numbered; only the newest may land. An older one finishing
  // last would show a stale ledger and — worse — compare it against a witness
  // a newer check had already moved, raising "entries were removed" for nothing.
  const generation = useRef(0);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sealOpen, setSealOpen] = useState(false);
  const [sealNote, setSealNote] = useState("");

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setChecking(true);
    try {
      const [status, morals, ledger, attestations] = await Promise.all([
        fetchStatus(), loadMorals(), loadLedger(), loadAttestations(),
      ]);
      const witnessed = readWitness();
      const anchor = readAnchor();
      const chain = ledger.ok ? await verifyLedger(ledger.data, anchor) : null;
      const witness = ledger.ok ? checkWitness(witnessed, ledger.data) : { state: "none" as const };
      const replay = ledger.ok && chain?.ok ? await replayMorals(ledger.data, anchor) : null;
      if (mine !== generation.current) return;
      const assessment = assessIntegrity({
        status, ledger, attestations, chain, witness, replay, seenBefore: !!(witnessed || anchor),
      });
      // Move the witness forward only over a history that verified. Advancing it
      // past a failure would make the alarm disappear on the next reload.
      if (chain?.ok && chain.head && (witness.state === "ok" || witness.state === "none")) {
        writeWitness({ seq: chain.head.seq, hash: chain.head.hash, at: new Date().toISOString() });
      }
      setData({ status, morals, ledger, assessment });
      setLoadError(null);
    } catch (e) {
      // Not "Checking…" for ever: say what stopped the check.
      if (mine === generation.current) setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === generation.current) setChecking(false);
    }
  }, []);

  // Keyed on the account id, not the user object: the session refreshes when
  // the tab regains focus, which hands over a new object for the same person
  // and re-ran the whole check every time.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (loading) return;
    if (!userId) {
      setIsOwner(false);
      return;
    }
    (async () => {
      const { data: roles, error } = await (supabase as unknown as { from: (t: string) => any })
        .from("user_roles").select("role").eq("user_id", userId);
      if (error) {
        // A failed lookup is not an answer. Telling the real owner they are not
        // the owner would send them off to claim a seat they already hold.
        setRoleError(error.message ?? String(error));
        setIsOwner(null);
        return;
      }
      setRoleError(null);
      const owner = ((roles ?? []) as { role: string }[]).some((r) => r.role === "owner");
      setIsOwner(owner);
      if (owner) await refresh();
    })();
  }, [loading, userId, refresh]);

  const run = useCallback(async (label: string, op: () => Promise<Result<unknown>>) => {
    setBusy(true);
    try {
      const res = await op();
      if (!res.ok) toast({ title: `${label} failed`, description: errorOf(res) ?? undefined, variant: "destructive" });
      await refresh();
      return res.ok;
    } finally {
      setBusy(false);
    }
  }, [refresh, toast]);

  const doSeal = async () => {
    const shown = data?.status.ok ? data.status.data : null;
    if (!shown) return;
    const ok = await run("Sealing", () =>
      sealNow(sealNote, { persona_fp: shown.persona.fingerprint, morals_fp: shown.morals.fingerprint }));
    if (ok) {
      toast({ title: "Sealed", description: "Every later change will be measured from this point." });
      setSealOpen(false);
      setSealNote("");
    }
  };

  /**
   * The owner's way forward after a break or a rewrite: trust the history as it
   * stands. Checking restarts from its current end, with the morals as they are
   * now, and nothing sealed before it is relied on — the owner seals again.
   * An empty history has no end to trust from, so the witness is simply cleared.
   */
  const trustCurrentHistory = () => {
    const rows = data?.ledger.ok ? data.ledger.data : [];
    const head = rows[rows.length - 1];
    const now = new Date().toISOString();
    if (!head) {
      writeWitness(null);
      writeAnchor(null);
    } else {
      const current = data?.morals.ok ? data.morals.data : [];
      writeAnchor({
        seq: head.seq, hash: head.hash, at: now,
        morals: current.map(({ id, title, rule, category, enabled, sort_order }) => ({ id, title, rule, category, enabled, sort_order })),
      });
      writeWitness({ seq: head.seq, hash: head.hash, at: now });
    }
    toast({ title: "Trusting the history from here", description: "Seal again once you have reviewed the persona and your morals." });
    refresh();
  };

  if (roleError) {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-destructive/40 bg-destructive/10 p-6 space-y-3 text-center">
          <h1 className="text-lg font-semibold text-foreground">Could not check who you are</h1>
          <p className="text-sm text-muted-foreground break-words">
            Asking the database whether this account holds the owner seat failed: {roleError}. That is not the same as
            the answer being no — try again.
          </p>
          <Button onClick={() => window.location.reload()} className="min-h-11">Try again</Button>
        </div>
      </div>
    );
  }

  if (loading || isOwner === null) {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-[70dvh] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-6 space-y-4 text-center">
          <div className="h-12 w-12 mx-auto rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Jackie's morals are the owner's to set</h1>
          <p className="text-sm text-muted-foreground">
            Only the account holding the owner seat can see or change them. Claim the seat from Jackie Core first.
          </p>
          <Button asChild className="w-full min-h-11"><Link to="/core">Go to Jackie Core</Link></Button>
        </div>
      </div>
    );
  }

  const a = data?.assessment;
  const morals = data?.morals.ok ? data.morals.data : [];
  const status = data?.status.ok ? data.status.data : null;
  const ledgerRows = data?.ledger.ok ? data.ledger.data : [];
  const witnessFailed = a?.witness.state === "shorter" || a?.witness.state === "rewritten";
  const chainBroken = !!a?.chain && "reason" in a.chain;

  return (
    // pb-36 keeps the last entry clear of the floating nav bar, which sits
    // fixed over the bottom of every page.
    <div className="max-w-5xl mx-auto px-4 pt-6 pb-36 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Jackie's morals</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            What Jackie holds to, set by you — and a guard rail that shows what every engine actually ran, and
            whether anything changed that you did not approve.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} disabled={checking || busy} className="min-h-10">
            <RefreshCw className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`} /> Re-check
          </Button>
          <Button
            onClick={() => setSealOpen(true)}
            disabled={!a || a.verdict === "setup" || busy || !status || chainBroken}
            title={chainBroken ? "Sealing on a broken history would mean nothing; trust it from its current end first." : undefined}
            className="min-h-10"
          >
            <Stamp className="w-4 h-4 mr-2" /> Seal current state
          </Button>
        </div>
      </header>

      {loadError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground break-words" role="alert">
          The check could not finish: {loadError}
        </div>
      )}

      {!a ? (
        !loadError && <div className="rounded-xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">Checking…</div>
      ) : (
        <Verdict assessment={a} />
      )}

      {(witnessFailed || chainBroken) && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm space-y-2">
          <p className="text-foreground">
            This browser will keep raising the alarm above until you decide. Once you have found out why the history
            {chainBroken ? " broke" : " changed"} and are satisfied, you can trust it as it stands now: checking restarts
            from its current end, and you seal again.
          </p>
          <Button size="sm" variant="outline" onClick={trustCurrentHistory}>I've checked — trust the history from here</Button>
        </div>
      )}

      {a && a.checks[0]?.id !== "setup" && (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Checks</TabsTrigger>
            <TabsTrigger value="morals">Morals ({morals.length})</TabsTrigger>
            <TabsTrigger value="engines">Engines</TabsTrigger>
            <TabsTrigger value="history">History ({ledgerRows.length})</TabsTrigger>
            <TabsTrigger value="persona">Persona</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            {a.checks.map((c) => (
              <div key={c.id} className={`rounded-xl border p-4 flex gap-3 ${TONE[c.state].border} ${TONE[c.state].bg}`}>
                <StateIcon state={c.state} className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{c.title}</div>
                  <p className="text-sm text-muted-foreground break-words">{c.summary}</p>
                </div>
              </div>
            ))}
            <Limits />
          </TabsContent>

          <TabsContent value="morals">
            <MoralsEditor morals={morals} busy={busy} run={run} loadError={data ? errorOf(data.morals) : null} />
          </TabsContent>

          <TabsContent value="engines" className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Each engine reports, on every request, the fingerprint of the persona and morals it actually sent. These
              are those reports — not what the code is supposed to do, but what it did.
            </p>
            {a.engines.map((e) => (
              <div key={e.engine} className={`rounded-xl border p-3 ${TONE[e.state].border} ${TONE[e.state].bg}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <StateIcon state={e.state} />
                  <span className="font-mono text-sm text-foreground">{e.engine}</span>
                  {e.personaFp && (
                    <Badge variant="outline" className="font-mono text-[11px]" title="persona fingerprint">persona {short(e.personaFp, 8)}</Badge>
                  )}
                  {e.moralsFp && (
                    <Badge variant="outline" className="font-mono text-[11px]" title="morals fingerprint">morals {short(e.moralsFp, 8)}</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 break-words">{e.summary}</p>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="history">
            <History
              rows={ledgerRows}
              brokenAt={a.chain && "brokenAt" in a.chain ? a.chain.brokenAt : null}
              anchoredAt={a.chain && "anchoredAt" in a.chain ? a.chain.anchoredAt : null}
              sealSeq={a.seal?.seq ?? null}
              me={user?.id ?? null}
            />
          </TabsContent>

          <TabsContent value="persona">
            <PersonaView status={status} assessment={a} />
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog open={sealOpen} onOpenChange={setSealOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seal Jackie as she is now?</AlertDialogTitle>
            <AlertDialogDescription>
              You are approving the persona the server is running (fingerprint {short(status?.persona.fingerprint)}) and
              your {status?.morals.enabled ?? 0} enabled {status?.morals.enabled === 1 ? "moral" : "morals"} (fingerprint{" "}
              {short(status?.morals.fingerprint)}). The seal goes into the history; anything that differs later shows
              here as a change. Review the Persona and Morals tabs first if you have not.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={sealNote}
            onChange={(e) => setSealNote(e.target.value.slice(0, 200))}
            placeholder="Optional note, e.g. “after the honesty rewrite”"
            className="min-h-20"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doSeal(); }} disabled={busy}>
              Seal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Verdict({ assessment }: { assessment: Assessment }) {
  const v = assessment.verdict;
  const tone = TONE[v];
  const Icon = v === "ok" ? ShieldCheck : v === "fail" ? ShieldAlert : v === "setup" ? ShieldQuestion : ShieldAlert;
  return (
    <section className={`rounded-2xl border p-5 flex gap-4 items-start ${tone.border} ${tone.bg}`} aria-live="polite">
      <Icon className={`w-9 h-9 shrink-0 ${tone.text}`} />
      <div className="space-y-1 min-w-0">
        <div className={`text-xs font-semibold uppercase tracking-wide ${tone.text}`}>{tone.label}</div>
        <p className="text-base font-medium text-foreground">{assessment.headline}</p>
        {assessment.checks[0]?.id === "setup" && <p className="text-sm text-muted-foreground">{assessment.checks[0].summary}</p>}
        {assessment.seal && (
          <p className="text-xs text-muted-foreground">
            Last sealed {new Date(assessment.seal.at).toLocaleString()} (entry #{assessment.seal.seq})
            {assessment.seal.note ? ` — “${assessment.seal.note}”` : ""}
          </p>
        )}
      </div>
    </section>
  );
}

function Limits() {
  return (
    <details className="rounded-xl border border-border bg-card/40 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-foreground flex items-center gap-2">
        <CircleHelp className="w-4 h-4" /> What this can and cannot see
      </summary>
      <ul className="mt-3 space-y-2 text-muted-foreground list-disc pl-5">
        <li>
          Every change to your morals is chained by the database itself, whoever makes it — this page, the SQL editor, a
          migration or an agent that found a token. Changes with no signed-in account behind them are flagged.
        </li>
        <li>
          Someone with full database access can switch the history's triggers off. Changing your morals that way is
          caught: rebuilding them from their history no longer gives what the database holds. Rewriting the history
          itself so it checks out again is caught by this browser only if it looked before the rewrite — it remembers
          the last entry it verified.
        </li>
        <li>
          Jacky — the rig, first in the chat's chain — gets your morals in front of its prompt and reports like the
          other engines, but its persona lives on the rig, where this app cannot see or fingerprint it.
        </li>
        <li>
          The persona comes from code. A deploy that changes it shows up here as a change from your seal, with the diff.
          Code that lies about its own fingerprint cannot be caught from inside the app; git history and CI are the
          anchor for that.
        </li>
        <li>
          Agents with their own system prompt (Agent Lab, in-app operators) do not get your morals — adding prose to a
          prompt that must answer in strict JSON breaks them. Their requests are counted under Engines so you can see
          how often that happens.
        </li>
      </ul>
    </details>
  );
}

const EMPTY_DRAFT: MoralDraft = { title: "", rule: "", category: "custom" };

function MoralsEditor({
  morals, busy, run, loadError,
}: {
  morals: MoralRow[];
  busy: boolean;
  run: (label: string, op: () => Promise<Result<unknown>>) => Promise<boolean>;
  loadError: string | null;
}) {
  const [draft, setDraft] = useState<MoralDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MoralDraft>(EMPTY_DRAFT);
  const [confirmDelete, setConfirmDelete] = useState<MoralRow | null>(null);
  const block = useMemo(() => buildMoralsBlock(morals), [morals]);
  const full = morals.length >= MORAL_LIMITS.maxMorals;

  if (loadError) {
    return <p className="text-sm text-destructive">Could not load your morals: {loadError}</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Your morals are added to Jackie's persona on every engine. They add to her honesty rules and cannot switch them
        off — a moral that asked her to mislead you would be named, not followed.
      </p>

      {morals.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 text-sm space-y-3">
          <p className="text-muted-foreground">No morals yet. Start from a suggested set and edit it, or write your own below.</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run("Adding suggestions", () => addSuggested(morals))}>
            <Plus className="w-4 h-4 mr-2" /> Add the suggested morals
          </Button>
        </div>
      )}

      <ol className="space-y-2">
        {morals.map((m, i) => (
          <li key={m.id} className={`rounded-xl border border-border p-3 ${m.enabled ? "bg-card/60" : "bg-muted/30 opacity-75"}`}>
            {editing === m.id ? (
              <MoralForm
                draft={editDraft}
                onChange={setEditDraft}
                busy={busy}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async () => {
                  if (await run("Saving", () => updateMoral(m.id, { ...editDraft, enabled: m.enabled }))) setEditing(null);
                }}
              />
            ) : (
              <div className="flex gap-3 items-start">
                <Switch
                  checked={m.enabled}
                  disabled={busy}
                  onCheckedChange={(on) => run(on ? "Enabling" : "Disabling", () => setMoralEnabled(m.id, on))}
                  aria-label={m.enabled ? `Disable ${m.title}` : `Enable ${m.title}`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{m.title}</span>
                    <Badge variant="secondary" className="text-[11px]">{m.category}</Badge>
                    {!m.enabled && <Badge variant="outline" className="text-[11px]">off</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground break-words">{m.rule}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                  <Button size="icon" variant="ghost" disabled={busy || i === 0} aria-label={`Move “${m.title}” up`}
                    onClick={() => run("Reordering", () => moveMoral(morals, i, -1))}><ArrowUp className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" disabled={busy || i === morals.length - 1} aria-label={`Move “${m.title}” down`}
                    onClick={() => run("Reordering", () => moveMoral(morals, i, 1))}><ArrowDown className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={`Edit “${m.title}”`}
                    onClick={() => { setEditing(m.id); setEditDraft({ title: m.title, rule: m.rule, category: m.category }); }}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={`Delete “${m.title}”`} onClick={() => setConfirmDelete(m)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-border p-4 space-y-3">
        <h2 className="font-medium text-foreground">Add a moral</h2>
        {full ? (
          <p className="text-sm text-muted-foreground">
            Jackie holds at most {MORAL_LIMITS.maxMorals} morals — they ride on every message, including to small local
            models. Remove one to add another.
          </p>
        ) : (
          <MoralForm
            draft={draft}
            onChange={setDraft}
            busy={busy}
            submitLabel="Add"
            onSubmit={async () => {
              if (await run("Adding", () => addMoral(draft, morals))) setDraft(EMPTY_DRAFT);
            }}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium text-foreground">Exactly what every engine adds</h2>
        {block ? (
          <pre className="rounded-xl border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words text-foreground">{block}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing — no morals are enabled, so Jackie runs on her base persona alone.</p>
        )}
      </section>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Jackie stops following it on her next message. The deletion, and the moral's text, stay in the history.
              To pause it instead, switch it off.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) run("Deleting", () => deleteMoral(target.id));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MoralForm({
  draft, onChange, onSubmit, onCancel, busy, submitLabel,
}: {
  draft: MoralDraft;
  onChange: (d: MoralDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  busy: boolean;
  submitLabel: string;
}) {
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          placeholder="Title, e.g. Ask before the irreversible"
          maxLength={MORAL_LIMITS.maxTitle}
          aria-label="Title"
        />
        <Select value={draft.category} onValueChange={(v) => onChange({ ...draft, category: v as MoralCategory })}>
          <SelectTrigger className="sm:w-40" aria-label="Category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MORAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={draft.rule}
        onChange={(e) => onChange({ ...draft, rule: e.target.value })}
        placeholder="The rule, as you would say it to her: what to do, and when."
        maxLength={MORAL_LIMITS.maxRule}
        className="min-h-20"
        aria-label="Rule"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{draft.rule.trim().length}/{MORAL_LIMITS.maxRule}</span>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={busy || !draft.title.trim() || !draft.rule.trim()}>
            <Check className="w-4 h-4 mr-1" /> {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

function History({ rows, brokenAt, anchoredAt, sealSeq, me }: {
  rows: LedgerRow[]; brokenAt: number | null; anchoredAt: number | null; sealSeq: number | null; me: string | null;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No changes yet.</p>;
  return (
    <ol className="space-y-2">
      {[...rows].reverse().map((r) => {
        const p = parsePayload(r);
        const before = p.before as Record<string, unknown> | null | undefined;
        const after = p.after as Record<string, unknown> | null | undefined;
        const title = String((after ?? before)?.title ?? "");
        const suspect = brokenAt !== null && r.seq >= brokenAt;
        const accepted = anchoredAt !== null && r.seq <= anchoredAt;
        // Who and when come from the hashed record, not the editable columns.
        const signed = signedOf(r);
        const who = signed.actor === null ? "no account (service role / SQL)" : signed.actor === me ? "you" : `account ${signed.actor.slice(0, 8)}`;
        return (
          <li key={r.seq} className={`rounded-xl border p-3 text-sm ${suspect ? "border-destructive/40 bg-destructive/10" : signed.actor === null ? "border-destructive/30" : "border-border"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">#{r.seq}</span>
              <Badge variant={r.action === "seal" ? "default" : "secondary"} className="text-[11px]">{r.action}</Badge>
              {title && <span className="font-medium text-foreground">{title}</span>}
              {r.seq === sealSeq && <Badge variant="outline" className="text-[11px]">current seal</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{new Date(signed.at).toLocaleString()} · {who}</span>
            </div>
            {r.action === "update" && before && after && <FieldChanges before={before} after={after} />}
            {r.action === "create" && after && <p className="text-muted-foreground mt-1 break-words">{String(after.rule ?? "")}</p>}
            {r.action === "delete" && before && <p className="text-muted-foreground mt-1 line-through break-words">{String(before.rule ?? "")}</p>}
            {r.action === "seal" && (
              <p className="text-muted-foreground mt-1">
                Sealed persona {short(String(p.persona_fp ?? ""), 8)} and morals {short(String(p.morals_fp ?? ""), 8)}
                {typeof p.note === "string" ? ` — “${p.note}”` : ""}
              </p>
            )}
            {suspect && <p className="text-destructive text-xs mt-1">Not verifiable: the chain breaks at or before this entry.</p>}
            {accepted && <p className="text-muted-foreground text-xs mt-1">Before the point you chose to trust the history from: accepted, not re-verified.</p>}
            <p className="font-mono text-[10px] text-muted-foreground mt-1 break-all">hash {r.hash.slice(0, 16)}… ← {r.prev_hash.slice(0, 16)}…</p>
          </li>
        );
      })}
    </ol>
  );
}

const SHOWN_FIELDS = ["title", "rule", "category", "enabled", "sort_order"];

function FieldChanges({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const changed = SHOWN_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  if (changed.length === 0) return <p className="text-muted-foreground mt-1">Saved with no visible change.</p>;
  return (
    <ul className="mt-1 space-y-1">
      {changed.map((f) => (
        <li key={f} className="break-words">
          <span className="text-muted-foreground">{f}: </span>
          <span className="line-through text-destructive/80">{String(before[f])}</span>
          <span className="text-muted-foreground"> → </span>
          <span className="text-foreground">{String(after[f])}</span>
        </li>
      ))}
    </ul>
  );
}

function PersonaView({ status, assessment }: { status: PersonaStatus | null; assessment: Assessment }) {
  if (!status) return <p className="text-sm text-destructive">Could not load the live persona from the server.</p>;
  const seal = assessment.seal;
  const changed = seal && seal.persona_text && seal.persona_fp !== status.persona.fingerprint;
  const moralsChanged = seal && seal.morals_fp !== status.morals.fingerprint;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Jackie's persona is code (<span className="font-mono">supabase/functions/_shared/persona.ts</span>), shared by
        every engine. Live fingerprint <span className="font-mono">{short(status.persona.fingerprint, 16)}</span>
        {seal ? <>; sealed <span className="font-mono">{short(seal.persona_fp, 16)}</span>.</> : "."}
      </p>
      {changed ? (
        <DiffView title="Persona: changes since your seal" before={seal.persona_text} after={status.persona.text} />
      ) : (
        <pre className="rounded-xl border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words text-foreground max-h-[60vh] overflow-auto">
          {status.persona.text}
        </pre>
      )}
      {moralsChanged && (
        <DiffView title="Morals block: changes since your seal" before={seal.morals_block} after={status.morals.block} />
      )}
    </div>
  );
}

function DiffView({ title, before, after }: { title: string; before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-foreground">{title}</h3>
      <div className="rounded-xl border border-border overflow-auto max-h-[60vh] text-xs font-mono">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`px-3 py-0.5 whitespace-pre-wrap break-words ${
              l.kind === "added" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : l.kind === "removed" ? "bg-destructive/10 text-destructive line-through"
                  : "text-muted-foreground"
            }`}
          >
            {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}{l.text || " "}
          </div>
        ))}
      </div>
    </section>
  );
}
