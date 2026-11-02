import { afterEach, describe, expect, it, vi } from "vitest";
import * as edge from "@/lib/edgeFunction";
import { fetchDevicePersona } from "@/lib/microai/devicePersona";

const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.restoreAllMocks());

describe("on-device profile readiness", () => {
  it("identifies a missing deployment without blaming the downloaded model", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(response(404, { error: "NOT_FOUND" }));
    const result = await fetchDevicePersona();
    expect(result).toMatchObject({ ok: false, issue: { code: "NOT_DEPLOYED" } });
    expect(result.issue?.detail).toContain("HTTP 404");
    expect(result.issue?.recovery).toContain("do not need to download the model again");
  });
  it.each([[401, "SIGNED_OUT"], [403, "OWNER_ONLY"], [500, "INVALID_PROFILE"]])("gives HTTP %s its own recovery", async (status, code) => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(response(Number(status), {}));
    expect(await fetchDevicePersona()).toMatchObject({ ok: false, issue: { code } });
  });
  it("refuses an empty profile even inside a 200 response", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(response(200, { prompt: " " }));
    expect(await fetchDevicePersona()).toMatchObject({ ok: false, issue: { code: "INVALID_PROFILE" } });
  });
  it("returns the guarded profile and sends only bounded memory context", async () => {
    const call = vi.spyOn(edge, "callEdgeFunction").mockResolvedValue(response(200, { prompt: "Guarded Jackie", mode: "persona" }));
    expect(await fetchDevicePersona({ context: "x".repeat(4_000) })).toMatchObject({ ok: true, prompt: "Guarded Jackie", mode: "persona" });
    expect(Object.keys(call.mock.calls[0][1] as object)).toEqual(["context"]);
    const sent = (call.mock.calls[0][1] as { context: string }).context;
    expect(sent.endsWith("x".repeat(2_000))).toBe(true);
    expect(sent).toContain("earlier context trimmed");
    expect(sent.length).toBeLessThan(2_100); // Includes the shared clamp's omission notice.
  });
  it("settles an aborted profile request without reporting a broken service", async () => {
    const controller = new AbortController();
    vi.spyOn(edge, "callEdgeFunction").mockImplementation(async (_name, _body, options) => {
      await new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError"))));
      throw Error("unreachable");
    });
    const request = fetchDevicePersona({ signal: controller.signal });
    controller.abort();
    expect(await request).toMatchObject({ ok: false, stopped: true });
  });
  it("bounds a hung backend request instead of leaving a spinner forever", async () => {
    vi.spyOn(edge, "callEdgeFunction").mockImplementation(async (_name, _body, options) => {
      await new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError"))));
      throw Error("unreachable");
    });
    expect(await fetchDevicePersona({ timeoutMs: 5 })).toMatchObject({ ok: false, issue: { code: "TIMEOUT" } });
  });
});
