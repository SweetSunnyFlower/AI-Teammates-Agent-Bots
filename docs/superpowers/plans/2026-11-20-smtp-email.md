# SMTP Email Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-Bot, manually selectable `send_email` tool that sends plain-text mail through configured SMTP only after a user approves an editable background-task card.

**Architecture:** Keep SMTP configuration, validation, transport, and AI-tool adaptation in separate `lib/email/` modules. Reuse the existing approval callback so chat never sends directly, while pg-boss background runs pause on `inbox_items` before invoking Nodemailer.

**Tech Stack:** TypeScript, AI SDK v7 tools, Zod 4, Nodemailer 10.6.1, Node test runner, Next.js 16, pg-boss worker.

## Global Constraints

- Simplified Chinese is the only user-facing language.
- `email.send` is available to every Bot role but is never enabled automatically.
- The Head Bot must also require an explicit `email.send` selection.
- Chat must never send email directly; only background runs may request approval and send.
- SMTP credentials stay only in ignored server-side environment files and never appear in logs, errors, approval cards, tests, or Git.
- `EMAIL_FROM` must match `SMTP_USER`.
- Port 587 uses STARTTLS; port 465 uses implicit TLS.
- No attachments, HTML bodies, inbox reading, templates, scheduling, or automatic retries.
- Sending requires an approved `SMTP_SEND_EMAIL` approval; edited arguments are revalidated.

---

## File Structure

Create:

- `lib/approvals/types.ts` — provider-neutral approval request and decision types.
- `lib/email/config.ts` — environment validation and email-address normalization.
- `lib/email/sender.ts` — Nodemailer transport, verify, send, and result normalization.
- `lib/email/tools.ts` — approval-aware `send_email` AI tool.
- `scripts/email-check.ts` — SMTP login/TLS verification without sending mail.
- `tests/email-config.test.ts` — config and address validation tests.
- `tests/email-sender.test.ts` — delivery-result tests.
- `tests/email-tool.test.ts` — approval and chat-safety tests.
- `tests/email-catalog.test.ts` — per-Bot tool selection tests.

Modify:

- `package.json` and `package-lock.json` — Nodemailer dependencies and `email:check`.
- `lib/integrations/composio.ts` — import shared approval types instead of defining them.
- `lib/github/tools.ts` — import `ApprovalHandler` from the provider-neutral module.
- `jobs/approvals.ts` — import approval types from the provider-neutral module.
- `lib/office/tools.ts` — add the `沟通` group and `email.send`.
- `lib/chat/bot-context.ts` — expose the email tool only when explicitly selected and pass approval callbacks.
- `jobs/bot-run.ts` — give background runs the real approval handler.
- `lib/approvals/describe.ts` — render `SMTP_SEND_EMAIL` as “SMTP 邮箱 · 发送消息”.
- `.env.example` — document SMTP variables with non-secret placeholders.
- `README.md` — document setup and verification.

---

### Task 1: Decouple approval types from Composio

**Files:**

- Create: `lib/approvals/types.ts`
- Modify: `lib/integrations/composio.ts`
- Modify: `lib/github/tools.ts`
- Modify: `jobs/approvals.ts`

**Interfaces:**

- Consumes: no earlier task.
- Produces: `GatedCall`, `ApprovalRequest`, `ApprovalDecision`, and `ApprovalHandler` from `@/lib/approvals/types`.

- [ ] **Step 1: Baseline TypeScript before moving types**

Run:

```bash
npx tsc --noEmit
```

Expected: exit 0 with no output.

- [ ] **Step 2: Add the provider-neutral approval types**

Create `lib/approvals/types.ts`:

```ts
import type { PrPreview } from "./describe";

/** One concrete action inside an approval, including a batched app call. */
export interface GatedCall {
  tool: string;
  args: Record<string, unknown>;
}

/** What the user is asked to approve. */
export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  calls: GatedCall[];
  /** Human-readable reasons from the provider, if any. */
  reasons: string[];
  /** Merge approvals: the pull request being merged. */
  pr?: PrPreview;
}

export type ApprovalDecision =
  | { approved: true; args: Record<string, unknown> }
  | { approved: false; reason: string };

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;
```

- [ ] **Step 3: Make Composio consume and re-export the shared types**

