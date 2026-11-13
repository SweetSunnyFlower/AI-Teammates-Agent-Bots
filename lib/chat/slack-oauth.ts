import { createHmac, timingSafeEqual } from "node:crypto";
import { chatPublicUrl } from "./env";

/**
 * "Add to Slack" (OAuth v2). The install link carries a signed state (workspace, user, where to
 * return, expiry) so the callback — which arrives on the public URL (ngrok locally), where the
 * user's Dotty login cookie may not exist — knows which workspace to link. SERVER ONLY.
 */

/** What the bot needs: DMs and @-mentions, posting, and reading user names. */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "chat:write",
  "im:history",
  "im:read",
  "im:write",
  "users:read",
  "reactions:write",
];

const STATE_TTL_MS = 15 * 60 * 1000;

interface InstallState {
  /** Dotty workspace id */
  w: string;
  /** Dotty user id (the workspace owner) */
  u: string;
  /** Origin of the web app to return to */
  o: string;
  /** Expiry (ms since epoch) */
  e: number;
}

const key = () => process.env.SLACK_CLIENT_SECRET ?? "";
const sign = (data: string) => createHmac("sha256", key()).update(data).digest("base64url");

export function signInstallState(state: Omit<InstallState, "e">) {
  const data = Buffer.from(JSON.stringify({ ...state, e: Date.now() + STATE_TTL_MS })).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyInstallState(value: string | null): InstallState | null {
  if (!value || !key()) return null;
  const [data, mac] = value.split(".");
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const state = JSON.parse(Buffer.from(data, "base64url").toString()) as InstallState;
    return state.e > Date.now() ? state : null;
  } catch {
    return null;
  }
}

export const slackRedirectUri = () => {
  const base = chatPublicUrl();
  return base ? `${base}/api/slack/oauth` : null;
};

export function slackAuthorizeUrl(state: string) {
  const redirect = slackRedirectUri();
  if (!redirect) return null;
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID ?? "");
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Exchange the OAuth code (we need the installing user's id, which the adapter helper doesn't return). */
export async function exchangeSlackCode(code: string) {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: slackRedirectUri() ?? "",
    }),
  });
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id: string; name: string } | null;
    authed_user?: { id: string };
    is_enterprise_install?: boolean;
  };
  if (!body.ok || !body.access_token || !body.team?.id || !body.authed_user?.id) {
    throw new Error(body.is_enterprise_install ? "Org-wide (Enterprise Grid) installs aren't supported — install Dotty in one workspace." : `Slack said: ${body.error ?? "unknown error"}`);
  }
  return {
    botToken: body.access_token,
    botUserId: body.bot_user_id,
    teamId: body.team.id,
    teamName: body.team.name,
    userId: body.authed_user.id,
  };
}
