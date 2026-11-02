/**
 * One model, one thread, one panel.
 *
 * Switching model is not the same act as starting a new conversation, so each
 * backend/model pair keeps its own thread and the panel restores it on mount.
 * That is what makes asking two models the same question a thing you can
 * actually do: the first answer is still there when the second arrives.
 *
 * When a turn fails it is written into the thread as a failed turn rather than
 * dropped. A conversation that silently skips the questions that did not work
 * reads, on the next visit, as though they were never asked.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Trash2, AlertTriangle } from "lucide-react";
import { sendChat, findBackend, type ChatBackend } from "@/lib/microai/chatBackends";
import {
  loadThread, saveThread, clearThread, threadKey, newMessageId,
  type ChatMessage,
} from "@/lib/microai/chatHistory";

interface Props {
  backendId: string;
  modelId: string;
  system?: string;
  /** Told when a turn lands, so a parent can refresh a history list. */
  onActivity?: () => void;
}

export function ModelChatPanel({ backendId, modelId, system, onActivity }: Props) {
  const backend: ChatBackend = findBackend(backendId);
  const key = threadKey(backendId, modelId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restoring on every key change is what makes the thread survive both a
  // reload and a switch away and back.
  useEffect(() => {
    setMessages(loadThread(key).messages);
    setSession(null);
    setUnsaved(false);
  }, [key]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const persist = useCallback(
    (next: ChatMessage[]) => {
      setMessages(next);
      // Storage refuses writes for reasons that have nothing to do with this
      // app. Saying so beats a panel full of messages that implies they are kept.
      setUnsaved(!saveThread(key, next));
      onActivity?.();
    },
    [key, onActivity],
  );

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;

    const asked: ChatMessage = { id: newMessageId(), role: "user", text: prompt, ts: Date.now() };
    const withQuestion = [...messages, asked];
    persist(withQuestion);
    setInput("");
    setBusy(true);

    try {
      const result = await sendChat({
        backendId,
        modelId,
        prompt,
        system,
        session,
        history: messages
          .filter((m) => !m.error && (m.role === "user" || m.role === "assistant"))
          .map((m) => ({ role: m.role as "user" | "assistant", text: m.text })),
      });

      if (result.session) setSession(result.session);

      const cited = result.citations?.length
        ? `\n\nSources:\n${result.citations
            .map((c) => `· ${c.title || c.uri}${c.uri && c.title ? ` — ${c.uri}` : ""}`)
            .join("\n")}`
        : "";

      persist([
        ...withQuestion,
        {
          id: newMessageId(),
          role: "assistant",
          text: result.ok ? `${result.text}${cited}` : (result.error ?? "It did not answer."),
          ts: Date.now(),
          servedBy: result.servedBy,
          error: !result.ok,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-[32rem] flex-col p-3">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{backend.label}</p>
          <p className="truncate text-xs text-muted-foreground">{modelId}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {backend.kind === "device" ? "on device" : backend.kind === "gemini" ? "grounded" : "cloud"}
          </Badge>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="Clear this thread"
            onClick={() => {
              clearThread(key);
              setMessages([]);
              setSession(null);
              setUnsaved(false);
              onActivity?.();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {unsaved && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          This thread is not being saved — storage is full or blocked, so it will not survive a reload.
        </p>
      )}

      <div ref={scrollRef} className="my-2 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="pt-8 text-center text-xs text-muted-foreground">
            Nothing asked yet. This thread is kept per model and survives a reload.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={[
                "inline-block max-w-[92%] rounded-lg px-3 py-2 text-left text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : m.error
                    ? "border border-amber-500/40 bg-amber-500/10"
                    : "bg-muted",
              ].join(" ")}
            >
              <pre className="whitespace-pre-wrap break-words font-sans">{m.text}</pre>
            </div>
            {m.role === "assistant" && m.servedBy && (
              <p className="mt-1 text-[10px] text-muted-foreground">{m.servedBy}</p>
            )}
          </div>
        ))}
        {busy && <p className="text-xs text-muted-foreground">Thinking…</p>}
      </div>

      <div className="flex items-end gap-2 border-t border-border/50 pt-2">
        <Textarea
          rows={2}
          className="text-sm"
          placeholder={`Ask ${backend.label}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label="Send"
          disabled={busy || !input.trim()}
          onClick={() => void send()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
