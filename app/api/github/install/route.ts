import { NextResponse } from "next/server";
import { z } from "zod";
import { hasGitHubApp } from "@/lib/github/app";
import {
  INSTALL_COOKIE,
  installUrl,
  signInstallState,
} from "@/lib/github/install";
import { createClient } from "@/lib/supabase/server";
import { limitByIp } from "@/lib/ratelimit";

/**
 * "Connect GitHub": only the workspace's owner (signed in) can start it. The signed state rides
 * along to GitHub and back; a cookie holds a copy in case GitHub drops it.
 */
export async function GET(request: Request) {
  const limited = await limitByIp("connect", request);
  if (limited) return limited;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace") ?? "";
  if (!z.string().uuid().safeParse(workspaceId).success)
    return new Response("Unknown workspace.", { status: 400 });
  const back = (status: string) =>
    NextResponse.redirect(
      new URL(
        `/workspace/${workspaceId}?settings=connectors&github=${status}`,
        url.origin,
      ),
      302,
    );
  if (!hasGitHubApp()) return back("not-configured");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/", url.origin), 302);
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!workspace) return new Response("Unknown workspace.", { status: 404 });

  const state = signInstallState({ w: workspaceId, u: userId, o: url.origin });
  const res = NextResponse.redirect(installUrl(state), 302);
  res.cookies.set(INSTALL_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/api/github",
    maxAge: 30 * 60,
  });
  return res;
}
