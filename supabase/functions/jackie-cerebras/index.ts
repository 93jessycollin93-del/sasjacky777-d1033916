// Streaming chat via Cerebras (free tier, ~2000 tok/s Llama).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "CEREBRAS_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-cerebras",
  secret: SECRET,
  url: "https://api.cerebras.ai/v1/chat/completions",
  defaultModel: "llama-3.3-70b",
  models: [
    "llama-3.3-70b",
    "llama3.1-8b",
    "llama-4-scout-17b-16e-instruct",
    "qwen-3-32b",
  ],
  keyHelp: "Get a free key at https://cloud.cerebras.ai/",
}));
