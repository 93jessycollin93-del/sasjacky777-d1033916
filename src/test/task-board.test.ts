import { describe, expect, it } from "vitest";
import { TASK_STATUSES } from "@/lib/appActions";
import {
  BOARD_COLUMNS,
  arrangeBoard,
  dayToLocalDate,
  dueDay,
  groupByDueDay,
  openUndated,
  overdueTasks,
  formatDueDay,
  isOverdue,
  localDayKey,
  withSaved,
  withStatus,
  type BoardTask,
} from "@/lib/taskBoard";

function task(over: Partial<BoardTask> & { id: string }): BoardTask {
  return {
    title: over.id,
    description: null,
    status: "todo",
    priority: "medium",
    category: null,
    due_date: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("the task board's columns", () => {
  it("has a column for every status the database accepts, so no task is on no column", () => {
    expect(BOARD_COLUMNS.map((c) => c.status).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it("puts a task an agent parked as blocked in the Blocked column", () => {
    const board = arrangeBoard([task({ id: "a", status: "blocked" })]);
    expect(board.blocked.map((t) => t.id)).toEqual(["a"]);
  });

  it("keeps every column present when it is empty, so there is somewhere to drop a card", () => {
    const board = arrangeBoard([]);
    for (const status of TASK_STATUSES) expect(board[status]).toEqual([]);
  });

  it("ranks critical above high above medium above low, not alphabetically", () => {
    const board = arrangeBoard([
      task({ id: "low", priority: "low" }),
      task({ id: "medium", priority: "medium" }),
      task({ id: "critical", priority: "critical" }),
      task({ id: "high", priority: "high" }),
    ]);
    expect(board.todo.map((t) => t.id)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("within one priority, puts the soonest due first and undated work after dated", () => {
    const board = arrangeBoard([
      task({ id: "undated" }),
      task({ id: "later", due_date: "2026-10-09T00:00:00+00:00" }),
      task({ id: "sooner", due_date: "2026-10-02T00:00:00+00:00" }),
    ]);
    expect(board.todo.map((t) => t.id)).toEqual(["sooner", "later", "undated"]);
  });

  it("lists Done as a log, most recently finished first", () => {
    const board = arrangeBoard([
      task({ id: "old", status: "done", priority: "critical", updated_at: "2026-09-01T00:00:00Z" }),
      task({ id: "new", status: "done", priority: "low", updated_at: "2026-09-20T00:00:00Z" }),
    ]);
    expect(board.done.map((t) => t.id)).toEqual(["new", "old"]);
  });
});

describe("due dates", () => {
  it("reads a date an agent wrote as YYYY-MM-DD back as that same day, whatever the time zone", () => {
    // Postgres stores "2026-10-01" in a timestamptz as midnight UTC. Formatting
    // that in local time showed 30 September to anyone west of Greenwich.
    expect(dueDay("2026-10-01T00:00:00+00:00")).toBe("2026-10-01");
    expect(dueDay("2026-10-01")).toBe("2026-10-01");
    expect(formatDueDay("2026-10-01")).toMatch(/1/);
    expect(formatDueDay("2026-10-01")).not.toMatch(/30/);
  });

  it("treats a missing or unreadable due date as none rather than as 1970", () => {
    expect(dueDay(null)).toBeNull();
    expect(dueDay("")).toBeNull();
    expect(dueDay("next tuesday")).toBeNull();
  });

  it("calls a task late only after its day has passed, and never once it is done", () => {
    const today = "2026-10-01";
    expect(isOverdue({ status: "todo", due_date: "2026-09-30" }, today)).toBe(true);
    expect(isOverdue({ status: "todo", due_date: "2026-10-01" }, today)).toBe(false);
    expect(isOverdue({ status: "done", due_date: "2026-09-01" }, today)).toBe(false);
    expect(isOverdue({ status: "blocked", due_date: null }, today)).toBe(false);
  });

  it("takes today from the local calendar, not from UTC", () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("moving and saving", () => {
  it("moves only the card that was dropped", () => {
    const before = [task({ id: "a" }), task({ id: "b" })];
    const after = withStatus(before, "a", "in_progress", new Date("2026-09-27T00:00:00Z"));
    expect(after.find((t) => t.id === "a")?.status).toBe("in_progress");
    expect(after.find((t) => t.id === "b")).toBe(before[1]);
    expect(before[0].status).toBe("todo");
  });

  it("replaces a task with the saved row, and adds a new one at the top", () => {
    const before = [task({ id: "a" })];
    expect(withSaved(before, task({ id: "a", title: "renamed" }))[0].title).toBe("renamed");
    expect(withSaved(before, task({ id: "b" })).map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("the task calendar's days", () => {
  it("finds a task on its day when the database returns the due date as a full timestamp", () => {
    // The donor keyed by the raw column and looked up "2026-10-01", so this
    // task — and every other — was on no day at all.
    const days = groupByDueDay([task({ id: "a", due_date: "2026-10-01T00:00:00+00:00" })]);
    expect(days.get("2026-10-01")?.map((t) => t.id)).toEqual(["a"]);
  });

  it("lists a day's open work before its finished work, most urgent first", () => {
    const due = "2026-10-01T00:00:00+00:00";
    const days = groupByDueDay([
      task({ id: "done-critical", status: "done", priority: "critical", due_date: due }),
      task({ id: "open-low", priority: "low", due_date: due }),
      task({ id: "open-high", priority: "high", due_date: due }),
    ]);
    expect(days.get("2026-10-01")?.map((t) => t.id)).toEqual(["open-high", "open-low", "done-critical"]);
  });

  it("leaves undated tasks off the calendar and counts the open ones instead", () => {
    const tasks = [task({ id: "undated" }), task({ id: "finished", status: "done" }), task({ id: "dated", due_date: "2026-10-01" })];
    expect([...groupByDueDay(tasks).keys()]).toEqual(["2026-10-01"]);
    expect(openUndated(tasks).map((t) => t.id)).toEqual(["undated"]);
  });

  it("lists late work soonest-missed first and leaves out what is done or due today", () => {
    const late = overdueTasks(
      [
        task({ id: "yesterday", due_date: "2026-09-30" }),
        task({ id: "last-week", due_date: "2026-09-24" }),
        task({ id: "today", due_date: "2026-10-01" }),
        task({ id: "finished", status: "done", due_date: "2026-09-01" }),
      ],
      "2026-10-01",
    );
    expect(late.map((t) => t.id)).toEqual(["last-week", "yesterday"]);
  });

  it("turns a due day into that same local calendar day for the date picker", () => {
    const date = dayToLocalDate("2026-10-01");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 1]);
  });
});
