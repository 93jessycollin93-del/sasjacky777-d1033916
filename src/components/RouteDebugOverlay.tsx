import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { resolveRoute, suggestRoutes, ROUTE_MANIFEST } from "@/lib/routeManifest";

type Entry = {
  id: number;
  path: string;
  matched: boolean;
  via: string;
  at: string;
};

const STORAGE_KEY = "jackie_route_debug";
let counter = 0;

/**
 * Lightweight router debug overlay. Logs every navigation target and the
 * route-matching decision (exact match / alias redirect / unmatched) so broken
 * module links are visible without digging through the router.
 *
 * Toggle with Ctrl/Cmd + Shift + R, or ?routedebug=1.
 */
export default function RouteDebugOverlay() {
  const location = useLocation();
  const [open, setOpen] = useState(() => {
    try {
      return (
        localStorage.getItem(STORAGE_KEY) === "1" ||
        new URLSearchParams(window.location.search).get("routedebug") === "1"
      );
    } catch {
      return false;
    }
  });
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setOpen((prev) => {
          try {
            localStorage.setItem(STORAGE_KEY, prev ? "0" : "1");
          } catch {
            /* ignore */
          }
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const entry = resolveRoute(location.pathname);
    const via = entry
      ? entry.alias
        ? `alias → /eru${location.pathname}`
        : `manifest · ${entry.group}`
      : `unmatched · closest ${suggestRoutes(location.pathname, 1)[0]?.path ?? "n/a"}`;

    console.info(
      `[router] navigate ${location.pathname} → ${entry ? entry.label : "404"} (${via})`,
    );

    setEntries((prev) =>
      [
        {
          id: ++counter,
          path: `${location.pathname}${location.search}`,
          matched: Boolean(entry),
          via,
          at: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 25),
    );
  }, [location.pathname, location.search]);

  if (!open) return null;

  return (
    <div className="fixed bottom-2 left-2 z-[9999] w-[min(360px,calc(100vw-1rem))] rounded-xl border border-border bg-card/95 backdrop-blur p-3 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-mono uppercase tracking-wider text-muted-foreground">
          route debug · {ROUTE_MANIFEST.length} routes
        </span>
        <button
          onClick={() => {
            setOpen(false);
            try {
              localStorage.setItem(STORAGE_KEY, "0");
            } catch {
              /* ignore */
            }
          }}
          className="rounded px-2 py-0.5 border border-border text-muted-foreground"
        >
          close
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto space-y-1">
        {entries.map((e) => (
          <li key={e.id} className="font-mono leading-tight">
            <span className={e.matched ? "text-primary" : "text-destructive"}>
              {e.matched ? "OK " : "404"}
            </span>{" "}
            <span className="text-foreground break-all">{e.path}</span>
            <div className="text-muted-foreground break-all">
              {e.at} · {e.via}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
