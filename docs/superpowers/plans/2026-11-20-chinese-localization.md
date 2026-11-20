# Dotty 单中文汉化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Dotty 的用户界面、AI 行为、渠道消息和用户文档完整切换为简体中文。

**Architecture:** 直接替换现有英文文案，不增加语言路由、语言切换器或 i18n 字典。
数据库值、API 字段、环境变量、代码标识符和内部日志保持英文；用户可见错误、状态、
工具提示和 AI 指令使用中文。

**Tech Stack:** Next.js 16、React 19、TypeScript、AI SDK v7、DeepSeek、PostgreSQL、
pg-boss、Telegram/Slack Chat SDK。

## Global Constraints

- 默认且唯一用户语言是简体中文。
- 不创建 `[lang]` 路由、不安装 i18n 依赖、不增加语言切换器。
- 保留数据库枚举、API 字段、路由、环境变量名和 TypeScript 标识符。
- 保留内部日志、代码注释、第三方 API 原始错误和维护者架构文档的英文。
- 用户输入、用户创建的名称、仓库名、分支名、命令和 URL 不翻译。
- 术语统一使用：工作空间、办公室、楼层、部门、总控 Bot、主管 Bot、执行 Bot、
  待我处理、任务看板、例行任务、连接器、渠道、审批、工作中、等待中、休息中、出错。

---

### Task 1: Localization regression contract

**Files:**
- Create: `tests/localization.test.ts`

**Interfaces:**
- Consumes: source files from `app/`, `components/`, `lib/`, and `jobs/`.
- Produces: Node test assertions that fail while the UI and AI prompts remain English.

- [ ] **Step 1: Write the failing localization contract**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

test("the document language and metadata are Chinese", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /lang="zh-CN"/);
  assert.match(layout, /description:\s*"[^"]*[\u4e00-\u9fff][^"]*"/);
});

test("the AI prompt explicitly requires Simplified Chinese", () => {
  const prompt = read("lib/chat/bot-context.ts");
  assert.match(prompt, /简体中文/);
  assert.doesNotMatch(prompt, /Be brief and friendly, like a capable coworker/);
});

test("the office shell uses Chinese status and panel titles", () => {
  const status = read("lib/office/status.ts");
  const panels = read("components/panels/left-column.tsx");
  assert.match(status, /工作中/);
  assert.match(status, /等待中/);
  assert.match(status, /休息中/);
  assert.match(panels, /待我处理/);
});
```

- [ ] **Step 2: Run the failing test**

Run: `node --import tsx --test --test-name-pattern='document language|Simplified Chinese|office shell' tests/localization.test.ts`

Expected: FAIL until `lang="zh-CN"`, Chinese metadata, Chinese prompts and Chinese status labels exist.

- [ ] **Step 3: Commit the regression contract after the implementation starts**

```bash
git add tests/localization.test.ts
git commit -m "test: cover Chinese localization contract"
```

### Task 2: Global shell, auth and onboarding

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/global-error.tsx`
- Modify: `app/not-found.tsx`
- Modify: `app/(routes)/error.tsx`
- Modify: `app/(routes)/(landing)/page.tsx`
- Modify: `app/(routes)/auth/error/page.tsx`
- Modify: `app/(routes)/auth/login/page.tsx`
- Modify: `components/auth/login-card.tsx`
- Modify: `app/(routes)/workspace/new/page.tsx`
- Modify: `components/workspace/create-workspace-card.tsx`
- Modify: `components/errors/error-card.tsx`
- Modify: `components/theme-toggle.tsx`

**Interfaces:**
- Consumes: root layout metadata and Next.js error boundaries.
- Produces: Chinese document language, page titles, authentication flow and workspace creation.

- [ ] **Step 1: Translate every visible string in these files**

Use these exact core replacements:

```tsx
<html lang="zh-CN">
title: "Dotty — 3D 办公室里的 AI 团队"
description: "在一个迷你 3D 办公室里运行你的 AI Bot 团队。"
```

Translate labels such as `Welcome to Dotty`, `Sign in`, `Create account`, `name`, `email`,
`password`, `New workspace`, `preview`, loading and error text. Keep environment variable names,
email addresses, passwords and technical error details unchanged inside code spans.

- [ ] **Step 2: Run the focused checks**

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `node --import tsx --test --test-name-pattern='document language' tests/localization.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app components tests/localization.test.ts
git commit -m "feat: localize global shell and onboarding"
```

### Task 3: Office, team and bot management

