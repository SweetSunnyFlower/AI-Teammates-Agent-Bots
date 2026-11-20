# 🏢 Dotty — AI Teammates in a 3D Office

> This code, whether in parts or whole, is licensed for commercial use **only with a license**. It is **free for personal use**.
> 👉 [Click here to obtain license](https://trymockshot.com/r/ai-teammates/extended) and 👉 [here to learn more](./TECHWITHEMMA-LICENSE.md)

## ❤️ Support the Channel

Love this project? Here's how you can support:
* ☕ [Buy Me a Coffee](https://buymeacoffee.com/techwithemmaofficial)
* 🌟 Star this repo
* 🎥 [Subscribe on YouTube](https://tinyurl.com/subcribe-to-techwithEmma)

---

## 🗝️ Key Features: 👇

* 🔐 Self-hosted email/password authentication (Better Auth)
* 🏢 Isometric 3D Office (React Three Fiber)
* 🛗 Floors & Departments
* 🤖 Head, Lead & Worker Bots
* 🧠 Planning & Delegation
* ✋ Approval Gate
* 📥 Waiting on Me
* 🗂️ Kanban Boards
* 💬 Chat with Any Bot
* 🔌 App Tools (Composio)
* 🔑 Per-Bot App Access
* 💻 Local Coding Sandbox (Podman or Docker)
* 🐙 GitHub Pull Requests
* ⏰ Routines & Morning Recap
* 📨 Telegram Bot
* 💼 Slack App
* ⚡ Background Runs (pg-boss)
* 🔄 Realtime Updates (PostgreSQL NOTIFY + SSE)
* 💸 Spend & Task Caps
* 🌗 Light & Dark Mode
* 🌐 Built with Next.js, TypeScript, PostgreSQL, DeepSeek & AI SDK

## 🔧 How to Use This Project

Dotty is self-hosted. It does **not** require Supabase or Trigger.dev:

- Next.js 16 + React 19 for the web app and 3D office
- Better Auth for email/password sessions
- PostgreSQL for data, Better Auth, pg-boss jobs, and SSE change events
- DeepSeek through the AI SDK
- SearXNG for web search
- Podman or Docker/Colima for Engineering code runs

Without `DATABASE_URL`, the app runs in read-only demo mode. With a database, start both the web
process and the background worker.

There are two startup paths:

- **Preview only:** after installing dependencies, run `npm run dev`. No database, API key,
  SearXNG or container runtime is required.
- **Full app:** follow steps 1–9 below. Core chat and background work need PostgreSQL and
  DeepSeek; research needs SearXNG; Engineering needs a container runtime.

### 1. Requirements

Required for the full app:

- Node.js **22.12 or newer** (`node --version`)
- PostgreSQL **13 or newer**
- A DeepSeek API key

Required for specific features:

- **Research:** SearXNG
- **Engineering code runs:** Podman or Docker

Recommended by platform:

- **macOS:** Colima + Docker
- **Linux server:** rootless Podman
- **Production proxy:** Caddy

Optional integrations:

- Composio for Gmail, Calendar and Notion
- A GitHub App for repositories and pull requests
- Telegram and Slack apps

### 2. Install the project

```bash
git clone https://github.com/SweetSunnyFlower/AI-Teammates-Agent-Bots.git
cd AI-Teammates-Agent-Bots
npm ci
```

If you already have the project:

```bash
cd /path/to/AI-Teammates-Agent-Bots
npm ci
```

### 3. Create `.env.local`

```bash
cp .env.example .env.local
```

Generate the Better Auth secret:

```bash
openssl rand -base64 32
```

Fill these required values:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/dotty
BETTER_AUTH_SECRET=<generated secret>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
DEEPSEEK_API_KEY=<your DeepSeek key>
SEARXNG_URL=http://127.0.0.1:8080
SEARXNG_ENGINES=mojeek
PODMAN_ENABLED=true
PODMAN_BIN=podman
```

Local macOS using Colima:

```dotenv
PODMAN_BIN=docker
DOTTY_SANDBOX_ROOT=/Users/YOUR_NAME/.dotty/sandboxes
```

Local Linux using rootless Podman:

```dotenv
PODMAN_BIN=podman
DOTTY_SANDBOX_ROOT=/home/YOUR_USER/.dotty/sandboxes
```

Notes:

- URL-encode reserved characters in the database password, for example `@` becomes `%40`.
- Use an absolute path for `DOTTY_SANDBOX_ROOT`; `$HOME` is not expanded inside `.env.local`.
- Add `DATABASE_SSL=true` when the PostgreSQL provider requires TLS.
- Never expose `BETTER_AUTH_SECRET`, `DEEPSEEK_API_KEY`, or database credentials in browser code.
- `SEARXNG_ENGINES` is optional. `mojeek` is a useful default when other upstream engines are
  blocked or rate-limited in your network.

### 4. Prepare PostgreSQL

Dotty can use PostgreSQL on the same machine or on a remote server. Use a dedicated database and
database owner, not a shared application database. The account in `DATABASE_URL` must own the
`dotty` database.

For a new database, run these statements with a PostgreSQL administrator account. Replace the
password before using the URL:

```sql
create role dotty login password 'replace-this-password';
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create database dotty owner dotty;
```

On a local Linux installation, the same commands can be run through the `postgres` system user:

```bash
sudo -u postgres psql -d postgres
```

Skip any role or database that already exists. The three compatibility roles are part of the
historical schema. `service_role` uses `BYPASSRLS`, so a managed PostgreSQL provider must allow an
administrator to create that role. If the provider blocks it, use a PostgreSQL installation where
that role can be created before running the migrations.

Load `.env.local` into the current shell, then verify the connection:

```bash
set -a
source .env.local
set +a
psql "$DATABASE_URL" -c 'select current_database(), current_user;'
```

Apply every migration:

```bash
npm run db:migrate
```

The migration runner is idempotent: already-applied files are skipped. Run it again after pulling
new migrations.

### 5. Start the container runtime

#### macOS: Colima + Docker

```bash
brew install colima docker
colima start --vm-type=vz
brew services start colima # optional: start Colima after login
```

Set `PODMAN_BIN=docker` in `.env.local` and make the sandbox directory:

```bash
mkdir -p "$HOME/.dotty/sandboxes"
```

Some macOS VPN/network filters interfere with Podman machine networking. Colima uses a different
network path and is the recommended local fallback.

#### Linux: rootless Podman

```bash
podman --version
podman info --format '{{.Host.Security.Rootless}}'
```

The second command must print `true`. Make sure the worker user can run Podman without `sudo`.
Create the configured sandbox directory and confirm that the same user can write to it:

```bash
mkdir -p "$HOME/.dotty/sandboxes"
test -w "$HOME/.dotty/sandboxes" && echo writable
```

For a systemd deployment with a dedicated `dotty` user, use
`/var/lib/dotty/sandboxes` and follow the ownership setup in
[`deploy/README.md`](./deploy/README.md).

### 6. Start SearXNG

Set a permanent SearXNG secret in `deploy/searxng/settings.yml`:

```bash
openssl rand -hex 32
```

Replace the `server.secret_key` value with that output. Then, from the project root:

```bash
mkdir -p "$HOME/.dotty/searxng-cache"

container_bin=docker # use podman on Linux
"$container_bin" run -d \
  --name dotty-searxng \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/deploy/searxng:/etc/searxng:ro" \
  -v "$HOME/.dotty/searxng-cache:/var/cache/searxng" \
  -e SEARXNG_BASE_URL=http://localhost:8080/ \
  docker.io/searxng/searxng:latest
```

Verify JSON search:

```bash
curl 'http://127.0.0.1:8080/search?q=OpenAI&format=json&engines=mojeek'
```

The response must contain a `results` array with at least one result. SearXNG should only listen on
`127.0.0.1`; do not expose port 8080 publicly.

### 7. Build Engineering sandbox images

Build at least the runtimes used by your repositories:

```bash
npm run podman:build -- node
```

Other runtimes can be added later:

```bash
npm run podman:build -- python
npm run podman:build -- golang
npm run podman:build -- rust
npm run podman:build -- ruby
```

The script uses `PODMAN_BIN` from `.env.local`, so the same command builds with Docker on macOS or
Podman on Linux.

Sandbox hardening defaults:

- `PODMAN_SANDBOX_NETWORK=none`
- read-only container root filesystem
- temporary writable `/tmp`
- memory, CPU and PID limits
- only the per-run workspace mounted into the container

If a repository must download dependencies during the run, change the network setting explicitly.
Use `bridge` for Docker or `slirp4netns` for rootless Podman, and review the security tradeoff.

### 8. Start the app and worker

Terminal 1, web app:

```bash
npm run dev
```

Terminal 2, background jobs:

```bash
npm run worker:dev
```

Open [http://localhost:3000](http://localhost:3000), choose **Create account**, then create a
workspace. The worker must be running for chat-created tasks, routines, approvals, recaps, and
Engineering runs.

Without the worker, the UI starts but tasks remain queued.

### 9. Verify the installation

```bash
set -a
source .env.local
set +a

curl http://localhost:3000/api/health
curl 'http://127.0.0.1:8080/search?q=OpenAI&format=json&engines=mojeek'

docker ps # or: podman ps

psql "$DATABASE_URL" -c 'select count(*) from public._dotty_migrations;'
find db/migrations -maxdepth 1 -name '*.sql' | wc -l
```

Expected:

- health endpoint returns `{"ok":true,"service":"dotty"}`
- SearXNG returns search results
- both `npm run dev` and the worker remain running
- the database migration count matches the number of SQL files printed by `find`

### 10. Optional integrations

Composio:

```dotenv
COMPOSIO_API_KEY=
```

GitHub App:

```bash
npm run github:app
```

Telegram and Slack:

```bash
npm run chat:secrets
npm run slack:manifest
npm run telegram:webhook -- https://your-domain
```

These integrations are optional. Core office, chat, tasks, approvals, routines and research work
without them.

### 11. Production

For a Linux server with Caddy, systemd and rootless Podman, follow
[`deploy/README.md`](./deploy/README.md).

Typical production commands:

```bash
npm ci
npm run db:migrate
npm run build
npm start

# In a separate service:
npm run worker:start
```

Set `NEXT_PUBLIC_SITE_URL` and `BETTER_AUTH_URL` to the public HTTPS domain. Configure Caddy with
SSE flushing as shown in [`deploy/Caddyfile`](./deploy/Caddyfile).

### Troubleshooting

`DATABASE_URL is required`

- Make sure `.env.local` exists in the project root.
- Restart `npm run dev` and the worker after editing environment variables.

SearXNG returns zero results

```bash
docker logs --tail 100 dotty-searxng # or: podman logs --tail 100 dotty-searxng
curl 'http://127.0.0.1:8080/search?q=test&format=json&engines=mojeek'
```

- Set `SEARXNG_ENGINES=mojeek` in `.env.local`.
- Restart the dev server after changing it.
- Upstream engines can be blocked by your network, VPN or rate limits.

Podman machine starts but immediately stops on macOS

- Use the Colima/Docker setup above.
- Choose one runtime and make sure `PODMAN_BIN` points to it.

Database migration fails while creating a role

- Run the initial setup with a PostgreSQL administrator that can create login roles and
  `BYPASSRLS`.
- A managed provider must allow the compatibility `anon`, `authenticated` and `service_role` roles
  described in step 4.
- Confirm that the `DATABASE_URL` points to the intended dedicated database.

Next.js page reloads repeatedly after dependency upgrades

```bash
# Stop the dev server first
mv .next "/tmp/dotty-next-cache-$(date +%s)"
npm run dev
```

Tasks stay queued

- Confirm `npm run worker:start` or `npm run worker:dev` is running.
- Check that both the worker and web app use the same `.env.local`.

Engineering tasks fail with an image error

```bash
npm run podman:build -- node
```

Build the runtime matching the target repository.

## 📜 License Information

A paid license is required for commercial use. To obtain a commercial license, please visit 👉 [Here](https://trymockshot.com/r/ai-teammates/extended)

For more details about license, please refer to the [TECHWITHEMMA-LICENSE.md](./TECHWITHEMMA-LICENSE.md).

---
