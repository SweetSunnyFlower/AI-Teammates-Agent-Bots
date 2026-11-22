import { convertToModelMessages, generateText, isStepCount, validateUIMessages, type UIMessage } from "ai";
import { deepSeekModelFor, hasDeepSeek } from "@/lib/ai/models";
import { appToolsFor } from "@/lib/integrations/composio";
import { startTaskRun } from "@/lib/runs/start";
import { createAdminClient } from "@/lib/db/admin";
import { buildChatTools, buildInstructions, loadChatContext } from "./bot-context";
import { chatSideTools } from "./side-tools";
import { rateLimit } from "@/lib/ratelimit";

/**
 * One message from Telegram or Slack, answered by a bot — the same bot, memory, tools and rules as
 * the web drawer (the conversation shows up there too). Goes to the Head unless the message
 * starts with "@<bot name>". Uses the trusted runtime database client, explicitly scoped to the
 * linked workspace. No streaming: the reply is posted when it's ready (the channel shows
 * "typing…" meanwhile).
 */

const MEMORY_LIMIT = 40;

export interface TurnResult {
  botName: string;
  isHead: boolean;
  reply: string;
}

export async function runChannelTurn(input: { workspaceId: string; text: string; via: "telegram" | "slack" }): Promise<TurnResult> {
  if (!hasDeepSeek()) return { botName: "Dotty", isHead: true, reply: "聊天需要 DeepSeek API Key，请在服务端环境变量中添加 DEEPSEEK_API_KEY。" };
  const limit = await rateLimit("chat", `ws:${input.workspaceId}`);
  if (!limit.ok) return { botName: "Dotty", isHead: true, reply: `消息发送过于频繁，请在 ${limit.retryAfter} 秒后重试。` };
  const db = createAdminClient();

  const { data: roster } = await db.from("bots").select("id, name, role").eq("workspace_id", input.workspaceId);
  const bots = roster ?? [];
  const head = bots.find((b: any) => b.role === "head");
  const routed = routeMessage(input.text, bots);
  const botId = routed.botId ?? head?.id;
  if (!botId) return { botName: "Dotty", isHead: true, reply: "这个工作空间还没有 Bot。" };
  const text = routed.text || input.text;

  const chat = await loadChatContext(db, botId);
  if (!chat || chat.bot.workspace_id !== input.workspaceId) return { botName: "Dotty", isHead: true, reply: "这个 Bot 已不存在。" };
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
      if (!(await startTaskRun(task))) throw new Error("后台任务尚未配置");
    },
    ...chatSideTools(chat, appTools, timezone),
  });

  const history = (rows ?? []).reverse().map((r: any) => ({ id: r.ui_id ?? crypto.randomUUID(), role: r.role, parts: r.parts }) as UIMessage);
  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: [...history, userMessage], tools });
  } catch {
    messages = [userMessage];
  }

  // "Working" while it replies, like the web chat; back to resting afterwards.
  const detail = bot.role === "head" ? "正在规划你的请求" : "正在回复你";
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
      model: deepSeekModelFor(bot.model),
      instructions: [
        buildInstructions(chat, timezone, { mine: appTools.apps, connected: appTools.connected }),
        "",
        `用户正在通过 ${where} 与你交流。回复要简短、适合聊天：使用自然语言和简单项目符号，不要使用表格或标题。任何需要用户批准的事项都会以按钮形式出现在 ${where} 和“待我处理”中。`,
      ].join("\n"),
      messages: await convertToModelMessages(messages),
      tools: { ...appTools.tools, ...tools },
      stopWhen: isStepCount(8),
    });
    reply = result.text.trim() || "已完成。";
  } catch (error) {
    console.error("[chat] channel turn failed", error);
    reply = "回复时出了点问题，请稍后重试。";
  } finally {
    if (claimed?.length) {
      await db
        .from("bots")
        .update({ status: "resting", status_detail: "休息中", last_active_at: new Date().toISOString() })
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
    .find((b: any) => after.startsWith(b.name.toLowerCase()) && /^[\s,:]|^$/.test(after.slice(b.name.length)));
  if (!match) return { botId: null, text: trimmed };
  return { botId: match.id, text: trimmed.slice(1 + match.name.length).replace(/^[\s,:]+/, "") };
}
