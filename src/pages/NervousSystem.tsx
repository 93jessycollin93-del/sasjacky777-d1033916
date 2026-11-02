import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Archive, FolderOpen, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  routerNS,
  FilingSystem,
  EVENT_NAMES,
  type EventName,
  type FiledRecord,
} from "@/lib/routerNervousSystem";

/**
 * The nervous system, made visible.
 *
 * The bus has carried every navigation, note and filing impulse in the app
 * since it was written, kept the last thousand of them, and had exactly one
 * consumer — so nothing could show what was travelling through it, and a
 * filing drawer filled up with records no screen could read back. This is that
 * screen: impulses as they happen, and the cabinet they write to.
 *
 * Entirely local. It subscribes to an in-memory bus and reads localStorage;
 * there is nothing here to fetch, so it works with the radio off.
 */

interface Impulse {
  seq: number;
  event: EventName;
  payload: Record<string, unknown>;
  ts: number;
}

/** Impulses are grouped by the part of the system they belong to. */
const FAMILIES = [
  { id: "nav", label: "Navigation", match: (e: string) => e.startsWith("nav:") },
  { id: "ufnb", label: "Floating bar", match: (e: string) => e.startsWith("ufnb:") },
  { id: "notes", label: "Notes", match: (e: string) => e.startsWith("notes:") },
  { id: "filing", label: "Filing", match: (e: string) => e.startsWith("filing:") },
  { id: "agent", label: "Agents", match: (e: string) => e.startsWith("agent:") },
  { id: "pod", label: "Pods", match: (e: string) => e.startsWith("pod:") },
] as const;

function familyOf(event: string) {
  return FAMILIES.find((f) => f.match(event))?.id ?? "nav";
}

const FAMILY_TONE: Record<string, string> = {
  nav: "text-primary",
  ufnb: "text-blue-400",
  notes: "text-amber-400",
  filing: "text-emerald-400",
  agent: "text-purple-400",
  pod: "text-cyan-400",
};

function clockOf(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
}

function summarise(payload: Record<string, unknown>) {
  const entries = Object.entries(payload ?? {}).filter(([key]) => key !== "ts");
  if (!entries.length) return "—";
  return entries
    .map(([key, value]) => {
      const shown =
        typeof value === "object" && value !== null
          ? Array.isArray(value)
            ? `[${value.length}]`
            : "{…}"
          : String(value);
      return `${key}=${shown.length > 28 ? `${shown.slice(0, 28)}…` : shown}`;
    })
    .join("  ");
}

