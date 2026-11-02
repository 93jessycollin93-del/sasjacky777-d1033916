import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Supabase's OAuth namespace is beta; narrow local typing instead of `any` sprawl.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error: err } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) {
        setError(err.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const api = oauth();
    const { data, error: err } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md border border-border rounded-sm p-6 space-y-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          SAS-JACKY · agent access
        </p>

        {error ? (
          <>
            <h1 className="font-mono text-lg text-foreground">Authorization failed</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <p className="text-xs text-muted-foreground">
              The request may have expired. Start the connection again from your MCP client.
            </p>
          </>
        ) : !details ? (
          <p className="font-mono text-sm text-muted-foreground animate-pulse">Loading request…</p>
        ) : (
          <>
            <h1 className="font-mono text-lg text-foreground">
              Connect {clientName} to your account
            </h1>
            <p className="text-sm text-muted-foreground">
              {clientName} will be able to use SAS-JACKY tools as you — reading and updating your
              tasks, memory facts, and conversations. You can revoke access at any time.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                disabled={busy}
                onClick={() => decide(true)}
                className="flex-1 py-3 rounded-sm font-mono text-sm uppercase tracking-wider bg-primary text-primary-foreground disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => decide(false)}
                className="flex-1 py-3 rounded-sm font-mono text-sm uppercase tracking-wider border border-border text-foreground disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
