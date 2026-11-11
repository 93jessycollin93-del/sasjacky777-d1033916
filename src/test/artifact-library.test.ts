// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  MAX_STORED_CHARS,
  STORAGE_MESSAGE,
  downloadName,
  filterClusters,
  loadArtifact,
  loadCatalog,
  readFrameMessage,
  withStorageShim,
  type ArtifactCatalog,
  type ArtifactItem,
} from "@/lib/artifactLibrary";

/**
 * The library page's runtime (docs/ARTIFACTS.md). Runs in Node rather than
 * jsdom: it needs the platform's real DecompressionStream and WebCrypto, which
 * is what a browser uses too.
 */

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const respond = (body: BodyInit | null, status = 200) => async () => new Response(body, { status });

describe("opening a stored artifact", () => {
  const html = "<!doctype html><title>Seed Vault</title><h1>Seed Vault</h1>";

  it("unpacks the stored file and opens it when its fingerprint matches", async () => {
    const got = await loadArtifact({ file: "files/x.bin", sha256: sha(html) }, respond(gzipSync(html)));
    expect(got).toEqual({ ok: true, value: html });
  });

  it("also opens a file the host already decompressed on the way out", async () => {
    const got = await loadArtifact({ file: "files/x.bin", sha256: sha(html) }, respond(html));
    expect(got).toEqual({ ok: true, value: html });
  });

  it("refuses to open a file that is not the one that was imported", async () => {
    const got = await loadArtifact({ file: "files/x.bin", sha256: sha("something else") }, respond(gzipSync(html)));
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error).toMatch(/does not match its fingerprint.*not opened/);
  });

  it("says what failed when the file is missing", async () => {
    const got = await loadArtifact({ file: "files/x.bin", sha256: sha(html) }, respond(null, 404));
    expect(got).toEqual({ ok: false, error: "The stored file answered 404." });
  });
});

describe("reading the catalog", () => {
  it("names a missing catalog as a failure instead of showing an empty library", async () => {
    const got = await loadCatalog(respond(null, 404));
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error).toMatch(/404/);
  });

  it("refuses a catalog in a format it does not know", async () => {
    const got = await loadCatalog(respond(JSON.stringify({ version: 2, items: [], clusters: [] })));
    expect(got.ok).toBe(false);
  });

  it("reads a catalog written before pages could be left out", async () => {
    const got = await loadCatalog(respond(JSON.stringify({ version: 1, items: [], clusters: [] })));
    expect(got.ok && got.value.skipped).toEqual([]);
  });
});

/** Runs the shim's script against a stand-in window, the way the frame would. */
function runShim(initial: Record<string, string>) {
  const page = withStorageShim("<html><head></head><body></body></html>", initial);
  const code = /<script>([\s\S]*?)<\/script>/.exec(page)![1];
  const win: Record<string, unknown> = {};
  const parent = { postMessage: vi.fn() };
  class Navigator {}
  Object.defineProperty(Navigator.prototype, "serviceWorker", {
    configurable: true,
    get() {
      throw new Error("SecurityError: service workers are disabled in a sandbox");
    },
  });
  new Function("window", "parent", "Navigator", code)(win, parent, Navigator);
  return { win: win as { localStorage: Storage & Record<string, string>; sessionStorage: Storage }, parent, navigator: new Navigator() };
}

