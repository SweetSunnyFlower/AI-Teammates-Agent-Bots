import assert from "node:assert/strict";
import test from "node:test";
import { sendVerificationEmail } from "../lib/auth/email";
import type { EmailRequest, SmtpConfig } from "../lib/email/config";

const config: SmtpConfig = {
  host: "smtp.qq.com",
  port: 587,
  secure: false,
  requireTls: true,
  user: "bot@example.com",
  pass: "test-authorization-code",
  from: "bot@example.com",
};

test("verification email includes the greeting, URL and expiry", async () => {
  let request: EmailRequest | undefined;

  const result = await sendVerificationEmail(
    {
      email: "alice@example.com",
      name: "Alice",
      url: "http://localhost:3000/api/auth/verify-email?token=abc",
    },
    {
      config,
      send: async (input) => {
        request = input;
        return {
          ok: true,
          messageId: "message-1",
          response: "ok",
          accepted: [input.to],
          rejected: [],
          partial: false,
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(request?.to, "alice@example.com");
  assert.match(request?.text ?? "", /Alice，/);
  assert.match(request?.text ?? "", /token=abc/);
  assert.match(request?.text ?? "", /1 小时/);
});

test("verification email surfaces SMTP failures", async () => {
  await assert.rejects(
    () =>
      sendVerificationEmail(
        { email: "alice@example.com", url: "https://example.com/verify" },
        {
          config,
          send: async () => ({ ok: false, error: "smtp down" }),
        },
      ),
    /smtp down/,
  );
});
