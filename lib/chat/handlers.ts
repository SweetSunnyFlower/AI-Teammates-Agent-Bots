import type { ActionEvent, Adapter, Message, SlashCommandEvent, Thread } from "chat";
import {
  answerQuestionCore,
  declineAppAccessCore,
  decideApprovalCore,
  grantAppAccessCore,
  handOffForAppCore,
  skipQuestionCore,
  type DecideContext,
  type DecideResult,
} from "@/lib/inbox/decide";
import type { AccessPreview } from "@/lib/integrations/app-access";
import { createAdminClient } from "@/lib/db/admin";
import type { DottyChat, DottySlackAdapter, ThreadState } from "./bot";
import { ACTION } from "./cards";
import { runChannelTurn } from "./channel-turn";
import { findLink, rememberThread, saveLink, type ChannelLink, type ChannelProvider } from "./links";

/**
 * What Dotty does on Telegram and Slack:
 *   /start <code>  (Telegram) links this chat to the workspace whose settings made the code
 *   any message    goes to the Head, or to "@Bot name …"
 *   card buttons   approve / reject / answer / skip / give access / hand over — through the same
 *                  decide code as the web, after checking the person is the linked account.
 * Only linked people are listened to (Slack: only the person who installed Dotty).
 */

const PRIVATE_NOTE =
  "你好，我是 Dotty。这个 Bot 仅限私有使用。请打开 Dotty →“设置”→“渠道”，点击“连接 Telegram”。";

const providerOf = (adapter: Adapter): ChannelProvider | null =>
  adapter.name === "telegram" ? "telegram" : adapter.name === "slack" ? "slack" : null;

const slackTeamOf = (adapter: Adapter) => (adapter.name === "slack" ? (adapter as DottySlackAdapter).currentInstallationId() : undefined);

async function linkOf(adapter: Adapter, userId: string): Promise<ChannelLink | null> {
  const provider = providerOf(adapter);
  if (!provider) return null;
  return findLink(createAdminClient(), provider, userId, slackTeamOf(adapter));
}

export function registerHandlers(bot: DottyChat) {
  bot.onSlashCommand("/start", (event) => linkTelegram(event));
  bot.onSlashCommand("/help", (event) => help(event));
  bot.onDirectMessage((thread, message) => onMessage(thread, message));
  // Slack channels: "@Dotty …" (only from the person who installed it).
  bot.onNewMention((thread, message) => onMessage(thread, message));
  bot.onAction(
    [ACTION.approve, ACTION.reject, ACTION.answer, ACTION.skip, ACTION.give, ACTION.decline, ACTION.handTo(0), ACTION.handTo(1), ACTION.handTo(2)],
    (event) => onAction(event),
  );
}

// ─── Linking (Telegram) ───────────────────────────────────────────────────────────────────────

async function linkTelegram(event: SlashCommandEvent) {
  if (event.adapter.name !== "telegram") return;
  const code = event.text.trim();
  const db = createAdminClient();
  if (!code) {
    const link = await findLink(db, "telegram", event.user.userId);
    await event.channel.post(link ? "关联成功。直接发消息即可，内容会交给总控 Bot。输入 /help 查看帮助。" : PRIVATE_NOTE);
    return;
  }

  const { data: row } = await db
    .from("telegram_link_codes")
    .select("code, user_id, workspace_id, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!row?.workspace_id || new Date(row.expires_at).getTime() < Date.now()) {
    await event.channel.post("这个关联链接已过期。请打开 Dotty →“设置”→“渠道”，重新点击“连接 Telegram”。");
    return;
  }
  // The code belongs to the workspace's owner; make sure it still does.
  const { data: workspace } = await db.from("workspaces").select("id, name, owner_id").eq("id", row.workspace_id).maybeSingle();
  if (!workspace || workspace.owner_id !== row.user_id) {
    await event.channel.post("这个关联链接已失效，请在 Dotty →“设置”→“渠道”中重新创建。");
    return;
  }

  await saveLink(db, {
    workspaceId: workspace.id,
    provider: "telegram",
    externalId: event.user.userId,
    meta: { channel_id: event.channel.id, username: event.user.userName || event.user.fullName },
  });
  await db.from("telegram_link_codes").delete().eq("code", code);
  const { data: headBot } = await db.from("bots").select("name").eq("workspace_id", workspace.id).eq("role", "head").maybeSingle();
  await event.channel.post({
    markdown: `✅ 已关联到 **${workspace.name}**。\n\n直接发消息即可，${headBot?.name ?? "总控 Bot"} 会接手处理。消息以 @ 加 Bot 名称开头时，可以直接联系指定 Bot。审批和问题会以按钮形式出现在这里。输入 /help 查看 Bot 列表。`,
  });
}

