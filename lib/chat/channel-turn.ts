import { convertToModelMessages, generateText, isStepCount, validateUIMessages, type UIMessage } from "ai";
import { gatewayModelFor, hasAiGateway } from "@/lib/ai/models";
import { appToolsFor } from "@/lib/integrations/composio";
import { startTaskRun } from "@/lib/runs/start";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildChatTools, buildInstructions, loadChatContext } from "./bot-context";
import { chatSideTools } from "./side-tools";

/**
 * One message from Telegram or Slack, answered by a bot — the same bot, memory, tools and rules as
 * the web drawer (the conversation shows up there too). Goes to the Head unless the message
 * starts with "@<bot name>". Uses the service role, scoped to the linked workspace. No streaming:
 * the reply is posted when it's ready (the channel shows "typing…" meanwhile).
 */

const MEMORY_LIMIT = 40;

export interface TurnResult {
  botName: string;
  isHead: boolean;
  reply: string;
}

export async function runChannelTurn(input: { workspaceId: string; text: string; via: "telegram" | "slack" }): Promise<TurnResult> {
  if (!hasAiGateway()) return { botName: "Dotty", isHead: true, reply: "Chat needs an AI Gateway key — add AI_GATEWAY_API_KEY to the server's environment." };
  const db = createAdminClient();

  const { data: roster } = await db.from("bots").select("id, name, role").eq("workspace_id", input.workspaceId);
  const bots = roster ?? [];
  const head = bots.find((b) => b.role === "head");
  const routed = routeMessage(input.text, bots);
  const botId = routed.botId ?? head?.id;
  if (!botId) return { botName: "Dotty", isHead: true, reply: "This workspace has no bots yet." };
  const text = routed.text || input.text;

  const chat = await loadChatContext(db, botId);
  if (!chat || chat.bot.workspace_id !== input.workspaceId) return { botName: "Dotty", isHead: true, reply: "That bot doesn't exist any more." };
  const { bot } = chat;

  const [{ data: workspace }, { data: divider }] = await Promise.all([
    db.from("workspaces").select("owner_id").eq("id", input.workspaceId).single(),
    db.from("messages").select("created_at").eq("bot_id", bot.id).eq("kind", "divider").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { data: profile } = await db.from("profiles").select("timezone").eq("user_id", workspace?.owner_id ?? "").maybeSingle();
  const timezone = profile?.timezone ?? "UTC";

  let historyQuery = db
    .from("messages")
    .select("ui_id, role, parts")
    .eq("bot_id", bot.id)
    .eq("kind", "message")
    .order("created_at", { ascending: false })
    .limit(MEMORY_LIMIT);
  if (divider) historyQuery = historyQuery.gt("created_at", divider.created_at);
  const { data: rows } = await historyQuery;

  const userMessage: UIMessage = { id: `${input.via}-${crypto.randomUUID()}`.slice(0, 64), role: "user", parts: [{ type: "text", text: text.slice(0, 4000) }] };
  await db.from("messages").insert({
    workspace_id: bot.workspace_id,
    bot_id: bot.id,
    role: "user",
    parts: userMessage.parts,
    channel: input.via,
    ui_id: userMessage.id,
  });

  const appTools = await appToolsFor(bot.workspace_id, bot.app_keys);
  const tools = buildChatTools(db, chat, {
    source: input.via,
    onTaskCreated: async (task) => {
      if (!(await startTaskRun(task))) throw new Error("Background runs aren't configured yet");
    },
    ...chatSideTools(chat, appTools, timezone),
  });

  const history = (rows ?? []).reverse().map((r) => ({ id: r.ui_id ?? crypto.randomUUID(), role: r.role, parts: r.parts }) as UIMessage);
  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: [...history, userMessage], tools });
  } catch {
    messages = [userMessage];
  }

  // "Working" while it replies, like the web chat; back to resting afterwards.
  const detail = bot.role === "head" ? "Planning your request" : "Chatting with you";
  const { data: claimed } = await db
    .from("bots")
    .update({ status: "working", status_detail: detail, last_active_at: new Date().toISOString() })
    .eq("id", bot.id)
    .eq("status", "resting")
    .select("id");

  const where = input.via === "telegram" ? "Telegram" : "Slack";
  let reply: string;
  try {
    const result = await generateText({
      model: gatewayModelFor(bot.model),
      instructions: [
        buildInstructions(chat, timezone, { mine: appTools.apps, connected: appTools.connected }),
        "",
        `The user is writing to you from ${where}. Keep replies short and chat-friendly: plain sentences and simple bullet lists, no tables or headings. Anything waiting for their OK shows up in ${where} with buttons and in Waiting on me.`,
      ].join("\n"),
      messages: await convertToModelMessages(messages),
      tools: { ...appTools.tools, ...tools },
      stopWhen: isStepCount(8),
    });
    reply = result.text.trim() || "Done.";
  } catch (error) {
    console.error("[chat] channel turn failed", error);
    reply = "Something went wrong while replying. Try again in a moment.";
  } finally {
    if (claimed?.length) {
      await db
        .from("bots")
        .update({ status: "resting", status_detail: "Resting", last_active_at: new Date().toISOString() })
        .eq("id", bot.id)
        .eq("status", "working")
        .eq("status_detail", detail);
    }
  }

  await db.from("messages").insert({
    workspace_id: bot.workspace_id,
    bot_id: bot.id,
    role: "assistant",
    parts: [{ type: "text", text: reply }],
    channel: input.via,
    ui_id: `${input.via}-${crypto.randomUUID()}`.slice(0, 64),
  });
  return { botName: bot.name, isHead: bot.role === "head", reply };
}

/**
 * "@Inbox Zero draft a reply…" → that bot. Bot names can contain spaces, so the longest name that
 * matches right after "@" wins. Anything else goes to the Head.
 */
export function routeMessage(text: string, bots: Array<{ id: string; name: string }>) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("@")) return { botId: null, text: trimmed };
  const after = trimmed.slice(1).toLowerCase();
  const match = [...bots]
    .sort((a, b) => b.name.length - a.name.length)
    .find((b) => after.startsWith(b.name.toLowerCase()) && /^[\s,:]|^$/.test(after.slice(b.name.length)));
  if (!match) return { botId: null, text: trimmed };
  return { botId: match.id, text: trimmed.slice(1 + match.name.length).replace(/^[\s,:]+/, "") };
}
