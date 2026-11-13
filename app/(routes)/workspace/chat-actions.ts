"use server";

import type { UIMessage } from "ai";
import { z } from "zod";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** A thread item: a chat message, or a "new chat" divider. */
export type ThreadMessage = UIMessage<{ createdAt: string; divider?: boolean }>;

const uuid = z.string().uuid();
const THREAD_LIMIT = 200; // most recent messages loaded into the drawer

/** The bot's whole thread (dividers included), oldest first. RLS limits it to the owner. */
export async function loadThread(
  botId: string,
): Promise<
  { ok: true; messages: ThreadMessage[] } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv)
    return {
      ok: false,
      error: "Chat needs Supabase — add your keys to .env.local.",
    };
  if (!uuid.safeParse(botId).success)
    return { ok: false, error: "Unknown bot." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, ui_id, role, kind, parts, created_at")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  if (error) return { ok: false, error: friendly(error.message) };
  return {
    ok: true,
    messages: (data ?? []).reverse().map((m) => ({
      id: m.ui_id ?? m.id,
      role: m.role,
      parts: m.kind === "divider" ? [] : m.parts,
      metadata: {
        createdAt: m.created_at,
        divider: m.kind === "divider" || undefined,
      },
    })),
  };
}

/** "New chat": a divider in the same thread. The bot forgets everything above it; nothing is deleted. */
export async function startNewChat(
  botId: string,
): Promise<
  { ok: true; divider: ThreadMessage } | { ok: false; error: string }
> {
  if (!hasSupabaseEnv || !uuid.safeParse(botId).success)
    return { ok: false, error: "Unknown bot." };
  const supabase = await createClient();
  const { data: bot } = await supabase
    .from("bots")
    .select("id, workspace_id")
    .eq("id", botId)
    .maybeSingle();
  if (!bot)
    return { ok: false, error: "That bot doesn't exist or isn't yours." };
  const { data, error } = await supabase
    .from("messages")
    .insert({
      workspace_id: bot.workspace_id,
      bot_id: bot.id,
      role: "system",
      kind: "divider",
      parts: [],
      channel: "web",
    })
    .select("id, created_at")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };
  return {
    ok: true,
    divider: {
      id: data.id,
      role: "system",
      parts: [],
      metadata: { createdAt: data.created_at, divider: true },
    },
  };
}

function friendly(message: string) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message))
    return "Couldn't reach Supabase — check your connection and try again.";
  return message;
}
