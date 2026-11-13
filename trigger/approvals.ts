import { wait } from "@trigger.dev/sdk";
import { buildPreview } from "@/lib/approvals/describe";
import { notifyInboxItem } from "@/lib/chat/notify";
import type { AccessPreview } from "@/lib/integrations/app-access";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/integrations/composio";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Waiting on me": a run pauses on a Trigger.dev waitpoint token until the user decides (web
 * server action → `wait.completeToken`). The database row is the source of truth for the
 * decision — the token only wakes the run — so a run acts only on an item marked `approved`.
 */

type Db = ReturnType<typeof createAdminClient>;

export interface PauseContext {
  db: Db;
  workspaceId: string;
  botId: string;
  taskId: string;
  taskTitle: string;
  /** Our `runs.id`. */
  runId: string;
}

/** How long an item waits before it expires (plan A5: 72 hours). */
const TIMEOUT = "72h";

async function pauseFor(ctx: PauseContext, item: Record<string, unknown>, waitingText: string) {
  const { db } = ctx;
  // Token first, so the item is never visible without a way to wake the run.
  const token = await wait.createToken({ timeout: TIMEOUT, tags: [`workspace:${ctx.workspaceId}`, `task:${ctx.taskId}`] });
  const { data: row, error } = await db
    .from("inbox_items")
    .insert({ workspace_id: ctx.workspaceId, bot_id: ctx.botId, task_id: ctx.taskId, run_id: ctx.runId, waitpoint_token_id: token.id, ...item })
    .select("id")
    .single();
  if (error || !row) throw new Error(`Couldn't create the inbox item: ${error?.message}`);

  await Promise.all([
    db.from("tasks").update({ status: "waiting_on_me" }).eq("id", ctx.taskId),
    db.from("runs").update({ status: "waiting" }).eq("id", ctx.runId),
    db.from("bots").update({ status: "waiting", status_detail: waitingText.slice(0, 280), last_active_at: new Date().toISOString() }).eq("id", ctx.botId),
    activity(ctx, "inbox_requested", waitingText),
    // Also on Telegram / Slack when linked (best effort — the web card is the source of truth).
    notifyInboxItem(row.id),
  ]);

  const result = await wait.forToken<{ status: string }>(token);

  await Promise.all([
    db.from("tasks").update({ status: "doing" }).eq("id", ctx.taskId),
    db.from("runs").update({ status: "running" }).eq("id", ctx.runId),
    db.from("bots").update({ status: "working", status_detail: `Working on “${ctx.taskTitle}”`, last_active_at: new Date().toISOString() }).eq("id", ctx.botId),
  ]);

  if (!result.ok) {
    // Timed out: expire it (unless the user decided at the last second).
    await db.from("inbox_items").update({ status: "expired" }).eq("id", row.id).eq("status", "pending");
  }
  const { data: decided } = await db
    .from("inbox_items")
    .select("status, input, edited_payload, answer")
    .eq("id", row.id)
    .single();
  return decided as { status: string; input: Record<string, unknown> | null; edited_payload: Record<string, unknown> | null; answer: string | null };
}

/** Gate handler for background runs: ask the user, wait, then run only what they approved. */
export async function waitForApproval(ctx: PauseContext, request: ApprovalRequest): Promise<ApprovalDecision> {
  const { title, action, preview } = buildPreview(request.calls, request.reasons, request.pr, request.sources);
  const decided = await pauseFor(
    ctx,
    { kind: "approval", action, tool_key: request.tool.slice(0, 120), title, preview, input: request.args },
    `Waiting for your OK: ${title}`,
  );

  if (decided.status === "approved") {
    await activity(ctx, "inbox_approved", `got your approval for “${title}”`);
    return { approved: true, args: decided.edited_payload ?? decided.input ?? request.args };
  }
  if (decided.status === "expired") {
    await activity(ctx, "inbox_expired", `didn't get an answer about “${title}” in time`);
    return { approved: false, reason: "The user didn't answer within 72 hours, so this was NOT done. Don't retry it; say so in your report." };
  }
  await activity(ctx, "inbox_rejected", `was told not to do “${title}”`);
  const note = decided.answer ? ` Their note: “${decided.answer}”.` : "";
  return { approved: false, reason: `The user rejected this action, so it was NOT done. Don't try again or work around it; mention it in your report.${note}` };
}

/** `ask_user` for background runs: post a question to Waiting on me and wait for the answer. */
export async function askUser(ctx: PauseContext, question: string, context?: string) {
  const decided = await pauseFor(
    ctx,
    { kind: "question", title: question.slice(0, 200), preview: { text: context?.slice(0, 1000) ?? "" } },
    `Has a question: ${question}`,
  );
  if (decided.status === "answered" && decided.answer) {
    await activity(ctx, "inbox_answered", `got your answer to “${question.slice(0, 120)}”`);
    return { answered: true, answer: decided.answer };
  }
  return {
    answered: false,
    note: decided.status === "expired" ? "No answer within 72 hours. Use your best judgement or stop and explain." : "The user skipped the question. Use your best judgement or stop and explain.",
  };
}

/** How the user answered an access card. */
export type AccessDecision =
  | { granted: true }
  | { handoff: { botId: string; botName: string } }
  | { declined: true; note: string };

/**
 * `request_app_access` for background runs: put an access card on Waiting on me and wait. The
 * user gives access (the bot's app list changes), hands the task to a bot that has the app, or
 * says no. The run never changes access itself.
 */
export async function requestAppAccess(ctx: PauseContext, title: string, preview: AccessPreview): Promise<AccessDecision> {
  const decided = await pauseFor(
    ctx,
    { kind: "access", tool_key: preview.app, title, preview },
    `Needs ${preview.appName}: ${preview.why}`,
  );
  if (decided.status === "approved") {
    await activity(ctx, "inbox_approved", `got access to ${preview.appName}`);
    return { granted: true };
  }
  const handoff = decided.edited_payload?.handoff as { botId?: unknown; botName?: unknown } | undefined;
  if (decided.status === "answered" && typeof handoff?.botId === "string") {
    return { handoff: { botId: handoff.botId, botName: String(handoff.botName ?? "another bot") } };
  }
  if (decided.status === "expired") {
    await activity(ctx, "inbox_expired", `didn't get access to ${preview.appName} in time`);
    return { declined: true, note: `No answer within 72 hours, so you still can't use ${preview.appName}. Do what you can without it and say what's missing in your report.` };
  }
  await activity(ctx, "inbox_rejected", `wasn't given access to ${preview.appName}`);
  return { declined: true, note: `The user didn't give you ${preview.appName}. Do what you can without it, don't ask again, and say what's missing in your report.` };
}

function activity(ctx: PauseContext, type: string, summary: string) {
  return ctx.db.from("activity").insert({ workspace_id: ctx.workspaceId, bot_id: ctx.botId, task_id: ctx.taskId, type, summary: summary.slice(0, 500) });
}
