import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callEdgeFunction } from "@/lib/edgeFunction";

interface Slot { slot: number; label: string; set: boolean }
interface Status { ok: boolean; error?: string; code?: string; slots?: Slot[]; locked_until?: string | null; unlocked_until?: string | null }

async function lock(body: Record<string, unknown>): Promise<Status & Record<string, unknown>> {
  try {
    const r = await callEdgeFunction("jackie-lock", body);
    return await r.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the lock." };
  }
}

/** Answers go straight to the lock and the field clears; nothing is kept in the page. */
export default function AnswerLock() {
  const [status, setStatus] = useState<Status | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setStatus(await lock({ action: "status" })), []);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async (slot: number) => {
    setBusy(true);
    const r = await lock({ action: "set", slot, answer: drafts[slot] ?? "" });
    setDrafts((d) => ({ ...d, [slot]: "" }));
    setMsg(r.ok ? `${r.saved} saved as a fingerprint.` : String(r.error));
    setBusy(false); refresh();
  };
  const ask = async () => {
    const r = await lock({ action: "challenge" });
    setQuestion(r.ok ? String(r.question) : null);
    setMsg(r.ok ? "" : String(r.error));
  };
  const verify = async () => {
    setBusy(true);
    const r = await lock({ action: "verify", answer: reply });
    setReply(""); setQuestion(null);
    setMsg(r.ok ? "Unlocked for 10 minutes." : String(r.error));
    setBusy(false); refresh();
  };

  const setCount = status?.slots?.filter((s) => s.set).length ?? 0;

  return (
    <main className="min-h-screen bg-background text-foreground p-6 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Jackie</Link>
        <h1 className="text-2xl font-semibold">Answer Lock</h1>
        <p className="text-sm text-muted-foreground">
          Seven slots, q1A–q7A. Only a scrambled fingerprint of each answer is saved, never the words.
          Jackie asks one at a time, rotating, and locks for 15 minutes after 3 wrong answers.
          This is an extra lock on top of your email sign-in.
        </p>
      </header>

      {status && !status.ok && <p role="alert" className="text-destructive text-sm">{status.error}</p>}
      {msg && <p role="status" className="text-sm border border-border rounded p-2">{msg}</p>}

      {status?.ok && (
        <>
          <section aria-label="Status" className="text-sm flex flex-wrap gap-4">
            <span>{setCount} of 7 set</span>
            {status.locked_until && <span className="text-destructive">Locked until {new Date(status.locked_until).toLocaleTimeString()}</span>}
            {status.unlocked_until && <span className="text-primary">Unlocked until {new Date(status.unlocked_until).toLocaleTimeString()}</span>}
          </section>

          <section aria-label="Test the lock" className="border border-border rounded-lg p-4 space-y-3">
            <h2 className="font-medium">Ask me</h2>
            {question ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); verify(); }}>
                <label className="sr-only" htmlFor="reply">{question}</label>
                <span className="font-mono self-center w-12">{question}</span>
                <Input id="reply" type="password" autoComplete="off" value={reply} onChange={(e) => setReply(e.target.value)} />
                <Button type="submit" disabled={busy || !reply}>Answer</Button>
              </form>
            ) : (
              <Button onClick={ask} disabled={setCount === 0 || !!status.locked_until}>Ask a question</Button>
            )}
          </section>

          <section aria-label="Set answers" className="space-y-2">
            <h2 className="font-medium">Set answers</h2>
            <p className="text-xs text-muted-foreground">Changing an answer that's already set needs a fresh unlock first.</p>
            {status.slots?.map((s) => (
              <form key={s.slot} className="flex gap-2 items-center" onSubmit={(e) => { e.preventDefault(); save(s.slot); }}>
                <label htmlFor={`slot-${s.slot}`} className="font-mono w-12">{s.label}</label>
                <Input id={`slot-${s.slot}`} type="password" autoComplete="off" placeholder={s.set ? "set — type to replace" : "not set"}
                  value={drafts[s.slot] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [s.slot]: e.target.value }))} />
                <Button type="submit" variant="secondary" disabled={busy || !(drafts[s.slot] ?? "").trim()}>Save</Button>
              </form>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
