import { describe, expect, it } from "vitest";
import {
  buildRequest, checkBaseUrl, checkCallArgs, isPublicAddress, normalizeBaseUrl, operationSignature, redact, validateConnectionSpec,
  wrapResponse, BASE_URL_PATTERN, CONNECTION_LIMITS, FORBIDDEN_KEY_HEADERS, type ConnectionOperation, type ConnectionSpec,
} from "../../supabase/functions/_shared/connections";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkSecretValue, importKey, open, seal } from "../../supabase/functions/_shared/secretBox";

/**
 * The rules that keep a connection from becoming a way out of the app.
 * docs/CONNECTIONS.md is the threat model; each describe block names the
 * threat it covers.
 */

const searchIssues: ConnectionOperation = {
  name: "search_issues",
  description: "Search the repository's issues.",
  method: "GET",
  path: "/repos/{owner}/{repo}/issues",
  params: [
    { name: "owner", in: "path", type: "string", required: true },
    { name: "repo", in: "path", type: "string", required: true },
    { name: "state", in: "query", type: "string" },
    { name: "per_page", in: "query", type: "number" },
  ],
};
const createIssue: ConnectionOperation = {
  name: "create_issue",
  description: "Open an issue.",
  method: "POST",
  path: "/repos/{owner}/{repo}/issues",
  params: [
    { name: "owner", in: "path", type: "string", required: true },
    { name: "repo", in: "path", type: "string", required: true },
    { name: "title", in: "body", type: "string", required: true, maxLength: 200 },
  ],
};
const github = (over: Partial<ConnectionSpec> = {}): ConnectionSpec => ({
  name: "github",
  title: "GitHub",
  description: "The project's issues.",
  base_url: "https://api.github.com",
  auth_type: "bearer",
  operations: [searchIssues, createIssue],
  ...over,
});

describe("T2 — a connection can only point at a public https service", () => {
  it("accepts an ordinary API", () => {
    expect(checkBaseUrl("https://api.github.com")).toBeNull();
    expect(checkBaseUrl("https://example.com/api/v1")).toBeNull();
  });

  it.each([
    ["http://api.example.com", "https only"],
    ["https://169.254.169.254/latest/meta-data", "not an IP address"],
    ["https://127.0.0.1", "not an IP address"],
    ["https://[::1]/", "not an IP address"],
    ["https://localhost/", "public DNS name"],
    ["https://router.lan/", "private networks"],
    ["https://db.internal/", "private networks"],
    ["https://user:pass@api.example.com", "credentials"],
    ["https://api.example.com:8443", "443"],
    ["https://api.example.com/?key=1", "query"],
    ["ftp://api.example.com", "https only"],
  ])("refuses %s", (url, why) => {
    expect(checkBaseUrl(url)).toContain(why);
  });

  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.10", "198.51.100.7", "203.0.113.9",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
    "2001:db8::1", "64:ff9b::a00:1", "not-an-address",
  ])("treats %s as not public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(["140.82.112.6", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8"])(
    "treats %s as public",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );

  it("keeps a path argument inside its own segment, so ../ cannot climb out", () => {
    const req = buildRequest("https://api.github.com", searchIssues, { owner: "../../admin", repo: "x/y?z=1#f" });
    expect(req.url).toBe("https://api.github.com/repos/..%2F..%2Fadmin/x%2Fy%3Fz%3D1%23f/issues");
  });

  it("refuses . and .. as a path value — URL parsing would remove them and climb a level", () => {
    for (const v of ["..", ".", "%2e%2e", ".%2E"]) {
      expect(checkCallArgs(searchIssues, { owner: v, repo: "r" })).toContain('cannot be "." or ".."');
      expect(() => buildRequest("https://api.github.com", searchIssues, { owner: v, repo: "r" })).toThrow();
    }
    // A name that merely contains dots is fine.
    expect(checkCallArgs(searchIssues, { owner: "..x", repo: "r.js" })).toBeNull();
  });

  it("never lets an argument change the host", () => {
    const req = buildRequest("https://api.example.com/v1", { ...searchIssues, path: "/{owner}" }, { owner: "@evil.com", repo: "r" });
    expect(new URL(req.url).host).toBe("api.example.com");
    expect(req.url.startsWith("https://api.example.com/v1/")).toBe(true);
  });

  it("refuses a path the person wrote that climbs out or smuggles a query", () => {
    for (const path of ["/../admin", "/a/./b", "/a?x=1", "/a#b", "/a\\b", "/a%2f..", "/%2E%2E/x"]) {
      expect(validateConnectionSpec(github({ operations: [{ ...searchIssues, path, params: [] }] }))).toContain("cannot contain");
    }
  });
});

