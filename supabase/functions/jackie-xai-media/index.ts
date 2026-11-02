/**
 * xAI media surface: image generation, async video generation, TTS, and the
 * Responses API. XAI_API_KEY never reaches the browser.
 *
 * Two boundaries were missing.
 *
 * Video polling accepted a provider request id and asked the shared xAI
 * account about it. The id is issued by the provider and scoped to the whole
 * project account, so knowing one was the entire authorization — one user could
 * read another's generation by holding its id, and nothing recorded whose it
 * was in the first place. Starts are now written to xai_generation_requests
 * with an owner, and a poll must match both.
 *
 * The `respond` action took any model string and sent it on the shared key,
 * unlike every other action here, which checked against a set. That is the same
 * arbitrary-spend hole the OpenRouter function had.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  adminClient, admit, allowlistFromEnv, corsHeaders, json, pickModel,
  preflight, providerFailure, tooLarge,
} from "../_shared/entitlement.ts";

const FUNCTION_NAME = "jackie-xai-media";
const SECRET = "XAI_API_KEY";
const API = "https://api.x.ai/v1";

const IMAGE_MODELS = new Set([
  "grok-imagine-image-quality",
  "grok-imagine-image-fast",
  "grok-2-image",
]);
const VIDEO_MODELS = new Set(["grok-imagine-video"]);
const TTS_VOICES = new Set(["eve", "leo", "rex", "nova", "sol"]);
const RESPONSE_MODELS = allowlistFromEnv("XAI_RESPONSE_MODEL_ALLOWLIST", ["grok-4.5"]);

const MAX_PROMPT_CHARS = 10_000;
const MAX_TTS_CHARS = 5_000;
const MAX_INPUT_CHARS = 100_000;

/** Provider ids are opaque; this is the shape we will put in a URL path. */
const REQUEST_ID = /^[A-Za-z0-9_-]{4,128}$/;

async function xai(key: string, path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** xAI has spelled the generation id three ways across its media endpoints. */
function providerRequestId(body: Record<string, unknown>): string | null {
  if (typeof body.request_id === "string") return body.request_id;
  if (typeof body.id === "string") return body.id;
  const nested = body.data as Record<string, unknown> | undefined;
  if (nested && typeof nested.id === "string") return nested.id;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(payload.action ?? "");
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: "prompt too long" }, 413);

  // Resolve the model before admission so a rejected model costs no quota.
  let model: string | null = null;
  if (action === "image") {
    const picked = pickModel(payload.model, IMAGE_MODELS, "grok-imagine-image-quality");
    if ("error" in picked) return picked.error;
    model = picked.model;
  } else if (action === "video_start") {
    const picked = pickModel(payload.model, VIDEO_MODELS, "grok-imagine-video");
    if ("error" in picked) return picked.error;
    model = picked.model;
  } else if (action === "respond") {
    const picked = pickModel(payload.model, RESPONSE_MODELS, "grok-4.5");
    if ("error" in picked) return picked.error;
    model = picked.model;
  }

  // Key before quota (rule 5).
  const key = Deno.env.get(SECRET);
  if (!key) {
    return json({ error: "Provider unavailable", code: "PROVIDER_UNCONFIGURED", needs_secret: SECRET }, 503);
  }

  const admission = await admit(req, FUNCTION_NAME, model);
  if (admission instanceof Response) return admission;
  const { userId } = admission;

  try {
    // ---- Image generation -------------------------------------------------
    if (action === "image") {
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const resp = await xai(key, "/images/generations", {
        method: "POST",
        body: JSON.stringify({ model, prompt }),
      });
      if (!resp.ok) return await providerFailure(`${FUNCTION_NAME} image`, resp);
      return json(await resp.json());
    }

    // ---- Video: start -----------------------------------------------------
    if (action === "video_start") {
      if (!prompt) return json({ error: "prompt is required" }, 400);
      const resp = await xai(key, "/videos/generations", {
        method: "POST",
        body: JSON.stringify({ model, prompt }),
      });
      if (!resp.ok) return await providerFailure(`${FUNCTION_NAME} video start`, resp);

      const result = await resp.json() as Record<string, unknown>;
      const requestId = providerRequestId(result);
      if (!requestId || !REQUEST_ID.test(requestId)) {
        console.error(
          `${FUNCTION_NAME}: video start returned no usable request id`,
          JSON.stringify(result).slice(0, 1000),
        );
        return json({ error: "Provider returned an invalid generation identifier" }, 502);
      }

      // Recorded before the id is handed back: if we cannot establish who owns
      // this generation, the caller must not receive something they could poll.
      const { error } = await adminClient()
        .from("xai_generation_requests")
        .insert({ user_id: userId, provider_request_id: requestId, model });
      if (error) {
        console.error(`${FUNCTION_NAME}: could not record generation ownership`, error);
        return json({ error: "Could not record generation ownership" }, 500);
      }

      return json(result);
    }

    // ---- Video: poll ------------------------------------------------------
    if (action === "video_status") {
      const requestId = String(payload.request_id ?? "");
      if (!REQUEST_ID.test(requestId)) return json({ error: "Invalid request_id" }, 400);

      const { data: owned, error } = await adminClient()
        .from("xai_generation_requests")
        .select("provider_request_id")
        .eq("provider_request_id", requestId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.error(`${FUNCTION_NAME}: ownership lookup failed`, error);
        return json({ error: "Internal error" }, 500);
      }
      // Same answer for "no such generation" and "not yours", so the endpoint
      // cannot be used to discover which ids exist.
      if (!owned) return json({ error: "Generation not found" }, 404);

      const resp = await xai(key, `/videos/${encodeURIComponent(requestId)}`, { method: "GET" });
      if (!resp.ok) return await providerFailure(`${FUNCTION_NAME} video status`, resp);
      return json(await resp.json());
    }

    // ---- Text to speech ---------------------------------------------------
    if (action === "tts") {
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) return json({ error: "text is required" }, 400);
      if (text.length > MAX_TTS_CHARS) {
        return json({ error: `text too long (max ${MAX_TTS_CHARS} chars)` }, 400);
      }
      const voice_id = TTS_VOICES.has(String(payload.voice_id)) ? String(payload.voice_id) : "eve";
      const language = typeof payload.language === "string" ? payload.language.slice(0, 32) : "en";

      const resp = await xai(key, "/tts", {
        method: "POST",
        body: JSON.stringify({ text, voice_id, language }),
      });
      if (!resp.ok) return await providerFailure(`${FUNCTION_NAME} tts`, resp);

      return new Response(new Uint8Array(await resp.arrayBuffer()), {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
      });
    }

    // ---- Responses API ----------------------------------------------------
    if (action === "respond") {
      const input = payload.input ?? prompt;
      if (input === null || input === undefined || input === "") {
        return json({ error: "input is required" }, 400);
      }
      if (tooLarge(input, MAX_INPUT_CHARS)) return json({ error: "input too large" }, 413);

      const resp = await xai(key, "/responses", {
        method: "POST",
        body: JSON.stringify({ model, input }),
      });
      if (!resp.ok) return await providerFailure(`${FUNCTION_NAME} respond`, resp);
      return json(await resp.json());
    }

    return json({ error: `Unknown action: ${action || "(none)"}` }, 400);
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unexpected failure`, e);
    return json({ error: "Internal error" }, 500);
  }
});
