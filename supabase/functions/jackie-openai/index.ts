// Streaming chat via OpenAI direct (paid; user-supplied key only).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "OPENAI_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-openai",
  secret: SECRET,
  url: "https://api.openai.com/v1/chat/completions",
  defaultModel: "gpt-4o-mini",
  models: [
    "gpt-4o",
    "gpt-4o-mini",
    "o1",
    "o1-mini",
  ],
  keyHelp: "Paste your OpenAI key at https://platform.openai.com/api-keys",
}));
