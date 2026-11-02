import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, CornerDownLeft, Loader2, X } from "lucide-react";
import { askGuide, type GuideAnswer } from "@/lib/guide/guideService";
import { defaultEngines } from "@/lib/microai/contextRouterService";
import { checkGuideWeights, GUIDE_INSTALL_COMMAND, GUIDE_WEIGHTS_MB } from "@/lib/guide/weights";

/**
 * The guide, on every screen — opened from the nav bar's Guide button.
 *
 * It used to be its own floating bar (GuideDock), stacked above the others.
 * The panel is unchanged, and still always answers: the routes come from the
 * manifest whether or not a model is installed, and the model only writes the
 * sentence around them.
 */
export function GuidePanel({
  open,
  onClose,
  style,
}: {
  open: boolean;
  onClose: () => void;
  style?: CSSProperties;
}) {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GuideAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [model, setModel] = useState<{ ready: boolean; detail: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // LM Studio first: the operator's weights already live in the hub, so
  // guidance points at them rather than asking for a second copy. Ollama is the
  // fallback for a machine that runs one and not the other.
  const enginesRef = useRef(defaultEngines());

  // One probe per open, not per keystroke: the answer is the same until someone
  // installs the model, and the panel should not poll a host that is not there.
  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      const engines = enginesRef.current;
      const [weights, ...up] = await Promise.all([
        checkGuideWeights(),
        ...engines.map((engine) => engine.available()),
      ]);
      if (!live) return;
      const readyEngine = engines.find((_, i) => up[i]);
      setModel({
        ready: !!readyEngine,
        detail: readyEngine
          ? `answering through ${readyEngine.name}`
          : weights.present
            ? `No runner is up. Weights ship with the app (${GUIDE_WEIGHTS_MB} MB) — ${GUIDE_INSTALL_COMMAND}`
            : // The one route that works on a host serving only the LFS pointer,
              // and the one a phone can take: the device rung uses the chat's
              // download, so naming it is what makes "map only" fixable there.
              "No local model is up. Download Bonsai once in the chat (engine menu → On-device), or start LM Studio's server (lms server start) or Ollama and load a model.",
      });
    })();
    inputRef.current?.focus();
    return () => { live = false; };
  }, [open]);

  const ask = useCallback(async () => {
    const asked = question.trim();
    if (!asked || asking) return;
    setAsking(true);
    try {
      const engines = enginesRef.current;
      const up = await Promise.all(engines.map((engine) => engine.available()));
      const ready = new Set(engines.filter((_, i) => up[i]).map((engine) => engine.id));
      setAnswer(await askGuide(asked, { engines, ready }));
    } finally {
      setAsking(false);
    }
  }, [question, asking]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Guide"
      className="liquid-glass fixed z-[75] w-[min(92vw,26rem)] rounded-2xl"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Compass size={14} className="text-primary" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-foreground">Guide</span>
        <span className="ml-auto truncate text-[10px] text-muted-foreground" title={model?.detail}>
          {model ? (model.ready ? "local model" : "map only") : "checking…"}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the guide"
          className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void ask();
              if (e.key === "Escape") onClose();
            }}
            placeholder="How do I… / Where is…"
            aria-label="Ask the guide"
            className="min-h-11 flex-1 rounded-md border border-border bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void ask()}
            disabled={asking || !question.trim()}
            aria-label="Ask"
            className="min-h-11 rounded-md border border-border px-3 text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
          >
            {asking ? <Loader2 size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
          </button>
        </div>

        {answer && (
          <div className="space-y-2">
            <p className="text-sm leading-snug text-foreground">{answer.text}</p>
            {answer.routes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {answer.routes.map((route) => (
                  <button
                    key={route.path}
                    type="button"
                    onClick={() => { navigate(route.path); onClose(); }}
                    className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] text-primary hover:bg-primary/20"
                  >
                    {route.path}
                  </button>
                ))}
              </div>
            )}
            <p className="font-mono text-[10px] text-muted-foreground">
              {answer.fromModel ? `answered by ${answer.model ?? "a local model"}` : "from the route manifest"} · {answer.reason}
            </p>
          </div>
        )}

        {!answer && model && !model.ready && (
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">{model.detail}</p>
        )}
      </div>
    </div>
  );
}
