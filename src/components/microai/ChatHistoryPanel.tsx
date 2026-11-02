/**
 * Every thread this device is holding.
 *
 * Threads were invisible until now: they lived in React state and were gone at
 * the reload, so there was nothing to list. Now that each model keeps its own,
 * a person needs a way to see what they have and get back to it — a saved
 * conversation nothing can open is the filing-cabinet bug in a different room.
 */
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { clearAllThreads, threadSummary, type ChatThread } from "@/lib/microai/chatHistory";
import { findBackend } from "@/lib/microai/chatBackends";

interface Props {
  threads: ChatThread[];
  activeKey: string;
  onOpen: (backendId: string, modelId: string) => void;
  onCleared: () => void;
}

export function ChatHistoryPanel({ threads, activeKey, onOpen, onCleared }: Props) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Saved chats</h3>
        {threads.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => {
              clearAllThreads();
              onCleared();
            }}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Clear all
          </Button>
        )}
      </div>

      {threads.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No saved chats yet. Each model keeps its own thread here, and they survive a reload.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {threads.map((t) => {
            // The key is `backendId:modelId`; the model id can itself contain
            // a colon (`llama3.2:3b`), so only the first one splits.
            const cut = t.key.indexOf(":");
            const backendId = cut === -1 ? t.key : t.key.slice(0, cut);
            const modelId = cut === -1 ? "" : t.key.slice(cut + 1);
            const backend = findBackend(backendId);
            const isActive = t.key === activeKey;

            return (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => onOpen(backendId, modelId)}
                  className={[
                    "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                    isActive ? "border-primary bg-primary/5" : "border-border/50 hover:bg-muted/60",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{backend.label}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {t.messages.length}
                    </Badge>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{modelId}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{threadSummary(t)}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
