import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import * as edge from "@/lib/edgeFunction";
import { fetchDevicePersona } from "@/lib/microai/devicePersona";
import {
  PERSONA_MAX_AGE_MS,
  clearDevicePersona,
  loadDevicePersona,
  saveDevicePersona,
} from "@/lib/microai/personaCache";

const okProfile = (prompt = "Guarded Jackie") =>
  new Response(JSON.stringify({ prompt, mode: "persona" }), { status: 200 });

/** jsdom has no IndexedDB, so the cache falls back to its in-memory copy. */
function signInAs(id: string | null) {
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
    data: { session: id ? { user: { id } } : null },
  } as never);
}

const offline = () => vi.spyOn(edge, "callEdgeFunction").mockRejectedValue(new TypeError("Failed to fetch"));

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearDevicePersona();
});

describe("answering as Jackie with the radio off", () => {
  it("keeps the profile that arrived so the next turn needs no network", async () => {
    signInAs("owner-1");
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(okProfile());
    expect(await fetchDevicePersona()).toMatchObject({ ok: true, prompt: "Guarded Jackie" });

    offline();
    const second = await fetchDevicePersona();
    expect(second).toMatchObject({ ok: true, prompt: "Guarded Jackie", mode: "persona", fromCache: true });
    if (!second.ok) throw new Error(`no saved profile: ${second.issue.code}`);
    expect(second.fetchedAt).toBeGreaterThan(0);
  });

  it("saves nothing when no account is signed in, so no profile is left on a shared browser", async () => {
    signInAs(null);
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(okProfile());
    await fetchDevicePersona();

    offline();
    expect(await fetchDevicePersona()).toMatchObject({ ok: false, issue: { code: "UNREACHABLE" } });
    expect(await loadDevicePersona(null)).toBeNull();
  });

  it("will not answer one account from another account's saved profile", async () => {
    signInAs("owner-1");
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(okProfile("Owner one's Jackie"));
    await fetchDevicePersona();

    signInAs("owner-2");
    offline();
    expect(await fetchDevicePersona()).toMatchObject({ ok: false, issue: { code: "UNREACHABLE" } });
  });

  it("treats a refused profile as a real fault rather than as a missing network", async () => {
    signInAs("owner-1");
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(okProfile());
    await fetchDevicePersona();

    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(new Response("{}", { status: 403 }));
    expect(await fetchDevicePersona()).toMatchObject({ ok: false, issue: { code: "OWNER_ONLY" } });
  });

  it("treats a cancelled request as a stop, not as a reason to reach for a saved copy", async () => {
    signInAs("owner-1");
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(okProfile());
    await fetchDevicePersona();

    const controller = new AbortController();
    offline();
    const request = fetchDevicePersona({ signal: controller.signal });
    controller.abort();
    expect(await request).toMatchObject({ ok: false, stopped: true });
  });

  it("expires a saved profile instead of answering from rules the owner may have changed", async () => {
    await saveDevicePersona({
      userId: "owner-1",
      prompt: "A week-old Jackie",
      mode: "persona",
      fetchedAt: Date.now() - PERSONA_MAX_AGE_MS - 1_000,
    });
    expect(await loadDevicePersona("owner-1")).toBeNull();
  });

  it("serves a saved profile that is still inside the trust window", async () => {
    await saveDevicePersona({
      userId: "owner-1",
      prompt: "Yesterday's Jackie",
      mode: "persona",
      fetchedAt: Date.now() - PERSONA_MAX_AGE_MS + 60_000,
    });
    expect(await loadDevicePersona("owner-1")).toMatchObject({ prompt: "Yesterday's Jackie" });
  });
});