In `lib/integrations/composio.ts`, replace the local `GatedCall`, `ApprovalRequest`,
`ApprovalDecision`, and `ApprovalHandler` declarations with:

```ts
import type {
  ApprovalDecision,
  ApprovalHandler,
  ApprovalRequest,
  GatedCall,
} from "@/lib/approvals/types";

export type {
  ApprovalDecision,
  ApprovalHandler,
  ApprovalRequest,
  GatedCall,
} from "@/lib/approvals/types";
```

Keep the existing functions and runtime behavior unchanged.

- [ ] **Step 4: Update direct consumers**

Change the import in `lib/github/tools.ts` to:

```ts
import type { ApprovalHandler } from "@/lib/approvals/types";
```

Change the import in `jobs/approvals.ts` to:

```ts
import type { ApprovalDecision, ApprovalRequest } from "@/lib/approvals/types";
```

- [ ] **Step 5: Verify type identity and runtime imports**

Run:

```bash
npx tsc --noEmit
npm test
```

Expected: TypeScript exits 0 and all 11 existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/approvals/types.ts lib/integrations/composio.ts lib/github/tools.ts jobs/approvals.ts
git commit -m "refactor: share approval types across tools"
```

---

### Task 2: Add SMTP configuration and request validation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/email/config.ts`
- Create: `tests/email-config.test.ts`

**Interfaces:**

- Consumes: no earlier task.
- Produces:
  - `SmtpConfig`
  - `EmailRequest`
  - `NormalizedEmail`
  - `SmtpConfigError`
  - `smtpConfigFromEnv(env?: NodeJS.ProcessEnv): SmtpConfig`
  - `normalizeEmailRequest(request: EmailRequest, config: SmtpConfig): NormalizedEmail`
  - `sanitizeSmtpError(error: unknown, config: SmtpConfig): string`

- [ ] **Step 1: Install the current Nodemailer packages**

Run:

```bash
npm install nodemailer@10.6.1
npm install --save-dev @types/nodemailer@8.0.2
```

Expected: `package.json` and `package-lock.json` update successfully.

- [ ] **Step 2: Write the failing configuration tests**

Create `tests/email-config.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  SmtpConfigError,
  normalizeEmailRequest,
  sanitizeSmtpError,
  smtpConfigFromEnv,
  type SmtpConfig,
} from "../lib/email/config";

const env = {
  SMTP_HOST: "smtp.qq.com",
  SMTP_PORT: "587",
  SMTP_USER: "bot@example.com",
  SMTP_PASS: "secret-code",
  EMAIL_FROM: "bot@example.com",
};

test("SMTP config supports QQ STARTTLS settings", () => {
  assert.deepEqual(smtpConfigFromEnv(env), {
    host: "smtp.qq.com",
    port: 587,
    secure: false,
    requireTls: true,
    user: "bot@example.com",
    pass: "secret-code",
    from: "bot@example.com",
  });
});

test("SMTP config rejects a mismatched sender", () => {
  assert.throws(
    () => smtpConfigFromEnv({ ...env, EMAIL_FROM: "other@example.com" }),
    SmtpConfigError,
  );
});

test("email requests normalize and deduplicate recipients", () => {
  const config: SmtpConfig = smtpConfigFromEnv(env);
  assert.deepEqual(
    normalizeEmailRequest(
      {
        to: "a@example.com, A@example.com,b@example.com",
        cc: "copy@example.com",
        subject: "  周报  ",
        text: "正文",
      },
      config,
    ),
    {
      from: "bot@example.com",
      to: ["a@example.com", "b@example.com"],
      cc: ["copy@example.com"],
      bcc: [],
      subject: "周报",
      text: "正文",
    },
  );
});

test("email requests reject header injection", () => {
  const config: SmtpConfig = smtpConfigFromEnv(env);
  assert.throws(() =>
    normalizeEmailRequest(
      {
        to: "a@example.com",
        subject: "hello\r\nBcc: attacker@example.com",
        text: "body",
      },
      config,
    ),
  );
});

test("SMTP errors redact the authorization code", () => {
  const config: SmtpConfig = smtpConfigFromEnv(env);
  assert.equal(
    sanitizeSmtpError(new Error("auth failed secret-code"), config),
    "auth failed [redacted]",
  );
});
```

