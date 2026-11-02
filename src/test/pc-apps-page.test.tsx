import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PcApps from "@/pages/PcApps";
import { PC_APPS } from "@/data/pcApps";

/**
 * The library page is behind ProtectedRoute, so it cannot be reached by
 * clicking through without an account. Mounting it directly is what proves the
 * roster actually reaches the screen as links, rather than only existing in
 * the generated module.
 */
const mount = () =>
  render(
    <MemoryRouter>
      <PcApps />
    </MemoryRouter>,
  );

describe("PC App Library", () => {
  it("renders a link for every app in the roster", () => {
    mount();
    // Folders are listed alongside the apps, so this is a floor, not equality.
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/pc?app="));
    expect(links.length).toBeGreaterThanOrEqual(PC_APPS.length);
  });

  it("deep-links each app by its own id", () => {
    mount();
    const sample = PC_APPS.find((a) => a.appId === "model_router");
    expect(sample).toBeDefined();
    const link = screen.getByTitle(`Open the PC with ${sample!.name} running`);
    expect(link.getAttribute("href")).toBe("/pc?app=model_router");
  });

  it("filters as you type", () => {
    mount();
    const before = screen.getAllByRole("link").length;
    fireEvent.change(screen.getByPlaceholderText(/Search \d+ PC apps/), {
      target: { value: "router" },
    });
    const after = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/pc?app="));
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before);
    expect(
      after.every((a) =>
        (a.textContent ?? "").toLowerCase().includes("router"),
      ),
    ).toBe(true);
  });
});
