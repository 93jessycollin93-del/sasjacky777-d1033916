/**
 * Choosing what answers, and seeing the choice.
 *
 * `/micro` could only reach the micro models before this, so picking Groq or
 * the operator's own engine meant changing screens. The three kinds are kept
 * visually distinct because the difference is the whole point of choosing: one
 * runs in the tab and keeps the question here, one cites what it indexed, and
 * the rest are fast, metered, and off the machine.
 *
 * A backend whose secret is not set is still listed, with the secret named. The
 * alternative — hiding it — turns "I have not configured this yet" into "this
 * app cannot do that", which is the harder of the two to recover from.
 */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHAT_BACKENDS, findBackend, type ChatBackend } from "@/lib/microai/chatBackends";

interface Props {
  backendId: string;
  modelId: string;
  onChange: (backendId: string, modelId: string) => void;
  /** Locked by the Seedling switch, which freezes model switching. */
  disabled?: boolean;
}

const KIND_LABEL: Record<ChatBackend["kind"], string> = {
  device: "on device",
  gemini: "grounded",
  provider: "cloud",
};

export function BackendPicker({ backendId, modelId, onChange, disabled }: Props) {
  const active = findBackend(backendId);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Engine</p>
        <div className="flex flex-wrap gap-1.5">
          {CHAT_BACKENDS.map((b) => (
            <Button
              key={b.id}
              size="sm"
              variant={b.id === backendId ? "default" : "outline"}
              className="min-h-9"
              disabled={disabled}
              aria-pressed={b.id === backendId}
              onClick={() => onChange(b.id, b.models[0]?.id ?? "")}
            >
              {b.label}
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {KIND_LABEL[b.kind]}
              </Badge>
            </Button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{active.description}</p>
        {active.requiresSecret && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Needs <code className="font-mono">{active.requiresSecret}</code> in Cloud → Secrets.
          </p>
        )}
      </div>

      {active.models.length > 1 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Model ({active.models.length})
          </p>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {active.models.map((m) => (
              <Button
                key={m.id}
                size="sm"
                variant={m.id === modelId ? "secondary" : "ghost"}
                className="h-8 text-xs"
                disabled={disabled}
                aria-pressed={m.id === modelId}
                onClick={() => onChange(active.id, m.id)}
                title={m.note ? `${m.label} — ${m.note}` : m.label}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
