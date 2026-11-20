import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * Compatibility route for links created by the previous Supabase deployment.
 * Better Auth owns the live callback under `/api/auth/*`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const providerError = url.searchParams.get("error_description");

  if (code) return NextResponse.redirect(`${url.origin}${next}`);

  const message = providerError ?? "The sign-in link is missing its code. Request a new link.";
  return NextResponse.redirect(`${url.origin}/auth/error?error=${encodeURIComponent(message)}`);
}
