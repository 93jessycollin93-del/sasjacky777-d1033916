import { describe, expect, it } from "vitest";
import { ROUTE_MANIFEST, resolveRoute } from "@/lib/routeManifest";
import { PC_APPS } from "@/data/pcApps";
import { CYBERNETIC_PAGE_IDS, DEFAULT_PINNED, NAV_PAGES, NAV_WIDGETS } from "@/lib/navBar/catalog";
import {
  DEFAULT_NAV_PREFS,
  clampPos,
  distributeRows,
  navPrefsKey,
  nextMode,
  nextRows,
  parseNavPrefs,
  readNavPrefs,
  togglePinned,
  toggleWidget,
  writeNavPrefs,
} from "@/lib/navBar/prefs";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("what the nav bar can hold", () => {
  it("points every page at a route the router actually serves, and never at a redirect", () => {
    for (const page of NAV_PAGES) {
      const route = resolveRoute(page.to.split("?")[0]);
      expect(route, `${page.id} → ${page.to}`).not.toBeNull();
      expect(route?.alias, `${page.id} → ${page.to} is only an alias`).toBeFalsy();
    }
  });

  it("gives every page its own id, so one pin can never mean two buttons", () => {
    const ids = NAV_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers every one of Cybernetic's forty-three pages alongside Jackie's own", () => {
    expect(CYBERNETIC_PAGE_IDS).toHaveLength(43);
    const ids = new Set(NAV_PAGES.map((p) => p.id));
    for (const id of CYBERNETIC_PAGE_IDS) expect(ids.has(id), id).toBe(true);
  });

  it("can pin every page the app has, including ones added after this list was written", () => {
    // Nobody has to remember to add a new page here: the manifest is the source.
    const reachable = new Set(NAV_PAGES.map((p) => p.to));
    const destinations = ROUTE_MANIFEST.filter((r) => !r.alias && !r.path.includes(":") && r.path !== "/auth");
    const missing = destinations.filter((r) => !reachable.has(r.path)).map((r) => r.path);
    expect(missing, `not pinnable: ${missing.join(", ")}`).toEqual([]);
  });

  it("can pin every app inside the PC, opening straight into it", () => {
    for (const app of PC_APPS) {
      expect(NAV_PAGES.some((p) => p.section === "pc" && p.to === `/pc?app=${encodeURIComponent(app.appId)}`), app.appId).toBe(true);
    }
  });

  it("starts a new bar with pages that exist", () => {
    const ids = new Set(NAV_PAGES.map((p) => p.id));
    for (const id of DEFAULT_PINNED) expect(ids.has(id), id).toBe(true);
  });
});

describe("one person's layout", () => {
  it("keeps each account's layout under its own key, and signed-out visitors under another", () => {
    expect(navPrefsKey("a")).not.toBe(navPrefsKey("b"));
    expect(navPrefsKey(null)).toBe("jackie.navbar.v1:signed-out");
  });

  it("reads back exactly what was written", () => {
    const storage = memoryStorage();
    const prefs = { ...DEFAULT_NAV_PREFS, pinned: ["home", "eru-markets"], rows: 3 as const, mode: "icons" as const, pos: { x: 40, y: 90 } };
    expect(writeNavPrefs(storage, "u1", prefs)).toBe(true);
    expect(readNavPrefs(storage, "u1")).toEqual(prefs);
    expect(readNavPrefs(storage, "u2")).toEqual(DEFAULT_NAV_PREFS);
  });

  it("drops a pinned page that has left the catalog instead of drawing a button to nowhere", () => {
    const prefs = parseNavPrefs(JSON.stringify({ pinned: ["home", "retired-page", "home"] }));
    expect(prefs.pinned).toEqual(["home"]);
  });

  it("falls back to the default bar, not a blank one, when the stored record is corrupt", () => {
    expect(parseNavPrefs("{not json")).toEqual(DEFAULT_NAV_PREFS);
    expect(parseNavPrefs(JSON.stringify({ rows: 9, mode: "sideways", pos: { x: "a", y: 2 } }))).toMatchObject({
      rows: 1,
      mode: "expanded",
      pos: null,
    });
  });

  it("says the layout was not saved when storage refuses, rather than pretending", () => {
    const refusing = { setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(writeNavPrefs(refusing, "u1", DEFAULT_NAV_PREFS)).toBe(false);
    expect(writeNavPrefs(null, "u1", DEFAULT_NAV_PREFS)).toBe(false);
  });

  it("keeps pins in the catalog's order, so a new pin lands where it belongs", () => {
    const prefs = togglePinned({ ...DEFAULT_NAV_PREFS, pinned: ["home", "vault"] }, "tasks");
    expect(prefs.pinned).toEqual(["home", "tasks", "vault"]);
    expect(togglePinned(prefs, "tasks").pinned).toEqual(["home", "vault"]);
  });

  it("switches a widget on and off without touching the others", () => {
    const off = toggleWidget(DEFAULT_NAV_PREFS, "guide");
    expect(off.widgets).toEqual({ ...DEFAULT_NAV_PREFS.widgets, guide: false });
    expect(NAV_WIDGETS.map((w) => w.id).sort()).toEqual(Object.keys(off.widgets).sort());
  });

  it("cycles expanded → icons → controls → expanded, and rows 1 → 4 → 1, as Cybernetic does", () => {
    expect([nextMode("expanded"), nextMode("icons"), nextMode("controls")]).toEqual(["icons", "controls", "expanded"]);
    expect([nextRows(1), nextRows(2), nextRows(3), nextRows(4)]).toEqual([2, 3, 4, 1]);
  });
});

describe("laying the buttons out", () => {
  it("never leaves an empty row, which the chunking it replaces did for five buttons on four rows", () => {
    expect(distributeRows([1, 2, 3, 4, 5], 4).map((r) => r.length)).toEqual([2, 1, 1, 1]);
    for (let n = 0; n <= 12; n++) {
      for (let rows = 1; rows <= 4; rows++) {
        const out = distributeRows(Array.from({ length: n }, (_, i) => i), rows);
        expect(out.flat()).toHaveLength(n);
        expect(out.every((row) => row.length > 0)).toBe(true);
      }
    }
  });

  it("keeps a dragged bar on screen after the window shrinks", () => {
    const viewport = { width: 400, height: 300 };
    expect(clampPos({ x: 900, y: -40 }, { width: 200, height: 50 }, viewport)).toEqual({ x: 192, y: 8 });
    expect(clampPos({ x: 50, y: 60 }, { width: 200, height: 50 }, viewport)).toEqual({ x: 50, y: 60 });
  });
});
