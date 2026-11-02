import { describe, expect, it } from "vitest";
import { CORE_ROUTES, ERU_ALIASES, ERU_MANIFEST, resolveRoute, suggestRoutes } from "@/lib/routeManifest";

/**
 * The manifest generates root-level aliases for every Eru module path, so a
 * link written without the /eru prefix cannot 404. That generation is also the
 * one thing that could silently steal a route from the app: an Eru module named
 * the same as a core page would produce an alias that redirects the core page
 * into Eru, and the core page would simply stop being reachable — no error, no
 * warning, just a different screen than the one the link promised.
 *
 * The generator already filters core paths out. This asserts the outcome, so a
 * change to that filter fails here rather than in someone's browser.
 */
describe("route manifest", () => {
  it("never generates an alias that shadows a core route", () => {
    const core = new Set(CORE_ROUTES.map((r) => r.path));
    const collisions = ERU_ALIASES.filter((alias) => core.has(alias.path)).map((a) => a.path);
    expect(collisions, `aliases shadowing core pages: ${collisions.join(", ")}`).toEqual([]);
  });

  it("resolves each core path to its own entry, not to an Eru module", () => {
    for (const route of CORE_ROUTES) {
      if (route.path.includes(":")) continue;
      expect(resolveRoute(route.path)?.group, route.path).toBe(route.group);
    }
  });

  it("declares every path exactly once across core and Eru", () => {
    const all = [...CORE_ROUTES, ...ERU_MANIFEST, ...ERU_ALIASES].map((r) => r.path);
    const seen = new Map<string, number>();
    for (const path of all) seen.set(path, (seen.get(path) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([p]) => p);
    expect(duplicated, `duplicated: ${duplicated.join(", ")}`).toEqual([]);
  });

  it("suggests something reachable for a near-miss rather than nothing", () => {
    const suggestions = suggestRoutes("/workstaton");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].path).toBe("/workstation");
  });

  it("offers the canonical path above an alias that only redirects to it", () => {
    // /work redirects to /workstation. Both land in the right place, but the
    // suggester ranked the alias first, which teaches the wrong URL.
    const suggestions = suggestRoutes("/workstaton", 5);
    const canonical = suggestions.findIndex((s) => s.path === "/workstation");
    const alias = suggestions.findIndex((s) => s.path === "/work");
    expect(canonical).toBeGreaterThanOrEqual(0);
    if (alias >= 0) expect(canonical).toBeLessThan(alias);
  });

  it("ignores a trailing slash when resolving", () => {
    expect(resolveRoute("/workstation/")?.path).toBe("/workstation");
  });
});
