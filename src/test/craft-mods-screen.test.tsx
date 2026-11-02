import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MODS } from "@/craft/engine/mods";
import { ModsList, ModsScreen } from "@/craft/ui/ModsScreen";
import { EndPoem } from "@/craft/ui/EndPoem";

describe("the Mods screen", () => {
  it("lists every borrowed feature with a link to the mod it came from", () => {
    const { container } = render(<ModsList disabled={[]} />);
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(MODS.length);
    for (const m of MODS) expect(links.some((a) => a.getAttribute("href") === m.url && a.textContent === m.inspiredBy)).toBe(true);
  });

  it("switches a feature off for the world, and back on", () => {
    const onChange = vi.fn();
    const { getAllByText, rerender } = render(<ModsList disabled={[]} onChange={onChange} />);
    fireEvent.click(getAllByText("On")[0]);
    const first = MODS.find((m) => m.toggle)!.id;
    expect(onChange).toHaveBeenLastCalledWith([first]);
    rerender(<ModsList disabled={[first]} onChange={onChange} />);
    fireEvent.click(getAllByText("Off")[0]);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("shows a guest the host's choices without letting them change them", () => {
    const { getAllByText } = render(<ModsScreen disabled={["seasons"]} onBack={() => {}} />);
    const buttons = getAllByText(/^(On|Off)$/) as HTMLButtonElement[];
    expect(buttons.every((b) => b.closest("button")?.disabled)).toBe(true);
  });

  it("marks the features that need no switch as always on", () => {
    const { getAllByText } = render(<ModsList disabled={[]} onChange={() => {}} />);
    expect(getAllByText("Always on")).toHaveLength(MODS.filter((m) => !m.toggle).length);
  });

  it("thanks each mod by name in the credits after the poem", () => {
    const { container } = render(<EndPoem name="Collin" onDone={() => {}} />);
    for (const m of MODS) expect(container.textContent).toContain(m.inspiredBy);
  });
});
