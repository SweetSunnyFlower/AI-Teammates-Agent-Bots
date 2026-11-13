#!/usr/bin/env node
/**
 * Telegram / Slack setup helpers (run through npm scripts, which load .env.local):
 *
 *   npm run chat:secrets                 print fresh TELEGRAM_WEBHOOK_SECRET_TOKEN and SLACK_ENCRYPTION_KEY
 *   npm run tunnel                       start ngrok on port 3000 (uses NGROK_DOMAIN if set)
 *   npm run telegram:webhook [-- URL]    point the Telegram bot at URL/api/webhooks/telegram (with the secret)
 *   npm run slack:manifest [-- URL]      print the Slack app manifest for URL
 *
 * URL defaults to CHAT_PUBLIC_URL, then to the running ngrok tunnel. Locally that's your ngrok
 * address; for production pass your domain, e.g. `npm run telegram:webhook -- https://dotty.example.com`.
 * Never prints existing secrets.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const [command, urlArg] = process.argv.slice(2);

/** Keep in sync with SLACK_BOT_SCOPES in lib/chat/slack-oauth.ts. */
const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "chat:write",
  "im:history",
  "im:read",
  "im:write",
  "users:read",
  "reactions:write",
];

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function publicUrl() {
  const fromEnv = (urlArg || process.env.CHAT_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) {
    if (!fromEnv.startsWith("https://")) fail(`The public URL must start with https:// (got ${fromEnv}).`);
    return fromEnv;
  }
  try {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    const { tunnels } = await res.json();
    const https = tunnels.find((t) => t.public_url?.startsWith("https://"));
    if (https) return https.public_url.replace(/\/$/, "");
  } catch {
    // ngrok isn't running
  }
  fail("No public URL. Start ngrok first (npm run tunnel), set CHAT_PUBLIC_URL, or pass one: npm run telegram:webhook -- https://your-domain");
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail("TELEGRAM_BOT_TOKEN is missing from .env.local (get it from @BotFather).");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!json.ok) fail(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result;
}

async function setTelegramWebhook() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
  if (!secret) fail("TELEGRAM_WEBHOOK_SECRET_TOKEN is missing from .env.local (make one with npm run chat:secrets).");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) fail("TELEGRAM_WEBHOOK_SECRET_TOKEN may only contain A–Z, a–z, 0–9, _ and -.");
  const base = await publicUrl();
  const url = `${base}/api/webhooks/telegram`;
  await telegram("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "edited_message", "callback_query", "message_reaction"],
    drop_pending_updates: false,
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "help", description: "Your bots and how to talk to them" },
      { command: "start", description: "Link this chat (use the link from Dotty settings)" },
    ],
  });
  const me = await telegram("getMe");
  const info = await telegram("getWebhookInfo");
  console.log(`\n✔ @${me.username} now sends updates to ${info.url}`);
  if (info.last_error_message) console.log(`  (last delivery error reported by Telegram: ${info.last_error_message})`);
  if (process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "") !== me.username) {
    console.log(`  ⚠ TELEGRAM_BOT_USERNAME in .env.local should be "${me.username}".`);
  }
  console.log("  Keep `npm run dev` (and the tunnel) running, then link from Dotty → Settings → Channels.\n");
}

async function slackManifest() {
  const base = await publicUrl();
  const manifest = {
    display_information: {
      name: "Dotty",
      description: "Your AI team: message your bots and approve their work.",
      background_color: "#2b2620",
    },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: "Dotty", always_online: true },
    },
    oauth_config: {
      redirect_urls: [`${base}/api/slack/oauth`],
      scopes: { bot: SLACK_BOT_SCOPES },
    },
    settings: {
      event_subscriptions: { request_url: `${base}/api/webhooks/slack`, bot_events: ["app_mention", "message.im"] },
      interactivity: { is_enabled: true, request_url: `${base}/api/webhooks/slack` },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
  console.log(JSON.stringify(manifest, null, 2));
  console.error(
    [
      "",
      "↑ Paste this at https://api.slack.com/apps → Create New App → From a manifest (or App Manifest → edit, for an existing app).",
      "  Then copy Basic Information → Client ID, Client Secret and Signing Secret into .env.local (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET,",
      "  SLACK_SIGNING_SECRET), add SLACK_ENCRYPTION_KEY (npm run chat:secrets) and restart `npm run dev`.",
      "  When your public URL changes (a new ngrok address), update the three URLs in the manifest.",
      "",
    ].join("\n"),
  );
}

function secrets() {
  console.log(`TELEGRAM_WEBHOOK_SECRET_TOKEN=${randomBytes(32).toString("base64url")}`);
  console.log(`SLACK_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
  console.error("\n↑ New random values — paste the ones you need into .env.local (don't commit them).\n");
}

function tunnel() {
  const domain = process.env.NGROK_DOMAIN?.trim();
  const args = ["http", "3000", ...(domain ? [`--url=${domain}`] : [])];
  console.log(`Starting ngrok ${args.join(" ")} …  (then, in another terminal: npm run telegram:webhook)`);
  const child = spawn("ngrok", args, { stdio: "inherit", shell: process.platform === "win32" });
  child.on("error", () => fail("Couldn't start ngrok. Install it from https://ngrok.com/download and run `ngrok config add-authtoken <token>` once."));
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (command) {
  case "telegram":
    await setTelegramWebhook();
    break;
  case "slack-manifest":
    await slackManifest();
    break;
  case "secrets":
    secrets();
    break;
  case "tunnel":
    tunnel();
    break;
  default:
    fail("Usage: node scripts/chat-setup.mjs <telegram|slack-manifest|secrets|tunnel> [public URL]");
}
