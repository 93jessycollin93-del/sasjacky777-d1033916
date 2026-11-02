/**
 * Choosing the hues.
 *
 * Sits beside the light/dark toggle because that is where someone looks when
 * they want the app to look different, and it is deliberately a separate
 * control: a palette and a mode are two axes, and collapsing them into one
 * menu would mean picking a palette could silently move you from dark to light.
 */
import { useState } from "react";
import { Palette as PaletteIcon } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { PALETTES } from "@/lib/palettes";

export function PalettePicker() {
  const { palette, setPalette } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-secondary btn-mechanical transition-colors duration-150"
        title="Colour palette"
        aria-label="Choose a colour palette"
        aria-expanded={open}
      >
        <PaletteIcon size={14} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-border bg-popover py-1 shadow-lg">
            {PALETTES.map((option) => (
              <button
                key={option.id}
                onClick={() => { setPalette(option.id); setOpen(false); }}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary ${
                  palette === option.id ? "bg-secondary/50" : ""
                }`}
              >
                <span className="mt-0.5 flex gap-0.5">
                  {option.swatch.map((colour) => (
                    <span
                      key={colour}
                      className="h-3 w-3 rounded-[2px] border border-border/50"
                      style={{ background: colour }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-mono text-xs text-foreground">
                    {option.name}
                    {palette === option.id && <span className="text-[9px] text-primary">●</span>}
                  </span>
                  <span className="block text-[10px] leading-snug text-muted-foreground">{option.note}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
