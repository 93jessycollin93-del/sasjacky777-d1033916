// Streaming chat via Mistral La Plateforme (free experimental tier).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "MISTRAL_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-mistral",
  secret: SECRET,
  url: "https://api.mistral.ai/v1/chat/completions",
  defaultModel: "mistral-small-latest",
  models: [
    "mistral-large-latest",
    "mistral-small-latest",
    "open-mistral-nemo",
    "codestral-latest",
    "pixtral-large-latest",
  ],
  keyHelp: "Get a free key at https://console.mistral.ai/api-keys/",
}));
