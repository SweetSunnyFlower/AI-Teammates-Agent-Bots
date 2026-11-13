import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstallation, gh, githubAppSlug } from "./app";

/**
 * "Connect GitHub": install (or configure) Dotty's GitHub App, then link the installation to a
 * Dotty workspace. The app has "request user authorization during installation" on, so GitHub
 * sends the user back with an OAuth code; we only link an installation that the signed-in GitHub
 * user can actually see (their own /user/installations), so nobody can link someone else's
 * installation by editing the callback URL. SERVER ONLY.
 */

const STATE_TTL_MS = 30 * 60 * 1000;
export const INSTALL_COOKIE = "dotty_gh_install";

export interface InstallState {
  /** Dotty workspace id */
  w: string;
  /** Dotty user id (the workspace owner) */
  u: string;
  /** Origin of the web app to return to */
  o: string;
  /** Expiry (ms since epoch) */
  e: number;
}

const key = () => process.env.GITHUB_CLIENT_SECRET ?? "";
const sign = (data: string) =>
  createHmac("sha256", key())
    .update(`github-install:${data}`)
    .digest("base64url");

export function signInstallState(state: Omit<InstallState, "e">) {
  const data = Buffer.from(
    JSON.stringify({ ...state, e: Date.now() + STATE_TTL_MS }),
  ).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyInstallState(
  value: string | null | undefined,
): InstallState | null {
  if (!value || !key()) return null;
  const [data, mac] = value.split(".");
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const state = JSON.parse(
      Buffer.from(data, "base64url").toString(),
    ) as InstallState;
    return state.e > Date.now() ? state : null;
  } catch {
    return null;
  }
}

/** Where "Connect GitHub" sends the user: GitHub's install / configure page for our app. */
export const installUrl = (state: string) =>
  `https://github.com/apps/${encodeURIComponent(githubAppSlug())}/installations/new?state=${encodeURIComponent(state)}`;

/** Exchange the OAuth code for a user token (used once, never stored). */
async function userToken(code: string) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "dotty-github-app",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!body.access_token)
    throw new Error(
      body.error_description ?? body.error ?? "GitHub didn't sign you in.",
    );
  return body.access_token;
}

/**
 * The installation to link: `installationId` if the GitHub user can see it; with no id (the app was
 * already installed and the user only signed in), their only installation of our app.
 */
export async function verifiedInstallation(
  code: string,
  installationId: string | null,
) {
  const token = await userToken(code);
  const res = await gh<{
    installations: Array<{ id: number; account: { login: string } | null }>;
  }>(token, "/user/installations", { query: { per_page: 100 } });
  const mine = res.installations;
  const pick = installationId
    ? mine.find((i) => String(i.id) === installationId)
    : mine.length === 1
      ? mine[0]
      : undefined;
  if (!pick) {
    throw new Error(
      installationId
        ? "That installation isn't one your GitHub account can see."
        : mine.length
          ? "Your GitHub account has Dotty installed in several places — choose one from Connect GitHub."
          : "Dotty isn't installed on your GitHub account yet.",
    );
  }
  return getInstallation(String(pick.id));
}

export interface GitHubLink {
  installationId: string;
  account: string | null;
  accountType: string | null;
  selection: "all" | "selected";
  manageUrl: string;
  status: "active" | "needs_reconnect";
}

type Db = SupabaseClient;

/** The workspace's GitHub installation (service role or the owner's client). */
export async function githubLink(
  db: Db,
  workspaceId: string,
): Promise<GitHubLink | null> {
  const { data } = await db
    .from("connections")
    .select("external_id, meta, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", "github")
    .maybeSingle();
  if (!data?.external_id) return null;
  const meta = (data.meta ?? {}) as Record<string, string>;
  return {
    installationId: data.external_id,
    account: meta.account ?? null,
    accountType: meta.account_type ?? null,
    selection: meta.repository_selection === "selected" ? "selected" : "all",
    manageUrl: meta.html_url ?? "https://github.com/settings/installations",
    status: data.status,
  };
}

export async function saveGitHubLink(
  db: Db,
  workspaceId: string,
  installation: Awaited<ReturnType<typeof getInstallation>>,
) {
  const { error } = await db.from("connections").upsert(
    {
      workspace_id: workspaceId,
      provider: "github",
      external_id: String(installation.id),
      status: installation.suspended_at ? "needs_reconnect" : "active",
      meta: {
        account: installation.account?.login ?? null,
        account_type: installation.account?.type ?? null,
        repository_selection: installation.repository_selection,
        html_url: installation.html_url,
      },
    },
    { onConflict: "workspace_id,provider" },
  );
  if (error) throw new Error(error.message);
}
