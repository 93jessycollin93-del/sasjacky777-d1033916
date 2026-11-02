import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Check, Globe, KeyRound, Play, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AUTH_TYPES, isWrite, validateConnectionSpec, type AuthType, type ConnectionOperation, type ConnectionSpec,
} from "../../../supabase/functions/_shared/connections";
import {
  activate, clearSecret, loadSecretStatus, remove, runOperationNow, saveConnection, setAcceptsAppData, setAgentsMayWrite,
  setSecret, setStatus, type ConnectionRow,
} from "@/lib/jackie-skills";
import type { ActionResult } from "@/lib/appActions";
import { Revealed } from "./Revealed";
import { ParamInputs, typedArgs } from "./ParamInputs";

/**
 * Connections on /skills: outside services the person lets their agents use.
 * docs/CONNECTIONS.md is the threat model; this page is where its grants are
 * made — the secret, "agents may write", "accepts app data" — and every one of
 * them is shown in words next to the switch that grants it.
 */

type Act = (label: string, op: () => Promise<ActionResult<unknown>>) => Promise<boolean>;

const EXAMPLE_OPERATIONS: ConnectionOperation[] = [
  {
    name: "search_issues",
    description: "Search the repository's issues.",
    method: "GET",
    path: "/repos/{owner}/{repo}/issues",
    params: [
      { name: "owner", in: "path", type: "string", required: true },
      { name: "repo", in: "path", type: "string", required: true },
      { name: "state", in: "query", type: "string" },
    ],
  },
];

const EMPTY: ConnectionSpec = {
  name: "", title: "", description: "", base_url: "https://", auth_type: "bearer", auth_name: null,
  operations: EXAMPLE_OPERATIONS, agents_may_write: false,
};

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * What an approval card shows before Approve (T8): the host, where the key
 * goes, and every operation with every parameter — list_connections sends
 * agents all of it, descriptions included, so the person sees all of it, with
 * invisible characters spelled out.
 */
