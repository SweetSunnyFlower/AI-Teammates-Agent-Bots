import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "./fetch";

/**
 * Service-role client (bypasses RLS) for writes users may not make directly, such as answering
 * an inbox question. SERVER ONLY. Always verify ownership with the user's client first.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is missing from .env.local.");
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithRetry },
  });
}
