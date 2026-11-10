import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { fetchWithRetry } from "./fetch";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Create a new client per request — never store it in a module-level variable.
 */
export async function createClient() {
  // Supabase data is always per-user and per-request. With Cache Components (and partial
  // prefetching) cookies can resolve during prerendering, and the auth client then reads the
  // clock (token expiry) — so stop prerendering here.
  await connection();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: fetchWithRetry },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component (can't set cookies there). Safe to ignore:
            // proxy.ts refreshes the session on every request.
          }
        },
      },
    },
  );
}
