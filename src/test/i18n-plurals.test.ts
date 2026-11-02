import { describe, expect, it } from "vitest";
import {
  missingCategories,
  pluralCategories,
  resolveForm,
  selectOrdinal,
  selectPlural,
} from "@/lib/i18n/plurals";
import { renderMessage } from "@/lib/i18n/message";

/**
 * The bug this file exists to make impossible:
 *
 *   "{count, plural, one {# станция} other {# станций}}"
 *
 * Written by someone whose language has two plural forms, reviewed by someone
 * whose language has two plural forms, and wrong for every Russian speaker who
 * sees "2 станций" or "5 станция". English tests pass. Russian users see
 * broken grammar on every screen with a count on it.
 *
 * The cases below are the ones that separate a correct implementation from one
 * that looks correct: 11 is not 1, 21 is, 12 is not 2, 22 is, and 1.0 is none
 * of them.
 */
describe("plural categories per language", () => {
  it("knows Russian and Ukrainian need four forms", () => {
    expect(pluralCategories("ru")).toEqual(["one", "few", "many", "other"]);
    expect(pluralCategories("uk")).toEqual(["one", "few", "many", "other"]);
  });

  it("knows Chinese needs one", () => {
    expect(pluralCategories("zh-Hans")).toEqual(["other"]);
  });

  it("knows English needs two", () => {
    expect(pluralCategories("en")).toEqual(["one", "other"]);
  });
});

describe("selectPlural", () => {
  it("follows the Russian table, including the teens that break naive rules", () => {
    const cases: Array<[number, string]> = [
      [1, "one"],
      [2, "few"],
      [4, "few"],
      [5, "many"],
      [11, "many"], // NOT one, though it ends in 1
      [12, "many"], // NOT few, though it ends in 2
      [14, "many"],
      [21, "one"], // ends in 1 and is not a teen
      [22, "few"],
      [25, "many"],
      [101, "one"],
      [111, "many"],
      [0, "many"],
    ];
    for (const [count, expected] of cases) {
      expect(selectPlural("ru", count), `ru ${count}`).toBe(expected);
    }
  });

  it("follows the Ukrainian table the same way", () => {
    expect(selectPlural("uk", 1)).toBe("one");
    expect(selectPlural("uk", 3)).toBe("few");
    expect(selectPlural("uk", 11)).toBe("many");
    expect(selectPlural("uk", 22)).toBe("few");
  });

  it("treats a decimal as other in Russian, which the integer alone cannot tell you", () => {
    // 1 is `one`, but 1,0 is `other` — the difference is the digits shown, so a
    // selector taking only the number gets the decimal case wrong every time.
    expect(selectPlural("ru", 1, 0)).toBe("one");
    expect(selectPlural("ru", 1, 1)).toBe("other");
    expect(selectPlural("ru", 1.5)).toBe("other");
  });

  it("puts zero in one for French, and other for English", () => {
    // The trap that catches every developer testing with English intuition.
    expect(selectPlural("fr", 0)).toBe("one");
    expect(selectPlural("en", 0)).toBe("other");
  });

  it("returns other for a count that is not a number", () => {
    expect(selectPlural("ru", Number.NaN)).toBe("other");
    expect(selectPlural("ru", Number.POSITIVE_INFINITY)).toBe("other");
  });

  it("uses a different table for ordinals", () => {
    // English ordinals need four: 1st, 2nd, 3rd, 4th.
    expect(selectOrdinal("en", 1)).toBe("one");
    expect(selectOrdinal("en", 2)).toBe("two");
    expect(selectOrdinal("en", 3)).toBe("few");
    expect(selectOrdinal("en", 4)).toBe("other");
  });
});

describe("missingCategories", () => {
  it("catches the exact defect: a Russian message written with English's two forms", () => {
    expect(missingCategories("ru", ["one", "other"])).toEqual(["few", "many"]);
  });

  it("passes a complete Russian message", () => {
    expect(missingCategories("ru", ["one", "few", "many", "other"])).toEqual([]);
  });

  it("requires other even where the language has only that one", () => {
    expect(missingCategories("zh-Hans", [])).toEqual(["other"]);
    expect(missingCategories("zh-Hans", ["other"])).toEqual([]);
  });
});

describe("resolveForm", () => {
  it("takes the exact form when it is there", () => {
    expect(resolveForm({ one: "a", other: "b" }, "one")).toEqual({ form: "a", exact: true });
  });

  it("degrades rather than rendering an empty sentence", () => {
    // A missing category is a bug the audit catches before shipping. If one
    // reaches a person anyway, wrong grammar beats a blank where text should be.
    const resolved = resolveForm({ one: "a", other: "b" }, "many");
    expect(resolved.exact).toBe(false);
    expect(resolved.form).toBe("b");
  });

  it("reports empty only when there is genuinely nothing", () => {
    expect(resolveForm({}, "one")).toEqual({ form: "", exact: false });
  });
});

describe("rendering a real Russian plural", () => {
  const message =
    "{count, plural, =0 {нет записей} one {# запись} few {# записи} many {# записей} other {# записи}}";

  it("picks the right form across the whole awkward range", () => {
    const render = (count: number) => renderMessage(message, { count }, "ru").text;

    expect(render(0)).toBe("нет записей");
    expect(render(1)).toBe("1 запись");
    expect(render(2)).toBe("2 записи");
    expect(render(5)).toBe("5 записей");
    expect(render(11)).toBe("11 записей");
    expect(render(21)).toBe("21 запись");
    expect(render(22)).toBe("22 записи");
    expect(render(25)).toBe("25 записей");
  });

  it("flags a message that had to degrade", () => {
    const incomplete = "{count, plural, one {# запись} other {# записи}}";
    const complete = renderMessage(message, { count: 5 }, "ru");
    const degraded = renderMessage(incomplete, { count: 5 }, "ru");

    expect(complete.inexactPlural).toBe(false);
    expect(degraded.inexactPlural).toBe(true);
    // And the degraded one is visibly wrong Russian, which is the point.
    expect(degraded.text).toBe("5 записи");
  });
});
