import { describe, expect, it } from "vitest";
import { ALLOWED_PATHS, checkJackyPath } from "../../supabase/functions/_shared/jackyPath";

/**
 * The vulnerability this closes was live in `supabase/functions/jacky-proxy`.
 *
 * It stripped leading slashes and interpolated the rest into
 * `${base}/api/${rawPath}`. `..` survives that, and `new URL()` collapses it —
 * so any authenticated caller could send `path: "../../admin"` and the proxy
 * would fetch `${base}/admin`, off the `/api` prefix, with the server's
 * `JACKY_API_TOKEN` attached. The upstream is the owner's own rig, holding GPU
 * control, model management and a secrets file. Everything it serves was
 * reachable.
 *
 * Imported from the same file the edge function imports, so there is no second
 * copy to drift.
 */
describe("checkJackyPath accepts exactly the client contract", () => {
  it("allows the five calls jackyClient actually makes", () => {
    for (const path of ["status", "assessment", "ask", "control", "squads/lead/ask"]) {
      expect(checkJackyPath(path), path).toMatchObject({ ok: true, path });
    }
  });

  it("still accepts a leading slash, as the original did", () => {
    expect(checkJackyPath("/status")).toMatchObject({ ok: true, path: "status" });
  });

  it("allows a squad name with the characters a squad id uses", () => {
    expect(checkJackyPath("squads/vault-guard_2/ask").ok).toBe(true);
  });
});

describe("checkJackyPath refuses everything else", () => {
  it("refuses the traversal that reached the rest of the rig", () => {
    for (const attack of [
      "../../admin",
      "../secrets/secrets.env",
      "status/../../../etc/passwd",
      "..",
      "../",
    ]) {
      const verdict = checkJackyPath(attack);
      expect(verdict.ok, attack).toBe(false);
      expect(verdict.path, attack).toBeUndefined();
    }
  });

  it("refuses an encoded traversal, judged on the decoded form", () => {
    // A blocklist checking the raw string for ".." misses these entirely.
    expect(checkJackyPath("%2e%2e/%2e%2e/admin").ok).toBe(false);
    expect(checkJackyPath("%2E%2E%2Fadmin").ok).toBe(false);
    expect(checkJackyPath("status%2f..%2fadmin").ok).toBe(false);
  });

  it("refuses a path that is merely encoded, even when it would decode to something allowed", () => {
    // "%73tatus" decodes to "status". Accepting it would mean the matcher and
    // the fetch disagree about what the path is, which is where the next bug
    // comes from.
    expect(checkJackyPath("%73tatus").ok).toBe(false);
  });

  it("refuses an unlisted endpoint on the same prefix", () => {
    for (const path of ["admin", "shutdown", "config", "secrets", "api/status"]) {
      expect(checkJackyPath(path).ok, path).toBe(false);
    }
  });

  it("refuses a query string smuggled into the path", () => {
    expect(checkJackyPath("status?redirect=http://evil").ok).toBe(false);
    expect(checkJackyPath("status#fragment").ok).toBe(false);
  });

  it("refuses an absolute URL", () => {
    expect(checkJackyPath("http://evil.example.com/").ok).toBe(false);
    expect(checkJackyPath("//evil.example.com/admin").ok).toBe(false);
  });

  it("refuses control characters and null bytes", () => {
    expect(checkJackyPath("status\n").ok).toBe(false);
    expect(checkJackyPath("status\0").ok).toBe(false);
  });

  it("refuses a missing, empty or non-string path", () => {
    for (const bad of [undefined, null, "", 42, {}, []]) {
      expect(checkJackyPath(bad).ok, String(bad)).toBe(false);
    }
    expect(checkJackyPath(undefined).reason).toMatch(/missing/);
  });

  it("refuses an absurdly long path rather than matching it", () => {
    expect(checkJackyPath("squads/" + "a".repeat(500) + "/ask").ok).toBe(false);
  });

  it("refuses a squad name carrying a slash, which would add a path segment", () => {
    expect(checkJackyPath("squads/a/b/ask").ok).toBe(false);
    expect(checkJackyPath("squads//ask").ok).toBe(false);
  });
});

describe("the allowlist itself", () => {
  it("is anchored at both ends, or a prefix match would let anything through", () => {
    for (const pattern of ALLOWED_PATHS) {
      expect(pattern.source.startsWith("^"), pattern.source).toBe(true);
      expect(pattern.source.endsWith("$"), pattern.source).toBe(true);
    }
  });

  it("composes to a URL that stays under /api for every allowed path", () => {
    const base = "https://rig.example.com";
    for (const path of ["status", "assessment", "ask", "control", "squads/lead/ask"]) {
      const verdict = checkJackyPath(path);
      const url = new URL(`${base}/api/${verdict.path}`);
      // The property that was violated: the composed URL must never escape the
      // prefix, whatever the caller sent.
      expect(url.href.startsWith(`${base}/api/`), path).toBe(true);
    }
  });
});
