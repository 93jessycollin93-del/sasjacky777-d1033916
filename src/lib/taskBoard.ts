/**
 * The task board's arithmetic: which column a task sits in, in what order, and
 * whether it is late. Pure, so every rule here is a unit test rather than
 * something you find out by staring at a board.
 *
 * Reads and writes go through `appActions.ts` — the same functions Hermes, the
 * DeepSeek harness and the in-app agents call — so a task an agent creates and
 * a task you drag are held to exactly the same rules (CLAUDE.md rule 9).
 */
import { TASK_STATUSES, type TaskPriority, type TaskStatus } from "@/lib/appActions";

/** The columns `listTasks` returns, as `TASK_COLUMNS` in appActions selects them. */
export interface BoardTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One column per status the database accepts. The donor board had three and no
 * `blocked`, so a task an agent parked as blocked would have been on no column
 * at all — present in the database, absent from the only screen that shows it.
 */
export const BOARD_COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string; hint: string }> = [
  { status: "todo", label: "To do", hint: "Not started" },
  { status: "in_progress", label: "In progress", hint: "Being worked on" },
  { status: "blocked", label: "Blocked", hint: "Waiting on something" },
  { status: "done", label: "Done", hint: "Finished" },
];

export const STATUS_LABEL: Record<TaskStatus, string> = Object.fromEntries(
  BOARD_COLUMNS.map((c) => [c.status, c.label]),
) as Record<TaskStatus, string>;

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Most urgent first. Spelled out because the chat's `getTasks` orders by the
 * priority *text*, which puts "low" above "medium".
 */
export const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * `listTasks` caps a read at 100. The board asks for all of them and says so
 * when it hits the cap, rather than showing a hundred and implying that is all.
 */
export const BOARD_LIMIT = 100;

/**
 * A due date is a day, not an instant.
 *
 * The column is `timestamptz`, and agents are told to send "YYYY-MM-DD", which
 * Postgres stores as midnight UTC. Formatting that in local time showed a task
 * due on 1 October as due on 30 September anywhere west of Greenwich. Reading
 * the UTC calendar date gives back the day that was written.
 */
export function dueDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Today's date where the person is sitting, in the same "YYYY-MM-DD" shape. */
export function localDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Late means past its day and not finished. Due today is not late yet. */
export function isOverdue(task: Pick<BoardTask, "status" | "due_date">, today: string): boolean {
  if (task.status === "done") return false;
  const day = dueDay(task.due_date);
  return day !== null && day < today;
}

/** "Oct 1" — from the calendar date, so it cannot shift with the time zone. */
export function formatDueDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function byUrgency(a: BoardTask, b: BoardTask): number {
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rank !== 0) return rank;
  const da = dueDay(a.due_date);
  const db = dueDay(b.due_date);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da < db ? -1 : 1;
  }
  return b.created_at.localeCompare(a.created_at);
}

/** Finished work reads as a log: the most recently finished at the top. */
function byRecentlyFinished(a: BoardTask, b: BoardTask): number {
  return b.updated_at.localeCompare(a.updated_at);
}

/**
 * Tasks sorted into columns. Every status gets a column even when empty, so a
 * column never disappears from under a card being dragged into it.
 */
export function arrangeBoard(tasks: readonly BoardTask[]): Record<TaskStatus, BoardTask[]> {
  const board = Object.fromEntries(TASK_STATUSES.map((s) => [s, [] as BoardTask[]])) as Record<
    TaskStatus,
    BoardTask[]
  >;
  for (const task of tasks) board[task.status]?.push(task);
  for (const status of TASK_STATUSES) {
    board[status].sort(status === "done" ? byRecentlyFinished : byUrgency);
  }
  return board;
}

/**
 * The board after moving one card, before the database has answered. The
 * caller keeps the previous array to put back if the write is refused — a card
 * that stays where it was dropped after the write failed is the board lying.
 */
export function withStatus(
  tasks: readonly BoardTask[],
  id: string,
  status: TaskStatus,
  now: Date = new Date(),
): BoardTask[] {
  return tasks.map((t) => (t.id === id ? { ...t, status, updated_at: now.toISOString() } : t));
}

/** Replace one task with the row the database sent back, or add it if new. */
export function withSaved(tasks: readonly BoardTask[], saved: BoardTask): BoardTask[] {
  const found = tasks.some((t) => t.id === saved.id);
  return found ? tasks.map((t) => (t.id === saved.id ? saved : t)) : [saved, ...tasks];
}

// ── Calendar ─────────────────────────────────────────────────────────────

/**
 * Dated tasks grouped by the day they are due, open work before finished and
 * the most urgent first within that. Keyed by `dueDay`, never by the raw
 * column: the donor calendar keyed by `due_date` itself, which comes back as
 * "2026-10-01T00:00:00+00:00" and so matched no day it was ever asked about.
 */
export function groupByDueDay(tasks: readonly BoardTask[]): Map<string, BoardTask[]> {
  const days = new Map<string, BoardTask[]>();
  for (const task of tasks) {
    const day = dueDay(task.due_date);
    if (!day) continue;
    const list = days.get(day);
    if (list) list.push(task);
    else days.set(day, [task]);
  }
  for (const list of days.values()) {
    list.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || byUrgency(a, b));
  }
  return days;
}

/**
 * The calendar widget works in local dates; a due day is a calendar date.
 * `new Date("2026-10-01")` is UTC midnight — the previous evening west of
 * Greenwich — so the day is built from its parts instead.
 */
export function dayToLocalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Open tasks that are late, soonest-missed first. */
export function overdueTasks(tasks: readonly BoardTask[], today: string): BoardTask[] {
  return tasks
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => (dueDay(a.due_date) as string).localeCompare(dueDay(b.due_date) as string) || byUrgency(a, b));
}

/**
 * Open tasks with no due date. A calendar cannot place them, so it has to say
 * how many there are — otherwise they are simply absent from the view, and an
 * empty week reads as a free one.
 */
export function openUndated(tasks: readonly BoardTask[]): BoardTask[] {
  return tasks.filter((t) => t.status !== "done" && dueDay(t.due_date) === null);
}
