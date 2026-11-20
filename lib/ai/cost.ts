import type { StepResult, ToolSet } from "ai";

// Fallback prices (USD per 1M tokens). Override them in the deployment if DeepSeek changes
// pricing. The caps remain conservative even when the provider does not return a cost.
const FALLBACK = {
  "deepseek-chat": {
    input: Number(process.env.DEEPSEEK_CHAT_INPUT_PER_MTOK ?? 0.28),
    output: Number(process.env.DEEPSEEK_CHAT_OUTPUT_PER_MTOK ?? 0.42),
  },
  "deepseek-reasoner": {
    input: Number(process.env.DEEPSEEK_REASONER_INPUT_PER_MTOK ?? 0.55),
    output: Number(process.env.DEEPSEEK_REASONER_OUTPUT_PER_MTOK ?? 2.19),
  },
};

export function stepCostCents(step: StepResult<ToolSet>, model: string) {
  const provider = step.providerMetadata?.deepseek as { cost?: string | number } | undefined;
  const reported = provider?.cost !== undefined ? Number(provider.cost) : NaN;
  if (Number.isFinite(reported)) return reported * 100;

  const price = FALLBACK[model as keyof typeof FALLBACK] ?? FALLBACK["deepseek-chat"];
  return (
    (((step.usage.inputTokens ?? 0) * price.input +
      (step.usage.outputTokens ?? 0) * price.output) /
      1_000_000) *
    100
  );
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
