import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv } from "./env";
import { fetchWithRetry } from "./fetch";

// Kept in sync with lib/office/load.ts (proxy code must stay free of server-component imports).
const LAST_WORKSPACE_COOKIE = "dotty_last_ws";

/** Paths that need a signed-in user. Everything else (landing, /auth, /api) stays public. */
const PROTECTED_PREFIXES = ["/workspace"];

/**
 * Refreshes the Supabase session cookie on every request and guards protected routes.
 * Based on the official Next.js `with-supabase` example.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Until the keys are in .env.local, let every page load so the app still runs.
  if (!hasSupabaseEnv) return supabaseResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: fetchWithRetry },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims() — it refreshes the session.
  // getClaims() verifies the JWT; never trust getSession() in server code.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  const redirectKeepingCookies = (to: URL) => {
    const res = NextResponse.redirect(to);
    for (const cookie of supabaseResponse.cookies.getAll()) res.cookies.set(cookie);
    return res;
  };

  if (!signedIn && PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectKeepingCookies(url);
  }

  if (signedIn && pathname === "/auth/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/workspace";
    url.search = "";
    return redirectKeepingCookies(url);
  }

  // Remember the last workspace opened so /workspace can send the user back to it.
  const opened = signedIn ? /^\/workspace\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname) : null;
  if (opened && request.cookies.get(LAST_WORKSPACE_COOKIE)?.value !== opened[1]) {
    supabaseResponse.cookies.set(LAST_WORKSPACE_COOKIE, opened[1], {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  // Must return supabaseResponse as-is so the refreshed cookies reach the browser.
  return supabaseResponse;
}
