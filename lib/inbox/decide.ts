import { z } from "zod";
import { applyEdits, isEditableAction } from "@/lib/approvals/describe";
import { hasApp, type AccessPreview } from "@/lib/integrations/app-access";
import { connectedToolkits, GITHUB, hasComposio } from "@/lib/integrations/composio";
import { startTaskRun } from "@/lib/runs/start";
import type { RoutineProposalInput } from "@/lib/routines/propose";
import { createRoutine } from "@/lib/routines/store";
import type { createAdminClient } from "@/lib/db/admin";

/**
 * Deciding "Waiting on me" items — the one implementation behind the web buttons and the Telegram
 * / Slack buttons. SERVER ONLY. Callers must have verified that the person deciding owns
 * `workspaceId` (web: the signed-in user's workspace; chat: the linked Telegram / Slack account).
 * Everything here uses the trusted runtime database client and is explicitly scoped to that
 * workspace.
 *
 * A decision is written only from `pending`. The paused worker polls the row and resumes after the
 * status changes, so the database decision is what counts.
 */

type Db = ReturnType<typeof createAdminClient>;
export type Via = "web" | "telegram" | "slack";
export type DecideResult = { ok: true; message?: string } | { ok: false; error: string };
export interface DecideContext {
  db: Db;
  workspaceId: string;
  via: Via;
}

const uuid = z.string().uuid();
const EXPIRY_MS = 72 * 60 * 60 * 1000;
const editsSchema = z.array(z.record(z.string(), z.string().max(20000))).max(20);
const REOPEN = { status: "pending", edited_payload: null, answer: null, decided_via: null, decided_at: null };

type Kind = "approval" | "question" | "access";

export async function pendingItem(ctx: DecideContext, itemId: string, kind: Kind) {
  if (!uuid.safeParse(itemId).success) return { error: "事项不存在。" } as const;
  const { data: item } = await ctx.db
    .from("inbox_items")
    .select("id, workspace_id, bot_id, task_id, kind, action, status, title, input, preview, tool_key, waitpoint_token_id, created_at")
    .eq("id", itemId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!item) return { error: "事项不存在，或者你没有访问权限。" } as const;
  if (item.kind !== kind) return { error: "事项类型不匹配，请刷新页面。" } as const;
  if (item.status !== "pending") return { error: "这个事项已经处理过了。" } as const;
  if (Date.now() - new Date(item.created_at).getTime() > EXPIRY_MS) return { error: "这个事项已过期，Bot 已经继续执行。" } as const;
  return { item } as const;
}

/** Write the decision only while the item is still pending; the paused worker observes it by polling. */
async function decide(ctx: DecideContext, itemId: string, _tokenId: string | null, update: Record<string, unknown>): Promise<DecideResult> {
  const { data: updated, error } = await ctx.db
    .from("inbox_items")
    .update({ ...update, decided_via: ctx.via, decided_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("workspace_id", ctx.workspaceId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: friendly(error.message) };
  if (!updated?.length) return { ok: false, error: "这个事项已经处理过了。" };

  return { ok: true };
}

const reopen = (ctx: DecideContext, itemId: string) => ctx.db.from("inbox_items").update(REOPEN).eq("id", itemId);

/** Approve (optionally with text edits to the arguments) or reject an action a bot wants to take. */
export async function decideApprovalCore(
  ctx: DecideContext,
  itemId: string,
  decision: "approve" | "reject",
  options: { edits?: Array<Record<string, string>>; note?: string } = {},
): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "approval");
  if ("error" in found) return { ok: false, error: found.error! };
  const { item } = found;

  if (decision === "reject") {
    const note = options.note?.trim().slice(0, 4000) || null;
    return decide(ctx, item.id, item.waitpoint_token_id, { status: "rejected", answer: note });
  }

  let edited: Record<string, unknown> | null = null;
  // A merge is exactly the pull request shown — never edited.
  if (options.edits?.length && isEditableAction(item.action)) {
    const edits = editsSchema.safeParse(options.edits);
    if (!edits.success) return { ok: false, error: "修改内容无效。" };
    const input = (item.input ?? {}) as Record<string, unknown>;
    const next = applyEdits(input, edits.data);
    if (JSON.stringify(next) !== JSON.stringify(input)) edited = next;
  }
  if (item.action === "create_routine") return approveRoutine(ctx, item, (edited ?? item.input) as RoutineProposalInput, edited);
  return decide(ctx, item.id, item.waitpoint_token_id, { status: "approved", edited_payload: edited });
}

