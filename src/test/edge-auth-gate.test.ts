import { describe, expect, it, vi } from "vitest";
import {
  REQUIRED_SUPABASE_JS,
  bearerToken,
  verifyAccessToken,
} from "../../supabase/functions/_shared/authGate";

/**
 * The bug this closes is why the main chat answered nothing at all.
 *
 * Twenty-one edge functions pinned `@supabase/supabase-js@2.49.1` and opened
 * with `auth.getClaims(token)`. `getClaims` was added in 2.50.0. At 2.49.1 it
 * is `undefined`, so the gate threw `TypeError: ... is not a function` on every
 * single request — before any authentication happened, and outside the request
 * try/catch. The isolate answered 500 with no CORS headers, which the browser
 * is not allowed to read, so the chat surfaced `TypeError: Failed to fetch`.
 * Nothing in that message points at a version pin.
 *
 * Imported from the file the functions import, so there is no second copy.
 */
describe("the shape of the gate", () => {
  it("pins a supabase-js that actually has getClaims", () => {
    // 2.50.0 is where it landed; anything below is the bug this file is about.
    const [major, minor] = REQUIRED_SUPABASE_JS.split(".").map(Number);
    expect(major).toBe(2);
    expect(minor).toBeGreaterThanOrEqual(50);
  });
});

describe("reading the Authorization header", () => {
  it("takes the token out of a well-formed header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("accepts the casing and spacing a client might actually send", () => {
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Bearer   abc  ")).toBe("abc");
  });

  it("refuses rather than passing nonsense on to be verified", () => {
    // `replace("Bearer ", "")` turned each of these into a string that was sent
    // to the auth server as though it were a token.
    expect(bearerToken("bearer")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

const claimsOk = { data: { claims: { sub: "user-1", email: "a@b.c" } }, error: null };
const userOk = { data: { user: { id: "user-1", email: "a@b.c" } }, error: null };

describe("verifying an access token", () => {
  it("accepts a token getClaims verifies", async () => {
    const auth = { getClaims: vi.fn().mockResolvedValue(claimsOk), getUser: vi.fn() };
    const verdict = await verifyAccessToken(auth, "jwt");

    expect(verdict.error).toBeNull();
    expect(verdict.data?.claims.sub).toBe("user-1");
    expect(verdict.via).toBe("getClaims");
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("falls back to getUser when getClaims is missing — the 2.49.1 case", async () => {
    // This is exactly the client the functions were building. Under the old
    // code this threw and took the whole function down; now it authenticates.
    const auth = { getUser: vi.fn().mockResolvedValue(userOk) };
    const verdict = await verifyAccessToken(auth, "jwt");

    expect(verdict.error).toBeNull();
    expect(verdict.data?.claims.sub).toBe("user-1");
    expect(verdict.via).toBe("getUser");
  });

  it("falls back when getClaims exists but throws", async () => {
    const auth = {
      getClaims: vi.fn().mockRejectedValue(new Error("jwks fetch failed")),
      getUser: vi.fn().mockResolvedValue(userOk),
    };
    expect((await verifyAccessToken(auth, "jwt")).data?.claims.sub).toBe("user-1");
  });

  it("treats a refusal from getClaims as final, not as something to retry", async () => {
    // A bad signature is an answer. Asking a second service the same question
    // would cost a round trip and give the same answer.
    const auth = {
      getClaims: vi.fn().mockResolvedValue({ data: null, error: { message: "bad signature" } }),
      getUser: vi.fn(),
    };
    const verdict = await verifyAccessToken(auth, "jwt");

    expect(verdict.data).toBeNull();
    expect(verdict.error?.message).toBe("bad signature");
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects an empty or missing token without calling anything", async () => {
    const auth = { getClaims: vi.fn(), getUser: vi.fn() };
    for (const token of [null, "", "   "]) {
      expect((await verifyAccessToken(auth, token)).data).toBeNull();
    }
    expect(auth.getClaims).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("never throws, whatever the client does", async () => {
    // The gate sits ahead of the request's try/catch in most of these
    // functions. A throw here is a 500 with no CORS headers, which the browser
    // reports as "Failed to fetch" — the failure that started all this.
    const exploding = {
      getClaims: () => {
        throw new Error("boom");
      },
      getUser: () => {
        throw new Error("boom");
      },
    };
    const verdict = await verifyAccessToken(exploding, "jwt");
    expect(verdict.data).toBeNull();
    expect(verdict.error?.message).toBe("boom");
  });

  it("refuses a getUser result with no user", async () => {
    const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) };
    expect((await verifyAccessToken(auth, "jwt")).data).toBeNull();
  });
});
