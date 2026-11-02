import { Check, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * The language picker.
 *
 * Every language is listed in its own name. A picker that says "Ukrainian" is
 * useless to someone who reads only Ukrainian — they are looking for
 * "Українська", and the English label is the one thing they cannot read. The
 * English name follows in smaller text for anyone switching on someone else's
 * behalf.
 *
 * `lang` is set per item so the browser picks the right font for each script
 * rather than rendering 简体中文 through a Latin stack.
 */
export function LocalePicker({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, locales, t } = useTranslation();
  const current = locales.find((spec) => spec.code === locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11" aria-label={t("locale.change")}>
          <Languages className="mr-1 h-4 w-4" />
          <span lang={locale}>{compact ? locale : (current?.endonym ?? locale)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map((spec) => (
          <DropdownMenuItem
            key={spec.code}
            onSelect={() => setLocale(spec.code)}
            className="flex items-center gap-2"
          >
            <Check
              className={`h-4 w-4 ${spec.code === locale ? "opacity-100" : "opacity-0"}`}
              aria-hidden
            />
            <span lang={spec.code}>{spec.endonym}</span>
            <span className="text-xs text-muted-foreground">{spec.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
