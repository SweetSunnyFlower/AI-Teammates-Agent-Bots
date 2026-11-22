import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { deepSeekModelFor, hasDeepSeek } from "@/lib/ai/models";
import { buildChatTools, buildInstructions, loadChatContext } from "@/lib/chat/bot-context";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";
import { startTaskRun } from "@/lib/runs/start";
import { appToolsFor } from "@/lib/integrations/composio";
import { chatSideTools } from "@/lib/chat/side-tools";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { getCurrentUserId } from "@/lib/auth/session";

// Chat replies stream for a while; give tool calls room to finish.
export const maxDuration = 60;

const MEMORY_LIMIT = 40; // messages since the last "new chat" divider that the bot remembers

const incoming = z.object({
  message: z.object({
    id: z.string().min(1).max(64),
    role: z.literal("user"),
    parts: z
      .array(z.object({ type: z.literal("text"), text: z.string().min(1).max(4000) }))
      .min(1)
      .max(4),
  }),
});

const json = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request, ctx: RouteContext<"/api/chat/[botId]">) {
  if (!hasDatabaseEnv) return json(503, "聊天需要数据库，请在 .env.local 中添加 DATABASE_URL。");
  if (!hasDeepSeek()) return json(503, "聊天需要 DeepSeek API Key，请在 .env.local 中添加 DEEPSEEK_API_KEY 并重启。");

  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return json(404, "Bot 不存在。");

  const parsed = incoming.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, "消息必须是文字，且不超过 4,000 个字符。");
  const userMessage = parsed.data.message as UIMessage;

  const userId = await getCurrentUserId();
  if (!userId) return json(401, "会话已过期，请重新登录。");
  const databaseClient = await createClient();
  const limit = await rateLimit("chat", userId);
  if (!limit.ok) return tooMany(limit, `消息发送过于频繁，请在 ${limit.retryAfter} 秒后重试。`);

  const chat = await loadChatContext(databaseClient, botId);
  if (!chat) return json(404, "Bot 不存在，或者你没有访问权限。");
  const { bot } = chat;

  // Memory = messages after the latest divider (older ones stay visible but are forgotten).
  const { data: divider } = await databaseClient
    .from("messages")
    .select("created_at")
    .eq("bot_id", bot.id)
    .eq("kind", "divider")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let historyQuery = databaseClient
    .from("messages")
    .select("ui_id, role, parts")
    .eq("bot_id", bot.id)
    .eq("kind", "message")
    .order("created_at", { ascending: false })
    .limit(MEMORY_LIMIT);
  if (divider) historyQuery = historyQuery.gt("created_at", divider.created_at);
  const [{ data: rows }, { data: profile }] = await Promise.all([
    historyQuery,
    databaseClient.from("profiles").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);

  // Save the user's message first so it is never lost, even if the model call fails.
  const { error: saveError } = await databaseClient.from("messages").insert({
    workspace_id: bot.workspace_id,
    bot_id: bot.id,
    role: "user",
    parts: userMessage.parts,
    channel: "web",
    ui_id: userMessage.id,
  });
  if (saveError && !saveError.message.includes("messages_bot_ui_id_unique")) {
    return json(500, "保存消息失败，请检查网络后重试。");
  }

  // Tasks created in chat start their background run immediately.
  // Connected apps (Composio): only the apps chosen for this bot; it knows who has the others.
  const appTools = await appToolsFor(bot.workspace_id, bot.app_keys);
  const tools = buildChatTools(databaseClient, chat, {
    onTaskCreated: async (task) => {
      if (!(await startTaskRun(task))) throw new Error("后台任务尚未配置");
    },
    // App access requests and the Head's routine proposals leave a card on Waiting on me.
    ...chatSideTools(chat, appTools, profile?.timezone ?? "UTC"),
  });
  const history = (rows ?? [])
    .reverse()
    .filter((r: any) => r.ui_id !== userMessage.id)
    .map((r: any) => ({ id: r.ui_id ?? crypto.randomUUID(), role: r.role, parts: r.parts }) as UIMessage);

  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: [...history, userMessage], tools });
  } catch {
    // An old message no longer matches today's tools — continue with just the new message.
    messages = [userMessage];
  }

  // The bot is "working" while it replies (the Head plans and hands out tasks right here, not in a
  // background run). Back to resting afterwards — unless a background run took over meanwhile.
  const chatDetail = bot.role === "head" ? "正在规划你的请求" : "正在回复你";
  const { data: claimed } = await databaseClient
    .from("bots")
    .update({ status: "working", status_detail: chatDetail, last_active_at: new Date().toISOString() })
    .eq("id", bot.id)
    .eq("status", "resting")
    .select("id");
  const wasResting = Boolean(claimed?.length);
  const backToResting = async () => {
    if (!wasResting) return;
    await databaseClient
      .from("bots")
      .update({ status: "resting", status_detail: "休息中", last_active_at: new Date().toISOString() })
      .eq("id", bot.id)
      .eq("status", "working")
      .eq("status_detail", chatDetail);
  };
  // "Stop" (or closing the tab) aborts the request; don't leave the bot stuck on "working".
  req.signal.addEventListener("abort", () => void backToResting(), { once: true });

  const result = streamText({
    model: deepSeekModelFor(bot.model),
    instructions: buildInstructions(chat, profile?.timezone ?? "UTC", { mine: appTools.apps, connected: appTools.connected }),
    messages: await convertToModelMessages(messages),
    tools: { ...appTools.tools, ...tools },
    stopWhen: isStepCount(8),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages: finished }) => {
        const known = new Set(messages.map((m: any) => m.id));
        const replies = finished.filter((m: any) => !known.has(m.id) && m.role === "assistant");
        if (replies.length) {
          await databaseClient.from("messages").insert(
            replies.map((m: any) => ({
              workspace_id: bot.workspace_id,
              bot_id: bot.id,
              role: "assistant" as const,
              parts: m.parts,
              channel: "web" as const,
              ui_id: m.id,
            })),
          );
        }
        await databaseClient.from("bots").update({ last_active_at: new Date().toISOString() }).eq("id", bot.id);
        await backToResting();
      },
      onError: (error) => {
        void backToResting();
        const message = error instanceof Error ? error.message : String(error);
        if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "无法连接 AI 服务，请检查网络后重试。";
        if (/401|403|unauthorized|api key/i.test(message)) return "DeepSeek 拒绝了 API Key，请检查 DEEPSEEK_API_KEY。";
        return "回复时出了点问题，请重试。";
      },
    }),
  });
}
