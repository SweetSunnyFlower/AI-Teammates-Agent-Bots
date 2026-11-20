import type { PrPreview } from "./describe";

/** One concrete action inside an approval, including a batched app call. */
export interface GatedCall {
  tool: string;
  args: Record<string, unknown>;
}

/** What the user is asked to approve. */
export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  calls: GatedCall[];
  /** Human-readable reasons from the provider, if any. */
  reasons: string[];
  /** Merge approvals: the pull request being merged. */
  pr?: PrPreview;
}

export type ApprovalDecision =
  | { approved: true; args: Record<string, unknown> }
  | { approved: false; reason: string };

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;