export function ConnectionSummary({ c }: { c: Pick<ConnectionSpec, "base_url" | "auth_type" | "auth_name" | "operations" | "description"> }) {
  const operations = Array.isArray(c.operations) ? c.operations : [];
  return (
    <div className="space-y-2 text-sm">
      <Revealed text={c.description} className="text-muted-foreground block" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Globe className="w-3.5 h-3.5 text-muted-foreground" />
        <Revealed text={c.base_url} className="font-mono text-foreground break-all" />
        <Badge variant="outline" className="text-[11px]">
          key: {c.auth_type === "none" ? "none" : c.auth_type === "bearer" ? "Authorization: Bearer" : `${c.auth_type} ${c.auth_name ?? "?"}`}
        </Badge>
      </div>
      <ul className="space-y-2">
        {operations.map((o, i) => (
          <li key={`${o.name}-${i}`} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isWrite(o.method) ? "destructive" : "secondary"} className="text-[11px] font-mono">{o.method}</Badge>
              <Revealed text={o.path} className="font-mono text-xs text-foreground break-all" />
              <Revealed text={`${o.name} — ${o.description}`} className="text-xs text-muted-foreground" />
            </div>
            {(o.params ?? []).length > 0 && (
              <ul className="pl-6 space-y-0.5">
                {(o.params ?? []).map((p, j) => (
                  <li key={j} className="text-xs text-muted-foreground">
                    <Revealed text={p.name} className="font-mono text-foreground" /> ({p.in}, {p.type}{p.required ? ", required" : ""})
                    {p.description ? <Revealed text={` — ${p.description}`} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConnectionsTab({ connections, busy, act }: { connections: ConnectionRow[]; busy: boolean; act: Act }) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [secretError, setSecretError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<ConnectionSpec>(EMPTY);
  const [opsText, setOpsText] = useState(JSON.stringify(EXAMPLE_OPERATIONS, null, 2));
  const [secretFor, setSecretFor] = useState<ConnectionRow | null>(null);
  const [secretValue, setSecretValue] = useState("");
  const [running, setRunning] = useState<{ c: ConnectionRow; op: ConnectionOperation } | null>(null);
  const [confirm, setConfirm] = useState<ConnectionRow | null>(null);

  const refreshSecrets = useCallback(async () => {
    const r = await loadSecretStatus();
    if (r.ok) {
      setSecrets(Object.fromEntries(r.data.secrets.map((s) => [s.connection_id, s.updated_at])));
      setSecretError(null);
    } else {
      // Not knowing is said as such — never shown as "no secret set".
      setSecretError(r.error);
    }
  }, []);
  useEffect(() => {
    refreshSecrets();
  }, [refreshSecrets, connections]);

  const parsed = useMemo(() => {
    let operations: ConnectionOperation[];
    try {
      operations = JSON.parse(opsText);
    } catch {
      return { spec: null, problem: "The operations are not valid JSON." };
    }
    const spec = { ...draft, operations };
    return { spec, problem: validateConnectionSpec(spec) };
  }, [draft, opsText]);

  const open = (c?: ConnectionRow) => {
    const spec: ConnectionSpec = c
      ? { name: c.name, title: c.title, description: c.description, base_url: c.base_url, auth_type: c.auth_type, auth_name: c.auth_name, operations: c.operations, agents_may_write: c.agents_may_write }
      : EMPTY;
    setEditing(c ? c.id : "new");
    setDraft(spec);
    setOpsText(JSON.stringify(spec.operations, null, 2));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Outside services your agents may call — only the operations you list, only on the host you give, never following a
        redirect. Keys are encrypted and never shown again; agents cannot read, set or list them. Responses reach agents
        marked as untrusted. <a className="underline" href="https://github.com/yyb84ycgt6-oss/sasjacky777-d1033916/blob/SAS-JACKY/docs/CONNECTIONS.md" target="_blank" rel="noreferrer">How it is kept safe</a>.
      </p>
      {secretError && (
        <p className="text-sm text-destructive" role="alert">Could not check which keys are stored: {secretError}</p>
      )}

      {editing ? (
        <section className="rounded-xl border border-border p-4 space-y-3">
          <h2 className="font-medium text-foreground">{editing === "new" ? "New connection" : `Edit ${draft.name}`}</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input aria-label="Connection name" placeholder="name, e.g. github" value={draft.name} disabled={editing !== "new"}
              onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })} />
            <Input aria-label="Connection title" placeholder="Title" value={draft.title} maxLength={80}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <Input aria-label="What the service is" placeholder="What the service is — one line" value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <Input aria-label="Base URL" placeholder="https://api.example.com" value={draft.base_url}
            onChange={(e) => setDraft({ ...draft, base_url: e.target.value.trim() })} />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={draft.auth_type} onValueChange={(v) => setDraft({ ...draft, auth_type: v as AuthType })}>
              <SelectTrigger className="w-40" aria-label="Authentication"><SelectValue /></SelectTrigger>
              <SelectContent>{AUTH_TYPES.map((t) => <SelectItem key={t} value={t}>{t === "none" ? "no key" : t}</SelectItem>)}</SelectContent>
            </Select>
            {(draft.auth_type === "header" || draft.auth_type === "query") && (
              <Input aria-label="Key name" className="w-56" placeholder={draft.auth_type === "header" ? "X-Api-Key" : "api_key"}
                value={draft.auth_name ?? ""} onChange={(e) => setDraft({ ...draft, auth_name: e.target.value })} />
            )}
            <span className="text-xs text-muted-foreground">
              The key itself is added after saving, and never shown again.
              {editing !== "new" && " Changing the address or where the key goes clears a stored key, so it is never sent somewhere you did not give it to."}
            </span>
          </div>
          <Textarea aria-label="Operations" className="font-mono text-xs min-h-56" value={opsText} onChange={(e) => setOpsText(e.target.value)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-xs ${parsed.problem ? "text-destructive" : "text-muted-foreground"}`}>
              {parsed.problem ?? `${parsed.spec?.operations.length} operations, ${parsed.spec?.operations.filter((o) => isWrite(o.method)).length} of them writing.`}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button size="sm" disabled={busy || !!parsed.problem || !parsed.spec}
                onClick={async () => {
                  if (parsed.spec && await act("Saving", () => saveConnection(parsed.spec, editing === "new" ? undefined : editing))) setEditing(null);
                }}>
                <Check className="w-4 h-4 mr-1" /> Save
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Button size="sm" variant="outline" onClick={() => open()} disabled={busy}><Plus className="w-4 h-4 mr-2" /> New connection</Button>
      )}

      {connections.length === 0 && !editing && (
        <p className="text-sm text-muted-foreground">No connections yet.</p>
      )}

      <ul className="space-y-3">
        {connections.map((c) => {
          const needsKey = c.auth_type !== "none";
          const keySet = !!secrets[c.id];
          return (
            <li key={c.id} className={`rounded-xl border border-border p-3 space-y-3 ${c.status === "archived" ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-foreground">{c.title}</span>
                <Badge variant="outline" className="font-mono text-[11px]">{c.name}</Badge>
                <span className="font-mono text-xs text-muted-foreground">{hostOf(c.base_url)}</span>
                {c.status === "archived" && <Badge variant="secondary" className="text-[11px]">archived</Badge>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => open(c)} disabled={busy} aria-label={`Edit ${c.name}`}>Edit</Button>
                  <Button size="icon" variant="ghost" disabled={busy}
                    aria-label={c.status === "archived" ? `Restore ${c.name}` : `Archive ${c.name}`}
                    onClick={() => act(c.status === "archived" ? "Restoring" : "Archiving",
                      () => (c.status === "archived" ? activate("jackie_connections", c) : setStatus("jackie_connections", c.id, "archived")))}>
                    {c.status === "archived" ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={`Delete ${c.name}`} onClick={() => setConfirm(c)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                {needsKey ? (
                  <span className="flex items-center gap-2">
                    <KeyRound className={`w-4 h-4 ${keySet ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`} />
                    {secretError ? "key status unknown" : keySet ? `key stored ${new Date(secrets[c.id]).toLocaleDateString()}` : "no key yet — calls will be refused"}
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setSecretFor(c); setSecretValue(""); }}>
                      {keySet ? "Replace key" : "Add key"}
                    </Button>
                    {keySet && (
                      <Button size="sm" variant="ghost" disabled={busy}
                        onClick={() => act("Clearing the key", async () => { const r = await clearSecret(c.id); await refreshSecrets(); return r; })}>
                        Clear key
                      </Button>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">No key needed.</span>
                )}
                <label className="flex items-center gap-2 ml-auto">
                  <Switch checked={c.agents_may_write} disabled={busy} aria-label={`Agents may write to ${c.name}`}
                    onCheckedChange={(on) => act(on ? "Allowing writes" : "Stopping writes", () => setAgentsMayWrite(c.id, on))} />
                  <span className={c.agents_may_write ? "text-destructive" : "text-muted-foreground"}>
                    {c.agents_may_write ? "Agents may write" : "Agents may only read"}
                  </span>
                </label>
              </div>

              <ul className="space-y-1">
                {c.operations.map((o) => (
                  <li key={o.name} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={isWrite(o.method) ? "destructive" : "secondary"} className="text-[11px] font-mono">{o.method}</Badge>
                    <span className="font-mono text-xs text-foreground">{o.name}</span>
                    <span className="text-xs text-muted-foreground">— {o.description}</span>
                    <label className="flex items-center gap-1 ml-auto text-xs text-muted-foreground" title="Whether a custom tool may feed app data (an earlier step's result) into this operation">
                      <Switch checked={o.accepts_app_data === true} disabled={busy} aria-label={`${o.name} accepts app data`}
                        onCheckedChange={(on) => act("Saving", () => setAcceptsAppData(c, o.name, on))} />
                      accepts app data
                    </label>
                    {c.status === "active" && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRunning({ c, op: o })} aria-label={`Run ${c.name}.${o.name}`}>
                        <Play className="w-3.5 h-3.5 mr-1" /> Run
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={!!secretFor} onOpenChange={(o) => !o && setSecretFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Key for {secretFor?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              Stored encrypted on the server and used only to call {secretFor ? hostOf(secretFor.base_url) : ""}. Nobody — you
              included — can read it back; you can only replace or clear it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input type="password" autoComplete="off" aria-label="Key" placeholder="Paste the key" value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!secretValue.trim()}
              onClick={async () => {
                const c = secretFor;
                const value = secretValue;
                setSecretFor(null);
                setSecretValue("");
                if (c) await act("Storing the key", async () => { const r = await setSecret(c.id, value); await refreshSecrets(); return r; });
              }}>
              Store key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {running && <RunOperation c={running.c} op={running.op} onClose={() => setRunning(null)} />}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the connection “{confirm?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>Its key is deleted with it. Agents and tools that use it stop working at once.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm; setConfirm(null); if (c) act("Deleting", () => remove("jackie_connections", c.id)); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RunOperation({ c, op, onClose }: { c: ConnectionRow; op: ConnectionOperation; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionResult<Record<string, unknown>> | null>(null);
  const parsed = useMemo(() => typedArgs(op.params ?? [], values), [op.params, values]);
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-h-[85vh] overflow-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{c.name}.{op.name}</AlertDialogTitle>
          <AlertDialogDescription>
            {op.method} {hostOf(c.base_url)}{op.path}. This really calls the service, as you.
            {isWrite(op.method) && (
              <span className="flex items-center gap-1 text-destructive mt-1"><ShieldAlert className="w-4 h-4" /> It writes.</span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <ParamInputs params={op.params ?? []} values={values} onChange={setValues}
            describe={(p) => `${p.name} (${p.in}, ${p.type}${p.required ? ", required" : ""})`} />
          {"error" in parsed && <p className="text-xs text-destructive">{parsed.error}</p>}
          {outcome && (
            <pre className={`rounded-lg border p-2 text-xs whitespace-pre-wrap break-words max-h-80 overflow-auto ${outcome.ok ? "border-border bg-muted/40" : "border-destructive/40 bg-destructive/10"}`}>
              {outcome.ok ? JSON.stringify(outcome.data, null, 1) : outcome.error}
            </pre>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction disabled={busy || "error" in parsed}
            onClick={async (e) => {
              e.preventDefault();
              if (!("args" in parsed)) return;
              setBusy(true);
              setOutcome(await runOperationNow(c.name, op.name, parsed.args));
              setBusy(false);
            }}>
            <Play className="w-4 h-4 mr-1" /> {busy ? "Calling…" : "Call"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
