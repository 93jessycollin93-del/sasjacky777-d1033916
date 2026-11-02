/**
 * The front door.
 *
 * There was not one. A signed-out visitor to `/` met the sign-in form with no
 * explanation of what they were signing in to — `ProtectedRoute` renders
 * `<Auth />` directly, so the first thing the app ever said to anyone was
 * "password".
 *
 * The structure here is ported from `lore-forge-weave`, which had a good
 * landing page and, behind it, six modules that were entirely mock. Its copy
 * described knowledge condensation, a chaos organizer and a strategy layer that
 * returned hardcoded paragraphs. Porting that copy would have made this app's
 * front door advertise features it does not have — the exact disease
 * `docs/FEATURE_AUDIT.md` exists to catch.
 *
 * So the layout is theirs and every claim below is one this repository can
 * actually answer for, with the document that proves it named beside it.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Boxes, Brain, ChevronDown, Cpu, HardDrive, Layers, Route as RouteIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Capability {
  icon: typeof Brain;
  title: string;
  desc: string;
  facets: string[];
  /** The doc that backs the claim. Every one of these exists. */
  proof: string;
}

const CAPABILITIES: Capability[] = [
  {
    icon: RouteIcon,
    title: "A chat with four brains",
    desc: "Jacky, then Bionic, then Ollama, then the cloud. Any link can fail and the answer still arrives — and the reply tells you which one served it.",
    facets: ["Fallback chain", "Streaming", "Quota-gated", "Persona-consistent"],
    proof: "docs/CHAT_PIPELINE.md",
  },
  {
    icon: Cpu,
    title: "A model that runs in the tab",
    desc: "Bonsai 1.7B through llama.cpp compiled to WebAssembly, off the weights this repository ships. No server, no account, no network.",
    facets: ["On-device", "Offline", "248 MB, cached", "Lazy-loaded"],
    proof: "docs/ON_DEVICE.md",
  },
  {
    icon: Layers,
    title: "Micro-AIs you craft yourself",
    desc: "An index is a specialisation, the partitions it reads, a small model and the engines allowed to answer it. Build one, test it on its own ladder, export it as a file.",
    facets: ["Forge", "Test bench", "Export / import", "Synced"],
    proof: "docs/INDEX_FORGE.md",
  },
  {
    icon: HardDrive,
    title: "Media that never leaves",
    desc: "Import, convert and export audio, video and images with ffmpeg in the browser. The file is converted on the machine that already holds it.",
    facets: ["13 presets", "Real queue", "IndexedDB", "No upload"],
    proof: "docs/VAULT.md",
  },
  {
    icon: Boxes,
    title: "Routing that forecasts",
    desc: "A sliding-window ledger measures burn rate per provider and migrates while headroom remains, rather than failing the request that hits the wall.",
    facets: ["Predictive", "Hardware-gated", "Cost-tiered", "152 tests"],
    proof: "jackierouter/README.md",
  },
  {
    icon: Brain,
    title: "Condensing you can undo",
    desc: "Every claim carries the archive hash and byte span it came from, so a summary resolves back to the exact source text. Lossy one way, reversible the other.",
    facets: ["Anchored", "Rehydratable", "Encrypted archives", "42 tests"],
    proof: "context-condenser/README.md",
  },
];

export default function Welcome() {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="welcome-scope min-h-screen bg-background">
      <nav className="fixed top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/30 bg-primary/20 font-mono text-sm font-bold text-primary">
              J
            </span>
            <span className="font-mono text-sm font-semibold uppercase tracking-widest text-foreground">
              SAS-Jacky
            </span>
          </div>
          <Link to="/auth">
            <Button size="sm">
              Sign in <ArrowRight className="ml-1.5 h-3 w-3" />
            </Button>
          </Link>
        </div>
      </nav>

      <section className="px-4 pb-20 pt-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="welcome-rise mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-mono text-xs text-primary">
            <span className="welcome-pulse h-1.5 w-1.5 rounded-full bg-primary" />
            Offline-first personal AI
          </p>

          <h1 className="welcome-rise mb-6 font-mono text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl" style={{ animationDelay: "0.05s" }}>
            The network is where <span className="welcome-gradient">updates</span> come from.
            <br className="hidden sm:block" /> Never where <span className="welcome-gradient">answers</span> do.
          </h1>

          <p className="welcome-rise mx-auto mb-10 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg" style={{ animationDelay: "0.12s" }}>
            Jackie runs on your hardware first and reaches out only when she must. A model in the
            tab, a rig on the LAN, and a cloud gateway that answers last — because it costs money
            and leaves the building.
          </p>

          <div className="welcome-rise flex flex-col justify-center gap-3 sm:flex-row" style={{ animationDelay: "0.2s" }}>
            <Link to="/auth">
              <Button size="lg">
                Start <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              onClick={() => document.getElementById("capabilities")?.scrollIntoView({ behavior: "smooth" })}
            >
              What it does <ChevronDown className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <section id="capabilities" className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-3 font-mono text-xs uppercase tracking-widest text-primary">Built, not planned</p>
            <h2 className="font-mono text-2xl font-bold tracking-tight sm:text-3xl">
              Six things it actually does
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Each one names the document that describes how it works, and each of those documents
              describes something that runs.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((capability, index) => (
              <article
                key={capability.title}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                className="group rounded-lg border border-border bg-card p-6 transition-colors duration-300 hover:border-primary/40"
              >
                <div className="mb-4 flex items-start gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                    <capability.icon className="h-5 w-5 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="mb-1 font-mono text-sm font-semibold text-foreground">{capability.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{capability.desc}</p>
                  </div>
                </div>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {capability.facets.map((facet) => (
                    <span
                      key={facet}
                      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                        hovered === index
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {facet}
                    </span>
                  ))}
                </div>

                <p className="font-mono text-[10px] text-muted-foreground/70">{capability.proof}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-4 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="font-mono text-[11px] text-muted-foreground">
            Your hardware. Your media. Your keys.
          </p>
          <Link to="/auth" className="font-mono text-[11px] text-primary hover:underline">
            Sign in →
          </Link>
        </div>
      </footer>
    </div>
  );
}
