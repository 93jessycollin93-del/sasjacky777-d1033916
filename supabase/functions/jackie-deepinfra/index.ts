// Streaming chat via DeepInfra (pay-per-token; OpenAI-compatible).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "DEEPINFRA_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-deepinfra",
  secret: SECRET,
  url: "https://api.deepinfra.com/v1/openai/chat/completions",
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  models: [
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Meta-Llama-3.1-405B-Instruct",
    "deepseek-ai/DeepSeek-R1",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
  ],
  keyHelp: "Create one at https://deepinfra.com/dash/api_keys",
}));