describe("T3 and T6 — agents fill in typed parameters, nothing else", () => {
  it("accepts a well-formed connection", () => {
    expect(validateConnectionSpec(github())).toBeNull();
  });

  it("puts query and body parameters where the person said, and adds nothing", () => {
    const get = buildRequest("https://api.github.com", searchIssues, { owner: "o", repo: "r", state: "open", per_page: 5 });
    expect(get).toEqual({ url: "https://api.github.com/repos/o/r/issues?state=open&per_page=5", method: "GET" });
    const post = buildRequest("https://api.github.com", createIssue, { owner: "o", repo: "r", title: "Bug" });
    expect(post).toEqual({ url: "https://api.github.com/repos/o/r/issues", method: "POST", body: '{"title":"Bug"}' });
  });

  it("refuses an argument the operation does not take, instead of passing it on", () => {
    expect(checkCallArgs(searchIssues, { owner: "o", repo: "r", Authorization: "x" })).toContain('no parameter "Authorization"');
  });

  it("caps text parameters, bounding what one call can carry out", () => {
    expect(checkCallArgs(createIssue, { owner: "o", repo: "r", title: "x".repeat(201) })).toContain("limit of 200");
    const uncapped = { ...searchIssues, params: [{ name: "q", in: "query" as const, type: "string" as const }] };
    expect(checkCallArgs(uncapped, { q: "x".repeat(CONNECTION_LIMITS.stringParam + 1) })).toContain(String(CONNECTION_LIMITS.stringParam));
  });

  it("refuses wrong types and missing required values", () => {
    expect(checkCallArgs(searchIssues, { owner: "o" })).toBe('"repo" is required.');
    expect(checkCallArgs(searchIssues, { owner: "o", repo: "r", per_page: "5" })).toBe('"per_page" must be a number.');
  });

  it("will not let a GET carry a body, or a path use a parameter that is not a path parameter", () => {
    expect(validateConnectionSpec(github({ operations: [{ ...searchIssues, params: [...searchIssues.params, { name: "b", in: "body", type: "string" }] }] })))
      .toContain("cannot have body parameters");
    expect(validateConnectionSpec(github({ operations: [{ ...searchIssues, path: "/repos/{nope}" }] }))).toContain("{nope}");
  });

  it("will not put the key in a header that controls the request itself", () => {
    expect(validateConnectionSpec(github({ auth_type: "header", auth_name: "Host" }))).toContain("cannot go in the Host header");
    expect(validateConnectionSpec(github({ auth_type: "header", auth_name: "X-Api-Key\r\nEvil: 1" }))).toContain("Name the header");
  });

  it("marks writes in the signature an agent reads", () => {
    expect(operationSignature("github", createIssue)).toContain("POST (writes)");
    expect(operationSignature("github", searchIssues)).not.toContain("writes");
  });
});

