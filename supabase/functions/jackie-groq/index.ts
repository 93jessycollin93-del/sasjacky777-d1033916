// Streaming chat via Groq (free tier: 14.4k req/day, real Llama models).
// Requires GROQ_API_KEY secret. User can add it in Cloud → Secrets.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "GROQ_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-groq",
  secret: SECRET,
  url: "https://api.groq.com/openai/v1/chat/completions",
  defaultModel: "llama-3.3-70b-versatile",
  models: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview",
    "llama-3.2-3b-preview",
    "llama-3.2-1b-preview",
    "llama-guard-3-8b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
    "qwen/qwen3-32b",
    "deepseek-r1-distill-llama-70b",
  ],
  keyHelp: "Add it in Cloud → Secrets. Get a free key at console.groq.com/keys",
}));
