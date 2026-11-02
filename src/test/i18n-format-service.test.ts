import { describe, expect, it, vi } from "vitest";
import {
  collator,
  formatBytes,
  formatCurrency,
  formatDate,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  sortByLocale,
} from "@/lib/i18n/format";
import { I18nService } from "@/lib/i18n/service";
import { LOCALE_SPECS, LOCALES } from "@/lib/i18n/locales";

/**
 * Formatting is where localization bugs hide in plain sight: nothing throws,
 * the number is simply written the way another country writes it. A French
 * reader seeing "1,234.5" reads it as one-point-two-three-four, and a decimal
 * point in the wrong place on a price is a financial error, not a cosmetic one.
 */
describe("numbers", () => {
  it("uses each language's own separators", () => {
    // Non-breaking and narrow-nbsp vary by ICU build, so compare the shape.
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatNumber(1234.5, "fr").replace(/\s/g, " ")).toBe("1 234,5");
    expect(formatNumber(1234.5, "ru").replace(/\s/g, " ")).toBe("1 234,5");
    expect(formatNumber(1234.5, "es")).toBe("1234,5");
  });

  it("formats percentages in the locale's own convention", () => {
    expect(formatPercent(0.42, "en")).toBe("42%");
    expect(formatPercent(0.42, "fr").replace(/\s/g, " ")).toBe("42 %");
  });
});

describe("currency", () => {
  it("never infers the currency from the interface language", () => {
    // A French user paying in dollars must see dollars. Showing euros because
    // their interface is French is a financial error, not a preference.
    const usd = formatCurrency(1234.5, "fr", "USD");
    expect(usd).toContain("$");
    expect(usd).not.toContain("€");
  });

  it("uses the locale's default only when none is given", () => {
    expect(formatCurrency(10, "fr")).toContain("€");
    expect(formatCurrency(10, "en")).toContain("$");
    expect(formatCurrency(10, "uk")).toMatch(/₴|UAH/);
  });

  it("writes the same amount differently per locale, symbol placement included", () => {
    const en = formatCurrency(1234.5, "en", "USD");
    const fr = formatCurrency(1234.5, "fr", "USD");
    expect(en).not.toBe(fr);
    // English leads with the symbol; French trails it, and disambiguates a
    // non-local dollar as "$US" rather than a bare "$".
    expect(en.startsWith("$")).toBe(true);
    expect(fr.trim()).toMatch(/\d[\s\u00a0\u202f]*\$US$/);
  });
});

describe("bytes", () => {
  it("labels in the locale's digits and separators", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(1024, "en")).toBe("1.0 KB");
    expect(formatBytes(1024, "fr").replace(/\s/g, " ")).toBe("1,0 KB");
    expect(formatBytes(1024 * 1024 * 1024, "en")).toBe("1.0 GB");
  });

  it("never reports a negative size", () => {
    expect(formatBytes(-5, "en")).toBe("0 B");
  });
});

describe("relative time", () => {
  it("uses the language's own words and its own plural rules", () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    expect(formatRelativeTime(twoHoursAgo, "en", now)).toMatch(/2 hours ago/);
    expect(formatRelativeTime(twoHoursAgo, "fr", now)).toMatch(/il y a 2 heures/);
    // Russian: 2 hours is the `few` form — "часа", not "часов".
    expect(formatRelativeTime(twoHoursAgo, "ru", now)).toMatch(/2 часа назад/);
    expect(formatRelativeTime(now - 5 * 60 * 60 * 1000, "ru", now)).toMatch(/5 часов назад/);
  });

  it("says yesterday rather than 1 day ago where the language prefers it", () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    expect(formatRelativeTime(now - 24 * 60 * 60 * 1000, "en", now)).toBe("yesterday");
  });
});

describe("sorting", () => {
  it("orders text the way a reader of that language expects", () => {
    // Code-unit sort puts every accented word after every unaccented one.
    const words = ["Zeus", "Ärger", "apple"];
    // Code units: 'Z'(90) < 'a'(97) < 'Ä'(196), so the accented word lands
    // last — after a lowercase word it should sort before.
    expect([...words].sort()).toEqual(["Zeus", "apple", "Ärger"]);
    expect(sortByLocale(words, "fr", (w) => w)).toEqual(["apple", "Ärger", "Zeus"]);
  });

  it("orders Cyrillic correctly rather than by code point", () => {
    const sorted = sortByLocale(["Ядро", "Апарат", "Запуск"], "uk", (w) => w);
    expect(sorted).toEqual(["Апарат", "Запуск", "Ядро"]);
  });

  it("compares case- and accent-insensitively by default", () => {
    expect(collator("fr").compare("ecole", "École")).toBe(0);
  });
});

