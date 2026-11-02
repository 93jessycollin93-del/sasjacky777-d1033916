// Streaming chat via Together AI (freemium; OpenAI-compatible).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "TOGETHER_API_KEY";

serve(openAiCompatHandler({
  fn: "jackie-together",
  secret: SECRET,
  url: "https://api.together.xyz/v1/chat/completions",
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  models: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "deepseek-ai/DeepSeek-R1",
    "deepseek-ai/DeepSeek-V3",
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "mistralai/Mixtral-8x22B-Instruct-v0.1",
  ],
  keyHelp: "Get a key at https://api.together.xyz/settings/api-keys",
}));
