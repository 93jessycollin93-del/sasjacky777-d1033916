import { useState } from "react";
import { Link } from "react-router-dom";
import { PROVIDERS, OLLAMA_AGENTS, providersByTier, type ProviderId, type ProviderTier } from "@/lib/jackie-providers";
import { streamProviderChat } from "@/lib/jackie-provider-stream";
import { guardSwitch } from "@/lib/repair/contextGuard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Zap, Cpu, Cloud, HardDrive, ExternalLink, KeyRound, Play, Loader2,
  CheckCircle2, Star, Sparkles, Building2, Flame, Boxes, Brain, Globe,
} from "lucide-react";

const ICONS: Record<ProviderId, typeof Zap> = {
  lovable: Star,
  groq: Zap,
  openrouter: Cpu,
  bionic: Cpu,
  ollama: HardDrive,
  google: Sparkles,
  mistral: Cloud,
  cerebras: Zap,
  together: Boxes,
  hf: Brain,
  deepinfra: Cloud,
  fireworks: Flame,
  openai: Building2,
  anthropic: Building2,
  xai: Globe,
  deepseek: Brain,
};

const TIER_LABEL: Record<ProviderTier, string> = {
  default: "Default — Lovable-first",
  free: "Free tier",
  freemium: "Freemium",
  paid: "Paid (bring your own key)",
};

const TIER_HINT: Record<ProviderTier, string> = {
  default: "Always tried first. No configuration needed.",
  free: "Free API keys. Cascade order after Lovable.",
  freemium: "Free credits on signup, pay-per-token after.",
  paid: "Direct provider access. Only used if you paste your own key.",
};

