import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { edgeUrl, edgeHeaders, NotSignedInError, describeEdgeFailure } from "@/lib/edgeFunction";
import { supabase } from "@/integrations/supabase/client";

/**
 * The bug this closes had the chat dead behind the word "Failed to fetch".
 *
 * This project's Supabase key is the new opaque kind (`sb_publishable_…`), not
 * a JWT. The generated client knows it — `createSupabaseFetch` deliberately
 * strips an Authorization header holding that key and sends it as `apikey`.
 * Every hand-written fetch to an edge function bypassed the client and sent the
 * key as a bearer token with no `apikey` at all, which the gateway rejects
 * before the function runs; `jackie-chat` would have answered 401 anyway, since
 * it calls `getClaims()` on whatever it is given.
 *
 * So: the key never goes in Authorization, the user's token always does, and a
 * signed-out caller is told that rather than being sent to fail at the gateway.
 */
const session = (token: string | null) => ({
  data: { session: token ? { access_token: token } : null },
  error: null,
});

describe("edge function headers", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("sends the publishable key as apikey, never as a bearer token", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue(session("user-jwt") as never);
    const headers = await edgeHeaders();

    expect(headers.apikey).toBeTruthy();
    expect(headers.Authorization).toBe("Bearer user-jwt");
    expect(headers.Authorization).not.toContain("sb_publishable_");
    expect(headers.apikey).not.toMatch(/^Bearer /);
  });

  it("refuses rather than sending a request that cannot authenticate", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue(session(null) as never);
    await expect(edgeHeaders()).rejects.toBeInstanceOf(NotSignedInError);
  });

  it("omits Authorization entirely for a function that allows anonymous callers", async () => {
    vi.spyOn(supabase.auth, "getSession").mockResolvedValue(session(null) as never);
    const headers = await edgeHeaders({ requireSession: false });

    expect(headers.Authorization).toBeUndefined();
    expect(headers.apikey).toBeTruthy();
  });

  it("builds every URL on the configured project", () => {
    // The /discernment command was hardcoded to a different project ref, so it
    // could never reach this app's functions whatever was deployed.
    expect(edgeUrl("jackie-chat")).toBe(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jackie-chat`);
    expect(edgeUrl("jackie-chat")).not.toContain("rkwhhbxgjdpehfuxsult");
  });
});

describe("explaining a failure", () => {
  it("turns 'Failed to fetch' into something a person can act on", () => {
    const said = describeEdgeFailure(new TypeError("Failed to fetch"), "jackie-chat");
    expect(said).not.toBe("Failed to fetch");
    expect(said).toMatch(/jackie-chat/);
    expect(said).toMatch(/deployed|online/i);
  });

  it("says plainly when the real problem is being offline", () => {
    const online = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    expect(describeEdgeFailure(new TypeError("Failed to fetch"), "jackie-chat")).toMatch(/offline/i);
    if (online) Object.defineProperty(navigator, "onLine", online);
  });

  it("passes a real server message through untouched", () => {
    expect(describeEdgeFailure(new Error("Rate limit hit."), "jackie-chat")).toBe("Rate limit hit.");
  });

  it("tells a signed-out user to sign in", () => {
    expect(describeEdgeFailure(new NotSignedInError(), "jackie-chat")).toMatch(/sign in/i);
  });
});
