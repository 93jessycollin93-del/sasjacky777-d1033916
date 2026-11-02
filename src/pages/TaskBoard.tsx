import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { TaskCard } from "@/components/tasks/TaskCard";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskViewShell } from "@/components/tasks/TaskViewShell";
import { useTasks } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type TaskStatus } from "@/lib/appActions";
import { BOARD_COLUMNS, arrangeBoard, type BoardTask } from "@/lib/taskBoard";

const COLUMN_EDGE: Record<TaskStatus, string> = {
  todo: "border-muted-foreground/30",
  in_progress: "border-primary/50",
  blocked: "border-destructive/50",
  done: "border-accent/50",
};

/**
 * The task board — the screen the `create_task` tool has always told agents
 * their tasks "appear on", which until now did not exist. Tasks could be made
 * from the chat (`/task`), from Hermes or DeepSeek over MCP, or by an Agent Lab
 * operator, and the only way to see them all was to ask.
 *
 * Ported from jackie-core-keeper's TaskBoard, and changed on the way in: it
 * reads and writes through `appActions.ts` rather than its own table helpers,
 * so the board and every agent obey one set of rules; it has the `blocked`
 * column this database has and the donor did not; and a write the database
 * refuses puts the card back and says why, rather than leaving it where it was
 * dropped (CLAUDE.md rule 8). The data and the writes live in `useTasks`, which
 * the calendar shares.
 */
const TaskBoard = () => {
  const { tasks, loaded, loading, loadError, busy, today, reload, move, save, remove } = useTasks();
  const [dialog, setDialog] = useState<{ task: BoardTask | null; status: TaskStatus } | null>(null);
  const [params, setParams] = useSearchParams();

  // The nav bar's Create → Task lands here as /tasks?new=1. The flag is taken
  // off the URL once used, so a reload does not open a second blank task.
  useEffect(() => {
    if (!loaded || params.get("new") !== "1") return;
    setDialog({ task: null, status: "todo" });
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [loaded, params, setParams]);

  const board = useMemo(() => arrangeBoard(tasks), [tasks]);

  const onDragEnd = (result: DropResult) => {
    const to = result.destination?.droppableId as TaskStatus | undefined;
    if (!to || to === result.source.droppableId || !TASK_STATUSES.includes(to)) return;
    const task = tasks.find((t) => t.id === result.draggableId);
    if (task) void move(task, to);
  };

  return (
    <TaskViewShell
      title="Task Board"
      summary={`${tasks.length - board.done.length} open · ${board.done.length} done`}
      taskCount={tasks.length}
      loaded={loaded}
      loading={loading}
      loadError={loadError}
      onRefresh={() => void reload()}
      onNew={() => setDialog({ task: null, status: "todo" })}
    >
      {tasks.length === 0 && (
        <p className="font-mono text-xs text-muted-foreground">
          No tasks yet. Add one here, type <code>/task</code> followed by a title in the chat, or ask an agent to make
          one — they all land on this board.
        </p>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {BOARD_COLUMNS.map((col) => (
            <section
              key={col.status}
              aria-label={col.label}
              className={cn("border-t-2 bg-secondary/10 rounded-sm p-3 flex flex-col", COLUMN_EDGE[col.status])}
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground" title={col.hint}>
                  {col.label} ({board[col.status].length})
                </h2>
                <button
                  type="button"
                  aria-label={`Add a task to ${col.label}`}
                  onClick={() => setDialog({ task: null, status: col.status })}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-sm"
                >
                  <Plus size={14} />
                </button>
              </div>
              <Droppable droppableId={col.status}>
                {(drop, snapshot) => (
                  <div
                    ref={drop.innerRef}
                    {...drop.droppableProps}
                    className={cn(
                      "flex-1 min-h-[8rem] space-y-2 rounded-sm transition-colors",
                      snapshot.isDraggingOver && "bg-secondary/30",
                    )}
                  >
                    {board[col.status].map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={busy.has(task.id)}>
                        {(drag) => (
                          <div ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps}>
                            <TaskCard
                              task={task}
                              today={today}
                              busy={busy.has(task.id)}
                              onOpen={() => setDialog({ task, status: task.status })}
                              onMove={(status) => void move(task, status)}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {drop.placeholder}
                  </div>
                )}
              </Droppable>
            </section>
          ))}
        </div>
      </DragDropContext>

      <TaskDialog
        open={dialog !== null}
        task={dialog?.task ?? null}
        initialStatus={dialog?.status ?? "todo"}
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

export default TaskBoard;
