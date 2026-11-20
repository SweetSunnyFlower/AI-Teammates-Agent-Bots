import { planAccessRequest, type BotApps } from "@/lib/integrations/composio";
import { proposeRoutine } from "@/lib/routines/propose";
import { createAdminClient } from "@/lib/db/admin";
import type { ChatContext, ToolOptions } from "./bot-context";
import { notifyInboxItem } from "./notify";

/**
 * Tools that only leave a card on Waiting on me (chat can't pause for an answer): asking for an app
 * and the Head's routine proposals. Shared by the web chat and Telegram / Slack. Inbox items are
 * written with the service role (users can only read them); the caller has already established
 * that this bot belongs to the person chatting.
 */
export function chatSideTools(chat: ChatContext, appTools: BotApps, timezone: string): Pick<ToolOptions, "onAppAccess" | "onProposeRoutine"> {
  const { bot } = chat;
  return {
    onProposeRoutine: (proposal) =>
      proposeRoutine(
        createAdminClient(),
        { workspaceId: bot.workspace_id, proposerId: bot.id, roster: chat.roster.bots, defaultTimezone: timezone },
        proposal,
      ),
    onAppAccess: async ({ app, why }) => {
      const plan = await planAccessRequest({ workspaceId: bot.workspace_id, bot, roster: chat.roster.bots, connected: appTools.connected, app, why });
      if (!plan.ok) return { ok: false, error: plan.message };
      const { data: item, error } = await createAdminClient()
        .from("inbox_items")
        .insert({
          workspace_id: bot.workspace_id,
          bot_id: bot.id,
          kind: "access",
          tool_key: plan.preview.app,
          title: plan.title,
          preview: plan.preview,
        })
        .select("id")
        .single();
      if (error || !item) return { ok: false, error: "暂时无法提交权限申请。" };
      await notifyInboxItem(item.id);
      return {
        ok: true,
        requested: plan.preview.appName,
        note: `已在“待我处理”中向用户申请。你目前还没有 ${plan.preview.appName} 权限，请告知用户，不要在本次回复中尝试使用该应用。`,
      };
    },
  };
}
