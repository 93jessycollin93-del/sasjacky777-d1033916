import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  cacheHeaderFor,
  contentTypeFor,
  fallbackFor,
  parseArgs,
  parseRange,
  resolveRequestPath,
} from "../../host/serve.mjs";

/**
 * The host attachment is a folder someone drops next to a build and runs, so
 * its mistakes are the ones nobody is watching for. Three of them can be wrong
 * silently, and all three are covered here:
 *
 *  - Path traversal that falls back to the shell answers 200 to
 *    `/../../etc/passwd`, which reads as success.
 *  - A service worker cached for a year cannot be replaced, freezing the app at
 *    that build on every device that ever loaded it.
 *  - A missing Range means a resumed multi-gigabyte model download starts over.
 *
 * The pure decisions are imported from the same .mjs the server runs, so there
 * is no second copy of this logic to drift.
 */
const ROOT = "/srv/jackie";

describe("resolveRequestPath", () => {
  it("resolves an ordinary asset inside the root", () => {
    expect(resolveRequestPath(ROOT, "/assets/index-abc123.js")).toBe(
      resolve(ROOT, "assets/index-abc123.js"),
    );
  });

  it("ignores the query and hash", () => {
    expect(resolveRequestPath(ROOT, "/index.html?sandbox=true#top")).toBe(
      resolve(ROOT, "index.html"),
    );
  });

  it("refuses a literal traversal", () => {
    expect(resolveRequestPath(ROOT, "/../../etc/passwd")).toBeNull();
    expect(resolveRequestPath(ROOT, "/assets/../../../etc/passwd")).toBeNull();
  });

  it("refuses an encoded traversal, because decoding happens before the check", () => {
    expect(resolveRequestPath(ROOT, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveRequestPath(ROOT, "/assets/%2E%2E/%2E%2E/secrets")).toBeNull();
  });

  it("refuses a null byte and malformed encoding", () => {
    expect(resolveRequestPath(ROOT, "/index.html\0.png")).toBeNull();
    expect(resolveRequestPath(ROOT, "/%zz")).toBeNull();
  });

  it("does not let a prefix match escape the root", () => {
    // /srv/jackie-secrets starts with the root string but is not inside it.
    expect(resolveRequestPath(ROOT, "/../jackie-secrets/keys.json")).toBeNull();
  });

  it("allows the root itself", () => {
    expect(resolveRequestPath(ROOT, "/")).toBe(resolve(ROOT));
  });
});

describe("fallbackFor", () => {
  it("sends an app route to Jackie's shell", () => {
    expect(fallbackFor("/workstation")).toBe("/index.html");
    expect(fallbackFor("/eru/markets")).toBe("/index.html");
  });

  it("sends a PC route to the PC's own shell", () => {
    // The PC is a complete build with its own worker and routes. Handing it
    // Jackie's shell would stop it starting in its own tab offline.
    expect(fallbackFor("/pc-os/desktop")).toBe("/pc-os/index.html");
  });

  it("never falls back a missing asset", () => {
    expect(fallbackFor("/assets/gone-abc123.js")).toBeNull();
    expect(fallbackFor("/models/llama.gguf")).toBeNull();
  });

  it("never falls back an api or oauth path", () => {
    expect(fallbackFor("/api/status")).toBeNull();
    expect(fallbackFor("/functions/v1/jacky-proxy")).toBeNull();
    expect(fallbackFor("/~oauth/callback")).toBeNull();
  });
});

describe("cacheHeaderFor", () => {
  it("never caches a service worker", () => {
    expect(cacheHeaderFor("/sw.js")).toBe("no-store");
    expect(cacheHeaderFor("/pc-os/sw.js")).toBe("no-store");
  });

  it("revalidates html and the manifest", () => {
    expect(cacheHeaderFor("/index.html")).toBe("no-cache");
    expect(cacheHeaderFor("/manifest.webmanifest")).toBe("no-cache");
  });

  it("pins hashed assets, whose names change with their content", () => {
    expect(cacheHeaderFor("/assets/index-usaqlHYP.js")).toBe("public, max-age=31536000, immutable");
  });

  it("does not pin an unhashed asset", () => {
    expect(cacheHeaderFor("/placeholder.svg")).toBe("public, max-age=300");
  });
});

describe("parseRange", () => {
  it("parses a bounded range", () => {
    expect(parseRange("bytes=0-1023", 4096)).toEqual({ start: 0, end: 1023 });
  });

  it("parses an open-ended range, which is what a resumed download sends", () => {
    expect(parseRange("bytes=2048-", 4096)).toEqual({ start: 2048, end: 4095 });
  });

  it("parses a suffix range", () => {
    expect(parseRange("bytes=-512", 4096)).toEqual({ start: 3584, end: 4095 });
  });

  it("clamps an end past the file rather than reading off it", () => {
    expect(parseRange("bytes=0-999999", 4096)).toEqual({ start: 0, end: 4095 });
  });

  it("returns null for anything it does not understand", () => {
    for (const header of [undefined, "", "bytes=", "bytes=abc-def", "items=0-10", "bytes=-0"]) {
      expect(parseRange(header, 4096), String(header)).toBeNull();
    }
  });

  it("returns null for a start past the end of the file", () => {
    expect(parseRange("bytes=5000-6000", 4096)).toBeNull();
    expect(parseRange("bytes=100-50", 4096)).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("serves wasm and model weights with types a browser accepts", () => {
    expect(contentTypeFor("/ai.wasm")).toBe("application/wasm");
    expect(contentTypeFor("/models/llama.gguf")).toBe("application/octet-stream");
  });

  it("falls back to a binary type rather than guessing text", () => {
    expect(contentTypeFor("/unknown.zzz")).toBe("application/octet-stream");
  });
});

describe("parseArgs", () => {
  it("defaults to ./dist on loopback", () => {
    expect(parseArgs([])).toEqual({ root: "./dist", port: 8787, host: "127.0.0.1" });
  });

  it("takes a root, port and host", () => {
    expect(parseArgs(["./build", "--port", "4321", "--host", "0.0.0.0"])).toEqual({
      root: "./build",
      port: 4321,
      host: "0.0.0.0",
    });
  });

  it("keeps the default port when given a nonsense one", () => {
    expect(parseArgs(["./dist", "--port", "not-a-port"]).port).toBe(8787);
  });
});
