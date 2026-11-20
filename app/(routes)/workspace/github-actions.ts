"use server";

import { z } from "zod";
import { hasGitHubApp, installationRepos } from "@/lib/github/app";
import { githubLink } from "@/lib/github/install";
import { createAdminClient } from "@/lib/db/admin";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";

/** Settings → Connectors → GitHub (Dotty's own GitHub App): status and unlink. */

export interface GitHubStatus {
  /** The server has the GitHub App's credentials. */
  configured: boolean;
  link: {
    account: string | null;
    selection: "all" | "selected";
    /** Where the user picks repos / uninstalls, on GitHub. */
    manageUrl: string;
    status: "active" | "needs_reconnect";
    /** First few repos Dotty can see (null if GitHub couldn't be reached). */
    repos: string[] | null;
    repoCount: number | null;
  } | null;
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

async function owned(workspaceId: string) {
  if (!hasDatabaseEnv || !uuid.safeParse(workspaceId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  return data ? supabase : null;
}

export async function getGitHubStatus(
  workspaceId: string,
): Promise<Result<{ status: GitHubStatus }>> {
  const supabase = await owned(workspaceId);
  if (!supabase) return { ok: false, error: "Unknown workspace." };
  const link = await githubLink(supabase, workspaceId);
  if (!link)
    return { ok: true, status: { configured: hasGitHubApp(), link: null } };
  let repos: string[] | null = null;
  if (hasGitHubApp() && link.status === "active") {
    try {
      repos = (await installationRepos(link.installationId)).map(
        (r) => r.full_name,
      );
    } catch (error) {
      console.error(
        "[github] couldn't list repos",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return {
    ok: true,
    status: {
      configured: hasGitHubApp(),
      link: {
        account: link.account,
        selection: link.selection,
        manageUrl: link.manageUrl,
        status: link.status,
        repos: repos?.slice(0, 6) ?? null,
        repoCount: repos?.length ?? null,
      },
    },
  };
}

/** Stop using the installation in this workspace (the app stays installed on GitHub until removed there). */
export async function unlinkGitHub(
  workspaceId: string,
): Promise<Result<object>> {
  if (!(await owned(workspaceId)))
    return { ok: false, error: "Unknown workspace." };
  const { error } = await createAdminClient()
    .from("connections")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", "github");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
