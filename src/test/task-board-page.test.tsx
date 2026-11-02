import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BoardTask } from "@/lib/taskBoard";

/**
 * The board's promises, as a person would test them by hand: what it shows,
 * and — the part that gets forgotten — what it does when the database says no.
 */

const USER = "11111111-1111-1111-1111-111111111111";

const actions = vi.hoisted(() => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/appActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appActions")>()),
  ...actions,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: USER }, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { marker: "client" } }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import TaskBoard from "@/pages/TaskBoard";

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

const column = (name: string) => screen.getByRole("region", { name });

function renderBoard() {
  return render(
    <MemoryRouter>
      <TaskBoard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  toastError.mockReset();
});

describe("the task board page", () => {
  it("shows each task in the column for its status, including Blocked", async () => {
    actions.listTasks.mockResolvedValue({
      ok: true,
      data: [task({ id: "a", title: "Ship v2" }), task({ id: "b", title: "Waiting on keys", status: "blocked" })],
    });
    renderBoard();
    await screen.findByText("Ship v2");
    expect(within(column("To do")).getByText("Ship v2")).toBeInTheDocument();
    expect(within(column("Blocked")).getByText("Waiting on keys")).toBeInTheDocument();
    expect(actions.listTasks).toHaveBeenCalledWith({ marker: "client" }, USER, { limit: 100 });
  });

  it("says the tasks could not be read, and why, instead of showing an empty board", async () => {
    actions.listTasks.mockResolvedValue({ ok: false, error: "JWT expired" });
    renderBoard();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your tasks.");
    expect(alert).toHaveTextContent("JWT expired");
    expect(screen.queryByText(/No tasks yet/)).not.toBeInTheDocument();
  });

  it("moves a card when the database accepts the move", async () => {
    const t = task({ id: "a", title: "Ship v2" });
    actions.listTasks.mockResolvedValue({ ok: true, data: [t] });
    actions.updateTask.mockResolvedValue({ ok: true, data: { ...t, status: "in_progress" } });
    renderBoard();
    fireEvent.change(await screen.findByLabelText("Move “Ship v2” to"), { target: { value: "in_progress" } });
    await waitFor(() => expect(within(column("In progress")).getByText("Ship v2")).toBeInTheDocument());
    expect(actions.updateTask).toHaveBeenCalledWith({ marker: "client" }, USER, { id: "a", status: "in_progress" });
  });

  it("puts a card back where it was, and says why, when the database refuses the move", async () => {
    actions.listTasks.mockResolvedValue({ ok: true, data: [task({ id: "a", title: "Ship v2" })] });
    actions.updateTask.mockResolvedValue({ ok: false, error: "permission denied for table jackie_tasks" });
    renderBoard();
    fireEvent.change(await screen.findByLabelText("Move “Ship v2” to"), { target: { value: "done" } });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith("Couldn't move “Ship v2”", {
      description: "permission denied for table jackie_tasks",
    });
    expect(within(column("To do")).getByText("Ship v2")).toBeInTheDocument();
    expect(within(column("Done")).queryByText("Ship v2")).not.toBeInTheDocument();
  });

  it("adds a task straight into the column it was asked from", async () => {
    actions.listTasks.mockResolvedValue({ ok: true, data: [] });
    actions.createTask.mockImplementation(async (_sb, _uid, args) => ({
      ok: true,
      data: task({ id: "n", title: args.title, status: args.status }),
    }));
    renderBoard();
    fireEvent.click(await screen.findByLabelText("Add a task to Blocked"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Get the GPU back" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(within(column("Blocked")).getByText("Get the GPU back")).toBeInTheDocument());
    expect(actions.createTask.mock.calls[0][2]).toMatchObject({ title: "Get the GPU back", status: "blocked" });
  });

  it("keeps the dialog and what was typed when a new task is refused, with the reason in it", async () => {
    actions.listTasks.mockResolvedValue({ ok: true, data: [] });
    actions.createTask.mockResolvedValue({ ok: false, error: "priority must be one of: low, medium, high, critical" });
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: /New task/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("priority must be one of: low, medium, high, critical"),
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Keep me");
  });
});
