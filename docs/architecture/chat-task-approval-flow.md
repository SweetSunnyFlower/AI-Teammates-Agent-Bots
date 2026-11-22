# Dotty 聊天、后台任务与审批链路

> 本文以“查询今日金价，然后发送到邮箱”为例，说明一条消息从浏览器进入系统，到幕僚长分派任务、pg-boss worker 执行、后台请求审批、前端渲染审批卡、用户批准、最终发送邮件和回报结果的完整过程。
>
> 示例收件人统一使用 `recipient@example.com`，不要把真实邮箱、SMTP 授权码或 API Key 写入文档。

## 先看结论

浏览器与后台 worker 之间没有直接 RPC、WebSocket 或进程间通信。它们通过 PostgreSQL 共享状态：

```text
浏览器
  │ Server Action / HTTP
  ▼
Next.js ───────────────► PostgreSQL
                          ▲
                          │ pg-boss + 业务表读写
                          │
                       worker
                          │
                          │ 业务表变化
                          ▼
                  pg_notify('dotty_events')
                          │
                          ▼
                 Next.js LISTEN + SSE
                          │
                          ▼
                        浏览器
                          重新拉取完整快照
                          并重新渲染 React UI
```

两个核心原则：

1. **数据库是状态源。** worker 不需要知道用户是否打开网页，也不需要直接调用 React。
2. **SSE 只是变更提示。** 通知本身可以丢失，业务状态不会丢；刷新、重连和轮询都会重新读取数据库。

---

## 前提与限制

这个例子假设负责执行的 Bot 同时拥有：

```text
web.search
email.send
```

并且服务端已经配置 SearXNG 与 SMTP。

“幕僚长”是 `head` Bot，默认不直接使用应用。它负责规划并把实际工作分派给执行 Bot。

如果当前没有同时拥有搜索和邮件能力的 Bot，幕僚长可能拆成多个任务：

```text
任务 A：查询今日金价
任务 B：把金价发送到邮箱
```

当前系统没有通用的“任务 A 完成后自动把结构化结果传给任务 B”机制。最可靠的做法是配置一个同时拥有 `web.search` 和 `email.send` 的执行 Bot，让一个后台任务完成搜索、邮件草稿和发送。

聊天不能直接发送邮件。聊天中的 `send_email` 没有审批处理器，只会返回错误并要求先创建后台任务；真正的审批发生在 worker 中。

---

## 1. 用户点击发送

用户在幕僚长聊天框输入：

```text
查询今日金价，然后发送给 recipient@example.com
```

[bot-chat.tsx](../../components/chat/bot-chat.tsx) 调用：

```ts
sendMessage({ text })
```

聊天 transport 只发送最新一条消息：

```text
POST /api/chat/<幕僚长-bot-id>
```

前端立即发生：

1. 用户消息出现在聊天气泡中。
2. 消息状态变成 `submitted`。
3. 模型还没有返回文字时，聊天底部显示“规划中”“思考中”等状态。

此时浏览器和后台 worker 还没有关系。worker 甚至可能不知道这条消息已经出现。

---

## 2. Next.js 先保存用户消息

[聊天接口](<../../app/api/chat/[botId]/route.ts>) 依次完成：

1. 校验数据库和 DeepSeek 配置。
2. 校验 Bot ID 与消息格式。
3. 取得当前用户。
4. 执行聊天限流。
5. 加载幕僚长上下文。
6. 保存用户消息。

第一张写入的业务表是：

```text
public.messages
```

数据形态：

```json
{
  "id": "message-uuid",
  "workspace_id": "workspace-uuid",
  "bot_id": "head-bot-uuid",
  "role": "user",
  "parts": [
    {
      "type": "text",
      "text": "查询今日金价，然后发送给 recipient@example.com"
    }
  ],
  "channel": "web",
  "ui_id": "msg-xxx",
  "kind": "message"
}
```

先保存消息意味着：即使后续 DeepSeek 请求失败，用户输入也不会丢。

随后幕僚长：

```text
bots.status       = working
bots.status_detail = 正在规划你的请求
```

顶部状态栏与办公室中的幕僚长会显示为“工作中”。

---

## 3. 幕僚长加载上下文并调用模型

聊天接口加载：

- 幕僚长自己的名称、职责和工具。
- 工作空间名称。
- 所有楼层和 Bot。
- Bot 的长期笔记。
- 当前未完成任务。
- 最近一条“新对话”分隔线之后的最近 40 条消息。
- 用户时区。

