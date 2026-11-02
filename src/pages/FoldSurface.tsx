import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Search } from "lucide-react";

type Fold = {
  id: string;
  pod_id: string | null;
  router_id: string | null;
  capability: string;
  source_ref: string | null;
  source_hash: string;
  color: string | null;
  glyph: string | null;
  created_at: string;
  embedding?: unknown;
  similarity?: number;
};

/** Deterministic 2D projection: two fixed pseudo-random axes over the 768-dim vector. */
function axes(dims: number) {
  const a = new Float32Array(dims);
  const b = new Float32Array(dims);
  let s = 1234567;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < dims; i++) { a[i] = rnd(); b[i] = rnd(); }
  return { a, b };
}

function parseEmbedding(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr : null;
    } catch { return null; }
  }
  return null;
}

export default function FoldSurface() {
  const [folds, setFolds] = useState<Fold[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Fold | null>(null);
  const [hits, setHits] = useState<Record<string, number>>({});

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("pod_folds")
      .select("id,pod_id,router_id,capability,source_ref,source_hash,color,glyph,created_at,embedding")
      .order("created_at", { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) return toast.error(error.message);
    setFolds((data ?? []) as Fold[]);
  }

  useEffect(() => { void load(); }, []);

  const points = useMemo(() => {
    const withVec = folds
      .map((f) => ({ f, v: parseEmbedding(f.embedding) }))
      .filter((x): x is { f: Fold; v: number[] } => !!x.v && x.v.length > 2);
    if (!withVec.length) return [];
    const { a, b } = axes(withVec[0].v.length);
    const raw = withVec.map(({ f, v }) => {
      let x = 0, y = 0;
      for (let i = 0; i < v.length; i++) { x += v[i] * a[i]; y += v[i] * b[i]; }
      return { f, x, y };
    });
    const max = Math.max(...raw.map((p) => Math.hypot(p.x, p.y))) || 1;
    return raw.map((p) => ({ f: p.f, x: p.x / max, y: p.y / max }));
  }, [folds]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    const { data, error } = await supabase.functions.invoke("pod-search", { body: { query: q, limit: 20 } });
    if (error) return toast.error(error.message);
    const map: Record<string, number> = {};
    for (const h of (data as any)?.hits ?? []) {
      if (h?.id) map[h.id] = typeof h.similarity === "number" ? h.similarity : 1;
    }
    setHits(map);
    // Ranked-by-similarity and fell-back-to-recent look identical on the
    // surface, so the distinction has to be said out loud rather than shown as
    // a neutral note next to a success count the results do not support.
    const note = (data as any)?.note;
    if ((data as any)?.ranked === false) toast.warning(note ?? "Showing recent folds, not ranked matches.");
    else if (note) toast.message(note);
    else toast.success(`${Object.keys(map).length} similar folds`);
  }

  const R = 300;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link to="/pods" className="text-muted-foreground hover:text-foreground" aria-label="Back to Pod Station">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="font-mono text-sm tracking-widest">eYe · MERGE SURFACE</h1>
            <p className="text-[10px] text-muted-foreground">
              Y-axis folds projected onto one circle · {points.length} plotted of {folds.length} folds
            </p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 grid lg:grid-cols-[1fr_320px] gap-4">
        <Card className="p-4 flex items-center justify-center overflow-hidden">
          <svg viewBox={`-${R + 20} -${R + 20} ${(R + 20) * 2} ${(R + 20) * 2}`} className="w-full h-auto max-h-[70vh]">
            <circle cx={0} cy={0} r={R} fill="none" stroke="currentColor" className="text-border" strokeDasharray="4 6" />
            <circle cx={0} cy={0} r={R / 2} fill="none" stroke="currentColor" className="text-border/50" strokeDasharray="2 8" />
            <line x1={-R} y1={0} x2={R} y2={0} stroke="currentColor" className="text-border/40" />
            <line x1={0} y1={-R} x2={0} y2={R} stroke="currentColor" className="text-border/40" />
            {points.map(({ f, x, y }) => {
              const hit = hits[f.id];
              const isActive = active?.id === f.id;
              return (
                <g key={f.id}>
                  <circle
                    cx={x * R}
                    cy={y * R}
                    r={isActive ? 9 : hit ? 7 : 5}
                    fill={f.color ?? "#64748b"}
                    fillOpacity={hit ? 1 : 0.75}
                    stroke={isActive || hit ? "currentColor" : "none"}
                    className="cursor-pointer text-foreground"
                    onClick={() => setActive(f)}
                  />
                  {f.glyph && (
                    <text x={x * R} y={y * R - 12} textAnchor="middle" fontSize="11" fill={f.color ?? "#64748b"}>
                      {f.glyph}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </Card>

        <div className="space-y-4">
          <Card className="p-3 space-y-2">
            <div className="flex gap-2">
              <Input placeholder="Similarity query…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
              <Button size="sm" onClick={runSearch}><Search className="w-3 h-3" /></Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Search folds the query into a vector and returns hits by cosine distance. Matches glow on the circle.
            </p>
          </Card>

          <Card className="p-3 text-xs space-y-2">
            {active ? (
              <>
                <div className="flex items-center gap-2">
                  <span style={{ color: active.color ?? undefined }}>{active.glyph ?? "◦"}</span>
                  <Badge variant="secondary">{active.capability}</Badge>
                  {hits[active.id] !== undefined && <Badge variant="outline">sim {hits[active.id].toFixed(3)}</Badge>}
                </div>
                <div className="font-mono text-[10px] break-all text-muted-foreground space-y-1">
                  <div>fold {active.id}</div>
                  <div>pod {active.pod_id ?? "—"}</div>
                  <div>router {active.router_id ?? "local"}</div>
                  <div>source {active.source_ref ?? "—"}</div>
                  <div>sha256 {active.source_hash.slice(0, 40)}…</div>
                  <div>{new Date(active.created_at).toLocaleString()}</div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Only the vector and hash left the pod. Reading the source text is a separate step gated by that pod's own auth.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Click a point to inspect its fold.</p>
            )}
          </Card>

          {folds.length === 0 && (
            <Card className="p-3 text-xs text-muted-foreground">
              No folds yet. Slice a sealed pod on <Link className="underline" to="/pods">Pod Station</Link> and fold it — each fold drops one point on this circle.
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
