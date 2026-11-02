import React, { type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
  password: vi.fn(),
  guest: vi.fn(),
  errorToast: vi.fn(),
}));

// Keep the real router, route guard and auth form. Unrelated app surfaces do
// not need their providers, GPU or network to exercise a login transition.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { signInWithPassword: auth.password, signInAnonymously: auth.guest } },
}));
vi.mock("@/integrations/lovable/index", () => ({ lovable: { auth: {} } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: auth.errorToast } }));
vi.mock("@/hooks/useTheme", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/game/i18n", () => ({ I18nProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/providers/LocalAIProvider", () => ({ LocalAIProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
vi.mock("@/components/SandboxBanner", () => ({ SandboxBanner: () => null }));
vi.mock("@/components/RouteDebugOverlay", () => ({ default: () => null }));
vi.mock("@/components/nav/JackieNavBar", () => ({ JackieNavBar: () => null }));
vi.mock("@/components/GlobalStickyNotes", () => ({
  GlobalStickyNotes: () => null,
  StickyNotesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/routeManifest", () => ({ ERU_ALIASES: [] }));
vi.mock("@/pages/Index", () => ({ default: () => <div>Private chat</div> }));
vi.mock("@/pages/Welcome", () => ({ default: () => null }));
vi.mock("@/pages/Sandbox", () => ({ default: () => null }));
vi.mock("@/pages/OAuthConsent", () => ({ default: () => null }));
vi.mock("@/pages/NotFound", () => ({ default: () => null }));

beforeEach(() => {
  vi.resetModules(); // The one guest attempt is scoped to a page load.
  auth.user = null;
  auth.loading = false;
  auth.password.mockReset();
  auth.guest.mockReset();
  auth.errorToast.mockReset();
  window.history.replaceState({}, "", "/");
});
afterEach(cleanup);

async function open(path: string) {
  window.history.replaceState({}, "", path);
  const { default: App } = await import("@/App");
  return { App, view: render(<App />) };
}

function submitPassword() {
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "owner@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
}

describe("account login navigation", () => {
  it("leaves /auth for the chat after a successful password sign-in", async () => {
    auth.password.mockImplementation(async () => { auth.user = { id: "owner" }; return { error: null }; });
    await open("/auth");
    submitPassword();
    await screen.findByText("Private chat");
    expect(window.location.pathname).toBe("/");
    expect(auth.guest).not.toHaveBeenCalled();
  });

  it("shows a refused password login without navigating or starting a guest", async () => {
    auth.password.mockResolvedValue({ error: new Error("Invalid login credentials") });
    await open("/auth");
    submitPassword();
    await waitFor(() => expect(auth.errorToast).toHaveBeenCalledWith("Invalid login credentials"));
    expect(window.location.pathname).toBe("/auth");
    expect(auth.guest).not.toHaveBeenCalled();
  });

  it("leaves /auth after an explicit demo login", async () => {
    auth.guest.mockImplementation(async () => { auth.user = { id: "guest" }; return { error: null }; });
    await open("/auth");
    fireEvent.click(screen.getByRole("button", { name: /Demo — Press & Enter/ }));
    await screen.findByText("Private chat");
    expect(window.location.pathname).toBe("/");
    expect(auth.guest).toHaveBeenCalledTimes(1);
  });

  it.each(["//outside.example", "https://outside.example", "/\\outside.example"])(
    "returns home rather than following the external next target %s", async (next) => {
      auth.password.mockImplementation(async () => { auth.user = { id: "owner" }; return { error: null }; });
      await open(`/auth?next=${encodeURIComponent(next)}`);
      submitPassword();
      await screen.findByText("Private chat");
      expect(window.location.pathname).toBe("/");
    },
  );
});

describe("guest session navigation", () => {
  it("opens sign-in after a guest signs out instead of showing an endless spinner", async () => {
    auth.guest.mockImplementation(async () => { auth.user = { id: "guest" }; return { error: null }; });
    const { App, view } = await open("/");
    await screen.findByText("Private chat");
    auth.user = null;
    view.rerender(<App />);
    await screen.findByRole("button", { name: "Sign In" });
    expect(window.location.pathname).toBe("/auth");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/");
    expect(auth.guest).toHaveBeenCalledTimes(1);
  });

  it("shares a pending guest request across unmount and remount", async () => {
    let finish!: (value: { error: null }) => void;
    auth.guest.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { App, view } = await open("/");
    await waitFor(() => expect(auth.guest).toHaveBeenCalledTimes(1));
    view.unmount();
    render(<App />);
    await act(async () => { auth.user = { id: "guest" }; finish({ error: null }); });
    await screen.findByText("Private chat");
    expect(auth.guest).toHaveBeenCalledTimes(1);
  });

  it("shows a rejected guest request and offers sign-in", async () => {
    auth.guest.mockRejectedValue(new Error("Network unavailable"));
    await open("/");
    await screen.findByText("Could not open a guest session: Network unavailable");
    expect(screen.getByRole("link", { name: "Sign in instead" })).toHaveAttribute("href", "/auth");
  });

  it("does not let a stale guest error hide a later signed-in account", async () => {
    auth.guest.mockResolvedValue({ error: { message: "Anonymous sign-ins are disabled" } });
    const { App, view } = await open("/");
    await screen.findByText(/Could not open a guest session/);
    auth.user = { id: "owner" };
    view.rerender(<App />);
    await screen.findByText("Private chat");
    expect(screen.queryByText(/Could not open a guest session/)).not.toBeInTheDocument();
  });
});
