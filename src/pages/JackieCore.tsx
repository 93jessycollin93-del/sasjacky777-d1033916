import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Lock, ShieldCheck, RefreshCw, KeyRound, Trash2, Plus, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

/**
 * Jackie Core — the doctrine library, owner-only.
 *
 * The gate that matters is in the database: jackie_core_docs is readable only
 * by an account holding the 'owner' role, and the document bodies are never
 * part of the client bundle. Everything below is presentation over that fact —
 * an unauthorised visitor gets an empty result from the API, not a hidden div.
 */

interface CoreDoc {
  id: string;
  slug: string;
  title: string;
  source_file: string | null;
  sort_order: number;
  body: string;
  updated_at: string;
}

interface AccessRow {
  id: string;
  email: string;
  note: string | null;
}

// user_roles / jackie_core_* are not in the generated types yet.
type Loose = {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};
const db = supabase as unknown as Loose;

export default function JackieCore() {
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<CoreDoc[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDocs = useCallback(async () => {
    const { data } = await db.from("jackie_core_docs").select("*").order("sort_order");
    const rows = (data ?? []) as CoreDoc[];
    setDocs(rows);
    setActiveSlug((prev) => prev ?? rows[0]?.slug ?? null);
    const { data: acc } = await db.from("jackie_core_access").select("id,email,note").order("email");
    setAccess((acc ?? []) as AccessRow[]);
  }, []);

  const checkOwner = useCallback(async () => {
    if (!user) {
      setIsOwner(false);
      return;
    }
    const { data } = await db.from("user_roles").select("role").eq("user_id", user.id);
    const owner = ((data ?? []) as { role: string }[]).some((r) => r.role === "owner");
    setIsOwner(owner);
    if (owner) await loadDocs();
  }, [user, loadDocs]);

  useEffect(() => {
    if (!loading) checkOwner();
  }, [loading, checkOwner]);

  /**
   * Claim the owner seat. The decision is made server-side: the function reads
   * the email from the verified session and checks it against the allowlist.
   */
  const claim = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("core-claim");
    setBusy(false);
    if (error || (data as { granted?: boolean })?.granted !== true) {
      toast({
        title: "Not on the allowlist",
        description: "This account is not authorised for Jackie Core.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Owner access granted" });
    await checkOwner();
  };

  /** Pull the canonical doctrine text from the server function into the table. */
  const sync = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("core-sync");
    setBusy(false);
    const failure = error?.message ?? ((data as { ok?: boolean; error?: string })?.ok === false ? (data as { error?: string }).error : undefined);
    if (failure) {
      toast({ title: "Sync failed", description: failure, variant: "destructive" });
      return;
    }
    toast({ title: `Synced ${(data as { synced?: number })?.synced ?? 0} documents` });
    await loadDocs();
  };

  const addEmail = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    const { error } = await db.from("jackie_core_access").insert({ email, note: "granted by owner" });
    if (error) {
      toast({ title: "Could not add", description: String((error as Error).message), variant: "destructive" });
      return;
    }
    setNewEmail("");
    await loadDocs();
  };

  const removeEmail = async (id: string) => {
    await db.from("jackie_core_access").delete().eq("id", id);
    await loadDocs();
  };

  if (loading || isOwner === null) {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-[70dvh] flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-6 space-y-4 text-center">
          <div className="h-12 w-12 mx-auto rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Lock className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">Jackie Core is sealed</h1>
            <p className="text-sm text-muted-foreground">
              The six doctrine documents are readable only by the owner account. Nothing is loaded
              into this page for anyone else — the database refuses the read, not the interface.
            </p>
          </div>
          {user ? (
            <>
              <p className="text-xs text-muted-foreground">
                Signed in as <span className="font-mono">{user.email}</span>
              </p>
              <Button onClick={claim} disabled={busy} className="w-full min-h-11">
                <KeyRound className="w-4 h-4 mr-2" />
                Claim owner access
              </Button>
            </>
          ) : (
            <Button asChild className="w-full min-h-11">
              <a href="/auth">Sign in</a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const active = docs.find((d) => d.slug === activeSlug) ?? docs[0];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="w-5 h-5" />
          <h1 className="text-xl font-semibold text-foreground">Jackie Core</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Identity, behaviour, memory, security, architecture, roadmap. Owner-only, stored in the
          database behind row-level rules — not shipped in the app bundle.
        </p>
        <Button onClick={sync} disabled={busy} variant="secondary" className="min-h-11">
          <RefreshCw className={`w-4 h-4 mr-2 ${busy ? "animate-spin" : ""}`} />
          Sync from repo
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          {docs.map((d) => (
            <button
              key={d.slug}
              onClick={() => setActiveSlug(d.slug)}
              className={`w-full text-left px-3 py-3 rounded-xl text-sm min-h-11 border transition-colors ${
                d.slug === active?.slug
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-card/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 shrink-0" />
                {d.title}
              </span>
            </button>
          ))}
        </nav>

        <article className="rounded-2xl border border-border bg-card/60 p-5 min-w-0">
          {active ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h2 className="text-lg font-semibold text-foreground">{active.title}</h2>
                <span className="text-xs font-mono text-muted-foreground">
                  {active.source_file} · updated {new Date(active.updated_at).toLocaleString()}
                </span>
              </div>
              <div className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
                <ReactMarkdown>{active.body}</ReactMarkdown>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No documents yet. Press “Sync from repo” to load the doctrine.
            </p>
          )}
        </article>
      </div>

      <section className="rounded-2xl border border-border bg-card/60 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Who may hold the owner seat</h2>
        <p className="text-xs text-muted-foreground">
          Only these addresses can claim owner access. Removing an address stops future claims; it
          does not revoke a role already granted.
        </p>
        <ul className="space-y-2">
          {access.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2">
              <span className="text-sm font-mono text-foreground break-all">{a.email}</span>
              <Button variant="ghost" size="sm" className="min-h-11" onClick={() => removeEmail(a.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="email to authorise"
            className="min-h-11"
          />
          <Button onClick={addEmail} className="min-h-11">
            <Plus className="w-4 h-4 mr-2" />
            Authorise
          </Button>
        </div>
      </section>
    </div>
  );
}
