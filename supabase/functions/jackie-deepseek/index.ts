// Streaming chat via DeepSeek's own API (paid per token; OpenAI-compatible).
// Requires DEEPSEEK_API_KEY. Model ids follow DeepSeek's current catalogue:
// V4 Flash and V4 Pro, plus the long-lived `deepseek-chat` / `deepseek-reasoner`
// aliases that older clients and presets still name.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "DEEPSEEK_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-deepseek",
  secret: SECRET,
  url: "https://api.deepseek.com/chat/completions",
  defaultModel: "deepseek-v4-flash",
  models: [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-chat",
    "deepseek-reasoner",
  ],
  keyHelp: "Create one at https://platform.deepseek.com/api_keys and add it in Cloud → Secrets.",
}));