**Files:**
- Modify: `lib/office/status.ts`
- Modify: `lib/office/mock-data.ts`
- Modify: `components/office/top-bar.tsx`
- Modify: `components/office/office-screen.tsx`
- Modify: `components/office/office-stage.tsx`
- Modify: `components/office/scene/office-canvas.tsx`
- Modify: `components/office/scene/floor.tsx`
- Modify: `components/office/use-office-life.ts`
- Modify: `components/panels/left-column.tsx`
- Modify: `components/panels/right-column.tsx`
- Modify: `components/panels/bot-drawer.tsx`
- Modify: `components/panels/panel.tsx`
- Modify: `components/team/team-dialogs.tsx`
- Modify: `components/team/bot-dialog.tsx`
- Modify: `components/team/department-dialog.tsx`
- Modify: `components/team/form-bits.tsx`

**Interfaces:**
- Consumes: internal status values `working`, `waiting`, `resting`, `error`.
- Produces: Chinese labels and copy while retaining internal status values.

- [ ] **Step 1: Translate status labels and office copy**

Use these exact status labels:

```ts
working: "工作中"
waiting: "等待中"
resting: "休息中"
error: "出错"
```

Translate `Your Team`, `Live Activity`, `Whole office`, `Boards`, `Routines`, `Settings`,
`Waiting on me`, `Add bot`, `Add department`, tooltips, empty states, form labels, confirmation
dialogues, validation messages and toast text. Replace visible role values with `总控 Bot`,
`主管 Bot`, and `执行 Bot`.

- [ ] **Step 2: Verify office and team behavior**

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `node --import tsx --test --test-name-pattern='office shell' tests/localization.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/office components/office components/panels components/team
git commit -m "feat: localize office and team management"
```

### Task 4: Chat, boards, inbox and settings

**Files:**
- Modify: `components/chat/ask-head.tsx`
- Modify: `components/chat/bot-chat.tsx`
- Modify: `components/boards/board-dialog.tsx`
- Modify: `components/boards/board-toggle-button.tsx`
- Modify: `components/boards/board-view.tsx`
- Modify: `components/boards/task-panel.tsx`
- Modify: `components/inbox/inbox-card.tsx`
- Modify: `components/routines/routine-item.tsx`
- Modify: `components/team/routine-dialog.tsx`
- Modify: `components/settings/settings-dialog.tsx`
- Modify: `components/settings/workspace-tab.tsx`
- Modify: `components/settings/channels-tab.tsx`
- Modify: `components/settings/github-card.tsx`
- Modify: `components/team/use-connected-apps.ts`
- Modify: `components/ui/dialog.tsx`
- Modify: `components/ui/skeleton.tsx`

**Interfaces:**
- Consumes: Chinese status labels from Task 3 and existing action result shapes.
- Produces: Chinese primary product workflows without changing action payloads.

- [ ] **Step 1: Translate visible workflow strings**

Translate headings, tabs, buttons, placeholders, validation errors, approval summaries,
question cards, task metadata, activity descriptions, settings labels, channel instructions,
empty states, loading labels, close buttons and toast messages.

Use these exact core replacements:

```text
Chat → 聊天
Activity → 动态
Routines → 例行任务
Setup → 设置
Send → 发送
Approve → 批准
Edit → 编辑
Reject → 拒绝
Retry → 重试
Loading… → 加载中…
```

Keep `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `SLACK_CLIENT_ID`, `npm run ...`, repository names and
other technical examples unchanged.

- [ ] **Step 2: Verify the workflows**

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add components/chat components/boards components/inbox components/routines components/settings components/ui
git commit -m "feat: localize chat boards inbox and settings"
```

### Task 5: Server actions, tools and channels

**Files:**
- Modify: `app/(routes)/workspace/actions.ts`
- Modify: `app/(routes)/workspace/channel-actions.ts`
- Modify: `app/(routes)/workspace/chat-actions.ts`
- Modify: `app/(routes)/workspace/connector-actions.ts`
- Modify: `app/(routes)/workspace/github-actions.ts`
- Modify: `app/(routes)/workspace/inbox-actions.ts`
- Modify: `app/(routes)/workspace/routine-actions.ts`
- Modify: `app/(routes)/workspace/task-actions.ts`
- Modify: `app/(routes)/workspace/team-actions.ts`
- Modify: `app/(routes)/workspace/workspace-settings-actions.ts`
- Modify: `app/api/chat/[botId]/route.ts`
- Modify: `app/api/events/route.ts`
- Modify: `app/api/office/[workspaceId]/apps/route.ts`
- Modify: `app/api/office/[workspaceId]/route.ts`
- Modify: `lib/auth/session.ts`
- Modify: `lib/db/client.ts`
- Modify: `lib/db/server.ts`
- Modify: `lib/inbox/decide.ts`
- Modify: `lib/routines/store.ts`
- Modify: `lib/routines/propose.ts`
- Modify: `lib/research/extract.ts`
- Modify: `lib/research/search.ts`
- Modify: `lib/github/tools.ts`
- Modify: `lib/code/sandbox.ts`
- Modify: `lib/chat/slack-oauth.ts`

