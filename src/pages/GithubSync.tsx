import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  GitBranch, GitCommit, GitPullRequest, RefreshCw, AlertTriangle,
  ExternalLink, FileCode2, Search, ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type Overview = {
  fetchedAt: string;
  repo: {
    fullName: string; private: boolean; defaultBranch: string;
    pushedAt: string; updatedAt: string; htmlUrl: string;
    openIssues: number; language: string | null;
  };
  branches: { name: string; sha: string }[];
  commits: { sha: string; message: string; author: string; date: string; url: string }[];
  pulls: { number: number; title: string; author: string; branch: string; draft: boolean; updatedAt: string; url: string }[];
  conflicts: { number: number; title: string; state: string; url: string }[];
};

type RemoteFile = { path: string; size?: number; sha: string };

// Each match becomes its own lazily loaded chunk, fetched only when a file is
// opened for comparison. Tests are left out: they are not what anyone syncs,
// and they were fifty of the chunks every build shipped. `vite.config.ts` puts
// these chunks under assets/src/ and keeps them out of the service worker's
// precache, which had been downloading all ~1,300 of them (about 20 MB) on
// every visitor's first load.
const LOCAL_SOURCES = import.meta.glob(
  ["/src/**/*.{ts,tsx,js,jsx,css,md}", "!/src/test/**", "!/src/**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default" },
) as Record<string, () => Promise<string>>;

const invokeSync = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("github-sync", { body });
  if (error) {
    const details = error instanceof FunctionsHttpError ? await error.context.text() : error.message;
    throw new Error(details);
  }
  return data as T;
};

const timeAgo = (iso?: string) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

export default function GithubSync() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const [tree, setTree] = useState<RemoteFile[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [remote, setRemote] = useState<string>("");
  const [local, setLocal] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await invokeSync<Overview>({ action: "overview" });
      setData(res);
      setLastSync(res.fetchedAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await invokeSync<{ files: RemoteFile[] }>({ action: "tree" });
      setTree(res.files);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load repository tree");
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const openFile = useCallback(async (path: string) => {
    setSelected(path);
    setDiffLoading(true);
    setRemote("");
    setLocal(null);
    try {
      const res = await invokeSync<{ content: string }>({ action: "file", path });
      setRemote(res.content);
      const key = `/${path}`;
      const loader = LOCAL_SOURCES[key];
      setLocal(loader ? await loader() : null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load file");
    } finally {
      setDiffLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    if (!tree) return [];
    const q = filter.trim().toLowerCase();
    return (q ? tree.filter((f) => f.path.toLowerCase().includes(q)) : tree).slice(0, 300);
  }, [tree, filter]);

  const identical = local !== null && local === remote;

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <header className="border-b border-border bg-card/70 backdrop-blur px-4 py-4">
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Home
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" /> GitHub Sync
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live view of {data?.repo.fullName ?? "the connected repository"} — commits, pull requests, conflicts and file comparison.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Sync now
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 space-y-4">
        {err && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {err}
          </div>
        )}

        {/* Sync status panel */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Last sync", value: timeAgo(lastSync ?? undefined) },
            { label: "Branch", value: data?.repo.defaultBranch ?? "—" },
            { label: "Last push", value: timeAgo(data?.repo.pushedAt) },
            { label: "Conflicts", value: data ? String(data.conflicts.length) : "—" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-border bg-card p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="mt-1 truncate text-sm font-semibold">{s.value}</p>
            </div>
          ))}
        </section>

        {data && data.conflicts.length > 0 && (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Merge conflicts detected
            </p>
            <ul className="mt-2 space-y-1">
              {data.conflicts.map((c) => (
                <li key={c.number} className="text-[12px] text-amber-200/90">
                  <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                    #{c.number} {c.title} — {c.state}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Commits */}
        <section className="rounded-2xl border border-border bg-card">
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
            <GitCommit className="h-4 w-4 text-primary" /> Recent commits
          </h2>
          <ul className="divide-y divide-border">
            {(data?.commits ?? []).map((c) => (
              <li key={c.sha} className="px-4 py-2.5">
                <a href={c.url} target="_blank" rel="noreferrer" className="text-sm hover:underline line-clamp-2">
                  {c.message.split("\n")[0]}
                </a>
                <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                  {c.sha.slice(0, 7)} · {c.author} · {timeAgo(c.date)}
                </p>
              </li>
            ))}
            {!loading && !data?.commits.length && (
              <li className="px-4 py-4 text-sm text-muted-foreground">No commits found.</li>
            )}
          </ul>
        </section>

        {/* Pull requests */}
        <section className="rounded-2xl border border-border bg-card">
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
            <GitPullRequest className="h-4 w-4 text-primary" /> Open pull requests
          </h2>
          <ul className="divide-y divide-border">
            {(data?.pulls ?? []).map((p) => (
              <li key={p.number} className="px-4 py-2.5">
                <a href={p.url} target="_blank" rel="noreferrer" className="text-sm hover:underline">
                  #{p.number} {p.title} {p.draft && <span className="text-muted-foreground">(draft)</span>}
                </a>
                <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                  {p.branch} · {p.author} · {timeAgo(p.updatedAt)}
                </p>
              </li>
            ))}
            {!loading && !data?.pulls.length && (
              <li className="px-4 py-4 text-sm text-muted-foreground">No open pull requests.</li>
            )}
          </ul>
        </section>

        {/* File compare */}
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileCode2 className="h-4 w-4 text-primary" /> Compare repository files
            </h2>
            <button
              onClick={loadTree}
              disabled={treeLoading}
              className="rounded-lg border border-border bg-secondary px-2.5 py-1 text-[11px] disabled:opacity-60"
            >
              {treeLoading ? "Loading…" : tree ? "Reload files" : "Load file list"}
            </button>
          </div>

          {tree && (
            <div className="p-4 space-y-3">
              <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by path…"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </label>
              <ul className="max-h-56 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                {filtered.map((f) => (
                  <li key={f.sha + f.path}>
                    <button
                      onClick={() => openFile(f.path)}
                      className={`w-full truncate px-3 py-1.5 text-left font-mono text-[11px] hover:bg-secondary ${
                        selected === f.path ? "bg-secondary" : ""
                      }`}
                    >
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>

              {selected && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    {diffLoading
                      ? "Loading file…"
                      : local === null
                        ? "No matching file in this app — repository-only file."
                        : identical
                          ? "Identical to the local file."
                          : "Differs from the local file."}
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Repository</p>
                      <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-background p-3 text-[11px] font-mono whitespace-pre-wrap">
                        {remote || "—"}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">This app</p>
                      <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-background p-3 text-[11px] font-mono whitespace-pre-wrap">
                        {local ?? "—"}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-semibold">Two-way code sync</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Reading commits, PRs and files works through the connected GitHub credentials above. Pushing this
            app's code back to the repository is a workspace-level action I can't perform for you: open the
            <span className="font-medium text-foreground"> + menu → GitHub → Connect project</span> in the editor and
            pick <span className="font-mono">93jessycollin93-del/sas-jacky</span>. After that, commits flow both ways
            automatically.
          </p>
          {data && (
            <a
              href={data.repo.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Open repository <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </section>
      </main>
    </div>
  );
}
