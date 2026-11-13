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
import { createAdminClient } from "@/lib/supabase/admin";
import type { DottyChat, DottySlackAdapter, ThreadState } from "./bot";
import { ACTION } from "./cards";
import { runChannelTurn } from "./channel-turn";
import { findLink, saveLink, type ChannelLink, type ChannelProvider } from "./links";

/**
 * What Dotty does on Telegram and Slack:
 *   /start <code>  (Telegram) links this chat to the workspace whose settings made the code
 *   any message    goes to the Head, or to "@Bot name …"
 *   card buttons   approve / reject / answer / skip / give access / hand over — through the same
 *                  decide code as the web, after checking the person is the linked account.
 * Only linked people are listened to (Slack: only the person who installed Dotty).
 */

const PRIVATE_NOTE =
  "Hi! I'm Dotty — this bot is private. To use it, open Dotty → Settings → Channels and press “Connect Telegram”.";

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
    await event.channel.post(link ? "You're linked. Send me anything — it goes to your Head bot. Type /help for more." : PRIVATE_NOTE);
    return;
  }

  const { data: row } = await db
    .from("telegram_link_codes")
    .select("code, user_id, workspace_id, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!row?.workspace_id || new Date(row.expires_at).getTime() < Date.now()) {
    await event.channel.post("That link has expired. Open Dotty → Settings → Channels and press “Connect Telegram” again.");
    return;
  }
  // The code belongs to the workspace's owner; make sure it still does.
  const { data: workspace } = await db.from("workspaces").select("id, name, owner_id").eq("id", row.workspace_id).maybeSingle();
  if (!workspace || workspace.owner_id !== row.user_id) {
    await event.channel.post("That link isn't valid any more. Create a new one in Dotty → Settings → Channels.");
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
    markdown: `✅ Linked to **${workspace.name}**.\n\nSend me anything and ${headBot?.name ?? "your Head bot"} will take it from there. Start a message with @ and a bot's name to talk to that bot. Approvals and questions will show up here with buttons. /help lists your bots.`,
  });
}

async function help(event: SlashCommandEvent) {
  const link = await linkOf(event.adapter, event.user.userId);
  if (!link) return void (await event.channel.post(PRIVATE_NOTE));
  const { data: bots } = await createAdminClient().from("bots").select("name, role").eq("workspace_id", link.workspaceId).order("created_at");
  const list = (bots ?? []).map((b) => `• ${b.name}${b.role === "head" ? " (Head — gets your messages by default)" : b.role === "lead" ? " (Lead)" : ""}`).join("\n");
  await event.channel.post({ markdown: `Send a message to the Head bot, or start with @ and a name:\n\n${list}\n\nExample: @${bots?.find((b) => b.role !== "head")?.name ?? "Inbox Zero"} summarise my unread email` });
}

// ─── Messages ─────────────────────────────────────────────────────────────────────────────────

async function onMessage(thread: Thread<ThreadState>, message: Message) {
  const provider = providerOf(thread.adapter);
  if (!provider || message.author.isMe || message.author.isBot === true) return;
  const link = await linkOf(thread.adapter, message.author.userId);
  if (!link) {
    await thread.post(provider === "telegram" ? PRIVATE_NOTE : "Only the person who added Dotty to this Slack workspace can use it.");
    return;
  }
  const text = (message.text ?? "").trim();
  if (!text) return void (await thread.post("I can only read text for now."));

  // After "Answer" on a question card, the next message is the answer.
  const state = await thread.state;
  if (state?.answering) {
    await thread.setState({}, { replace: true });
    const res = await answerQuestionCore(contextFor(link), state.answering, text);
    await thread.post(res.ok ? "👍 Sent — the bot carries on with your answer." : `Couldn't send that: ${res.error}`);
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
  if (!link) return void (await reply("Only the linked account can decide this."));
  const ctx = contextFor(link);

  let res: DecideResult;
  switch (event.actionId) {
    case ACTION.approve:
      res = await decideApprovalCore(ctx, itemId, "approve");
      return void (await reply(res.ok ? `✅ ${res.message ?? "Approved — the bot will go ahead."}` : `Couldn't approve: ${res.error}`));
    case ACTION.reject:
      res = await decideApprovalCore(ctx, itemId, "reject");
      return void (await reply(res.ok ? "🚫 Rejected — nothing was done." : `Couldn't reject: ${res.error}`));
    case ACTION.skip:
      res = await skipQuestionCore(ctx, itemId);
      return void (await reply(res.ok ? "Skipped — the bot will use its best judgement." : `Couldn't skip: ${res.error}`));
    case ACTION.answer: {
      if (!event.thread) return;
      await (event.thread as Thread<ThreadState>).setState({ answering: itemId });
      return void (await reply("✍️ Send your answer as your next message."));
    }
    case ACTION.give:
      res = await grantAppAccessCore(ctx, itemId);
      return void (await reply(res.ok ? `🔑 ${res.message ?? "Access given."}` : `Couldn't give access: ${res.error}`));
    case ACTION.decline:
      res = await declineAppAccessCore(ctx, itemId);
      return void (await reply(res.ok ? "OK — the bot will do without it." : `Couldn't do that: ${res.error}`));
    default: {
      const n = Number(event.actionId.slice(1));
      const { data: item } = await ctx.db.from("inbox_items").select("preview").eq("id", itemId).eq("workspace_id", ctx.workspaceId).maybeSingle();
      const holder = (item?.preview as AccessPreview | undefined)?.holders?.[n];
      if (!holder) return void (await reply("That bot isn't available any more."));
      res = await handOffForAppCore(ctx, itemId, holder.id);
      return void (await reply(res.ok ? `➡️ ${res.message ?? `Handed to ${holder.name}.`}` : `Couldn't hand it over: ${res.error}`));
    }
  }
}
