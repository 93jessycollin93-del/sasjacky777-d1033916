import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskViewShell } from "@/components/tasks/TaskViewShell";
import { useTasks } from "@/hooks/useTasks";
import {
  dayToLocalDate,
  formatDueDay,
  groupByDueDay,
  localDayKey,
  openUndated,
  overdueTasks,
  type BoardTask,
} from "@/lib/taskBoard";

/** "Thursday, October 1" — built from the calendar date, so no time zone can move it. */
function formatDayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The same tasks as the board, laid out by the day they are due.
 *
 * Ported from jackie-core-keeper's TaskCalendar, which could not have worked
 * against this database: it grouped tasks by the raw `due_date`, which a
 * timestamptz returns as "2026-10-01T00:00:00+00:00", and looked them up by
 * "2026-10-01" — so every day was empty, including the ones with work due.
 * Days come from `dueDay` here, the same function the board's cards use.
 *
 * Two things a calendar hides are said out loud: work already late, which sits
 * on days you have scrolled past, and open work with no date, which it cannot
 * place anywhere. An empty week that has five undated tasks behind it is not a
 * free week.
 */
const TaskCalendar = () => {
  const { tasks, loaded, loading, loadError, busy, today, reload, move, save, remove } = useTasks();
  const [selectedDay, setSelectedDay] = useState(() => localDayKey());
  const [month, setMonth] = useState(() => dayToLocalDate(localDayKey()));
  const [dialog, setDialog] = useState<{ task: BoardTask | null } | null>(null);

  const byDay = useMemo(() => groupByDueDay(tasks), [tasks]);
  const late = useMemo(() => overdueTasks(tasks, today), [tasks, today]);
  const undated = useMemo(() => openUndated(tasks), [tasks]);

  // Which days get marked: open work underlined, only-finished work struck
  // through, and days whose open work has already been missed in red.
  const modifiers = useMemo(() => {
    const open: Date[] = [];
    const finished: Date[] = [];
    const overdue: Date[] = [];
    for (const [day, list] of byDay) {
      const date = dayToLocalDate(day);
      const hasOpen = list.some((t) => t.status !== "done");
      (hasOpen ? open : finished).push(date);
      if (hasOpen && day < today) overdue.push(date);
    }
    return { open, finished, overdue };
  }, [byDay, today]);

  const dayTasks = byDay.get(selectedDay) ?? [];
  const openCount = tasks.filter((t) => t.status !== "done").length;

  const card = (task: BoardTask) => (
    <TaskCard
      key={task.id}
      task={task}
      today={today}
      busy={busy.has(task.id)}
      onOpen={() => setDialog({ task })}
      onMove={(status) => void move(task, status)}
    />
  );

  return (
    <TaskViewShell
      title="Task Calendar"
      summary={`${openCount} open · ${late.length} overdue`}
      taskCount={tasks.length}
      loaded={loaded}
      loading={loading}
      loadError={loadError}
      onRefresh={() => void reload()}
      onNew={() => setDialog({ task: null })}
    >
      <div className="grid gap-6 md:grid-cols-[auto_1fr] items-start">
        <div className="space-y-3">
          <Calendar
            mode="single"
            selected={dayToLocalDate(selectedDay)}
            onSelect={(date) => date && setSelectedDay(localDayKey(date))}
            month={month}
            onMonthChange={setMonth}
            className="rounded-sm border border-border"
            modifiers={modifiers}
            modifiersClassNames={{
              open: "font-bold underline decoration-primary decoration-2 underline-offset-4",
              finished: "text-muted-foreground line-through",
              overdue: "text-destructive",
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-[10px] uppercase tracking-widest"
            onClick={() => {
              setSelectedDay(today);
              setMonth(dayToLocalDate(today));
            }}
          >
            Today
          </Button>
          {undated.length > 0 && (
            <p className="font-mono text-[11px] text-muted-foreground max-w-[18rem]">
              {undated.length} open task{undated.length === 1 ? " has" : "s have"} no due date, so{" "}
              {undated.length === 1 ? "it is" : "they are"} not on this calendar.{" "}
              <Link to="/tasks" className="underline hover:text-foreground">
                See the board
              </Link>
              .
            </p>
          )}
        </div>

        <div className="space-y-6 min-w-0">
          {late.length > 0 && (
            <section aria-label="Overdue" className="space-y-2">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-destructive">
                Overdue ({late.length})
              </h2>
              <div className="grid gap-2 lg:grid-cols-2">{late.map(card)}</div>
            </section>
          )}

          <section aria-label={`Due ${formatDayLong(selectedDay)}`} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {selectedDay === today ? "Today · " : ""}
                {formatDayLong(selectedDay)}
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-[10px] uppercase tracking-widest"
                onClick={() => setDialog({ task: null })}
              >
                <Plus size={12} className="mr-1" />
                Add a task due {formatDueDay(selectedDay)}
              </Button>
            </div>
            {dayTasks.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">Nothing due on this day.</p>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">{dayTasks.map(card)}</div>
            )}
          </section>
        </div>
      </div>

      <TaskDialog
        open={dialog !== null}
        task={dialog?.task ?? null}
        initialStatus="todo"
        initialDue={selectedDay}
        onClose={() => setDialog(null)}
        onSave={async (draft) => {
          const refused = await save(dialog?.task ?? null, draft);
          if (!refused) setDialog(null);
          return refused;
        }}
        onDelete={
          dialog?.task
            ? async () => {
                const refused = await remove(dialog.task as BoardTask);
                if (!refused) setDialog(null);
                return refused;
              }
            : undefined
        }
      />
    </TaskViewShell>
  );
};

export default TaskCalendar;
