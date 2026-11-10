import { NextResponse } from "next/server";
import { safeNext } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth (Google) and default-template magic links land here with `?code=`.
 * Exchanges the PKCE code for a session cookie, then continues to `next`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const providerError = url.searchParams.get("error_description");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const base = process.env.NODE_ENV === "development" || !forwardedHost ? url.origin : `https://${forwardedHost}`;
      return NextResponse.redirect(`${base}${next}`);
    }
    return NextResponse.redirect(`${url.origin}/auth/error?error=${encodeURIComponent(error.message)}`);
  }

  const message = providerError ?? "The sign-in link is missing its code. Request a new link.";
  return NextResponse.redirect(`${url.origin}/auth/error?error=${encodeURIComponent(message)}`);
}
