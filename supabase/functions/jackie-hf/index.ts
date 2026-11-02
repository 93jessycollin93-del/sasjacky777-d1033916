// Streaming chat via Hugging Face Inference Router (OpenAI-compatible).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { openAiCompatHandler } from "../_shared/openaiCompat.ts";

// The models this function will send upstream, and the secret it reads.
// Everything else — config check before quota, message validation, the
// persona, error handling — is shared, in _shared/openaiCompat.ts.
const SECRET = "HF_TOKEN";

serve(openAiCompatHandler({
  fn: "jackie-hf",
  secret: SECRET,
  url: "https://router.huggingface.co/v1/chat/completions",
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  models: [
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Meta-Llama-3.1-8B-Instruct",
    "Qwen/Qwen2.5-72B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
  ],
  keyHelp: "Create one at https://huggingface.co/settings/tokens",
}));