提示词中的核心规则包括：

- 简单问题可以直接回答。
- 真正需要搜索、写代码、发邮件或其他外部操作时，必须使用 `create_task`。
- 不允许在任务真正完成前声称已经完成。
- 发送、支付、发布、删除和合并必须经过用户批准。

然后 `streamText` 启动 DeepSeek Agent 循环。聊天最多执行 8 个模型步骤。

这个阶段仍是普通 HTTP 流式响应。浏览器看到的文字来自当前请求，不需要 SSE。

---

## 4. 幕僚长调用 `create_task`

模型应该调用：

```ts
create_task({
  title: "查询今日金价并发送邮件",
  details:
    "查询今天的黄金价格，整理简明摘要，并发送到 recipient@example.com。",
  assignee: "负责搜索与邮件的执行 Bot"
})
```

工具实现在 [lib/chat/bot-context.ts](../../lib/chat/bot-context.ts)。

它会检查：

1. 名称匹配的 Bot 是否存在。
2. 当前 Bot 是否有分派权限。
3. 是否达到每日任务上限。
4. 委派深度是否超过 3 层。
5. 创建任务并立即启动后台运行。

模型生成的 `title`、`details` 和 `assignee` 不保证与用户原句逐字一致，也可能拆成多项任务。

---

## 5. 第二张业务表：`tasks`

任务初始写入：

```text
public.tasks
```

数据示例：

```json
{
  "id": "task-uuid",
  "workspace_id": "workspace-uuid",
  "title": "查询今日金价并发送邮件",
  "body": "查询今天的黄金价格，整理简明摘要，并发送到 recipient@example.com。",
  "status": "backlog",
  "assignee_bot_id": "executor-bot-uuid",
  "created_by_bot_id": "head-bot-uuid",
  "parent_task_id": null,
  "depth": 0,
  "source": "web",
  "result": null,
  "routine_id": null
}
```

关键字段：

| 字段 | 含义 |
|---|---|
| `assignee_bot_id` | 真正负责执行的 Bot |
| `created_by_bot_id` | 创建任务的幕僚长 |
| `source = web` | 请求来自网页聊天 |
| `parent_task_id = null` | 顶层任务 |
| `depth = 0` | 尚未向下委派 |
| `body` | 模型整理后的完整执行说明 |

任务看板从 `snapshot.tasks` 渲染。新任务满足 `status = backlog`，所以出现在“待处理”列。

此时执行 Bot 还是：

```json
{
  "status": "resting",
  "status_detail": "休息中"
}
```

---

## 6. 第三层状态：pg-boss 队列

`create_task` 成功后调用 [lib/runs/start.ts](../../lib/runs/start.ts)：

```ts
enqueue("bot-run", {
  taskId: task.id
}, {
  concurrencyKey: task.assigneeBotId,
  idempotencyKey: `task-${task.id}`,
  tags: [...]
})
```

pg-boss 写入：

```text
pgboss.job
```

数据示例：

```json
{
  "name": "bot-run",
  "data": {
    "taskId": "task-uuid"
  },
  "state": "created",
  "singleton_key": "task-task-uuid",
  "group_id": "executor-bot-uuid",
  "retry_limit": 2
}
```

含义：

- `name = bot-run`：由 Bot 执行器领取。
- `data.taskId`：业务详情在 `public.tasks`，队列里只放任务 ID。
- `singleton_key`：同一个任务重复入队时保持幂等。
- `group_id = Bot ID`：同一个 Bot 同时只处理一个后台任务。
- `state = created`：等待 worker 领取。

聊天创建的任务不是 cron 任务。它在 `create_task` 成功后就立即入队。

例行任务才是另一条链路：

```text
routines
  → dispatch-routines 每分钟检查
  → 到期后创建 tasks
  → 再创建 bot-run 队列项
```

---

## 7. worker 领取后台任务

worker 是独立进程，启动时注册队列：

```ts
boss.work("bot-run", {
  localConcurrency: 3,
  groupConcurrency: 1,
  pollingIntervalSeconds: 2
})
```

对应 [jobs/worker.ts](../../jobs/worker.ts)。

它每 2 秒检查 `pgboss.job`。领取后调用：

```ts
botRun.run(
  { taskId: "task-uuid" },
  { ctx: { run: { id: "pgboss-job-uuid" } } }
)
```

