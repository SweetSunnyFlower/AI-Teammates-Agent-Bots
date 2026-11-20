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
