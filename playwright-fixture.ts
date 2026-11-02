/**
 * Shared Playwright fixture.
 *
 * Previously re-exported from `lovable-agent-playwright-config/fixture`, which
 * is not a dependency of this project — see the note in playwright.config.ts.
 * Re-exporting from `@playwright/test` keeps every existing
 * `import { test, expect } from "../playwright-fixture"` working, and gives
 * project-wide fixtures somewhere to live when they are needed.
 */
export { test, expect } from "@playwright/test";
