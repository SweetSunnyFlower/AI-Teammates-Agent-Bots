#!/usr/bin/env node
/**
 * Create Dotty's GitHub App from a manifest and save its credentials to .env.local:
 *
 *   npm run github:app                              app for http://localhost:3000 (webhook on CHAT_PUBLIC_URL if set)
 *   npm run github:app -- --url=https://dotty.app   app for production (make one app per environment)
 *   npm run github:app -- --org=my-org              owned by an organization instead of your account
 *   npm run github:app -- --name="Dotty dev" --force
 *
 * Opens GitHub in your browser; you press "Create GitHub App" and come back here. Writes
 * GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and
 * GITHUB_WEBHOOK_SECRET to .env.local. Never prints a secret.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const ENV_FILE = ".env.local";
const PORT = 3457;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const trim = (u) => (u || "").trim().replace(/\/$/, "");
const appUrl = trim(args.url || process.env.NEXT_PUBLIC_SITE_URL) || "http://localhost:3000";
const publicUrl = trim(args.url || process.env.CHAT_PUBLIC_URL);
const webhookBase = publicUrl.startsWith("https://") ? publicUrl : null;

const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (/^GITHUB_APP_ID=\S+/m.test(existing) && !args.force) {
  fail(`${ENV_FILE} 中已经有 GitHub App（GITHUB_APP_ID）。如需新建并覆盖，请传入 --force。`);
}

const host = new URL(appUrl).hostname.replace(/^www\./, "");
const name = (typeof args.name === "string" ? args.name : `Dotty ${host === "localhost" ? "dev" : host.split(".")[0]} ${randomBytes(2).toString("hex")}`).slice(0, 34);
const state = randomBytes(16).toString("hex");

const callbackUrls = [...new Set([`${appUrl}/api/github/callback`, ...(webhookBase ? [`${webhookBase}/api/github/callback`] : [])])];
const manifest = {
  name,
  url: webhookBase ?? (appUrl.startsWith("https://") ? appUrl : "https://github.com"),
  description: "Dotty — 你的 AI 团队。Bot 可以读取 Issue 和 Pull Request，工程 Bot 可以创建草稿 PR。",
  redirect_url: `http://localhost:${PORT}/done`,
  callback_urls: callbackUrls,
  request_oauth_on_install: true,
  setup_on_update: true,
  public: !args.private,
  default_permissions: {
    contents: "write",
    pull_requests: "write",
    issues: "write",
    checks: "read",
    actions: "read",
    metadata: "read",
  },
  ...(webhookBase
    ? {
        hook_attributes: { url: `${webhookBase}/api/webhooks/github`, active: true },
        default_events: ["issues", "issue_comment", "pull_request", "check_suite"],
      }
    : {}),
};

const target =
  typeof args.org === "string"
    ? `https://github.com/organizations/${encodeURIComponent(args.org)}/settings/apps/new?state=${state}`
    : `https://github.com/settings/apps/new?state=${state}`;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const startPage = `<!doctype html><meta charset="utf-8"><title>Create Dotty's GitHub App</title>
<body style="font-family:system-ui;padding:40px">
<p>正在跳转到 GitHub 创建 <b>${escape(name)}</b>…</p>
<form id="f" method="post" action="${escape(target)}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>继续前往 GitHub</button></form>
<script>document.getElementById("f").submit()</script></body>`;
const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px"><h2>${title}</h2><p>${text}</p></body>`;

/** Replace KEY=… lines in .env.local (or append them under a GitHub header). */
function saveEnv(values) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const missing = [];
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, () => line);
    else missing.push(line);
  }
  if (missing.length) {
    text = `${text.replace(/\n*$/, "\n")}\n# ── GitHub App (npm run github:app) ──────────────────────────────────────────\n${missing.join("\n")}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

async function convert(code) {
  const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "User-Agent": "dotty-setup" },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? `GitHub 返回状态码 ${res.status}`);
  return body;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(startPage);
    return;
  }
  if (url.pathname !== "/done") {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get("state") !== state) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("链接不匹配", "请重新运行 npm run github:app。"));
    return;
  }
  try {
    const app = await convert(url.searchParams.get("code") ?? "");
    saveEnv({
      GITHUB_APP_ID: String(app.id),
      GITHUB_APP_SLUG: app.slug,
      GITHUB_APP_PRIVATE_KEY: JSON.stringify(app.pem), // one line, "\n" escapes, double-quoted
      GITHUB_CLIENT_ID: app.client_id,
      GITHUB_CLIENT_SECRET: app.client_secret,
      GITHUB_WEBHOOK_SECRET: app.webhook_secret ?? randomBytes(32).toString("hex"),
    });
    res
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(page("Dotty 的 GitHub App 已创建", "凭据已保存到 .env.local。可以关闭此标签页并返回终端。"));
    console.log(`\n✔ 已创建 GitHub App“${app.name}”（https://github.com/apps/${app.slug}）。`);
    console.log(`  已将 GITHUB_APP_ID、GITHUB_APP_SLUG、GITHUB_APP_PRIVATE_KEY、GITHUB_CLIENT_ID、GITHUB_CLIENT_SECRET 和 GITHUB_WEBHOOK_SECRET 保存到 ${ENV_FILE}。`);
    console.log(webhookBase ? `  Webhook：${webhookBase}/api/webhooks/github` : "  未配置 Webhook（可选；设置 CHAT_PUBLIC_URL 后可带 --force 重新运行添加）。");
    console.log("  下一步：重启 `npm run dev` 和 `npm run worker:dev`，然后进入 Dotty →“设置”→“连接器”→“GitHub”→“连接”。");
    console.log("  生产环境：使用 --url=https://your-domain 再运行一次，并把这些值放入生产环境。\n");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(page("出了点问题", "请查看终端输出。"));
    console.error(`\n✖ 创建 GitHub App 失败：${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
  setTimeout(() => server.close(() => process.exit()), 300);
});

server.listen(PORT, "127.0.0.1", () => {
  const start = `http://localhost:${PORT}/`;
  console.log(`\n正在为 ${appUrl} 创建“${name}”${webhookBase ? `（Webhook：${webhookBase}）` : ""}。`);
  console.log(`正在打开 ${start}；如果浏览器没有自动打开，请手动访问，并在 GitHub 点击“Create GitHub App”。\n`);
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", start]] : process.platform === "darwin" ? ["open", [start]] : ["xdg-open", [start]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
});
server.on("error", (error) => fail(`无法监听端口 ${PORT}：${error.message}`));