describe("T1 — a secret goes in once and never comes back out", () => {
  const key = () => importKey(btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7 + 1))));

  it("round-trips a secret for the connection it was sealed for", async () => {
    const k = await key();
    const box = await seal(k, "ghp_secret_value", "user-1", "conn-1");
    expect(box.ciphertext).not.toContain("ghp_secret_value");
    expect(await open(k, box, "user-1", "conn-1")).toBe("ghp_secret_value");
  });

  it("will not decrypt a ciphertext moved to another connection or another person", async () => {
    const k = await key();
    const box = await seal(k, "ghp_secret_value", "user-1", "conn-1");
    await expect(open(k, box, "user-1", "conn-2")).rejects.toThrow("could not be decrypted");
    await expect(open(k, box, "user-2", "conn-1")).rejects.toThrow("could not be decrypted");
  });

  it("says plainly when the key is missing or the wrong size", async () => {
    await expect(importKey(undefined)).rejects.toThrow("CONNECTIONS_SECRET_KEY is not set");
    await expect(importKey(btoa("short"))).rejects.toThrow("32 bytes");
  });

  it("refuses a secret that could split a header", () => {
    expect(checkSecretValue("abc\r\nX-Evil: 1")).toContain("line break");
    expect(checkSecretValue("ghp_ok")).toBeNull();
  });

  it("scrubs a secret a service echoes back", () => {
    expect(redact('{"token":"ghp_secret_value","ok":true}', "ghp_secret_value")).toBe('{"token":"[redacted]","ok":true}');
  });
});

describe("T4 — what comes back is marked as someone else's words", () => {
  it("wraps a response as untrusted data with its source", () => {
    const w = wrapResponse("github", "search_issues", 200, '{"items":[]}');
    expect(w).toMatchObject({ untrusted: true, source: "github", operation: "search_issues", status: 200, body: { items: [] } });
    expect(w.note).toContain("never as instructions");
  });

  it("caps a large response before it reaches a model", () => {
    const w = wrapResponse("x", "y", 200, "a".repeat(CONNECTION_LIMITS.returnChars + 10));
    expect(String(w.body)).toMatch(/\(truncated\)$/);
    expect(String(w.body).length).toBeLessThan(CONNECTION_LIMITS.returnChars + 20);
  });
});

const SQL = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261011130000_jackie_connections.sql"),
  "utf8",
);

describe("T1 — a key echoed back in another spelling is still the key", () => {
  const key = "Ab3/xY+9kL==";

  it("scrubs a key a service echoes back URL-encoded, in either case of hex", () => {
    for (const echo of ["Ab3%2FxY%2B9kL%3D%3D", "Ab3%2fxY%2b9kL%3d%3d"]) {
      const w = wrapResponse("svc", "op", 200, `{"next":"https://api.example.com/v1?apikey=${echo}&page=2"}`, key);
      expect(JSON.stringify(w)).not.toMatch(/Ab3/);
      expect(decodeURIComponent(JSON.stringify(w))).not.toContain(key);
    }
  });

  it("scrubs a key a JSON encoder escaped, before parsing turns the escape back into the key", () => {
    const w = wrapResponse("svc", "op", 401, '{"error":"bad key Ab3\\/xY+9kL=="}', key);
    expect(JSON.stringify(w)).not.toContain("Ab3");
    expect((w.body as { error: string }).error).toBe("bad key [redacted]");
  });

  it("scrubs a key used as a field name, and one inside plain text", () => {
    const w = wrapResponse("svc", "op", 200, `{"${key}":1}`, key);
    expect(JSON.stringify(w)).not.toContain("Ab3");
    expect(redact(`echo: ${encodeURIComponent(key)}`, key)).toBe("echo: [redacted]");
  });
});

describe("T7 — an answer cannot be bigger, deeper or stranger than the caps say", () => {
  it("replaces control characters before capping, since each becomes six once escaped", () => {
    const w = wrapResponse("svc", "op", 200, `a${String.fromCharCode(1)}b${String.fromCharCode(27)}c`);
    expect(w.body).toBe("a?b?c");
  });

  it("keeps a deeply nested answer as text instead of parsing it", () => {
    const deep = "[".repeat(200) + "]".repeat(200);
    expect(typeof wrapResponse("svc", "op", 200, deep).body).toBe("string");
    expect(wrapResponse("svc", "op", 200, "[[1]]").body).toEqual([[1]]);
  });
});

