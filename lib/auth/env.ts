import { hasDatabaseEnv } from "@/lib/db/env";

const AUTH_EMAIL_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const;

export const hasAuthEmailEnv =
  AUTH_EMAIL_KEYS.every((key) => Boolean(process.env[key]?.trim())) &&
  process.env.EMAIL_FROM?.trim().toLowerCase() === process.env.SMTP_USER?.trim().toLowerCase();

export const hasAuthCoreEnv = hasDatabaseEnv && Boolean(process.env.BETTER_AUTH_SECRET?.trim());