worker 从这里开始执行，但它仍然没有与浏览器建立任何连接。

---

## 8. worker 把任务从 `backlog` 改成 `doing`，前端如何变化

这是最容易误解的一步。

worker 不是直接通知 React：

```text
✗ worker → React 组件
```

它只修改 PostgreSQL。

### 8.1 创建运行记录

[jobs/bot-run.ts](../../jobs/bot-run.ts) 先插入：

```text
public.runs
```

示例：

```json
{
  "id": "run-uuid",
  "workspace_id": "workspace-uuid",
  "task_id": "task-uuid",
  "bot_id": "executor-bot-uuid",
  "job_id": "pgboss-job-uuid",
  "status": "running",
  "steps": 0,
  "input_tokens": 0,
  "output_tokens": 0,
  "cost_cents": 0
}
```

### 8.2 同时修改三张表

worker 执行：

```ts
await Promise.all([
  db.from("tasks").update({
    status: "doing"
  }).eq("id", taskId),

  db.from("bots").update({
    status: "working",
    status_detail: `正在处理“${task.title}”`,
    last_active_at: new Date().toISOString()
  }).eq("id", bot.id),

  logActivity(
    db,
    task.workspace_id,
    bot.id,
    task.id,
    "run_started",
    `开始处理“${task.title}”`
  )
])
```

结果：

```json
{
  "tasks": {
    "status": "doing"
  },
  "bots": {
    "status": "working",
    "status_detail": "正在处理“查询今日金价并发送邮件”"
  },
  "activity": {
    "type": "run_started",
    "summary": "开始处理“查询今日金价并发送邮件”"
  }
}
```

### 8.3 数据库触发器发出变更通知

[db/migrations/9999_realtime_events.sql](../../db/migrations/9999_realtime_events.sql) 给 `tasks`、`bots`、`runs`、`activity`、`inbox_items`、`messages` 等表安装了触发器。

每次插入、更新或删除都会执行：

```sql
pg_notify(
  'dotty_events',
  json_build_object(
    'table', 'tasks',
    'op', 'update',
    'workspaceId', 'workspace-uuid',
    'taskId', 'task-uuid'
  )
);
```

`Promise.all` 可能产生多条通知，例如：

```json
{"table":"runs","op":"insert","workspaceId":"workspace-uuid","botId":"executor-bot-uuid","taskId":"task-uuid"}
{"table":"tasks","op":"update","workspaceId":"workspace-uuid","taskId":"task-uuid"}
{"table":"bots","op":"update","workspaceId":"workspace-uuid"}
{"table":"activity","op":"insert","workspaceId":"workspace-uuid","botId":"executor-bot-uuid","taskId":"task-uuid"}
```

通知里没有完整任务，也没有完整 Bot。它只表示：

> 这个工作空间的数据已经变化，请重新读取。

### 8.4 Next.js 接收 PostgreSQL 通知并通过 SSE 推送

Next.js 内部有一个长期连接执行：

```sql
LISTEN dotty_events;
```

代码在 [lib/events/postgres-listener.ts](../../lib/events/postgres-listener.ts)。

浏览器通过：

```text
GET /api/events?workspace=<workspace-id>
```

维持 SSE。接口在 [app/api/events/route.ts](../../app/api/events/route.ts) 把事件写成：

```text
event: change
data: {"table":"tasks","op":"update","workspaceId":"workspace-uuid","taskId":"task-uuid"}
```

事件不是数据库推送的完整 UI 状态，只是“变更提示”。

### 8.5 浏览器合并通知并重新拉取完整快照

[components/office/realtime-sync.tsx](../../components/office/realtime-sync.tsx) 收到事件后：

- 对于 `messages`：失效对应聊天线程查询。
- 对于其他表：调用 `refreshOffice()`。

`refreshOffice()` 延迟 400ms，把 worker 同时产生的多条通知合并成一次刷新。

随后请求：

```text
GET /api/office/<workspace-id>
```

[lib/office/load.ts](../../lib/office/load.ts) 重新读取完整快照：

```text
departments
bots
inbox_items
tasks
routines
activity
profiles
code_runs
```

返回内容示例：

