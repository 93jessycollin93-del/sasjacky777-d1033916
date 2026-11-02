import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { applyPalette, DEFAULT_PALETTE, isKnownPalette } from "@/lib/palettes";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  /**
   * Which hues. A separate axis from light/dark on purpose: choosing a palette
   * must not discard a light/dark preference, and toggling light/dark must not
   * discard a palette.
   */
  palette: string;
  setPalette: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("jackie-theme") as Theme) || "dark";
    }
    return "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("jackie-theme", theme);
  }, [theme]);

  const [palette, setPaletteState] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_PALETTE;
    const saved = localStorage.getItem("jackie-palette");
    // A palette removed from the registry between releases resolves to the
    // default rather than leaving the app with an attribute nothing styles.
    return isKnownPalette(saved) ? saved : DEFAULT_PALETTE;
  });

  useEffect(() => {
    applyPalette(palette);
    try {
      localStorage.setItem("jackie-palette", palette);
    } catch {
      /* private mode; the palette still applies for this session */
    }
  }, [palette]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const setPalette = (id: string) => setPaletteState(isKnownPalette(id) ? id : DEFAULT_PALETTE);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, palette, setPalette }}>
      {children}
    </ThemeContext.Provider>
  );
};
