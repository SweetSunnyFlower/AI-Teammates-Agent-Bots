import assert from "node:assert/strict";
import test from "node:test";
import type { SmtpConfig } from "../lib/email/config";
import { handleSendEmail } from "../lib/email/tools";

const config: SmtpConfig = {
  host: "smtp.qq.com",
  port: 587,
  secure: false,
  requireTls: true,
  user: "bot@example.com",
  pass: "test-authorization-code",
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

test("invalid edited approval content is rejected before SMTP", async () => {
  let sent = 0;
  const result = await handleSendEmail(request, {
    config,
    onApproval: async () => ({
      approved: true,
      args: { ...request, to: "not-an-email" },
    }),
    send: async () => {
      sent += 1;
      return { ok: false, error: "not called" };
    },
  });
  assert.equal(sent, 0);
  assert.equal(result.ok, false);
});
