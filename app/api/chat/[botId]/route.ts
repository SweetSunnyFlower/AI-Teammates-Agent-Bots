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
import { gatewayModelFor, hasAiGateway } from "@/lib/ai/models";
import { buildChatTools, buildInstructions, loadChatContext } from "@/lib/chat/bot-context";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { startTaskRun } from "@/lib/runs/start";

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
  if (!hasSupabaseEnv) return json(503, "Chat needs Supabase — add your keys to .env.local.");
  if (!hasAiGateway()) return json(503, "Chat needs an AI Gateway key — add AI_GATEWAY_API_KEY to .env.local and restart.");

  const { botId } = await ctx.params;
  if (!z.string().uuid().safeParse(botId).success) return json(404, "Unknown bot.");

  const parsed = incoming.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, "Messages must be text, up to 4,000 characters.");
  const userMessage = parsed.data.message as UIMessage;

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return json(401, "Your session expired — sign in again.");

  const chat = await loadChatContext(supabase, botId);
  if (!chat) return json(404, "That bot doesn't exist or isn't yours.");
  const { bot } = chat;

  // Memory = messages after the latest divider (older ones stay visible but are forgotten).
  const { data: divider } = await supabase
    .from("messages")
    .select("created_at")
    .eq("bot_id", bot.id)
    .eq("kind", "divider")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let historyQuery = supabase
    .from("messages")
    .select("ui_id, role, parts")
    .eq("bot_id", bot.id)
    .eq("kind", "message")
    .order("created_at", { ascending: false })
    .limit(MEMORY_LIMIT);
  if (divider) historyQuery = historyQuery.gt("created_at", divider.created_at);
  const [{ data: rows }, { data: profile }] = await Promise.all([
    historyQuery,
    supabase.from("profiles").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);

  // Save the user's message first so it is never lost, even if the model call fails.
  const { error: saveError } = await supabase.from("messages").insert({
    workspace_id: bot.workspace_id,
    bot_id: bot.id,
    role: "user",
    parts: userMessage.parts,
    channel: "web",
    ui_id: userMessage.id,
  });
  if (saveError && !saveError.message.includes("messages_bot_ui_id_unique")) {
    return json(500, "Couldn't save your message — check your connection and try again.");
  }

  // Tasks created in chat start their background run immediately.
  const tools = buildChatTools(supabase, chat, {
    onTaskCreated: async (task) => {
      if (!(await startTaskRun(task))) throw new Error("Background runs aren't configured yet");
    },
  });
  const history = (rows ?? [])
    .reverse()
    .filter((r) => r.ui_id !== userMessage.id)
    .map((r) => ({ id: r.ui_id ?? crypto.randomUUID(), role: r.role, parts: r.parts }) as UIMessage);

  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: [...history, userMessage], tools });
  } catch {
    // An old message no longer matches today's tools — continue with just the new message.
    messages = [userMessage];
  }

  const result = streamText({
    model: gatewayModelFor(bot.model),
    instructions: buildInstructions(chat, profile?.timezone ?? "UTC"),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(6),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages: finished }) => {
        const known = new Set(messages.map((m) => m.id));
        const replies = finished.filter((m) => !known.has(m.id) && m.role === "assistant");
        if (replies.length) {
          await supabase.from("messages").insert(
            replies.map((m) => ({
              workspace_id: bot.workspace_id,
              bot_id: bot.id,
              role: "assistant" as const,
              parts: m.parts,
              channel: "web" as const,
              ui_id: m.id,
            })),
          );
        }
        await supabase.from("bots").update({ last_active_at: new Date().toISOString() }).eq("id", bot.id);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "Couldn't reach the AI service — check your connection and try again.";
        if (/401|403|unauthorized|api key/i.test(message)) return "The AI Gateway key was rejected — check AI_GATEWAY_API_KEY.";
        return "Something went wrong while replying. Try again.";
      },
    }),
  });
}
