/**
 * Palettes — a second axis beside light and dark.
 *
 * `useTheme` toggles light against dark and always has. A palette is a
 * different question: which hues, at whichever lightness the current mode
 * wants. Keeping them separate means choosing a palette does not throw away a
 * light/dark preference, and toggling light/dark does not throw away a palette.
 *
 * Applied as `data-palette` on the root element, so the CSS in `index.css`
 * overrides only the tokens a palette actually changes. The default palette
 * writes no attribute at all and is therefore exactly what shipped before this
 * file existed.
 */
export interface Palette {
  id: string;
  name: string;
  /** Where it came from, since one of these is inherited. */
  note: string;
  /** A swatch for the picker: primary, accent, background. */
  swatch: [string, string, string];
}

export const PALETTES: readonly Palette[] = [
  {
    id: "jackie",
    name: "Jackie",
    note: "The original. Terminal green on near-black, amber for warnings.",
    swatch: ["hsl(150 100% 50%)", "hsl(35 100% 50%)", "hsl(220 15% 5%)"],
  },
  {
    id: "aetherium",
    name: "Aetherium",
    note: "Ported from lore-forge-weave — deep slate, teal, amber.",
    swatch: ["hsl(175 70% 45%)", "hsl(38 80% 55%)", "hsl(222 25% 6%)"],
  },
] as const;

export const DEFAULT_PALETTE = "jackie";

export function isKnownPalette(id: unknown): id is string {
  return typeof id === "string" && PALETTES.some((palette) => palette.id === id);
}

export function findPalette(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

/**
 * Writes the palette to the document.
 *
 * The default removes the attribute rather than setting `data-palette="jackie"`,
 * so the CSS has one fewer selector to carry and the shipped appearance is the
 * plain, unqualified `:root` — the one that is hardest to break by accident.
 */
export function applyPalette(id: string): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!isKnownPalette(id) || id === DEFAULT_PALETTE) root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", id);
}
