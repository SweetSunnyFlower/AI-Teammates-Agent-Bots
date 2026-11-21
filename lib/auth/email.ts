import { smtpConfigFromEnv, type EmailRequest, type SmtpConfig } from "@/lib/email/config";
import { sendSmtpEmail, type SendEmailResult } from "@/lib/email/sender";

export interface VerificationEmailInput {
  email: string;
  name?: string;
  url: string;
}

type VerificationEmailDeps = {
  config?: SmtpConfig;
  send?: (request: EmailRequest, config: SmtpConfig) => Promise<SendEmailResult>;
};

export async function sendVerificationEmail(
  input: VerificationEmailInput,
  deps: VerificationEmailDeps = {},
) {
  const config = deps.config ?? smtpConfigFromEnv();
  const send = deps.send ?? sendSmtpEmail;
  const greeting = input.name?.trim() ? `${input.name.trim()}，` : "你好，";
  const text = [
    greeting,
    "",
    "欢迎使用 Dotty。请点击下面的链接验证你的邮箱：",
    input.url,
    "",
    "链接 1 小时内有效，且只能使用一次。",
    "如果这不是你本人的操作，可以忽略这封邮件。",
  ].join("\n");

  const result = await send(
    {
      to: input.email,
      subject: "验证你的 Dotty 邮箱",
      text,
    },
    config,
  );
  if (!result.ok) throw new Error(`验证邮件发送失败：${result.error}`);
  return result;
}
