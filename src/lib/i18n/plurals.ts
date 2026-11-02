/**
 * Plurals, taken from the runtime's own CLDR rather than reimplemented.
 *
 * Hand-rolled plural logic is where localization quietly breaks. English has
 * two forms and every naive system assumes two; Russian and Ukrainian have
 * four, and the rule is not "big numbers are different" — 21 is `one`, 22 is
 * `few`, 11 is `many`, and 1.5 is `other`. A message written with only `one`
 * and `other` renders 5 as "5 файл" instead of "5 файлов", every time, in a
 * build that passed its tests because the tests were written in English.
 *
 * `Intl.PluralRules` IS the CLDR table, kept current by the platform. Using it
 * is the correct answer, so the job here is not to restate the rules but to
 * make the failure above impossible: ask the runtime which categories a locale
 * requires, and refuse a message that does not supply them.
 */
import type { Locale } from "./locales";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const CATEGORY_ORDER: PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

const categoryCache = new Map<string, PluralCategory[]>();
const rulesCache = new Map<string, Intl.PluralRules>();

function rulesFor(locale: Locale, fractionDigits: number): Intl.PluralRules {
  const key = `${locale}:${fractionDigits}`;
  let rules = rulesCache.get(key);
  if (!rules) {
    rules = new Intl.PluralRules(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: Math.max(fractionDigits, 3),
    });
    rulesCache.set(key, rules);
  }
  return rules;
}

/**
 * The categories this locale actually uses, in CLDR order.
 *
 * Asked of the runtime, not hardcoded — so a locale added later brings its own
 * rules with it and the validator below covers it without a code change.
 */
export function pluralCategories(locale: Locale): PluralCategory[] {
  let categories = categoryCache.get(locale);
  if (!categories) {
    const reported = new Intl.PluralRules(locale).resolvedOptions()
      .pluralCategories as PluralCategory[];
    categories = CATEGORY_ORDER.filter((c) => reported.includes(c));
    categoryCache.set(locale, categories);
  }
  return categories;
}

/**
 * Which form a count takes.
 *
 * `fractionDigits` matters and is the part usually dropped: in Russian "1
 * файл" is `one` but "1,0 файла" is `other`, and the two differ only by the
 * digits shown. A selector that takes the number alone cannot tell them apart
 * and gets the decimal case wrong in every Slavic locale.
 */
export function selectPlural(locale: Locale, count: number, fractionDigits = 0): PluralCategory {
  if (!Number.isFinite(count)) return "other";
  return rulesFor(locale, fractionDigits).select(count) as PluralCategory;
}

/** Ordinal form, for "1st", "2nd", "3rd" — a different table from cardinals. */
export function selectOrdinal(locale: Locale, count: number): PluralCategory {
  return new Intl.PluralRules(locale, { type: "ordinal" }).select(count) as PluralCategory;
}

/**
 * Categories a message is missing for a locale.
 *
 * `other` is always required — it is the catch-all for fractions and for
 * anything the table does not name. Empty means the message is complete.
 */
export function missingCategories(
  locale: Locale,
  supplied: readonly string[],
): PluralCategory[] {
  const required = pluralCategories(locale);
  return required.filter((category) => !supplied.includes(category));
}

/**
 * Picks the form for a count, degrading down the CLDR order rather than
 * rendering nothing.
 *
 * A missing category is a bug the validator is meant to catch before shipping.
 * If one reaches a person anyway, showing a grammatically wrong form beats
 * showing an empty string where a sentence should be.
 */
export function resolveForm(
  forms: Readonly<Record<string, string>>,
  category: PluralCategory,
): { form: string; exact: boolean } {
  const exact = forms[category];
  if (exact !== undefined) return { form: exact, exact: true };

  const order = CATEGORY_ORDER.slice(CATEGORY_ORDER.indexOf(category) + 1);
  for (const next of [...order, ...CATEGORY_ORDER]) {
    const candidate = forms[next];
    if (candidate !== undefined) return { form: candidate, exact: false };
  }
  return { form: "", exact: false };
}