Expected initial result: FAIL because `lib/email/config.ts` does not exist.

- [ ] **Step 3: Run the failing test**

Run:

```bash
node --import tsx --test tests/email-config.test.ts
```

Expected: FAIL with `Cannot find module '../lib/email/config'`.

- [ ] **Step 4: Implement configuration and validation**

Create `lib/email/config.ts`:

```ts
import { z } from "zod";

const EMAIL = z.string().email();
const MAX_ADDRESSES = 20;

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpConfigError";
  }
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface EmailRequest {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
}

export interface NormalizedEmail {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
}

function required(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new SmtpConfigError(`缺少 ${key}。`);
  return value;
}

function parseOneEmail(value: string, label: string) {
  if (!EMAIL.safeParse(value).success) throw new SmtpConfigError(`${label}不是有效的邮箱地址。`);
  return value;
}

export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = required(env, "SMTP_HOST");
  const port = Number(required(env, "SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SmtpConfigError("SMTP_PORT 必须是 1–65535 的整数。");
  }
  const user = parseOneEmail(required(env, "SMTP_USER"), "SMTP_USER");
  const pass = required(env, "SMTP_PASS");
  const from = parseOneEmail(required(env, "EMAIL_FROM"), "EMAIL_FROM");
  if (from.toLowerCase() !== user.toLowerCase()) {
    throw new SmtpConfigError("EMAIL_FROM 必须与 SMTP_USER 相同。");
  }
  return {
    host,
    port,
    secure: port === 465,
    requireTls: port === 587,
    user,
    pass,
    from,
  };
}

function parseAddresses(raw: string | undefined, field: string) {
  const values = (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) return [];
  if (values.length > MAX_ADDRESSES) {
    throw new SmtpConfigError(`${field}最多支持 ${MAX_ADDRESSES} 个收件人。`);
  }
  for (const value of values) {
    if (/[\r\n]/.test(value)) throw new SmtpConfigError(`${field}不能包含换行符。`);
    parseOneEmail(value, field);
  }
  const unique = new Map<string, string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

export function normalizeEmailRequest(request: EmailRequest, config: SmtpConfig): NormalizedEmail {
  if (/[\r\n]/.test(request.subject)) {
    throw new SmtpConfigError("邮件主题不能包含换行符。");
  }
  const subject = request.subject.trim();
  if (!subject || subject.length > 200) {
    throw new SmtpConfigError("邮件主题必须为 1–200 个字符。");
  }
  if (!request.text.trim() || request.text.length > 20_000) {
    throw new SmtpConfigError("邮件正文必须为 1–20,000 个字符。");
  }
  const to = parseAddresses(request.to, "收件人");
  if (!to.length) throw new SmtpConfigError("至少需要一个收件人。");
  return {
    from: config.from,
    to,
    cc: parseAddresses(request.cc, "抄送"),
    bcc: parseAddresses(request.bcc, "密送"),
    subject,
    text: request.text,
  };
}

export function sanitizeSmtpError(error: unknown, config: SmtpConfig) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(config.pass).join("[redacted]").slice(0, 500);
}
```

- [ ] **Step 5: Run the configuration tests**

Run:

```bash
node --import tsx --test tests/email-config.test.ts
```

Expected: 5 tests pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/email/config.ts tests/email-config.test.ts
git commit -m "feat: validate SMTP email configuration"
```

---

### Task 3: Implement SMTP transport and delivery results

**Files:**

- Create: `lib/email/sender.ts`
- Create: `tests/email-sender.test.ts`

**Interfaces:**

- Consumes:
  - `SmtpConfig`
  - `EmailRequest`
  - `NormalizedEmail`
  - `normalizeEmailRequest`
  - `sanitizeSmtpError`
- Produces:
  - `createSmtpTransport(config: SmtpConfig): Transporter`
  - `verifySmtp(transport?: Transporter): Promise<void>`
  - `sendSmtpEmail(request, config, transport?): Promise<SendEmailResult>`

- [ ] **Step 1: Write the failing sender tests**

Create `tests/email-sender.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { SentMessageInfo, Transporter } from "nodemailer";
import { smtpConfigFromEnv } from "../lib/email/config";
import { sendSmtpEmail } from "../lib/email/sender";