```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "title": "查询今日金价并发送邮件",
      "status": "doing",
      "assigneeBotId": "executor-bot-uuid"
    }
  ],
  "bots": [
    {
      "id": "executor-bot-uuid",
      "status": "working",
      "statusDetail": "正在处理“查询今日金价并发送邮件”"
    }
  ],
  "activity": [
    {
      "botId": "executor-bot-uuid",
      "taskId": "task-uuid",
      "type": "run_started",
      "text": "开始处理“查询今日金价并发送邮件”"
    }
  ]
}
```

### 8.6 React 重新渲染

[components/office/office-provider.tsx](../../components/office/office-provider.tsx) 对比 JSON 快照签名，确认数据真的变化后执行：

```ts
setSnapshot(nextSnapshot);
```

然后具体 UI 自动变化：

| UI | 变化 |
|---|---|
| 顶部状态栏 | “工作中”数量加一，“休息中”数量减一 |
| 任务看板 | 任务卡片从“待处理”移动到“进行中” |
| 右侧“整个办公室” | 执行 Bot 被提升到“正在工作”区域 |
| Bot 行 | 副标题变成“正在处理……” |
| 楼层状态点 | 从休息中颜色变成工作中颜色 |
| 实时动态 | 新增“开始处理……” |
| Bot 详情抽屉 | 状态标签和活动时间线更新 |

任务看板的移动不是 worker 指定了“把卡片移过去”。React 重新执行分组：

```ts
backlog       → 待处理
doing         → 进行中
waiting_on_me → 待我处理
done          → 已完成
```

因为新快照中任务状态变成 `doing`，它自然出现在“进行中”列。

---

## 9. worker 构造后台执行上下文

worker 加载负责执行的 Bot、工作空间、笔记、任务看板和工具，并检查：

- 同一任务是否已有活跃运行。
- 当前工作空间是否已有 3 个 Bot 在工作。
- 今日费用是否超限。
- Bot 是否属于当前工作空间。

然后构建后台提示词：

```text
任务：查询今日金价并发送邮件
详情：查询今天的黄金价格，整理简明摘要，并发送到 recipient@example.com
分派人：幕僚长
```

模型循环最多 15 个步骤。每一步会更新：

```text
runs.steps
runs.input_tokens
runs.output_tokens
runs.cost_cents
activity
```

---

## 10. 执行 Bot 搜索今日金价

模型调用：

```ts
web_search({
  query: "今日黄金价格",
  limit: 6
})
```

[lib/research/tools.ts](../../lib/research/tools.ts) 使用自建 SearXNG 搜索：

```text
GET <SEARXNG_URL>/search?q=...&format=json
```

返回结果会包含标题、URL 和摘要。模型随后可能调用：

```ts
browser_extract({
  url: "https://...",
  maxChars: 12000
})
```

搜索与网页读取不是发送操作，因此直接执行，不需要审批。

每个模型步骤完成后，worker 写入活动，前端通过同一条 PostgreSQL NOTIFY → SSE → `refreshOffice()` 链路更新“实时动态”。

---

## 11. 模型调用 `send_email`

模型整理完金价后调用：

```ts
send_email({
  to: "recipient@example.com",
  subject: "今日金价摘要",
  text: "今日黄金价格是……"
})
```

工具定义在 [lib/email/tools.ts](../../lib/email/tools.ts)。

聊天和后台任务的行为不同：

```text
聊天：
  onApproval 不存在
  → 不发送
  → 提示先 create_task

后台 worker：
  onApproval = waitForApproval
  → 创建 inbox_items
  → 等待用户处理
```

因此幕僚长不能在聊天中直接声称“邮件已经发送”。它必须先把任务交给后台执行 Bot。

---

## 12. 后台创建审批事项 `inbox_items`

原始审批请求是：

```json
{
  "tool": "SMTP_SEND_EMAIL",
  "args": {
    "to": "recipient@example.com",
    "subject": "今日金价摘要",
    "text": "今日黄金价格……"
  },
  "calls": [
    {
      "tool": "SMTP_SEND_EMAIL",
      "args": {
        "to": "recipient@example.com",
        "subject": "今日金价摘要",
        "text": "今日黄金价格……"
      }
    }
  ],
  "reasons": ["这封邮件将通过 SMTP 发送给最终收件人。"]
}
```

`buildPreview` 把它转换成：

