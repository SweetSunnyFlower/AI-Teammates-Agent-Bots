/** True once NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set in .env.local. */
export const hasSupabaseEnv = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/** Only allow same-site relative redirects (blocks "//evil.com" and absolute URLs). */
export function safeNext(raw: string | null | undefined, fallback = "/workspace") {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}