**Interfaces:**
- Consumes: existing `{ ok, error }` and thrown-error contracts.
- Produces: the same contracts with Chinese messages intended for users and models.

- [ ] **Step 1: Translate user and model-facing errors**

Translate error and success messages returned to UI, server actions, AI tools and channel users.
Keep technical identifiers, URLs, status codes and raw upstream error bodies. Use this pattern:

```ts
return { ok: false, error: "连接 GitHub 失败，请稍后重试。" };
```

Do not translate internal logger calls or comments such as `logger.error("worker failed")`.

- [ ] **Step 2: Run type and unit checks**

Run: `npx tsc --noEmit && npm test`

Expected: exit 0 and all tests pass.

- [ ] **Step 3: Commit**

```bash
git add app lib
git commit -m "feat: localize server feedback and tool errors"
```

### Task 6: AI prompts, bot runs and Telegram/Slack

**Files:**
- Modify: `lib/chat/bot-context.ts`
- Modify: `lib/chat/channel-turn.ts`
- Modify: `lib/chat/cards.ts`
- Modify: `lib/chat/handlers.ts`
- Modify: `lib/chat/notify.ts`
- Modify: `lib/chat/side-tools.ts`
- Modify: `jobs/approvals.ts`
- Modify: `jobs/bot-run.ts`
- Modify: `jobs/engineering-run.ts`
- Modify: `lib/runs/recover.ts`

**Interfaces:**
- Consumes: model instructions, tool descriptions, task reports and channel card builders.
- Produces: Chinese AI behaviour while retaining tool names and machine-readable values.

- [ ] **Step 1: Add the language rule and translate prompts**

Add this exact rule to every top-level instruction builder:

```text
默认使用简体中文回复。只有用户明确要求其他语言时，才切换到用户指定的语言。
```

Translate role instructions, tool `.describe()` strings, task prompts, approval notes, timeout
reasons, background reports, progress messages and Telegram/Slack buttons. Translate channel
language from `The user is writing...` to Chinese while preserving the channel name.

- [ ] **Step 2: Run the AI contract checks**

Run: `node --import tsx --test --test-name-pattern='Simplified Chinese' tests/localization.test.ts`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/chat jobs lib/runs
git commit -m "feat: localize AI prompts and channel messages"
```

### Task 7: User documentation and environment comments

**Files:**
- Modify: `README.md`
- Modify: `deploy/README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: current self-hosted startup and deployment behavior.
- Produces: Chinese installation, operation and troubleshooting documentation.

- [ ] **Step 1: Translate documentation without changing commands**

Translate headings, explanations, notes, expected output descriptions and troubleshooting text.
Keep all command blocks byte-for-byte executable. Keep variable names, package names, image names,
URLs and code identifiers unchanged.

- [ ] **Step 2: Check Markdown and links**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `rg -n '^```' README.md deploy/README.md`

Expected: every opened code fence has a matching close.

- [ ] **Step 3: Commit**

```bash
git add README.md deploy/README.md .env.example
git commit -m "docs: translate setup and deployment guides"
```

### Task 8: Full verification and browser walkthrough

**Files:**
- Modify only files that fail verification.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a verified Chinese-only application and clean commit history.

- [ ] **Step 1: Run automated verification**

Run: `npm test`

Expected: all tests pass.

Run: `npx tsc --noEmit`

Expected: exit 0.

Run: `npm run lint`

Expected: 0 errors.

Stop the running dev server, run `npm run build`, then restart `npm run dev`.

Expected: exit 0.

- [ ] **Step 2: Scan for obvious visible English**

Run:

```bash
rg -n --glob '*.{tsx,ts}' \
  '(Loading|Couldn.t|Something went wrong|Sign in|Create account|Settings|Workspace|Waiting on me|Live Activity|Your Team|Add bot|Save|Delete|Retry|Approve|Reject)' \
  app components lib jobs
```

Expected: only internal identifiers, code comments, technical errors or intentionally English
values remain.

- [ ] **Step 3: Browser test**

Open `http://localhost:3000/workspace/5728f34a-7994-4b6e-95d7-01548d04545c` and verify:

- The office, team panel, activity panel, top bar and bot drawer are Chinese.
- Chat placeholder, loading label, errors and tool statuses are Chinese.
- Board, inbox, routines and settings are Chinese.
- 375px, 768px, 1024px and desktop widths do not clip Chinese text.
- A Chinese chat request receives a Chinese reply.
- A request explicitly asking for English receives an English reply.

- [ ] **Step 4: Commit final fixes**

```bash
git add -A
git commit -m "fix: polish Chinese localization"
```
