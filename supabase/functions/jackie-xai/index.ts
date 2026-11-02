// Streaming chat via xAI Grok direct (paid; OpenAI-compatible).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "XAI_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-xai",
  secret: SECRET,
  url: "https://api.x.ai/v1/chat/completions",
  defaultModel: "grok-4.5",
  models: [
    "grok-4.5",
    "grok-4-latest",
    "grok-3",
    "grok-3-mini",
    "grok-2-latest",
    "grok-2-vision-latest",
    "grok-beta",
  ],
  keyHelp: "Paste your xAI key at https://console.x.ai/",
}));
