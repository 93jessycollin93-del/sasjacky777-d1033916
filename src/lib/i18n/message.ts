/**
 * A small, deliberate subset of ICU MessageFormat.
 *
 *   "Hello {name}"
 *   "{count, plural, one {# station} other {# stations}}"
 *   "{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}"
 *   "{gender, select, female {her} male {his} other {their}} device"
 *
 * A subset rather than the whole spec on purpose: full ICU brings nested
 * plurals, number skeletons and date arguments, and every one of those is a
 * place a translator can write something that throws at runtime in a language
 * nobody on the team reads. What is here covers the cases real product copy
 * needs, and anything it does not understand is left alone rather than
 * guessed at.
 *
 * `#` inside a plural form is the count, formatted for the locale — which is
 * the whole reason it exists. Writing "{count} файлов" in a Russian string
 * gives "1 234 файлов" with the wrong separator on half the platforms.
 */
import type { Locale } from "./locales";
import { formatNumber } from "./format";
import { resolveForm, selectPlural, type PluralCategory } from "./plurals";

export type MessageValues = Record<string, string | number | boolean | null | undefined>;

export interface RenderResult {
  text: string;
  /** Placeholders the message used that no value was supplied for. */
  missingValues: string[];
  /**
   * True when a plural fell back to a form that is not the right one for the
   * count. The QA report treats this as a defect, because it is one.
   */
  inexactPlural: boolean;
}

/** Splits the body of an argument on top-level commas, respecting nesting. */
function splitArg(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (char === "," && depth === 0 && parts.length < 2) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

/** Reads `key {body}` pairs out of a plural/select clause. */
function parseForms(source: string): Record<string, string> {
  const forms: Record<string, string> = {};
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index++;
    if (index >= source.length) break;

    const start = index;
    while (index < source.length && !/[\s{]/.test(source[index])) index++;
    const key = source.slice(start, index).trim();

    while (index < source.length && /\s/.test(source[index])) index++;
    if (source[index] !== "{") break;

    let depth = 0;
    const bodyStart = ++index;
    depth = 1;
    while (index < source.length && depth > 0) {
      if (source[index] === "{") depth++;
      else if (source[index] === "}") depth--;
      if (depth > 0) index++;
    }
    if (key) forms[key] = source.slice(bodyStart, index);
    index++; // past the closing brace
  }

  return forms;
}

/** Finds the top-level `{...}` arguments in a template. */
function scanArguments(template: string): Array<{ start: number; end: number; body: string }> {
  const found: Array<{ start: number; end: number; body: string }> = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < template.length; i++) {
    const char = template[i];
    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        found.push({ start, end: i, body: template.slice(start + 1, i) });
        start = -1;
      }
      if (depth < 0) depth = 0; // stray brace: leave it be
    }
  }
  return found;
}

export function renderMessage(
  template: string,
  values: MessageValues,
  locale: Locale,
): RenderResult {
  const missingValues: string[] = [];
  let inexactPlural = false;

  /**
   * Literal text between arguments.
   *
   * `#` inside a plural form is a bare character in ICU, not a `{}` argument —
   * the scanner never sees it, so it is substituted here. `'#'` escapes it, for
   * the rare string that wants a literal hash next to a count.
   */
  const literal = (text: string, offsetCount?: number): string => {
    if (offsetCount === undefined) return text.replace(/'#'/g, "#");
    return text
      .split("'#'")
      .map((chunk) => chunk.replace(/#/g, formatNumber(offsetCount, locale)))
      .join("#");
  };

  const render = (source: string, offsetCount?: number): string => {
    const args = scanArguments(source);
    if (args.length === 0) return literal(source, offsetCount);

    let out = "";
    let cursor = 0;

    for (const arg of args) {
      out += literal(source.slice(cursor, arg.start), offsetCount);
      cursor = arg.end + 1;

      const parts = splitArg(arg.body);
      const name = parts[0];
      const kind = parts[1];

      // Bare `{name}` — a simple placeholder.
      if (parts.length === 1) {
        if (name === "#" && offsetCount !== undefined) {
          out += formatNumber(offsetCount, locale);
          continue;
        }
        const value = values[name];
        if (value === undefined || value === null) {
          missingValues.push(name);
          out += `{${name}}`;
          continue;
        }
        out += typeof value === "number" ? formatNumber(value, locale) : String(value);
        continue;
      }

      if (kind === "plural" || kind === "selectordinal") {
        const raw = values[name];
        const count = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(count)) {
          missingValues.push(name);
          out += `{${name}}`;
          continue;
        }

        const forms = parseForms(parts[2] ?? "");
        // An explicit `=N` form wins outright, as in ICU: "no stations" reads
        // better than "0 stations" and does not depend on the plural table.
        const exactKey = `=${count}`;
        if (forms[exactKey] !== undefined) {
          out += render(forms[exactKey], count);
          continue;
        }

        const category: PluralCategory = selectPlural(locale, count);
        const resolved = resolveForm(forms, category);
        if (!resolved.exact) inexactPlural = true;
        out += render(resolved.form, count);
        continue;
      }

      if (kind === "select") {
        const forms = parseForms(parts[2] ?? "");
        const raw = values[name];
        const key = raw === undefined || raw === null ? undefined : String(raw);
        if (key === undefined) missingValues.push(name);
        const chosen = (key !== undefined ? forms[key] : undefined) ?? forms.other ?? "";
        out += render(chosen, offsetCount);
        continue;
      }

      // Something this subset does not handle. Left verbatim rather than
      // guessed at — a wrong guess is worse than a visible placeholder.
      out += source.slice(arg.start, arg.end + 1);
    }

    return out + literal(source.slice(cursor), offsetCount);
  };

  return { text: render(template), missingValues, inexactPlural };
}

/** Placeholder names a template refers to, for catalog validation. */
export function placeholdersIn(template: string): string[] {
  const names = new Set<string>();

  const walk = (source: string) => {
    for (const arg of scanArguments(source)) {
      const parts = splitArg(arg.body);
      if (parts[0] !== "#") names.add(parts[0]);
      if (parts.length > 2) {
        for (const form of Object.values(parseForms(parts[2]))) walk(form);
      }
    }
  };

  walk(template);
  return [...names];
}

/** Plural/select categories a template supplies, keyed by argument name. */
export function formsIn(template: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const arg of scanArguments(template)) {
    const parts = splitArg(arg.body);
    if (parts.length > 2 && (parts[1] === "plural" || parts[1] === "selectordinal")) {
      result[parts[0]] = Object.keys(parseForms(parts[2]));
    }
  }
  return result;
}