/**
 * Approving the Head's routine proposal creates the routine (with the user's edits). The item is
 * claimed first so a double click can't create two; if the routine can't be saved, it goes back
 * to pending with the reason.
 */
async function approveRoutine(
  ctx: DecideContext,
  item: { id: string; waitpoint_token_id: string | null },
  proposal: RoutineProposalInput,
  edited: Record<string, unknown> | null,
): Promise<DecideResult> {
  const { data: bot } = await ctx.db
    .from("bots")
    .select("id")
    .eq("workspace_id", ctx.workspaceId)
    .ilike("name", String(proposal.bot ?? "").replace(/[%_\\]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  if (!bot) return { ok: false, error: `找不到名为“${proposal.bot}”的 Bot，请修改 Bot 名称。` };

  const claimed = await decide(ctx, item.id, item.waitpoint_token_id, { status: "approved", edited_payload: edited });
  if (!claimed.ok) return claimed;
  const saved = await createRoutine(ctx.db, ctx.workspaceId, {
    name: String(proposal.name ?? ""),
    botId: bot.id,
    cron: String(proposal.cron ?? ""),
    timezone: String(proposal.timezone ?? "UTC"),
    prompt: String(proposal.prompt ?? ""),
    enabled: true,
  });
  if (!saved.ok) {
    await reopen(ctx, item.id);
    return { ok: false, error: "创建例行任务失败，请检查名称、时间和 Bot 设置。" };
  }
  return { ok: true, message: `例行任务“${proposal.name}”已创建。` };
}

/** Answer a bot's question; the paused run continues with the answer. */
export async function answerQuestionCore(ctx: DecideContext, itemId: string, answer: string): Promise<DecideResult> {
  const text = answer.trim();
  if (!text || text.length > 4000) return { ok: false, error: "请输入答复，最多 4,000 个字符。" };
  const found = await pendingItem(ctx, itemId, "question");
  if ("error" in found) return { ok: false, error: found.error! };
  return decide(ctx, found.item.id, found.item.waitpoint_token_id, { status: "answered", answer: text });
}

/** Skip a question: the bot continues on its own judgement. */
export async function skipQuestionCore(ctx: DecideContext, itemId: string): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "question");
  if ("error" in found) return { ok: false, error: found.error! };
  return decide(ctx, found.item.id, found.item.waitpoint_token_id, { status: "rejected" });
}

// ─── App access ("<bot> needs <app>") ───────────────────────────────────────────────────────────
// Only these change which apps a bot can use; the bot itself can only ask.

