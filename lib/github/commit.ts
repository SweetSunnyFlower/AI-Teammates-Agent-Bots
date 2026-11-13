import { gh, GitHubError, installationToken } from "./app";

/**
 * Turning a code run's changes into a branch and a draft pull request (D20). The sandbox only ever
 * gets a read-only token; the commit is made here through GitHub's Git Data API with a token
 * limited to the one repo. Pushes go to `dotty/…` branches only, never the base branch.
 */

export interface ChangedFile {
  path: string;
  /** "100644" | "100755" | "120000" — null deletes the file. */
  mode: "100644" | "100755" | "120000";
  /** Base64 file content; null deletes the file. */
  content: string | null;
}

/** A write token for one repo: contents (commit/branch) and pull requests. */
export const writeToken = (installationId: string, repoName: string) =>
  installationToken(installationId, { repo: repoName, permissions: { metadata: "read", contents: "write", pull_requests: "write" } });

const DOTTY_BRANCH = /^dotty\/[A-Za-z0-9._/-]{1,100}$/;

/**
 * Commit `files` on top of `parentSha` and point `branch` at it. A new branch is created; an
 * existing `dotty/…` branch is fast-forwarded (follow-up runs on the same pull request).
 */
export async function commitToBranch(input: {
  token: string;
  owner: string;
  repo: string;
  parentSha: string;
  branch: string;
  message: string;
  files: ChangedFile[];
}) {
  if (!DOTTY_BRANCH.test(input.branch)) throw new Error(`Dotty only pushes to dotty/… branches (got ${input.branch}).`);
  const base = `/repos/${input.owner}/${input.repo}`;
  const parent = await gh<{ tree: { sha: string } }>(input.token, `${base}/git/commits/${input.parentSha}`);

  // Blobs a few at a time (GitHub rate-limits bursts of content creation).
  const tree: Array<{ path: string; mode: string; type: "blob"; sha: string | null }> = [];
  for (let i = 0; i < input.files.length; i += 4) {
    const batch = input.files.slice(i, i + 4);
    const entries = await Promise.all(
      batch.map(async (f) => {
        if (f.content === null) return { path: f.path, mode: "100644", type: "blob" as const, sha: null };
        const blob = await gh<{ sha: string }>(input.token, `${base}/git/blobs`, { method: "POST", body: { content: f.content, encoding: "base64" } });
        return { path: f.path, mode: f.mode, type: "blob" as const, sha: blob.sha };
      }),
    );
    tree.push(...entries);
  }

  const newTree = await gh<{ sha: string }>(input.token, `${base}/git/trees`, { method: "POST", body: { base_tree: parent.tree.sha, tree } });
  const commit = await gh<{ sha: string }>(input.token, `${base}/git/commits`, {
    method: "POST",
    body: { message: input.message, tree: newTree.sha, parents: [input.parentSha] },
  });

  const ref = `heads/${input.branch}`;
  try {
    await gh(input.token, `${base}/git/refs`, { method: "POST", body: { ref: `refs/${ref}`, sha: commit.sha } });
  } catch (error) {
    // The branch exists (a follow-up run): move it forward — never force.
    if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    await gh(input.token, `${base}/git/refs/${ref}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
  }
  return { sha: commit.sha };
}

/** A branch name that isn't taken yet: dotty/<slug>, then -2, -3… */
export async function freeBranchName(token: string, owner: string, repo: string, wanted: string) {
  for (let n = 1; n <= 20; n++) {
    const name = n === 1 ? wanted : `${wanted}-${n}`;
    try {
      await gh(token, `/repos/${owner}/${repo}/git/ref/heads/${name}`);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return name;
      throw error;
    }
  }
  throw new Error("Couldn't find a free branch name.");
}

/** Open a draft pull request (or a normal one where the repo's plan has no drafts). */
export async function openDraftPullRequest(input: { token: string; owner: string; repo: string; branch: string; base: string; title: string; body: string }) {
  const create = (draft: boolean) =>
    gh<{ number: number; html_url: string; draft: boolean }>(input.token, `/repos/${input.owner}/${input.repo}/pulls`, {
      method: "POST",
      body: { title: input.title, head: input.branch, base: input.base, body: input.body, draft },
    });
  try {
    return await create(true);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422 && /draft/i.test(error.message)) {
      return create(false);
    }
    throw error;
  }
}
