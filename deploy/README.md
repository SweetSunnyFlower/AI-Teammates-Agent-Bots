# Dotty 自托管部署

目标：在一台 Linux 服务器上运行 Next.js、pg-boss worker、PostgreSQL（本机或远程）、
SearXNG 和 rootless Podman，由 Caddy 负责 HTTPS。

## 1. 系统要求

- Node.js 22.12 或更高版本
- PostgreSQL 13 或更高版本
- Caddy 2
- rootless Podman，并使用专用 `dotty` 用户

创建服务用户与目录：

```bash
useradd --create-home --shell /bin/bash dotty
install -d -o dotty -g dotty /opt/dotty
install -d -o dotty -g dotty /var/lib/dotty/sandboxes
loginctl enable-linger dotty
```

## 2. 数据库

先创建数据库、所有者和兼容角色，再执行迁移：

```bash
sudo -u postgres createuser --createdb --createrole -P dotty
sudo -u postgres createdb -O dotty dotty
sudo -u postgres psql -d dotty -c "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;"
cd /opt/dotty
npm run db:migrate
```

`service_role` 需要 `BYPASSRLS`，因此需要 PostgreSQL 管理员预先创建。已经存在的角色可以跳过。
如果托管服务商禁止创建这些兼容角色，请换用允许创建角色的 PostgreSQL 服务，或由管理员提前
创建 `anon`、`authenticated` 和 `service_role`。

## 3. 应用

```bash
cp .env.example .env.local
# 填写 DATABASE_URL、BETTER_AUTH_SECRET、DEEPSEEK_API_KEY 和 NEXT_PUBLIC_SITE_URL。
npm ci
npm run db:migrate
npm run build
npm run sandbox:build
```

生成认证密钥与 SearXNG 密钥：

```bash
openssl rand -base64 32
openssl rand -hex 32
```

## 4. SearXNG

在 `.env.local` 中设置 `SEARXNG_SECRET`（不要把密钥写进仓库里的 settings 文件），再安装并
启动 `dotty-searxng.service`。它只监听 `127.0.0.1:8080`。

## 5. Caddy 与 systemd

设置 `DOMAIN` 和 `ACME_EMAIL`，把 `deploy/Caddyfile` 安装到 `/etc/caddy/Caddyfile`，然后运行：

```bash
cp deploy/systemd/dotty.service /etc/systemd/system/
cp deploy/systemd/dotty-worker.service /etc/systemd/system/
cp deploy/systemd/dotty-searxng.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dotty dotty-worker dotty-searxng caddy
```

在 Linux rootless Podman 部署中，worker 必须使用与 Podman 存储相同的 `dotty` 用户。如果用户
UID 不是 1000，请修改 unit 中的 `XDG_RUNTIME_DIR`。

## 6. 健康检查

```bash
curl -fsS https://$DOMAIN/api/health
systemctl status dotty dotty-worker dotty-searxng caddy
journalctl -u dotty-worker -f
```

## macOS 本地开发

某些 macOS VPN 或网络过滤工具会导致容器虚拟机网络不稳定。可以使用 Colima + Docker
作为本地替代方案，容器镜像完全相同：

```bash
brew install colima docker
colima start --vm-type=vz
docker run -d --name dotty-searxng --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/deploy/searxng:/etc/searxng:ro" \
  -e SEARXNG_BASE_URL=http://localhost:8080/ \
  docker.io/searxng/searxng:latest
CONTAINER_BIN=docker npm run sandbox:build -- node
npm run dev
npm run worker:start
```

本地沙箱需要在 `.env.local` 中设置 `CONTAINER_BIN=docker`。如果 Brave、DuckDuckGo 或 Google
上游被网络阻止，`SEARXNG_ENGINES=mojeek` 是比较稳定的默认值。