export default function AIProviders() {
  const [providerId, setProviderId] = useState<ProviderId>("lovable");
  const provider = PROVIDERS.find((p) => p.id === providerId)!;
  const [modelId, setModelId] = useState(provider.models[0].id);
  const [prompt, setPrompt] = useState("Say hello in 1 sentence. Include your model name.");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(true);
  const [servedBy, setServedBy] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const tiers = providersByTier();

  const runTest = async () => {
    setRunning(true); setOutput(""); setError(null); setServedBy(null); setFallbackNote(null);
    await streamProviderChat({
      provider: providerId,
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      system: "You are Jackie. Respond concisely.",
      fallback,
      onDelta: (t) => setOutput((o) => o + t),
      onDone: (meta) => { if (meta) setServedBy(`${meta.servedBy} · ${meta.model}`); setRunning(false); },
      onError: (e) => { setError(e); setRunning(false); },
      onFallback: (from, to, reason) => setFallbackNote(`${from} → ${to} (${reason})`),
    });
  };

  const snapshot = (to: string, reason: "provider-switch" | "model-switch") =>
    guardSwitch(reason, {
      from: `${providerId} · ${modelId}`,
      to,
      detail: "Switched from the Provider Hub",
      extra: [
        prompt ? `# prompt\n${prompt}` : "",
        output ? `# output so far\n${output}` : "",
        error ? `# last error\n${error}` : "",
      ].filter(Boolean).join("\n\n"),
    });

  const switchModel = (id: string) => {
    snapshot(`${providerId} · ${id}`, "model-switch");
    setModelId(id);
  };

  const switchProvider = (id: ProviderId) => {
    snapshot(`${id}`, "provider-switch");
    setProviderId(id);
    const p = PROVIDERS.find((x) => x.id === id)!;
    setModelId(p.models[0].id);
    setOutput(""); setError(null); setServedBy(null); setFallbackNote(null);
  };


  const renderCard = (p: (typeof PROVIDERS)[number]) => {
    const Icon = ICONS[p.id];
    const active = p.id === providerId;
    return (
      <Card
        key={p.id}
        onClick={() => switchProvider(p.id)}
        className={`p-4 cursor-pointer transition border ${active ? "border-primary bg-primary/5" : "hover:border-primary/40"}`}
      >
        <div className="flex items-start justify-between mb-2">
          <Icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
          <div className="flex gap-1">
            {p.isDefault && <Badge className="text-[9px]">DEFAULT</Badge>}
            {p.free && !p.isDefault && <Badge variant="secondary" className="text-[10px]">FREE</Badge>}
          </div>
        </div>
        <h3 className="font-semibold text-sm">{p.label}</h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{p.description}</p>
        {p.requiresSecret && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-1.5 text-[11px] text-amber-500">
            <KeyRound className="w-3 h-3" />
            Needs {p.requiresSecret}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">AI Provider Hub</h1>
            <p className="text-sm text-muted-foreground">
              Lovable-first, fallback-everywhere. Free → Freemium → Paid, in that order.
            </p>
          </div>
        </div>

        {/* Tier sections */}
        {(["default", "free", "freemium", "paid"] as ProviderTier[]).map((tier) => (
          <section key={tier} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {TIER_LABEL[tier]}
              </h2>
              <span className="text-[11px] text-muted-foreground">{TIER_HINT[tier]}</span>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              {tiers[tier].map(renderCard)}
            </div>
          </section>
        ))}

        {/* Test panel */}
        <Card className="p-4 md:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div>
              <h2 className="font-semibold">Test: {provider.label}</h2>
              <p className="text-xs text-muted-foreground">{provider.description}</p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Switch checked={fallback} onCheckedChange={setFallback} />
                Auto-fallback chain
              </label>
              {provider.helpUrl && (
                <a href={provider.helpUrl} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Get {provider.requiresSecret ?? "docs"}
                  </Button>
                </a>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Model</label>
              <Select value={modelId} onValueChange={switchModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {provider.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <div className="flex items-center gap-2">
                        {m.label}
                        {m.free && <span className="text-[9px] px-1 rounded bg-green-500/20 text-green-500">FREE</span>}
                        {m.vision && <span className="text-[9px] px-1 rounded bg-blue-500/20 text-blue-500">VISION</span>}
                        {m.reasoning && <span className="text-[9px] px-1 rounded bg-purple-500/20 text-purple-500">R1</span>}
                        {m.note && <span className="text-[9px] text-muted-foreground">· {m.note}</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={runTest} disabled={running} className="w-full gap-2">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {running ? "Streaming..." : "Run test"}
              </Button>
            </div>
          </div>

          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className="font-mono text-xs" />

          <div className="rounded-lg border border-border bg-secondary/40 p-3 min-h-[140px] space-y-2">
            {fallbackNote && (
              <div className="text-[11px] text-amber-400 font-mono">↪ fallback: {fallbackNote}</div>
            )}
            {error ? (
              <div className="text-xs text-red-400 font-mono whitespace-pre-wrap">{error}</div>
            ) : output ? (
              <div className="text-xs whitespace-pre-wrap font-mono">
                {output}
                {!running && <CheckCircle2 className="inline w-3 h-3 ml-2 text-green-500" />}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Output appears here…</div>
            )}
            {servedBy && !error && (
              <div className="text-[11px] text-green-400 font-mono">✓ served by {servedBy}</div>
            )}
          </div>
        </Card>

        {/* Ollama agent presets */}
        <Card className="p-4 md:p-6">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive className="w-4 h-4 text-primary" />
            <h2 className="font-semibold">Suggested Ollama Agents</h2>
            <Badge variant="secondary" className="text-[10px]">local · offline · $0</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Install <code className="text-primary">ollama pull &lt;model&gt;</code>, expose via
            Cloudflare Tunnel, drop URL in <code className="text-primary">OLLAMA_BASE_URL</code>, then "Run test".
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {OLLAMA_AGENTS.map((a) => (
              <div key={a.name} className="rounded-lg border border-border p-3 hover:border-primary/40 transition">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-sm font-semibold">{a.name}</span>
                  <button
                    onClick={() => { switchProvider("ollama"); setModelId(a.model); setPrompt(a.role); }}
                    className="text-[10px] text-primary hover:underline"
                  >Load →</button>
                </div>
                <div className="text-[11px] text-muted-foreground mb-1">{a.role}</div>
                <code className="text-[10px] text-primary">{a.model}</code>
              </div>
            ))}
          </div>
        </Card>

        {/* Secrets info */}
        <Card className="p-4 md:p-6 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-500 mt-0.5" />
            <div className="text-xs space-y-2 w-full">
              <p className="font-semibold text-foreground">Add API keys in Cloud → Secrets</p>
              <p className="text-muted-foreground">
                Each provider reads its own secret. Missing keys auto-skip during the fallback cascade.
              </p>
              <ul className="grid md:grid-cols-2 gap-1 font-mono text-[11px] pt-1">
                {PROVIDERS.filter((p) => p.requiresSecret).map((p) => (
                  <li key={p.id}>
                    · <span className="text-primary">{p.requiresSecret}</span>{" "}
                    <span className="text-muted-foreground">— {p.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground pt-2">
                No redeploy needed — the edge functions pick keys up on the next request.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
