/**
 * SANDi's panel — opened from the nav bar, or from anywhere with Ctrl/⌘+K.
 *
 * Grown out of the Index Pill, which was its own floating bar. The two paths it
 * had are unchanged — a command moves the app with no model involved; a
 * question a crafted index claims goes to that index — and the dead end after
 * them is gone: a question nobody crafted an index for goes to one of the four
 * built-in specialists, which gathers context from its own partitions and
 * climbs its weights ladder (`src/lib/sandi/plan.ts` explains the order).
 *
 * The status line is measured, as the pill's was: whether this browser has
 * WebAssembly, whether the weights on disk are the model or an LFS pointer, and
 * — new — which rung of the ladder is ready, down, offline or not configured,
 * for whichever specialist the text in the box would go to.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, CornerDownLeft, Loader2, Mic, MicOff, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { listLocal } from "@/lib/forge/store";
import { filterCommands, type CommandHit } from "@/lib/forge/commands";
import { listenOnce, speechSupported } from "@/lib/forge/voice";
import type { CraftedIndex } from "@/lib/forge/types";
import { ContextRouterService, defaultEngines } from "@/lib/microai/contextRouterService";
import { wasmSupported } from "@/lib/microai/deviceEngine";
import { CONTEXT_ROUTERS } from "@/lib/microai/contextRouter";
import { checkGuideWeights } from "@/lib/guide/weights";
import { partitions } from "@/lib/partitions";
import { describeLadder, planSandi, type Rung } from "@/lib/sandi/plan";

interface Status {
  wasm: boolean;
  weights: string;
  weightsReady: boolean;
  ready: ReadonlySet<string>;
}

const RUNG_TONE: Record<Rung["state"], string> = {
  ready: "text-primary",
  down: "text-yellow-500",
  offline: "text-muted-foreground",
  none: "text-muted-foreground/60",
};

const RUNG_MARK: Record<Rung["state"], string> = { ready: "✓", down: "✗", offline: "offline", none: "—" };

export function SandiPanel({
  open,
  onClose,
  style,
}: {
  open: boolean;
  onClose: () => void;
  /** Where the bar wants the panel, so it opens beside the bar rather than on top of it. */
  style?: CSSProperties;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [indexes, setIndexes] = useState<CraftedIndex[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [answer, setAnswer] = useState<{ text: string; via: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listeningRef = useRef<{ stop(): void } | null>(null);
  const enginesRef = useRef(defaultEngines());
  const specialists = useMemo(() => new ContextRouterService(partitions, enginesRef.current), []);
  const canListen = useMemo(speechSupported, []);

  // Probed once per open rather than per keystroke: the answer does not change
  // until someone installs weights or starts a runner, and polling a host that
  // is not there is noise on the network tab.
  useEffect(() => {
    if (!open) return;
    setIndexes(listLocal());
    inputRef.current?.focus();
    let live = true;
    (async () => {
      const engines = enginesRef.current;
      const [weights, ...up] = await Promise.all([
        checkGuideWeights(),
        ...engines.map((engine) => engine.available()),
      ]);
      if (!live) return;
      setStatus({
        wasm: wasmSupported(),
        weights: weights.detail,
        weightsReady: weights.present,
        ready: new Set(engines.filter((_, i) => up[i]).map((e) => e.id)),
      });
    })();
    return () => { live = false; };
  }, [open]);

  useEffect(() => () => listeningRef.current?.stop(), []);

  const commands = useMemo(() => filterCommands(query, indexes), [query, indexes]);
  const plan = useMemo(() => planSandi(query, indexes), [query, indexes]);
  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  // The ladder for whatever the box would do right now, so the person can see
  // before pressing Enter which weights would be called in.
  const ladder = useMemo(() => {
    if (!status || !plan || plan.kind === "go") return null;
    const spec = plan.kind === "crafted" ? { name: plan.index.name, ladder: plan.index.ladder } : plan.router;
    return { name: spec.name, rungs: describeLadder(spec.ladder, enginesRef.current, status.ready, online) };
  }, [plan, status, online]);

  const close = useCallback(() => {
    listeningRef.current?.stop();
    listeningRef.current = null;
    setListening(false);
    onClose();
  }, [onClose]);

  const run = useCallback(
    async (raw: string) => {
      const next = planSandi(raw, indexes);
      if (!next) return;

      if (next.kind === "go") {
        setQuery("");
        close();
        navigate(next.path);
        return;
      }

      setBusy(true);
      setNote(null);
      setAnswer(null);
      try {
        if (next.kind === "crafted") {
          const allowed = new Set(next.index.ladder);
          for (const engine of enginesRef.current.filter((e) => allowed.has(e.locality))) {
            if (!(await engine.available())) continue;
            const result = await engine.run(`${next.index.systemPrompt}\n\n${next.text}`, next.index.modelId);
            setAnswer({ text: result.text, via: `${next.index.name} · ${engine.name} · ${result.model}` });
            return;
          }
          // Named rather than swallowed: the ladder this index declared is the
          // reason nothing answered, and the person chose that ladder.
          setNote(`Nothing on ${next.index.name}'s ladder (${next.index.ladder.join(" → ")}) is ready.`);
          return;
        }

        const routed = await specialists.ask(next.text, navigator.onLine);
        if (!routed.engine) {
          setNote(`${routed.reason}. Load the device weights, or start LM Studio or Ollama on this network.`);
          return;
        }
        setAnswer({
          text: routed.text,
          via: `${routed.router.name}${next.claimed ? "" : " (default)"} · ${routed.engine.name} · ${routed.context.length} record${routed.context.length === 1 ? "" : "s"} of context`,
        });
      } catch (error) {
        setNote(error instanceof Error ? error.message : "That failed, and gave no reason.");
      } finally {
        setBusy(false);
      }
    },
    [indexes, navigate, close, specialists],
  );

  const toggleListening = () => {
    if (listening) {
      listeningRef.current?.stop();
      listeningRef.current = null;
      setListening(false);
      return;
    }
    setNote(null);
    const handle = listenOnce({
      onPartial: setQuery,
      onFinal: (text) => {
        setListening(false);
        listeningRef.current = null;
        setQuery(text);
        void run(text);
      },
      onError: (message) => {
        setListening(false);
        listeningRef.current = null;
        setNote(message);
      },
    });
    if (!handle) {
      setNote("This browser cannot listen. Type instead.");
      return;
    }
    listeningRef.current = handle;
    setListening(true);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="SANDi index router"
      className="liquid-glass fixed z-[75] w-[min(92vw,440px)] overflow-hidden rounded-2xl"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Bot size={15} className="text-primary" />
        <span className="font-mono text-xs tracking-widest">SANDi</span>
        <span className="font-mono text-[10px] text-muted-foreground">index router</span>
        <div className="flex-1" />
        <button
          onClick={() => { close(); navigate("/forge"); }}
          className="text-muted-foreground hover:text-primary"
          aria-label="Open the Index Forge"
          title="Craft your own indexes"
        >
          <Settings2 size={14} />
        </button>
        <button onClick={close} className="text-muted-foreground hover:text-foreground" aria-label="Close SANDi">
          <X size={15} />
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run(query);
            if (e.key === "Escape") close();
          }}
          placeholder='Say "Open Vault" or ask anything…'
          aria-label="Command or question"
          className="flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Loader2 size={14} className="animate-spin text-primary" aria-label="Working" />
        ) : (
          <button onClick={() => void run(query)} className="text-muted-foreground hover:text-primary" aria-label="Run">
            <CornerDownLeft size={14} />
          </button>
        )}
        {/* Absent rather than dead where the browser cannot listen. */}
        {canListen && (
          <button
            onClick={toggleListening}
            className={listening ? "text-primary" : "text-muted-foreground hover:text-primary"}
            aria-label={listening ? "Stop listening" : "Speak"}
          >
            {listening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
      </div>

      {plan && plan.kind !== "go" && (
        <p className="border-b border-border/60 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          {plan.kind === "crafted"
            ? `→ your index ${plan.index.name}`
            : `→ ${plan.router.name}${plan.claimed ? "" : " (nobody else claimed it)"} — ${plan.router.specialty}`}
        </p>
      )}

      <div className="max-h-[46vh] overflow-y-auto">
        {answer && (
          <div className="space-y-1 border-b border-border/60 p-3">
            <p className="font-mono text-[10px] text-primary">{answer.via}</p>
            <p className="whitespace-pre-wrap text-xs text-foreground">{answer.text}</p>
          </div>
        )}
        {note && (
          <p role="alert" className="border-b border-border/60 p-3 text-[11px] text-yellow-500">
            {note}
          </p>
        )}

        <div className="p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Commands — no model, no wait
          </p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {commands.map((command: CommandHit) => (
              <li key={`${command.path}:${command.label}`}>
                <button
                  onClick={() => { setQuery(""); close(); navigate(command.path); }}
                  className="w-full truncate text-left font-mono text-[11px] text-muted-foreground hover:text-primary"
                  title={command.path}
                >
                  · {command.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="space-y-0.5 border-t border-border/60 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        {ladder && (
          <p aria-label={`${ladder.name} weights ladder`}>
            {ladder.name}:{" "}
            {ladder.rungs.map((rung, i) => (
              <span key={rung.locality} title={rung.engines.join(", ") || "no engine configured"}>
                {i > 0 && " → "}
                <span className={cn(RUNG_TONE[rung.state])}>
                  {rung.label} {RUNG_MARK[rung.state]}
                </span>
              </span>
            ))}
          </p>
        )}
        <p className="flex flex-wrap gap-x-2">
          <span className={status?.wasm ? "text-primary" : "text-yellow-500"}>
            {status ? (status.wasm ? "WASM ready" : "no WASM") : "checking…"}
          </span>
          <span>·</span>
          <span className={status?.weightsReady ? "" : "text-yellow-500"} title={status?.weights}>
            {status ? (status.weightsReady ? "weights on disk" : "weights missing") : "…"}
          </span>
          <span>·</span>
          <span>{indexes.length} crafted · {CONTEXT_ROUTERS.length} specialists</span>
        </p>
      </footer>
    </div>
  );
}
