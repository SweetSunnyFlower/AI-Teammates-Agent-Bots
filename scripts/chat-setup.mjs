#!/usr/bin/env node
/**
 * Telegram / Slack setup helpers (run through npm scripts, which load .env.local):
 *
 *   npm run chat:secrets                 print fresh TELEGRAM_WEBHOOK_SECRET_TOKEN and SLACK_ENCRYPTION_KEY
 *   npm run tunnel                       start ngrok on port 3000 (uses NGROK_DOMAIN if set)
 *   npm run telegram:webhook [-- URL]    point the Telegram bot at URL/api/webhooks/telegram (with the secret)
 *   npm run telegram:status              where the bot sends updates and the last delivery error Telegram saw
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
    if (!fromEnv.startsWith("https://")) fail(`公开地址必须以 https:// 开头（收到 ${fromEnv}）。`);
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
  fail("没有可用的公开地址。请先启动 ngrok（npm run tunnel）、设置 CHAT_PUBLIC_URL，或直接传入地址：npm run telegram:webhook -- https://your-domain");
}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail(".env.local 中缺少 TELEGRAM_BOT_TOKEN（请向 @BotFather 获取）。");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!json.ok) fail(`Telegram ${method} 调用失败：${json.description ?? res.status}`);
  return json.result;
}

async function setTelegramWebhook() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
  if (!secret) fail(".env.local 中缺少 TELEGRAM_WEBHOOK_SECRET_TOKEN（可运行 npm run chat:secrets 生成）。");
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) fail("TELEGRAM_WEBHOOK_SECRET_TOKEN 只能包含字母、数字、下划线和连字符。");
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
      { command: "help", description: "查看 Bot 列表和使用方式" },
      { command: "start", description: "关联当前聊天（使用 Dotty 设置中的链接）" },
    ],
  });
  const me = await telegram("getMe");
  const info = await telegram("getWebhookInfo");
  console.log(`\n✔ @${me.username} 现在会把更新发送到 ${info.url}`);
  if (info.last_error_message) console.log(`  （Telegram 报告的上次投递错误：${info.last_error_message}）`);
  if (process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, "") !== me.username) {
    console.log(`  ⚠ .env.local 中的 TELEGRAM_BOT_USERNAME 应设置为 "${me.username}"。`);
  }
  console.log("  请保持 `npm run dev` 和隧道运行，然后从 Dotty →“设置”→“渠道”完成关联。\n");
}

/** What Telegram knows about the webhook: the fastest way to see why messages don't arrive. */
async function telegramStatus() {
  const me = await telegram("getMe");
  const info = await telegram("getWebhookInfo");
  console.log(`\nBot：      @${me.username}`);
  console.log(`Webhook：  ${info.url || "（未设置，请运行 npm run telegram:webhook -- https://your-domain）"}`);
  console.log(`待投递：   ${info.pending_update_count} 条 Telegram 尚未投递的更新`);
  if (!info.url) {
    console.log("错误：     无；但由于从未设置 Webhook，Telegram 会积压所有消息。请先设置 Webhook。\n");
    return;
  }
  if (!info.last_error_message) {
    console.log("错误：     未报告错误，Telegram 投递正常。\n");
    return;
  }
  const when = info.last_error_date ? new Date(info.last_error_date * 1000).toLocaleString() : "未知时间";
  console.log(`最近错误（${when}）：${info.last_error_message}`);
  const e = info.last_error_message;
  const hint = /401/.test(e)
    ? "401：密钥不匹配。服务端 TELEGRAM_WEBHOOK_SECRET_TOKEN 必须与设置 Webhook 时使用的值一致\n  （使用服务端的值重新运行 telegram:webhook，然后重新部署）。"
    : /403/.test(e)
      ? "403：应用前面的防火墙或访问保护阻止了 Telegram。"
      : /404/.test(e)
        ? "404：地址错误，生产环境必须是 https://your-domain/api/webhooks/telegram。"
        : /503/.test(e)
          ? "503：服务端表示 Telegram 未配置，可能缺少 TELEGRAM_BOT_TOKEN、TELEGRAM_WEBHOOK_SECRET_TOKEN、TELEGRAM_BOT_USERNAME\n  或 DATABASE_URL。请补全并重启 Dotty。"
          : /500|502|504/.test(e)
            ? "5xx：应用处理更新时崩溃，请检查 `journalctl -u dotty` 和 `journalctl -u dotty-worker`。"
            : /429/.test(e)
              ? "429：应用触发了限流，请稍等一分钟。"
              : /SSL|certificate|resolve|connection/i.test(e)
                ? "Telegram 无法访问该域名，请检查域名、DNS 和 HTTPS。"
                : "";
  if (hint) console.log(`  → ${hint}`);
  console.log("");
}

async function slackManifest() {
  const base = await publicUrl();
  const manifest = {
    display_information: {
      name: "Dotty",
      description: "你的 AI 团队：联系 Bot 并审批它们的工作。",
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
      "↑ 将以上内容粘贴到 https://api.slack.com/apps → Create New App → From a manifest（已有应用则编辑 App Manifest）。",
      "  然后把 Basic Information 中的 Client ID、Client Secret 和 Signing Secret 写入 .env.local，",
      "  再添加 SLACK_ENCRYPTION_KEY（npm run chat:secrets），并重启 `npm run dev`。",
      "  公开地址变化时（例如更换 ngrok 地址），请同步修改 manifest 中的三个 URL。",
      "",
    ].join("\n"),
  );
}

function secrets() {
  console.log(`TELEGRAM_WEBHOOK_SECRET_TOKEN=${randomBytes(32).toString("base64url")}`);
  console.log(`SLACK_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`);
  console.error("\n↑ 已生成新的随机值。请按需粘贴到 .env.local，不要提交到 Git。\n");
}

function tunnel() {
  const domain = process.env.NGROK_DOMAIN?.trim();
  const args = ["http", "3000", ...(domain ? [`--url=${domain}`] : [])];
  console.log(`正在启动 ngrok ${args.join(" ")}…（随后在另一个终端运行 npm run telegram:webhook）`);
  const child = spawn("ngrok", args, { stdio: "inherit", shell: process.platform === "win32" });
  child.on("error", () => fail("无法启动 ngrok。请从 https://ngrok.com/download 安装，并运行一次 `ngrok config add-authtoken <token>`。"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (command) {
  case "telegram":
    await setTelegramWebhook();
    break;
  case "telegram-status":
    await telegramStatus();
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
    fail("用法：node scripts/chat-setup.mjs <telegram|telegram-status|slack-manifest|secrets|tunnel> [公开地址]");
}
