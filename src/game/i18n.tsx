import React, { createContext, useContext, useCallback, useSyncExternalStore, ReactNode } from 'react';
import { en } from './translations/en';
import { ru } from './translations/ru';
import { uk } from './translations/uk';
import { zh } from './translations/zh';
import { i18n } from '@/lib/i18n/service';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

/**
 * The game's translation surface, bridged onto the real locale service.
 *
 * This file used to hardcode `translations = en` and expose a `setLocale` that
 * did nothing. The ru/uk/zh files beside it had been written and were
 * unreachable: the switcher in the UI changed no text, and nobody could tell,
 * because the strings existed and looked translated in the repo.
 *
 * The catalogs here are the game's own and stay as they are — this only makes
 * them reachable, keyed off the one locale the rest of the app already uses.
 * The `t(key, ...args)` signature with `{0}` positional interpolation is
 * unchanged, so every existing caller keeps working.
 */
type TranslationMap = Record<string, string>;

const GAME_CATALOGS: Partial<Record<Locale, TranslationMap>> = {
  en,
  ru,
  uk,
  'zh-Hans': zh,
};

function interpolate(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, ...args: (string | number)[]) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { locale } = useSyncExternalStore(i18n.subscribe, i18n.getSnapshot, i18n.getSnapshot);

  const setLocale = useCallback((next: Locale) => {
    i18n.setLocale(next);
  }, []);

  const t = useCallback(
    (key: string, ...args: (string | number)[]): string => {
      // The game's catalogs do not cover every locale the app offers. A missing
      // one falls to English rather than to the key, which is what a player
      // would otherwise see mid-sentence.
      const catalog = GAME_CATALOGS[locale] ?? GAME_CATALOGS[DEFAULT_LOCALE]!;
      const val = catalog[key] ?? GAME_CATALOGS[DEFAULT_LOCALE]![key] ?? key;
      return args.length > 0 ? interpolate(val, ...args) : val;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}
