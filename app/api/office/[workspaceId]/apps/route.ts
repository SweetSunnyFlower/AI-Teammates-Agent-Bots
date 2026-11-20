import { z } from "zod";
import { hasGitHubApp } from "@/lib/github/app";
import { connectedToolkits, hasComposio } from "@/lib/integrations/composio";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";

/**
 * The apps connected to a workspace, for choosing a bot's apps. A plain GET (not a server action)
 * so a slow Composio call never holds up saving the bot — server actions run one at a time.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/office/[workspaceId]/apps">) {
  const { workspaceId } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  if (!hasDatabaseEnv || !z.string().uuid().safeParse(workspaceId).success) {
    return Response.json({ apps: [], error: "Unknown workspace." }, { status: 404, headers });
  }
  const supabase = await createClient();
  const { data: workspace } = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return Response.json({ apps: [], error: "Unknown workspace." }, { status: 404, headers });
  if (!hasComposio() && !hasGitHubApp()) {
    return Response.json({ apps: [], error: "Composio isn't set up yet — add COMPOSIO_API_KEY to .env.local.", setup: true }, { headers });
  }
  try {
    // GitHub (Dotty's own app) plus Composio's toolkits; a Composio failure leaves just GitHub.
    const apps = await connectedToolkits(workspaceId);
    return Response.json({ apps, error: null }, { headers });
  } catch (error) {
    console.error("[composio] couldn't list connected apps", error);
    return Response.json({ apps: [], error: "Couldn't reach Composio — try again." }, { status: 502, headers });
  }
}
