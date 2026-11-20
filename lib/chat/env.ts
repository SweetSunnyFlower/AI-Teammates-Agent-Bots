/**
 * Which chat channels are configured (SERVER ONLY — reads secrets' presence, never their values).
 * See .env.example → "Chat channels".
 */
export const hasChatState = () => Boolean(process.env.DATABASE_URL);

export const hasTelegram = () =>
  hasChatState() && Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN && process.env.TELEGRAM_BOT_USERNAME);

export const hasSlack = () =>
  hasChatState() &&
  Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_ENCRYPTION_KEY);

export const telegramBotUsername = () => process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") ?? "";

/**
 * The public HTTPS address Telegram / Slack call (webhooks, Slack OAuth). Locally that's your ngrok
 * URL; in production the app's URL.
 */
export function chatPublicUrl() {
  const url = (process.env.CHAT_PUBLIC_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  return url.startsWith("https://") ? url : null;
}

/** Where people open the web app (links in cards). Only https links work as Telegram buttons. */
export function appUrl() {
  const url = (process.env.NEXT_PUBLIC_SITE_URL || process.env.CHAT_PUBLIC_URL || "").trim().replace(/\/$/, "");
  return url || null;
}