const config = smtpConfigFromEnv({
  SMTP_HOST: "smtp.qq.com",
  SMTP_PORT: "587",
  SMTP_USER: "bot@example.com",
  SMTP_PASS: "secret-code",
  EMAIL_FROM: "bot@example.com",
});

function fakeTransport(info: SentMessageInfo) {
  return {
    sendMail: async () => info,
  } as unknown as Pick<Transporter, "sendMail">;
}

test("successful SMTP delivery returns accepted recipients and message id", async () => {
  const result = await sendSmtpEmail(
    { to: "to@example.com", subject: "hi", text: "body" },
    config,
    fakeTransport({
      messageId: "msg-1",
      response: "250 OK",
      accepted: ["to@example.com"],
      rejected: [],
      pending: [],
    }),
  );
  assert.deepEqual(result, {
    ok: true,
    messageId: "msg-1",
    response: "250 OK",
    accepted: ["to@example.com"],
    rejected: [],
    partial: false,
  });
});

test("all recipients rejected is a delivery failure", async () => {
  const result = await sendSmtpEmail(
    { to: "to@example.com", subject: "hi", text: "body" },
    config,
    fakeTransport({
      messageId: "",
      response: "",
      accepted: [],
      rejected: ["to@example.com"],
      pending: [],
    }),
  );
  assert.equal(result.ok, false);
});

test("partial delivery reports rejected recipients without retrying", async () => {
  const result = await sendSmtpEmail(
    { to: "a@example.com,b@example.com", subject: "hi", text: "body" },
    config,
    fakeTransport({
      messageId: "msg-2",
      response: "250 OK",
      accepted: ["a@example.com"],
      rejected: ["b@example.com"],
      pending: [],
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.partial, true);
});

test("SMTP errors are returned with secrets redacted", async () => {
  const transport = {
    sendMail: async () => {
      throw new Error("bad secret-code");
    },
  } as unknown as Pick<Transporter, "sendMail">;
  const result = await sendSmtpEmail(
    { to: "to@example.com", subject: "hi", text: "body" },
    config,
    transport,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /\[redacted\]/);
  assert.doesNotMatch(result.ok ? "" : result.error, /secret-code/);
});
```

Expected initial result: FAIL because `lib/email/sender.ts` does not exist.

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --import tsx --test tests/email-sender.test.ts
```

Expected: FAIL with `Cannot find module '../lib/email/sender'`.

- [ ] **Step 3: Implement the sender**

Create `lib/email/sender.ts`:

```ts
import nodemailer, { type Transporter } from "nodemailer";
import {
  normalizeEmailRequest,
  sanitizeSmtpError,
  type EmailRequest,
  type SmtpConfig,
} from "./config";

type SendTransport = Pick<Transporter, "sendMail">;

export type SendEmailResult =
  | {
      ok: true;
      messageId: string;
      response: string;
      accepted: string[];
      rejected: string[];
      partial: boolean;
    }
  | { ok: false; error: string };

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

export function createSmtpTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });
}

export async function verifySmtp(transport: Transporter): Promise<void> {
  await transport.verify();
}

export async function sendSmtpEmail(
  request: EmailRequest,
  config: SmtpConfig,
  transport: SendTransport = createSmtpTransport(config),
): Promise<SendEmailResult> {
  try {
    const mail = normalizeEmailRequest(request, config);
    const info = await transport.sendMail({
      from: mail.from,
      to: mail.to,
      cc: mail.cc.length ? mail.cc : undefined,
      bcc: mail.bcc.length ? mail.bcc : undefined,
      subject: mail.subject,
      text: mail.text,
    });
    const accepted = strings(info.accepted);
    const rejected = strings(info.rejected);
    if (!accepted.length) {
      return {
        ok: false,
        error: rejected.length ? `SMTP 拒绝了收件人：${rejected.join(", ")}` : "SMTP 没有接受任何收件人。",
      };
    }
    return {
      ok: true,
      messageId: String(info.messageId ?? ""),
      response: String(info.response ?? ""),
      accepted,
      rejected,
      partial: rejected.length > 0,
    };
  } catch (error) {
    return { ok: false, error: sanitizeSmtpError(error, config) };
  }
}
```

- [ ] **Step 4: Run sender tests**

Run:

```bash
node --import tsx --test tests/email-sender.test.ts
```

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/email/sender.ts tests/email-sender.test.ts
git commit -m "feat: send mail through SMTP"
```

---

### Task 4: Add the approval-aware send_email tool

**Files:**

- Create: `lib/email/tools.ts`
- Create: `tests/email-tool.test.ts`
- Modify: `lib/chat/bot-context.ts`
- Modify: `jobs/bot-run.ts`
- Modify: `lib/approvals/describe.ts`

**Interfaces:**

- Consumes:
  - `ApprovalHandler`
  - `smtpConfigFromEnv`
  - `normalizeEmailRequest`
  - `sendSmtpEmail`
  - `SendEmailResult`
- Produces:
  - `handleSendEmail(request: EmailRequest, deps?: EmailToolDependencies): Promise<SendEmailResult | { ok: false; error: string }>`
  - `emailTools(options?: { onApproval?: ApprovalHandler }): ToolSet`

- [ ] **Step 1: Write failing approval-safety tests**

Create `tests/email-tool.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { handleSendEmail } from "../lib/email/tools";
import type { SmtpConfig } from "../lib/email/config";

const config: SmtpConfig = {
  host: "smtp.qq.com",
  port: 587,
  secure: false,
  requireTls: true,
  user: "bot@example.com",
  pass: "secret-code",
  from: "bot@example.com",
};

const request = {
  to: "to@example.com",
  subject: "周报",
  text: "正文",
};

test("chat mode never calls SMTP without an approval handler", async () => {
  let sent = 0;
  const result = await handleSendEmail(request, {
    config,
    send: async () => {
      sent += 1;
      return { ok: false, error: "not called" };
    },
  });
  assert.equal(sent, 0);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /后台任务/);
});

test("rejected approval never calls SMTP", async () => {
  let sent = 0;
  const result = await handleSendEmail(request, {
    config,
    onApproval: async () => ({ approved: false, reason: "驳回" }),
    send: async () => {
      sent += 1;
      return { ok: false, error: "not called" };
    },
  });
  assert.equal(sent, 0);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /驳回/);
});

