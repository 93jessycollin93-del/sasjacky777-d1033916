import type { MicroRunMetrics } from "@/lib/microai/router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge } from "lucide-react";

export function PerfMonitor({ metrics }: { metrics: MicroRunMetrics | null }) {
  const m = metrics;
  return (
    <Card className="bg-card/80 border-border/40">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-primary" /> Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {!m ? (
          <p className="text-[11px] text-muted-foreground">Run a prompt to measure latency and throughput.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div><div className="text-muted-foreground">Model</div><div className="text-foreground truncate">{m.model}</div></div>
            <div><div className="text-muted-foreground">Load+Run</div><div className="text-foreground">{m.loadMs.toFixed(0)} ms</div></div>
            <div><div className="text-muted-foreground">Tokens</div><div className="text-foreground">{m.tokens}</div></div>
            <div><div className="text-muted-foreground">Tok/s</div><div className="text-foreground">{m.tokensPerSec}</div></div>
            <div><div className="text-muted-foreground">Mem (approx)</div><div className="text-foreground">{m.memoryApproxMB} MB</div></div>
            <div><div className="text-muted-foreground">Fallback</div><div className={m.fellBack ? "text-amber-500" : "text-foreground"}>{m.fellBack ? "YES" : "no"}</div></div>
            {m.error && <div className="col-span-2 text-destructive break-words">{m.error}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
