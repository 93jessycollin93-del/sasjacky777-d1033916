import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatWorkbench, type ChatWorkbenchProps } from "@/components/chat/ChatWorkbench";
import * as profile from "@/lib/microai/devicePersona";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());
const base = (): ChatWorkbenchProps => ({ device: true, model: "bonsai-1.7b", mode: "chat", onMode: vi.fn(), reviewWrites: false, onReviewWrites: vi.fn(), focus: true, onFocus: vi.fn(), running: false, status: null, outcome: "idle", events: [], issue: null, error: null, onIssue: vi.fn(), approval: null, onDecision: vi.fn(), onRestore: null });

it("shows a missing backend persistently and explains that the model need not be downloaded again", () => {
  render(<ChatWorkbench {...base()} issue={{ code: "NOT_DEPLOYED", title: "Profile service missing", detail: "HTTP 404", recovery: "Deploy jackie-device. Do not download the model again." }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("HTTP 404");
  expect(screen.getByRole("alert")).toHaveTextContent("Do not download");
  expect(screen.getByRole("button", { name: "Copy deploy command" })).toBeEnabled();
});
it("reports the checked profile separately from model readiness", async () => {
  vi.spyOn(profile, "fetchDevicePersona").mockResolvedValue({ ok: true, prompt: "Private profile", mode: "persona" });
  render(<ChatWorkbench {...base()} />);
  fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
  await screen.findByText("Owner profile verified. Model readiness is shown below.");
  expect(screen.queryByText("Private profile")).not.toBeInTheDocument();
});
it("shows concrete proposed arguments and sends the user's approval decision", () => {
  const p = base();
  render(<ChatWorkbench {...p} mode="harness" approval={{ tool: "create_task", args: { title: "Ship the repair" } }} />);
  expect(screen.getByRole("region", { name: "Approve app action" })).toHaveTextContent("Ship the repair");
  fireEvent.click(screen.getByRole("button", { name: "Approve this action" }));
  expect(p.onDecision).toHaveBeenCalledWith(true);
});
it("shows observed events without inventing a plan or completed tool", () => {
  render(<ChatWorkbench {...base()} events={[{ id: "one", at: 1, label: "Running list_tasks", kind: "info" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Run trace" }));
  expect(screen.getByRole("list", { name: "Observed run events" })).toHaveTextContent("Running list_tasks");
  expect(screen.queryByText("list_tasks completed")).not.toBeInTheDocument();
});
