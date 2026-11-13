import { after } from "next/server";
import { chatBot } from "@/lib/chat/bot";
import { hasTelegram } from "@/lib/chat/env";

/**
 * Telegram → Dotty. The adapter checks Telegram's secret header (TELEGRAM_WEBHOOK_SECRET_TOKEN) and
 * answers right away; the message is handled after the response. Register this URL with
 * `npm run telegram:webhook` (ngrok locally, your domain in production).
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!hasTelegram()) return new Response("Telegram isn't configured on this server.", { status: 503 });
  const bot = chatBot();
  const handle = bot.webhooks.telegram;
  if (!handle) return new Response("Telegram isn't configured on this server.", { status: 503 });
  return handle(request, { waitUntil: (task) => after(() => task) });
}
