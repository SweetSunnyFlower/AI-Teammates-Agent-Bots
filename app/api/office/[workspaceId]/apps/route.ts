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
    return Response.json({ apps: [], error: "工作空间不存在。" }, { status: 404, headers });
  }
  const databaseClient = await createClient();
  const { data: workspace } = await databaseClient.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return Response.json({ apps: [], error: "工作空间不存在。" }, { status: 404, headers });
  if (!hasComposio() && !hasGitHubApp()) {
    return Response.json({ apps: [], error: "Composio 尚未配置，请在 .env.local 中添加 COMPOSIO_API_KEY。", setup: true }, { headers });
  }
  try {
    // GitHub (Dotty's own app) plus Composio's toolkits; a Composio failure leaves just GitHub.
    const apps = await connectedToolkits(workspaceId);
    return Response.json({ apps, error: null }, { headers });
  } catch (error) {
    console.error("[composio] couldn't list connected apps", error);
    return Response.json({ apps: [], error: "无法连接 Composio，请重试。" }, { status: 502, headers });
  }
}
