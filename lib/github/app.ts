import { createSign } from "node:crypto";

/**
 * Dotty's GitHub App (D20). App JWT → short-lived installation tokens scoped to one repo and the
 * fewest permissions a call needs. SERVER ONLY — reads the app's private key; never logs a token.
 * Set up with `npm run github:app` (see .env.example → GitHub).
 */

export const hasGitHubApp = () =>
  Boolean(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_SLUG &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_CLIENT_ID &&
    process.env.GITHUB_CLIENT_SECRET,
  );

export const githubAppSlug = () => process.env.GITHUB_APP_SLUG?.trim() ?? "";

const API = "https://api.github.com";
const USER_AGENT = "dotty-github-app";

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The PEM may arrive with real newlines, "\n" escapes, or base64-encoded. */
function privateKey() {
  const raw = (process.env.GITHUB_APP_PRIVATE_KEY ?? "")
    .trim()
    .replace(/^"|"$/g, "");
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf8");
}

const b64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

/** A 9-minute app JWT (GitHub allows 10; issued 60s in the past for clock drift). */
function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: process.env.GITHUB_APP_ID,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey());
  return `${header}.${payload}.${b64url(signature)}`;
}

/** One GitHub REST call. `auth` is a token (installation or user) or "app" for the app JWT. */
export async function gh<T = unknown>(
  auth: string,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {},
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {}))
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      Authorization: `Bearer ${auth === "app" ? appJwt() : auth}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message =
      (json as { message?: string } | undefined)?.message ?? res.statusText;
    throw new GitHubError(res.status, message);
  }
  return json as T;
}

export type Permissions = Partial<
  Record<
    "contents" | "pull_requests" | "issues" | "checks" | "actions" | "metadata",
    "read" | "write"
  >
>;

/** Read-only access for looking at a repo. */
export const READ: Permissions = {
  metadata: "read",
  contents: "read",
  issues: "read",
  pull_requests: "read",
  checks: "read",
};

const tokens = new Map<string, { token: string; expires: number }>();

/**
 * An installation token (1 hour). Pass `repo` ("name" only — the installation fixes the owner) to
 * limit it to that repository. Cached until 5 minutes before it expires.
 */
export async function installationToken(
  installationId: string,
  options: { repo?: string; permissions?: Permissions } = {},
) {
  const key = `${installationId}|${options.repo ?? "*"}|${JSON.stringify(options.permissions ?? {})}`;
  const hit = tokens.get(key);
  if (hit && hit.expires - Date.now() > 5 * 60_000) return hit.token;
  const res = await gh<{ token: string; expires_at: string }>(
    "app",
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      body: {
        ...(options.repo ? { repositories: [options.repo] } : {}),
        ...(options.permissions ? { permissions: options.permissions } : {}),
      },
    },
  );
  tokens.set(key, {
    token: res.token,
    expires: new Date(res.expires_at).getTime(),
  });
  if (tokens.size > 500) tokens.delete(tokens.keys().next().value!);
  return res.token;
}

export interface Installation {
  id: number;
  account: { login: string; type: string } | null;
  repository_selection: "all" | "selected";
  html_url: string;
  suspended_at: string | null;
}

export const getInstallation = (installationId: string) =>
  gh<Installation>(
    "app",
    `/app/installations/${encodeURIComponent(installationId)}`,
  );

export interface Repo {
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description: string | null;
  open_issues_count: number;
  pushed_at: string | null;
  archived: boolean;
}

const repoCache = new Map<string, { at: number; repos: Repo[] }>();

/** Repositories the installation can see (first 300), cached for a minute. */
export async function installationRepos(
  installationId: string,
): Promise<Repo[]> {
  const hit = repoCache.get(installationId);
  if (hit && Date.now() - hit.at < 60_000) return hit.repos;
  const token = await installationToken(installationId, {
    permissions: { metadata: "read" },
  });
  const repos: Repo[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await gh<{ repositories: Repo[]; total_count: number }>(
      token,
      "/installation/repositories",
      { query: { per_page: 100, page } },
    );
    repos.push(...res.repositories);
    if (repos.length >= res.total_count || res.repositories.length < 100) break;
  }
  repoCache.set(installationId, { at: Date.now(), repos });
  return repos;
}

/** "owner/name" → parts, or null if it isn't a repo name. */
export function parseRepo(value: string) {
  const m = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})$/.exec(
    value
      .trim()
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, ""),
  );
  return m ? { owner: m[1], name: m[2], full: `${m[1]}/${m[2]}` } : null;
}
