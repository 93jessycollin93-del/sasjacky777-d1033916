import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPalette, DEFAULT_PALETTE, findPalette, isKnownPalette, PALETTES,
} from "@/lib/palettes";

/**
 * Palettes are a second axis beside light and dark.
 *
 * Ported from lore-forge-weave, whose modules were mock but whose colour work
 * was real. The design constraint is that it stays a *choice*: the default
 * writes no attribute at all, so the appearance that shipped before this
 * existed is the plain, unqualified `:root` — the one hardest to break.
 */
describe("the registry", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-palette"));

  it("has the original as its default", () => {
    expect(DEFAULT_PALETTE).toBe("jackie");
    expect(PALETTES[0].id).toBe("jackie");
  });

  it("gives every palette a three-colour swatch for the picker", () => {
    for (const palette of PALETTES) {
      expect(palette.swatch, palette.id).toHaveLength(3);
      expect(palette.name, palette.id).toBeTruthy();
      expect(palette.note, palette.id).toBeTruthy();
    }
  });

  it("recognises what it ships and nothing else", () => {
    expect(isKnownPalette("aetherium")).toBe(true);
    expect(isKnownPalette("whatever")).toBe(false);
    expect(isKnownPalette(null)).toBe(false);
  });

  it("resolves an unknown id to the default rather than to nothing", () => {
    // A palette removed between releases must not leave the app holding an
    // attribute nothing styles.
    expect(findPalette("removed-last-year").id).toBe(DEFAULT_PALETTE);
  });
});

describe("applying one", () => {
  beforeEach(() => document.documentElement.removeAttribute("data-palette"));

  it("marks the document for a non-default palette", () => {
    applyPalette("aetherium");
    expect(document.documentElement.getAttribute("data-palette")).toBe("aetherium");
  });

  it("writes no attribute for the default", () => {
    applyPalette("aetherium");
    applyPalette("jackie");
    // Not `data-palette="jackie"`: the shipped appearance stays the plain
    // `:root` block, with one fewer selector for the CSS to carry.
    expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
  });

  it("clears the attribute for an id it does not know", () => {
    applyPalette("aetherium");
    applyPalette("nonsense");
    expect(document.documentElement.hasAttribute("data-palette")).toBe(false);
  });
});
