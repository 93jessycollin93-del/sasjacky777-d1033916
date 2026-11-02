import { describe, expect, it } from "vitest";
import {
  auditAll,
  auditCatalog,
  CATALOGS,
  lookup,
  MESSAGE_KEYS,
  orphanKeys,
  translate,
} from "@/lib/i18n/catalog";
import { fallbackChain, LOCALES, localeSpec, negotiateLocale } from "@/lib/i18n/locales";
import { placeholdersIn } from "@/lib/i18n/message";

/**
 * Nobody on the team reads all six languages, so correctness in five of them
 * cannot come from review — it has to come from checks a machine can run.
 * These are those checks, run against the real shipped catalogs. A translation
 * that would render "5 станция" or a literal `{count}` fails the build here.
 */
describe("every shipped catalog", () => {
  it("supplies every plural category its language requires", () => {
    const blocking = auditAll().flatMap((report) =>
      report.blocking
        .filter((issue) => issue.kind === "missing-plural-category")
        .map((issue) => `${issue.locale} ${issue.key}: ${issue.detail}`),
    );
    expect(blocking, blocking.join("\n")).toEqual([]);
  });

  it("keeps every placeholder the English source uses", () => {
    const mismatched = auditAll().flatMap((report) =>
      report.blocking
        .filter((issue) => issue.kind === "placeholder-mismatch")
        .map((issue) => `${issue.locale} ${issue.key}: ${issue.detail}`),
    );
    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });

  it("has no blocking issues at all", () => {
    for (const report of auditAll()) {
      expect(report.blocking.map((i) => `${i.key}: ${i.detail}`), report.locale).toEqual([]);
    }
  });

  it("covers every key in every priority language", () => {
    for (const report of auditAll()) {
      expect(report.coverage, `${report.locale} coverage`).toBe(1);
    }
  });

  it("carries no keys left behind by a rename", () => {
    for (const locale of LOCALES) {
      expect(orphanKeys(locale), locale).toEqual([]);
    }
  });

  it("actually translates — no locale is just English with a different name", () => {
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const untranslated = auditCatalog(locale).issues.filter((i) => i.kind === "untranslated");
      // A handful of identical strings would be fine; a catalog full of them
      // means someone copied the English file and shipped it.
      expect(untranslated.length, `${locale} has ${untranslated.length} English strings`).toBeLessThan(
        MESSAGE_KEYS.length * 0.1,
      );
    }
  });
});

describe("the audit itself catches what it claims to", () => {
  it("names a missing Russian plural category", () => {
    const broken = { ...CATALOGS.ru, "partitions.records": "{count, plural, one {# запись} other {# записи}}" };
    const original = CATALOGS.ru["partitions.records"];
    CATALOGS.ru["partitions.records"] = broken["partitions.records"];

    try {
      const report = auditCatalog("ru");
      const issue = report.blocking.find((i) => i.key === "partitions.records");
      expect(issue?.kind).toBe("missing-plural-category");
      expect(issue?.detail).toMatch(/few, many/);
    } finally {
      CATALOGS.ru["partitions.records"] = original;
    }
  });

  it("names a dropped placeholder, which would render a blank where a value belongs", () => {
    const original = CATALOGS.fr["crew.needs"];
    CATALOGS.fr["crew.needs"] = "nécessite des capacités";

    try {
      const issue = auditCatalog("fr").blocking.find((i) => i.key === "crew.needs");
      expect(issue?.kind).toBe("placeholder-mismatch");
      expect(issue?.detail).toMatch(/dropped capabilities/);
    } finally {
      CATALOGS.fr["crew.needs"] = original;
    }
  });

  it("names an invented placeholder, which would render a literal brace", () => {
    const original = CATALOGS.es["common.close"];
    CATALOGS.es["common.close"] = "Cerrar {thing}";

    try {
      const issue = auditCatalog("es").blocking.find((i) => i.key === "common.close");
      expect(issue?.detail).toMatch(/invented thing/);
    } finally {
      CATALOGS.es["common.close"] = original;
    }
  });
});

describe("fallback", () => {
  it("never sends Ukrainian to Russian", () => {
    // A technically convenient fallback that a large part of the audience
    // reads as a political one.
    expect(fallbackChain("uk")).toEqual(["uk", "en"]);
    expect(localeSpec("uk").fallbacks).not.toContain("ru");
  });

  it("always ends at English, so a lookup can never run off the chain", () => {
    for (const locale of LOCALES) {
      expect(fallbackChain(locale).at(-1)).toBe("en");
    }
  });

  it("renders a fallback string with the plural rules of the language it came from", () => {
    const original = CATALOGS.ru["partitions.records"];
    delete CATALOGS.ru["partitions.records"];

    try {
      // Falls back to English. English selects `other` for 5, and the English
      // form is what must render — using Russian's table on an English string
      // would ask for a `many` form that is not there.
      const result = translate("partitions.records", "ru", { count: 5 });
      expect(result.from).toBe("en");
      expect(result.fellBack).toBe(true);
      expect(result.text).toBe("5 records");
      expect(result.inexactPlural).toBe(false);
    } finally {
      CATALOGS.ru["partitions.records"] = original;
    }
  });

  it("returns the key itself when nothing anywhere has the string", () => {
    // Ugly on screen, and therefore noticed and fixed — unlike an empty
    // string, which looks like an intentionally blank label.
    const found = lookup("does.not.exist" as never, "fr");
    expect(found.template).toBe("does.not.exist");
    expect(found.fellBack).toBe(true);
  });
});

describe("negotiateLocale", () => {
  it("matches an exact tag", () => {
    expect(negotiateLocale(["fr"])).toBe("fr");
  });

  it("matches on the base language for a regional tag", () => {
    expect(negotiateLocale(["fr-CA"])).toBe("fr");
    expect(negotiateLocale(["es-MX", "en"])).toBe("es");
  });

  it("sends every Chinese variant to Simplified", () => {
    expect(negotiateLocale(["zh-CN"])).toBe("zh-Hans");
    expect(negotiateLocale(["zh-Hans-CN"])).toBe("zh-Hans");
    expect(negotiateLocale(["zh"])).toBe("zh-Hans");
  });

  it("takes the first language it supports, not the first it is offered", () => {
    expect(negotiateLocale(["ja", "de", "uk", "en"])).toBe("uk");
  });

  it("falls to English when it supports none of them", () => {
    expect(negotiateLocale(["ja", "ko"])).toBe("en");
    expect(negotiateLocale([])).toBe("en");
  });
});

describe("placeholdersIn", () => {
  it("finds names inside plural forms, not just at the top level", () => {
    expect(placeholdersIn("{live, plural, one {# of {total} answered} other {# of {total}}}").sort()).toEqual(
      ["live", "total"],
    );
  });

  it("does not treat the count marker as a placeholder", () => {
    expect(placeholdersIn("{count, plural, other {# items}}")).toEqual(["count"]);
  });
});