```json
{
  "title": "SMTP 邮箱：发送消息",
  "action": "send",
  "preview": {
    "text": "这封邮件将通过 SMTP 发送给最终收件人。",
    "calls": [
      {
        "tool": "SMTP_SEND_EMAIL",
        "args": {
          "to": "recipient@example.com",
          "subject": "今日金价摘要",
          "text": "今日黄金价格……"
        },
        "app": "SMTP 邮箱",
        "label": "发送消息"
      }
    ]
  }
}
```

写入 `public.inbox_items`：

```json
{
  "id": "inbox-item-uuid",
  "workspace_id": "workspace-uuid",
  "bot_id": "executor-bot-uuid",
  "task_id": "task-uuid",
  "run_id": "run-uuid",
  "kind": "approval",
  "action": "send",
  "tool_key": "SMTP_SEND_EMAIL",
  "title": "SMTP 邮箱：发送消息",
  "preview": {
    "text": "这封邮件将通过 SMTP 发送给最终收件人。",
    "calls": [
      {
        "tool": "SMTP_SEND_EMAIL",
        "args": {
          "to": "recipient@example.com",
          "subject": "今日金价摘要",
          "text": "今日黄金价格……"
        },
        "app": "SMTP 邮箱",
        "label": "发送消息"
      }
    ]
  },
  "input": {
    "to": "recipient@example.com",
    "subject": "今日金价摘要",
    "text": "今日黄金价格……"
  },
  "edited_payload": null,
  "answer": null,
  "status": "pending",
  "waitpoint_token_id": "wait-token-uuid",
  "decided_via": null,
  "decided_at": null
}
```

字段职责：

| 字段 | 职责 |
|---|---|
| `preview` | 展示应用、动作和参数 |
| `input` | 模型原始工具参数 |
| `edited_payload` | 用户编辑后的参数 |
| `status` | `pending / approved / rejected / expired` |
| `waitpoint_token_id` | 暂停任务与审批行之间的关联键 |
| `decided_via` | `web / telegram / slack` |

与此同时，worker 更新状态：

```text
tasks.status = waiting_on_me
runs.status = waiting
bots.status = waiting
bots.status_detail = 等待你批准：SMTP 邮箱：发送消息
```

并写入：

```text
activity.type = inbox_requested
activity.summary = 等待你批准：SMTP 邮箱：发送消息
```

---

## 13. worker 如何等待用户审批

worker 调用 [lib/jobs/wait.ts](../../lib/jobs/wait.ts) 中的等待逻辑。

它不是一直占用 CPU，也没有与浏览器保持连接，而是：

```text
每 2 秒查询一次 inbox_items
只要 status 还是 pending，就继续等待
status 变成 approved / rejected / expired 后返回
最长等待 72 小时
```

逻辑等价于：

```ts
while (true) {
  const item = await readInboxItem(tokenId);

  if (item.status !== "pending") {
    return item;
  }

  await sleep(2000);
}
```

worker 的 pg-boss 心跳继续保持任务存活。浏览器是否打开不影响等待状态。

---

## 14. 前端如何渲染审批 UI

审批行插入 `inbox_items` 后，数据库再次执行 `pg_notify`：

```json
{
  "table": "inbox_items",
  "op": "insert",
  "workspaceId": "workspace-uuid",
  "botId": "executor-bot-uuid",
  "taskId": "task-uuid"
}
```

随后：

```text
PostgreSQL pg_notify
  → Next.js LISTEN
  → SSE /api/events
  → RealtimeSync
  → refreshOffice()
  → GET /api/office/<workspace-id>
  → loadOffice()
  → snapshot.inbox
  → React 渲染 InboxCard
```

[lib/office/load.ts](../../lib/office/load.ts) 只读取：

```text
inbox_items.status = pending
```

并映射为：

```json
{
  "id": "inbox-item-uuid",
  "botId": "executor-bot-uuid",
  "kind": "approval",
  "action": "send",
  "title": "SMTP 邮箱：发送消息",
  "preview": "这封邮件将通过 SMTP 发送给最终收件人。",
  "taskId": "task-uuid",
  "calls": [
    {
      "tool": "SMTP_SEND_EMAIL",
      "args": {
        "to": "recipient@example.com",
        "subject": "今日金价摘要",
        "text": "今日黄金价格……"
      },
      "app": "SMTP 邮箱",
      "label": "发送消息"
    }
  ],
  "ago": "刚刚"
}
```

[components/inbox/inbox-card.tsx](../../components/inbox/inbox-card.tsx) 渲染卡片：

