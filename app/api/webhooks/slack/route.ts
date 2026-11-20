import { after } from "next/server";
import { chatBot } from "@/lib/chat/bot";
import { hasSlack } from "@/lib/chat/env";
import { limitByIp } from "@/lib/ratelimit";

/**
 * Slack → Dotty: events (DMs, @-mentions) and interactivity (card buttons) share this URL. The
 * adapter verifies Slack's signature (SLACK_SIGNING_SECRET) and picks the installation's token.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const limited = await limitByIp("webhook", request);
  if (limited) return limited;
  if (!hasSlack()) return new Response("服务端尚未配置 Slack。", { status: 503 });
  const bot = chatBot();
  const handle = bot.webhooks.slack;
  if (!handle) return new Response("服务端尚未配置 Slack。", { status: 503 });
  return handle(request, { waitUntil: (task) => after(() => task) });
}