export default function NervousSystem() {
  const [impulses, setImpulses] = useState<Impulse[]>([]);
  const [live, setLive] = useState(true);
  const [family, setFamily] = useState<string | null>(null);
  const [records, setRecords] = useState<FiledRecord[]>([]);
  const [openRecord, setOpenRecord] = useState<string | null>(null);

  const refreshCabinet = useCallback(() => setRecords(FilingSystem.list()), []);

  // The bus keeps its last thousand impulses, so the panel opens with the
  // history already in it rather than with an empty pane that fills only if
  // something happens to fire while you watch.
  useEffect(() => {
    let seq = 0;
    setImpulses(
      routerNS.getHistory().slice(-200).reverse().map((entry) => ({
        seq: seq++,
        event: entry.event,
        payload: entry.payload as Record<string, unknown>,
        ts: entry.ts,
      })),
    );
    refreshCabinet();
  }, [refreshCabinet]);

  useEffect(() => {
    if (!live) return;
    let seq = Number.MAX_SAFE_INTEGER;
    const off = routerNS.onAny((payload, event) => {
      setImpulses((prev) => [
        { seq: seq--, event, payload: payload as Record<string, unknown>, ts: Date.now() },
        ...prev,
      ].slice(0, 300));
      if (event.startsWith("filing:")) refreshCabinet();
    });
    return off;
  }, [live, refreshCabinet]);

  const shown = useMemo(
    () => (family ? impulses.filter((i) => familyOf(i.event) === family) : impulses),
    [impulses, family],
  );

  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const impulse of impulses) {
      const id = familyOf(impulse.event);
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
    return tally;
  }, [impulses]);

  const cabinet = useMemo(() => {
    const byType = new Map<string, FiledRecord[]>();
    for (const record of records) {
      byType.set(record.entityType, [...(byType.get(record.entityType) ?? []), record]);
    }
    return [...byType.entries()];
  }, [records]);

  const totalBytes = records.reduce((sum, r) => sum + r.bytes, 0);

  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Nervous System
          </h1>
          <p className="text-xs text-muted-foreground">
            Every impulse the app sends itself, and the filing cabinet they write to. All of it local — nothing
            here is fetched.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            {live ? "Watching" : "Paused"}
          </Button>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setImpulses([])}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear view
          </Button>
        </div>
      </div>

      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider flex flex-wrap items-center gap-2">
            <span>Impulses ({shown.length})</span>
            <span className="ml-auto flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setFamily(null)}
                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                  family === null ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"
                }`}
              >
                all {impulses.length}
              </button>
              {FAMILIES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFamily(family === f.id ? null : f.id)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    family === f.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground"
                  }`}
                >
                  {f.label.toLowerCase()} {counts.get(f.id) ?? 0}
                </button>
              ))}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              Nothing yet. Move around the app, pin a note, open a pod — every one of those sends an impulse
              through here.
            </p>
          ) : (
            <div className="max-h-[22rem] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody className="font-mono">
                  {shown.map((impulse) => (
                    <tr key={impulse.seq} className="border-b border-border/20">
                      <td className="p-2 pl-3 text-muted-foreground whitespace-nowrap tabular-nums">
                        {clockOf(impulse.ts)}
                      </td>
                      <td className={`p-2 whitespace-nowrap ${FAMILY_TONE[familyOf(impulse.event)]}`}>
                        {impulse.event}
                      </td>
                      <td className="p-2 pr-3 text-muted-foreground break-all">{summarise(impulse.payload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/80 border-border/40">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider flex flex-wrap items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5 text-primary" />
            Filing cabinet ({records.length} records · {(totalBytes / 1024).toFixed(1)} KB)
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-[10px]" onClick={refreshCabinet}>
              <RotateCcw className="h-3 w-3 mr-1" /> Re-read
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          {cabinet.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              The cabinet is empty. Notes, pods, agents and tasks write here as you use them.
            </p>
          ) : (
            cabinet.map(([entityType, group]) => (
              <div key={entityType} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px] uppercase">{entityType}</Badge>
                  <span className="text-[10px] text-muted-foreground">{group.length}</span>
                </div>
                <div className="space-y-1">
                  {group.map((record) => (
                    <div key={record.key} className="rounded-md border border-border/40 bg-background/40">
                      <div className="flex flex-wrap items-center gap-2 p-2">
                        <button
                          type="button"
                          onClick={() => setOpenRecord(openRecord === record.key ? null : record.key)}
                          className="font-mono text-[11px] text-foreground hover:text-primary text-left break-all"
                        >
                          {record.id}
                        </button>
                        {record.archived && (
                          <Badge variant="outline" className="text-[9px] text-muted-foreground">archived</Badge>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                          {record.bytes} B
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7 text-[10px]"
                          onClick={() => {
                            if (record.archived) FilingSystem.restore(record.entityType, record.id);
                            else FilingSystem.archive(record.entityType, record.id);
                            refreshCabinet();
                          }}
                        >
                          {record.archived ? (
                            <><RotateCcw className="h-3 w-3 mr-1" /> Restore</>
                          ) : (
                            <><Archive className="h-3 w-3 mr-1" /> Archive</>
                          )}
                        </Button>
                      </div>
                      {openRecord === record.key && (
                        <pre className="overflow-x-auto border-t border-border/40 p-2 font-mono text-[10px] text-muted-foreground">
{JSON.stringify(record.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        The bus keeps its last 1000 impulses in memory, so this opens with what already happened rather than
        waiting for something to fire. Clearing the view empties this table only — it does not touch the bus
        history or the cabinet. Watching {EVENT_NAMES.length} event types.
      </Card>
    </div>
  );
}
