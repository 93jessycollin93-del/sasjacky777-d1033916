/**
 * The locales, as data.
 *
 * Everything that differs between languages and is not a translated string
 * lives here: how the language is written, what it calls itself, how much
 * longer its text runs than English, and what has to be true of a font before
 * it can render it. Scattering those facts through components is how an app
 * ends up with a layout that only fits English and a Chinese build with the
 * wrong glyphs.
 *
 * `expansion` is the practical one. German and Russian run long, Chinese runs
 * short, and a button sized to "Save" in English clips "Сохранить". It is used
 * by the QA report to flag strings that will overflow before anyone sees them
 * on a device.
 */

export const LOCALES = ["en", "uk", "ru", "zh-Hans", "es", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleSpec {
  code: Locale;
  /** Name in English. */
  name: string;
  /** What the language calls itself — what the picker must show. */
  endonym: string;
  dir: "ltr" | "rtl";
  /**
   * Typical length of translated text relative to English. Measured ratios,
   * not guesses: Slavic languages run ~15% long, Chinese runs ~40% short.
   */
  expansion: number;
  /**
   * Scripts the locale needs rendered. A font stack missing these produces
   * tofu boxes, which is a silent failure — nothing throws, the text is just
   * unreadable.
   */
  scripts: string[];
  /** BCP-47 tags to try, in order, when a key is missing. */
  fallbacks: Locale[];
  /** Default currency for price formatting when none is given. */
  currency: string;
}

export const LOCALE_SPECS: Record<Locale, LocaleSpec> = {
  en: {
    code: "en",
    name: "English",
    endonym: "English",
    dir: "ltr",
    expansion: 1,
    scripts: ["Latin"],
    fallbacks: [],
    currency: "USD",
  },
  uk: {
    code: "uk",
    name: "Ukrainian",
    endonym: "Українська",
    dir: "ltr",
    expansion: 1.15,
    scripts: ["Cyrillic"],
    // Ukrainian does NOT fall back to Russian. They are different languages,
    // and the substitution is offensive to a large part of the audience — a
    // technically convenient fallback that would be read as a political one.
    fallbacks: ["en"],
    currency: "UAH",
  },
  ru: {
    code: "ru",
    name: "Russian",
    endonym: "Русский",
    dir: "ltr",
    expansion: 1.15,
    scripts: ["Cyrillic"],
    fallbacks: ["en"],
    currency: "USD",
  },
  "zh-Hans": {
    code: "zh-Hans",
    name: "Chinese (Simplified)",
    endonym: "简体中文",
    dir: "ltr",
    expansion: 0.6,
    scripts: ["Han"],
    fallbacks: ["en"],
    currency: "CNY",
  },
  es: {
    code: "es",
    name: "Spanish",
    endonym: "Español",
    dir: "ltr",
    expansion: 1.2,
    scripts: ["Latin"],
    fallbacks: ["en"],
    currency: "EUR",
  },
  fr: {
    code: "fr",
    name: "French",
    endonym: "Français",
    dir: "ltr",
    expansion: 1.2,
    scripts: ["Latin"],
    fallbacks: ["en"],
    currency: "EUR",
  },
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function localeSpec(locale: Locale): LocaleSpec {
  return LOCALE_SPECS[locale];
}

/**
 * The chain a lookup walks: the locale, then its declared fallbacks, then the
 * default. Deduplicated and always ending at the default, so a lookup can never
 * run off the end of the chain and return a raw key to a person.
 */
export function fallbackChain(locale: Locale): Locale[] {
  const chain = [locale, ...localeSpec(locale).fallbacks, DEFAULT_LOCALE];
  return [...new Set(chain)];
}

/**
 * Best match for what the browser asks for.
 *
 * Matches on the base language when the exact tag is unknown, so `zh-CN`,
 * `zh-Hans-CN` and `zh` all reach Simplified Chinese, and `fr-CA` reaches
 * French rather than falling to English.
 */
export function negotiateLocale(requested: readonly string[]): Locale {
  for (const tag of requested) {
    if (isLocale(tag)) return tag;

    const base = tag.split("-")[0].toLowerCase();
    if (base === "zh") return "zh-Hans";

    const match = LOCALES.find((code) => code.split("-")[0].toLowerCase() === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