/** Give the bot the app it asked for. The app must be connected to the workspace by now. */
export async function grantAppAccessCore(ctx: DecideContext, itemId: string): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "access");
  if ("error" in found) return { ok: false, error: found.error! };
  const { item } = found;
  const preview = item.preview as AccessPreview;
  const slug = String(item.tool_key ?? preview.app ?? "");
  if (!item.bot_id) return { ok: false, error: "这个 Bot 已不存在。" };
  if (slug !== GITHUB.slug && !hasComposio()) return { ok: false, error: "Composio 尚未配置，请在 .env.local 中添加 COMPOSIO_API_KEY。" };

  const connected = (await connectedToolkits(ctx.workspaceId)).some((a) => a.slug === slug);
  if (!connected) return { ok: false, error: `请先连接 ${preview.appName}，然后再授予权限。` };

  const { data: bot } = await ctx.db.from("bots").select("id, name, app_keys").eq("id", item.bot_id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!bot) return { ok: false, error: "这个 Bot 已不存在。" };
  const keys = (bot.app_keys ?? []) as string[];
  if (!hasApp(keys, slug)) {
    const { error } = await ctx.db.from("bots").update({ app_keys: [...keys, slug] }).eq("id", bot.id);
    if (error) return { ok: false, error: friendly(error.message) };
  }
  const done = await decide(ctx, item.id, item.waitpoint_token_id, { status: "approved" });
  return done.ok ? { ok: true, message: `${bot.name} 现在可以使用 ${preview.appName}。` } : done;
}

/**
 * Hand the work to a bot that already has the app. A paused background run passes its task over
 * itself; a request from chat becomes a new task for that bot.
 */
export async function handOffForAppCore(ctx: DecideContext, itemId: string, botId: string): Promise<DecideResult> {
  if (!uuid.safeParse(botId).success) return { ok: false, error: "请选择 Bot。" };
  const found = await pendingItem(ctx, itemId, "access");
  if ("error" in found) return { ok: false, error: found.error! };
  const { item } = found;
  const preview = item.preview as AccessPreview;
  const slug = String(item.tool_key ?? preview.app ?? "");

  const { data: target } = await ctx.db
    .from("bots")
    .select("id, name, app_keys")
    .eq("id", botId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (!target || target.id === item.bot_id) return { ok: false, error: "请选择这个工作空间里的另一个 Bot。" };
  if (!hasApp((target.app_keys ?? []) as string[], slug)) return { ok: false, error: `${target.name} 也没有 ${preview.appName} 的访问权限。` };

  const handoff = { botId: target.id, botName: target.name };
  const message = `已交给 ${target.name}。`;
  if (item.waitpoint_token_id) {
    const done = await decide(ctx, item.id, item.waitpoint_token_id, { status: "answered", edited_payload: { handoff } });
    return done.ok ? { ok: true, message } : done;
  }

  // From chat: claim the item first (so a double click can't create two tasks), then add the task.
  const claimed = await decide(ctx, item.id, null, { status: "answered", edited_payload: { handoff } });
  if (!claimed.ok) return claimed;
  const { data: requester } = item.bot_id ? await ctx.db.from("bots").select("name").eq("id", item.bot_id).maybeSingle() : { data: null };
  const { data: task, error } = await ctx.db
    .from("tasks")
    .insert({
      workspace_id: ctx.workspaceId,
      title: preview.why.trim().slice(0, 200) || `使用 ${preview.appName}`,
      body: `${requester?.name ?? "某个 Bot"} 需要使用 ${preview.appName}，这项任务已交给你指定的 ${target.name}。`,
      status: "backlog",
      assignee_bot_id: target.id,
      created_by_bot_id: item.bot_id,
      source: ctx.via,
    })
    .select("id")
    .single();
  if (error || !task) {
    await reopen(ctx, item.id);
    return { ok: false, error: friendly(error?.message ?? "创建任务失败。") };
  }
  try {
    await startTaskRun({ id: task.id, workspaceId: ctx.workspaceId, assigneeBotId: target.id });
  } catch {
    // The task is on the board; Retry (or the safety sweep) starts it.
  }
  return { ok: true, message };
}

/** Say no: the bot carries on without the app. */
export async function declineAppAccessCore(ctx: DecideContext, itemId: string): Promise<DecideResult> {
  const found = await pendingItem(ctx, itemId, "access");
  if ("error" in found) return { ok: false, error: found.error! };
  return decide(ctx, found.item.id, found.item.waitpoint_token_id, { status: "rejected" });
}

function friendly(message: string) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "无法连接数据库，请检查网络后重试。";
  return message;
}
