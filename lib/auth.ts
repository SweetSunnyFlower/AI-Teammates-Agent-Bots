import { betterAuth } from "better-auth";
import { dbPool } from "@/lib/db/pool";

const siteUrl =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ||
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "http://localhost:3000";
const authSecret =
  process.env.BETTER_AUTH_SECRET ||
  (process.env.NEXT_PHASE === "phase-production-build" ? "dotty-build-only-secret-not-used-at-runtime" : undefined);

export const auth = betterAuth({
  appName: "Dotty",
  baseURL: siteUrl,
  secret: authSecret,
  database: dbPool(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  user: {
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
  },
  account: {
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  verification: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  advanced: {
    database: { generateId: false },
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  trustedOrigins: [siteUrl],
});
