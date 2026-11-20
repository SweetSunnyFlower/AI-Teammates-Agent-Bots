import { wait } from "@/lib/jobs/wait";
import { buildPreview } from "@/lib/approvals/describe";
import { notifyInboxItem } from "@/lib/chat/notify";
import type { AccessPreview } from "@/lib/integrations/app-access";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/integrations/composio";
import type { createAdminClient } from "@/lib/db/admin";

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
  if (error || !row) throw new Error("创建待处理事项失败。");

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
    db.from("bots").update({ status: "working", status_detail: `正在处理“${ctx.taskTitle}”`, last_active_at: new Date().toISOString() }).eq("id", ctx.botId),
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
  const { title, action, preview } = buildPreview(request.calls, request.reasons, request.pr);
  const decided = await pauseFor(
    ctx,
    { kind: "approval", action, tool_key: request.tool.slice(0, 120), title, preview, input: request.args },
    `等待你批准：${title}`,
  );

  if (decided.status === "approved") {
    await activity(ctx, "inbox_approved", `已获得你对“${title}”的批准`);
    return { approved: true, args: decided.edited_payload ?? decided.input ?? request.args };
  }
  if (decided.status === "expired") {
    await activity(ctx, "inbox_expired", `“${title}”等待超时，未收到你的答复`);
    return { approved: false, reason: "用户在 72 小时内没有答复，因此没有执行这个操作。不要重试，请在报告中说明。" };
  }
  await activity(ctx, "inbox_rejected", `用户拒绝执行“${title}”`);
  const note = decided.answer ? ` 用户备注：“${decided.answer}”。` : "";
  return { approved: false, reason: `用户拒绝了这个操作，因此没有执行。不要重试或绕过，请在报告中说明。${note}` };
}

/** `ask_user` for background runs: post a question to Waiting on me and wait for the answer. */
export async function askUser(ctx: PauseContext, question: string, context?: string) {
  const decided = await pauseFor(
    ctx,
    { kind: "question", title: question.slice(0, 200), preview: { text: context?.slice(0, 1000) ?? "" } },
    `有问题想问你：${question}`,
  );
  if (decided.status === "answered" && decided.answer) {
    await activity(ctx, "inbox_answered", `已收到你对“${question.slice(0, 120)}”的答复`);
    return { answered: true, answer: decided.answer };
  }
  return {
    answered: false,
    note: decided.status === "expired" ? "72 小时内没有收到答复。请自行判断，或者停止并向用户说明原因。" : "用户跳过了这个问题。请自行判断，或者停止并向用户说明原因。",
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
    `需要 ${preview.appName}：${preview.why}`,
  );
  if (decided.status === "approved") {
    await activity(ctx, "inbox_approved", `已获得 ${preview.appName} 的访问权限`);
    return { granted: true };
  }
  const handoff = decided.edited_payload?.handoff as { botId?: unknown; botName?: unknown } | undefined;
  if (decided.status === "answered" && typeof handoff?.botId === "string") {
    return { handoff: { botId: handoff.botId, botName: String(handoff.botName ?? "其他 Bot") } };
  }
  if (decided.status === "expired") {
    await activity(ctx, "inbox_expired", `等待 ${preview.appName} 权限超时`);
    return { declined: true, note: `72 小时内没有获得答复，因此你仍然无法使用 ${preview.appName}。请在没有它的情况下尽量完成，并在报告中说明缺少什么。` };
  }
  await activity(ctx, "inbox_rejected", `用户没有授予 ${preview.appName} 权限`);
  return { declined: true, note: `用户没有授予 ${preview.appName} 权限。请在没有它的情况下尽量完成，不要重复申请，并在报告中说明缺少什么。` };
}

function activity(ctx: PauseContext, type: string, summary: string) {
  return ctx.db.from("activity").insert({ workspace_id: ctx.workspaceId, bot_id: ctx.botId, task_id: ctx.taskId, type, summary: summary.slice(0, 500) });
}
