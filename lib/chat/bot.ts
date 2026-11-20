import { Chat, type Adapter } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import { SlackAdapter, type SlackAdapterConfig } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { hasChatState, hasSlack, hasTelegram, telegramBotUsername } from "./env";
import { registerHandlers } from "./handlers";

/**
 * The one Chat SDK bot behind Telegram (one shared Dotty bot) and Slack (installed per Slack
 * workspace with "Add to Slack"). SERVER ONLY. State (webhook dedupe, locks, thread state, Slack
 * installations) lives in our self-hosted Postgres — see the chat_channels migration.
 */

/** Slack adapter that can tell handlers which Slack workspace the current event came from. */
export class DottySlackAdapter extends SlackAdapter {
  constructor(config: SlackAdapterConfig) {
    super(config);
  }
  /** team_id (or enterprise_id) of the installation handling the current request. */
  currentInstallationId(): string | undefined {
    return this.requestContext.getStore()?.installationId;
  }
}

export type DottyChat = Chat<Record<string, Adapter>, ThreadState>;

/** Per-thread state: set after "Answer" so the next message answers that question. */
export type ThreadState = {
  answering?: string;
};

let instance: DottyChat | null = null;
let ready: Promise<void> | null = null;

export function chatBot(): DottyChat {
  if (instance) return instance;
  if (!hasChatState()) throw new Error("聊天渠道需要 .env.local 中的 DATABASE_URL。");

  const adapters: Record<string, Adapter> = {};
  if (hasTelegram()) {
    adapters.telegram = createTelegramAdapter({
      mode: "webhook",
      userName: telegramBotUsername(),
      longMessages: "split",
    });
  }
  if (hasSlack()) {
    adapters.slack = new DottySlackAdapter({
      clientId: process.env.SLACK_CLIENT_ID!,
      clientSecret: process.env.SLACK_CLIENT_SECRET!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      encryptionKey: process.env.SLACK_ENCRYPTION_KEY!,
    });
  }

  instance = new Chat<Record<string, Adapter>, ThreadState>({
    userName: telegramBotUsername() || "dotty",
    adapters,
    state: createPostgresState({ url: process.env.DATABASE_URL, autoCreateSchema: false }),
    // One person, one conversation: handle their messages in order instead of dropping overlaps.
    concurrency: "queue",
    logger: process.env.NODE_ENV === "production" ? "warn" : "info",
  });
  registerHandlers(instance);
  return instance;
}

/** The bot, initialised — for posting outside a webhook (notifications from runs and actions). */
export async function readyChatBot() {
  const bot = chatBot();
  ready ??= bot.initialize().catch((error) => {
    ready = null;
    throw error;
  });
  await ready;
  return bot;
}

export const slackAdapter = (bot: DottyChat) => bot.getAdapter("slack") as DottySlackAdapter | undefined;
