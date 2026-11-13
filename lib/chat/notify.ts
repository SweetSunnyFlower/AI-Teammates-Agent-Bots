import type { CardElement } from "chat";
import { createAdminClient } from "@/lib/supabase/admin";
import { readyChatBot, slackAdapter } from "./bot";
import { inboxCard, type CardItem } from "./cards";
import { hasSlack, hasTelegram } from "./env";
import { linksForWorkspace, type ChannelLink, type ChannelProvider } from "./links";

/**
 * Pushing things to Telegram / Slack outside a webhook: new "Waiting on me" items and reports on
 * tasks sent from there. Best effort — the web app stays the source of truth, so failures are
 * logged, never thrown.
 */

const configured = () => hasTelegram() || hasSlack();

/** Send a new Waiting on me item, with buttons, to every linked channel of its workspace. */
export async function notifyInboxItem(itemId: string) {
  if (!configured()) return;
  try {
    const db = createAdminClient();
    const { data: item } = await db
      .from("inbox_items")
      .select("id, workspace_id, bot_id, kind, action, title, preview")
      .eq("id", itemId)
      .maybeSingle();
    if (!item) return;
    const links = await linksForWorkspace(db, item.workspace_id);
    if (!links.length) return;
    const { data: bot } = item.bot_id ? await db.from("bots").select("name").eq("id", item.bot_id).maybeSingle() : { data: null };
    const card = inboxCard(item as CardItem, bot?.name ?? "A bot");
    await Promise.all(links.map((link) => postToLink(link, card)));
  } catch (error) {
    console.error("[chat] couldn't send the Waiting on me item", error);
  }
}

/** Post a message (markdown) to a workspace's linked channels — all, or just one provider. */
export async function notifyWorkspace(workspaceId: string, markdown: string, only?: ChannelProvider) {
  if (!configured()) return;
  try {
    const links = await linksForWorkspace(createAdminClient(), workspaceId, only);
    await Promise.all(links.map((link) => postToLink(link, { markdown: markdown.slice(0, 3800) })));
  } catch (error) {
    console.error("[chat] couldn't notify the workspace", error);
  }
}

async function postToLink(link: ChannelLink, message: CardElement | { markdown: string }) {
  try {
    const bot = await readyChatBot();
    if (link.provider === "telegram") {
      if (!hasTelegram() || !link.meta.channel_id) return;
      await bot.channel(link.meta.channel_id).post(message);
      return;
    }
    const slack = slackAdapter(bot);
    if (!slack || !link.meta.user_id) return;
    const installation = await slack.getInstallation(link.externalId);
    if (!installation) return;
    const userId = link.meta.user_id;
    // Outside a webhook the Slack adapter needs the workspace's token in context.
    await slack.withBotToken(
      installation.botToken,
      async () => {
        // Where the user actually talks to Dotty (a channel thread when they mention it there);
        // only fall back to a DM when nothing has been said yet.
        const threadId = link.meta.thread_id ?? (await slack.openDM(userId));
        await bot.thread(threadId).post(message);
      },
      { installationId: link.externalId, botUserId: installation.botUserId },
    );
  } catch (error) {
    console.error(`[chat] couldn't post to ${link.provider}`, error);
  }
}
