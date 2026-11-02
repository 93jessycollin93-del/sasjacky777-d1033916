import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import golden from "./fixtures/morals-ledger.golden.json";

/**
 * The page the owner reads to decide whether to trust Jackie: that it says
 * plainly when it is not set up, when the history was tampered with, and when
 * everything checks out — and that it remembers what it verified.
 */

const OWNER = "aaaaaaaa-0000-0000-0000-000000000001";
let roles: { role: string }[] = [{ role: "owner" }];
let roleError: { message: string } | null = null;

const data = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  loadMorals: vi.fn(),
  loadLedger: vi.fn(),
  loadAttestations: vi.fn(),
  addMoral: vi.fn(),
  sealNow: vi.fn(),
}));

vi.mock("@/lib/jackie-morals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jackie-morals")>()),
  ...data,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: OWNER }, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: roleError ? null : roles, error: roleError }) }) }) },
}));

import JackieMorals from "@/pages/JackieMorals";

// The columns as the database fills them: the same values as the hashed record.
const ledger = golden.map((r) => ({ ...r, at: JSON.parse(r.payload).at as string, actor: OWNER, moral_id: null }));
const status = {
  persona: { text: "You are Jackie.", fingerprint: "p".repeat(64) },
  morals: { block: "", fingerprint: "none", count: 0, enabled: 0 },
  engines: ["jackie-chat"],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/morals"]}>
      <JackieMorals />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  roles = [{ role: "owner" }];
  roleError = null;
  localStorage.clear();
  for (const fn of Object.values(data)) fn.mockReset();
  data.fetchStatus.mockResolvedValue({ ok: true, data: status });
  data.loadMorals.mockResolvedValue({ ok: true, data: [] });
  data.loadLedger.mockResolvedValue({ ok: true, data: ledger });
  data.loadAttestations.mockResolvedValue({ ok: true, data: [] });
});

describe("Jackie's morals page", () => {
  it("shows a non-owner the door, not the morals", async () => {
    roles = [];
    renderPage();
    expect(await screen.findByText("Jackie's morals are the owner's to set")).toBeTruthy();
    expect(data.loadMorals).not.toHaveBeenCalled();
  });

  it("says the guard rail is not switched on, and how to switch it on, before the migration is pushed", async () => {
    data.loadLedger.mockResolvedValue({ ok: false, error: 'jackie_morals_ledger: relation "public.jackie_morals_ledger" does not exist' });
    renderPage();
    expect(await screen.findByText("The guard rail is built but not switched on yet.")).toBeTruthy();
    expect(screen.getByText(/supabase db push/)).toBeTruthy();
  });

  it("raises tampering when an entry in the history was edited", async () => {
    const edited = ledger.map((r) => (r.seq === 2 ? { ...r, payload: r.payload.replace('"enabled": false', '"enabled": true') } : r));
    data.loadLedger.mockResolvedValue({ ok: true, data: edited });
    renderPage();
    expect(await screen.findByText("Something changed that you did not approve, or could not be verified.")).toBeTruthy();
    expect(screen.getByText(/Tampered: entry #2 was changed after it was written/)).toBeTruthy();
    // A tampered history is never remembered as the one this browser trusts.
    expect(localStorage.getItem("jackie-morals-witness:v1")).toBeNull();
  });

  it("remembers the head of a history that verified, so a later rewrite can be caught", async () => {
    renderPage();
    await screen.findByText(/every hash checks out/);
    await waitFor(() => expect(localStorage.getItem("jackie-morals-witness:v1")).toContain(`"seq":4`));
  });

  it("does not tell the real owner they are not the owner when the lookup itself failed", async () => {
    roleError = { message: "network timeout" };
    renderPage();
    expect(await screen.findByText("Could not check who you are")).toBeTruthy();
    expect(screen.queryByText("Jackie's morals are the owner's to set")).toBeNull();
  });

  it("after a break, lets the owner trust the history from here — and holds the seal until they do", async () => {
    const edited = ledger.map((r) => (r.seq === 2 ? { ...r, payload: r.payload.replace('"enabled": false', '"enabled": true') } : r));
    data.loadLedger.mockResolvedValue({ ok: true, data: edited });
    renderPage();
    await screen.findByText(/Tampered: entry #2/);
    expect((screen.getByRole("button", { name: /Seal current state/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /trust the history from here/ }));
    await waitFor(() => expect(localStorage.getItem("jackie-morals-anchor:v1")).toContain(`"seq":4`));
    // Checking restarts from entry #4: the break before it no longer blocks, and nothing sealed before it is relied on.
    expect(await screen.findByText(/Checked from entry #4/)).toBeTruthy();
    expect(screen.getByText(/Nothing sealed since you chose to trust/)).toBeTruthy();
  });

  it("offers the suggested morals when there are none, and adds a moral the owner writes", async () => {
    data.addMoral.mockResolvedValue({ ok: true, data: null });
    renderPage();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Morals/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Morals/ }));
    expect(await screen.findByText(/Add the suggested morals/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Keep promises" } });
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "Do what you said you would." } });
    fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
    await waitFor(() => expect(data.addMoral).toHaveBeenCalled());
    expect(data.addMoral.mock.calls[0][0]).toMatchObject({ title: "Keep promises", rule: "Do what you said you would.", category: "custom" });
    // Let the add finish (its refresh, then busy off) before the file's
    // environment is torn down; otherwise React's late setState finds no window.
    await waitFor(() => expect((screen.getByRole("button", { name: /Re-check/ }) as HTMLButtonElement).disabled).toBe(false));
  });
});
