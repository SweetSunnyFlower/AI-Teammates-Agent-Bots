"use server";

import type { UIMessage } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** A thread item: a chat message, or a "new chat" divider. */
export type ThreadMessage = UIMessage<{ createdAt: string; divider?: boolean }>;

const uuid = z.string().uuid();
const THREAD_LIMIT = 200; // most recent messages loaded into the drawer

/** The bot's whole thread (dividers included), oldest first. RLS limits it to the owner. */
export async function loadThread(botId: string): Promise<{ ok: true; messages: ThreadMessage[] } | { ok: false; error: string }> {
  if (!hasSupabaseEnv) return { ok: false, error: "Chat needs Supabase — add your keys to .env.local." };
  if (!uuid.safeParse(botId).success) return { ok: false, error: "Unknown bot." };
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
      metadata: { createdAt: m.created_at, divider: m.kind === "divider" || undefined },
    })),
  };
}

/** "New chat": a divider in the same thread. The bot forgets everything above it; nothing is deleted. */
export async function startNewChat(botId: string): Promise<{ ok: true; divider: ThreadMessage } | { ok: false; error: string }> {
  if (!hasSupabaseEnv || !uuid.safeParse(botId).success) return { ok: false, error: "Unknown bot." };
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, workspace_id").eq("id", botId).maybeSingle();
  if (!bot) return { ok: false, error: "That bot doesn't exist or isn't yours." };
  const { data, error } = await supabase
    .from("messages")
    .insert({ workspace_id: bot.workspace_id, bot_id: bot.id, role: "system", kind: "divider", parts: [], channel: "web" })
    .select("id, created_at")
    .single();
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true, divider: { id: data.id, role: "system", parts: [], metadata: { createdAt: data.created_at, divider: true } } };
}

/**
 * Answer a bot's question from its question card. The answer is tied to that inbox item (not
 * a normal chat message). Ownership is checked with the user's client (RLS) before the
 * service-role write, because users can't update inbox items directly.
 */
export async function answerQuestion(inboxItemId: string, answer: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = answer.trim();
  if (!hasSupabaseEnv || !uuid.safeParse(inboxItemId).success) return { ok: false, error: "Unknown question." };
  if (!text || text.length > 4000) return { ok: false, error: "Write an answer (up to 4,000 characters)." };

  const supabase = await createClient();
  const { data: item } = await supabase.from("inbox_items").select("id, kind, status").eq("id", inboxItemId).maybeSingle();
  if (!item) return { ok: false, error: "That question doesn't exist or isn't yours." };
  if (item.kind !== "question") return { ok: false, error: "That item is an approval, not a question." };
  if (item.status !== "pending") return { ok: false, error: "That question was already answered." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("inbox_items")
    .update({ status: "answered", answer: text, decided_via: "web", decided_at: new Date().toISOString() })
    .eq("id", inboxItemId)
    .eq("status", "pending");
  if (error) return { ok: false, error: friendly(error.message) };
  // Step C: complete the run's Trigger.dev waitpoint here so the bot resumes with the answer.
  return { ok: true };
}

function friendly(message: string) {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "Couldn't reach Supabase — check your connection and try again.";
  return message;
}
