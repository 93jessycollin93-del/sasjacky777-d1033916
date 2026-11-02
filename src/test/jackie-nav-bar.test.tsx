import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

/**
 * The one bar, as a person uses it: what is on it, that it opens SANDi from
 * anywhere, that a command in SANDi moves the app with no model, that the
 * editor changes it for this account only, and that it says so when it cannot
 * save.
 */

const auth = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
// The panels probe local runners and the weights file when they open; there
// are none in a test, and the probes are not what these tests are about.
// Only the network check is stubbed: the rest of the module is constants that
// other modules read at import (the On-device model list among them), and a
// mock without them fails before a single test runs.
vi.mock("@/lib/guide/weights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/guide/weights")>()),
  checkGuideWeights: async () => ({ present: false, detail: "no weights in tests" }),
}));
vi.mock("@/lib/microai/contextRouterService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/microai/contextRouterService")>()),
  defaultEngines: () => [],
}));

import { JackieNavBar } from "@/components/nav/JackieNavBar";
import { StickyNotesProvider } from "@/components/GlobalStickyNotes";
import { navPrefsKey } from "@/lib/navBar/prefs";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderBar(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StickyNotesProvider>
        <JackieNavBar />
      </StickyNotesProvider>
      <Where />
    </MemoryRouter>,
  );
}

const bar = () => screen.getByRole("navigation", { name: "Main navigation" });

// jsdom has no PointerEvent, so pointer events arrive without coordinates.
// Every browser the bar runs in has one; this is the minimum of it.
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent = TestPointerEvent;
}

