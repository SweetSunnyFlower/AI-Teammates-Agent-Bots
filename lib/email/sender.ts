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
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const accepted = strings(info.accepted);
    const rejected = strings(info.rejected);
    if (!accepted.length) {
      return {
        ok: false,
        error: rejected.length
          ? `SMTP 拒绝了收件人：${rejected.join(", ")}`
          : "SMTP 没有接受任何收件人。",
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
