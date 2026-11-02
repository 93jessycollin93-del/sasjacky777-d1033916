import { useCallback, useMemo, useSyncExternalStore } from "react";
import { i18n } from "@/lib/i18n/service";
import type { MessageKey } from "@/lib/i18n/messages/en";
import type { MessageValues } from "@/lib/i18n/message";
import { LOCALE_SPECS, LOCALES, type Locale } from "@/lib/i18n/locales";
import {
  formatBytes,
  formatDate,
  formatNumber,
  formatRelativeTime,
  formatTime,
} from "@/lib/i18n/format";

/**
 * The View's access to language.
 *
 * The formatters are bound to the current locale here so a component cannot
 * accidentally format a number in one language while rendering its label in
 * another — the mismatch that produces "1,234.5 файлов".
 */
export function useTranslation() {
  const { locale, dir } = useSyncExternalStore(i18n.subscribe, i18n.getSnapshot, i18n.getSnapshot);

  const t = useCallback((key: MessageKey, values?: MessageValues) => i18n.t(key, values), []);
  const setLocale = useCallback((next: Locale) => i18n.setLocale(next), []);

  return useMemo(
    () => ({
      t,
      locale,
      dir,
      setLocale,
      locales: LOCALES.map((code) => LOCALE_SPECS[code]),
      n: (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, locale, options),
      bytes: (value: number) => formatBytes(value, locale),
      date: (value: Date | number) => formatDate(value, locale),
      time: (value: Date | number) => formatTime(value, locale),
      ago: (value: Date | number) => formatRelativeTime(value, locale),
    }),
    [t, locale, dir, setLocale],
  );
}
