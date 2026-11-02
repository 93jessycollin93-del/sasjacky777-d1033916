import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Compass, CheckCircle2, AlertTriangle } from "lucide-react";
import { GUIDE_DESTINATIONS } from "@/lib/guide/appMap";
import {
  checkGuideWeights,
  GUIDE_FETCH_COMMAND,
  GUIDE_INSTALL_COMMAND,
  GUIDE_WEIGHTS_SOURCE,
  GUIDE_MODELFILE_PATH,
  GUIDE_WEIGHTS_MB,
  GUIDE_WEIGHTS_PATH,
  type WeightsPresence,
} from "@/lib/guide/weights";
import { lmStudioEngine, ollamaEngine } from "@/lib/microai/contextRouterService";
import { GUIDANCE_MODEL } from "@/lib/microai/models";
import { listModels, LM_STUDIO_HOST } from "@/lib/lmStudio";
import type { RouteEntry } from "@/lib/routeManifest";

const GROUP_TITLES: Record<RouteEntry["group"], string> = {
  core: "Core",
  ai: "AI",
  ops: "Ops",
  eru: "Eru",
};

export default function Guide() {
  const [weights, setWeights] = useState<WeightsPresence | null>(null);
  const [hub, setHub] = useState<string[] | null>(null);
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([checkGuideWeights(), listModels(), ollamaEngine().available()]).then(
      ([found, loaded, up]) => {
        if (!live) return;
        setWeights(found);
        setHub(loaded);
        setOllamaUp(up);
      },
    );
    return () => { live = false; };
  }, []);

  const grouped = useMemo(() => {
    const byGroup = new Map<RouteEntry["group"], RouteEntry[]>();
    for (const route of GUIDE_DESTINATIONS) {
      byGroup.set(route.group, [...(byGroup.get(route.group) ?? []), route]);
    }
    return [...byGroup.entries()];
  }, []);

  const installed = (hub?.length ?? 0) > 0 || ollamaUp === true;

  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <div>
        <h1 className="font-display text-2xl text-foreground flex items-center gap-2">
          <Compass className="h-5 w-5 text-primary" /> Guide
        </h1>
        <p className="text-xs text-muted-foreground">
          Answers on every screen from the compass in the floating bar. Uses whichever model your machine already
          serves — the LM Studio hub first, then Ollama.
        </p>
      </div>

      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider flex items-center gap-2">
            {installed ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-primary" /> A local model is answering</>
            ) : (
              <><AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" /> Answering from the map</>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2 text-xs text-muted-foreground">
          <p className="font-mono">
            lm studio ({LM_STUDIO_HOST}):{" "}
            {hub === null
              ? "checking…"
              : hub.length
                ? `${hub.length} loaded — ${hub.slice(0, 3).join(", ")}${hub.length > 3 ? "…" : ""}`
                : "no model loaded, or the server is not running"}
          </p>
          <p className="font-mono">
            ollama: {ollamaUp === null ? "checking…" : ollamaUp ? "reachable" : "not reachable on this machine"}
          </p>
          {!installed && (
            <>
              <p>
                The guide never goes silent: with no runner it answers from the route manifest, which is exact but
                short. To have it answer in sentences, serve a model your machine already holds — the hub is the
                cheapest route, since nothing is copied:
              </p>
              <pre className="overflow-x-auto rounded-md border border-border/60 bg-background p-2 font-mono text-[11px] text-foreground">
{`lms server start   # LM Studio, OpenAI-compatible on ${LM_STUDIO_HOST}/v1
# then load any model in LM Studio — the guide uses whatever is loaded`}
              </pre>
              <p>
                LM Studio must allow requests from this page: turn on CORS in its server settings, or the browser
                blocks the call and the guide falls back to the map.
              </p>
              <p>
                No hub on this machine? The app can carry its own copy instead —{" "}
                <code className="font-mono">{GUIDE_WEIGHTS_PATH}</code> with{" "}
                <code className="font-mono">{GUIDE_MODELFILE_PATH}</code>, installed by{" "}
                <code className="font-mono">{GUIDE_INSTALL_COMMAND}</code> ({GUIDANCE_MODEL.name},{" "}
                {GUIDE_WEIGHTS_MB} MB): {weights ? weights.detail : "checking…"}
              </p>
              <p>
                The weights are the one part of the app a clone does not bring with it. They come
                from <code className="font-mono">{GUIDE_WEIGHTS_SOURCE}</code>, and{" "}
                <code className="font-mono">{GUIDE_FETCH_COMMAND}</code> fetches them into this
                repo — on a machine with no network, Actions → Add guidance weights does the same
                job on a runner and opens a pull request.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider">
            Everything the guide can point at ({GUIDE_DESTINATIONS.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          {grouped.map(([group, routes]) => (
            <div key={group} className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] uppercase">{GROUP_TITLES[group]}</Badge>
                <span className="text-[10px] text-muted-foreground">{routes.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {routes.map((route) => (
                  <Link
                    key={route.path}
                    to={route.path}
                    title={route.label}
                    className="rounded-full border border-border/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary"
                  >
                    {route.path}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
