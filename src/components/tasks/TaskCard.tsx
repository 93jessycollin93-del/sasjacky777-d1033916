import { CalendarDays, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/appActions";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  dueDay,
  formatDueDay,
  isOverdue,
  type BoardTask,
} from "@/lib/taskBoard";

const PRIORITY_TONE: Record<TaskPriority, string> = {
  critical: "text-destructive",
  high: "text-primary",
  medium: "text-foreground",
  low: "text-muted-foreground",
};

interface TaskCardProps {
  task: BoardTask;
  today: string;
  onOpen: () => void;
  onMove: (status: TaskStatus) => void;
  /** True while this card's own write is in flight. */
  busy?: boolean;
}

/**
 * One task. Dragging is the quick way to move it; the "Move to" list on the card
 * is the way that works from a keyboard, a screen reader and a phone, where a
 * drag is somewhere between awkward and impossible.
 */
export const TaskCard = ({ task, today, onOpen, onMove, busy }: TaskCardProps) => {
  const day = dueDay(task.due_date);
  const late = isOverdue(task, today);
  const done = task.status === "done";

  return (
    <div
      className={cn(
        "p-3 bg-secondary/30 border border-border rounded-sm space-y-2 transition-colors hover:bg-secondary/50",
        busy && "opacity-60",
      )}
      data-testid={`task-${task.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "text-left font-mono text-xs font-semibold hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
            done ? "line-through text-muted-foreground" : "text-foreground",
          )}
        >
          {task.title}
        </button>
        <span className={cn("flex items-center gap-1 shrink-0", PRIORITY_TONE[task.priority])}>
          <Flag size={12} aria-hidden />
          <span className="font-mono text-[9px] uppercase tracking-wider">{PRIORITY_LABEL[task.priority]}</span>
        </span>
      </div>

      {task.description && (
        <p className="font-mono text-[10px] text-muted-foreground line-clamp-2 whitespace-pre-line">
          {task.description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={task.status}
          disabled={busy}
          aria-label={`Move “${task.title}” to`}
          onChange={(e) => onMove(e.target.value as TaskStatus)}
          className="px-1.5 py-0.5 rounded-sm bg-secondary border border-border font-mono text-[9px] uppercase tracking-wider text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {day && (
          <span
            className={cn(
              "flex items-center gap-1 font-mono text-[9px]",
              late ? "text-destructive font-semibold" : "text-muted-foreground",
            )}
          >
            <CalendarDays size={9} aria-hidden />
            {late ? `Overdue · ${formatDueDay(day)}` : formatDueDay(day)}
          </span>
        )}
        {task.category && task.category !== "general" && (
          <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm bg-accent/20 text-accent-foreground">
            {task.category}
          </span>
        )}
      </div>
    </div>
  );
};
