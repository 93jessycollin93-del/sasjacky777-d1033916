import { describe, expect, it } from "vitest";
import { restoreUnconfigured } from "@/lib/edgeFunction";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("an engine with no secret set", () => {
  it("is read as a refusal naming the secret, though it arrived as 200", async () => {
    const r = await restoreUnconfigured(
      json({ ok: false, code: "PROVIDER_UNCONFIGURED", needs_secret: "OLLAMA_BASE_URL" }),
    );
    expect(r.ok).toBe(false);
    expect((await r.json()).needs_secret).toBe("OLLAMA_BASE_URL");
  });

  it("leaves a real answer alone", async () => {
    const r = await restoreUnconfigured(json({ ok: true, data: 1 }));
    expect(r.status).toBe(200);
  });
});
