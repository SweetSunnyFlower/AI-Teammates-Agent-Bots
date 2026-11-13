import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitByIp } from "@/lib/ratelimit";

/**
 * GitHub App webhook (signature checked with GITHUB_WEBHOOK_SECRET). For now it keeps connections
 * honest: an uninstalled or suspended installation stops being used until the user reconnects.
 * Pull requests closed, merged or reopened on GitHub update Dotty's code runs (Boards badges).
 */
export async function POST(request: Request) {
  const limited = await limitByIp("webhook", request);
  if (limited) return limited;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret)
    return new Response("GitHub webhook isn't configured.", { status: 503 });

  const body = await request.text();
  const given = Buffer.from(request.headers.get("x-hub-signature-256") ?? "");
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  );
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return new Response("Bad signature.", { status: 401 });

  const event = request.headers.get("x-github-event");
  let payload: {
    action?: string;
    installation?: { id?: number };
    repository?: { full_name?: string };
    pull_request?: { number?: number; merged?: boolean };
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad payload.", { status: 400 });
  }
  const installationId = payload.installation?.id
    ? String(payload.installation.id)
    : null;

  if (event === "installation" && installationId) {
    const db = createAdminClient();
    const status =
      payload.action === "deleted" || payload.action === "suspend"
        ? "needs_reconnect"
        : payload.action === "unsuspend"
          ? "active"
          : null;
    if (status) {
      const { error } = await db
        .from("connections")
        .update({ status })
        .eq("provider", "github")
        .eq("external_id", installationId);
      if (error) {
        console.error("[github] webhook update failed", error.message);
        return new Response("Try again.", { status: 500 });
      }
    }
  }
  // Keep Dotty's pull requests in step with GitHub (merged or closed there, reopened).
  if (event === "pull_request" && (payload.action === "closed" || payload.action === "reopened")) {
    const repo = payload.repository?.full_name;
    const number = payload.pull_request?.number;
    if (repo && number) {
      const state = payload.action === "reopened" ? "open" : payload.pull_request?.merged ? "merged" : "closed";
      const { error } = await createAdminClient().from("code_runs").update({ pr_state: state }).eq("repo", repo).eq("pr_number", number);
      if (error) console.error("[github] couldn't update the pull request state", error.message);
    }
  }
  return new Response(null, { status: 204 });
}
