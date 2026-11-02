/**
 * The owner of locale state.
 *
 * One service, one locale, one place that writes `lang` and `dir` on the
 * document. Components read a projection and dispatch a change; none of them
 * hold a locale of their own, because two components disagreeing about the
 * current language is a bug you only see in screenshots.
 *
 * The stored choice wins over the browser's, always. Someone who picked
 * Ukrainian on a device set to Russian picked it for a reason, and re-deciding
 * from `navigator.languages` on every load would overrule them silently.
 */
import { DEFAULT_LOCALE, isLocale, localeSpec, negotiateLocale, type Locale } from "./locales";
import { translate, type MessageKey, type TranslateResult } from "./catalog";
import type { MessageValues } from "./message";

const STORAGE_KEY = "jackie.locale.v1";

export interface MissingReport {
  key: MessageKey;
  locale: Locale;
  /** Where the string came from instead. */
  from: Locale;
}

export class I18nService {
  private locale: Locale;
  private listeners = new Set<() => void>();
  private missing = new Map<string, MissingReport>();
  private snapshot: { locale: Locale; dir: "ltr" | "rtl" };

  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
    requested: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [],
  ) {
    const stored = this.storage?.getItem(STORAGE_KEY);
    this.locale = stored && isLocale(stored) ? stored : negotiateLocale(requested);
    this.snapshot = { locale: this.locale, dir: localeSpec(this.locale).dir };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  getLocale(): Locale {
    return this.locale;
  }

  setLocale(locale: Locale) {
    if (locale === this.locale) return;
    this.locale = locale;
    this.snapshot = { locale, dir: localeSpec(locale).dir };

    try {
      this.storage?.setItem(STORAGE_KEY, locale);
    } catch {
      // A private window refuses writes. The choice still applies to this
      // session; it just will not survive a reload, which is better than
      // throwing out of a language switch.
    }

    // The document's own language, which drives hyphenation, font selection
    // and every screen reader's pronunciation. Setting it on <html> is not
    // decoration.
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.dir = this.snapshot.dir;
    }

    for (const listener of this.listeners) listener();
  }

  /**
   * Translates, and records anything that fell back so the gap is a list
   * someone can act on rather than a thing a user notices first.
   */
  t = (key: MessageKey, values: MessageValues = {}): string => {
    const result: TranslateResult = translate(key, this.locale, values);
    if (result.fellBack && this.locale !== DEFAULT_LOCALE) {
      this.missing.set(`${this.locale}:${key}`, { key, locale: this.locale, from: result.from });
    }
    return result.text;
  };

  /** Full result, for surfaces that need to show what happened. */
  translate(key: MessageKey, values: MessageValues = {}): TranslateResult {
    return translate(key, this.locale, values);
  }

  /** Keys that fell back during this session, in the order first seen. */
  getMissing(): MissingReport[] {
    return [...this.missing.values()];
  }
}

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export const i18n = new I18nService();
