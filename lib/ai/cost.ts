import type { StepResult, ToolSet } from "ai";

// Fallback price estimates (USD per 1M tokens) used only when AI Gateway doesn't report a cost.
// Verify against your AI Gateway dashboard and adjust.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-5.5": { input: 3, output: 15 },
  "anthropic/claude-haiku-5.5": { input: 1, output: 5 },
  "anthropic/claude-opus-5.5": { input: 5, output: 25 },
};

/** Cost of one step in cents: AI Gateway's reported cost when present, else a token estimate. */
export function stepCostCents(step: StepResult<ToolSet>, model: string) {
  const gateway = step.providerMetadata?.gateway as
    | { cost?: string | number }
    | undefined;
  const reported = gateway?.cost !== undefined ? Number(gateway.cost) : NaN;
  if (Number.isFinite(reported)) return reported * 100;
  const price =
    PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK["anthropic/claude-sonnet-5.5"];
  return (
    (((step.usage.inputTokens ?? 0) * price.input +
      (step.usage.outputTokens ?? 0) * price.output) /
      1_000_000) *
    100
  );
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;
