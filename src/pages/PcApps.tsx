import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Monitor, Search, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PC_APPS, PC_FOLDERS, pcAppHref } from "@/data/pcApps";

/**
 * PC App Library — every app in the embedded Visual Computer, in one place.
 *
 * The PC holds ~90 apps behind a desktop you have to know your way around.
 * Jackie's left menu deep-linked a curated 38 of them, hand-written, and had
 * drifted into dead links. This lists all of them, generated from the PC's own
 * desktop items (`src/data/pcApps.ts`), so a rename cannot silently break a
 * link here.
 *
 * Each card opens /pc?app=<id>, which the PC resolves on boot and launches
 * straight into — no hunting on the desktop.
 */
const PcApps = () => {
  const [query, setQuery] = useState("");

  const { featured, results } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...PC_APPS, ...PC_FOLDERS];
    const match = q
      ? all.filter((a) => a.name.toLowerCase().includes(q) || a.appId.toLowerCase().includes(q))
      : all;
    return {
      // Only worth a separate shelf when you are browsing, not when searching.
      featured: q ? [] : PC_APPS.filter((a) => a.featured),
      results: match,
    };
  }, [query]);

  return (
    <div className="min-h-screen w-full bg-background">
      <header className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-sidebar sticky top-0 z-10">
        <Link
          to="/"
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ArrowLeft size={14} />
          Jackie
        </Link>
        <div className="flex items-center gap-2">
          <Monitor size={14} className="text-primary" />
          <span className="font-mono text-xs uppercase tracking-widest text-foreground">
            PC App Library
          </span>
        </div>
        <div className="flex-1" />
        <Link
          to="/pc"
          className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          Open the desktop
        </Link>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="relative mb-6">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${PC_APPS.length} PC apps…`}
            className="pl-9 font-mono text-sm"
            autoFocus
          />
        </div>

        {featured.length > 0 && (
          <section className="mb-6">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Featured
            </h2>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {featured.map((app) => (
                <AppCard key={`f-${app.appId}`} appId={app.appId} name={app.name} featured />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            {query ? `${results.length} match${results.length === 1 ? "" : "es"}` : "All apps"}
          </h2>
          {results.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground py-8 text-center">
              Nothing matches “{query}”.
            </p>
          ) : (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((app) => (
                <AppCard key={app.appId} appId={app.appId} name={app.name} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

const AppCard = ({
  appId,
  name,
  featured,
}: {
  appId: string;
  name: string;
  featured?: boolean;
}) => (
  <Link to={pcAppHref(appId)} title={`Open the PC with ${name} running`}>
    <Card className="h-full p-3 bg-card hover:bg-secondary border-border hover:border-primary/50 transition-colors">
      <div className="flex items-start gap-1.5">
        <span className="text-sm text-foreground leading-tight">{name}</span>
        {featured && <Star size={12} className="text-primary shrink-0 mt-0.5" />}
      </div>
      <span className="block mt-1 font-mono text-[10px] text-muted-foreground truncate">
        {appId}
      </span>
    </Card>
  </Link>
);

export default PcApps;