test("approved edits are revalidated and sent", async () => {
  let sentRequest: unknown;
  const result = await handleSendEmail(request, {
    config,
    onApproval: async () => ({
      approved: true,
      args: { ...request, subject: "修改后的主题" },
    }),
    send: async (next) => {
      sentRequest = next;
      return {
        ok: true,
        messageId: "msg-1",
        response: "250 OK",
        accepted: ["to@example.com"],
        rejected: [],
        partial: false,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal((sentRequest as { subject?: string }).subject, "修改后的主题");
});
```

Expected initial result: FAIL because `lib/email/tools.ts` does not exist.

- [ ] **Step 2: Run the failing tool tests**

Run:

```bash
node --import tsx --test tests/email-tool.test.ts
```

Expected: FAIL with `Cannot find module '../lib/email/tools'`.

- [ ] **Step 3: Implement the email tool**

Create `lib/email/tools.ts`:

```ts
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ApprovalHandler } from "@/lib/approvals/types";
import {
  normalizeEmailRequest,
  smtpConfigFromEnv,
  type EmailRequest,
  type SmtpConfig,
} from "./config";
import { sendSmtpEmail, type SendEmailResult } from "./sender";

export interface EmailToolDependencies {
  onApproval?: ApprovalHandler;
  config?: SmtpConfig;
  send?: (request: EmailRequest, config: SmtpConfig) => Promise<SendEmailResult>;
}

export async function handleSendEmail(
  request: EmailRequest,
  deps: EmailToolDependencies = {},
): Promise<SendEmailResult> {
  const config = deps.config ?? smtpConfigFromEnv();
  normalizeEmailRequest(request, config);
  if (!deps.onApproval) {
    return {
      ok: false,
      error: "发送邮件需要用户批准，请用 create_task 创建后台任务并提供完整的收件人、主题和正文。",
    };
  }

  const decision = await deps.onApproval({
    tool: "SMTP_SEND_EMAIL",
    args: { ...request },
    calls: [{ tool: "SMTP_SEND_EMAIL", args: { ...request } }],
    reasons: ["这封邮件将通过 SMTP 发送给最终收件人。"],
  });
  if (!decision.approved) return { ok: false, error: decision.reason };

  const approved = decision.args as EmailRequest;
  normalizeEmailRequest(approved, config);
  return (deps.send ?? sendSmtpEmail)(approved, config);
}

export function emailTools(options: { onApproval?: ApprovalHandler } = {}): ToolSet {
  return {
    send_email: tool({
      description:
        "通过 SMTP 发送一封纯文本邮件。聊天中不会直接发送；必须创建后台任务，并在用户批准后才能发送。",
      inputSchema: z.object({
        to: z.string().min(3).max(2000).describe("收件人，多个地址用英文逗号分隔"),
        cc: z.string().max(2000).optional().describe("抄送，可选"),
        bcc: z.string().max(2000).optional().describe("密送，可选"),
        subject: z.string().min(1).max(200).describe("邮件主题"),
        text: z.string().min(1).max(20_000).describe("邮件的纯文本正文"),
      }),
      execute: (request) => handleSendEmail(request, options),
    }),
  };
}
```

- [ ] **Step 4: Wire the tool into chat and background runs**

In `lib/chat/bot-context.ts`:

```ts
import { emailTools } from "@/lib/email/tools";
import type { ApprovalHandler } from "@/lib/approvals/types";
```

Add to `ToolOptions`:

```ts
  /** Background runs provide approval; chat omits it and therefore cannot send. */
  onApproval?: ApprovalHandler;
```

After `...researchTools(...)` inside `buildChatTools`, add:

```ts
    ...(bot.tool_keys.includes("email.send")
      ? emailTools({ onApproval: options.onApproval })
      : {}),
```

Do not use the `has()` helper for this condition. That helper grants every Head Bot tool and
would bypass the explicit checkbox.

In `jobs/bot-run.ts`, add to the `buildChatTools` options:

```ts
      onApproval: (approval) => waitForApproval(pause, approval),
```

- [ ] **Step 5: Add the approval display name**

In `lib/approvals/describe.ts`, add to `APP_NAMES`:

```ts
  SMTP: "SMTP 邮箱",
```

- [ ] **Step 6: Run approval and email tests**

Run:

```bash
node --import tsx --test tests/email-tool.test.ts tests/email-config.test.ts tests/email-sender.test.ts
```

Expected: all email tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/email/tools.ts tests/email-tool.test.ts lib/chat/bot-context.ts jobs/bot-run.ts lib/approvals/describe.ts
git commit -m "feat: gate SMTP email behind task approval"
```

---

### Task 5: Add the per-Bot checkbox, configuration docs, and SMTP check

**Files:**

- Modify: `lib/office/tools.ts`
- Create: `tests/email-catalog.test.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Create: `scripts/email-check.ts`
- Modify: `package.json`
- Modify local ignored `.env.local` without printing secret values

**Interfaces:**

- Consumes:
  - `smtpConfigFromEnv`
  - `createSmtpTransport`
  - `verifySmtp`
- Produces: `npm run email:check`

- [ ] **Step 1: Write the failing catalog tests**

Create `tests/email-catalog.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_CATALOG, defaultToolsFor, toolsForRole } from "../lib/office/tools";

test("every Bot role can manually select email sending", () => {
  const entry = TOOL_CATALOG.find((tool) => tool.key === "email.send");
  assert.ok(entry);
  assert.equal(entry.label, "发送邮件");
  assert.equal(entry.group, "沟通");
  assert.equal(entry.gated, true);
  for (const role of ["head", "lead", "worker"] as const) {
    assert.ok(toolsForRole(role).some((tool) => tool.key === "email.send"));
  }
});

test("email sending is not enabled by default", () => {
  for (const role of ["head", "lead", "worker"] as const) {
    assert.equal(defaultToolsFor(role).includes("email.send"), false);
  }
});
```

Expected initial result: FAIL because `email.send` is absent.

- [ ] **Step 2: Run the failing catalog test**

Run:

```bash
node --import tsx --test tests/email-catalog.test.ts
```

Expected: FAIL with missing `email.send`.

- [ ] **Step 3: Add the catalog entry**

Change the group union in `lib/office/tools.ts`:

```ts
  group: "核心" | "研究" | "沟通";
```

Add:

```ts
  { key: "email.send", label: "发送邮件", group: "沟通", roles: ALL, gated: true },
```

Do not add it to `defaultToolsFor`.

- [ ] **Step 4: Run the catalog tests**

Run:

```bash
node --import tsx --test tests/email-catalog.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Add the non-sending SMTP verification script**

Create `scripts/email-check.ts`:

```ts
import { smtpConfigFromEnv } from "../lib/email/config";
import { createSmtpTransport, verifySmtp } from "../lib/email/sender";

const config = smtpConfigFromEnv();
await verifySmtp(createSmtpTransport(config));
console.log("SMTP 连接验证成功，未发送邮件。");
```

Add to `package.json`:

```json
"email:check": "node --env-file-if-exists=.env.local --import tsx scripts/email-check.ts",
```

- [ ] **Step 6: Document the environment variables without secrets**

Add to `.env.example`:

```dotenv
# ── Bot 邮件发送（可选 SMTP）─────────────────────────────────────────────────
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-provider-authorization-code
EMAIL_FROM=you@example.com
```

Add a README section stating:

- Every Bot role can select “设置 → 工具 → 沟通 → 发送邮件”.
- Chat creates a background task; sending happens only after approval.
- Run `npm run email:check` to verify login and TLS without sending mail.
- `.env.local` is ignored and credentials must not be committed.

- [ ] **Step 7: Put the user-provided SMTP settings into `.env.local` safely**

Check only key presence and masked state:

```bash
awk -F= '/^(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS|EMAIL_FROM)=/{ print $1 "=" (length($2) ? "<set>" : "<empty>") }' .env.local
```

Expected: all five keys print `<set>`. Never print the value of `SMTP_PASS`.

- [ ] **Step 8: Verify the real SMTP login without sending mail**

Run:

```bash
npm run email:check
```

Expected: `SMTP 连接验证成功，未发送邮件。`

- [ ] **Step 9: Verify tests and typecheck**

Run:

```bash
npm test
npx tsc --noEmit
```

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 10: Commit**

```bash
git add lib/office/tools.ts tests/email-catalog.test.ts .env.example README.md scripts/email-check.ts package.json package-lock.json
git commit -m "feat: expose SMTP email as a per-bot tool"
```

---

### Task 6: Full verification and manual approval flow

**Files:**

- No expected source edits unless verification finds a defect.

**Interfaces:**

- Consumes: all prior task outputs.
- Produces: verified feature and evidence.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
git diff --check
```

Expected:

```text
tests: 0 failures
tsc: exit 0
eslint: 0 errors
git diff --check: exit 0
```

- [ ] **Step 2: Stop development server and run a production build**

Run:

```bash
npm run build
```

Expected: exit 0 and every application route compiles.

- [ ] **Step 3: Restart the app and worker**

Run in separate terminals:

```bash
npm run dev
npm run worker:dev
```

Expected: Next.js is ready on `http://localhost:3000`; worker stays running.

- [ ] **Step 4: Verify the Bot setting in the browser**

Open an existing workspace, select a Bot, open **设置 → 工具**, and confirm:

```text
沟通
□ 发送邮件   需要审批
```

Toggle it on, save, reload, and confirm the checkbox remains selected.

- [ ] **Step 5: Verify the chat boundary**

Ask the selected Bot in chat to send a test email. Confirm it creates a background task and does
not claim the message was already sent.

- [ ] **Step 6: Verify the approval boundary**

Open **待我处理**. Confirm the card shows:

```text
SMTP 邮箱 · 发送消息
收件人、抄送、密送、主题、正文
批准 / 编辑 / 拒绝
```

For the first real delivery, use the mailbox owner’s address as recipient and explicitly approve
the exact visible message. Confirm the tool reports a non-empty `messageId`.

- [ ] **Step 7: Verify failure handling**

Reject another approval and confirm no SMTP send occurs. Temporarily test with an invalid recipient
in the editable card and confirm the tool returns a validation error without calling SMTP.

- [ ] **Step 8: Final repository verification**

Run:

```bash
git status --short --branch
git log -6 --oneline --decorate
```

Expected: only intended source, tests, documentation, and dependency files are committed; SMTP
secrets are absent from Git status and history.
