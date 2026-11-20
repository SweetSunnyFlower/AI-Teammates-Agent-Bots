"use server";

import { redirect } from "next/navigation";
import { WORKSPACE_ICONS } from "@/lib/office/workspace-icons";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";
import { getCurrentUserId } from "@/lib/auth/session";

export type CreateWorkspaceState = { error?: string; name?: string; icon?: string };

/**
 * Creates a workspace and its starter building (Head office, Assistant, Research, Engineering
 * floors with a Lead + worker each) through the `create_workspace` RPC — one transaction, RLS applied.
 */
export async function createWorkspace(_prev: CreateWorkspaceState, formData: FormData): Promise<CreateWorkspaceState> {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const iconRaw = String(formData.get("icon") ?? "");
  const icon = WORKSPACE_ICONS.includes(iconRaw) ? iconRaw : WORKSPACE_ICONS[0];
  const timezone = String(formData.get("timezone") ?? "").slice(0, 64);

  if (!hasDatabaseEnv) return { error: "Database isn't configured yet — add DATABASE_URL to .env.local.", name, icon };
  if (name.length < 1 || name.length > 60) return { error: "Give your workspace a name (up to 60 characters).", name, icon };

  const userId = await getCurrentUserId();
  if (!userId) redirect("/auth/login?next=/workspace/new");
  const supabase = await createClient();

  // Remember the user's timezone for recaps and activity times (first run, or if it changed).
  if (timezone && isValidTimeZone(timezone)) {
    await supabase.from("profiles").upsert({ user_id: userId, timezone }, { onConflict: "user_id" });
  }

  const { data: workspaceId, error } = await supabase.rpc("create_workspace", { p_name: name, p_icon: icon });
  if (error || typeof workspaceId !== "string") {
    const message = error?.message.includes("Workspace limit")
      ? "You've reached the limit of 10 workspaces."
      : `Couldn't create the workspace${error ? `: ${error.message}` : "."}`;
    return { error: message, name, icon };
  }

  redirect(`/workspace/${workspaceId}`);
}

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
