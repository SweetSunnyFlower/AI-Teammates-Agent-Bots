import { createDeepSeek } from "@ai-sdk/deepseek";

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
});

/** Stored bot setting → DeepSeek model id. */
const MODELS: Record<string, string> = {
  "deepseek-chat": "deepseek-chat",
  "deepseek-reasoner": "deepseek-reasoner",
};

export function deepSeekModelFor(model: string | null | undefined) {
  return deepseek(MODELS[model ?? ""] ?? MODELS["deepseek-chat"]);
}

export const hasDeepSeek = () => Boolean(process.env.DEEPSEEK_API_KEY);
