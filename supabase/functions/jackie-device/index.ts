/**
 * jackie-device — Jackie's system prompt for the engine that runs in the owner's browser.
 *
 * The on-device engine runs Bonsai 1.7B in the tab (src/lib/microai/bonsaiDevice.ts),
 * so no function ever sees its answer. It still has to answer as Jackie: an engine
 * without the persona answers as an anonymous assistant, and an engine without
 * the morals is the one the guard rail exists to catch (rule 6).
 *
 * The persona cannot simply ship to the browser — it is kept out of the bundle
 * so that anyone who loads the app cannot download it — so the device asks for
 * it here, once per message, and gets it built by the same guard every other
 * engine uses. That also leaves the same attestation behind, so the morals page
 * shows what the device ran next to what the other engines ran.
 *
 * Owner-only, like jacky-proxy and jackie-ollama: the device engine is the
 * owner's own hardware, and handing the persona to any signed-in account would
 * be publishing it. No quota: nothing here calls a model.
 *
 * The question itself is never sent. Only the memory context travels, and that
 * came from the owner's own database in the first place.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { json, preflight, requireOwnerUser } from "../_shared/entitlement.ts";
import { guardedSystemPrompt } from "../_shared/personaGuard.ts";

const FUNCTION_NAME = "jackie-device";

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const owner = await requireOwnerUser(req);
    if (owner instanceof Response) return owner;

    const payload = await req.json().catch(() => ({}));
    const context = payload && typeof payload === "object" ? (payload as { context?: unknown }).context : undefined;

    // `system` is deliberately not read. Every other engine accepts one so the
    // Agent Lab can bring its own identity; this one only ever answers the
    // owner's chat, so the only prompt it hands out is Jackie's.
    const guarded = await guardedSystemPrompt(FUNCTION_NAME, { context });
    await guarded.recorded;
    return json({ prompt: guarded.prompt, mode: guarded.mode }, 200, {
      ...guarded.headers,
      // A protected profile must not be reused across browser account changes.
      "Cache-Control": "no-store",
    });
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unexpected failure`, e);
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});
