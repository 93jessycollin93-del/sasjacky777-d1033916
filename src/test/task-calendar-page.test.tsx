import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BoardTask } from "@/lib/taskBoard";

/**
 * The calendar view of the same tasks the board shows: that a task is on the
 * day it is due, and that what a calendar would otherwise hide — late work and
 * undated work — is said out loud.
 */

const USER = "11111111-1111-1111-1111-111111111111";

const actions = vi.hoisted(() => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock("@/lib/appActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appActions")>()),
  ...actions,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: USER }, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { marker: "client" } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import TaskCalendar from "@/pages/TaskCalendar";

function task(over: Partial<BoardTask> & { id: string; title: string }): BoardTask {
  return {
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

function renderCalendar() {
  return render(
    <MemoryRouter initialEntries={["/tasks/calendar"]}>
      <TaskCalendar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // Only the clock is faked, so testing-library's own timers still run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0)); // 1 October 2026, local noon
  for (const fn of Object.values(actions)) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the task calendar page", () => {
  it("shows a task under the day it is due, from the timestamp the database returns", async () => {
    actions.listTasks.mockResolvedValue({
      ok: true,
      data: [task({ id: "a", title: "Renew the domain", due_date: "2026-10-01T00:00:00+00:00" })],
    });
    renderCalendar();
    const today = await screen.findByRole("region", { name: /Due Thursday, October 1/ });
    expect(within(today).getByText("Renew the domain")).toBeInTheDocument();
  });

  it("puts late work in its own list instead of leaving it on a day already scrolled past", async () => {
    actions.listTasks.mockResolvedValue({
      ok: true,
      data: [
        task({ id: "late", title: "File the taxes", due_date: "2026-09-20T00:00:00+00:00" }),
        task({ id: "fine", title: "Finished anyway", status: "done", due_date: "2026-09-20T00:00:00+00:00" }),
      ],
    });
    renderCalendar();
    const overdue = await screen.findByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("File the taxes")).toBeInTheDocument();
    expect(within(overdue).queryByText("Finished anyway")).not.toBeInTheDocument();
  });

  it("says how many open tasks have no date, rather than showing an empty calendar as a free one", async () => {
    actions.listTasks.mockResolvedValue({
      ok: true,
      data: [task({ id: "a", title: "Someday" }), task({ id: "b", title: "Another day" })],
    });
    renderCalendar();
    expect(await screen.findByText(/2 open tasks have no due date/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the board" })).toHaveAttribute("href", "/tasks");
  });

  it("shows another day's tasks when that day is picked", async () => {
    actions.listTasks.mockResolvedValue({
      ok: true,
      data: [task({ id: "a", title: "Dentist", due_date: "2026-10-09T00:00:00+00:00" })],
    });
    renderCalendar();
    await screen.findByRole("region", { name: /Due Thursday, October 1/ });
    expect(screen.queryByText("Dentist")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("gridcell", { name: "9" }));
    const day = await screen.findByRole("region", { name: /Due Friday, October 9/ });
    expect(within(day).getByText("Dentist")).toBeInTheDocument();
  });

  it("starts a task added from a day already due on that day", async () => {
    actions.listTasks.mockResolvedValue({ ok: true, data: [] });
    actions.createTask.mockImplementation(async (_sb, _uid, args) => ({
      ok: true,
      data: task({ id: "n", title: args.title, due_date: `${args.due_date}T00:00:00+00:00` }),
    }));
    renderCalendar();
    await screen.findByRole("region", { name: /Due Thursday, October 1/ });
    fireEvent.click(screen.getByRole("gridcell", { name: "9" }));
    fireEvent.click(await screen.findByRole("button", { name: /Add a task due Oct 9/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Pick up parts" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(actions.createTask).toHaveBeenCalled());
    expect(actions.createTask.mock.calls[0][2]).toMatchObject({ title: "Pick up parts", due_date: "2026-10-09" });
    const day = await screen.findByRole("region", { name: /Due Friday, October 9/ });
    await waitFor(() => expect(within(day).getByText("Pick up parts")).toBeInTheDocument());
  });

  it("says the tasks could not be read, and why, instead of showing an empty month", async () => {
    actions.listTasks.mockResolvedValue({ ok: false, error: "JWT expired" });
    renderCalendar();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your tasks.");
    expect(alert).toHaveTextContent("JWT expired");
  });
});
