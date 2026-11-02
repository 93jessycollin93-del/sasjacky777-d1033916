/**
 * The catalogs, the fallback chain, and the QA that stops a bad translation
 * reaching a person.
 *
 * The premise: nobody on the team reads all six languages, so correctness in
 * five of them cannot come from review. It has to come from checks that a
 * machine can run — which is what this file is. Three defects are caught here,
 * and each one is invisible to an English-speaking reviewer:
 *
 *  1. A plural message missing a category the language requires. Russian needs
 *     four; a translator handing back two produces "5 станция" forever.
 *  2. A placeholder renamed in English and not in the translation. The
 *     translated string then renders a literal `{count}` to the user.
 *  3. A string left in English. Not an error — some are correct untranslated —
 *     but it must be counted and visible, not silently shipped as "done".
 */
import { DEFAULT_LOCALE, fallbackChain, localeSpec, type Locale } from "./locales";
import { formsIn, placeholdersIn, renderMessage, type MessageValues } from "./message";
import { missingCategories } from "./plurals";
import { en, type MessageKey } from "./messages/en";

// `MessageKey` is defined alongside the English catalog, which is the key set of
// record. Re-exported here because this module is the catalog API everything
// else imports; `service.ts` already expected to find it on this path.
export type { MessageKey };
import { ru } from "./messages/ru";
import { uk } from "./messages/uk";
import { zhHans } from "./messages/zh";
import { es } from "./messages/es";
import { fr } from "./messages/fr";

export type Catalog = Partial<Record<MessageKey, string>>;

export const CATALOGS: Record<Locale, Catalog> = {
  en,
  ru,
  uk,
  "zh-Hans": zhHans,
  es,
  fr,
};

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

export interface Lookup {
  template: string;
  /** The locale the string actually came from, which may not be the one asked. */
  from: Locale;
  /** True when the requested locale had no string and the chain was walked. */
  fellBack: boolean;
}

/**
 * Finds a string, walking the fallback chain.
 *
 * Never returns undefined. A key with no string anywhere returns the key
 * itself, which is ugly on screen and therefore gets noticed and fixed —
 * unlike an empty string, which looks like an intentionally blank label.
 */
export function lookup(key: MessageKey, locale: Locale): Lookup {
  for (const candidate of fallbackChain(locale)) {
    const template = CATALOGS[candidate]?.[key];
    if (template !== undefined) {
      return { template, from: candidate, fellBack: candidate !== locale };
    }
  }
  return { template: key, from: DEFAULT_LOCALE, fellBack: true };
}

export interface TranslateResult {
  text: string;
  from: Locale;
  fellBack: boolean;
  missingValues: string[];
  inexactPlural: boolean;
}

export function translate(
  key: MessageKey,
  locale: Locale,
  values: MessageValues = {},
): TranslateResult {
  const found = lookup(key, locale);
  // Rendered against the locale the STRING came from, not the one requested:
  // a French string reached by fallback must use French plural rules, or the
  // forms the translator wrote will be selected by the wrong table.
  const rendered = renderMessage(found.template, values, found.from);
  return { ...rendered, from: found.from, fellBack: found.fellBack };
}

export type IssueKind =
  | "missing"
  | "missing-plural-category"
  | "placeholder-mismatch"
  | "untranslated"
  | "expansion-risk";

export interface CatalogIssue {
  locale: Locale;
  key: MessageKey;
  kind: IssueKind;
  detail: string;
}

export interface CatalogReport {
  locale: Locale;
  total: number;
  translated: number;
  /** Share of keys with a string in this locale, 0..1. */
  coverage: number;
  issues: CatalogIssue[];
  /** Issues that must not ship: they render wrong text to a user. */
  blocking: CatalogIssue[];
}

const BLOCKING: IssueKind[] = ["missing-plural-category", "placeholder-mismatch"];

/**
 * Checks one locale against the English source.
 *
 * `expansion-risk` is advisory: a string far longer than its expansion factor
 * predicts is not wrong, it is a layout that has not been looked at. Flagging
 * it here is cheaper than finding it on a device.
 */
export function auditCatalog(locale: Locale): CatalogReport {
  const catalog = CATALOGS[locale];
  const spec = localeSpec(locale);
  const issues: CatalogIssue[] = [];
  let translated = 0;

  for (const key of MESSAGE_KEYS) {
    const source = en[key];
    const target = catalog[key];

    if (target === undefined) {
      if (locale !== DEFAULT_LOCALE) {
        issues.push({ locale, key, kind: "missing", detail: "no string in this locale" });
      }
      continue;
    }
    translated++;

    if (locale !== DEFAULT_LOCALE && target === source) {
      issues.push({
        locale,
        key,
        kind: "untranslated",
        detail: "identical to the English source",
      });
    }

    const sourcePlaceholders = new Set(placeholdersIn(source));
    const targetPlaceholders = new Set(placeholdersIn(target));
    const lost = [...sourcePlaceholders].filter((p) => !targetPlaceholders.has(p));
    const invented = [...targetPlaceholders].filter((p) => !sourcePlaceholders.has(p));
    if (lost.length || invented.length) {
      issues.push({
        locale,
        key,
        kind: "placeholder-mismatch",
        detail: [
          lost.length ? `dropped ${lost.join(", ")}` : "",
          invented.length ? `invented ${invented.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
      });
    }

    for (const [argument, supplied] of Object.entries(formsIn(target))) {
      // `=N` forms are exact matches, not plural categories, and do not count
      // towards the ones CLDR requires.
      const categories = supplied.filter((form) => !form.startsWith("="));
      const missing = missingCategories(locale, categories);
      if (missing.length > 0) {
        issues.push({
          locale,
          key,
          kind: "missing-plural-category",
          detail: `{${argument}} needs ${missing.join(", ")} in ${locale}`,
        });
      }
    }

    // 1.6x the predicted expansion is the point where a string has stopped
    // being "this language is longer" and started being a different sentence.
    const predicted = source.length * spec.expansion;
    if (target.length > predicted * 1.6 && target.length - source.length > 24) {
      issues.push({
        locale,
        key,
        kind: "expansion-risk",
        detail: `${target.length} chars against ~${Math.round(predicted)} predicted`,
      });
    }
  }

  return {
    locale,
    total: MESSAGE_KEYS.length,
    translated,
    coverage: MESSAGE_KEYS.length === 0 ? 1 : translated / MESSAGE_KEYS.length,
    issues,
    blocking: issues.filter((issue) => BLOCKING.includes(issue.kind)),
  };
}

export function auditAll(): CatalogReport[] {
  return (Object.keys(CATALOGS) as Locale[]).map(auditCatalog);
}

/** Keys present in a translation but not in the English source — dead weight from a rename. */
export function orphanKeys(locale: Locale): string[] {
  const source = new Set<string>(MESSAGE_KEYS);
  return Object.keys(CATALOGS[locale]).filter((key) => !source.has(key));
}
