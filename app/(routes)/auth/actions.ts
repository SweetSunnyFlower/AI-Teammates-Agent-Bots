"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasSupabaseEnv, safeNext } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string; email?: string };

const MISSING_ENV = "Supabase isn't configured yet — add your keys to .env.local and restart the dev server.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Public origin of this app, used to build the links Supabase redirects back to. */
async function siteOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Email a passwordless sign-in link. New emails get an account automatically (sign up = sign in). */
export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(formData.get("next")?.toString());

  if (!hasSupabaseEnv) return { status: "error", message: MISSING_ENV, email };
  if (!EMAIL_RE.test(email)) return { status: "error", message: "Enter a valid email address.", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) return { status: "error", message: error.message, email };
  return { status: "sent", email };
}

/** Start Google OAuth (PKCE). Supabase sends the user back to /auth/callback. */
export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(formData.get("next")?.toString());
  if (!hasSupabaseEnv) redirect(`/auth/login?error=${encodeURIComponent(MISSING_ENV)}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    redirect(`/auth/login?error=${encodeURIComponent(error?.message ?? "Could not start Google sign-in.")}`);
  }
  redirect(data.url);
}

export async function signOut() {
  if (hasSupabaseEnv) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/auth/login");
}
