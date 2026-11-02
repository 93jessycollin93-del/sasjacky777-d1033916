import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESTINATIONS } from "@/lib/pathRouter";

/**
 * Strongbox's behaviour is tested where it runs — a real browser, in
 * e2e/strongbox.spec.ts. These are the properties that can be read off the
 * files, checked here so they fail in seconds rather than after a build: the
 * page's whole promise is that nothing it holds leaves the device, and the
 * cheapest way to break that is one innocent-looking <script src> or fetch().
 */
const read = (file: string) => readFileSync(join(process.cwd(), "public", file), "utf8");
const page = read("strongbox.html");
const script = page.slice(page.indexOf("<script>") + "<script>".length, page.lastIndexOf("</script>"));

describe("Strongbox", () => {
  it("loads nothing from anywhere else", () => {
    expect(page).not.toMatch(/<script[^>]*\bsrc=/i);
    expect(page).not.toMatch(/<link\b(?![^>]*href="data:)/i);
    expect(page).not.toMatch(/@import|url\(\s*['"]?https?:/i);
  });

  it("has no code that could send what it holds anywhere", () => {
    expect(script).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\(/);
  });

  it("keeps its offline helper to the one page it serves", () => {
    const worker = read("strongbox-sw.js");
    expect(worker).toContain('new URL("strongbox.html", self.location)');
    expect(worker).toMatch(/url\.origin \+ url\.pathname !== PAGE\) return;/);
  });

  it("is a script a browser can parse", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("can be found by name from the path router", () => {
    expect(DESTINATIONS.find((d) => d.path === "/strongbox.html")?.label).toBe("Strongbox");
  });
});
