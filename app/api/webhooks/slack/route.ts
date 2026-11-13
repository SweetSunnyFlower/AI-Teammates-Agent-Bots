import { after } from "next/server";
import { chatBot } from "@/lib/chat/bot";
import { hasSlack } from "@/lib/chat/env";

/**
 * Slack → Dotty: events (DMs, @-mentions) and interactivity (card buttons) share this URL. The
 * adapter verifies Slack's signature (SLACK_SIGNING_SECRET) and picks the installation's token.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!hasSlack()) return new Response("Slack isn't configured on this server.", { status: 503 });
  const bot = chatBot();
  const handle = bot.webhooks.slack;
  if (!handle) return new Response("Slack isn't configured on this server.", { status: 503 });
  return handle(request, { waitUntil: (task) => after(() => task) });
}