async function help(event: SlashCommandEvent) {
  const link = await linkOf(event.adapter, event.user.userId);
  if (!link) return void (await event.channel.post(PRIVATE_NOTE));
  const { data: bots } = await createAdminClient().from("bots").select("name, role").eq("workspace_id", link.workspaceId).order("created_at");
  const list = (bots ?? []).map((b: any) => `• ${b.name}${b.role === "head" ? "（总控 Bot，默认接收你的消息）" : b.role === "lead" ? "（主管 Bot）" : ""}`).join("\n");
  await event.channel.post({ markdown: `直接发消息给总控 Bot，或以 @ 加 Bot 名称开头：\n\n${list}\n\n示例：@${bots?.find((b: any) => b.role !== "head")?.name ?? "收件箱助手"} 总结我的未读邮件` });
}

// ─── Messages ─────────────────────────────────────────────────────────────────────────────────

async function onMessage(thread: Thread<ThreadState>, message: Message) {
  const provider = providerOf(thread.adapter);
  if (!provider || message.author.isMe || message.author.isBot === true) return;
  const link = await linkOf(thread.adapter, message.author.userId);
  if (!link) {
    await thread.post(provider === "telegram" ? PRIVATE_NOTE : "只有将 Dotty 添加到这个 Slack 工作区的用户可以与其交互。");
    return;
  }
  if (provider === "slack") await rememberThread(createAdminClient(), link, thread.id).catch(() => {});

  const text = (message.text ?? "").trim();
  if (!text) return void (await thread.post("目前只支持文字消息。"));

  // After "Answer" on a question card, the next message is the answer.
  const state = await thread.state;
  if (state?.answering) {
    await thread.setState({}, { replace: true });
    const res = await answerQuestionCore(contextFor(link), state.answering, text);
    await thread.post(res.ok ? "👍 已发送，Bot 会带着你的答复继续处理。" : `发送失败：${res.error}`);
    return;
  }

  await thread.startTyping().catch(() => {});
  const { botName, isHead, reply } = await runChannelTurn({ workspaceId: link.workspaceId, text, via: provider });
  await thread.post({ markdown: isHead ? reply : `**${botName}:** ${reply}` });
}

// ─── Card buttons ─────────────────────────────────────────────────────────────────────────────

const contextFor = (link: ChannelLink): DecideContext => ({ db: createAdminClient(), workspaceId: link.workspaceId, via: link.provider });

async function onAction(event: ActionEvent) {
  const itemId = event.value ?? "";
  const reply = (text: string) => (event.thread ? event.thread.post(text) : Promise.resolve());
  const link = await linkOf(event.adapter, event.user.userId);
  if (!link) return void (await reply("只有已关联的账户才能处理这个事项。"));
  const ctx = contextFor(link);

  let res: DecideResult;
  switch (event.actionId) {
    case ACTION.approve:
      res = await decideApprovalCore(ctx, itemId, "approve");
      return void (await reply(res.ok ? `✅ ${res.message ?? "已批准，Bot 将继续执行。"}` : `批准失败：${res.error}`));
    case ACTION.reject:
      res = await decideApprovalCore(ctx, itemId, "reject");
      return void (await reply(res.ok ? "🚫 已拒绝，没有执行任何操作。" : `拒绝失败：${res.error}`));
    case ACTION.skip:
      res = await skipQuestionCore(ctx, itemId);
      return void (await reply(res.ok ? "已跳过，Bot 会自行判断。" : `跳过失败：${res.error}`));
    case ACTION.answer: {
      if (!event.thread) return;
      await (event.thread as Thread<ThreadState>).setState({ answering: itemId });
      return void (await reply("✍️ 请在下一条消息中发送你的答复。"));
    }
    case ACTION.give:
      res = await grantAppAccessCore(ctx, itemId);
      return void (await reply(res.ok ? `🔑 ${res.message ?? "权限已授予。"}` : `授权失败：${res.error}`));
    case ACTION.decline:
      res = await declineAppAccessCore(ctx, itemId);
      return void (await reply(res.ok ? "好的，Bot 会在没有该权限的情况下继续。" : `操作失败：${res.error}`));
    default: {
      const n = Number(event.actionId.slice(1));
      const { data: item } = await ctx.db.from("inbox_items").select("preview").eq("id", itemId).eq("workspace_id", ctx.workspaceId).maybeSingle();
      const holder = (item?.preview as AccessPreview | undefined)?.holders?.[n];
      if (!holder) return void (await reply("这个 Bot 已不可用。"));
      res = await handOffForAppCore(ctx, itemId, holder.id);
      return void (await reply(res.ok ? `➡️ ${res.message ?? `已交给 ${holder.name}。`}` : `移交失败：${res.error}`));
    }
  }
}
