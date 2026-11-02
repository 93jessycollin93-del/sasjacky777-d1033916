import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/appActions";
import { PRIORITY_LABEL, STATUS_LABEL, dueDay, type BoardTask } from "@/lib/taskBoard";

export interface TaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** "YYYY-MM-DD", or "" for no due date. */
  due: string;
}

interface TaskDialogProps {
  open: boolean;
  /** The task being edited, or null to create one. */
  task: BoardTask | null;
  /** The column a new task starts in. */
  initialStatus: TaskStatus;
  /** The due day a new task starts with — the calendar passes the day it was opened on. */
  initialDue?: string;
  onClose: () => void;
  /** Resolves to an error message when the save was refused, null when it landed. */
  onSave: (draft: TaskDraft) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
}

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Create or edit a task.
 *
 * A refused save keeps the dialog open with the reason under the buttons. The
 * donor closed on failure and raised a toast, which threw away whatever the
 * person had typed along with the only copy of why it failed.
 */
export const TaskDialog = ({ open, task, initialStatus, initialDue, onClose, onSave, onDelete }: TaskDialogProps) => {
  const [draft, setDraft] = useState<TaskDraft>(blankDraft(initialStatus, initialDue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(
      task
        ? {
            title: task.title,
            description: task.description ?? "",
            status: task.status,
            priority: task.priority,
            due: dueDay(task.due_date) ?? "",
          }
        : blankDraft(initialStatus, initialDue),
    );
    setError(null);
    setSaving(false);
  }, [open, task, initialStatus, initialDue]);

  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || saving) return;
    setSaving(true);
    setError(null);
    const refused = await onSave({ ...draft, title: draft.title.trim() });
    setSaving(false);
    if (refused) setError(refused);
  };

  const remove = async () => {
    if (!onDelete) return;
    setConfirmDelete(false);
    setSaving(true);
    const refused = await onDelete();
    setSaving(false);
    if (refused) setError(refused);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
        <DialogContent className="max-w-md">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm uppercase tracking-widest">
                {task ? "Edit task" : "New task"}
              </DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {task
                  ? "Changes here are the same ones Jackie and your agents make."
                  : "Jackie sees active tasks in every chat."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="task-title" className="font-mono text-[10px] uppercase tracking-widest">
                Title
              </Label>
              <Input
                id="task-title"
                value={draft.title}
                maxLength={500}
                onChange={(e) => set("title", e.target.value)}
                placeholder="What needs doing"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-description" className="font-mono text-[10px] uppercase tracking-widest">
                Details
              </Label>
              <Textarea
                id="task-description"
                value={draft.description}
                rows={3}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="task-status" className="font-mono text-[10px] uppercase tracking-widest">
                  Column
                </Label>
                <select
                  id="task-status"
                  value={draft.status}
                  onChange={(e) => set("status", e.target.value as TaskStatus)}
                  className={SELECT_CLASS}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-priority" className="font-mono text-[10px] uppercase tracking-widest">
                  Priority
                </Label>
                <select
                  id="task-priority"
                  value={draft.priority}
                  onChange={(e) => set("priority", e.target.value as TaskPriority)}
                  className={SELECT_CLASS}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-due" className="font-mono text-[10px] uppercase tracking-widest">
                Due
              </Label>
              <Input id="task-due" type="date" value={draft.due} onChange={(e) => set("due", e.target.value)} />
            </div>

            {error && (
              <p role="alert" className="font-mono text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              {task && onDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !draft.title.trim()}>
                  {saving ? "Saving…" : task ? "Save" : "Add task"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{task?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it for good. Moving it to Done keeps a record instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

function blankDraft(status: TaskStatus, due = ""): TaskDraft {
  return { title: "", description: "", status, priority: "medium", due };
}
