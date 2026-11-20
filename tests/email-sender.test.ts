import assert from "node:assert/strict";
import test from "node:test";
import type { SentMessageInfo, Transporter } from "nodemailer";
import { smtpConfigFromEnv } from "../lib/email/config";
import { sendSmtpEmail } from "../lib/email/sender";

const config = smtpConfigFromEnv({
  SMTP_HOST: "smtp.qq.com",
  SMTP_PORT: "587",
  SMTP_USER: "bot@example.com",
  SMTP_PASS: "test-authorization-code",
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
      throw new Error("bad test-authorization-code");
    },
  } as unknown as Pick<Transporter, "sendMail">;
  const result = await sendSmtpEmail(
    { to: "to@example.com", subject: "hi", text: "body" },
    config,
    transport,
  );
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /\[redacted\]/);
  assert.doesNotMatch(result.ok ? "" : result.error, /test-authorization-code/);
});