describe("lists", () => {
  it("uses the language's own conjunction", () => {
    expect(formatList(["a", "b", "c"], "en")).toBe("a, b, and c");
    expect(formatList(["a", "b", "c"], "fr")).toBe("a, b et c");
    expect(formatList(["a", "b", "c"], "es")).toBe("a, b y c");
  });
});

describe("dates", () => {
  it("orders the parts the way each language writes them", () => {
    const date = Date.UTC(2026, 2, 9, 12, 0, 0);
    expect(formatDate(date, "en", { dateStyle: "short", timeZone: "UTC" })).toMatch(/3\/9\/26/);
    expect(formatDate(date, "fr", { dateStyle: "short", timeZone: "UTC" })).toMatch(/09\/03\/2026/);
  });
});

describe("I18nService", () => {
  const memoryStorage = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      _map: map,
    };
  };

  it("takes the stored choice over the browser's languages", () => {
    // Someone who picked Ukrainian on a device set to Russian picked it for a
    // reason. Re-deciding from navigator on every load overrules them silently.
    const storage = memoryStorage();
    storage.setItem("jackie.locale.v1", "uk");

    expect(new I18nService(storage, ["ru-RU", "ru"]).getLocale()).toBe("uk");
  });

  it("negotiates from the browser when nothing is stored", () => {
    expect(new I18nService(memoryStorage(), ["fr-CA", "en"]).getLocale()).toBe("fr");
  });

  it("ignores a stored value that is not a locale we ship", () => {
    const storage = memoryStorage();
    storage.setItem("jackie.locale.v1", "klingon");
    expect(new I18nService(storage, ["es"]).getLocale()).toBe("es");
  });

  it("translates in the current locale and follows a change", () => {
    const service = new I18nService(memoryStorage(), ["en"]);
    expect(service.t("common.close")).toBe("Close");

    service.setLocale("fr");
    expect(service.t("common.close")).toBe("Fermer");

    service.setLocale("zh-Hans");
    expect(service.t("common.close")).toBe("关闭");
  });

  it("selects the right plural form through the service", () => {
    const service = new I18nService(memoryStorage(), ["ru"]);
    expect(service.t("partitions.records", { count: 1 })).toBe("1 запись");
    expect(service.t("partitions.records", { count: 3 })).toBe("3 записи");
    expect(service.t("partitions.records", { count: 7 })).toBe("7 записей");
  });

  it("notifies subscribers on change and not on a no-op change", () => {
    const service = new I18nService(memoryStorage(), ["en"]);
    const seen = vi.fn();
    const unsubscribe = service.subscribe(seen);

    service.setLocale("es");
    expect(seen).toHaveBeenCalledTimes(1);

    service.setLocale("es");
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    service.setLocale("fr");
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("swaps the snapshot identity only when the locale actually changed", () => {
    const service = new I18nService(memoryStorage(), ["en"]);
    const before = service.getSnapshot();
    service.setLocale("en");
    expect(service.getSnapshot()).toBe(before);

    service.setLocale("ru");
    expect(service.getSnapshot()).not.toBe(before);
  });

  it("keeps working when storage refuses writes", () => {
    // A private window throws on setItem. The language change must still apply
    // to this session rather than throwing out of the switch.
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const service = new I18nService(hostile, ["en"]);

    expect(() => service.setLocale("uk")).not.toThrow();
    expect(service.getLocale()).toBe("uk");
  });

  it("records what fell back, so a gap is a list rather than something a user finds", () => {
    const service = new I18nService(memoryStorage(), ["ru"]);
    service.t("does.not.exist" as never);

    const missing = service.getMissing();
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ locale: "ru" });
  });

  it("runs with no storage at all", () => {
    const service = new I18nService(null, ["fr"]);
    expect(service.getLocale()).toBe("fr");
    expect(() => service.setLocale("es")).not.toThrow();
  });
});

describe("locale specs", () => {
  it("gives every locale an endonym, which is what a picker must show", () => {
    // A person looking for their language looks for its own name, not the
    // English one. A picker listing "Ukrainian" is useless to someone who
    // reads only Ukrainian.
    for (const locale of LOCALES) {
      const spec = LOCALE_SPECS[locale];
      expect(spec.endonym.length, locale).toBeGreaterThan(0);
      expect(spec.scripts.length, locale).toBeGreaterThan(0);
      expect(spec.expansion, locale).toBeGreaterThan(0);
    }
  });

  it("records that Chinese runs short and Slavic runs long", () => {
    expect(LOCALE_SPECS["zh-Hans"].expansion).toBeLessThan(1);
    expect(LOCALE_SPECS.ru.expansion).toBeGreaterThan(1);
  });
});