beforeEach(() => {
  localStorage.clear();
  auth.user = { id: "user-a" };
  toastError.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the nav bar", () => {
  it("is one bar carrying the pages, the widgets, Create and SANDi", () => {
    renderBar();
    const nav = bar();
    for (const label of ["Home", "Tasks", "Pods", "Agents", "Vault", "Control", "API Keys", "Guide", "Create"]) {
      expect(within(nav).getByRole(label === "Guide" || label === "Create" ? "button" : "link", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("button", { name: /SANDi/ })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("marks the page you are on", () => {
    renderBar("/tasks");
    expect(within(bar()).getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    expect(within(bar()).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("opens SANDi from anywhere with Ctrl+K", () => {
    renderBar();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "SANDi index router" })).toBeInTheDocument();
  });

  it("moves the app when SANDi is given a command, without asking a model", () => {
    renderBar();
    fireEvent.click(within(bar()).getByRole("button", { name: /SANDi/ }));
    const input = screen.getByLabelText("Command or question");
    fireEvent.change(input, { target: { value: "Open Tasks" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks");
    expect(screen.queryByRole("dialog", { name: "SANDi index router" })).not.toBeInTheDocument();
  });

  it("pins a page from the editor, for this account only", () => {
    renderBar();
    fireEvent.click(within(bar()).getByRole("button", { name: "Customize the nav bar" }));
    const editor = screen.getByRole("dialog", { name: "Customize Nav Bar" });
    fireEvent.change(within(editor).getByLabelText("Search pages and apps"), { target: { value: "markets" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Markets" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));

    expect(within(bar()).getByRole("link", { name: "Markets" })).toHaveAttribute("href", "/eru/markets");
    expect(JSON.parse(localStorage.getItem(navPrefsKey("user-a")) ?? "{}").pinned).toContain("eru-markets");
    expect(localStorage.getItem(navPrefsKey("user-b"))).toBeNull();
  });

  it("takes a widget off the bar when it is switched off", () => {
    renderBar();
    fireEvent.click(within(bar()).getByRole("button", { name: "Customize the nav bar" }));
    const editor = screen.getByRole("dialog", { name: "Customize Nav Bar" });
    fireEvent.click(within(editor).getByRole("button", { name: "Guide" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));
    expect(within(bar()).queryByRole("button", { name: "Guide" })).not.toBeInTheDocument();
  });

  it("drops labels in icon mode, and in controls mode keeps only the strip and SANDi", () => {
    renderBar();
    expect(within(bar()).getByText("Tasks")).toBeInTheDocument();

    fireEvent.click(within(bar()).getByRole("button", { name: "Collapse to icons" }));
    expect(within(bar()).queryByText("Tasks")).not.toBeInTheDocument();
    expect(within(bar()).getByRole("link", { name: "Tasks" })).toBeInTheDocument();

    fireEvent.click(within(bar()).getByRole("button", { name: "Collapse to control bar" }));
    expect(within(bar()).queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: /SANDi/ })).toBeInTheDocument();

    fireEvent.click(within(bar()).getByRole("button", { name: "Expand navigation" }));
    expect(within(bar()).getByText("Tasks")).toBeInTheDocument();
  });

  it("moves only after a half-second hold, and dropping it does not also press the button underneath", () => {
    vi.useFakeTimers();
    try {
      renderBar();
      const tasks = within(bar()).getByRole("link", { name: "Tasks" });

      // A quick press is a click, not a drag.
      fireEvent.pointerDown(tasks, { clientX: 100, clientY: 100, pointerId: 1 });
      vi.advanceTimersByTime(200);
      fireEvent.pointerMove(tasks, { clientX: 160, clientY: 60, pointerId: 1 });
      fireEvent.pointerUp(tasks, { pointerId: 1 });
      expect(JSON.parse(localStorage.getItem(navPrefsKey("user-a")) ?? "{}").pos ?? null).toBeNull();

      // Held for half a second, it moves, and the position is kept.
      fireEvent.pointerDown(tasks, { clientX: 100, clientY: 100, pointerId: 2 });
      vi.advanceTimersByTime(500);
      fireEvent.pointerMove(tasks, { clientX: 160, clientY: 60, pointerId: 2 });
      fireEvent.pointerUp(tasks, { pointerId: 2 });
      fireEvent.click(tasks);

      expect(JSON.parse(localStorage.getItem(navPrefsKey("user-a")) ?? "{}").pos).toEqual({ x: 60, y: 8 });
      expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says once, in words, when the layout cannot be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderBar();
    fireEvent.click(within(bar()).getByRole("button", { name: /row/ }));
    fireEvent.click(within(bar()).getByRole("button", { name: /row/ }));
    // The notes warn about the same storage in their own words; this is the
    // bar's warning, and it comes once however many changes fail to save.
    const layoutWarnings = toastError.mock.calls.filter(([message]) => /nav bar layout/.test(String(message)));
    expect(layoutWarnings).toHaveLength(1);
    expect(layoutWarnings[0][0]).toMatch(/can't be saved/);
  });

  it("loads the next account's own layout when someone else signs in", () => {
    localStorage.setItem(navPrefsKey("user-b"), JSON.stringify({ pinned: ["craft"] }));
    const { rerender } = renderBar();
    expect(within(bar()).getByRole("link", { name: "Tasks" })).toBeInTheDocument();

    // Every write, not just the last: a wrong write overwritten a moment later
    // still put one account's layout in another's namespace.
    const writesToB: string[] = [];
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === navPrefsKey("user-b")) writesToB.push(value);
      return realSetItem.call(this, key, value);
    });

    auth.user = { id: "user-b" };
    rerender(
      <MemoryRouter>
        <StickyNotesProvider>
          <JackieNavBar />
        </StickyNotesProvider>
      </MemoryRouter>,
    );
    expect(within(bar()).getByRole("link", { name: "Craft" })).toBeInTheDocument();
    expect(within(bar()).queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    // And user A's layout was never written into user B's key on the way.
    for (const written of writesToB) expect(JSON.parse(written).pinned).toEqual(["craft"]);
    expect(JSON.parse(localStorage.getItem(navPrefsKey("user-b")) ?? "{}").pinned).toEqual(["craft"]);
  });
});
