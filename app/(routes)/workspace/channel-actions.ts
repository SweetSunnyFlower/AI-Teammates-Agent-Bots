"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { readyChatBot, slackAdapter } from "@/lib/chat/bot";
import { chatPublicUrl, hasChatState, hasSlack, hasTelegram, telegramBotUsername } from "@/lib/chat/env";
import { createAdminClient } from "@/lib/db/admin";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";

/** Settings → Channels: link Telegram / Slack to this workspace, see the status, unlink. */

export interface ChannelStatus {
  /** Server has DATABASE_URL (the chat state store). */
  stateReady: boolean;
  /** Server has an https public URL (CHAT_PUBLIC_URL / NEXT_PUBLIC_SITE_URL) for webhooks and Slack OAuth. */
  publicUrl: boolean;
  telegram: { configured: boolean; botUsername: string | null; linked: { username: string | null } | null };
  slack: { configured: boolean; linked: { teamName: string | null } | null };
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

/** The signed-in user's client, if they own the workspace (RLS). */
async function owned(workspaceId: string) {
  if (!hasDatabaseEnv || !uuid.safeParse(workspaceId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  return data ? supabase : null;
}

export async function getChannels(workspaceId: string): Promise<Result<{ status: ChannelStatus }>> {
  const supabase = await owned(workspaceId);
  if (!supabase) return { ok: false, error: "Unknown workspace." };
  const { data: rows } = await supabase
    .from("connections")
    .select("provider, meta")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .in("provider", ["telegram", "slack"]);
  const meta = (p: string) => (rows ?? []).find((r: any) => r.provider === p)?.meta as Record<string, string> | undefined;
  const tg = meta("telegram");
  const sl = meta("slack");
  return {
    ok: true,
    status: {
      stateReady: hasChatState(),
      publicUrl: Boolean(chatPublicUrl()),
      telegram: { configured: hasTelegram(), botUsername: telegramBotUsername() || null, linked: tg ? { username: tg.username ?? null } : null },
      slack: { configured: hasSlack(), linked: sl ? { teamName: sl.team_name ?? null } : null },
    },
  };
}

/** A one-time link (15 minutes): opening it in Telegram and pressing Start links that chat. */
export async function createTelegramLink(workspaceId: string): Promise<Result<{ url: string }>> {
  if (!hasTelegram()) return { ok: false, error: "Telegram isn't set up on the server yet — see .env.example → Chat channels." };
  const supabase = await owned(workspaceId);
  if (!supabase) return { ok: false, error: "Unknown workspace." };
  const code = randomBytes(24).toString("base64url"); // 32 chars, Telegram's allowed set
  const { error } = await supabase.from("telegram_link_codes").insert({ code, workspace_id: workspaceId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: `https://t.me/${telegramBotUsername()}?start=${code}` };
}

export async function unlinkChannel(workspaceId: string, provider: "telegram" | "slack"): Promise<Result<object>> {
  const supabase = await owned(workspaceId);
  if (!supabase) return { ok: false, error: "Unknown workspace." };
  const db = createAdminClient();
  const { data: row } = await db
    .from("connections")
    .select("id, external_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  if (!row) return { ok: true };
  if (provider === "slack" && row.external_id && hasSlack()) {
    try {
      const slack = slackAdapter(await readyChatBot());
      await slack?.deleteInstallation(row.external_id);
    } catch (error) {
      console.error("[slack] couldn't remove the installation", error);
    }
  }
  const { error } = await db.from("connections").delete().eq("id", row.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
