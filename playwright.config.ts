import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * This used to be `createLovableConfig()` from
 * `lovable-agent-playwright-config/config` — a package that is in neither
 * package.json nor the lockfile. In a clean checkout the config failed to
 * resolve, so `playwright test` could not start at all: not a failing suite, a
 * suite that never ran. `@playwright/test` itself was installed the whole time,
 * so the only thing missing was the wrapper.
 *
 * Plain defineConfig has no such dependency.
 *
 * `testDir` is deliberately outside `src/`, because vitest owns
 * `src/ **­/*.{test,spec}.{ts,tsx}` and a Playwright spec picked up by vitest
 * fails in a way that reads like a broken test rather than a misrouted one.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Playwright's pinned Chromium is not always the build a machine has. The
    // cloud dev containers ship theirs here; CI installs the pinned one and
    // never takes this branch. scripts/smoke-routes.mjs does the same.
    launchOptions: existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuse whatever is already serving locally; in CI always build and serve.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
