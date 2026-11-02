// Streaming chat via Fireworks AI (OpenAI-compatible).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "FIREWORKS_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-fireworks",
  secret: SECRET,
  url: "https://api.fireworks.ai/inference/v1/chat/completions",
  defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  models: [
    "accounts/fireworks/models/llama-v3p3-70b-instruct",
    "accounts/fireworks/models/llama-v3p1-405b-instruct",
    "accounts/fireworks/models/deepseek-r1",
    "accounts/fireworks/models/qwen2p5-coder-32b-instruct",
  ],
  keyHelp: "Create one at https://fireworks.ai/account/api-keys",
}));