```text
执行 Bot 想要发送 · 刚刚
SMTP 邮箱：发送消息
这封邮件将通过 SMTP 发送给最终收件人。

SMTP 邮箱 · 发送消息
TO
recipient@example.com

SUBJECT
今日金价摘要

TEXT
今日黄金价格……

[批准] [编辑] [拒绝]
```

同时：

- 顶部“待我处理”数字加一。
- 左侧“待我处理”面板出现卡片。
- 任务看板移动到“待我处理”。
- Bot 状态变为“等待中”。
- Bot 详情活动页显示审批卡。
- Bot 聊天页内联显示审批卡。
- 右侧实时动态显示“等待你批准……”。

如果 Telegram 或 Slack 已关联，还会发送带按钮的审批卡；Telegram 的编辑入口会跳回网页。

---

## 15. 用户在网页批准、编辑或拒绝

点击“批准”时调用 Server Action：

```ts
decideApproval(itemId, "approve");
```

代码在 [inbox-actions.ts](<../../app/(routes)/workspace/inbox-actions.ts>)。

### 批准流程

1. 使用用户作用域客户端确认当前用户能看到这个事项。
2. 读取 `inbox_items`。
3. 确认类型是 `approval`。
4. 确认状态仍是 `pending`。
5. 确认没有超过 72 小时。
6. 如果有编辑，把字符串参数写入 `edited_payload`。
7. 更新：

```json
{
  "status": "approved",
  "decided_via": "web",
  "decided_at": "2026-11-22T..."
}
```

编辑参数只能改已存在的字符串字段，例如 `to`、`subject`、`text`，不能改变工具名称，也不能新增任意工具参数。

### 前端立即变化

1. 审批卡执行 `onDone()` 后消失。
2. 显示“执行 Bot 将继续执行”。
3. 主动调用 `refreshOffice()`。
4. 顶部待处理数量下降。
5. 数据库的 `inbox_items` 更新再次触发 SSE。

在 worker 下一次 2 秒轮询前，前端可能短暂仍然看到 Bot 为“等待中”。

### 拒绝流程

写入：

```json
{
  "status": "rejected",
  "decided_via": "web",
  "decided_at": "2026-11-22T..."
}
```

邮件不会发送。

---

## 16. worker 恢复并真正发送邮件

worker 每 2 秒读取审批行，发现状态不再是 `pending`，于是恢复：

```text
tasks.status = doing
runs.status = running
bots.status = working
```

并记录：

```text
activity.type = inbox_approved
activity.summary = 已获得你对“SMTP 邮箱：发送消息”的批准
```

审批参数选择规则：

```text
edited_payload 存在 → 使用 edited_payload
否则               → 使用 input
```

然后再次校验地址、主题和正文，再调用：

```ts
sendSmtpEmail(approved, config)
```

真正发送发生在这一步，不在模型第一次调用 `send_email` 时。

---

## 17. 完成、失败与结果回报

SMTP 成功后，模型生成最终报告，worker 写入：

```text
runs.status = completed
tasks.status = done
tasks.result = { "summary": "已查询今日金价并发送……" }
bots.status = resting
```

并插入活动：

```text
type = run_finished
summary = 完成“查询今日金价并发送邮件”
```

同时写入聊天线程：

```json
{
  "workspace_id": "workspace-uuid",
  "bot_id": "executor-bot-uuid",
  "role": "assistant",
  "parts": [
    {
      "type": "text",
      "text": "**已完成：查询今日金价并发送邮件**\n\n今日金价是……已发送到……"
    }
  ],
  "channel": "web",
  "ui_id": "task-task-uuid-..."
}
```

结果还会沿委派链回报给幕僚长：

```text
执行 Bot 的线程
幕僚长的线程
```

所以用户打开任一相关聊天，都能看到结果。

如果用户拒绝或审批超时：

- 邮件不发送。
- worker 把拒绝原因返回给模型。
- 任务通常仍以 `done` 结束，但报告中明确说明未发送。

如果 worker 崩溃：

- `runs` 中可能留下旧的 `running` 记录。
- 新 attempt 会先释放同一任务的陈旧运行。
- pg-boss 根据队列重试策略重新执行。

---

## 18. 刷新页面或 SSE 断开时如何补偿

### 18.1 SSE 通知会丢，业务状态不会丢

`pg_notify` 是瞬时通知，不持久化，也不会为断线客户端补发。

断线期间可能发生：

```text
backlog → doing → waiting_on_me → doing → done
```

