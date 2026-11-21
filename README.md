# 🏢 Dotty — 3D 办公室里的 AI 团队

> 本项目代码（部分或完整）仅在**获得许可证后**可用于商业用途，个人使用**免费**。
> 👉 [获取商业许可证](https://trymockshot.com/r/ai-teammates/extended) · 👉 [查看许可说明](./TECHWITHEMMA-LICENSE.md)

## ❤️ 支持项目

如果这个项目对你有帮助，可以通过以下方式支持：
* ☕ [请作者喝咖啡](https://buymeacoffee.com/techwithemmaofficial)
* 🌟 为仓库点 Star
* 🎥 [订阅 YouTube](https://tinyurl.com/subcribe-to-techwithEmma)

---

## 🗝️ 主要功能

* 🔐 自托管邮箱密码登录 + 邮箱验证（Better Auth）
* 🏢 等距视角 3D 办公室（React Three Fiber）
* 🛗 楼层与部门
* 🤖 总控、主管与执行 Bot
* 🧠 规划与任务分派
* ✋ 审批门禁
* 📥 待我处理
* 🗂️ 任务看板
* 💬 与任意 Bot 聊天
* 🔌 应用工具（Composio）
* 🔑 按 Bot 分配应用权限
* 💻 本地代码沙箱（Podman 或 Docker）
* 🐙 GitHub Pull Request
* ⏰ 例行任务与每日回顾
* 📨 Telegram Bot
* 💼 Slack App
* ⚡ 后台任务（pg-boss）
* 🔄 实时更新（PostgreSQL NOTIFY + SSE）
* 💸 费用与任务上限
* 🌗 浅色与深色模式
* 🌐 使用 Next.js、TypeScript、PostgreSQL、DeepSeek 与 AI SDK 构建

## 🔧 使用说明

Dotty 采用自托管架构，**不依赖** Supabase 或 Trigger.dev：

- Next.js 16 + React 19：网页应用与 3D 办公室
- Better Auth：邮箱密码会话
- PostgreSQL：业务数据、认证、pg-boss 任务与 SSE 变更事件
- DeepSeek：通过 AI SDK 调用模型
- SearXNG：网页搜索
- Podman 或 Docker/Colima：工程代码运行沙箱

没有配置 `DATABASE_URL` 时，应用只会运行只读演示办公室。配置数据库后，需要同时启动 Web
进程和后台 worker。

有两种启动方式：

- **仅预览：**安装依赖后运行 `npm run dev`，不需要数据库、API Key、SearXNG 或容器运行时。
- **完整应用：**按下方第 1–9 步操作。聊天和后台任务需要 PostgreSQL 与 DeepSeek；研究工具
  需要 SearXNG；工程代码运行需要容器运行时。

### 1. 环境要求

完整应用必需：

- Node.js **22.12 或更高版本**（`node --version`）
- PostgreSQL **13 或更高版本**
- DeepSeek API Key

特定功能所需：

- **研究工具：**SearXNG
- **工程代码运行：**Podman 或 Docker

各平台推荐：

- **macOS：**Colima + Docker
- **Linux 服务器：**rootless Podman
- **生产反向代理：**Caddy

可选集成：

- Composio：Gmail、日历和 Notion
- GitHub App：仓库与 Pull Request
- Telegram 和 Slack 应用

### 2. 安装项目

```bash
git clone https://github.com/SweetSunnyFlower/AI-Teammates-Agent-Bots.git
cd AI-Teammates-Agent-Bots
npm ci
```

如果项目已经在本地：

```bash
cd /path/to/AI-Teammates-Agent-Bots
npm ci
```

### 3. 创建 `.env.local`

```bash
cp .env.example .env.local
```

生成 Better Auth 密钥：

```bash
openssl rand -base64 32
```

填写以下必需配置：

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/dotty
BETTER_AUTH_SECRET=<generated secret>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
DEEPSEEK_API_KEY=<your DeepSeek key>
SEARXNG_URL=http://127.0.0.1:8080
SEARXNG_ENGINES="google cse,360search"
SANDBOX_ENABLED=true
CONTAINER_BIN=docker
```

使用 Colima 的 macOS 本地环境：

```dotenv
CONTAINER_BIN=docker
DOTTY_SANDBOX_ROOT=/Users/YOUR_NAME/.dotty/sandboxes
```

使用 rootless Podman 的 Linux 本地环境：

```dotenv
CONTAINER_BIN=podman
DOTTY_SANDBOX_ROOT=/home/YOUR_USER/.dotty/sandboxes
```

说明：

- 数据库密码中的保留字符需要 URL 编码，例如 `@` 要写成 `%40`。
- `DOTTY_SANDBOX_ROOT` 必须使用绝对路径；`.env.local` 中不会展开 `$HOME`。
- PostgreSQL 要求 TLS 时，添加 `DATABASE_SSL=true`。
- 不要把 `BETTER_AUTH_SECRET`、`DEEPSEEK_API_KEY` 或数据库凭据暴露到浏览器代码中。
- `SEARXNG_ENGINES` 是可选配置。网络屏蔽其他搜索源或触发限流时，`mojeek` 是实用的默认值。

### 4. 准备 PostgreSQL

Dotty 可以使用本机 PostgreSQL，也可以使用远程 PostgreSQL。请使用独立数据库和独立数据库
所有者，不要与其他应用共用。`DATABASE_URL` 中的账户必须拥有 `dotty` 数据库。

创建新数据库时，请使用 PostgreSQL 管理员账户执行以下 SQL，并先把密码替换为真实值：

```sql
create role dotty login password 'replace-this-password';
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create database dotty owner dotty;
```

在本地 Linux 安装中，可以通过 `postgres` 系统用户执行相同操作：

```bash
sudo -u postgres psql -d postgres
```

已经存在的角色或数据库请跳过。三个兼容角色用于历史数据库结构。`service_role` 使用
`BYPASSRLS`，因此托管 PostgreSQL 服务必须允许管理员创建该角色。如果服务商禁止创建，请换用
允许该角色的 PostgreSQL 安装，再执行迁移。

把 `.env.local` 加载到当前 Shell，然后验证连接：

```bash
set -a
source .env.local
set +a
psql "$DATABASE_URL" -c 'select current_database(), current_user;'
```

执行全部迁移：

```bash
npm run db:migrate
```

迁移脚本是幂等的：已执行的文件会自动跳过。拉取新的迁移后可以再次运行。

### 5. 准备容器运行时

项目不要求 Podman。macOS/Windows 使用 Docker 即可；Linux 可以使用 rootless Podman。
沙箱代码通过 `CONTAINER_BIN` 选择实际运行时。

#### macOS：Colima + Docker

```bash
brew install colima docker
colima start --vm-type=vz
brew services start colima # 可选：登录后自动启动 Colima
```

在 `.env.local` 中设置 `CONTAINER_BIN=docker`，并创建沙箱目录：

```bash
mkdir -p "$HOME/.dotty/sandboxes"
```

某些 macOS VPN 或网络过滤工具会影响容器虚拟机网络。Colima 使用不同的网络路径，因此
是 Docker Desktop 之外的推荐本地替代方案。

#### Linux：rootless Podman

```bash
podman --version
podman info --format '{{.Host.Security.Rootless}}'
```

第二条命令必须输出 `true`。请确保 worker 用户无需 `sudo` 即可运行 Podman。创建配置中的沙箱
目录，并确认该用户有写入权限：

```bash
mkdir -p "$HOME/.dotty/sandboxes"
test -w "$HOME/.dotty/sandboxes" && echo 可写
```

使用专用 `dotty` 用户的 systemd 部署应使用 `/var/lib/dotty/sandboxes`，并按照
[`deploy/README.md`](./deploy/README.md) 设置目录所有者。

### 6. 启动 SearXNG

生成一个长期有效的 SearXNG 密钥：

```bash
openssl rand -hex 32
```

把输出值填入 `.env.local` 的 `SEARXNG_SECRET`，不要写进仓库里的
`deploy/searxng/settings.yml`。然后在项目根目录运行：

```bash
mkdir -p "$HOME/.dotty/searxng-cache"

set -a; source .env.local; set +a
container_bin="${CONTAINER_BIN:-docker}" # Linux 使用 podman 时设为 CONTAINER_BIN=podman
"$container_bin" run -d \
  --name dotty-searxng \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/deploy/searxng:/etc/searxng:ro" \
  -v "$HOME/.dotty/searxng-cache:/var/cache/searxng" \
  -e SEARXNG_BASE_URL=http://localhost:8080/ \
  -e SEARXNG_SECRET="$SEARXNG_SECRET" \
  docker.io/searxng/searxng:latest
```

如果 Docker Hub 连接被重置，可以先用镜像加速地址拉取，再打回本地标签：

```bash
docker pull docker.m.daocloud.io/searxng/searxng:latest
docker tag docker.m.daocloud.io/searxng/searxng:latest searxng/searxng:latest
```

验证 JSON 搜索结果：

```bash
curl 'http://127.0.0.1:8080/search?q=OpenAI&format=json&engines=mojeek'
```

响应中必须包含至少一条 `results`。SearXNG 只应监听 `127.0.0.1`，不要把 8080 端口公开。

### 7. 构建工程沙箱镜像

至少构建你的仓库会用到的运行时：

```bash
npm run sandbox:build -- node
```

其他运行时可以稍后添加：

```bash
npm run sandbox:build -- python
npm run sandbox:build -- golang
npm run sandbox:build -- rust
npm run sandbox:build -- ruby
```

脚本会读取 `.env.local` 中的 `CONTAINER_BIN`，因此 macOS 上的 Docker 与 Linux 上的 Podman
都可以使用同一命令。

沙箱默认安全策略：

- `SANDBOX_NETWORK=none`
- 容器根文件系统只读
- `/tmp` 临时可写
- 限制内存、CPU 与 PID
- 只挂载当前运行的工作目录

默认 `none` 会让 `npm ci`、`pip install` 等依赖安装失败。确实需要联网安装依赖时：

- Docker：设置 `SANDBOX_NETWORK=bridge`
- rootless Podman：设置 `SANDBOX_NETWORK=slirp4netns`

如果仓库必须在代码运行期间下载依赖，请显式修改网络配置。Docker 可使用 `bridge`，rootless
Podman 可使用 `slirp4netns`，并请评估由此带来的安全影响。

### 8. 启动应用与 worker

终端 1，Web 应用：

```bash
npm run dev
```

终端 2，后台任务：

```bash
npm run worker:dev
```

打开 [http://localhost:3000](http://localhost:3000)，选择**创建账户**。注册需要输入两次密码，
并通过邮件里的链接验证邮箱；验证成功后才能进入工作空间。
聊天创建的任务、例行任务、审批、每日回顾和工程运行都需要 worker 持续运行。

没有 worker 时界面仍能启动，但任务会一直排队。

### 9. 验证安装

```bash
set -a
source .env.local
set +a

curl http://localhost:3000/api/health
curl 'http://127.0.0.1:8080/search?q=OpenAI&format=json&engines=mojeek'

docker ps # 或：podman ps

psql "$DATABASE_URL" -c 'select count(*) from public._dotty_migrations;'
find db/migrations -maxdepth 1 -name '*.sql' | wc -l
```

预期结果：

- 健康检查返回 `{"ok":true,"service":"dotty"}`
- SearXNG 返回搜索结果
- `npm run dev` 与 worker 都持续运行
- 数据库中的迁移数量与 `find` 打印的 SQL 文件数量一致

### 10. SMTP 与可选集成

注册账户需要 SMTP 发送邮箱验证链接。Bot 的邮件发送工具也复用这套配置：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-provider-authorization-code
EMAIL_FROM=you@example.com
```

`SMTP_PASS` 是邮箱服务商生成的授权码，不是登录密码。`EMAIL_FROM` 必须与 `SMTP_USER`
相同。填写后运行以下命令验证登录和 TLS；该命令不会发送邮件：

```bash
npm run email:check
```

每个 Bot 都可以在 **设置 → 工具 → 沟通** 中自行勾选“发送邮件”。聊天中的发信请求只会创建
后台任务；实际发送前必须在“待我处理”中批准或编辑最终邮件内容。

Composio：

```dotenv
COMPOSIO_API_KEY=
```

GitHub App：

```bash
npm run github:app
```

Telegram 与 Slack：

```bash
npm run chat:secrets
npm run slack:manifest
npm run telegram:webhook -- https://your-domain
```

这些集成都不是必需的。不配置它们时，办公室、聊天、任务、审批、例行任务和研究工具仍可使用。

### 11. 生产部署

Linux 服务器使用 Caddy、systemd 和 rootless Podman 部署时，请按照
[`deploy/README.md`](./deploy/README.md) 操作。

常见生产命令：

```bash
npm ci
npm run db:migrate
npm run build
npm start

# 在独立服务中运行：
npm run worker:start
```

把 `NEXT_PUBLIC_SITE_URL` 和 `BETTER_AUTH_URL` 设置为公开 HTTPS 域名。Caddy 的 SSE 刷新配置
参考 [`deploy/Caddyfile`](./deploy/Caddyfile)。

### 故障排查

`DATABASE_URL is required` 错误

- 确认项目根目录存在 `.env.local`。
- 修改环境变量后，重启 `npm run dev` 和 worker。

SearXNG 返回 0 条结果

```bash
docker logs --tail 100 dotty-searxng # 或：podman logs --tail 100 dotty-searxng
curl 'http://127.0.0.1:8080/search?q=test&format=json&engines=mojeek'
```

- 在 `.env.local` 中设置可用的引擎，例如 `SEARXNG_ENGINES="google cse,360search"`。
- 修改后重启开发服务器。
- 上游搜索源可能被网络、VPN 或限流阻止。

macOS 上 Podman machine 启动后立即停止

- 使用上面的 Colima/Docker 方案。
- 只选择一个运行时，并确保 `CONTAINER_BIN` 指向它。

数据库迁移在创建角色时失败

- 首次设置时使用能够创建登录角色和 `BYPASSRLS` 的 PostgreSQL 管理员。
- 托管服务商必须允许创建第 4 步中的兼容角色 `anon`、`authenticated` 和 `service_role`。
- 确认 `DATABASE_URL` 指向预期的独立数据库。

升级依赖后 Next.js 页面反复重载

```bash
# 先停止开发服务器
mv .next "/tmp/dotty-next-cache-$(date +%s)"
npm run dev
```

任务一直排队

- 确认 `npm run worker:start` 或 `npm run worker:dev` 正在运行。
- 确认 worker 与 Web 应用使用同一个 `.env.local`。

工程任务提示镜像错误

```bash
npm run sandbox:build -- node
```

构建与目标仓库匹配的运行时镜像。

## 📜 许可证

商业用途需要购买许可证。获取商业许可证请访问 👉 [许可证页面](https://trymockshot.com/r/ai-teammates/extended)。

详细条款请查看 [TECHWITHEMMA-LICENSE.md](./TECHWITHEMMA-LICENSE.md)。

---
