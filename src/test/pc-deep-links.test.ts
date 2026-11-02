import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PC_APPS, PC_FOLDERS } from "@/data/pcApps";

/**
 * Every `/pc?app=<id>` in the left menu must name something the PC can open.
 *
 * A wrong id fails silently: the PC boots, finds no matching desktop item, and
 * drops you on the desktop with nothing running. Nothing throws, nothing logs,
 * so the menu carried two dead links — `unreal` (the PC calls it
 * `unreal_engine`) and `folder` (never an app) — under a comment asserting they
 * had all been verified.
 *
 * src/data/pcApps.ts is generated from the PC's own desktop items, so it is the
 * authority here. If the PC renames an app, regenerate it and this test names
 * whichever menu links the rename broke.
 */
const navSource = readFileSync(
  path.resolve(__dirname, "../components/SidebarNav.tsx"),
  "utf8",
);

const deepLinkIds = [...navSource.matchAll(/href:\s*"\/pc\?app=([^"]+)"/g)].map(
  (m) => m[1],
);

describe("PC deep links in the left menu", () => {
  const known = new Set([
    ...PC_APPS.map((a) => a.appId),
    ...PC_FOLDERS.map((f) => f.appId),
  ]);

  it("finds the menu's PC deep links", () => {
    expect(deepLinkIds.length).toBeGreaterThan(30);
  });

  it("points every one at an app the PC can actually open", () => {
    const dead = deepLinkIds.filter((id) => !known.has(id));
    expect(dead, `dead deep links: ${dead.join(", ")}`).toEqual([]);
  });

  it("keeps the generated roster non-empty and unique", () => {
    expect(PC_APPS.length).toBeGreaterThan(50);
    expect(new Set(PC_APPS.map((a) => a.appId)).size).toBe(PC_APPS.length);
  });
});