重新进入页面时，可能直接看到：

```text
done
```

中间四条 SSE 事件不会逐条回放，但最终状态、活动记录、审批记录和聊天报告都在 PostgreSQL 中。

### 18.2 刷新页面的顺序

刷新页面时：

1. 旧 React 页面销毁，旧 `EventSource.close()`。
2. Next.js 重新执行 `loadOffice()`。
3. 第一次页面快照直接读取数据库当前状态。
4. React 挂载新的 `EventSource`。
5. SSE `onopen` 主动调用 `refreshOffice()`。
6. 之后的数据库变更继续通过 SSE 到达。

因此即使 worker 恰好在“页面首次读取数据库”和“新 SSE 连接建立”之间修改数据，`onopen` 的主动刷新也能捕获数据库最新状态。

### 18.3 同一个页面临时断网

前端有三层补偿：

1. `EventSource` 自动重连。
2. 重连成功后 `onopen` 主动刷新完整快照。
3. SSE 长时间没有恢复时：
   - 有任务执行或 Bot 工作时，每 15 秒刷新。
   - 完全空闲时，每 60 秒刷新。

从其他标签页切回当前页时，`visibilitychange` 也会触发刷新。

### 18.4 浏览器完全关闭

后台继续执行并写入数据库。

重新打开时：

- `loadOffice()` 加载当前任务状态。
- 加载仍为 `pending` 的审批事项。
- 加载已经完成的任务报告。
- 新的 SSE 连接继续接收后续变化。

### 18.5 当前架构能保证什么

可以保证：

- 刷新后看到数据库中的当前状态。
- 看到持久化的活动记录、审批和完成报告。
- 不因为错过 SSE 通知而永久停留在旧状态。
- 审批请求不会因为关闭浏览器而丢失。

不能保证：

- 逐条回放断线期间发生的每个状态变化。

如果以后需要严格的逐事件回放，应增加持久化事件表，例如：

```text
domain_events
  id
  workspace_id
  event_type
  payload
  created_at
```

前端保存 `last_event_id`，重连时从数据库补读缺失事件。当前设计不需要这一层，因为完整快照能够恢复正确 UI。

---

## 完整时序压缩图

```text
用户发送
  → POST /api/chat/<head-id>
  → INSERT messages
  → 幕僚长调用 create_task
  → INSERT tasks(status=backlog)
  → INSERT pgboss.job(name=bot-run)
  → worker 每 2 秒领取
  → INSERT runs
  → UPDATE tasks(doing) + bots(working) + INSERT activity
  → pg_notify
  → Next.js SSE
  → browser refreshOffice()
  → GET /api/office
  → React 显示进行中
  → 执行 Bot 调用 web_search
  → 执行 Bot 调用 send_email
  → INSERT inbox_items(status=pending)
  → UPDATE tasks(waiting_on_me) + runs(waiting) + bots(waiting)
  → pg_notify
  → browser refreshOffice()
  → React 渲染审批卡
  → 用户批准 / 编辑 / 拒绝
  → UPDATE inbox_items(status=approved|rejected)
  → worker 每 2 秒轮询并恢复
  → approved: SMTP 发送
  → rejected/expired: 不发送
  → UPDATE tasks(done|failed) + runs(completed|failed) + bots(resting|error)
  → INSERT messages 报告 + activity
  → 前端通过 SSE 或轮询更新最终 UI
```

## 相关代码

- [聊天接口](<../../app/api/chat/[botId]/route.ts>)
- [Bot 上下文与任务工具](../../lib/chat/bot-context.ts)
- [任务入队](../../lib/runs/start.ts)
- [pg-boss 队列](../../lib/jobs/queue.ts)
- [worker 入口](../../jobs/worker.ts)
- [后台 Bot 执行](../../jobs/bot-run.ts)
- [审批等待](../../jobs/approvals.ts)
- [邮件工具](../../lib/email/tools.ts)
- [审批记录构造](../../lib/approvals/describe.ts)
- [审批决策](../../lib/inbox/decide.ts)
- [PostgreSQL 变更触发器](../../db/migrations/9999_realtime_events.sql)
- [SSE 接口](../../app/api/events/route.ts)
- [前端实时同步](../../components/office/realtime-sync.tsx)
- [办公室快照加载](../../lib/office/load.ts)
- [审批卡组件](../../components/inbox/inbox-card.tsx)
