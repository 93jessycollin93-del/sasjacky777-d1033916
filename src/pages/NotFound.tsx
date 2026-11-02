import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { suggestRoutes } from "@/lib/routeManifest";

const NotFound = () => {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;
  const suggestions = useMemo(() => suggestRoutes(location.pathname), [location.pathname]);

  useEffect(() => {
    console.warn("[router] no route matched:", location.pathname, {
      suggestions: suggestions.map((s) => s.path),
    });
  }, [location.pathname, suggestions]);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            404 · route not found
          </p>
          <h1 className="text-2xl font-semibold text-foreground">No module lives here</h1>
          <p className="text-sm text-muted-foreground">
            Requested path:{" "}
            <code className="font-mono text-foreground break-all">{path}</code>
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Closest module routes
            </p>
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li key={s.path}>
                  <Link
                    to={s.path}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <span>{s.label}</span>
                    <code className="font-mono text-xs text-muted-foreground">{s.path}</code>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Link
          to="/"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Back to Jackie
        </Link>
      </div>
    </main>
  );
};

export default NotFound;
