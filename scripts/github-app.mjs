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
  fail(`${ENV_FILE} already has a GitHub App (GITHUB_APP_ID). Pass --force to create a new one and replace it.`);
}

const host = new URL(appUrl).hostname.replace(/^www\./, "");
const name = (typeof args.name === "string" ? args.name : `Dotty ${host === "localhost" ? "dev" : host.split(".")[0]} ${randomBytes(2).toString("hex")}`).slice(0, 34);
const state = randomBytes(16).toString("hex");

const callbackUrls = [...new Set([`${appUrl}/api/github/callback`, ...(webhookBase ? [`${webhookBase}/api/github/callback`] : [])])];
const manifest = {
  name,
  url: webhookBase ?? (appUrl.startsWith("https://") ? appUrl : "https://github.com"),
  description: "Dotty — your AI team. Bots read issues and pull requests, and Engineering bots open draft pull requests.",
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
<p>Sending you to GitHub to create <b>${escape(name)}</b>…</p>
<form id="f" method="post" action="${escape(target)}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>Continue to GitHub</button></form>
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
  if (!res.ok) throw new Error(body.message ?? `GitHub said ${res.status}`);
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
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("That link doesn't match", "Run npm run github:app again."));
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
      .end(page("Dotty's GitHub App is ready", "Its credentials are saved in .env.local. You can close this tab and go back to the terminal."));
    console.log(`\n✔ Created the GitHub App "${app.name}" (https://github.com/apps/${app.slug}).`);
    console.log(`  Saved GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and GITHUB_WEBHOOK_SECRET to ${ENV_FILE}.`);
    console.log(webhookBase ? `  Webhook: ${webhookBase}/api/webhooks/github` : "  No webhook (set CHAT_PUBLIC_URL to your ngrok URL and re-run with --force to add one — optional for now).");
    console.log("  Next: restart `npm run dev` and `npm run worker:dev`, then Dotty → Settings → Connectors → GitHub → Connect.");
    console.log("  Production: run this again with --url=https://your-domain and put those values in .env.local.\n");
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(page("Something went wrong", "See the terminal."));
    console.error(`\n✖ Couldn't finish creating the app: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
  setTimeout(() => server.close(() => process.exit()), 300);
});

server.listen(PORT, "127.0.0.1", () => {
  const start = `http://localhost:${PORT}/`;
  console.log(`\nCreating "${name}" for ${appUrl}${webhookBase ? ` (webhook on ${webhookBase})` : ""}.`);
  console.log(`Opening ${start} — if the browser doesn't open, visit it yourself. Press "Create GitHub App" on GitHub.\n`);
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", start]] : process.platform === "darwin" ? ["open", [start]] : ["xdg-open", [start]];
  spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
});
server.on("error", (error) => fail(`Couldn't listen on port ${PORT}: ${error.message}`));
