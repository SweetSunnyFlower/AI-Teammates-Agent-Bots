/** Bot model setting (stored in `bots.model`) → Vercel AI Gateway model id. */
const GATEWAY_MODELS: Record<string, string> = {
  "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
  "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
  "claude-opus-5-5": "anthropic/claude-opus-5.5",
};

export function gatewayModelFor(model: string | null | undefined) {
  return GATEWAY_MODELS[model ?? ""] ?? GATEWAY_MODELS["claude-sonnet-5-5"];
}

export const hasAiGateway = () => Boolean(process.env.AI_GATEWAY_API_KEY);
