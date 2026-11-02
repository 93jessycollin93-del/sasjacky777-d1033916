/**
 * One locale across two i18n systems.
 *
 * Eru shipped its own provider — a good one, with fallback, interpolation and
 * missing-key reporting — holding its own locale in its own storage key and
 * writing its own `<html lang>`. The app now has a shared locale service that
 * does the same. Two holders of the same fact, both writing the same DOM
 * attribute, is the bug: switch the language on an Eru screen and the rest of
 * the app stays as it was, with `<html lang>` describing whichever one wrote
 * last.
 *
 * Rather than rewrite Eru's provider and its catalogs, this maps between the
 * two so there is one language. Eru keeps its own strings; the service keeps
 * the decision.
 *
 * The tags differ — Eru says `zh`, the service says `zh-Hans` — and mapping
 * both ways here is the only place that difference exists.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

/** Locales Eru's own catalogs actually cover. */
export const ERU_LANGS = ["en", "uk", "zh", "ru"] as const;

export type EruLang = (typeof ERU_LANGS)[number];

export function toEruLang(locale: Locale): EruLang {
  if (locale === "zh-Hans") return "zh";
  return (ERU_LANGS as readonly string[]).includes(locale) ? (locale as EruLang) : "en";
}

export function fromEruLang(lang: string): Locale {
  if (lang === "zh") return "zh-Hans";
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/**
 * True when the service's locale has no Eru catalog behind it.
 *
 * Eru then renders English, which is correct — but it is a gap worth naming
 * rather than a silent downgrade, so the QA surface can show it.
 */
export function eruCoversLocale(locale: Locale): boolean {
  return toEruLang(locale) !== "en" || locale === "en";
}
