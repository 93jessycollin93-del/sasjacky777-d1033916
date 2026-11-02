/**
 * Locale-aware formatting.
 *
 * All of it goes through `Intl`, and all of it is cached, because constructing
 * a formatter is expensive and a list rendering a thousand rows will otherwise
 * build a thousand of them.
 *
 * The reason this file exists rather than callers using `Intl` directly: a
 * number rendered with `toLocaleString()` in one component and a hand-written
 * `toFixed(2)` in another is how a price appears as "1,234.50" in one place and
 * "1234.50" in the next, on the same screen. One formatter per concern, used
 * everywhere.
 */
import { localeSpec, type Locale } from "./locales";

const numberCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();
const collatorCache = new Map<string, Intl.Collator>();
const listCache = new Map<string, Intl.ListFormat>();

function cached<T>(store: Map<string, T>, key: string, build: () => T): T {
  let value = store.get(key);
  if (!value) {
    value = build();
    store.set(key, value);
  }
  return value;
}

export function formatNumber(value: number, locale: Locale, options: Intl.NumberFormatOptions = {}) {
  const key = `${locale}:${JSON.stringify(options)}`;
  return cached(numberCache, key, () => new Intl.NumberFormat(locale, options)).format(value);
}

/**
 * Money.
 *
 * The currency is never inferred from the locale: a French user paying in USD
 * must see "$", and showing them euros because their interface is French is a
 * financial error, not a formatting preference. The locale decides the shape,
 * the currency decides the symbol.
 */
export function formatCurrency(
  value: number,
  locale: Locale,
  currency = localeSpec(locale).currency,
) {
  return formatNumber(value, locale, { style: "currency", currency });
}

export function formatPercent(value: number, locale: Locale, fractionDigits = 0) {
  return formatNumber(value, locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Bytes, in the units a person reads. Base 2, labelled in the locale's digits. */
export function formatBytes(bytes: number, locale: Locale) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${formatNumber(value, locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`;
}

export function formatDate(
  value: Date | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const key = `${locale}:${JSON.stringify(options)}`;
  return cached(dateCache, key, () => new Intl.DateTimeFormat(locale, options)).format(value);
}

export function formatTime(value: Date | number, locale: Locale) {
  return formatDate(value, locale, { timeStyle: "short" });
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
];

/**
 * "3 minutes ago", in the locale's own words and its own plural rules —
 * which is why this is not a hand-built string with an "s" appended.
 */
export function formatRelativeTime(from: Date | number, locale: Locale, now = Date.now()) {
  const deltaMs = (from instanceof Date ? from.getTime() : from) - now;
  const formatter = cached(
    relativeCache,
    locale,
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
  );

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(deltaMs) >= ms) return formatter.format(Math.round(deltaMs / ms), unit);
  }
  return formatter.format(0, "second");
}

/**
 * Sorting.
 *
 * `Array.sort()` compares UTF-16 code units, which puts "Ärger" after "Zeus"
 * and every Cyrillic word after every Latin one. A collator sorts the way a
 * reader of that language expects, which is the only ordering that looks
 * correct to them.
 */
export function collator(locale: Locale, options: Intl.CollatorOptions = { sensitivity: "base" }) {
  return cached(
    collatorCache,
    `${locale}:${JSON.stringify(options)}`,
    () => new Intl.Collator(locale, options),
  );
}

export function sortByLocale<T>(items: T[], locale: Locale, key: (item: T) => string): T[] {
  const compare = collator(locale).compare;
  return [...items].sort((a, b) => compare(key(a), key(b)));
}

/** "a, b and c" — the conjunction and the commas both differ by language. */
export function formatList(
  items: string[],
  locale: Locale,
  type: Intl.ListFormatType = "conjunction",
) {
  return cached(
    listCache,
    `${locale}:${type}`,
    () => new Intl.ListFormat(locale, { style: "long", type }),
  ).format(items);
}
