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
  SMTP_PASS: "test-authorization-code",
  EMAIL_FROM: "bot@example.com",
};

test("SMTP config supports QQ STARTTLS settings", () => {
  assert.deepEqual(smtpConfigFromEnv(env), {
    host: "smtp.qq.com",
    port: 587,
    secure: false,
    requireTls: true,
    user: "bot@example.com",
    pass: "test-authorization-code",
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
    sanitizeSmtpError(new Error("auth failed test-authorization-code"), config),
    "auth failed [redacted]",
  );
});
