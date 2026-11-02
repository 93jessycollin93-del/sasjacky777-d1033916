import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { createTask, deleteTask, listTasks, updateTask, type TaskStatus } from "@/lib/appActions";
import type { TaskDraft } from "@/components/tasks/TaskDialog";
import { BOARD_LIMIT, localDayKey, withSaved, withStatus, type BoardTask } from "@/lib/taskBoard";

/**
 * The caller's tasks, and every way the task screens change them.
 *
 * The board and the calendar are two views of one list. Each carrying its own
 * copy of load/move/save is how they would come to disagree — one putting a
 * refused move back and the other not, one re-reading on focus and the other
 * showing a stale day — so both take their data and their writes from here.
 * The writes themselves are `appActions.ts`, the same functions every agent
 * calls (CLAUDE.md rule 9).
 */
export function useTasks() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [today, setToday] = useState(() => localDayKey());

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const r = await listTasks(supabase, userId, { limit: BOARD_LIMIT });
    setLoading(false);
    setToday(localDayKey());
    if (!r.ok) {
      setLoadError(r.error);
      return;
    }
    setTasks(r.data as BoardTask[]);
    setLoadError(null);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Agents change these tasks while the screen is open in another tab — Hermes
  // over MCP, an operator in the Agent Lab, the chat's /task. Coming back to
  // the tab re-reads, so what is on screen is what is in the database.
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const markBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const move = async (task: BoardTask, status: TaskStatus) => {
    if (!userId || task.status === status) return;
    setTasks((ts) => withStatus(ts, task.id, status));
    markBusy(task.id, true);
    const r = await updateTask(supabase, userId, { id: task.id, status });
    markBusy(task.id, false);
    if (!r.ok) {
      // Only this card goes back. Restoring the whole array would also undo
      // any other move that landed while this one was in flight.
      setTasks((ts) => ts.map((t) => (t.id === task.id ? task : t)));
      toast.error(`Couldn't move “${task.title}”`, { description: r.error });
      return;
    }
    setTasks((ts) => withSaved(ts, r.data as BoardTask));
  };

  /** Create (`existing` null) or edit. Resolves to the refusal, or null when it landed. */
  const save = async (existing: BoardTask | null, draft: TaskDraft): Promise<string | null> => {
    if (!userId) return "You are signed out. Sign in again and retry.";
    const r = existing
      ? await updateTask(supabase, userId, {
          id: existing.id,
          title: draft.title,
          description: draft.description,
          status: draft.status,
          priority: draft.priority,
          due_date: draft.due,
        })
      : await createTask(supabase, userId, {
          title: draft.title,
          description: draft.description || undefined,
          status: draft.status,
          priority: draft.priority,
          due_date: draft.due || undefined,
        });
    if (!r.ok) return r.error;
    if (!r.data) return "The task was not saved: the database returned nothing. Refresh and check before retrying.";
    setTasks((ts) => withSaved(ts, r.data as BoardTask));
    return null;
  };

  const remove = async (task: BoardTask): Promise<string | null> => {
    if (!userId) return "You are signed out. Sign in again and retry.";
    const r = await deleteTask(supabase, userId, { id: task.id });
    if (!r.ok) return r.error;
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    return null;
  };

  return { tasks, loaded, loading, loadError, busy, today, reload, move, save, remove };
}
