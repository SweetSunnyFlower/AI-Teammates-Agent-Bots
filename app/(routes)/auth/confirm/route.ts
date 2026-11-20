import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * Compatibility route for links created by the previous Supabase deployment.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const next = safeNext(searchParams.get("next"));

  if (tokenHash) redirect(next);

  redirect(`/auth/error?error=${encodeURIComponent("This link is missing its token. Request a new one.")}`);
}
