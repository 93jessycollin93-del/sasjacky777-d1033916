import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildMicroBoard, boardToCsv } from "@/lib/microai/board";
import { readMicroLog } from "@/lib/microai/router";
import { readSettings } from "@/lib/microai/settings";
import { Gauge, RefreshCw, Download } from "lucide-react";

function ago(ts: number | null) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function MicroBoard() {
  const [tick, setTick] = useState(0);
  const rows = useMemo(() => buildMicroBoard(readMicroLog()), [tick]);
  const active = readSettings().modelId;
  const used = rows.filter((r) => r.runs > 0);

  const download = () => {
    const blob = new Blob([boardToCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `micro-models-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl text-foreground flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" /> Micro-Model Board
          </h1>
          <p className="text-xs text-muted-foreground">
            Every model's last run, response time and token count — measured on this device, nothing estimated.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setTick((t) => t + 1)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" variant="outline" className="min-h-11" onClick={download} disabled={!used.length}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
          <Button size="sm" className="min-h-11" asChild>
            <Link to="/micro">Open /micro</Link>
          </Button>
        </div>
      </div>

      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider">
            Measured models ({used.length} of {rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/40">
                  <th className="p-3">Model</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Last run</th>
                  <th className="p-3">Last time</th>
                  <th className="p-3">Last tokens</th>
                  <th className="p-3">Avg time</th>
                  <th className="p-3">Avg tokens</th>
                  <th className="p-3">Best tok/s</th>
                  <th className="p-3">Runs</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/20 align-top">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{r.name}</span>
                        {r.id === active && <Badge variant="outline" className="text-[9px]">active</Badge>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{r.family} · {r.type}</div>
                      {r.lastError && <div className="text-[10px] text-destructive mt-1 max-w-[220px]">{r.lastError}</div>}
                    </td>
                    <td className="p-3 text-muted-foreground">{r.sizeLabel}</td>
                    <td className="p-3 text-muted-foreground">{ago(r.lastRunTs)}</td>
                    <td className="p-3">{r.lastLatencyMs != null ? `${r.lastLatencyMs} ms` : "—"}</td>
                    <td className="p-3">{r.lastTokens ?? "—"}</td>
                    <td className="p-3">{r.avgLatencyMs != null ? `${r.avgLatencyMs} ms` : "—"}</td>
                    <td className="p-3">{r.avgTokens ?? "—"}</td>
                    <td className="p-3">{r.bestTokensPerSec ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">
                      {r.runs}{r.failures ? ` (${r.failures} failed)` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        A row shows dashes until that model has actually answered once on this machine. Times include model load, so the
        first run of a model is always the slowest — compare second runs.
      </Card>
    </div>
  );
}
