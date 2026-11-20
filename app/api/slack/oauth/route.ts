import { readyChatBot, slackAdapter } from "@/lib/chat/bot";
import { hasSlack } from "@/lib/chat/env";
import { saveLink } from "@/lib/chat/links";
import { exchangeSlackCode, verifyInstallState } from "@/lib/chat/slack-oauth";
import { createAdminClient } from "@/lib/db/admin";
import { limitByIp } from "@/lib/ratelimit";

/**
 * Slack sends the installer back here (on the public URL). We check the signed state, exchange the
 * code, store the installation (bot token encrypted, in the chat state tables) and link the Slack
 * workspace + installing user to the Dotty workspace. Then back to the app.
 */
export async function GET(request: Request) {
  const limited = await limitByIp("connect", request);
  if (limited) return limited;
  const url = new URL(request.url);
  const state = verifyInstallState(url.searchParams.get("state"));
  if (!state) return new Response("This install link expired — start again from Dotty → Settings → Channels.", { status: 400 });
  const back = (status: string) => Response.redirect(new URL(`/workspace/${state.w}?settings=channels&slack=${status}`, state.o), 302);
  if (!hasSlack()) return back("not-configured");
  if (url.searchParams.get("error")) return back("cancelled");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");

  try {
    const db = createAdminClient();
    // The state was signed for the workspace owner; make sure that's still true.
    const { data: workspace } = await db.from("workspaces").select("id, owner_id").eq("id", state.w).maybeSingle();
    if (!workspace || workspace.owner_id !== state.u) return back("failed");

    const install = await exchangeSlackCode(code);
    const bot = await readyChatBot();
    const slack = slackAdapter(bot);
    if (!slack) return back("not-configured");
    await slack.setInstallation(install.teamId, { botToken: install.botToken, botUserId: install.botUserId, teamName: install.teamName });
    await saveLink(db, {
      workspaceId: state.w,
      provider: "slack",
      externalId: install.teamId,
      meta: { user_id: install.userId, team_name: install.teamName },
    });

    // Say hello in a DM so the user knows where to find Dotty.
    await slack
      .withBotToken(
        install.botToken,
        async () => {
          const threadId = await slack.openDM(install.userId);
          await bot.thread(threadId).post({
            markdown: "👋 Dotty is connected. Message me here and your Head bot will take it from there — start with @ and a bot's name to talk to that bot. Approvals and questions will show up here with buttons.",
          });
        },
        { installationId: install.teamId, botUserId: install.botUserId },
      )
      .catch((error: unknown) => console.error("[slack] welcome DM failed", error));
    return back("connected");
  } catch (error) {
    console.error("[slack] install failed", error);
    return back("failed");
  }
}
