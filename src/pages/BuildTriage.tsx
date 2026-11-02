/**
 * Paste build errors, get them grouped by root cause with ranked fixes.
 * A failed call says why in words — never an empty "all clear" (rule 8).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { callEdgeFunction, describeEdgeFailure } from "@/lib/edgeFunction";

interface Group {
  title: string; priority: number; severity: string; cause: string;
  confidence: string; locations?: string[]; fix: string; count?: number;
}
interface Triage { summary: string; groups: Group[]; model: string }

export default function BuildTriage() {
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Triage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await callEdgeFunction("build-triage", { log });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Triage failed (${res.status}).`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error && !/fetch/i.test(e.message) ? e.message : describeEdgeFailure(e, "build-triage"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Build error triage</h1>
        <Link to="/repair" className="text-sm text-muted-foreground underline">Repair Bay</Link>
      </div>
      <p className="text-sm text-muted-foreground">
        Paste the build output. Related failures are grouped, likely causes explained, and fixes ranked — fix the first one first.
      </p>
      <Textarea
        value={log}
        onChange={(e) => setLog(e.target.value)}
        placeholder="error TS2304: Cannot find name 'foo'…"
        className="min-h-56 font-mono text-xs"
      />
      <div className="flex gap-2">
        <Button className="min-h-11" onClick={run} disabled={busy || !log.trim()}>
          {busy ? "Reading the errors…" : "Triage errors"}
        </Button>
        <Button variant="outline" className="min-h-11" onClick={() => { setLog(""); setResult(null); setError(null); }} disabled={busy}>
          Clear
        </Button>
      </div>

      {error && <Card className="border-destructive p-3 text-sm text-destructive">{error}</Card>}

      {result && (
        <section className="space-y-3">
          <Card className="p-3 text-sm">
            <p>{result.summary}</p>
            <p className="mt-1 text-xs text-muted-foreground">{result.groups.length} group(s) · {result.model}</p>
          </Card>
          {result.groups.map((g, i) => (
            <Card key={i} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>#{i + 1}</Badge>
                <h2 className="font-medium">{g.title}</h2>
                <Badge variant={g.severity === "warning" ? "secondary" : "destructive"}>{g.severity}</Badge>
                {g.count ? <Badge variant="outline">{g.count} error(s)</Badge> : null}
                <Badge variant="outline">{g.confidence} confidence</Badge>
              </div>
              <p className="text-sm"><span className="font-medium">Likely cause: </span>{g.cause}</p>
              {g.locations?.length ? (
                <p className="font-mono text-xs text-muted-foreground">{g.locations.join(" · ")}</p>
              ) : null}
              <p className="whitespace-pre-wrap text-sm"><span className="font-medium">Fix: </span>{g.fix}</p>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
