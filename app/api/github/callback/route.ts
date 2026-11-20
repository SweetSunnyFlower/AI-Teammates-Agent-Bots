import { NextResponse, type NextRequest } from "next/server";
import { hasGitHubApp } from "@/lib/github/app";
import {
  INSTALL_COOKIE,
  saveGitHubLink,
  verifiedInstallation,
  verifyInstallState,
} from "@/lib/github/install";
import { createAdminClient } from "@/lib/db/admin";
import { limitByIp } from "@/lib/ratelimit";

/**
 * GitHub sends the user back here after installing or configuring Dotty's app (the app asks for
 * user sign-in during install, so we get an OAuth code). We link the installation only if the
 * signed state is ours and the GitHub user can see that installation. The user token is used once.
 */
export async function GET(request: NextRequest) {
  const limited = await limitByIp("connect", request);
  if (limited) return limited;
  const url = new URL(request.url);
  const state =
    verifyInstallState(url.searchParams.get("state")) ??
    verifyInstallState(request.cookies.get(INSTALL_COOKIE)?.value);
  if (!state)
    return new Response(
      "GitHub 连接链接已过期，请从 Dotty →“设置”→“连接器”→“GitHub”重新开始。",
      { status: 400 },
    );

  const back = (status: string) => {
    const res = NextResponse.redirect(
      new URL(
        `/workspace/${state.w}?settings=connectors&github=${status}`,
        state.o,
      ),
      302,
    );
    res.cookies.delete({ name: INSTALL_COOKIE, path: "/api/github" });
    return res;
  };
  if (!hasGitHubApp()) return back("not-configured");
  if (url.searchParams.get("error")) return back("cancelled");
  // An organization owner still has to approve the install.
  if (url.searchParams.get("setup_action") === "request")
    return back("requested");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");
  const installationId = url.searchParams.get("installation_id");
  if (installationId && !/^\d{1,20}$/.test(installationId))
    return back("failed");

  try {
    const db = createAdminClient();
    // The state was signed for the workspace owner; make sure that's still true.
    const { data: workspace } = await db
      .from("workspaces")
      .select("id, owner_id")
      .eq("id", state.w)
      .maybeSingle();
    if (!workspace || workspace.owner_id !== state.u) return back("failed");

    const installation = await verifiedInstallation(code, installationId);
    await saveGitHubLink(db, state.w, installation);
    return back("connected");
  } catch (error) {
    console.error(
      "[github] install failed",
      error instanceof Error ? error.message : error,
    );
    return back("failed");
  }
}
