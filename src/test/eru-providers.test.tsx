import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EruProviders } from "@/eru/EruRouter";
import { useLanguage } from "@/eru/context/LanguageContext";
import { useMediaPlayer } from "@/eru/context/MediaPlayerContext";
import { useTheme as useEruTheme } from "@/eru/context/ThemeContext";
import { useDashboardEvents } from "@/eru/context/DashboardEventsContext";
import { base44 } from "@/eru/api/base44Client";

/**
 * Eru's pages were imported with only their AuthProvider. Everything else their
 * hooks need — language, theme, playback, the dashboard event bus — stayed
 * behind in Eru's own App.jsx, and each of those hooks throws when its provider
 * is missing. The result was fourteen pages (dashboard, markets, trade,
 * portfolio, messages, settings, user-settings, language-diagnostics, visual,
 * preferences, music, listening, the playlist and collab routes) rendering an
 * error card instead of a page: "useLanguage must be used inside
 * LanguageProvider", "useMediaPlayer must be used within a MediaPlayerProvider",
 * "Cannot destructure property 'customThemes' of null".
 *
 * Mounting a consumer of all four inside the router's own provider stack fails
 * against that version and passes against this one.
 */
function Consumer() {
  const { t, lang } = useLanguage();
  const player = useMediaPlayer();
  const theme = useEruTheme();
  const events = useDashboardEvents();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="translated">{typeof t === "function" ? "t-ok" : "t-missing"}</span>
      <span data-testid="player">{player && typeof player.playTrack === "function" ? "player-ok" : "player-missing"}</span>
      <span data-testid="theme">{theme && Array.isArray(theme.customThemes) ? "theme-ok" : "theme-missing"}</span>
      <span data-testid="events">{events && typeof events.subscribe === "function" ? "events-ok" : "events-missing"}</span>
    </div>
  );
}

describe("the Eru provider stack", () => {
  it("satisfies every context an imported Eru page reads", async () => {
    render(
      <MemoryRouter>
        <EruProviders>
          <Consumer />
        </EruProviders>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("translated").textContent).toBe("t-ok");
    expect(screen.getByTestId("player").textContent).toBe("player-ok");
    expect(screen.getByTestId("theme").textContent).toBe("theme-ok");
    expect(screen.getByTestId("events").textContent).toBe("events-ok");
    await waitFor(() => expect(screen.getByTestId("lang").textContent).toBeTruthy());
  });

  it("leaves the host app's root styling exactly as it found it", async () => {
    const root = document.documentElement;
    root.setAttribute("style", "--primary: 160 84% 39%");
    const before = root.getAttribute("style");

    const view = render(
      <MemoryRouter>
        <EruProviders>
          <Consumer />
        </EruProviders>
      </MemoryRouter>,
    );

    // Eru's theme engine writes its own palette onto :root while it is mounted.
    await waitFor(() => expect(root.style.getPropertyValue("--primary").trim()).not.toBe("160 84% 39%"));

    view.unmount();

    // …and Jackie owns the theme again the moment the Eru subtree goes away.
    // Without the restore, one visit to any /eru page repainted the whole app.
    expect(root.getAttribute("style")).toBe(before);
    root.removeAttribute("style");
  });
});

describe("the offline Base44 shim", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("answers bulkCreate with the rows callers immediately search", async () => {
    // `createdSquads.find(...)` on an undefined result is what blanked the Bot
    // Farm page with "Cannot read properties of undefined (reading 'find')".
    const rows = await base44.entities.BotFarmSquad.bulkCreate([{ role_type: "leader" }]);
    expect(Array.isArray(rows)).toBe(true);
    expect(() => rows.find((r: { role_type?: string }) => r.role_type === "leader")).not.toThrow();
  });

  it("echoes the record handed to create, so callers can read it back", async () => {
    // Card Arena died on `created.ai_campaign_level_unlocked` when this was null.
    const created = await base44.entities.CardPlayerProfile.create({
      user_email: "someone@example.com",
      ai_campaign_level_unlocked: 4,
    });
    expect(created).toBeTruthy();
    expect(created.id).toMatch(/^offline-/);
    expect(created.user_email).toBe("someone@example.com");
    expect(created.ai_campaign_level_unlocked).toBe(4);
  });

  it("keeps update's id and merges the patch", async () => {
    const updated = await base44.entities.CardPlayerProfile.update("profile-1", { display_name: "Jackie" });
    expect(updated.id).toBe("profile-1");
    expect(updated.display_name).toBe("Jackie");
  });

  it("still invents nothing on the read paths", async () => {
    await expect(base44.entities.Note.list()).resolves.toEqual([]);
    await expect(base44.entities.Note.filter({})).resolves.toEqual([]);
    await expect(base44.entities.Note.get("missing")).resolves.toBeNull();
  });
});
