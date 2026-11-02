import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  DESTINATIONS,
  DESTINATION_GROUPS,
  findDestinations,
  pathRouterContext,
  type Destination,
} from "@/lib/pathRouter";

/**
 * /path — the navigation micro-router.
 *
 * Type an app or surface name and it answers with the exact path. The directory
 * is derived from the central route manifest, the PC's generated app roster and
 * the Repair Bay's panels, so it grows with the system instead of going stale.
 */
export default function PathRouter() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const matches = useMemo(() => findDestinations(query, 30), [query]);
  const grouped = useMemo(
    () =>
      DESTINATION_GROUPS.map((group) => ({
        group,
        rows: DESTINATIONS.filter((d) => d.group === group),
      })),
    [],
  );

  function go(d: Destination) {
    if (d.kind === "external") {
      window.location.href = d.path;
      return;
    }
    navigate(d.path);
  }

  function copy(d: Destination) {
    void navigator.clipboard.writeText(d.path);
    toast.success(`Copied ${d.path}`);
  }

  const row = (d: Destination) => (
    <li
      key={`${d.kind}-${d.path}-${d.label}`}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{d.label}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{d.path}</p>
      </div>
      <div className="flex items-center gap-2">
        {d.alias && <Badge variant="outline">alias</Badge>}
        <Badge variant="secondary">{d.kind}</Badge>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => copy(d)}>
          Copy
        </Button>
        <Button size="sm" className="min-h-11" onClick={() => go(d)}>
          Open
        </Button>
      </div>
    </li>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Path Router</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Every location in the system, and how to get there. {DESTINATIONS.length} destinations,
                derived from the route manifest — not a hand-kept list.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  void navigator.clipboard.writeText(pathRouterContext());
                  toast.success("Router context copied");
                }}
              >
                Copy router context
              </Button>
              <Link to="/" className="text-sm underline">
                Home
              </Link>
            </div>
          </div>

          <Input
            className="mt-4 min-h-11"
            placeholder='Name an app or surface — "grok", "boot stick", "model router", "pods"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {query.trim() && (
          <Card className="p-4">
            <h2 className="font-medium">
              {matches.length > 0 ? `Matches for "${query.trim()}"` : `Nothing matches "${query.trim()}"`}
            </h2>
            {matches.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No destination carries that name. Rather than send you somewhere plausible, the router says
                nothing — browse the full directory below.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">{matches.map(row)}</ul>
            )}
          </Card>
        )}

        {grouped.map(({ group, rows }) => (
          <Card key={group} className="p-4">
            <h2 className="font-medium">
              {group} <span className="text-sm text-muted-foreground">({rows.length})</span>
            </h2>
            <ul className="mt-3 space-y-2">{rows.map(row)}</ul>
          </Card>
        ))}
      </main>
    </div>
  );
}
