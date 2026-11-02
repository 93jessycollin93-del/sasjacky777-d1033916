import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

type Router = { id: string; name: string; capabilities: string[]; status: string; last_seen_at: string | null; created_at: string; pod_id: string | null };
type Job = { id: string; capability_required: string; prompt: string; status: string; result: string | null; error: string | null; router_id: string | null; created_at: string; finished_at: string | null };
type Pod = { id: string; name: string; capability: string; color: string; glyph: string; version: number };

export default function RouterMesh() {
  const [routers, setRouters] = useState<Router[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [newName, setNewName] = useState("");
  const [newCaps, setNewCaps] = useState("groq,ollama");
  const [newPodId, setNewPodId] = useState("");
  const [issued, setIssued] = useState<{ router_id: string; secret: string } | null>(null);
  const [jobPrompt, setJobPrompt] = useState("");
  const [jobCap, setJobCap] = useState("groq");

  async function load() {
    const [r, j, p] = await Promise.all([
      supabase.from("mesh_routers").select("*").order("created_at", { ascending: false }),
      supabase.from("mesh_jobs").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("eye_pod_registry").select("id,name,capability,color,glyph,version").order("pod_key"),
    ]);
    if (r.data) setRouters(r.data as Router[]);
    if (j.data) setJobs(j.data as Job[]);
    if (p.data) setPods(p.data as Pod[]);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  async function registerRouter() {
    const name = newName.trim();
    if (!name) return toast.error("Name required");
    const capabilities = newCaps.split(",").map(s => s.trim()).filter(Boolean);
    const { data, error } = await supabase.functions.invoke("router-register", {
      body: { name, capabilities, pod_id: newPodId || null },
    });
    if (error) return toast.error(error.message);
    setIssued(data as any);
    setNewName("");
    setNewPodId("");
    load();
  }

  async function revokeRouter(id: string) {
    await supabase.from("mesh_routers").update({ status: "revoked" }).eq("id", id);
    load();
  }

  async function submitJob() {
    const prompt = jobPrompt.trim();
    if (!prompt) return toast.error("Prompt required");
    const { error } = await supabase.from("mesh_jobs").insert({
      user_id: (await supabase.auth.getUser()).data.user?.id,
      capability_required: jobCap.trim(),
      prompt,
    });
    if (error) return toast.error(error.message);
    setJobPrompt("");
    toast.success("Job queued");
    load();
  }

  const statusColor = (s: string) => ({ queued: "bg-yellow-500/20 text-yellow-300", claimed: "bg-blue-500/20 text-blue-300", done: "bg-green-500/20 text-green-300", failed: "bg-red-500/20 text-red-300" }[s] ?? "");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Router Mesh</h1>
            <p className="text-sm text-slate-400">Your routers, your rules. Lovable just holds the queue.</p>
          </div>
          <Link to="/mesh/docs" className="text-sm text-primary underline">Docs & examples →</Link>
        </div>

        <Tabs defaultValue="routers">
          <TabsList>
            <TabsTrigger value="routers">Routers ({routers.filter(r => r.status === "active").length})</TabsTrigger>
            <TabsTrigger value="jobs">Jobs ({jobs.filter(j => j.status !== "done" && j.status !== "failed").length} active)</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="routers" className="space-y-4">
            <Dialog onOpenChange={(o) => !o && setIssued(null)}>
              <DialogTrigger asChild><Button>+ Register router</Button></DialogTrigger>
              <DialogContent className="bg-slate-900 border-slate-700">
                <DialogHeader><DialogTitle>Register a router node</DialogTitle></DialogHeader>
                {!issued ? (
                  <div className="space-y-3">
                    <Input placeholder="Name (e.g. pi-kitchen)" value={newName} onChange={e => setNewName(e.target.value)} />
                    <div className="space-y-1">
                      <label htmlFor="bind-pod" className="text-xs text-slate-400">Bind to seed pod (optional)</label>
                      <select
                        id="bind-pod"
                        value={newPodId}
                        onChange={e => setNewPodId(e.target.value)}
                        className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 px-3 text-sm"
                      >
                        <option value="">No binding — use capabilities below</option>
                        {pods.map(p => (
                          <option key={p.id} value={p.id}>{p.glyph} {p.name} · {p.capability} · v{p.version}</option>
                        ))}
                      </select>
                      {!pods.length && <p className="text-[11px] text-slate-500">No seed pods synced yet — open eYe Pod Station once to publish the registry.</p>}
                    </div>
                    <Input
                      placeholder="Capabilities (comma-separated: groq, ollama, chatgpt-web)"
                      value={newPodId ? (pods.find(p => p.id === newPodId)?.capability ?? "") : newCaps}
                      disabled={!!newPodId}
                      onChange={e => setNewCaps(e.target.value)}
                    />
                    {newPodId && <p className="text-[11px] text-slate-500">Pod-bound routers only wake for their pod's capability.</p>}
                    <Button onClick={registerRouter} className="w-full">Generate secret</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-yellow-300">Save this now — the secret is shown only once.</p>
                    <div className="text-xs font-mono bg-slate-950 p-3 rounded space-y-1 break-all">
                      <div>router_id: {issued.router_id}</div>
                      <div>secret: {issued.secret}</div>
                    </div>
                    <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(`ROUTER_ID=${issued.router_id}\nROUTER_SECRET=${issued.secret}`); toast.success("Copied"); }}>Copy env vars</Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <div className="grid gap-3">
              {routers.map(r => (
                <Card key={r.id} className="p-4 bg-slate-900 border-slate-700 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{r.name} <Badge variant="outline" className="ml-2">{r.status}</Badge></div>
                    <div className="text-xs text-slate-400 mt-1 font-mono">{r.id}</div>
                    <div className="flex gap-1 mt-2 flex-wrap items-center">
                      {r.capabilities.map(c => <Badge key={c} variant="secondary">{c}</Badge>)}
                      {r.pod_id && (() => {
                        const p = pods.find(x => x.id === r.pod_id);
                        return (
                          <Badge variant="outline" style={p ? { borderColor: p.color, color: p.color } : undefined}>
                            {p ? `${p.glyph} ${p.name} v${p.version}` : "pod-bound"}
                          </Badge>
                        );
                      })()}
                    </div>
                    <div className="text-xs text-slate-500 mt-2">last seen: {r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : "never"}</div>
                  </div>
                  {r.status === "active" && <Button variant="destructive" size="sm" onClick={() => revokeRouter(r.id)}>Revoke</Button>}
                </Card>
              ))}
              {routers.length === 0 && <p className="text-sm text-slate-500">No routers yet. Register one above, then point your Pi/phone/VPS at the endpoints in the docs.</p>}
            </div>
          </TabsContent>

          <TabsContent value="jobs" className="space-y-4">
            <Card className="p-4 bg-slate-900 border-slate-700 space-y-3">
              <div className="flex gap-2">
                <Input placeholder="capability (must match a router)" value={jobCap} onChange={e => setJobCap(e.target.value)} className="w-64" />
              </div>
              <Textarea placeholder="Prompt to dispatch..." value={jobPrompt} onChange={e => setJobPrompt(e.target.value)} rows={3} />
              <Button onClick={submitJob}>Queue job</Button>
            </Card>

            <div className="grid gap-2">
              {jobs.slice(0, 30).map(j => (
                <Card key={j.id} className="p-3 bg-slate-900 border-slate-700">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex gap-2 items-center">
                      <Badge className={statusColor(j.status)}>{j.status}</Badge>
                      <Badge variant="outline">{j.capability_required}</Badge>
                      <span className="text-slate-500">{new Date(j.created_at).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <div className="text-sm mt-2 text-slate-300">{j.prompt}</div>
                  {j.result && <div className="text-sm mt-2 p-2 bg-slate-950 rounded whitespace-pre-wrap">{j.result}</div>}
                  {j.error && <div className="text-sm mt-2 p-2 bg-red-950/50 rounded text-red-300">{j.error}</div>}
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="logs">
            <div className="text-xs font-mono space-y-1 max-h-[600px] overflow-auto bg-slate-900 p-4 rounded border border-slate-700">
              {jobs.map(j => (
                <div key={j.id}>
                  [{new Date(j.created_at).toISOString()}] {j.status.padEnd(8)} {j.capability_required.padEnd(16)} {j.prompt.slice(0, 80)}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
