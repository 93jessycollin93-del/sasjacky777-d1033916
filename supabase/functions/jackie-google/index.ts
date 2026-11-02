// Streaming chat via Google AI Studio (Gemini direct, free tier).
// Uses OpenAI-compatible endpoint. Requires GOOGLE_AI_STUDIO_KEY.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "GOOGLE_AI_STUDIO_KEY";

serve(openAiCompatHandler({
  fn: "jackie-google",
  secret: SECRET,
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  defaultModel: "gemini-2.0-flash",
  models: [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
  ],
  keyHelp: "Get a free key at https://aistudio.google.com/apikey",
}));