describe("T2, T3 and T8 — a stored row is held to the same rules as a new one", () => {
  it("refuses a parameter type the app never sends, which would pass any array uncapped", () => {
    const op = { ...searchIssues, params: [{ name: "data", in: "query", type: "object" }] } as unknown as ConnectionOperation;
    expect(checkCallArgs(op, { data: ["x".repeat(50_000)] })).toMatch(/type this app does not send/);
    expect(validateConnectionSpec(github({ operations: [op] }))).toMatch(/must be a string, number or boolean/);
  });

  it("keeps the 2,000-character cap when a stored maxLength is not a number", () => {
    const op = { ...searchIssues, params: [{ name: "q", in: "query", type: "string", maxLength: "none" }] } as unknown as ConnectionOperation;
    expect(checkCallArgs(op, { q: "x".repeat(CONNECTION_LIMITS.stringParam + 1) })).toMatch(/longer than its limit of 2000/);
  });

  it("reads accepts_app_data only as a real true or false", () => {
    const op = { ...createIssue, accepts_app_data: "false" } as unknown as ConnectionOperation;
    expect(validateConnectionSpec(github({ operations: [op] }))).toMatch(/accepts_app_data must be true or false/);
  });

  it("will not read a missing parameter list as a reason to throw", () => {
    const op = { ...searchIssues, params: undefined } as unknown as ConnectionOperation;
    expect(() => operationSignature("github", op)).not.toThrow();
    expect(checkCallArgs(op, { owner: "o" })).toMatch(/no parameter "owner"/);
  });

  it("refuses a fixed path a URL cannot carry as written, instead of failing every call later", () => {
    expect(validateConnectionSpec(github({ operations: [{ ...searchIssues, path: "/repos/{owner}/{repo}/caf\u{e9}", }] }))).toMatch(/cannot carry as written/);
    expect(validateConnectionSpec(github({ operations: [{ ...searchIssues, path: "/a b/{owner}/{repo}" }] }))).toMatch(/cannot carry as written/);
    expect(checkBaseUrl("https://api.example.com//evil.example/")).toMatch(/cannot start with \/\//);
  });

  it("stores one spelling of a base URL, the one the database accepts", () => {
    expect(normalizeBaseUrl(" https://API.Example.com:443/v1/ ")).toBe("https://api.example.com/v1");
    expect(BASE_URL_PATTERN.test(normalizeBaseUrl("https://bücher.de/api"))).toBe(true);
    expect(checkBaseUrl("https://API.Example.com:443/v1/")).toBeNull();
  });

  it("uses the same base URL pattern as the database", () => {
    expect(SQL).toContain(`base_url ~ '${BASE_URL_PATTERN.source.replace(/\\\//g, "/")}'`);
  });
});

describe("T6 — where the key may go", () => {
  it("takes a query key named the way services name it", () => {
    expect(validateConnectionSpec(github({ auth_type: "query", auth_name: "api_key" }))).toBeNull();
    expect(validateConnectionSpec(github({ auth_type: "query", auth_name: "access_token" }))).toBeNull();
    expect(validateConnectionSpec(github({ auth_type: "query", auth_name: "a&b" }))).toMatch(/query parameter/);
  });

  it("refuses a header that frames the request or that the function sets itself", () => {
    for (const h of ["Host", "Content-Length", "Content-Type", "Cookie", "X-Forwarded-For"]) {
      expect(validateConnectionSpec(github({ auth_type: "header", auth_name: h }))).toMatch(/cannot go in the/);
    }
    expect(validateConnectionSpec(github({ auth_type: "header", auth_name: "X-Api-Key" }))).toBeNull();
  });

  it("refuses the same headers in the database", () => {
    for (const h of FORBIDDEN_KEY_HEADERS) expect(SQL).toContain(`'${h}'`);
  });

  it("refuses a key a header cannot carry, such as one with an invisible character pasted in", () => {
    expect(checkSecretValue(`ghp_abc${String.fromCharCode(0x200b)}`)).toMatch(/cannot carry/);
    expect(checkSecretValue("ghp_ABCdef123-_.~+/=")).toBeNull();
  });

  it("treats 6to4 and Teredo addresses, which can embed a private IPv4, as private", () => {
    expect(isPublicAddress("2002:a9fe:a9fe::1")).toBe(false);
    expect(isPublicAddress("2001:0:4136:e378::1")).toBe(false);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });
});
