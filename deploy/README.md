# Dotty self-hosted deployment

Target: one Linux server running Next.js, the pg-boss worker, Postgres (external or local),
SearXNG, and rootless Podman. Caddy terminates HTTPS.

## 1. System prerequisites

- Node.js 22.12+
- PostgreSQL 13+
- Caddy 2
- rootless Podman with a dedicated `dotty` user

Create the service user and directories:

```bash
useradd --create-home --shell /bin/bash dotty
install -d -o dotty -g dotty /opt/dotty
install -d -o dotty -g dotty /var/lib/dotty/sandboxes
loginctl enable-linger dotty
```

## 2. Database

Create a database and user, then run the migrations:

```bash
sudo -u postgres createuser -P dotty
sudo -u postgres createdb -O dotty dotty
cd /opt/dotty
npm run db:migrate
```

The database owner must be able to create the compatibility roles used by the historical
migrations (`anon`, `authenticated`, `service_role`). If the database is managed and role creation
is disabled, remove the grant/policy blocks from the migrations before applying them; the app
enforces ownership in `lib/db/client.ts`.

## 3. App

```bash
cp .env.example .env.local
# Fill DATABASE_URL, BETTER_AUTH_SECRET, DEEPSEEK_API_KEY and NEXT_PUBLIC_SITE_URL.
npm ci
npm run db:migrate
npm run build
npm run podman:build
```

Generate the auth secret and SearXNG secret:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

## 4. SearXNG

Replace the placeholder `server.secret_key` in `deploy/searxng/settings.yml`, then install and
start `dotty-searxng.service`. It listens only on `127.0.0.1:8080`.

## 5. Caddy and systemd

Set `DOMAIN` and `ACME_EMAIL`, install `deploy/Caddyfile` at `/etc/caddy/Caddyfile`, then:

```bash
cp deploy/systemd/dotty.service /etc/systemd/system/
cp deploy/systemd/dotty-worker.service /etc/systemd/system/
cp deploy/systemd/dotty-searxng.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dotty dotty-worker dotty-searxng caddy
```

The worker must run as the same `dotty` user as the Podman storage. Change `XDG_RUNTIME_DIR` in
the unit if the user's UID is not 1000.

## 6. Health checks

```bash
curl -fsS https://$DOMAIN/api/health
systemctl status dotty dotty-worker dotty-searxng caddy
journalctl -u dotty-worker -f
```

## Local macOS

Podman machine networking can be unreliable behind some macOS VPN/network filters. Colima with Docker is a
supported local fallback and uses the same container images:

```bash
brew install colima docker
colima start --vm-type=vz
docker run -d --name dotty-searxng --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/deploy/searxng:/etc/searxng:ro" \
  -e SEARXNG_BASE_URL=http://localhost:8080/ \
  docker.io/searxng/searxng:latest
PODMAN_BIN=docker npm run podman:build -- node
npm run dev
npm run worker:start
```

Set `PODMAN_BIN=docker` in `.env.local` for the local sandbox. `SEARXNG_ENGINES=mojeek` is a reliable
default on networks where Brave, DuckDuckGo or Google upstreams are blocked.
