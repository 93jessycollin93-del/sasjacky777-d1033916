import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Library, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  LIBRARY_BASE,
  failedAtImport,
  filterClusters,
  formatBytes,
  loadCatalog,
  type ArtifactCatalog,
  type ArtifactCluster,
  type ArtifactItem,
  type LibraryFilter,
} from "@/lib/artifactLibrary";

const ArtifactViewer = lazy(() => import("@/components/artifacts/ArtifactViewer"));

type FlagKey = Exclude<keyof LibraryFilter, "query">;

const FLAGS: { key: FlagKey; label: string }[] = [
  { key: "savesData", label: "Saves data" },
  { key: "network", label: "Uses the network" },
  { key: "source", label: "Recovered source" },
  { key: "failed", label: "Failed at import" },
];

/**
 * Artifact Library — every single-file HTML app saved from AI chats into Drive,
 * brought in by `scripts/import-artifacts.mjs` (docs/ARTIFACTS.md).
 *
 * Versions of the same app are grouped under one card; a card opens the newest
 * and the viewer switches between the rest. `?open=<id>` names the open one, so
 * the browser's back button closes the viewer and an artifact can be linked to.
 */
const ArtifactLibrary = () => {
  const [catalog, setCatalog] = useState<ArtifactCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>({ query: "", savesData: false, network: false, source: false, failed: false });
  const [params, setParams] = useSearchParams();
  const openId = params.get("open");

  useEffect(() => {
    let live = true;
    loadCatalog().then((got) => {
      if (!live) return;
      if (got.ok) setCatalog(got.value);
      else setError(got.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => (catalog ? filterClusters(catalog, filter) : []), [catalog, filter]);

  const open = useMemo(() => {
    if (!catalog || !openId) return null;
    const byId = new Map(catalog.items.map((i) => [i.id, i]));
    const current = byId.get(openId);
    if (!current) return null;
    const cluster = catalog.clusters.find((c) => c.ids.includes(openId));
    const versions = (cluster?.ids ?? [openId]).map((id) => byId.get(id)).filter((i): i is ArtifactItem => !!i);
    return { current, versions };
  }, [catalog, openId]);

  const select = useCallback((id: string) => setParams({ open: id }), [setParams]);
  const close = useCallback(() => setParams({}), [setParams]);

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
          <Library size={14} className="text-primary" />
          <span className="font-mono text-xs uppercase tracking-widest text-foreground">Artifact Library</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {error && <p className="font-mono text-xs text-destructive py-8 text-center">{error}</p>}
        {!error && !catalog && <p className="font-mono text-xs text-muted-foreground py-8 text-center">Reading the catalog…</p>}

        {catalog && (
          <>
            <p className="mb-4 font-mono text-[11px] text-muted-foreground">
              {catalog.count} artifacts in {catalog.clusters.length} groups · {formatBytes(catalog.bytes)} of HTML, stored as{" "}
              {formatBytes(catalog.storedBytes)} · each one runs sealed off from this app, with its own saved data
            </p>

            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={filter.query}
                onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                placeholder={`Search ${catalog.count} artifacts…`}
                className="pl-9 font-mono text-sm"
              />
            </div>
            <div className="mb-6 flex flex-wrap gap-1.5">
              {FLAGS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter[key]}
                  onClick={() => setFilter((f) => ({ ...f, [key]: !f[key] }))}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    filter[key]
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              {results.length} group{results.length === 1 ? "" : "s"}
            </h2>
            {results.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground py-8 text-center">Nothing matches.</p>
            ) : (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {results.map(({ cluster, items }) => (
                  <ClusterCard key={cluster.key} cluster={cluster} items={items} onOpen={select} />
                ))}
              </div>
            )}

            {catalog.skipped.length > 0 && (
              <details className="mt-10 font-mono text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {catalog.skipped.length} saved page{catalog.skipped.length === 1 ? " was" : "s were"} not imported, and why
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {catalog.skipped.map((s) => (
                    <li key={s.sha256}>
                      <span className="text-foreground">{s.title ?? s.names[0]}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      {open && (
        <Suspense fallback={null}>
          <ArtifactViewer versions={open.versions} current={open.current} onSelect={select} onClose={close} />
        </Suspense>
      )}
      {catalog && openId && !open && (
        <p className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-sm bg-destructive px-3 py-1.5 font-mono text-xs text-destructive-foreground">
          No artifact {openId} in this library.
        </p>
      )}
    </div>
  );
};

const ClusterCard = ({ cluster, items, onOpen }: { cluster: ArtifactCluster; items: ArtifactItem[]; onOpen: (id: string) => void }) => {
  const newest = items[0];
  const savesData = items.some((i) => i.features.localStorage || i.features.indexedDB);
  const network = items.some((i) => i.features.network);
  const failed = items.every(failedAtImport);
  return (
    <button type="button" onClick={() => onOpen(newest.id)} className="text-left" title={`Open ${newest.title}`}>
      <Card className="h-full overflow-hidden bg-card hover:bg-secondary border-border hover:border-primary/50 transition-colors">
        <div className="aspect-[8/5] w-full bg-muted">
          {newest.thumb && (
            <img src={`${LIBRARY_BASE}${newest.thumb}`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
          )}
        </div>
        <div className="p-2">
          <span className="text-sm leading-tight text-foreground line-clamp-2 break-words">{cluster.title}</span>
          <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            {items.length > 1 && <Tag>{items.length} versions</Tag>}
            {newest.kind === "source" && <Tag>{newest.language ?? "source"}</Tag>}
            {savesData && <Tag>saves data</Tag>}
            {network && <Tag>network</Tag>}
            {failed && <Tag warn>failed at import</Tag>}
          </div>
        </div>
      </Card>
    </button>
  );
};

const Tag = ({ children, warn }: { children: React.ReactNode; warn?: boolean }) => (
  <span className={`rounded-sm border px-1 py-px ${warn ? "border-destructive/50 text-destructive" : "border-border"}`}>{children}</span>
);

export default ArtifactLibrary;
