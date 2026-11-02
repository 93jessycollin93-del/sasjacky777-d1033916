import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/game/i18n";
import { i18n } from "@/lib/i18n/service";
import { en } from "@/game/translations/en";
import { ru } from "@/game/translations/ru";
import { uk } from "@/game/translations/uk";
import { zh } from "@/game/translations/zh";
import { fromEruLang, toEruLang, ERU_LANGS } from "@/lib/i18n/eruBridge";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * The bug this covers shipped, and was invisible in the repo.
 *
 * `src/game/i18n.tsx` did `const translations = en` and exposed a `setLocale`
 * that was a documented no-op. Beside it sat ru.ts, uk.ts and zh.ts — written,
 * complete, and unreachable. `LanguageSwitcher` was `return null`. So the app
 * had four language files, a language switcher, and no way to change language,
 * and nothing about that was visible without reading three files together.
 *
 * These tests fail against that version and pass against this one. The first
 * one is the whole point: change the locale, and Russian text comes out.
 */
function Probe() {
  const { t, locale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t("ui.title")}</span>
    </div>
  );
}

describe("the game's translations are reachable", () => {
  it("renders Russian when the locale is Russian", () => {
    i18n.setLocale("ru");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale").textContent).toBe("ru");
    const title = screen.getByTestId("title").textContent ?? "";
    expect(title).toBe(ru["ui.title"]);
    expect(title).not.toBe(en["ui.title"]);
    // Cyrillic actually came out — not the English string under a Russian tag.
    expect(title).toMatch(/[А-Яа-я]/);
  });

  it("renders Ukrainian and Chinese from their own catalogs", () => {
    i18n.setLocale("uk");
    const first = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("title").textContent).toBe(uk["ui.title"]);
    first.unmount();

    i18n.setLocale("zh-Hans");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // The service says zh-Hans; the game's catalog is keyed zh. The mapping is
    // the thing under test.
    expect(screen.getByTestId("title").textContent).toBe(zh["ui.title"]);
  });

  it("falls back to English for a locale the game has no catalog for", () => {
    // Spanish and French exist in the app but not in the game's four files.
    // A player must see English, never a raw key mid-sentence.
    i18n.setLocale("es");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("title").textContent).toBe(en["ui.title"]);
  });

  it("interpolates positionally, the way its existing callers expect", () => {
    i18n.setLocale("en");
    function Interp() {
      const { t } = useI18n();
      return <span data-testid="out">{t("{0} of {1}", 3, 7)}</span>;
    }
    render(
      <I18nProvider>
        <Interp />
      </I18nProvider>,
    );
    expect(screen.getByTestId("out").textContent).toBe("3 of 7");
  });
});

describe("the Eru bridge", () => {
  it("maps the tag both systems spell differently", () => {
    expect(toEruLang("zh-Hans")).toBe("zh");
    expect(fromEruLang("zh")).toBe("zh-Hans");
  });

  it("round-trips every locale Eru covers", () => {
    for (const lang of ERU_LANGS) {
      expect(toEruLang(fromEruLang(lang))).toBe(lang);
    }
  });

  it("sends a locale Eru has no catalog for to English rather than to a key", () => {
    expect(toEruLang("es")).toBe("en");
    expect(toEruLang("fr")).toBe("en");
  });

  it("accepts every locale the app ships without throwing", () => {
    for (const locale of LOCALES) {
      expect(ERU_LANGS).toContain(toEruLang(locale));
    }
  });

  it("treats an unknown stored tag as English", () => {
    expect(fromEruLang("klingon")).toBe("en");
  });
});

describe("one locale, not three", () => {
  it("has the service drive the game provider rather than holding its own", () => {
    i18n.setLocale("fr");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("fr");

    // And it follows a change made anywhere else in the app — the service is
    // the writer, the provider is a subscriber.
    act(() => i18n.setLocale("uk"));
    expect(screen.getByTestId("locale").textContent).toBe("uk");
  });
});
