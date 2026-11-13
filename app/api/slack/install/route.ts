import { z } from "zod";
import { hasSlack } from "@/lib/chat/env";
import { signInstallState, slackAuthorizeUrl } from "@/lib/chat/slack-oauth";
import { createClient } from "@/lib/supabase/server";

/** "Add to Slack": only the workspace's owner (signed in) can start it. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspace") ?? "";
  const back = (status: string) => Response.redirect(new URL(`/workspace/${workspaceId}?settings=channels&slack=${status}`, url.origin), 302);
  if (!z.string().uuid().safeParse(workspaceId).success) return new Response("Unknown workspace.", { status: 400 });
  if (!hasSlack()) return back("not-configured");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return Response.redirect(new URL("/", url.origin), 302);
  const { data: workspace } = await supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return new Response("Unknown workspace.", { status: 404 });

  const authorize = slackAuthorizeUrl(signInstallState({ w: workspaceId, u: userId, o: url.origin }));
  if (!authorize) return back("no-public-url");
  return Response.redirect(authorize, 302);
}