describe("localStorage inside the sandbox", () => {
  afterEach(() => vi.useRealTimers());

  it("starts with what the artifact saved last time", () => {
    const { win } = runShim({ score: "42" });
    expect(win.localStorage.getItem("score")).toBe("42");
    expect(win.localStorage.length).toBe(1);
    expect(win.localStorage.key(0)).toBe("score");
  });

  it("supports plain property access, which artifacts use as often as getItem", () => {
    const { win } = runShim({});
    win.localStorage.theme = "dark";
    expect(win.localStorage.getItem("theme")).toBe("dark");
    expect(win.localStorage["theme"]).toBe("dark");
    expect(Object.keys(win.localStorage)).toEqual(["theme"]);
    delete win.localStorage.theme;
    expect(win.localStorage.getItem("theme")).toBeNull();
  });

  it("stores values as strings, as the real Storage does", () => {
    const { win } = runShim({});
    win.localStorage.setItem("n", 5 as unknown as string);
    expect(win.localStorage.getItem("n")).toBe("5");
  });

  it("hands every change to the page once writing settles, so the page can keep it", () => {
    vi.useFakeTimers();
    const { win, parent } = runShim({});
    win.localStorage.setItem("a", "1");
    win.localStorage.setItem("b", "2");
    expect(parent.postMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: STORAGE_MESSAGE, data: { a: "1", b: "2" } }, "*");
  });

  it("keeps sessionStorage to the tab, never sending it to the page", () => {
    vi.useFakeTimers();
    const { win, parent } = runShim({});
    win.sessionStorage.setItem("s", "1");
    vi.advanceTimersByTime(200);
    expect(win.sessionStorage.getItem("s")).toBe("1");
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("hides service workers, which the sandbox forbids, so an artifact's feature check skips them instead of crashing", () => {
    const { navigator } = runShim({});
    expect("serviceWorker" in navigator).toBe(false);
  });

  it("goes in before the artifact's own scripts and after the doctype", () => {
    const page = withStorageShim('<!DOCTYPE html><html><head><script src="app.js"></script></head></html>', {});
    expect(page.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(page.indexOf(STORAGE_MESSAGE)).toBeLessThan(page.indexOf("app.js"));
    const bare = withStorageShim("<!doctype html><div>x</div>", {});
    expect(bare.startsWith("<!doctype html><script>")).toBe(true);
  });

  it("cannot be broken out of by saved data that contains a closing script tag", () => {
    const page = withStorageShim("<head></head>", { note: "</script><script>alert(1)</script>" });
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    const { win } = runShim({ note: "</script><b>" });
    expect(win.localStorage.getItem("note")).toBe("</script><b>");
  });
});

describe("messages from an artifact's frame", () => {
  const frame = {} as Window;

  it("ignores messages from anything but the frame this page opened", () => {
    expect(readFrameMessage({ source: {} as Window, data: { type: "ecto:artifact-close-request" } }, frame)).toBeNull();
    expect(readFrameMessage({ source: frame, data: { type: "ecto:artifact-close-request" } }, null)).toBeNull();
  });

  it("accepts saved data only as a map of strings, and only up to the size limit", () => {
    expect(readFrameMessage({ source: frame, data: { type: STORAGE_MESSAGE, data: { a: "1" } } }, frame)).toEqual({ type: "storage", data: { a: "1" } });
    expect(readFrameMessage({ source: frame, data: { type: STORAGE_MESSAGE, data: { a: 1 } } }, frame)).toBeNull();
    expect(readFrameMessage({ source: frame, data: { type: STORAGE_MESSAGE, data: ["a"] } }, frame)).toBeNull();
    const big = { a: "x".repeat(MAX_STORED_CHARS + 1) };
    expect(readFrameMessage({ source: frame, data: { type: STORAGE_MESSAGE, data: big } }, frame)).toBeNull();
  });

  it("passes on web links the exporter's wrapper intercepted, and nothing else", () => {
    expect(readFrameMessage({ source: frame, data: { type: "ecto:usercontent-link-click", href: "https://example.com/a" } }, frame)).toEqual({
      type: "link",
      href: "https://example.com/a",
    });
    expect(readFrameMessage({ source: frame, data: { type: "ecto:usercontent-link-click", href: "javascript:alert(1)" } }, frame)).toBeNull();
    expect(readFrameMessage({ source: frame, data: { type: "ecto:usercontent-link-click", href: "not a url" } }, frame)).toBeNull();
  });

  it("treats the wrapper's Escape request as closing the viewer", () => {
    expect(readFrameMessage({ source: frame, data: { type: "ecto:artifact-close-request" } }, frame)).toEqual({ type: "close" });
  });
});

const item = (over: Partial<ArtifactItem>): ArtifactItem => ({
  id: "0".repeat(16),
  sha256: "0".repeat(64),
  kind: "artifact",
  language: null,
  title: "Seed Vault",
  heading: null,
  names: ["React Artifact.html"],
  source: "drive",
  modified: null,
  bytes: 1,
  storedBytes: 1,
  file: "files/0.bin",
  thumb: null,
  cluster: "seed vault",
  features: { localStorage: false, indexedDB: false, network: false, scriptHosts: [], hosts: [] },
  render: null,
  ...over,
});

describe("finding an artifact", () => {
  const a = item({ id: "a".repeat(16), title: "Seed Vault", features: { localStorage: true, indexedDB: false, network: false, scriptHosts: [], hosts: [] } });
  const b = item({ id: "b".repeat(16), title: "Jacky v3", cluster: "jacky", names: ["jacky_os.html"], render: { errors: 1, firstError: "x", textChars: 10, blockedRequests: 0, chromium: "", offline: true } });
  const c = item({ id: "c".repeat(16), title: "Pocket AI Lab", cluster: "pocket", kind: "source", language: "shell" });
  const catalog = {
    version: 1,
    items: [a, b, c],
    clusters: [
      { key: "seed vault", title: "Seed Vault", ids: [a.id], modified: null },
      { key: "jacky", title: "Jacky v3", ids: [b.id], modified: null },
      { key: "pocket", title: "Pocket AI Lab", ids: [c.id], modified: null },
    ],
  } as ArtifactCatalog;
  const none = { query: "", savesData: false, network: false, source: false, failed: false };
  const titles = (f: typeof none) => filterClusters(catalog, f).map((r) => r.cluster.title);

  it("searches titles and the names a file was saved under", () => {
    expect(titles({ ...none, query: "vault" })).toEqual(["Seed Vault"]);
    expect(titles({ ...none, query: "jacky_os" })).toEqual(["Jacky v3"]);
  });

  it("narrows to artifacts that save data, recovered source, or ones that failed when imported", () => {
    expect(titles({ ...none, savesData: true })).toEqual(["Seed Vault"]);
    expect(titles({ ...none, source: true })).toEqual(["Pocket AI Lab"]);
    expect(titles({ ...none, failed: true })).toEqual(["Jacky v3"]);
  });
});

describe("downloads", () => {
  it("names the file after the artifact, without characters a file system refuses", () => {
    expect(downloadName({ title: 'PAYLOAD: "byte/by/byte" <AUTH>', id: "abcdef0123456789" })).toBe("PAYLOAD byte by byte AUTH (abcdef).html");
  });
});
